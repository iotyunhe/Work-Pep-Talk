# 截全屏（缩放到 1800 宽），用来定位任务栏与托盘图标。
# 用法：powershell -File scripts/shot-screen.ps1
#
# 默认只截当前桌面，不碰任何进程 —— 之前它会先杀掉正在运行的挂件、
# 再起一个 Debug 实例截图、然后把实例也杀掉，结果是把用户桌面上真在用的
# 挂件给关了。要「重开一个干净实例再截」时显式加 -Launch。
param(
    [string]$Exe = 'C:\Users\98201\WorkBuddy\spaces\2026_11_13_09-49-11\src\WorkPepTalk\bin\Debug\net8.0-windows\WorkPepTalk.exe',
    [string]$Out = 'C:\Users\98201\WorkBuddy\spaces\2026_11_13_09-49-11\assets\screen-check.png',
    [int]$KeepMs = 0,
    [switch]$Launch
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

# 让本进程变成 DPI 感知，否则 Screen.Bounds 给的是缩放后的逻辑像素，
# 而 CopyFromScreen 走 BitBlt 吃物理像素 —— 两者一错位就只截到左上角一块。
if (-not ('Win32Dpi' -as [type])) {
    Add-Type -Namespace Win32 -Name Dpi -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetProcessDPIAware();
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern int GetDpiForSystem();
'@
}
[void][Win32.Dpi]::SetProcessDPIAware()

$p = $null
if ($Launch) {
    Get-Process WorkPepTalk -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 400
    $p = Start-Process -FilePath $Exe -PassThru
    Start-Sleep -Seconds 5
}

$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$scale = [Win32.Dpi]::GetDpiForSystem() / 96.0
Write-Output ("virtual screen (physical): {0},{1} {2}x{3}  dpi scale {4}" -f $vs.Left, $vs.Top, $vs.Width, $vs.Height, $scale)

$physW = $vs.Width
$physH = $vs.Height

foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
    Write-Output ("screen {0} primary={1} bounds={2} work={3}" -f $s.DeviceName, $s.Primary, $s.Bounds, $s.WorkingArea)
}

$shot = New-Object System.Drawing.Bitmap($physW, $physH)
$g = [System.Drawing.Graphics]::FromImage($shot)
$g.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size($physW, $physH)))
$g.Dispose()

$outScale = 1800.0 / $physW
if ($outScale -gt 1) { $outScale = 1 }
$w = [int]($physW * $outScale)
$h = [int]($physH * $outScale)
$small = New-Object System.Drawing.Bitmap($w, $h)
$sg = [System.Drawing.Graphics]::FromImage($small)
$sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$sg.DrawImage($shot, 0, 0, $w, $h)
$sg.Dispose()
$shot.Dispose()
$small.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$small.Dispose()

if ($KeepMs -gt 0) { Start-Sleep -Milliseconds $KeepMs }
if ($p) { $p | Stop-Process -Force -ErrorAction SilentlyContinue }
Write-Output ("saved: " + $Out)
