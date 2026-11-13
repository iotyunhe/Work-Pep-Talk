$T = 'C:\Users\98201\AppData\Local\Temp\wpt-v2'
$src = 'C:\Users\98201\WorkBuddy\spaces\2026_11_13_09-49-11\publish\WorkPepTalk.exe'

Get-Process WorkPepTalk -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 800
Remove-Item $T -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $T | Out-Null
Copy-Item $src (Join-Path $T 'WorkPepTalk.exe')

Write-Output '=== 第 1 轮：干净目录，无 config.json ==='
$p = Start-Process -FilePath (Join-Path $T 'WorkPepTalk.exe') -WorkingDirectory $T -PassThru
Start-Sleep -Seconds 8
$log1 = Join-Path $T 'app.log'
if (Test-Path $log1) {
  Get-Content $log1 -Encoding UTF8 | Select-String -Pattern '设窗|页面加载|内嵌'
}
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Output ''
Write-Output '=== 第 2 轮：填入 15000 后重启 ==='
$json = @'
{
  "version": 1,
  "setup": { "done": true },
  "pay": { "mode": "monthly", "value": 15000, "daysPerMonth": 22, "hoursPerDay": 8 },
  "schedule": { "start": "09:00", "end": "18:00", "lunchStart": "12:00", "lunchEnd": "13:00", "excludeLunch": true },
  "look": { "theme": "A", "background": "white", "bgImage": null, "avatar": "builtin", "avatarFiles": [] },
  "window": { "x": null, "y": null, "screen": null, "collapsed": false },
  "behaviour": { "alwaysOnTop": true, "clickThrough": false, "autoStart": false }
}
'@
[System.IO.File]::WriteAllText((Join-Path $T 'config.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
Remove-Item $log1 -Force -ErrorAction SilentlyContinue

$p2 = Start-Process -FilePath (Join-Path $T 'WorkPepTalk.exe') -WorkingDirectory $T -PassThru
Start-Sleep -Seconds 8
if (Test-Path $log1) {
  Get-Content $log1 -Encoding UTF8 | Select-String -Pattern '设窗|页面加载'
}
Write-Output ''
Write-Output '=== 目录内容 ==='
Get-ChildItem $T | Select-Object Name, Length | Format-Table -AutoSize
Stop-Process -Id $p2.Id -Force -ErrorAction SilentlyContinue
