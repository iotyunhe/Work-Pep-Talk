using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using WorkPepTalk.Interop;
using WorkPepTalk.Models;
using WorkPepTalk.Services;
using Forms = System.Windows.Forms;

namespace WorkPepTalk;

/// <summary>
/// 挂件主窗口。无边框、不入任务栏、尺寸随内容变。
///
/// 界面全在 WebView2 里（wwwroot/），这里只做四件事：
///   1. 把窗口摆到该在的位置，并记住用户拖到哪
///   2. 按 JS 上报的尺寸精确设窗（差 1px 就会露出窗口底色）
///   3. 把 JS 的动作翻译成系统行为（拖动、置顶、穿透）
///   4. 收发消息、落盘配置
/// </summary>
public partial class MainWindow : Window
{
    private readonly ConfigStore _store;
    private Tray? _tray;
    private System.Drawing.Icon? _icon;

    private bool _webReady;
    private string _lastSize = "";
    private bool _applyingSize;

    /* 打开设置面板前的挂件位置，面板关闭后据此归位 */
    private (double Left, double Top)? _widgetAnchor;

    /* 页面首帧加载完成的信号，调试截图与自检都靠它对齐时机 */
    private readonly TaskCompletionSource<bool> _pageLoaded =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public Task<bool> PageLoaded => _pageLoaded.Task;

    /// <summary>
    /// 仅调试构建使用的 URL 查询串（?view=panel&amp;theme=C…）。
    /// Release 下永远是空串，不影响正式加载。
    /// </summary>
#if DEBUG
    public static string DebugQuery = "";
#else
    public static string DebugQuery = "";
#endif

    /* 拖动窗口时 LocationChanged 会连发几十次，攒一下再落盘 */
    private readonly DispatcherTimer _saveTimer = new() { Interval = TimeSpan.FromMilliseconds(600) };

    public MainWindow(ConfigStore store)
    {
        InitializeComponent();
        _store = store;

        _saveTimer.Tick += (_, _) => { _saveTimer.Stop(); PersistWindowState(); };

        Loaded += OnLoaded;
        LocationChanged += OnLocationChanged;
        Closed += OnClosed;
    }

    /* ------------------------------------------------------------ 启动 */

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        PlaceWindow();

        _icon = IconFactory.Create(32);
        CreateTray();

        ApplyTopmost(_store.Current.Behaviour.AlwaysOnTop);
        AutoStart.Sync(_store.Current.Behaviour.AutoStart);

