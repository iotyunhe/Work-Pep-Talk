using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using WorkPepTalk.Interop;

namespace WorkPepTalk.Services;

/// <summary>
/// 系统托盘。挂件没有任务栏按钮（ShowInTaskbar=false），托盘菜单就是唯一的
/// 「总开关」—— 万一窗口被拖到屏幕外，也能从这里救回来。
///
/// 实现是手写 Shell_NotifyIcon + 原生 TrackPopupMenu，不是 WinForms 的
/// NotifyIcon：后者要背上 18MB 的 WinForms 栈，压缩后仍占 exe 一成。
/// 代价是要自己接 TaskbarCreated 广播（见 WndProc），否则资源管理器一重启，
/// 图标就再也回不来了。
/// </summary>
public sealed class Tray : IDisposable
{
    private const int IconId = 1;
    private const int WM_Tray = Shell.WM_APP + 1;

    private const int CmdSettings = 1;
    private const int CmdToggle = 2;
    private const int CmdReset = 3;
    private const int CmdTopmost = 4;
    private const int CmdThrough = 5;
    private const int CmdAutoStart = 6;
    private const int CmdExit = 7;

    private static readonly string Tip = "上班鼓励器";

    /* 这个 ID 每次登录都可能不同，只能运行期注册一次 */
    private static readonly int WM_TaskbarCreated = Shell.RegisterTaskbarCreated();

    private readonly IntPtr _hwnd;
    private readonly HwndSource _source;
    private readonly IntPtr _hIcon;

    private bool _topmost = true;
    private bool _through;
    private bool _autoStart;
    private bool _collapsed;
    private bool _disposed;

    public event Action? SettingsRequested;
    public event Action? ToggleRequested;
    public event Action? ResetPositionRequested;
    public event Action? ExitRequested;
    public event Action<bool>? AlwaysOnTopChanged;
    public event Action<bool>? ClickThroughChanged;
    public event Action<bool>? AutoStartChanged;

    public Tray(Window owner, IntPtr hIcon)
    {
        _hIcon = hIcon;
        _hwnd = new WindowInteropHelper(owner).Handle;
        _source = HwndSource.FromHwnd(_hwnd)
                  ?? throw new InvalidOperationException("主窗口还没有 HwndSource，托盘建不了");

        _source.AddHook(WndProc);

        if (!Shell.TrayAdd(_hwnd, IconId, WM_Tray, _hIcon, Tip))
            Log.Warn("托盘图标添加失败，Win32 错误码 " + Marshal.GetLastWin32Error());
        else
            Log.Info("托盘图标已挂到通知区");
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        /* explorer.exe 重启（崩溃、更新、手动结束任务）会清空通知区，
           系统随后广播 TaskbarCreated，收到就得把图标重新加一遍。 */
        if (msg == WM_TaskbarCreated)
        {
            Log.Info("收到 TaskbarCreated，重新添加托盘图标");
            if (!Shell.TrayAdd(_hwnd, IconId, WM_Tray, _hIcon, Tip))
                Log.Warn("重新添加托盘图标失败，错误码 " + Marshal.GetLastWin32Error());
            return IntPtr.Zero;
        }

        if (msg == WM_Tray)
        {
            /* 低 16 位才是鼠标消息，高位可能是坐标（NOTIFYICON_VERSION_4） */
            var evt = unchecked((int)(lParam.ToInt64() & 0xFFFF));
            switch (evt)
            {
                case Shell.WM_LBUTTONDBLCLK:
                    ToggleRequested?.Invoke();
                    handled = true;
                    break;

                case Shell.WM_RBUTTONUP:
                case Shell.WM_CONTEXTMENU:
                    ShowMenu();
                    handled = true;
                    break;
            }
        }

        return IntPtr.Zero;
    }

    /// <summary>右键窗口时复用同一份菜单，避免两处维护两套逻辑。</summary>
    public void ShowMenuAtCursor() => ShowMenu();

    private void ShowMenu()
    {
        /* 每次重建：菜单项文字和勾选状态都随配置变，缓存反而要处理失效 */
        var items = new List<Shell.MenuItem>
        {
            new(CmdSettings, "设置…"),
            new(CmdToggle, _collapsed ? "展开挂件" : "收起挂件"),
            new(CmdReset, "回到右下角"),
            Shell.MenuItem.Separator(),
            new(CmdTopmost, "窗口置顶", _topmost),
            new(CmdThrough, "鼠标点击穿透", _through),
            new(CmdAutoStart, "开机自动启动", _autoStart),
            Shell.MenuItem.Separator(),
            new(CmdExit, "退出")
        };

        var cmd = Shell.ShowMenu(_hwnd, items);
        if (cmd == 0) return;   // 点了外面，菜单取消

        Log.Info("托盘菜单命令 " + cmd);
        switch (cmd)
        {
            case CmdSettings: SettingsRequested?.Invoke(); break;
            case CmdToggle: ToggleRequested?.Invoke(); break;
            case CmdReset: ResetPositionRequested?.Invoke(); break;
            case CmdTopmost: AlwaysOnTopChanged?.Invoke(!_topmost); break;
            case CmdThrough: ClickThroughChanged?.Invoke(!_through); break;
            case CmdAutoStart: AutoStartChanged?.Invoke(!_autoStart); break;
            case CmdExit: ExitRequested?.Invoke(); break;
        }
    }

    public void UpdateState(bool topmost, bool through, bool autoStart, bool collapsed)
    {
        _topmost = topmost;
        _through = through;
        _autoStart = autoStart;
        _collapsed = collapsed;
    }

    public void ShowBalloon(string title, string text)
    {
        try
        {
            Shell.TrayBalloon(_hwnd, IconId, title, text);
        }
        catch
        {
            /* 气泡只是锦上添花，失败不该影响挂件 */
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        Shell.TrayRemove(_hwnd, IconId);
        _source.RemoveHook(WndProc);

        /* HICON 由 IconFactory 造，谁造谁销毁，这里只负责托盘这一层的摘除 */
        if (_hIcon != IntPtr.Zero) Shell.DestroyIcon(_hIcon);
    }
}
