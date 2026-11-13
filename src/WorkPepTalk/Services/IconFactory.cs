using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace WorkPepTalk.Services;

/// <summary>
/// 托盘与窗口图标。不依赖外部 .ico 文件 —— 直接按挂件的团子脸画一个，
/// 这样绿色版就是一个干净的文件夹，不会出现「图标丢了变白方块」。
/// </summary>
public static class IconFactory
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    public static Icon Create(int size = 32)
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

            // 圆底
            using (var b = new SolidBrush(skin))
                g.FillEllipse(b, s * .03f, s * .06f, s * .94f, s * .88f);
            using (var p = new Pen(paper, Math.Max(1f, s * .06f)))
                g.DrawEllipse(p, s * .03f, s * .06f, s * .94f, s * .88f);
            using (var p = new Pen(ink, Math.Max(1f, s * .045f)))
                g.DrawEllipse(p, s * .06f, s * .09f, s * .88f, s * .82f);

            // 眼睛
            using (var b = new SolidBrush(ink))
            {
                float eye = Math.Max(1.6f, s * .085f);
                g.FillEllipse(b, s * .32f - eye / 2, s * .40f - eye / 2, eye, eye);
                g.FillEllipse(b, s * .68f - eye / 2, s * .40f - eye / 2, eye, eye);
            }

            // 嘴
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
