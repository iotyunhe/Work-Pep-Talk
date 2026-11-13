# 上班鼓励器 / Work-Pep-Talk

桌面右下角的常驻小挂件：把工资换算成日薪和时薪，实时显示今天已经赚了多少钱、已经干了多久、距离下班还有多久。

不是番茄钟，不是记账软件，不是打卡工具。核心只有一件事 —— **上班时想看的不是「还剩多久」，而是「我又赚了多少」**。

---

## 技术栈

**.NET 8 + WPF + WebView2**，界面用 HTML/CSS/JS 写在 `wwwroot/` 里。托盘、显示器、光标三块是手写的 Win32（`Interop/Shell.cs`），刻意不引 WinForms —— 原因见下面的「体积」一节。

设计书最初定的是 Tauri 2.0，实际落地时改了。原因只有一条：

> 这台机器上 Visual Studio 生成工具装了，但**缺 MSVC C++ 组件**（没有 `link.exe`、没有 Windows SDK），且实测外网速度约 140 KB/s。补齐 Tauri 所需的 Rust 工具链和 VS 组件要下 2–3 GB，不可行。

而 .NET 8 SDK、WPF 模板、WebView2 运行时三样本机都已就位。换成 WPF 之后，设计书里最有价值的部分 —— 计算内核规格、状态机、配色算法、HTML 界面稿 —— 全部原样复用，只是外壳从 Rust 换成了 C#。

产物差别：Tauri 约 5–10 MB 单文件；本方案 **自包含发布约 55 MB 单文件**（免安装、不依赖目标机环境），框架依赖发布约 1.8 MB 单文件（需目标机有 .NET 8 桌面运行时）。两种产物都是一整个 exe —— 界面已经嵌在程序集里，不需要旁边的 wwwroot 目录。

---

## 体积：55MB 是怎么来的，还能不能再砍

自包含发布 = 把整个 .NET 8 运行时 + WPF 都塞进一个 exe。未压缩时是 149MB，开 `EnableCompressionInSingleFile` 后压到 55MB 左右 —— 这个量级不是代码写胖了，是运行时本身的重量。

三大块拆开看（未压缩）：

| 来源 | 体积 | 能不能去 |
|---|---|---|
| WPF 栈（PresentationFramework 15.4 / PresentationCore 8.1 / WindowsBase 2.2 / Xaml 1.4…） | ~30MB | 不能。界面外壳就是 WPF |
| BCL（CoreLib 12.6 / Private.Xml 7.6 / Linq.Expressions 3.5 / Cryptography 2.0…） | ~40MB | 只能靠 trimming，而 WPF 不支持 trimming |
| 原生（coreclr 4.8 / D3DCompiler 4.5 / wpfgfx 1.9 / clrjit 1.7） | ~20MB | 不能。这是运行时本体 |

真正砍掉的部分，都是「只在调试期/特定控件才加载」的可选程序集：

- **WinForms 栈 18MB → 0**：托盘从 `NotifyIcon` 换成手写 `Shell_NotifyIcon` + 原生 `TrackPopupMenu`（`Interop/Shell.cs`）。压缩后省 5.7MB，是最大的一刀。代价要自己处理 explorer 重启的 `TaskbarCreated` 广播，否则资源管理器一崩图标就永久消失。
- **WinForms 设计器 5.3MB**、**DiaSymReader 2.1MB**、**mscordaccore/mscordbi 2.5MB**、**Ribbon 1.4MB**、**ReachFramework(XPS) 1.5MB** → 0：全是运行时零引用的东西，在 csproj 的 `TrimPublishPayload` 里按文件名剔掉。

实测阶梯：63.9MB（原始）→ 62.3MB（剔诊断类）→ 61.1MB（再剔 Ribbon/XPS）→ **55.4MB**（去 WinForms）。

### 这一刀踩到的两个真依赖（都是运行起来才暴露的）

