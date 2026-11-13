using System.IO;

namespace WorkPepTalk.Services;

/// <summary>
/// 程序自己所在的目录。
///
/// 为什么不直接用 AppContext.BaseDirectory：单文件发布如果开了
/// IncludeAllContentForSelfExtract，整个程序会被解到 %TEMP% 里运行，
/// 那时 BaseDirectory 指向的是临时目录 —— config.json、app.log、
/// WebView2 用户数据全都会掉进去，用户重启一次设置就没了。
/// 从 ProcessPath 取才是「exe 真正躺在哪」。
/// </summary>
public static class AppPaths
{
    public static string BaseDir { get; } = Resolve();

    private static string Resolve()
    {
        try
        {
            var p = Environment.ProcessPath;
            if (!string.IsNullOrEmpty(p))
            {
                var dir = Path.GetDirectoryName(p);
                if (!string.IsNullOrEmpty(dir)) return dir!;
            }
        }
        catch
        {
            /* 极少见：进程路径读不到就退回老办法 */
        }
        return AppContext.BaseDirectory;
    }
}
