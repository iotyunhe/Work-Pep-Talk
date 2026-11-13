using System.Runtime.InteropServices;

namespace WorkPepTalk.Interop;

/// <summary>
/// 托盘 / 显示器 / 光标 三块 Win32。
///
/// 为什么要手写：为了用 WinForms 的 NotifyIcon，整个 System.Windows.Forms
/// 栈（12.9MB 主程序集 + 2.9MB Primitives + System.Drawing.Common）都要跟着
/// 进 exe。自包含发布压缩后那是 6.5MB，占整个 exe 的一成。
/// 而我们真正用到的只有「放一个图标到通知区 + 弹一个原生菜单」这一件事。
///
/// 反过来，手写就必须自己处理 NotifyIcon 帮你兜住的两个坑：
///   1. explorer.exe 重启后通知区被清空 —— 必须监听 TaskbarCreated 广播重加图标
///   2. TrackPopupMenu 前要 SetForegroundWindow 并补一条 WM_NULL，否则菜单不消失
/// </summary>
internal static class Shell
{
    /* ------------------------------------------------ 通知区（托盘） */

    private const int NIM_ADD = 0x00000000;
    private const int NIM_MODIFY = 0x00000001;
    private const int NIM_DELETE = 0x00000002;

    public const int NIF_MESSAGE = 0x00000001;
    public const int NIF_ICON = 0x00000002;
    public const int NIF_TIP = 0x00000004;
    public const int NIF_INFO = 0x00000010;

    private const int NIIF_INFO = 0x00000001;

    public const int WM_LBUTTONUP = 0x0202;
    public const int WM_LBUTTONDBLCLK = 0x0203;
    public const int WM_RBUTTONUP = 0x0205;
    public const int WM_CONTEXTMENU = 0x007B;
    public const int WM_NULL = 0x0000;

    /// <summary>自定义消息基址，托盘回调走 WM_APP+1。</summary>
    public const int WM_APP = 0x8000;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct NOTIFYICONDATA
    {
        public int cbSize;
        public IntPtr hWnd;
        public int uID;
        public int uFlags;
        public int uCallbackMessage;
        public IntPtr hIcon;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szTip;

        public int dwState;
        public int dwStateMask;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string szInfo;

        /* 联合体：旧版是 uTimeout，Vista+ 是 uVersion。我们不用气泡超时，占位即可 */
        public int uTimeoutOrVersion;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string szInfoTitle;

        public int dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Shell_NotifyIcon(int message, ref NOTIFYICONDATA data);

    /// <summary>加图标。返回 false 说明通知区没接受（极少见，但必须记日志）。</summary>
    public static bool TrayAdd(IntPtr hwnd, int id, int callbackMsg, IntPtr hIcon, string tip)
    {
        var d = NewTrayData(hwnd, id);
        d.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
        d.uCallbackMessage = callbackMsg;
        d.hIcon = hIcon;
        d.szTip = Truncate(tip, 127);
        return Shell_NotifyIcon(NIM_ADD, ref d);
    }

    /// <summary>只改图标（比如换了图），不动其它字段。</summary>
    public static bool TraySetIcon(IntPtr hwnd, int id, IntPtr hIcon, string tip)
    {
        var d = NewTrayData(hwnd, id);
        d.uFlags = NIF_ICON | NIF_TIP;
        d.hIcon = hIcon;
        d.szTip = Truncate(tip, 127);
        return Shell_NotifyIcon(NIM_MODIFY, ref d);
    }

    public static bool TrayRemove(IntPtr hwnd, int id)
    {
        var d = NewTrayData(hwnd, id);
        return Shell_NotifyIcon(NIM_DELETE, ref d);
    }

    /// <summary>气泡提示。NotifyIcon.ShowBalloonTip 的等价物。</summary>
    public static bool TrayBalloon(IntPtr hwnd, int id, string title, string text)
    {
        var d = NewTrayData(hwnd, id);
        d.uFlags = NIF_INFO;
        d.szInfo = Truncate(text, 255);
        d.szInfoTitle = Truncate(title, 63);
        d.dwInfoFlags = NIIF_INFO;
        d.uTimeoutOrVersion = 3000;
        return Shell_NotifyIcon(NIM_MODIFY, ref d);
    }

    private static NOTIFYICONDATA NewTrayData(IntPtr hwnd, int id) => new()
    {
        /* cbSize 必须等于结构体实际大小；写错会导致整个调用静默失败 */
        cbSize = Marshal.SizeOf<NOTIFYICONDATA>(),
        hWnd = hwnd,
        uID = id,
        szTip = "",
        szInfo = "",
        szInfoTitle = ""
    };

    private static string Truncate(string s, int max) =>
        string.IsNullOrEmpty(s) ? "" : (s.Length <= max ? s : s[..max]);

    /// <summary>
    /// explorer 重启后会广播 "TaskbarCreated"。这个 ID 每次开机可能不同，
    /// 所以只能运行期注册一次再拿去比对。不处理的话，资源管理器一崩，
    /// 托盘图标就永久消失 —— 而托盘是挂件唯一的总开关。
    /// </summary>
    public static int RegisterTaskbarCreated() => RegisterWindowMessage("TaskbarCreated");

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int RegisterWindowMessage(string lpString);

    /* ------------------------------------------------------- 弹出菜单 */

    private const int MF_STRING = 0x00000000;
    private const int MF_SEPARATOR = 0x00000800;
    private const int MF_CHECKED = 0x00000008;

    private const int TPM_RIGHTBUTTON = 0x0002;
    private const int TPM_RETURNCMD = 0x0100;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool AppendMenu(IntPtr hMenu, int uFlags, IntPtr uIDNewItem, string lpNewItem);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyMenu(IntPtr hMenu);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int TrackPopupMenuEx(IntPtr hMenu, int uFlags, int x, int y, IntPtr hwnd, IntPtr lptpm);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    /// <summary>菜单项定义。id 为 0 表示分隔线。</summary>
    public readonly record struct MenuItem(int Id, string Text, bool Checked = false, bool IsSeparator = false)
    {
        public static MenuItem Separator() => new(0, "", false, true);
    }

    /// <summary>
    /// 在光标处弹出原生菜单，返回用户点中的命令 ID（取消则 0）。
    ///
    /// 用原生菜单而不是 WPF ContextMenu：挂件窗口没有焦点也没有标题栏，
    /// ContextMenu 在无 owner 时会因为抢不到焦点立刻自己关掉。
    /// </summary>
    public static int ShowMenu(IntPtr hwnd, IReadOnlyList<MenuItem> items)
    {
        var menu = CreatePopupMenu();
        if (menu == IntPtr.Zero) return 0;

        try
        {
            foreach (var it in items)
            {
                if (it.IsSeparator)
                {
                    AppendMenu(menu, MF_SEPARATOR, IntPtr.Zero, "");
                    continue;
                }
                var flags = MF_STRING | (it.Checked ? MF_CHECKED : 0);
                AppendMenu(menu, flags, new IntPtr(it.Id), it.Text);
            }

            GetCursorPos(out var pt);

            /* 这两个调用是「菜单点外面不消失」的经典解药，缺一不可 */
            SetForegroundWindow(hwnd);
            var cmd = TrackPopupMenuEx(menu,
                TPM_RETURNCMD | TPM_RIGHTBUTTON, pt.X, pt.Y, hwnd, IntPtr.Zero);
            PostMessage(hwnd, WM_NULL, IntPtr.Zero, IntPtr.Zero);

            return cmd;
        }
        finally
        {
            DestroyMenu(menu);
        }
    }

    /* --------------------------------------------------------- 光标 */

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT pt);

