using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using WorkPepTalk.Interop;
using WorkPepTalk.Models;
using WorkPepTalk.Services;

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
    private IntPtr _hIcon = IntPtr.Zero;

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

        TrySetWindowIcon();

        _saveTimer.Tick += (_, _) => { _saveTimer.Stop(); PersistWindowState(); };

        Loaded += OnLoaded;
        LocationChanged += OnLocationChanged;
        Closed += OnClosed;
    }

    /* Alt-Tab 预览和错误对话框会用到窗口图标。窗口本身不显示标题栏，
       所以这里只是兜个底，主要视觉入口是托盘。 */
    private void TrySetWindowIcon()
    {
        try
        {
            if (IconFactory.IcoData is not { Length: > 0 } bytes) return;

            /* BitmapFrame 能直接解整份 .ico，取到的就是最大那档 */
            using var ms = new MemoryStream(bytes);
            Icon = BitmapFrame.Create(ms, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
        }
        catch (Exception ex)
        {
            Log.Warn("窗口图标加载失败：" + ex.Message);
        }
    }

    /* ------------------------------------------------------------ 启动 */

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        PlaceWindow();

        /* 32px 那一档：通知区在高 DPI 下会按缩放比取更大尺寸，
           给 16px 上去在 150% 屏上就是糊的 */
        _hIcon = IconFactory.CreateHIcon(32);
        CreateTray();

        ApplyTopmost(_store.Current.Behaviour.AlwaysOnTop);
        AutoStart.Sync(_store.Current.Behaviour.AutoStart);

        await InitWebViewAsync();
    }

    private void CreateTray()
    {
        _tray = new Tray(this, _hIcon);
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
            // 用户数据放 exe 同级，绿色版不污染 AppData；目录不可写时（装在
            // Program Files、或 exe 放在只读位置）才落到 %LOCALAPPDATA%
            var dataDir = ResolveDataDir();
            Log.Info("WebView2 数据目录：" + dataDir);

            /*
             * 挂件只需要画一小块静态内容，但 WebView2 默认会起一整套浏览器进程组。
             * 这里逐条关掉用不上的东西，只为压低常驻内存：
             *   - 后台网络 / 组件更新 / 同步 / 崩溃上报：挂件不联网，全关
             *   - 侧边栏、购物、收藏等 Edge 特性：一个都用不到
             *   - V8 堆上限 64MB：页面只有几百行 JS，给再多也是浪费
             *   - 渲染进程限 1 个：只有一个页面，不需要多渲染器
             */
            var options = new CoreWebView2EnvironmentOptions
            {
                AdditionalBrowserArguments = string.Join(" ",
                    "--disable-features=msEdgeSidebarV2,msEdgeCollections,msEdgeShoppingAssistant," +
                    "msEdgeAutofill,msEdgeDiscover,msIdentityFeatures",
                    "--disable-background-networking",
                    "--disable-component-update",
                    "--disable-sync",
                    "--disable-breakpad",
                    "--disable-domain-reliability",
                    "--disable-client-side-phishing-detection",
                    "--no-first-run",
                    "--js-flags=--max-old-space-size=64",
                    "--renderer-process-limit=1",
                    /* 挂件是静态文字和一根进度条，用不着 GPU 合成。
                       关掉能省掉独立 GPU 进程和一块显存。 */
                    "--disable-gpu",
                    "--disable-gpu-compositing")
            };

            var env = await CoreWebView2Environment.CreateAsync(null, dataDir, options);
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

            var wwwrootCheck = Path.Combine(AppPaths.BaseDir, "wwwroot");

            if (WebResources.Count == 0)
            {
                /* 正常情况下资源一定内嵌在程序集里。只剩一种可能：构建时
                   wwwroot 没被打进去（比如有人手工改过 csproj）。此时如果
                   磁盘上还留着老版本的 wwwroot 目录，就用目录顶着，别直接白屏。 */
                if (!Directory.Exists(wwwrootCheck))
                {
                    Log.Error("程序集内没有任何页面资源，且缺少 wwwroot 目录");
                    MessageBox.Show("安装不完整：程序内没有页面资源。请重新下载完整的程序。",
                        "上班鼓励器", MessageBoxButton.OK, MessageBoxImage.Error);
                    Application.Current.Shutdown();
                    return;
                }

                Log.Warn("启用磁盘 wwwroot 兜底：" + wwwrootCheck);
                core.SetVirtualHostNameToFolderMapping(
                    "app.local", wwwrootCheck, CoreWebView2HostResourceAccessKind.Allow);
            }
            else
            {
                /* 页面全部从内嵌资源流里回应。好处是发布产物只有一个 exe，
                   坏处是每个请求都要自己给 Content-Type，写完就不能改。 */
                core.AddWebResourceRequestedFilter(
                    "https://app.local/*", CoreWebView2WebResourceContext.All);
                core.WebResourceRequested += OnWebResourceRequested;
                Log.Info($"内嵌页面资源 {WebResources.Count} 个");
            }

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

    /* ------------------------------------------------- 内嵌页面资源 */

    /*
     * wwwroot 下的文件被 csproj 以 web/xxx 的逻辑名打进程序集。
     * 这里建一张「请求路径 → 资源名」的表，大小写不敏感（Windows 上写 URL
     * 的人不会care大小写），同时把 MSBuild 给的 %(RecursiveDir) 反斜杠统一掉。
     */
    private static readonly Dictionary<string, string> WebResources = BuildWebResourceMap();

    private static Dictionary<string, string> BuildWebResourceMap()
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var asm = typeof(MainWindow).Assembly;

        foreach (var name in asm.GetManifestResourceNames())
        {
            if (!name.StartsWith("web/", StringComparison.Ordinal)) continue;
            map[name[4..].Replace('\\', '/')] = name;
        }
        return map;
    }

    private static string MimeOf(string rel)
    {
        var dot = rel.LastIndexOf('.');
        var ext = dot < 0 ? "" : rel[dot..].ToLowerInvariant();
        return ext switch
        {
            ".html" or ".htm" => "text/html; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".js" => "text/javascript; charset=utf-8",
            ".json" => "application/json; charset=utf-8",
            ".svg" => "image/svg+xml",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            ".woff2" => "font/woff2",
            ".woff" => "font/woff",
            ".ico" => "image/x-icon",
            _ => "application/octet-stream"
        };
    }

    /*
     * 页面请求一律从这里回应。之所以不用 SetVirtualHostNameToFolderMapping：
     * 那个 API 只能在磁盘上找目录，而我们要的一个 exe 里根本没有目录。
     *
     * 响应流交给 WebView2 之后不能立刻释放，所以每次复制一份 MemoryStream
     * 递出去，让它自己读完回收 —— 文件总共几十 KB，不值得做池化。
     */
    private void OnWebResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var core = Web.CoreWebView2;
        if (core is null) return;

        try
        {
            var path = new Uri(e.Request.Uri).AbsolutePath;
            var rel = Uri.UnescapeDataString(path).TrimStart('/');
            if (rel.Length == 0) rel = "index.html";

            if (!WebResources.TryGetValue(rel, out var resName))
            {
                Log.Warn("页面资源缺失：" + rel);
                e.Response = core.Environment.CreateWebResourceResponse(
                    null, 404, "Not Found", "Content-Type: text/plain; charset=utf-8");
                return;
            }

            using var src = typeof(MainWindow).Assembly.GetManifestResourceStream(resName)!;
            var ms = new MemoryStream((int)src.Length);
            src.CopyTo(ms);
            ms.Position = 0;

            e.Response = core.Environment.CreateWebResourceResponse(
                ms, 200, "OK",
                "Content-Type: " + MimeOf(rel) + "\r\nCache-Control: no-store");
        }
        catch (Exception ex)
        {
            Log.Warn("响应页面资源失败：" + ex.Message);
            try
            {
                e.Response = core.Environment.CreateWebResourceResponse(
                    null, 500, "Internal Error", "Content-Type: text/plain; charset=utf-8");
            }
            catch { /* 连 500 都构造不出来就只能让它白屏了 */ }
        }
    }

    /// <summary>
    /// WebView2 的用户数据目录。优先 exe 同级（绿色版语义），
    /// 那里不可写就退到 %LOCALAPPDATA%\WorkPepTalk，宁可我脏一点也不能启动就崩。
    /// </summary>
    private static string ResolveDataDir()
    {
        var beside = Path.Combine(AppPaths.BaseDir, "WebView2Data");
        try
        {
            Directory.CreateDirectory(beside);
            var probe = Path.Combine(beside, ".write-test");
            File.WriteAllText(probe, "1");
            File.Delete(probe);
            return beside;
        }
        catch
        {
            var fallback = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "WorkPepTalk", "WebView2Data");
            Directory.CreateDirectory(fallback);
            Log.Warn("exe 同级不可写，WebView2 数据改存 " + fallback);
            return fallback;
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

                /* 挂件右上角的钉子。和托盘菜单里的「窗口置顶」是同一个开关，
                   改完必须 RefreshTrayState，否则托盘勾选状态会跟界面说的不一样。 */
                case "toggleTopmost":
                {
                    var on = !_store.Current.Behaviour.AlwaysOnTop;
                    _store.Current.Behaviour.AlwaysOnTop = on;
                    _store.Save(_store.Current);
                    ApplyTopmost(on);
                    RefreshTrayState();
                    SendToWeb("topmost", new { on });
                    break;
                }

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
            view = _store.Current.Window.Collapsed ? "ball" : "widget",
            maxPanelH = MaxPanelHeightDip()
        }, JsonOpts);

        Web.CoreWebView2?.PostWebMessageAsJson(payload);
    }

    /*
     * 设置面板可用的最大高度（DIP）。
     * 面板的自然高度约 780，在 1440p 上放得下，但 1366×768 的笔记本
     * 工作区只有 ~570 DIP —— 不加限制的话底部「开始使用」会被顶出屏幕，
     * 用户改完设置却按不到确认。页面拿到这个值后给面板设 max-height 内部滚动。
     */
    private double MaxPanelHeightDip()
    {
        try
        {
            var h = WorkAreaDip().Height - 40;   // 留出边距，别贴着任务栏
            return h >= 320 ? h : 320;
        }
        catch
        {
            return 820;
        }
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
        /* 主屏用「包含坐标原点的那块屏」来定位：多屏时主屏一定覆盖 (0,0)，
           这正是 WinForms 里 PrimaryScreen 的语义 */
        var wa = Shell.MonitorOfPoint(new Shell.POINT { X = 0, Y = 0 }).rcWork;
        var s = DpiScale;
        const double margin = 20;

        Left = (wa.Right - Width * s - margin * s) / s;
        Top = (wa.Bottom - Height * s - margin * s) / s;
    }

    private bool IsVisibleOnAnyScreen()
    {
        var s = DpiScale;
        var left = (int)(Left * s);
        var top = (int)(Top * s);
        var right = left + (int)(Width * s);
        var bottom = top + (int)(Height * s);

        // 至少要有一块 40x40 露在某个显示器的工作区里，否则用户点不到
        foreach (var wa in Shell.AllWorkAreas())
        {
            var w = Math.Min(right, wa.Right) - Math.Max(left, wa.Left);
            var h = Math.Min(bottom, wa.Bottom) - Math.Max(top, wa.Top);
            if (w >= 40 && h >= 40) return true;
        }
        return false;
    }

    /// <summary>当前窗口所在显示器的工作区，换算成 DIP。</summary>
    private Rect WorkAreaDip()
    {
        var hwnd = new WindowInteropHelper(this).Handle;

        var wa = hwnd != IntPtr.Zero
            ? Shell.MonitorOfWindow(hwnd).rcWork
            : Shell.MonitorOfPoint(new Shell.POINT { X = 0, Y = 0 }).rcWork;

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

    /*
     * 置顶只走这一个出口：启动恢复、托盘菜单、挂件图钉、面板保存都汇到这里。
     * 顺手记一行日志 —— 置顶是纯状态型设置，界面看不出异常时日志是唯一线索
     * （比如「重启后置顶丢了」，看这行有没有在启动时出现就知道配置有没有读到）。
     */
    private void ApplyTopmost(bool on)
    {
        Topmost = on;
        Log.Info("窗口置顶：" + (on ? "开" : "关"));
    }

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
        _tray?.ShowMenuAtCursor();
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
         * 只有查屏幕名时才换算成物理像素（显示器 API 用的是物理坐标）。
         */
        var centerPx = new Shell.POINT
        {
            X = (int)(Left * s + Width * s / 2),
            Y = (int)(Top * s + Height * s / 2)
        };

        _store.SaveWindow(
            (int)Math.Round(Left),
            (int)Math.Round(Top),
            Shell.MonitorOfPoint(centerPx).szDevice,
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
        _tray?.Dispose();       // 顺带销毁 HICON
        _hIcon = IntPtr.Zero;
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

    /// <summary>调试用：在页面里执行一段 JS，用于验证交互路径。</summary>
    public async Task<string> EvalAsync(string js)
    {
        if (Web.CoreWebView2 is null) return "(未就绪)";
        return await Web.CoreWebView2.ExecuteScriptAsync(js);
    }

    /// <summary>
    /// 调试用：在页面坐标 (x, y) 处派发一次完整鼠标点击。
    ///
    /// 走浏览器内核的输入管线，mousedown → mouseup → click 三个事件都会真实触发 ——
    /// 这点很关键：如果 mousedown 期间触发了系统级拖窗循环（SendMessage 模态），
    /// click 就会被吞掉，而只有这种真实事件序列能暴露该问题。
    ///
    /// 不碰系统光标，所以不会打扰正在用电脑的人，也不受 DPI 虚拟化影响。
    /// </summary>
    public async Task ClickAsync(double x, double y)
    {
        var core = Web.CoreWebView2;
        if (core is null) return;

        var steps = new[]
        {
            new { type = "mouseMoved",    x, y, button = "none", buttons = 0, clickCount = 0 },
            new { type = "mousePressed",  x, y, button = "left", buttons = 1, clickCount = 1 },
            new { type = "mouseReleased", x, y, button = "left", buttons = 0, clickCount = 1 }
        };

        foreach (var s in steps)
        {
            await core.CallDevToolsProtocolMethodAsync(
                "Input.dispatchMouseEvent", JsonSerializer.Serialize(s));
            await Task.Delay(45);
        }

        Log.Info($"已派发点击 ({x:0.#}, {y:0.#})");
    }
#endif
}
