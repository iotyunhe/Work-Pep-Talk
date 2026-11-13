# 上班鼓励器 · 打包（单文件）
#
#   powershell scripts/publish.ps1              # 自包含单文件：一个 exe，目标机什么都不用装
#   powershell scripts/publish.ps1 -Framework   # 框架依赖单文件：约 2MB，但目标机要有 .NET 8 桌面运行时
#
# 产物只有 publish/WorkPepTalk.exe 一个文件。界面（wwwroot）已经嵌在程序集里，
# 所以不需要旁边的目录 —— 直接把 exe 发给别人双击即可。

param(
    [switch]$Framework
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$proj = Join-Path $root 'src/WorkPepTalk/WorkPepTalk.csproj'
$out  = Join-Path $root 'publish'

# 用户的真实配置就住在 publish/config.json 里，而下面整个目录要被删掉重建。
# 不先备份的话，每打一次包用户就得重新设置一遍（月薪、背景、窗口位置全丢）。
$cfgPath = Join-Path $out 'config.json'
$cfgBak = Join-Path ([IO.Path]::GetTempPath()) 'wpt-config-backup.json'
$hadCfg = Test-Path $cfgPath
if ($hadCfg) { Copy-Item $cfgPath $cfgBak -Force }

if (Test-Path $out) {
    Remove-Item $out -Recurse -Force
}

# PublishSingleFile 要求有 RID；win-x64 覆盖绝大多数目标机
$dotnetArgs = @(
    'publish', $proj,
    '-c', 'Release',
    '-r', 'win-x64',
    '-o', $out,
    '--nologo',
    '-p:PublishSingleFile=true',
    # WebView2Loader.dll 是原生库，单文件模式下必须允许自解压
    '-p:IncludeNativeLibrariesForSelfExtract=true'
    # 注意：不要加 IncludeAllContentForSelfExtract。
    # 那个开关会把整个程序解到 %TEMP% 里运行，导致 exe 旁边的配置和日志
    # 全都跑到临时目录去，用户重启一次设置就丢了。
)

if ($Framework) {
    $dotnetArgs += @('--self-contained', 'false')
} else {
    $dotnetArgs += @('--self-contained', 'true', '-p:EnableCompressionInSingleFile=true')
}

Write-Host "开始打包..." -ForegroundColor Cyan
& dotnet @dotnetArgs
if ($LASTEXITCODE -ne 0) { throw "打包失败，退出码 $LASTEXITCODE" }

# 调试符号和 XML 注释对运行没用，留着只会让目录看起来像开发产物。
# 注意 -Include 必须配合 -Recurse 才生效，这里用 -Filter 逐个取，避免再漏。
$junk = @()
$junk += Get-ChildItem -Path $out -Filter *.pdb -File -ErrorAction SilentlyContinue
$junk += Get-ChildItem -Path $out -Filter *.xml -File -ErrorAction SilentlyContinue
if ($junk.Count -gt 0) {
    # 用 LiteralPath 逐个删：管道给 Remove-Item 时，某些 PSObject 包装会绑定失败
    foreach ($f in $junk) { Remove-Item -LiteralPath $f.FullName -Force }
}

$exe = Join-Path $out 'WorkPepTalk.exe'
if (-not (Test-Path $exe)) { throw "没有生成 WorkPepTalk.exe，请检查打包日志" }

# 单文件的验收标准就是「目录里只有它」
$files = Get-ChildItem $out -Recurse -File
if ($files.Count -ne 1) {
    Write-Host "警告：产物里还有 $($files.Count) 个文件，不是纯单文件：" -ForegroundColor Yellow
    $files | ForEach-Object { Write-Host ("  " + $_.FullName.Substring($out.Length + 1)) }
}

# 把用户的配置放回去。放在「单文件数量检查」之后，免得它被算成多余文件。
if ($hadCfg -and (Test-Path $cfgBak)) {
    Copy-Item $cfgBak $cfgPath -Force
    Remove-Item $cfgBak -Force
    Write-Host "已还原用户配置：$cfgPath" -ForegroundColor Green
}

$mb = [math]::Round((Get-Item $exe).Length / 1MB, 1)
$mode = if ($Framework) { '框架依赖（需 .NET 8 桌面运行时）' } else { '自包含（免安装）' }
Write-Host ""
Write-Host "完成：$exe" -ForegroundColor Green
Write-Host "模式：$mode" -ForegroundColor Green
Write-Host "大小：$mb MB" -ForegroundColor Green
