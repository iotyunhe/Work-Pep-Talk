using System.Drawing;
using System.Windows.Forms;

namespace WorkPepTalk.Services;

/// <summary>
/// 系统托盘。挂件没有任务栏按钮（ShowInTaskbar=false），
/// 托盘菜单就是唯一的「总开关」—— 万一窗口被拖到屏幕外，也能从这里救回来。
/// </summary>
public sealed class Tray : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly ToolStripMenuItem _miToggle;
    private readonly ToolStripMenuItem _miTopmost;
    private readonly ToolStripMenuItem _miThrough;
    private readonly ToolStripMenuItem _miAutoStart;
    private readonly ToolStripMenuItem _miReset;

    public event Action? SettingsRequested;
    public event Action? ToggleRequested;
    public event Action? ResetPositionRequested;
    public event Action? ExitRequested;
    public event Action<bool>? AlwaysOnTopChanged;
    public event Action<bool>? ClickThroughChanged;
    public event Action<bool>? AutoStartChanged;

    /// <summary>右键窗口时复用这份菜单，避免两处维护两套逻辑。</summary>
    public ContextMenuStrip? Menu { get; }

    public Tray(Icon icon)
    {
        _miToggle = new ToolStripMenuItem("收起 / 展开", null, (_, _) => ToggleRequested?.Invoke());
        var miSettings = new ToolStripMenuItem("设置…", null, (_, _) => SettingsRequested?.Invoke());

        _miTopmost = new ToolStripMenuItem("窗口置顶", null, (_, _) => AlwaysOnTopChanged?.Invoke(!_miTopmost!.Checked))
        { CheckOnClick = false };
        _miThrough = new ToolStripMenuItem("鼠标点击穿透", null, (_, _) => ClickThroughChanged?.Invoke(!_miThrough!.Checked))
        { CheckOnClick = false };
        _miAutoStart = new ToolStripMenuItem("开机自动启动", null, (_, _) => AutoStartChanged?.Invoke(!_miAutoStart!.Checked))
        { CheckOnClick = false };

        _miReset = new ToolStripMenuItem("回到右下角", null, (_, _) => ResetPositionRequested?.Invoke());
        var miExit = new ToolStripMenuItem("退出", null, (_, _) => ExitRequested?.Invoke());

        var menu = new ContextMenuStrip();
        menu.Items.Add(miSettings);
        menu.Items.Add(_miToggle);
        menu.Items.Add(_miReset);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_miTopmost);
        menu.Items.Add(_miThrough);
        menu.Items.Add(_miAutoStart);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(miExit);
        Menu = menu;

        _icon = new NotifyIcon
        {
            Icon = icon,
            Text = "上班鼓励器",
            Visible = true,
            ContextMenuStrip = menu
        };
        _icon.DoubleClick += (_, _) => ToggleRequested?.Invoke();
    }

    public void UpdateState(bool topmost, bool through, bool autoStart, bool collapsed)
    {
        _miTopmost.Checked = topmost;
        _miThrough.Checked = through;
        _miAutoStart.Checked = autoStart;
        _miToggle.Text = collapsed ? "展开挂件" : "收起挂件";
    }

    public void ShowBalloon(string title, string text)
    {
        try { _icon.ShowBalloonTip(3000, title, text, ToolTipIcon.Info); } catch { }
    }

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();
    }
}
