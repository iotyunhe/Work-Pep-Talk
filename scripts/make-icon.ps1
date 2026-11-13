# Build the app icon (assets/app.ico) without any external tooling.
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-icon.ps1
#
# Design: dark ink rounded square, warm amber coin behind a cream dumpling face --
# the same face the widget draws inline, so icon and content read as one product.
# Every size is drawn at 4x and downsampled, so 16/20/24px stay crisp instead of
# turning into mush. Pure ASCII on purpose: PowerShell 5.1 parses .ps1 as ANSI.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$dir  = Join-Path $root 'assets'
$null = New-Item -ItemType Directory -Force -Path $dir

$ink     = [System.Drawing.ColorTranslator]::FromHtml('#241F19')
$cream   = [System.Drawing.ColorTranslator]::FromHtml('#F2DEC4')
$amber   = [System.Drawing.ColorTranslator]::FromHtml('#E39B3C')
$amber2  = [System.Drawing.ColorTranslator]::FromHtml('#F6C877')
$bgTop   = [System.Drawing.ColorTranslator]::FromHtml('#3E372C')
$bgBot   = [System.Drawing.ColorTranslator]::FromHtml('#1B1814')

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc(($x), ($y), $d, $d, 180, 90)
    $p.AddArc(($x + $w - $d), ($y), $d, $d, 270, 90)
    $p.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
    $p.AddArc(($x), ($y + $h - $d), $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

# size = final pixel size; $simple = drop the details that turn to noise below 32px
function New-IconTile([int]$size, [bool]$simple) {
    $ss = 4
    $S  = [single]($size * $ss)
    $tiny = ($size -lt 24)      # 16/20: only the silhouette and the face survive

    $bmp = New-Object System.Drawing.Bitmap($S, $S, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    # --- plate: rounded square with a soft top-to-bottom dark gradient
    $pad = [single]($S * 0.035)
    $side = $S - $pad * 2
    $plate = New-RoundedPath $pad $pad $side $side ([single]($S * 0.225))
    $rect  = New-Object System.Drawing.RectangleF(0, 0, $S, $S)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $bgTop, $bgBot, 90.0)
    $g.FillPath($brush, $plate)
    $brush.Dispose()

    $cx = [single]($S * 0.5)
    $faceR = [single]($S * 0.300)
    if ($tiny) { $faceR = [single]($S * 0.315) }
    $fy = [single]($S * 0.5)

    # --- amber ring peeking out from behind the face (a coin edge, not a shadow):
    #     concentric on purpose, an off-centre one only reads as dirt at 16px
    if (-not $tiny) {
        $ringR = $faceR + [single]($S * 0.030)
        $cg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
            (New-Object System.Drawing.RectangleF(0, ($fy - $ringR), $S, ($ringR * 2))), $amber2, $amber, 90.0)
        $g.FillEllipse($cg, ($cx - $ringR), ($fy - $ringR), ($ringR * 2), ($ringR * 2))
        $cg.Dispose()
    }

    # --- face
    $g.FillEllipse((New-Object System.Drawing.SolidBrush($cream)),
        ($cx - $faceR), ($fy - $faceR), ($faceR * 2), ($faceR * 2))

    # outline: at 16px the cream-on-dark edge already defines the shape, a 1px
    # dark ring on top of it just eats the face
    if (-not $tiny) {
        $penW = [single]($S * 0.030)
        if ($simple) { $penW = [single]($S * 0.042) }
        $pen = New-Object System.Drawing.Pen($ink, $penW)
        $g.DrawEllipse($pen, ($cx - $faceR), ($fy - $faceR), ($faceR * 2), ($faceR * 2))
        $pen.Dispose()
    }

    # --- eyes
    $eyeR = [single]($S * 0.048)
    if ($simple) { $eyeR = [single]($S * 0.056) }
    if ($tiny)   { $eyeR = [single]($S * 0.062) }
    $eyeDx = [single]($S * 0.100)
    if ($tiny) { $eyeDx = [single]($S * 0.092) }
    $eyeY  = [single]($fy - $S * 0.055)
    $ib = New-Object System.Drawing.SolidBrush($ink)
    $g.FillEllipse($ib, ($cx - $eyeDx - $eyeR), ($eyeY - $eyeR), ($eyeR * 2), ($eyeR * 2))
    $g.FillEllipse($ib, ($cx + $eyeDx - $eyeR), ($eyeY - $eyeR), ($eyeR * 2), ($eyeR * 2))
    $ib.Dispose()

    # --- smile
    $sw = [single]($S * 0.050)
    if ($simple) { $sw = [single]($S * 0.062) }
    if ($tiny)   { $sw = [single]($S * 0.072) }
    $sm = New-Object System.Drawing.Pen($ink, $sw)
    $sm.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $sm.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $mw = [single]($S * 0.190)
    $mh = [single]($S * 0.150)
    if ($tiny) { $mw = [single]($S * 0.215); $mh = [single]($S * 0.170) }
    $g.DrawArc($sm, ($cx - $mw / 2), ($fy - $S * 0.010), $mw, $mh, 25.0, 130.0)
    $sm.Dispose()

    # --- blush, only where there is room for it
    if (-not $simple -and -not $tiny) {
        $bl = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(58, $amber))
        $br = [single]($S * 0.050)
        $bx = [single]($S * 0.150)
        $by = [single]($fy + $S * 0.070)
        $g.FillEllipse($bl, ($cx - $bx - $br), ($by - $br), ($br * 2), ($br * 2))
        $g.FillEllipse($bl, ($cx + $bx - $br), ($by - $br), ($br * 2), ($br * 2))
        $bl.Dispose()
    }

    $plate.Dispose()
    $g.Dispose()

    if ($ss -eq 1) { return ,$bmp }

    $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $og = [System.Drawing.Graphics]::FromImage($out)
    $og.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $og.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $og.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $og.DrawImage($bmp, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
    $og.Dispose()
    $bmp.Dispose()
    return ,$out
}