1. **`Microsoft.Web.WebView2.WinForms.dll` 会把 WinForms 反向拖回来**。只是删掉 `<UseWindowsForms>` 没用 —— WebView2 包同时提供 WinForms 和 WPF 两种宿主，前者的程序集在发布清单里，于是 `System.Windows.Forms` 12.9MB 又跟着进来了。必须把那个宿主 dll 也剔掉，体积才真的降。
2. **`WebView2.Wpf` 自己要 `System.Drawing`**。顺手把 `System.Drawing.Common` 一起删，启动就抛 `FileNotFoundException: System.Drawing, Version=4.0.0.0`，位置在 `EnsureCoreWebView2Async` 里。所以 System.Drawing 三件套（dll 门面 / Common / Primitives）必须留着，只能砍 `System.Drawing.Design` 那 30KB。
3. 剔文件用的正则漏了 `$` 锚点，`System.Drawing.Primitives` 被 `System.Drawing` 前缀匹配一起删掉，表现是启动时 `XamlParseException` + `FileNotFoundException: System.Drawing.Primitives`。加锚点解决 —— 这条要不是跑了一遍，打包脚本会一直"成功"。

不再往下砍的原因：`System.Private.Xml` 是 XAML 解析的根依赖，删了启动就崩；剩下的 BCL 大件被 WebView2 和 JSON 序列化间接引用，属于猜测性删除 —— 一旦踩中，要等用户某次点操作才炸。这个风险换不来几百 KB。

如果 55MB 仍然嫌大，只有一条路：接受「目标机已装 .NET 8 桌面运行时」，用框架依赖发布，产物 1.8MB。


---

## 目录结构

```
assets/app.ico               应用图标（9 档尺寸，16–256）
scripts/make-icon.ps1        纯 GDI+ 生成上面那个 .ico，不依赖设计软件
scripts/publish.ps1          打包单文件 exe
scripts/icon-preview.ps1     把各档尺寸拼成一张图，用来眼睛验收
scripts/icon-hicon-check.ps1 验证 .ico → HICON 这条托盘图标链
scripts/shot-screen.ps1      截全屏（含 DPI 换算），核对托盘与挂件

src/WorkPepTalk/
├── App.xaml(.cs)            应用入口、单实例锁、未捕获异常兜底
├── MainWindow.xaml(.cs)     无边框窗口、WebView2 宿主、内嵌资源服务、窗口定位
├── Models/AppConfig.cs      config.json 的强类型映射
├── Services/
│   ├── AppPaths.cs          程序目录解析（单文件下也指向 exe 所在处）
│   ├── ConfigStore.cs       读写 config.json（原子写、坏文件自动备份重建）
│   ├── AutoStart.cs         HKCU Run 键，免管理员权限
│   ├── Tray.cs              托盘图标与原生右键菜单（不依赖 WinForms）
│   ├── IconFactory.cs       从程序集资源里挑一档 .ico 造成 HICON
│   └── Log.cs               落盘日志，出问题有据可查
├── Interop/
│   ├── Native.cs            拖窗、置顶、穿透、DWM 圆角
│   └── Shell.cs             托盘 / 显示器 / 光标 / 图标句柄，手写 Win32
└── wwwroot/                 界面：HTML + CSS + JS（编译时内嵌进 exe）
    ├── js/core.js           计算内核（纯函数，可单测）
    ├── js/render.js         挂件渲染（三主题共用一套 DOM）
    ├── js/panel.js          设置面板
    └── js/app.js            引导、tick、宿主通信

tests/core.test.js           计算内核的 68 条断言
```

---

## 构建与运行

```bash
# 开发运行
cd src/WorkPepTalk
dotnet run

# 计算内核测试（不需要 .NET，只要有 Node）
node tests/core.test.js

# 打包绿色版（自包含、单文件）
pwsh scripts/publish.ps1

# 打包框架依赖版（约 2MB，目标机需 .NET 8 桌面运行时）
pwsh scripts/publish.ps1 -Framework

# 重新生成图标（改了配色或形状时）
powershell scripts/make-icon.ps1
```

产物只有一个 `publish/WorkPepTalk.exe`。直接把这一个文件发给别人，双击就能用。

---

## 发给别人之前，需要知道的四件事