    public static POINT CursorPosition()
    {
        GetCursorPos(out var p);
        return p;
    }

    /* --------------------------------------------------------- 显示器 */

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left, Top, Right, Bottom;
        public int Width => Right - Left;
        public int Height => Bottom - Top;
    }

    public const uint MONITOR_DEFAULTTONULL = 0x00000000;
    public const uint MONITOR_DEFAULTTONEAREST = 0x00000002;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct MONITORINFOEX
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szDevice;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(POINT pt, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFOEX info);

    private delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, ref RECT rect, IntPtr data);

    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc proc, IntPtr data);

    private static MONITORINFOEX InfoOf(IntPtr hMonitor)
    {
        var info = new MONITORINFOEX
        {
            cbSize = Marshal.SizeOf<MONITORINFOEX>(),
            szDevice = ""
        };
        GetMonitorInfo(hMonitor, ref info);
        return info;
    }

    /// <summary>窗口所在显示器的信息（含工作区与设备名），取最近的。</summary>
    public static MONITORINFOEX MonitorOfWindow(IntPtr hwnd) =>
        InfoOf(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST));

    /// <summary>指定物理坐标点所在显示器；不在任何屏上时返回主屏。</summary>
    public static MONITORINFOEX MonitorOfPoint(POINT pt) =>
        InfoOf(MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST));

    /// <summary>所有显示器的工作区（物理像素）。用于判断窗口是否露在屏幕外。</summary>
    public static List<RECT> AllWorkAreas()
    {
        var list = new List<RECT>();
        bool Callback(IntPtr h, IntPtr hdc, ref RECT r, IntPtr data)
        {
            list.Add(InfoOf(h).rcWork);
            return true;
        }
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, Callback, IntPtr.Zero);
        return list;
    }

    /* ----------------------------------------------------- 图标句柄 */

    private const int LR_DEFAULTCOLOR = 0x0000;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CreateIconFromResourceEx(
        byte[] presbits, int dwResSize, bool fIcon, int dwVer, int cxDesired, int cyDesired, int flags);

    /// <summary>
    /// 把 .ico 里某一档的原始数据（ICONDIRENTRY 指向的 chunk）变成 HICON。
    /// 托盘只接受 HICON，而这里是唯一不需要 System.Drawing 的造法。
    /// </summary>
    public static IntPtr IconFromResource(byte[] chunk, int size) =>
        CreateIconFromResourceEx(chunk, chunk.Length, true, 0x00030000, size, size, LR_DEFAULTCOLOR);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool DestroyIcon(IntPtr hIcon);
}