# 32bpp image as an ICO DIB chunk: BITMAPINFOHEADER + bottom-up BGRA + AND mask
function Get-DibChunk([System.Drawing.Bitmap]$bmp) {
    $w = $bmp.Width
    $h = $bmp.Height
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = $data.Stride
    $raw = New-Object byte[] ($stride * $h)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $raw, 0, $raw.Length)
    $bmp.UnlockBits($data)

    $xorLen = $w * $h * 4
    $maskRow = [math]::Floor(($w + 31) / 32) * 4
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)

    $bw.Write([int]40)          # biSize
    $bw.Write([int]$w)          # biWidth
    $bw.Write([int]($h * 2))    # biHeight: XOR + AND
    $bw.Write([int16]1)         # biPlanes
    $bw.Write([int16]32)        # biBitCount
    $bw.Write([int]0)           # biCompression = BI_RGB
    $bw.Write([int]$xorLen)
    $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0)

    for ($y = $h - 1; $y -ge 0; $y--) {
        $bw.Write($raw, ($y * $stride), ($w * 4))   # BGRA, bottom-up
    }
    $zeros = New-Object byte[] ($maskRow * $h)      # alpha drives it; mask stays 0
    $bw.Write($zeros, 0, $zeros.Length)

    $bw.Flush()
    $outB = $ms.ToArray()
    $bw.Dispose(); $ms.Dispose()
    return ,$outB
}

function Get-PngChunk([System.Drawing.Bitmap]$bmp) {
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $b = $ms.ToArray()
    $ms.Dispose()
    return ,$b
}

$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$chunks = @()
foreach ($s in $sizes) {
    $simple = ($s -lt 32)
    $bmp = New-IconTile $s $simple
    # 256 must be PNG (a raw 256x256 DIB blows the file up to 300KB+).
    # Everything below stays DIB on purpose: GDI+'s Icon.ToBitmap() throws on
    # PNG-compressed entries, and NotifyIcon/WPF both go through GDI+.
    if ($s -ge 256) { $chunks += ,@($s, $true, (Get-PngChunk $bmp)) }
    else            { $chunks += ,@($s, $false, (Get-DibChunk $bmp)) }
    if ($s -eq 256) { $bmp.Save((Join-Path $dir 'icon-256.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
    if ($s -eq 64)  { $bmp.Save((Join-Path $dir 'icon-64.png'),  [System.Drawing.Imaging.ImageFormat]::Png) }
    $bmp.Dispose()
}

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([int16]0); $bw.Write([int16]1); $bw.Write([int16]$chunks.Count)

$offset = 6 + 16 * $chunks.Count
foreach ($c in $chunks) {
    $dim = if ($c[0] -ge 256) { 0 } else { $c[0] }
    $bw.Write([byte]$dim); $bw.Write([byte]$dim)
    $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([int16]1); $bw.Write([int16]32)
    $bw.Write([int]$c[2].Length)
    $bw.Write([int]$offset)
    $offset += $c[2].Length
}
foreach ($c in $chunks) { $bw.Write($c[2], 0, $c[2].Length) }
$bw.Flush()
$icoPath = Join-Path $dir 'app.ico'
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$bw.Dispose(); $ms.Dispose()

Write-Host ("icon: {0} ({1:N1} KB, {2} sizes)" -f $icoPath, ((Get-Item $icoPath).Length / 1KB), $sizes.Count)
