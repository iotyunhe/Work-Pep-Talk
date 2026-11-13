/* =========================================================================
 * 上班鼓励器 · 挂件渲染
 * ---------------------------------------------------------------------
 * 只做「算好的数 → HTML」这一件事。不读时间、不存状态、不碰配置。
 * 三套主题共用同一份 DOM，靠 class 差分表现 —— 换主题不重排结构。
 * ========================================================================= */
(function (root) {
  'use strict';

  const Core = root.Core;

  /* ---------------------------------------------------------- 状态文案 */

  /*
   * 语气按第三轮决策走：正常时段报事实，加班允许尖锐。
   * 一律不喊口号，不写"加油""打工人"。
   */
  const MOODS = {
    before:   { state: '未开工',   dot: 'off',  text: '还没开工。先把水倒上。' },
    early:    { state: '上班中',   dot: 'ok',   text: '开局。今天第一块钱已经到账。' },
    mid:      { state: '上班中',   dot: 'ok',   text: '已经赚了一顿午饭。' },
    late:     { state: '临近下班', dot: 'warn', text: '最后一段。剩下的时间在打折。' },
    overtime: { state: '加班中',   dot: 'warn', text: '' },
    done:     { state: '已收工',   dot: 'off',  text: '今天到此为止。钱已经落袋。' }
  };

  /* ---------------------------------------------------------- 形象 */

  /*
   * 内联 SVG 团子。六种表情分别对六种状态，笔画数一致所以切换时不跳动。
   * C 主题走像素脸：同一套语义，换成块状画法。
   */
  function avatar(mood, theme, cfg) {
    /* 自定义形象优先：按状态取图，缺图回落到内置 */
    if (cfg && cfg.avatar === 'custom') {
      const src = pickCustomAvatar(cfg.avatarFiles, mood);
      if (src) return '<img class="ava-img" src="' + escapeAttr(src) + '" alt="">';
    }

    const skin = '#F0DBC1';
    const ink = '#2A2620';
    const stroke = 1.8;
    let face = '';

    if (mood === 'before') {
      face =
        '<path d="M20.5 30 h7" stroke="' + ink + '" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M36.5 30 h7" stroke="' + ink + '" stroke-width="2" stroke-linecap="round"/>' +
        '<circle cx="32" cy="38" r="2.2" fill="none" stroke="' + ink + '" stroke-width="1.6"/>';
    } else if (mood === 'early') {
      face =
        '<circle cx="24" cy="30" r="2.4" fill="' + ink + '"/>' +
        '<circle cx="40" cy="30" r="2.4" fill="' + ink + '"/>' +
        '<path d="M28 37.5 q4 3 8 0" stroke="' + ink + '" stroke-width="1.9" fill="none" stroke-linecap="round"/>';
    } else if (mood === 'mid') {
      face =
        '<path d="M20 29 q4 -4 8 0" stroke="' + ink + '" stroke-width="2.1" fill="none" stroke-linecap="round"/>' +
        '<path d="M36 29 q4 -4 8 0" stroke="' + ink + '" stroke-width="2.1" fill="none" stroke-linecap="round"/>' +
        '<path d="M27.5 37 q4.5 4.5 9 0" stroke="' + ink + '" stroke-width="1.9" fill="none" stroke-linecap="round"/>';
    } else if (mood === 'late') {
      face =
        '<path d="M20.5 30 h7" stroke="' + ink + '" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M36.5 30 h7" stroke="' + ink + '" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M28 38 q4 2 8 0" stroke="' + ink + '" stroke-width="1.7" fill="none" stroke-linecap="round"/>' +
        '<circle cx="24" cy="34.5" r="1.2" fill="#C98A5B" opacity=".85"/>';
    } else if (mood === 'overtime') {
      face =
        '<path d="M20.5 31 l7 -4 M20.5 27 l7 4" stroke="' + ink + '" stroke-width="1.9" stroke-linecap="round"/>' +
        '<path d="M36.5 27 l7 4 M36.5 31 l7 -4" stroke="' + ink + '" stroke-width="1.9" stroke-linecap="round"/>' +
        '<path d="M28 39 h8" stroke="' + ink + '" stroke-width="1.8" stroke-linecap="round"/>' +
        '<path d="M47 33 q3 4 0 5 q-3 -1 0 -5" fill="#7FA8C9" stroke="' + ink + '" stroke-width="1.1"/>';
    } else {
      face =
        '<path d="M20 28 q4 -5 8 0" stroke="' + ink + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
        '<path d="M36 28 q4 -5 8 0" stroke="' + ink + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
        '<path d="M26.5 36 q5.5 6 11 0 z" fill="#C86A55" stroke="' + ink + '" stroke-width="1.6" stroke-linejoin="round"/>';
    }

    const spark = (mood === 'done')
      ? '<path d="M14 16 l2 4 l4 1 l-4 1.5 l-2 4 l-1.5 -4 l-4 -1.5 l4 -1 z" fill="#E0A24E"/>'
      : '';
    const zzz = (mood === 'late' || mood === 'overtime')
      ? '<text x="46" y="20" font-size="9" fill="#9A9386" font-family="monospace">z</text>' +
        '<text x="52" y="14" font-size="7" fill="#BEB6A8" font-family="monospace">z</text>'
      : '';

    /* 像素主题：硬边、无抗锯齿、块状五官 */
    if (theme === 'C') {
      const pxEyes = (mood === 'before' || mood === 'late' || mood === 'overtime')
        ? '<rect x="22" y="27" width="7" height="3" fill="' + ink + '"/>' +
          '<rect x="35" y="27" width="7" height="3" fill="' + ink + '"/>'
        : '<rect x="22" y="24" width="7" height="7" fill="' + ink + '"/>' +
          '<rect x="35" y="24" width="7" height="7" fill="' + ink + '"/>';
      const pxMouth = (mood === 'done')
        ? '<rect x="27" y="38" width="10" height="6" fill="#C86A55" stroke="' + ink + '" stroke-width="1.8"/>'
        : '<rect x="28" y="40" width="8" height="3" fill="' + ink + '"/>';
      return (
        '<svg width="46" height="46" viewBox="0 0 64 64" shape-rendering="crispEdges">' +
        '<rect x="12" y="16" width="40" height="38" rx="5" fill="' + skin + '" stroke="' + ink + '" stroke-width="3"/>' +
        '<rect x="16" y="34" width="5" height="5" fill="#EDA893"/>' +
        '<rect x="43" y="34" width="5" height="5" fill="#EDA893"/>' +
        pxEyes + pxMouth +
        '</svg>'
      );
    }

    return (
      '<svg width="52" height="52" viewBox="0 0 64 64">' +
      spark +
      '<ellipse cx="32" cy="35" rx="21" ry="19" fill="' + skin + '" stroke="' + ink + '" stroke-width="' + stroke + '"/>' +
      '<ellipse cx="26" cy="24" rx="5" ry="3" fill="#fff" opacity=".55"/>' +
      face + zzz +
      '</svg>'
    );
  }

  /* avatarFiles 支持 {mood:'path'} 或 [{mood,src}] 两种写法 */
  function pickCustomAvatar(files, mood) {
    if (!files) return null;
    if (Array.isArray(files)) {
      for (let i = 0; i < files.length; i++) {
        if (files[i] && files[i].mood === mood && files[i].src) return files[i].src;
      }
      return null;
    }
    return files[mood] || null;
  }

  /* ---------------------------------------------------------- 图标 */

  const ICON_GEAR =
    '<svg class="ic" viewBox="0 0 14 14"><circle cx="7" cy="7" r="2.3"/>' +
    '<path d="M7 1.4v1.9M7 10.7v1.9M1.4 7h1.9M10.7 7h1.9' +
    'M3.1 3.1l1.3 1.3M9.6 9.6l1.3 1.3M10.9 3.1L9.6 4.4M4.4 9.6l-1.3 1.3"/></svg>';

  const ICON_FOLD =
    '<svg class="ic" viewBox="0 0 14 14"><path d="M2.5 7h9"/></svg>';

  /* ---------------------------------------------------------- 挂件 */

  /*
   * c = Core.compute() 的结果
   * cfg = Core.normalize() 的结果
   * opts.compact = true 时进入收起态（只有数字和状态），用于 200px 矮窗
   */
  function widget(c, cfg, opts) {
    opts = opts || {};
    const mood = Core.moodOf(c);
    const m = MOODS[mood];
    const isOt = c.phase === 'overtime';
    const dotCls = m.dot === 'ok' ? '' : m.dot;

    const tip = isOt
      ? '加班 ' + Core.hms(c.otSec) + '，这段时间没有钱。'
      : m.text;

    /* 背景：自定义图时挂 .wd-photo，走毛玻璃衬底，token 固定用白底那套 */
    const usePhoto = cfg.background === 'photo' && !!cfg.bgImage;
    const tk = usePhoto ? Core.tokenStr(Core.bgTokens('white'))
                        : Core.tokenStr(Core.bgTokens(cfg.background));

    const bgStyle = usePhoto
      ? tk + ';--wd-photo:url("' + escapeCssUrl(cfg.bgImage) + '")'
      : tk;

    const amt = Core.yuan(c.earned);
    const rightLabel = isOt ? '已加班' : '距下班';
    const rightValue = Core.hms(isOt ? c.otSec : c.remain);

    return '' +
      '<div class="wd wd-' + cfg.theme + (usePhoto ? ' wd-photo' : '') +
      ' st-' + mood + (opts.compact ? ' compact' : '') + '" style="' + bgStyle + '">' +
        '<div class="wd-top">' +
          '<span class="wd-state"><i class="dot ' + dotCls + '"></i>' + m.state + '</span>' +
          '<span class="wd-tools">' +
            '<span class="tool" data-act="settings" title="设置">' + ICON_GEAR + '</span>' +
            '<span class="tool" data-act="collapse" title="收起">' + ICON_FOLD + '</span>' +
          '</span>' +
        '</div>' +

        '<div class="wd-main">' +
          '<div class="wd-ava">' + avatar(mood, cfg.theme, cfg) + '</div>' +
          '<div class="wd-money">' +
            '<div class="wd-cap">今天已赚' +
              (isOt ? '<span class="lock">已锁定</span>' : '') +
            '</div>' +
            '<div class="wd-amt"><small>¥</small>' + amt + '</div>' +
          '</div>' +
        '</div>' +

        '<div class="wd-derive">日薪 <b>¥' + Core.yuan(c.daily) +
          '</b> · 时薪 <b>¥' + Core.yuan(c.hourly) + '</b></div>' +

        '<div class="wd-rows">' +
          '<div class="rw"><span>已工作</span><b>' + Core.hms(c.deskSec) + '</b></div>' +
          '<div class="rw"><span>' + rightLabel + '</span><b>' + rightValue + '</b></div>' +
        '</div>' +

        '<div class="wd-bar"><i style="width:' + (c.progress * 100).toFixed(1) + '%"></i></div>' +
        '<div class="wd-tip">' + tip + '</div>' +
      '</div>';
  }

  /* ---------------------------------------------------------- 收起态 */

  /* 56px 圆球，右下角带今日金额角标。点一下展开。 */
  function ball(c, cfg) {
    const theme = cfg ? cfg.theme : 'A';
    return '' +
      '<div class="ball ball-' + theme + '" data-act="expand" title="展开">' +
        avatar(Core.moodOf(c), theme, cfg) +
        '<span class="ball-badge">¥' + Core.yuan(c.earned) + '</span>' +
      '</div>';
  }

  /* ---------------------------------------------------------- 工具 */

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeCssUrl(s) {
    return String(s).replace(/"/g, '%22').replace(/\)/g, '%29');
  }

  root.Render = {
    MOODS: MOODS,
    avatar: avatar,
    widget: widget,
    ball: ball
  };
})(window);
