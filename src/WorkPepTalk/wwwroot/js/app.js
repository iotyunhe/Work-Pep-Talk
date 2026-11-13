/* =========================================================================
 * 上班鼓励器 · 引导与调度
 * ---------------------------------------------------------------------
 * 职责：拿配置 → 每秒算一次 → 把结果交给 Render → 把用户动作转给宿主。
 * 计算全在 core.js，DOM 生成全在 render.js / panel.js，这里只管接线。
 *
 * 没有宿主（直接用浏览器打开）时也能跑，用默认配置 —— 这样界面可以单独调。
 * ========================================================================= */
(function () {
  'use strict';

  const Core = window.Core;
  const Render = window.Render;

  /* ------------------------------------------------------------ 宿主通道 */

  const hasHost = !!(window.chrome && window.chrome.webview);

  const host = {
    send: function (msg) {
      if (hasHost) window.chrome.webview.postMessage(msg);
    },
    onMessage: function (fn) {
      if (hasHost) window.chrome.webview.addEventListener('message', function (e) { fn(e.data); });
    }
  };

  /* ------------------------------------------------------------ 状态 */

  let cfg = Core.normalize(null);
  let view = 'widget';          // widget | ball | panel
  let lastMood = null;          // 状态变了才整块重绘
  let timer = null;

  const root = document.getElementById('root');

  /* ------------------------------------------------------------ 渲染 */

  function compute() {
    if (fakeMin !== null) return Core.compute(cfg, fakeMin);
    return Core.computeNow(cfg);
  }

  /*
   * 整块重绘。只在状态变化、换主题、换背景时调用。
   * 每秒 tick 走 patch()，不重建 DOM —— 否则进度条 transition 每帧归零，
   * 会变成一顿一顿的跳。
   */
  function draw() {
    const c = compute();
    lastMood = Core.moodOf(c);
    root.className = 'v-' + view;

    if (view === 'ball') {
      root.innerHTML = Render.ball(c, cfg);
      reportSize(BALL_W, BALL_W);
      watchContent();
      return;
    }

    if (view === 'panel') { drawPanel(c); return; }

    root.innerHTML = Render.widget(c, cfg);
    scheduleSizeSync();
  }

  /*
   * ------------------------------------------------------------ 尺寸同步
   *
   * 窗口高度必须恒等于内容高度。多一像素，窗口底色（#FBFAF7）就会从卡片
   * 底下露出来，看着就是「卡片下面多了一截白条」；少一像素，底部会被裁掉。
   *
   * 以前是「绘完量一次、报一次」，只在那一个瞬间成立。只要之后有任何环节
   * 让窗口比内容高（面板收起、内容临时变高、宿主 KeepOnScreen 微调），
   * 页面就再也不纠正 —— 那一截白边会一直挂在那儿，直到下次整块重绘。
   *
   * 所以改成三方对账，任何一方变化都重新量：
   *   1. 每次绘制后主动量（含 rAF 与两个延迟点，等字体/图片回填）
   *   2. ResizeObserver 盯住当前视图的根元素，内容一变就量
   *   3. window.resize 盯住窗口本身 —— 宿主把窗口改大时，这里立刻按内容纠回
   *
   * 第 3 条是关键：它让「窗口尺寸被人改错」这件事自我修复，而不是靠某一次
   * 绘制恰好没被跳过。
   *
   * 不会来回抖：reportSize 记住上次报过的 w×h，同值不重发；而内容高度只由
   * 宽度（固定 300）和文案决定，与窗口高度无关，所以量出来的值稳定。
   */
  /*
   * 两个尺寸常量：DESIGN_W 是挂件与面板的宽度（CSS 里的 --wd-w 与 .panel），
   * BALL_W 是收起态窗口边长（球本身 56px + 四周留白，角标才不会被窗口裁掉）。
   *
   * DESIGN_W 参与「窗口宽度下限」的判断（见 syncSize），改宽度时三处要一起改。
   */
  const DESIGN_W = 300;
  const BALL_W = 76;

  function viewRoot() {
    if (view === 'ball') return root.querySelector('.ball');
    if (view === 'panel') return root.querySelector('.panel');
    return root.querySelector('.wd');
  }

  /*
   * force：窗口尺寸被外部改过时，必须无视「这个值报过了」的去重再报一次。
   *
   * 去重的前提是「窗口一定跟着我报的值」，但窗口其实会被别人改：宿主
   * KeepOnScreen 夹边、换显示器、别的程序 SetWindowPos。一旦发生，缓存里
   * 那个 300x221 就变成了谎话 —— 页面认为尺寸是对的，于是再也不说话，
   * 多出来的那一截就这么留在窗口上。
   */
  function syncSize(force) {
    if (view === 'ball') { reportSize(BALL_W, BALL_W, force); return; }
    const el = viewRoot();
    if (!el) return;

    /*
     * 宽度取「实测」与「设计宽度」的较大者。
     *
     * 从收起态展开的那一瞬间，窗口还是小球尺寸（76px），视口只有 76 宽。
     * 若把这个 76 当真报上去，宿主就把窗口设成 76 宽 —— 挂件被挤成一竖列，
     * 而这一竖列又会量出同样的 76，内容和窗口互相自证，再也回不去原样。
     *
     * 窗口永远不该比设计宽度窄，所以这里给它一个硬下限：这一帧量出 76 也
     * 只报 300，宿主按 300 开窗，下一帧视口就是 300，量出来的自然也是 300。
     * CSS 那边 .wd 已经是定宽，这里再兜一道，防的是将来有人改样式时复发。
     */
    const w = Math.max(DESIGN_W, Math.ceil(el.offsetWidth));
    reportSize(w, Math.ceil(el.offsetHeight), force);
  }

  /* 绘制后连量几次：字体、背景图这类异步资源回填会改行高 */
  function scheduleSizeSync() {
    syncSize();
    requestAnimationFrame(syncSize);
    setTimeout(syncSize, 120);
    setTimeout(syncSize, 400);
    watchContent();
  }

  let ro = null;
  function watchContent() {
    if (!window.ResizeObserver) return;
    if (!ro) ro = new ResizeObserver(function () { syncSize(); });
    ro.disconnect();
    const el = viewRoot();
    if (el) ro.observe(el);
  }

  /*
   * 面板重绘。
   *
   * 面板是一屏输入控件，重绘比挂件贵：滚动位置会被打回顶部 —— 小屏上刚滚到
   * 「背景」那栏，点一下颜色又跳回最上面。所以记下 scrollTop，画完还回去。
   *
   * 焦点不在这里恢复。面板只在「用户已经离开输入框」之后才重绘（点击控件、
   * change 事件），此时把焦点强塞回某个输入框只会打乱 Tab 顺序；而打字过程中
   * 走的是 patch() 的局部刷新，根本不重绘 —— 那才是光标活下来的原因。
   */
  function drawPanel(c) {
    const old = root.querySelector('.panel');
    const scroll = old ? old.scrollTop : 0;

    root.innerHTML = window.Panel.render(c, cfg);

    /* 滚动位置要等布局出来才还得了，尺寸则交给 scheduleSizeSync 连量几次 */
    requestAnimationFrame(function () {
      const el = root.querySelector('.panel');
      if (el && scroll) el.scrollTop = scroll;
      syncSize();
    });
    scheduleSizeSync();
  }

  /* 只改数字，不动结构 */
  function patch() {
    /*
     * 未设置时界面上根本没有真实数字可更新（金额、日薪、时薪都是占位符），
     * 这里直接跳过 —— 否则每秒都会把「—」覆盖成基于占位工资算出来的假数字。
     * 用户填完之后由 applyConfig / setView 触发整块重绘。
     */
    if (cfg.setupDone === false) return;

    const c = compute();
    const mood = Core.moodOf(c);

    /*
     * 面板视图：只把两个折算结果改文本，绝不整块重绘。
     *
     * 这里曾经是「找不到 .wd-amt 就 draw()」，而面板里没有 .wd-amt ——
     * 于是每秒都整块重绘一次，用户点进金额框后光标最多活一秒就没了。
     * 面板的实时数字由 panel.js 的 refreshDerived 负责，那是纯文本赋值，
     * 不会动 DOM 结构，也就不会碰焦点。
     */
    if (view === 'panel') {
      if (window.Panel) window.Panel.refreshDerived(c, cfg);
      return;
    }

    /* 状态变了就整块重绘：tip、表情、右格标签都可能要换 */
    if (mood !== lastMood) { draw(); return; }

    const q = function (sel) { return root.querySelector(sel); };
    const amt = q('.wd-amt');
    if (!amt) { draw(); return; }

    amt.innerHTML = '<small>¥</small>' + Core.yuan(c.earned);

    const rws = root.querySelectorAll('.rw b');
    if (rws.length >= 2) {
      rws[0].textContent = Core.hms(c.deskSec);
      rws[1].textContent = Core.hms(c.phase === 'overtime' ? c.otSec : c.remain);
    }

    const bar = q('.wd-bar i');
    if (bar) bar.style.width = (c.progress * 100).toFixed(1) + '%';

    const tip = q('.wd-tip');
    if (tip && c.phase === 'overtime') {
      tip.textContent = '加班 ' + Core.hms(c.otSec) + '，这段时间没有钱。';
    }

    if (view === 'ball') {
      const badge = q('.ball-badge');
      if (badge) badge.textContent = '¥' + Core.yuan(c.earned);
    }
  }

  /* 尺寸上报：宿主据此调整窗口大小，避免出现空白边或裁切 */
  let lastSize = '';

  /*
   * 收到宿主配置之前不上报尺寸。
   *
   * 首帧画的是「默认状态 + 挂件」，量出来恒为 300×221；而收起态启动时
   * 宿主给的窗口只有 76×76（宿主已按上次状态开窗）。这一帧报上去就是把
   * 窗口撑回 300 宽，等 config 到达再切小球 —— 用户看到的是「闪一块白再
   * 缩成球」。等视图定了再开始对账，这一跳就没了。
   *
   * 没有宿主（浏览器直开 index.html 调界面）时不存在这个问题，直接放行。
   */
  let sizeReady = !hasHost;

  function reportSize(w, h, force) {
    if (!sizeReady) return;
    const key = w + 'x' + h;
    if (!force && key === lastSize) return;
    lastSize = key;
    host.send({ type: 'size', w: w, h: h });
  }

  /* ------------------------------------------------------------ 视图切换 */

  /*
   * firstRun：本次面板打开是不是「第一次使用」的引导。
   * 面板据此把必填项标出来、把主按钮换成「开始使用」。
   */
  let firstRun = false;

  function setView(v) {
    if (v === view) {
      /* 已经在这个视图也要重画：首启时可能被 debug 参数提前设成 panel */
      if (v === 'panel') draw();
      return;
    }
    view = v;
    lastSize = '';
    draw();
  }

  function openSettings(isFirstRun) {
    firstRun = !!isFirstRun;
    setView('panel');
    host.send({ type: 'openSettings' });
  }

  function closeSettings() {
    firstRun = false;
    setView('widget');
    host.send({ type: 'closeSettings' });
  }

  /* ------------------------------------------------------------ 交互 */

  document.addEventListener('click', function (e) {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.getAttribute('data-act');

    if (a === 'settings') { openSettings(false); }
    else if (a === 'collapse') { setView('ball'); host.send({ type: 'collapse' }); }
    else if (a === 'expand') { setView('widget'); host.send({ type: 'expand' }); }
    else if (a === 'toggleTopmost') {
      /* 乐观切换：先把钉子点亮，点下去就立刻有反馈；宿主随后回 topmost
         校正实际状态（比如窗口已不存在、或写盘失败要回滚）。 */
      setPin(!cfg.alwaysOnTop);
      host.send({ type: 'toggleTopmost' });
    }
    /* 面板里的关闭按钮走这里，跟 panel.js 里的处理取同一个出口 */
    else if (a === 'closePanel') { closeSettings(); }
  });

  /*
   * 置顶开关的本地状态。只切 class、不整块重绘 —— 重绘会让挂件闪一下，
   * 而这个按钮恰恰是按下去要"马上亮"的东西。
   *
   * rawCache 必须一起改：面板保存时是把 rawCache（原始嵌套结构）整份发给
   * 宿主，漏改这里的话，用户切了置顶再打开面板点保存，就会被旧值覆盖回去。
   */
  function setPin(on) {
    cfg.alwaysOnTop = on;

    if (!rawCache) rawCache = deepClone(Core.DEFAULT_CONFIG);
    if (!rawCache.behaviour) rawCache.behaviour = {};
    rawCache.behaviour.alwaysOnTop = on;

    const el = document.querySelector('[data-act="toggleTopmost"]');
    if (!el) return;
    el.classList.toggle('pin-on', on);
    el.setAttribute('title', on ? '已置顶，点击取消置顶' : '点击置顶');
  }

  /*
   * 拖动：交给宿主的系统级拖窗循环（ReleaseCapture + WM_NCLBUTTONDOWN）。
   *
   * 那个调用是同步且模态的 —— SendMessage 要一直等到用户松开左键才返回。
   * 一旦在某个元素上按下鼠标就触发拖窗，那个元素的 mouseup 和 click 会被
   * 整段吞掉，表现出来就是「按钮点了没反应」。
   *
   * 所以排除列表必须覆盖「凡是可以点的东西」，不能只列少数几个标签名。
   * data-act 是页面里所有可点元素的统一标记（设置、收起、展开、面板里的
   * 关闭与复位），将来新加按钮只要带上它，就自动不会再被拖窗吃掉。
   */
  const NO_DRAG = '[data-act], [data-nodrag], input, textarea, select, a, button, label, .pn-x';

  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    if (e.target.closest(NO_DRAG)) return;
    /* 面板视图整个窗口就是面板，全是控件，没有可拖的空白 */
    if (view === 'panel') return;
    host.send({ type: 'drag' });
  });

  /* 右键：交给宿主弹菜单 */
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    host.send({ type: 'menu' });
  });

  /* ------------------------------------------------------------ 拖入图片 */

  /*
   * 把图片文件直接拖到挂件或面板上，也能当背景。
   *
   * 这是「点 + 选图」之外的第二条路：系统文件框在某些窗口样式或环境下
   * 可能弹不出来，拖拽只依赖浏览器的 HTML5 拖放，不经过宿主。
   *
   * 必须 preventDefault：WebView2 默认会拿拖进来的文件当导航目标，
   * 一松手整个页面就被那张图替换掉了。
   */
  let dragDepth = 0;

  /*
   * 背景图统一缩到 1200px 长的边再存。
   *
   * 不是省空间这么简单：Chromium 对单个资源 URL 有长度上限，一张 4MB 的 PNG
   * 编码成 base64 是 5.7MB，塞进 style 属性会让 --wd-photo 整条声明失效，
   * 浏览器算出来 background-image 是 none —— 背景一声不响地不显示。
   * 1200px 的 JPEG 一般两三百 KB，远在限制之内，挂件只有 300 CSS px 宽，
   * 放大到 150% 也够用。
   */
  const BG_MAX_SIDE = 1200;

  function shrinkImage(file) {
    return createImageBitmap(file).then(function (bmp) {
      const scale = Math.min(1, BG_MAX_SIDE / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff';                 /* 透明 PNG 转 JPEG 会发黑，先铺白 */
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      return cv.toDataURL('image/jpeg', 0.88);
    });
  }

  /*
   * 老配置里可能躺着几 MB 的 data URL（就是修复前存进去的那种）。这种图在
   * CSS 里整条声明都会失效，表现出来就是「图加了，背景没变」。启动时就地
   * 缩一次再存回，用户不用重新选图。
   */
  function shrinkOversizedBg() {
    const url = cfg.bgImage;
    if (!url || url.length < 1200000) return;

    const img = new Image();
    img.onload = function () {
      try {
        const scale = Math.min(1, BG_MAX_SIDE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const small = cv.toDataURL('image/jpeg', 0.88);
        if (small.length < url.length) window.App.setBackgroundImage(small);
      } catch (e) { /* 缩放不了就维持原样，至少不崩 */ }
    };
    img.src = url;
  }

  function isImageFile(f) {
    return !!f && /^image\//.test(f.type || '');
  }

  function loadDroppedImage(file) {
    if (!isImageFile(file)) return;
    if (file.size > 6 * 1024 * 1024) {
      alert('图片超过 6MB。挂件是常驻内存的，别放这么大的图。');
      return;
    }
    shrinkImage(file).then(function (dataUrl) {
      window.App.setBackgroundImage(dataUrl);
    }).catch(function () {
      /* 少数解不了的格式（动图 webp 之类）退回原图，至少能显示出来 */
      const reader = new FileReader();
      reader.onload = function () { window.App.setBackgroundImage(reader.result); };
      reader.readAsDataURL(file);
    });
  }

  document.addEventListener('dragenter', function (e) {
    e.preventDefault();
    dragDepth++;
    document.body.classList.add('is-dragging');
  });

  document.addEventListener('dragover', function (e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('dragleave', function (e) {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.body.classList.remove('is-dragging');
  });

  document.addEventListener('drop', function (e) {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('is-dragging');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) loadDroppedImage(files[0]);
  });

  /* ------------------------------------------------------------ 配置 */

  function applyConfig(raw, opts) {
    cfg = Core.normalize(raw);
    lastMood = null;
    lastSize = '';
    host.send({ type: 'bgColor', color: windowBackground() });
    if (!opts || !opts.skipDraw) draw();
  }

  /*
   * 首次使用判定：从未落过 setup.done 就认为没设置过。
   * 两种例外 —— 调试参数指定了 setup，或者压根没有宿主（直接用浏览器
   * 打开 index.html 调界面），都不弹引导，否则开发时每次刷新都被挡住。
   */
  function needFirstRun(raw) {
    if (dbg.has('setup')) return false;
    if (!hasHost) return false;
    return !(raw && raw.setup && raw.setup.done === true);
  }

  /*
   * 窗口底色。挂件是圆角的，窗口是方的，圆角外面那圈由宿主填。
   * 必须跟着背景色走，否则换黑底会露出一圈白边。
   */
  function windowBackground() {
    if (cfg.background === 'photo') return '#FBFAF7';
    const p = Core.findBg(cfg.background);
    return p.hex;
  }

  window.App = {
    setView: setView,
    openSettings: openSettings,
    closeSettings: closeSettings,
    /* 面板用它决定要不要显示引导条、要不要把主按钮换成「开始使用」 */
    isFirstRun: function () { return firstRun; },
    isConfigured: function () { return cfg.setupDone !== false; },
    applyConfig: applyConfig,
    /*
     * 用户亲手填过工资 → 从此不再算「未设置」。
     * 刻意不重绘面板：这个方法会在用户打字过程中被调用，
     * 重绘会把输入框整个换掉、焦点丢失，一个字都打不完整。
     * 关掉面板时 setView('widget') 自然会用新状态重绘挂件。
     */
    markConfigured: function () {
      if (cfg.setupDone) return;
      const raw = currentRaw();
      if (!raw.setup) raw.setup = {};
      raw.setup.done = true;
      cfg = Core.normalize(raw);
      host.send({ type: 'save', config: raw });
    },
    /*
     * 设置面板改完配置后回灌。
     * opts.silent = true 时只重算、不重绘面板 —— 否则用户每敲一个数字，
     * 输入框都会被整个替换掉，焦点丢失、根本打不完整。
     */
    updateConfig: function (patchFn, opts) {
      const raw = currentRaw();
      patchFn(raw);
      opts = opts || {};

      if (opts.silent) {
        cfg = Core.normalize(raw);
        lastMood = null;
        host.send({ type: 'save', config: raw });
        host.send({ type: 'bgColor', color: windowBackground() });
        if (window.Panel && view === 'panel') {
          window.Panel.refreshDerived(compute(), cfg);
        }
        return;
      }

      applyConfig(raw);
      host.send({ type: 'save', config: raw });
    },
    getRaw: currentRaw,
    cfg: function () { return cfg; },
    windowBackground: windowBackground,
    /* 背景图选择交给宿主：这个窗口上 WebView2 自带的 file input 弹不出框 */
    pickBackground: function () { host.send({ type: 'pickBg' }); },
    /* 宿主选完图回传 data URL，存进配置（绿色版不依赖源文件路径） */
    setBackgroundImage: function (dataUrl) {
      if (!dataUrl) return;
      const raw = currentRaw();
      raw.look.bgImage = dataUrl;
      applyConfig(raw);
      host.send({ type: 'save', config: raw });
    },
    redraw: draw
  };

  /* 面板需要拿到「原始嵌套结构」去改，而不是扁平化的内部结构 */
  let rawCache = null;
  function currentRaw() {
    if (!rawCache) rawCache = deepClone(Core.DEFAULT_CONFIG);
    return rawCache;
  }
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ------------------------------------------------------------ 启动 */

  /*
   * 调试用：index.html?view=panel&theme=C&bg=black&at=19:06
   * 只用于开发期核对各种状态的真实渲染，正常启动不带参数。
   */
  const dbg = new URLSearchParams(location.search);
  let fakeMin = null;

  function applyDebugParams() {
    if (!dbg.toString()) return;
    if (dbg.get('theme')) cfg.theme = dbg.get('theme');
    if (dbg.get('bg')) cfg.background = dbg.get('bg');

    const v = dbg.get('view');
    if (v === 'panel' || v === 'ball' || v === 'widget') view = v;

    const at = dbg.get('at');
    if (at) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(at);
      if (m) fakeMin = (+m[1]) * 60 + (+m[2]);
    }

    /* setup=1 强制「已设置」看真实挂件，setup=0 强制「未设置」看引导态 */
    if (dbg.has('setup')) cfg.setupDone = dbg.get('setup') !== '0';
  }

  host.onMessage(function (msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'config') {
      rawCache = msg.config ? deepClone(msg.config) : deepClone(Core.DEFAULT_CONFIG);

      /* 视图这一帧就定了，从这里开始上报尺寸（见 reportSize 的说明） */
      sizeReady = true;

      /* 宿主告诉这块屏幕能放下多高的面板，小屏时面板内部滚动 */
      if (msg.maxPanelH) {
        document.documentElement.style.setProperty('--max-panel-h', msg.maxPanelH + 'px');
      }

      const first = needFirstRun(rawCache);

      /* 首启时跳过中间那帧挂件，避免窗口先按挂件尺寸出现再弹大 */
      applyConfig(rawCache, { skipDraw: true });
      applyDebugParams();

      if (first) openSettings(true);
      else if (msg.view) setView(msg.view);

      lastSize = '';
      draw();
      shrinkOversizedBg();
    } else if (msg.type === 'setView') {
      setView(msg.view);
    } else if (msg.type === 'reloadConfig') {
      rawCache = msg.config ? deepClone(msg.config) : rawCache;
      applyConfig(rawCache);
    } else if (msg.type === 'bgImage') {
      window.App.setBackgroundImage(msg.dataUrl);
    } else if (msg.type === 'topmost') {
      /* 宿主是置顶状态的唯一真相源：它回什么就是什么，覆盖乐观值 */
      setPin(!!msg.on);
    }
  });

  /* 启动即用默认配置画一帧，不等宿主；宿主随后会下发真配置覆盖 */
  applyDebugParams();
  draw();
  host.send({ type: 'ready' });

  /*
   * 兜底：宿主的 config 正常情况下 ready 之后立刻就到，这里给的 3 秒只是
   * 防止「config 丢了」时页面一直不上报、窗口停在初始尺寸无法自纠。
   */
  setTimeout(function () {
    if (sizeReady) return;
    sizeReady = true;
    syncSize(true);
  }, 3000);

  /* 1 秒一跳。用 interval 而非 requestAnimationFrame：
     挂件长期在后台，rAF 会被节流到几乎不跑，countdown 会停。 */
  timer = setInterval(patch, 1000);

  /* 窗口从最小化/隐藏恢复时，立刻重算一次，不等下一个整秒 */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) patch();
  });

  /*
   * 尺寸对账的两个入口（第三方是 scheduleSizeSync 里的 ResizeObserver）：
   *
   * window.resize —— 宿主动了窗口就重新量内容。这是唯一能兜住「窗口比内容
   *   高出一截」的钩子：错值不是页面算错的，是窗口被别人改过之后页面没再说话。
   *   量完如果和上次报的一样，reportSize 会自己跳过，不会互相推。
   *
   * document.fonts.ready —— 字体替换会改行高（挂件用思源/系统字，首帧用
   *   回退字体时那 221px 未必是最终值），回填后补量一次。
   */
  window.addEventListener('resize', function () { syncSize(true); });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncSize).catch(function () {});
  }
})();
