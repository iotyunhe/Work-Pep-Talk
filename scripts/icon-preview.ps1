Add-Type -AssemblyName System.Drawing
$root = 'C:\Users\98201\WorkBuddy\spaces\2026_11_13_09-49-11'
$icoPath = Join-Path $root 'assets\app.ico'

$sheetW = 1120; $sheetH = 360
$bmp = New-Object System.Drawing.Bitmap($sheetW, $sheetH)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(255, 250, 249, 246))

# left: real pixel sizes, zoomed with nearest neighbour so we see the actual pixels
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$x = 16
foreach ($s in @(16, 20, 24, 32, 48, 64)) {
    $i = New-Object System.Drawing.Icon($icoPath, $s, $s)
    $zoom = [int]([math]::Floor(96.0 / $s))
    $draw = $s * $zoom
    $g.DrawImage($i.ToBitmap(), $x, 60, $draw, $draw)
    $f = New-Object System.Drawing.Font('Segoe UI', 11)
    $g.DrawString(("{0}px x{1}" -f $s, $zoom), $f, [System.Drawing.Brushes]::DimGray, $x, 200)
    $f.Dispose()
    $i.Dispose()
    $x += 112
}

# right: the 256 source, as it appears in Explorer's extra-large view
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$big = [System.Drawing.Image]::FromFile((Join-Path $root 'assets\icon-256.png'))
$g.DrawImage($big, 760, 40, 300, 300)
$big.Dispose()
$g.Dispose()
$bmp.Save((Join-Path $root 'assets\preview-sheet.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output 'ok'
