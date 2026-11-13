using System.IO;

namespace WorkPepTalk.Services;

/// <summary>
/// 极简日志。挂件是常驻进程，出问题用户看不到控制台，
/// 所以落一份文本到 exe 同级，出岔子时有据可查。
/// 超过 256KB 自动截断，不让它无限长。
/// </summary>
public static class Log
{
    private static readonly object Gate = new();
    private static readonly string FilePath =
        System.IO.Path.Combine(AppContext.BaseDirectory, "app.log");

    private const long MaxBytes = 256 * 1024;

    /* 带 BOM 的 UTF-8：PowerShell 5.1 的 Get-Content 默认按 ANSI 读，
       没 BOM 的中文日志会变成乱码，排查时反而添乱。 */
    private static readonly System.Text.UTF8Encoding Enc = new(encoderShouldEmitUTF8Identifier: true);

    public static void Info(string msg) => Write("INFO", msg);
    public static void Warn(string msg) => Write("WARN", msg);
    public static void Error(string msg) => Write("ERR ", msg);

    private static void Write(string level, string msg)
    {
        try
        {
            lock (Gate)
            {
                var fi = new FileInfo(FilePath);
                if (fi.Exists && fi.Length > MaxBytes)
                {
                    // 简单滚动：保留最近一半
                    var text = File.ReadAllText(FilePath);
                    File.WriteAllText(FilePath, text[^(int)(MaxBytes / 2)..], Enc);
                }

                File.AppendAllText(FilePath,
                    $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} [{level}] {msg}{Environment.NewLine}", Enc);
            }
        }
        catch
        {
            // 日志写不进去绝不能反过来把应用搞挂
        }
    }
}