        await InitWebViewAsync();
    }

    private void CreateTray()
    {
        _tray = new Tray(_icon!);
        _tray.ToggleRequested += () => ToggleCollapse();
        _tray.SettingsRequested += () => SendToWeb("setView", new { view = "panel" });
        _tray.ResetPositionRequested += () => { SnapToCorner(); PersistWindowState(); };
        _tray.ExitRequested += () => Application.Current.Shutdown();

        _tray.AlwaysOnTopChanged += v =>
        {
            _store.Current.Behaviour.AlwaysOnTop = v;
            _store.Save(_store.Current);
            ApplyTopmost(v);
            RefreshTrayState();
        };
        _tray.ClickThroughChanged += v =>
        {
            _store.Current.Behaviour.ClickThrough = v;
            _store.Save(_store.Current);
            ApplyClickThrough(v);
            RefreshTrayState();
        };
        _tray.AutoStartChanged += v =>
        {
            _store.Current.Behaviour.AutoStart = v;
            _store.Save(_store.Current);
            AutoStart.Set(v);
            RefreshTrayState();
        };

        RefreshTrayState();
    }

    private void RefreshTrayState()
    {
        var c = _store.Current;
        _tray?.UpdateState(c.Behaviour.AlwaysOnTop, c.Behaviour.ClickThrough,
            c.Behaviour.AutoStart, c.Window.Collapsed);
    }

    /* ------------------------------------------------------- WebView2 */

    private async Task InitWebViewAsync()
    {
        try
        {
            // 用户数据放 exe 同级，绿色版不污染 AppData
            var dataDir = Path.Combine(AppContext.BaseDirectory, "WebView2Data");
            Directory.CreateDirectory(dataDir);

            var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
            await Web.EnsureCoreWebView2Async(env);

            var core = Web.CoreWebView2;

            // 默认右键菜单、状态栏、缩放都关掉 —— 挂件不该像个浏览器
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.AreDevToolsEnabled = false;

            // 页面背景透明，圆角外由窗口底色兜住
            Web.DefaultBackgroundColor = System.Drawing.Color.Transparent;

            core.WebMessageReceived += OnWebMessage;

            core.NavigationStarting += (_, ev) => Log.Info("开始加载：" + ev.Uri);
            core.NavigationCompleted += (_, ev) =>
            {
                if (ev.IsSuccess) Log.Info("页面加载成功");
                else Log.Error("页面加载失败：" + ev.WebErrorStatus);
                _pageLoaded.TrySetResult(ev.IsSuccess);
            };
            core.ProcessFailed += (_, ev) =>
                Log.Error("WebView 进程异常：" + ev.ProcessFailedKind);

            var wwwroot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
            if (!Directory.Exists(wwwroot))
            {
                Log.Error("找不到 wwwroot 目录：" + wwwroot);
                MessageBox.Show("安装不完整：缺少 wwwroot 目录。请重新解压整个文件夹。",
                    "上班鼓励器", MessageBoxButton.OK, MessageBoxImage.Error);
                Application.Current.Shutdown();
                return;
            }

            core.SetVirtualHostNameToFolderMapping(
                "app.local", wwwroot, CoreWebView2HostResourceAccessKind.Allow);
            Log.Info("虚拟主机映射 app.local → " + wwwroot);

            core.Navigate("https://app.local/index.html" + DebugQuery);
            _webReady = true;
            Log.Info("WebView2 就绪");
        }
        catch (Exception ex)
        {
            Log.Error("WebView2 初始化失败：" + ex);
            var r = MessageBox.Show(
                "缺少 WebView2 运行时，界面无法显示。\n\n" +
                "Windows 11 与较新的 Windows 10 自带；\n" +
                "若提示缺失，请安装 Microsoft Edge WebView2 Runtime 后重试。\n\n" +
                "现在打开下载页吗？",
                "上班鼓励器", MessageBoxButton.YesNo, MessageBoxImage.Warning);

            if (r == MessageBoxResult.Yes)
            {
                try
                {
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = "https://go.microsoft.com/fwlink/p/?LinkId=2124703",
                        UseShellExecute = true
                    });
                }
                catch { }
            }
            Application.Current.Shutdown();
        }
    }

    /* -------------------------------------------------------- 消息通道 */

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeEl)) return;

            switch (typeEl.GetString())
            {
                case "ready":
                    SendConfigToWeb();
                    break;

                case "size":
                    if (root.TryGetProperty("w", out var w) && root.TryGetProperty("h", out var h))
                        ApplySize(w.GetDouble(), h.GetDouble());
                    break;

                case "drag":
                    Native.BeginDrag(new WindowInteropHelper(this).Handle);
                    break;

                case "collapse":
                    _store.Current.Window.Collapsed = true;
                    SendToWeb("setView", new { view = "ball" });
                    RefreshTrayState();
                    SaveLater();
                    break;

                case "expand":
                    _store.Current.Window.Collapsed = false;
                    SendToWeb("setView", new { view = "widget" });
                    RefreshTrayState();
                    SaveLater();
                    break;

                case "save":
                    if (root.TryGetProperty("config", out var cfgEl))
                        SaveFromWeb(cfgEl.GetRawText());
                    break;

                case "bgColor":
                    if (root.TryGetProperty("color", out var colorEl))
                        SetWindowBackground(colorEl.GetString());
                    break;

                case "menu":
                    ShowContextMenu();
                    break;

                case "openSettings":
                case "closeSettings":
                    // 尺寸由后续的 size 消息带着走，这里不用做事
                    break;
            }
        }
        catch (Exception ex)
        {
            Log.Warn("处理消息失败：" + ex.Message);
        }
    }

    private void SendConfigToWeb()
    {
        var payload = JsonSerializer.Serialize(new
        {
            type = "config",
            config = _store.Current,
            view = _store.Current.Window.Collapsed ? "ball" : "widget"
        }, JsonOpts);

        Web.CoreWebView2?.PostWebMessageAsJson(payload);
    }

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private void SendToWeb(string type, object body)
    {
        if (!_webReady || Web.CoreWebView2 is null) return;
        var dict = new Dictionary<string, object?> { ["type"] = type };
        foreach (var p in body.GetType().GetProperties())
            dict[p.Name] = p.GetValue(body);

        Web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(dict, JsonOpts));
    }

    private void SaveFromWeb(string json)
    {
        try
        {
            var cfg = JsonSerializer.Deserialize<AppConfig>(json, JsonOpts);
            if (cfg is null) return;

            // 窗口坐标以宿主为准，别被页面渲染时的旧值覆盖回去
            cfg.Window.X = _store.Current.Window.X;
            cfg.Window.Y = _store.Current.Window.Y;
            cfg.Window.Screen = _store.Current.Window.Screen;
            cfg.Window.Collapsed = _store.Current.Window.Collapsed;

            _store.Save(cfg);

            ApplyTopmost(cfg.Behaviour.AlwaysOnTop);
            ApplyClickThrough(cfg.Behaviour.ClickThrough);
            AutoStart.Sync(cfg.Behaviour.AutoStart);
            RefreshTrayState();
        }
        catch (Exception ex)
        {
            Log.Warn("保存页面配置失败：" + ex.Message);
        }
    }

    /* ---------------------------------------------------------- 尺寸 */

    private void ApplySize(double w, double h)
    {
        if (w < 40 || h < 40) return;

        var key = $"{w:0.#}x{h:0.#}";
        if (key == _lastSize) return;
        _lastSize = key;

        var wasTall = Height > 300;
        var willBeTall = h > 300;

        /* 打开设置面板前先记下挂件的位置：面板比挂件高得多，
           为了不出屏会被迫上移，关掉面板后要能回到原处 */
        if (!wasTall && willBeTall) _widgetAnchor = (Left, Top);

        _applyingSize = true;
        try
        {
            Width = w;
            Height = h;
            KeepOnScreen();

            if (wasTall && !willBeTall && _widgetAnchor is { } a)
            {
                Left = a.Left;
                Top = a.Top;
                _widgetAnchor = null;
            }

            // 尺寸差 1px 就会露出窗口底色，直接把实际值记下来便于核对
            Log.Info($"设窗 {w:0.#}x{h:0.#} → 实际 {ActualWidth:0.#}x{ActualHeight:0.#} " +
                     $"位置 {Left:0},{Top:0} DPI {DpiScale:0.##}");
        }
        finally
        {
            _applyingSize = false;
        }
    }

    /* ---------------------------------------------------------- 定位 */

    private double DpiScale
    {
        get
        {
            var src = PresentationSource.FromVisual(this);
            return src?.CompositionTarget?.TransformToDevice.M11 ?? 1.0;
        }
    }

    private void PlaceWindow()
    {
        var cfg = _store.Current.Window;

        if (cfg.X is int x && cfg.Y is int y)
        {
            Left = x;
            Top = y;

            // 上次的位置可能来自已拔掉的副屏，落回主屏
            if (!IsVisibleOnAnyScreen())
            {
                Log.Warn("配置的窗口位置在屏幕外，回落到右下角");
                SnapToCorner();
            }
        }
        else
        {
            SnapToCorner();
        }
    }

    private void SnapToCorner()
    {
        var wa = Forms.Screen.PrimaryScreen!.WorkingArea;
        var s = DpiScale;
        const double margin = 20;

        Left = (wa.Right - Width * s - margin * s) / s;
        Top = (wa.Bottom - Height * s - margin * s) / s;
    }

    private bool IsVisibleOnAnyScreen()
    {
        var s = DpiScale;
        var r = new System.Drawing.Rectangle(
            (int)(Left * s), (int)(Top * s),
            (int)(Width * s), (int)(Height * s));

        // 至少要有一块 40x40 露在某个屏幕里，否则用户点不到
        foreach (var sc in Forms.Screen.AllScreens)
        {
            var inter = System.Drawing.Rectangle.Intersect(sc.WorkingArea, r);
            if (inter.Width >= 40 && inter.Height >= 40) return true;
        }
        return false;
    }

    /// <summary>当前窗口所在屏幕的工作区，换算成 DIP。</summary>
    private Rect WorkAreaDip()
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        var scr = hwnd != IntPtr.Zero
            ? Forms.Screen.FromHandle(hwnd)
            : Forms.Screen.PrimaryScreen!;

        var wa = scr.WorkingArea;
        var s = DpiScale;
        return new Rect(wa.Left / s, wa.Top / s, wa.Width / s, wa.Height / s);
    }

    /// <summary>
    /// 把窗口推回工作区内。
    /// 设置面板有 680 多高，从右下角直接长下去会有半截在屏幕外，
    /// 所以这里不是「不可见才挪」，而是每边都夹一遍。
    /// </summary>
    private void KeepOnScreen()
    {
        var wa = WorkAreaDip();
        const double m = 8;

        if (Width > wa.Width - m * 2) Width = Math.Max(80, wa.Width - m * 2);
        if (Height > wa.Height - m * 2) Height = Math.Max(80, wa.Height - m * 2);

        if (Left + Width > wa.Right - m) Left = wa.Right - Width - m;
        if (Top + Height > wa.Bottom - m) Top = wa.Bottom - Height - m;
        if (Left < wa.Left + m) Left = wa.Left + m;
        if (Top < wa.Top + m) Top = wa.Top + m;
    }

    /* ---------------------------------------------------------- 行为 */

    private void ApplyTopmost(bool on) => Topmost = on;

    private void ApplyClickThrough(bool on)
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd == IntPtr.Zero) return;
        Native.SetClickThrough(hwnd, on);
    }

    private void SetWindowBackground(string? hex)
    {
        if (string.IsNullOrWhiteSpace(hex)) return;
        try
        {
            Background = (Brush)new BrushConverter().ConvertFromString(hex)!;
        }
        catch { /* 颜色串不合法就保持原色 */ }
    }

    private void ToggleCollapse()
    {
        var collapsed = !_store.Current.Window.Collapsed;
        _store.Current.Window.Collapsed = collapsed;
        SendToWeb("setView", new { view = collapsed ? "ball" : "widget" });
        RefreshTrayState();
        SaveLater();
    }

    private void ShowContextMenu()
    {
        // 右键窗口等同右键托盘：复用同一份菜单，不两份逻辑
        var menu = _tray?.Menu;
        if (menu is null) return;
        menu.Show(Forms.Cursor.Position);
    }

    /* ---------------------------------------------------------- 落盘 */

    private void OnLocationChanged(object? sender, EventArgs e)
    {
        if (_applyingSize) return;
        SaveLater();
    }

    private void SaveLater()
    {
        _saveTimer.Stop();
        _saveTimer.Start();
    }

    private void PersistWindowState()
    {
        var s = DpiScale;

        /*
         * 坐标一律按 DIP 存 —— 因为 WPF 的 Left/Top 就是 DIP，读写同一套单位
         * 才不会在 150% 缩放的机器上把窗口存到屏幕外去。
         * 只有查屏幕名时才换算成物理像素（Screen 用的是物理坐标）。
         */
        var centerPx = new System.Drawing.Point(
            (int)(Left * s + Width * s / 2),
            (int)(Top * s + Height * s / 2));

        _store.SaveWindow(
            (int)Math.Round(Left),
            (int)Math.Round(Top),
            Forms.Screen.FromPoint(centerPx).DeviceName,
            _store.Current.Window.Collapsed);
    }

    /* ---------------------------------------------------------- 收尾 */

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        Native.TryRoundCorners(new WindowInteropHelper(this).Handle);
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        _saveTimer.Stop();
        PersistWindowState();
        _tray?.Dispose();
        _icon?.Dispose();
    }

#if DEBUG
    /// <summary>
    /// 调试用：把 WebView 当前画面截成 PNG。
    /// 走 WebView2 自己的 CapturePreviewAsync，不碰屏幕，只取本页面内容。
    /// Release 编译时整段不参与生成。
    /// </summary>
    public async Task<string?> CaptureAsync(string path)
    {
        if (Web.CoreWebView2 is null) return null;

        using var fs = File.Create(path);
        await Web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs);
        return path;
    }
#endif
}