1. **目标机要求**：Windows 10 1809+ / Windows 11，64 位。界面跑在 WebView2 里，需要 WebView2 运行时 —— Win11 和国内绝大多数 Win10 都随 Edge 自带。真缺了程序会弹窗说明并给出微软官方下载页，不会静默白屏。
2. **首次运行会自建三样东西**，都在 exe 同级：`config.json`（你的设置）、`app.log`（日志，出问题看这个）、`WebView2Data/`（浏览器缓存，约 30MB）。想彻底卸载，删掉 exe 和这三样即可，不写注册表（除非你自己打开了开机自启）。
3. **放在只读目录也没事**：exe 扔进 `C:\Program Files` 时，配置会自动退到 `%APPDATA%\WorkPepTalk`，缓存退到 `%LOCALAPPDATA%`。绿色版语义优先，但不会因为目录不可写就崩。
4. **会被 SmartScreen 拦一下**：没做代码签名的 exe 从网络传过来，首次打开会提示"Windows 已保护你的电脑"。点"更多信息"→"仍要运行"即可。这不是报毒；要彻底消掉得买代码签名证书。

单文件首次启动会先把原生库解到临时目录，慢一点（约 1 秒）是正常的，第二次就快了。

---

## 图标

`assets/app.ico`，9 档尺寸（16/20/24/32/40/48/64/128/256）。造型是深墨圆角方 + 金色币缘 + 米色团子脸，和挂件里的内置形象同一套笔画，所以托盘里那一眼就能认出是它。

`.ico` 不是用设计软件导的，是 `scripts/make-icon.ps1` 用 GDI+ 画出来的：每档先画 4 倍大再降采样，16/20/24 单独简化（去掉描边、放大眼睛和嘴），所以小尺寸不会糊成一团。改颜色只要动脚本顶部那五个十六进制色值。

---

## 计算口径

三种输入方式，最终都折算成日薪和时薪两个数：

| 输入 | 日薪 | 时薪 |
|---|---|---|
| 月薪 | 月薪 ÷ 每月工作日 | 日薪 ÷ 每日工时 |
| 日薪 | 直接使用 | 日薪 ÷ 每日工时 |
| 时薪 | 时薪 × 每日工时 | 直接使用 |

**每月工作日可自行填写**，默认 22 天，不锁死 21.75 —— 大小周、单休、26 天计薪都能用。

### 三条容易搞错、但已经定死的规则

1. **下班后金额锁死在日薪，加班只计时不计钱。**
   显示一个公司根本不会付的数字，用户信了反而更难受。这不是实现简化，是刻意的设计。
2. **午休默认不计工时。** 09:00–18:00 实际算 8 小时，不是 9 小时。午休期间金额停止增长。
3. **金额内部用全精度累计，只在显示时保留两位小数。** 否则每秒截断一次，跑 8 小时会累积出可见偏差。

---

## 界面

三套主题共用同一份 DOM，只换 CSS：

- **A 纸质便签** —— 暖白纸感、衬线数字、朱红点缀。默认。
- **B 极简仪表** —— 纯白细线、等宽数字、进度做成顶部一条 2px 水位线。
- **C 像素小屋** —— 硬描边、块状进度条、像素脸、右下角硬阴影。

九色背景（白黑赤橙黄绿青蓝紫）+ 自定义背景图。配色不写死九套，而是按 WCAG 相对亮度自动决定该配深字还是浅字；亮度判完之后再过一道 4.5:1 对比度兜底 —— 橙色 `#C97A2E` 亮度 0.29 会被判成深底配浅字，但实际对比度只有 2.9:1，字是糊的，所以翻转成深字。带自定义图时用 74% 底衬 + 18px 毛玻璃，再花的照片也吃不掉数字。

六种状态各有表情和文案：未开工 / 刚开工 / 上班中 / 临近下班 / 加班中 / 已收工。语气按「正常时段报事实、加班允许尖锐」来写，不喊口号。

---

## 配置

`config.json` 放在 exe 同级目录，不写注册表、不写 AppData。整个文件夹拷到 U 盘，设置跟着走。

文件损坏时自动备份成 `config.bad-<时间戳>.json` 并用默认配置重建 —— 绝不因为一个坏 JSON 就起不来。

---

## 进度

- [x] 计算内核 + 68 条断言
- [x] 挂件界面、三主题、九色背景、六状态
- [x] 设置面板（口径、工时、外观、行为全部可改，改完立即重算）
- [x] 无边框窗口、置顶、拖动记忆、点击穿透、托盘菜单、开机自启
- [x] 配置持久化（原子写、坏文件恢复）
- [ ] 自定义形象（切图）
- [ ] 跨天夜班
- [ ] 本周累计
