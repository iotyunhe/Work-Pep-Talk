using System.IO;
using System.Runtime.InteropServices;
using WorkPepTalk.Interop;

namespace WorkPepTalk.Services;

/// <summary>
/// 图标来源。唯一真相是 assets/app.ico（scripts/make-icon.ps1 生成，9 档尺寸），
/// 以 WPF 资源形式编译进程序集 —— 发布出去只有一个 exe，不依赖任何外部图片。
///
/// 这里只做两件事：按尺寸从 .ico 里挑一档造出 Win32 HICON（托盘要的就是它），
/// 以及把整份字节交出去给窗口图标用。全程不碰 System.Drawing，
/// 这样自包含发布就不必背上 System.Drawing.Common。
/// </summary>
public static class IconFactory
{
    private static readonly byte[]? IcoBytes = LoadIcoBytes();

    /// <summary>整份 .ico 字节（窗口图标用 BitmapFrame 解码）。可能为 null。</summary>
    public static byte[]? IcoData => IcoBytes;

    private static byte[]? LoadIcoBytes()
    {
        try
        {
            var res = System.Windows.Application.GetResourceStream(
                new Uri("pack://application:,,,/Assets/app.ico", UriKind.Absolute));
            if (res?.Stream is null) return null;

            using var ms = new MemoryStream();
            using (res.Stream) res.Stream.CopyTo(ms);
            return ms.ToArray();
        }
        catch (Exception ex)
        {
            Log.Error("读取 app.ico 资源失败：" + ex.Message);
            return null;
        }
    }

    /// <summary>
    /// 取最贴近 size 的一档做成 HICON。调用方负责在退出时 DestroyIcon。
    /// 失败返回 IntPtr.Zero —— 此时通知区没有图标，但右键窗口仍能打开托盘菜单。
    /// </summary>
    public static IntPtr CreateHIcon(int size = 32)
    {
        if (IcoBytes is null)
        {
            Log.Error("程序集里没有 app.ico 资源，托盘将没有图标");
            return IntPtr.Zero;
        }

        try
        {
            var chunk = ExtractChunk(IcoBytes, size, out var picked);
            if (chunk is null)
            {
                Log.Error("app.ico 结构异常，取不出 " + size + "px 那一档");
                return IntPtr.Zero;
            }

            var hIcon = Shell.IconFromResource(chunk, size);
            if (hIcon == IntPtr.Zero)
            {
                Log.Error("CreateIconFromResourceEx 失败，错误码 " + Marshal.GetLastWin32Error());
                return IntPtr.Zero;
            }

            Log.Info($"托盘图标：取 app.ico {picked}px 档，按 {size}px 渲染");
            return hIcon;
        }
        catch (Exception ex)
        {
            Log.Error("生成 HICON 失败：" + ex.Message);
            return IntPtr.Zero;
        }
    }

    /// <summary>
    /// 从 .ico 里截出「宽度最接近 size」那一档的原始数据。
    /// ICO 布局：ICONDIR(6B) + N×ICONDIRENTRY(16B) + 各档图像数据；
    /// 每档数据可以直接喂给 CreateIconFromResourceEx（PNG 档 Vista+ 也认）。
    /// </summary>
    private static byte[]? ExtractChunk(byte[] ico, int size, out int pickedSize)
    {
        pickedSize = size;
        if (ico.Length < 6) return null;

        /* ICONDIR：reserved=0，type=1（图标）/2（光标） */
        if (BitConverter.ToUInt16(ico, 0) != 0 || BitConverter.ToUInt16(ico, 2) != 1) return null;

        var count = BitConverter.ToUInt16(ico, 4);
        if (count == 0) return null;

        var bestIndex = -1;
        var bestScore = int.MaxValue;
        var bestWidth = 0;

        for (var i = 0; i < count; i++)
        {
            var entry = 6 + i * 16;
            if (entry + 16 > ico.Length) break;

            /* 宽高各占 1 字节，0 表示 256 */
            var w = ico[entry] == 0 ? 256 : ico[entry];
            var score = Math.Abs(w - size);
            if (score >= bestScore) continue;

            bestScore = score;
            bestIndex = i;
            bestWidth = w;
        }

        if (bestIndex < 0) return null;

        var e = 6 + bestIndex * 16;
        var bytesInRes = BitConverter.ToInt32(ico, e + 8);
        var offset = BitConverter.ToInt32(ico, e + 12);
        if (bytesInRes <= 0 || offset <= 0 || offset + bytesInRes > ico.Length) return null;

        pickedSize = bestWidth;
        var chunk = new byte[bytesInRes];
        Array.Copy(ico, offset, chunk, 0, bytesInRes);
        return chunk;
    }
}
