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
  let panelDirty = true;

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
      reportSize(76, 76);
      return;
    }

    if (view === 'panel') {
      root.innerHTML = window.Panel.render(c, cfg);
      panelDirty = false;
      requestAnimationFrame(function () {
        const el = root.querySelector('.panel');
        if (el) reportSize(Math.ceil(el.offsetWidth), Math.ceil(el.offsetHeight));
      });
      return;
    }

    root.innerHTML = Render.widget(c, cfg);
    reportSize(300, measureWidget());
  }

  function measureWidget() {
    const el = root.querySelector('.wd');
    return el ? Math.ceil(el.offsetHeight) : 216;
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
    if (view === 'panel' && panelDirty) { draw(); }
  }

  /* 尺寸上报：宿主据此调整窗口大小，避免出现空白边或裁切 */
  let lastSize = '';
  function reportSize(w, h) {
    const key = w + 'x' + h;
    if (key === lastSize) return;
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
      if (v === 'panel') { panelDirty = true; draw(); }
      return;
    }
    view = v;
    lastSize = '';
    if (v === 'panel') panelDirty = true;
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
    } else if (msg.type === 'setView') {
      setView(msg.view);
    } else if (msg.type === 'reloadConfig') {
      rawCache = msg.config ? deepClone(msg.config) : rawCache;
      applyConfig(rawCache);
    } else if (msg.type === 'topmost') {
      /* 宿主是置顶状态的唯一真相源：它回什么就是什么，覆盖乐观值 */
      setPin(!!msg.on);
    }
  });

  /* 启动即用默认配置画一帧，不等宿主；宿主随后会下发真配置覆盖 */
  applyDebugParams();
  draw();
  host.send({ type: 'ready' });

  /* 1 秒一跳。用 interval 而非 requestAnimationFrame：
     挂件长期在后台，rAF 会被节流到几乎不跑，countdown 会停。 */
  timer = setInterval(patch, 1000);

  /* 窗口从最小化/隐藏恢复时，立刻重算一次，不等下一个整秒 */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) patch();
  });
})();
