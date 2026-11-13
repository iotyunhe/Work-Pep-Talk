using System.Runtime.InteropServices;

namespace WorkPepTalk.Interop;

/// <summary>
/// Win32 互操作。集中放一处，方便审阅每个调用的用途和风险。
/// 只用到桌面挂件真正需要的几项：拖窗、置顶、穿透、圆角。
/// </summary>
internal static class Native
{
    public const int WM_NCLBUTTONDOWN = 0x00A1;
    public const int HTCAPTION = 2;

    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_TRANSPARENT = 0x00000020;
    public const int WS_EX_LAYERED = 0x00080000;
    public const int WS_EX_TOOLWINDOW = 0x00000080;

    public const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    public const int DWMWCP_ROUND = 2;

    [DllImport("user32.dll")]
    public static extern bool ReleaseCapture();

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int x, int y, int cx, int cy, uint flags);

    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    /// <summary>
    /// 让窗口进入系统级的拖动循环。
    /// 不用 MouseMove 手工算位移：那样在 125%/150% 缩放下必然漂移，
    /// 而且没法处理多屏边界吸附。
    /// </summary>
    public static void BeginDrag(IntPtr hwnd)
    {
        ReleaseCapture();
        SendMessage(hwnd, WM_NCLBUTTONDOWN, HTCAPTION, IntPtr.Zero);
    }

    /// <summary>点击穿透：鼠标事件直接穿过窗口落到下面。</summary>
    public static void SetClickThrough(IntPtr hwnd, bool enable)
    {
        var ex = GetWindowLong(hwnd, GWL_EXSTYLE);
        ex = enable
            ? ex | WS_EX_TRANSPARENT | WS_EX_LAYERED
            : ex & ~WS_EX_TRANSPARENT & ~WS_EX_LAYERED;
        SetWindowLong(hwnd, GWL_EXSTYLE, ex);
    }

    /// <summary>
    /// Win11 的窗口圆角。Win10 上这个属性不认，返回非 0 就算了 ——
    /// 不影响功能，只是圆角变成直角。
    /// </summary>
    public static void TryRoundCorners(IntPtr hwnd)
    {
        try
        {
            var pref = DWMWCP_ROUND;
            DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref pref, sizeof(int));
        }
        catch
        {
            // 老系统没有 dwmapi 的这个属性，忽略
        }
    }
}
