using System.Threading;
using System.Windows;
using System.Windows.Threading;
using WorkPepTalk.Services;

namespace WorkPepTalk;

/// <summary>
/// 应用入口。注意这里必须写全 System.Windows.Application ——
/// 项目同时引用了 WPF 和 WinForms（托盘图标用），ImplicitUsings 会把
/// 两个 Application 都带进来，不写全名就是 CS0104 二义性。
/// </summary>
public partial class App : System.Windows.Application
{
    private Mutex? _single;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        /* 单实例：开机自启 + 手动双击很容易起两份，两份会抢同一个 config.json */
        _single = new Mutex(true, @"Local\WorkPepTalk.SingleInstance", out var created);
        if (!created)
        {
            Log.Info("已有实例在运行，本次启动退出");
            Shutdown();
            return;
        }

        /* 未捕获异常一律记日志，绝不让挂件静默消失 */
        DispatcherUnhandledException += OnDispatcherException;
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            Log.Error("未捕获异常：" + args.ExceptionObject);

        Log.Info("==== 启动 ====");

#if DEBUG
        /* 调试参数透传给页面：--view panel --theme C --bg black --at 19:06 */
        var qs = new List<string>();
        for (var i = 0; i < e.Args.Length; i++)
        {
            if (i + 1 >= e.Args.Length) continue;
            var key = e.Args[i] switch
            {
                "--view" => "view",
                "--theme" => "theme",
                "--bg" => "bg",
                "--at" => "at",
                "--setup" => "setup",
                _ => null
            };
            if (key is not null) qs.Add(key + "=" + Uri.EscapeDataString(e.Args[++i]));
        }
        /* 注意写全名：App 自己有个 MainWindow 属性（类型是 Window），
           不带命名空间会被解析成那个属性而不是我们自己的窗口类。 */
        if (qs.Count > 0) WorkPepTalk.MainWindow.DebugQuery = "?" + string.Join("&", qs);
#endif

        var store = new ConfigStore();
        var win = new MainWindow(store);
        MainWindow = win;
        win.Show();

#if DEBUG
        /* --shot <png> ：等页面稳定后自截一张再退出，仅调试构建可用。
           用来核对像素级布局，不用去截屏打扰用户桌面。
           --click <x> <y> 可先派发一次真实点击，用来验证按钮是否真的能点开。 */
        var idx = Array.IndexOf(e.Args, "--shot");
        if (idx >= 0 && idx + 1 < e.Args.Length)
        {
            var outPath = e.Args[idx + 1];
            var (cx, cy) = ClickFromArgs(e.Args);
            _ = CaptureAndQuitAsync(win, outPath, EvalFromArgs(e.Args), cx, cy);
        }
#endif
    }

#if DEBUG
    private static string? EvalFromArgs(string[] args)
    {
        var i = Array.IndexOf(args, "--eval");
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }

    private static (double? x, double? y) ClickFromArgs(string[] args)
    {
        var i = Array.IndexOf(args, "--click");
        if (i < 0 || i + 2 >= args.Length) return (null, null);
        return double.TryParse(args[i + 1], out var x) && double.TryParse(args[i + 2], out var y)
            ? (x, y) : (null, null);
    }

    private static async Task CaptureAndQuitAsync(
        MainWindow win, string outPath, string? evalJs, double? cx = null, double? cy = null)
    {
        try
        {
            /* 等页面真的加载完，而不是睡固定秒数 —— 机器快慢不一样，
               固定延时在慢机器上截到的一定是白图。 */
            var done = await Task.WhenAny(win.PageLoaded, Task.Delay(15000));
            var loaded = done is Task<bool> t && await t;
            if (!loaded) Log.Warn("等待页面加载超时（15s），仍尝试截图");

            await Task.Delay(900);           // 再留一帧给字体和布局

            if (!string.IsNullOrWhiteSpace(evalJs))
            {
                var r = await win.EvalAsync(evalJs);
                Log.Info("执行 JS → " + r);
                await Task.Delay(1200);      // 等界面按新配置重绘完
            }

            if (cx is { } px && cy is { } py)
            {
                /* 记下点击前的窗口尺寸，点完之后再记一次 —— 面板比挂件高得多，
                   尺寸变了就说明按钮真的被点开了。 */
                Log.Info($"点击前窗口 {win.Width:0.#}x{win.Height:0.#}");
                await win.ClickAsync(px, py);
                await Task.Delay(1500);
                Log.Info($"点击后窗口 {win.Width:0.#}x{win.Height:0.#}");
                await Task.Delay(400);
            }

            var p = await win.CaptureAsync(outPath);
            Log.Info("已截图：" + (p ?? "(失败)"));
        }
        catch (Exception ex)
        {
            Log.Error("截图失败：" + ex.Message);
        }
        finally
        {
            Current.Shutdown();
        }
    }
#endif

    private void OnDispatcherException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        Log.Error("界面异常：" + e.Exception);
        e.Handled = true;   // 一次界面异常不该让整个挂件退出
    }

    protected override void OnExit(ExitEventArgs e)
    {
        Log.Info("==== 退出 ====");
        _single?.Dispose();
        base.OnExit(e);
    }
}
