# 验证手写托盘的图标链：app.ico 里的 32px 档 → CreateIconFromResourceEx → HICON → 位图。
# 托盘图标用的就是这条路，这里把它单独跑一遍并落成 PNG 供肉眼确认。
param(
    [string]$Ico,
    [string]$Out,
    [int]$Size = 32
)

$repo = Split-Path $PSScriptRoot -Parent
if (-not $Ico) { $Ico = Join-Path $repo 'assets\app.ico' }
if (-not $Out) { $Out = Join-Path $repo 'assets\hicon-check.png' }

Add-Type -AssemblyName System.Drawing

if (-not ('Win32Icon' -as [type])) {
    Add-Type -Namespace Win32 -Name Icon -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
public static extern System.IntPtr CreateIconFromResourceEx(
    byte[] presbits, int dwResSize, bool fIcon, int dwVer, int cxDesired, int cyDesired, int flags);
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
public static extern bool DestroyIcon(System.IntPtr hIcon);
'@
}

$icoBytes = [System.IO.File]::ReadAllBytes($Ico)
if ($icoBytes.Length -lt 6) { throw 'ico too small' }
if ([BitConverter]::ToUInt16($icoBytes, 0) -ne 0 -or [BitConverter]::ToUInt16($icoBytes, 2) -ne 1) {
    throw 'not an icon'
}

$count = [BitConverter]::ToUInt16($icoBytes, 4)
$best = -1; $bestScore = [int]::MaxValue; $bestW = 0
for ($i = 0; $i -lt $count; $i++) {
    $e = 6 + $i * 16
    $w = if ($icoBytes[$e] -eq 0) { 256 } else { [int]$icoBytes[$e] }
    $score = [math]::Abs($w - $Size)
    if ($score -lt $bestScore) { $bestScore = $score; $best = $i; $bestW = $w }
}

$entry = 6 + $best * 16
$len = [BitConverter]::ToInt32($icoBytes, $entry + 8)
$off = [BitConverter]::ToInt32($icoBytes, $entry + 12)
$chunk = New-Object byte[] $len
[Array]::Copy($icoBytes, $off, $chunk, 0, $len)

$h = [Win32.Icon]::CreateIconFromResourceEx($chunk, $chunk.Length, $true, 0x00030000, $Size, $Size, 0)
Write-Output ("picked {0}px entry, chunk {1} bytes, HICON={2}" -f $bestW, $len, $h)
if ($h -eq [IntPtr]::Zero) { throw ('CreateIconFromResourceEx failed: ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }

$icon = [System.Drawing.Icon]::FromHandle($h)
$bmp = $icon.ToBitmap()

# 统计不透明像素，确认不是一张全透明的空图
$opaque = 0
for ($y = 0; $y -lt $bmp.Height; $y += 2) {
    for ($x = 0; $x -lt $bmp.Width; $x += 2) {
        if ($bmp.GetPixel($x, $y).A -gt 200) { $opaque++ }
    }
}
$sampled = [int](($bmp.Width / 2) * ($bmp.Height / 2))
Write-Output ("size {0}x{1}, opaque sampled {2}/{3}" -f $bmp.Width, $bmp.Height, $opaque, $sampled)

$zoom = New-Object System.Drawing.Bitmap(($Size * 6), ($Size * 6))
$g = [System.Drawing.Graphics]::FromImage($zoom)
$g.Clear([System.Drawing.Color]::FromArgb(255, 245, 245, 245))
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.DrawImage($bmp, 0, 0, ($Size * 6), ($Size * 6))
$g.Dispose()
$zoom.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$zoom.Dispose(); $bmp.Dispose(); $icon.Dispose()
[void][Win32.Icon]::DestroyIcon($h)
Write-Output $Out
