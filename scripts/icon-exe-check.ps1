param(
    [string]$Exe = 'C:\Users\98201\WorkBuddy\spaces\2026_11_13_09-49-11\publish\WorkPepTalk.exe'
)
Add-Type -AssemblyName System.Drawing
$exe = $Exe
$ico = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
if ($null -eq $ico) { Write-Output 'NO ICON IN EXE'; exit 1 }
$bmp = $ico.ToBitmap()
Write-Output ("exe icon: {0}x{1}" -f $bmp.Width, $bmp.Height)
$out = 'C:\Users\98201\WorkBuddy\spaces\2026_11_13_09-49-11\assets\exe-icon-check.png'
$big = New-Object System.Drawing.Bitmap(160, 160)
$g = [System.Drawing.Graphics]::FromImage($big)
$g.Clear([System.Drawing.Color]::FromArgb(255, 245, 245, 245))
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.DrawImage($bmp, 0, 0, 160, 160)
$g.Dispose()
$big.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$big.Dispose(); $bmp.Dispose(); $ico.Dispose()
Write-Output $out
