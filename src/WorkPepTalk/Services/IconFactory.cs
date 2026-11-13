using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;

namespace WorkPepTalk.Services;

/// <summary>
/// 托盘与窗口图标。
///
/// 图标本体是 assets/app.ico（scripts/make-icon.ps1 生成，9 档尺寸），
/// 以 WPF 资源形式打进程序集 —— 绿色版因此不需要任何外部图片文件。
/// 万一资源缺失，退回用 GDI+ 现画一张，绝不出现白方块图标。
/// </summary>
public static class IconFactory
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    /* Icon(Stream) 要求流在整个图标生命周期内保持可读，所以缓存住不放 */
    private static readonly MemoryStream? IcoBytes = LoadIcoBytes();

    private static MemoryStream? LoadIcoBytes()
    {
        try
        {
            var res = System.Windows.Application.GetResourceStream(
                new Uri("pack://application:,,,/Assets/app.ico", UriKind.Absolute));
            if (res?.Stream is null) return null;

            var ms = new MemoryStream();
            using (res.Stream) res.Stream.CopyTo(ms);
            ms.Position = 0;
            return ms;
        }
        catch
        {
            return null;
        }
    }

    public static Icon Create(int size = 32)
    {
        if (IcoBytes is not null)
        {
            try
            {
                /* 精确取这一档：让 .ico 自己提供 16/32 的清晰像素，
                   比交给 Windows 从 256 缩下来的糊图强 */
                using var picked = new Icon(IcoBytes, size, size);
                var copy = (Icon)picked.Clone();
                IcoBytes.Position = 0;
                Log.Info($"托盘图标：取 app.ico 的 {size}px 档");
                return copy;
            }
            catch (Exception ex)
            {
                IcoBytes.Position = 0;
                Log.Warn("从 app.ico 取图失败，改用兜底绘制：" + ex.Message);
            }
        }
        else
        {
            Log.Warn("程序集里没有 app.ico 资源，改用兜底绘制");
        }
        return DrawFallback(size);
    }

    /// <summary>没有 .ico 时现画的团子脸（与挂件里的内置形象同一套笔画）。</summary>
    private static Icon DrawFallback(int size)
    {
        using var bmp = new Bitmap(size, size);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);

            float s = size;
            var paper = ColorTranslator.FromHtml("#FBFAF7");
            var ink = ColorTranslator.FromHtml("#2A2620");
            var skin = ColorTranslator.FromHtml("#F0DBC1");

            using (var b = new SolidBrush(skin))
                g.FillEllipse(b, s * .03f, s * .06f, s * .94f, s * .88f);
            using (var p = new Pen(paper, Math.Max(1f, s * .06f)))
                g.DrawEllipse(p, s * .03f, s * .06f, s * .94f, s * .88f);
            using (var p = new Pen(ink, Math.Max(1f, s * .045f)))
                g.DrawEllipse(p, s * .06f, s * .09f, s * .88f, s * .82f);

            using (var b = new SolidBrush(ink))
            {
                float eye = Math.Max(1.6f, s * .085f);
                g.FillEllipse(b, s * .32f - eye / 2, s * .40f - eye / 2, eye, eye);
                g.FillEllipse(b, s * .68f - eye / 2, s * .40f - eye / 2, eye, eye);
            }

            using (var p = new Pen(ink, Math.Max(1.2f, s * .055f)))
            {
                p.StartCap = LineCap.Round;
                p.EndCap = LineCap.Round;
                g.DrawArc(p, s * .36f, s * .46f, s * .28f, s * .24f, 20, 140);
            }
        }

        var handle = bmp.GetHicon();
        try
        {
            using var tmp = Icon.FromHandle(handle);
            return (Icon)tmp.Clone();   // 复制一份，脱离 handle 生命周期
        }
        finally
        {
            DestroyIcon(handle);        // 原始 handle 必须显式释放，否则泄漏 GDI 对象
        }
    }
}
