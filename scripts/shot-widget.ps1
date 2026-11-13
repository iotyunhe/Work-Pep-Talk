# 截「挂件本体」这一块（1:1 物理像素），用来核对边缘、圆角、进度条这类像素级问题。
# 用法：powershell -File scripts/shot-widget.ps1 [-Out xxx.png]
#
# 不用全屏再缩 —— 全屏缩到 1800 宽后挂件只剩三百来像素，细边看不清。
# 也不用 Process.MainWindowHandle：这个窗口 WindowStyle=None 且不进任务栏，
# 主窗口句柄给的是 0，只能自己按进程 ID 枚举可见顶层窗口。
param(
    [string]$Out = 'C:\Users\98201\WorkBuddy\spaces\2026_11_13_09-49-11\assets\widget-now.png',
    # 挂件没开置顶时会被别的窗口盖住，CopyFromScreen 截到的就是上层窗口。
    # 加 -Activate 先把挂件提到前台再截。
    [switch]$Activate
)

Add-Type -AssemblyName System.Drawing
Add-Type -Namespace Win32 -Name W -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr hWnd, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetProcessDPIAware();
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool EnumWindows(EnumProc cb, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint pid);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsWindowVisible(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT r);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool ShowWindow(System.IntPtr hWnd, int cmd);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool PrintWindow(System.IntPtr hWnd, System.IntPtr hdc, uint flags);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr WindowFromPoint(POINT pt);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern int GetClassName(System.IntPtr hWnd, System.Text.StringBuilder s, int n);
public struct POINT { public int X, Y; }
public struct RECT { public int Left, Top, Right, Bottom; }
'@

[void][Win32.W]::SetProcessDPIAware()

$procIds = @(Get-Process -Name WorkPepTalk -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
if ($procIds.Count -eq 0) { Write-Output '挂件没在运行'; exit 1 }

$script:hit = [IntPtr]::Zero
$cb = [Win32.W+EnumProc]{
    param($h, $l)
    $owner = 0
    [void][Win32.W]::GetWindowThreadProcessId($h, [ref]$owner)
    if ($procIds -contains $owner -and [Win32.W]::IsWindowVisible($h)) {
        $r = New-Object Win32.W+RECT
        [void][Win32.W]::GetWindowRect($h, [ref]$r)
        if (($r.Right - $r.Left) -gt 20 -and ($r.Bottom - $r.Top) -gt 20) {
            $script:hit = $h
            return $false
        }
    }
    return $true
}
[void][Win32.W]::EnumWindows($cb, [IntPtr]::Zero)

if ($script:hit -eq [IntPtr]::Zero) { Write-Output '找到进程但没有可见窗口'; exit 1 }

$r = New-Object Win32.W+RECT
[void][Win32.W]::GetWindowRect($script:hit, [ref]$r)
$w = $r.Right - $r.Left
$h = $r.Bottom - $r.Top
Write-Output ("窗口 {0},{1} {2}x{3}" -f $r.Left, $r.Top, $w, $h)

if ($Activate) {
    [void][Win32.W]::ShowWindow($script:hit, 5)      # SW_SHOW
    [void][Win32.W]::SetForegroundWindow($script:hit)
    Start-Sleep -Milliseconds 500
}

# 诊断：中心点上到底是哪个窗口。挂件没开置顶时这一行会打出别的类名 ——
# 那就说明下面截到的是上层窗口，不是挂件。
$pt = New-Object Win32.W+POINT
$pt.X = [int](($r.Left + $r.Right) / 2)
$pt.Y = [int](($r.Top + $r.Bottom) / 2)
$top = [Win32.W]::WindowFromPoint($pt)
$sb = New-Object System.Text.StringBuilder 256
[void][Win32.W]::GetClassName($top, $sb, 256)
Write-Output ("中心点 ({0},{1}) 上是 {2}  hwnd={3} 挂件={4}" -f $pt.X, $pt.Y, $sb.ToString(), $top, $script:hit)

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
# 先用 PrintWindow 让窗口自己渲染一份：被遮挡 / 不置顶时也拿得到自己的画，
# 不受上层窗口影响。PW_RENDERFULLCONTENT = 2，WebView2 这类 GPU 合成的
# 子窗口只有这个标志能抓到内容。
$hdc = $g.GetHdc()
$ok = [Win32.W]::PrintWindow($script:hit, $hdc, 2)
$g.ReleaseHdc($hdc)
if (-not $ok) {
    Write-Output 'PrintWindow 失败，退回屏幕截取'
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $h)))
}
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ('saved: ' + $Out)
