# 上班鼓励器 · 绿色版打包
#
#   pwsh scripts/publish.ps1              # 默认自包含单文件（约 65MB，免安装）
#   pwsh scripts/publish.ps1 -Framework   # 框架依赖（约 5MB，需目标机有 .NET 8）
#
# 产物在 publish/，整个文件夹拷走即可运行。

param(
    [switch]$Framework
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$proj = Join-Path $root 'src/WorkPepTalk/WorkPepTalk.csproj'
$out  = Join-Path $root 'publish'

if (Test-Path $out) {
    Remove-Item $out -Recurse -Force
}

$dotnetArgs = @(
    'publish', $proj,
    '-c', 'Release',
    '-o', $out,
    '--nologo'
)

if (-not $Framework) {
    $dotnetArgs += @(
        '-r', 'win-x64',
        '--self-contained', 'true',
        '-p:PublishSingleFile=true',
        # WebView2 的 WebView2Loader.dll 是原生库，必须允许随单文件一起解压
        '-p:IncludeNativeLibrariesForSelfExtract=true',
        '-p:EnableCompressionInSingleFile=true'
    )
}

Write-Host "开始打包..." -ForegroundColor Cyan
& dotnet @dotnetArgs
if ($LASTEXITCODE -ne 0) { throw "打包失败，退出码 $LASTEXITCODE" }

# 清掉自包含发布里那些用不上的调试符号
Get-ChildItem $out -Filter *.pdb -ErrorAction SilentlyContinue | Remove-Item -Force

# 附一份空的默认配置：首次运行时程序自己会生成，这里放一份便于用户直接改
$cfg = Join-Path $out 'config.json'
if (-not (Test-Path $cfg)) {
    @'
{
  "version": 1,
  "pay": { "mode": "monthly", "value": 8000, "daysPerMonth": 22, "hoursPerDay": 8 },
  "schedule": { "start": "09:00", "end": "18:00", "lunchStart": "12:00", "lunchEnd": "13:00", "excludeLunch": true },
  "look": { "theme": "A", "background": "white", "bgImage": null, "avatar": "builtin", "avatarFiles": [] },
  "window": { "x": null, "y": null, "screen": null, "collapsed": false },
  "behaviour": { "alwaysOnTop": true, "clickThrough": false, "autoStart": true }
}
'@ | Set-Content -Path $cfg -Encoding ascii
}

$exe = Join-Path $out 'WorkPepTalk.exe'
if (-not (Test-Path $exe)) { throw "没有生成 WorkPepTalk.exe，请检查打包日志" }

$size = [math]::Round((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host ""
Write-Host "完成：$out" -ForegroundColor Green
Write-Host "总大小：$size MB" -ForegroundColor Green
Write-Host "运行：$exe" -ForegroundColor Green
