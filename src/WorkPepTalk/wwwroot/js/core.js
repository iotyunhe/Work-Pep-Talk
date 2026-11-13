/* =========================================================================
 * 上班鼓励器 · 计算内核
 * ---------------------------------------------------------------------
 * 唯一真相来源。界面所有数字都从这里出，不做二次加工。
 * 纯函数、零依赖、不碰 DOM —— 因此可以直接用 node 跑断言。
 *
 * 规格来源：《上班鼓励器-设计书-v1》第 5 页 3.1–3.3、第 6 页 4.1、第 7 页 5.2
 * ========================================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- 常量 */

  /* 九色背景预设。顺序即设置面板里的排布顺序：白、黑，然后赤橙黄绿青蓝紫 */
  const BG_PRESETS = [
    { id: 'white',  name: '白', hex: '#FBFAF7' },
    { id: 'black',  name: '黑', hex: '#181715' },
    { id: 'red',    name: '赤', hex: '#B23A2C' },
    { id: 'orange', name: '橙', hex: '#C97A2E' },
    { id: 'yellow', name: '黄', hex: '#E3B93F' },
    { id: 'green',  name: '绿', hex: '#3C7F55' },
    { id: 'cyan',   name: '青', hex: '#2C7E82' },
    { id: 'blue',   name: '蓝', hex: '#37629A' },
    { id: 'purple', name: '紫', hex: '#63497F' }
  ];

  /* 亮度分界线。低于它算深底、配浅字；高于它算浅底、配深字 */
  const LUM_THRESHOLD = 0.42;

  /* 状态阈值：前 12% 算刚开工，后 20% 算临近下班 */
  const T_EARLY = 0.12;
  const T_LATE  = 0.80;

  /* 默认配置。字段与 config.json 契约一一对应 */
  const DEFAULT_CONFIG = {
    version: 1,
    /*
     * done = 用户是否亲手填过自己的工资。
     * 内置的 8000/22/8 只是让程序能起来的占位值，不是用户的数据 ——
     * 在 done 变 true 之前，界面一律显示「未设置」，绝不拿占位数冒充用户收入。
     */
    setup: {
      done: false
    },
    pay: {
      mode: 'monthly',      // monthly | daily | hourly
      value: 8000,
      daysPerMonth: 22,     // 可自行填写，不锁死 21.75
      hoursPerDay: 8
    },
    schedule: {
      start: '09:00',
      end: '18:00',
      lunchStart: '12:00',
      lunchEnd: '13:00',
      excludeLunch: true
    },
    look: {
      theme: 'A',           // A 纸质 | B 仪表 | C 像素
      background: 'white',  // 九色预设 id
      bgImage: null,        // 自定义背景图（data URL 或本地相对路径）
      avatar: 'builtin',    // builtin | custom
      avatarFiles: []       // 自定义形象，按状态索引
    },
    window: {
      x: null, y: null, screen: null, collapsed: false
    },
    behaviour: {
      alwaysOnTop: true,
      clickThrough: false,
      autoStart: true
    }
  };

  /* ------------------------------------------------------------ 时间工具 */

  /* '09:00' → 540（分钟）。非法输入回落 0，绝不抛错打死界面 */
  function parseTime(str, fallback) {
    if (typeof str === 'number' && isFinite(str)) return str;
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
    if (!m) return fallback == null ? 0 : fallback;
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return fallback == null ? 0 : fallback;
    return h * 60 + mi;
  }

  /* 540 → '09:00'，用于回写配置 */
  function fmtTime(min) {
    min = Math.round(clamp(min, 0, 1439));
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' +
           String(min % 60).padStart(2, '0');
  }

  /* 秒 → HH:MM:SS。超过 24 小时不回绕，继续往上加小时 */
  function hms(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor(sec % 3600 / 60);
    const s = sec % 60;
    return String(h).padStart(2, '0') + ':' +
           String(m).padStart(2, '0') + ':' +
           String(s).padStart(2, '0');
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function yuan(v) { return (isFinite(v) ? v : 0).toFixed(2); }

  /* ------------------------------------------------------ 配置规范化 */

  /*
   * 把可能被手改坏的 config.json 收拢成一个可信的扁平结构。
   * 设计书第 5 页 3.3：任何非法值都回落到默认，应用要能起来。
   */
  function normalize(raw) {
    const d = DEFAULT_CONFIG;
    const r = raw || {};
    const pay = r.pay || {}, sch = r.schedule || {}, look = r.look || {};
    const win = r.window || {}, beh = r.behaviour || {};

    const mode = ['monthly', 'daily', 'hourly'].indexOf(pay.mode) >= 0 ? pay.mode : d.pay.mode;
    const value = num(pay.value, d.pay.value, 0, 1e7);
    const daysPerMonth = num(pay.daysPerMonth, d.pay.daysPerMonth, 1, 31);
    const hoursPerDay = num(pay.hoursPerDay, d.pay.hoursPerDay, 0.5, 24);

    const startMin = parseTime(sch.start, parseTime(d.schedule.start));
    const endMin   = parseTime(sch.end,   parseTime(d.schedule.end));
    const lunchStartMin = parseTime(sch.lunchStart, parseTime(d.schedule.lunchStart));
    const lunchEndMin   = parseTime(sch.lunchEnd,   parseTime(d.schedule.lunchEnd));

    const bgIds = BG_PRESETS.map(function (b) { return b.id; });
    const bg = r.look && r.look.bgImage ? 'photo'
             : bgIds.indexOf(look.background) >= 0 ? look.background : 'white';

    return {
      /* 只有明确的 true 才算填过。缺字段、写错类型一律当"没设置" —— 
         这个判断决定界面是显示真实数字还是「未设置」，不能从宽。 */
      setupDone: !!(r.setup && r.setup.done === true),

      mode: mode,
      value: value,
      daysPerMonth: daysPerMonth,
      hoursPerDay: hoursPerDay,
      startMin: startMin,
      endMin: endMin,
      lunchStartMin: lunchStartMin,
      lunchEndMin: lunchEndMin,
      excludeLunch: sch.excludeLunch !== false,

      theme: ['A', 'B', 'C'].indexOf(look.theme) >= 0 ? look.theme : 'A',
      background: bg,
      bgImage: look.bgImage || null,
      avatar: look.avatar === 'custom' ? 'custom' : 'builtin',
      avatarFiles: Array.isArray(look.avatarFiles) ? look.avatarFiles : [],

      collapsed: !!win.collapsed,
      alwaysOnTop: beh.alwaysOnTop !== false,
      clickThrough: !!beh.clickThrough,
      autoStart: beh.autoStart !== false
    };
  }

  /*
   * 数值兜底。刻意区分「低于下限」和「高于上限」：
   *   - 低于下限：几乎必然是填错（0 天/月、-3 小时），回落默认值。
   *     若钳到下限，8000 ÷ 1 天会算出 8000 元日薪，比报错更误导。
   *   - 高于上限：可能是极端但真实的用法，钳到上限。
   */
  function num(v, dflt, lo, hi) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return dflt;
    if (n < lo) return dflt;
    if (n > hi) return hi;
    return n;
  }

  /* ------------------------------------------------------------ 折算 */

  /*
   * 三种口径 → 统一的日薪 / 时薪（设计书第 5 页 code[0]）：
   *   monthly: 月薪 ÷ 每月工作日
   *   daily  : 直接就是日薪
   *   hourly : 时薪 × 每日工时
   */
  function derive(cfg) {
    const daily = cfg.mode === 'monthly' ? cfg.value / cfg.daysPerMonth
                : cfg.mode === 'daily'   ? cfg.value
                : cfg.value * cfg.hoursPerDay;
    const hourly = cfg.hoursPerDay > 0 ? daily / cfg.hoursPerDay : 0;
    return { daily: round2(daily), hourly: round2(hourly) };
  }

  /* 日薪/时薪内部保持全精度参与累计，只有显示时才 round2。
     否则每帧截断会让金额越跑越偏 —— 设计书验收第 1 条盯的就是这个。 */
  function deriveRaw(cfg) {
    const daily = cfg.mode === 'monthly' ? cfg.value / cfg.daysPerMonth
                : cfg.mode === 'daily'   ? cfg.value
                : cfg.value * cfg.hoursPerDay;
    const hourly = cfg.hoursPerDay > 0 ? daily / cfg.hoursPerDay : 0;
    return { daily: daily, hourly: hourly };
  }

  function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

  /* ------------------------------------------------------------ 分段 */

  /*
   * 扣除午休后的有效工作区间，单位分钟。
   * 午休必须完全落在班次内才切分；否则不扣 —— 否则会出现负长度段。
   */
  function segments(cfg) {
    const s = cfg.startMin, e = cfg.endMin;
    const ls = cfg.lunchStartMin, le = cfg.lunchEndMin;
    if (cfg.excludeLunch && ls > s && le < e && le > ls && e > s) {
      return [[s, ls], [le, e]];
    }
    return [[s, e]];
  }

  function totalSec(cfg) {
    return segments(cfg).reduce(function (a, seg) { return a + (seg[1] - seg[0]) * 60; }, 0);
  }

  function workedSec(cfg, nowMin) {
    return segments(cfg).reduce(function (a, seg) {
      return a + Math.max(0, Math.min(nowMin, seg[1]) - seg[0]) * 60;
    }, 0);
  }

  /* ------------------------------------------------------------ compute */

  /*
   * 设计书第 5 页 3.2。唯一的入口。
   * nowMin 是「当天的分钟数」，可以带小数（秒级精度靠它带进来）。
   */
  function compute(cfg, nowMin) {
    const d = deriveRaw(cfg);
    const total = totalSec(cfg);
    const workedRaw = workedSec(cfg, nowMin);
    const worked = Math.min(workedRaw, total);

    /* 加班只记时长、不计钱。earned 不加 otSec 项，这是刻意的设计。 */
    const earned = d.hourly / 3600 * worked;
    const remain = Math.max(0, total - worked);
    const progress = total > 0 ? Math.min(1, worked / total) : 1;

    let phase = 'working';
    if (nowMin < cfg.startMin) phase = 'before';
    else if (nowMin > cfg.endMin) phase = 'overtime';

    const otSec = Math.max(0, (nowMin - cfg.endMin) * 60);
    const leftMin = cfg.endMin - nowMin;

    return {
      daily: round2(d.daily),
      hourly: round2(d.hourly),
      total: total,
      worked: worked,              // 秒，仅有效工时
      deskSec: worked + otSec,     // 秒，在工位总时长（含加班），界面上「已工作」用它
      otSec: otSec,                // 秒
      earned: earned,              // 元，全精度，显示时再 round2
      remain: remain,              // 秒
      progress: progress,          // 0–1
      phase: phase,                // before | working | overtime
      leftMin: leftMin             // 分钟，可为负
    };
  }

  /* 包一层：直接吃 Date，省得调用方每次自己算分钟 */
  function computeNow(cfg, date) {
    const dt = date || new Date();
    return compute(cfg, dt.getHours() * 60 + dt.getMinutes() + dt.getSeconds() / 60);
  }

  /* ------------------------------------------------------------ 状态机 */

  /* 设计书第 6 页 code[1]。用进度比例判定，不做绝对值分支 —— 夜班免改 */
  function moodOf(c) {
    if (c.phase === 'before') return 'before';
    if (c.phase === 'overtime') return 'overtime';
    if (c.progress >= 0.999) return 'done';
    if (c.progress >= T_LATE) return 'late';
    if (c.progress <= T_EARLY) return 'early';
    return 'mid';
  }

  /* ------------------------------------------------------------ 配色 */

  /* WCAG 相对亮度。输入 '#RRGGBB' */
  function lum(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    function f(v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  }

  /* WCAG 对比度，两个 #RRGGBB 之间。正文可读性门槛 = 4.5:1 */
  function contrastRatio(hexA, hexB) {
    const a = lum(hexA), b = lum(hexB);
    const hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }

  const WARM_DARK = '#1E1C19', WARM_LIGHT = '#F7F3E9';

  /*
   * 一个背景色 → 一整套 token。
   *
   * 方向按亮度阈值 0.42 初判，但**不盲信**：橙 #C97A2E 亮度 0.29 判为深底，
   * 配暖白只有 2.9:1，字是糊的。所以再加一道对比度兜底 ——
   * 初判不足 4.5:1 时先试同方向纯色，仍不足就翻转方向。
   * 黄底例外单列：朱红压黄对比度 1.8:1，换青绿。
   */
  function bgTokens(id) {
    const p = findBg(id);
    const L = lum(p.hex);

    let dark = L < LUM_THRESHOLD;                        // dark = 深底 = 用浅字
    let ink  = dark ? WARM_LIGHT : WARM_DARK;

    if (contrastRatio(p.hex, ink) < 4.5) {
      const pure = dark ? '#FFFFFF' : '#000000';
      if (contrastRatio(p.hex, pure) >= 4.5) {
        ink = pure;                                      // 同方向纯色够用，保方向
      } else {
        dark = !dark;                                    // 翻转
        ink = dark ? WARM_LIGHT : WARM_DARK;
        if (contrastRatio(p.hex, ink) < 4.5) ink = dark ? '#FFFFFF' : '#000000';
      }
    }

    const t = {
      '--wd-bg':     p.hex,
      '--wd-ink':    ink,
      '--wd-ink2':   dark ? 'rgba(247,243,233,.76)' : 'rgba(30,28,25,.74)',
      '--wd-ink3':   dark ? 'rgba(247,243,233,.54)' : 'rgba(30,28,25,.46)',
      '--wd-chip':   dark ? 'rgba(255,255,255,.10)' : 'rgba(30,28,25,.045)',
      '--wd-track':  dark ? 'rgba(255,255,255,.17)' : 'rgba(30,28,25,.09)',
      '--wd-line':   dark ? 'rgba(255,255,255,.17)' : 'rgba(30,28,25,.10)',
      '--wd-edge':   dark ? 'rgba(255,255,255,.20)' : 'rgba(30,28,25,.10)',
      '--wd-strong': dark ? 'rgba(255,255,255,.85)' : '#1E1C19',
      '--wd-fill':   dark ? 'rgba(255,255,255,.80)' : '#A8442A'
    };
    if (!dark && (id === 'yellow' || id === 'orange')) t['--wd-fill'] = '#2F6B5E';
    t.__dark = dark;
    return t;
  }

  function findBg(id) {
    for (let i = 0; i < BG_PRESETS.length; i++) if (BG_PRESETS[i].id === id) return BG_PRESETS[i];
    return BG_PRESETS[0];
  }

  function tokenStr(t) {
    return Object.keys(t).filter(function (k) { return k.indexOf('__') !== 0; })
      .map(function (k) { return k + ':' + t[k]; }).join(';');
  }

  /* ------------------------------------------------------------ 导出 */

  return {
    BG_PRESETS: BG_PRESETS,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    LUM_THRESHOLD: LUM_THRESHOLD,
    parseTime: parseTime,
    fmtTime: fmtTime,
    hms: hms,
    yuan: yuan,
    clamp: clamp,
    normalize: normalize,
    derive: derive,
    deriveRaw: deriveRaw,
    segments: segments,
    totalSec: totalSec,
    workedSec: workedSec,
    compute: compute,
    computeNow: computeNow,
    moodOf: moodOf,
    lum: lum,
    bgTokens: bgTokens,
    tokenStr: tokenStr,
    findBg: findBg
  };
});
