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

  function setView(v) {
    if (v === view) return;
    view = v;
    lastSize = '';
    if (v === 'panel') panelDirty = true;
    draw();
  }

  /* ------------------------------------------------------------ 交互 */

  document.addEventListener('click', function (e) {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.getAttribute('data-act');

    if (a === 'settings') { setView('panel'); host.send({ type: 'openSettings' }); }
    else if (a === 'collapse') { setView('ball'); host.send({ type: 'collapse' }); }
    else if (a === 'expand') { setView('widget'); host.send({ type: 'expand' }); }
  });

  /*
   * 拖动：交给宿主的系统级拖窗循环（ReleaseCapture + WM_NCLBUTTONDOWN）。
   * 不去模拟鼠标位置，那样在 150% 缩放下会漂。
   * 按钮、输入框、色板这些交互元素不触发拖动。
   */
  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    if (e.target.closest('[data-nodrag]')) return;
    if (e.target.closest('input, textarea, select, a, button')) return;
    if (view === 'panel' && e.target.closest('.panel')) return;
    host.send({ type: 'drag' });
  });

  /* 右键：交给宿主弹菜单 */
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    host.send({ type: 'menu' });
  });

  /* ------------------------------------------------------------ 配置 */

  function applyConfig(raw) {
    cfg = Core.normalize(raw);
    lastMood = null;
    lastSize = '';
    host.send({ type: 'bgColor', color: windowBackground() });
    draw();
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
    applyConfig: applyConfig,
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
  }

  host.onMessage(function (msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'config') {
      rawCache = msg.config ? deepClone(msg.config) : deepClone(Core.DEFAULT_CONFIG);
      applyConfig(rawCache);
      if (msg.view) setView(msg.view);
      applyDebugParams();
      lastSize = '';
      draw();
    } else if (msg.type === 'setView') {
      setView(msg.view);
    } else if (msg.type === 'reloadConfig') {
      rawCache = msg.config ? deepClone(msg.config) : rawCache;
      applyConfig(rawCache);
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
