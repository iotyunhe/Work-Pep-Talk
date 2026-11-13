/* =========================================================================
 * 上班鼓励器 · 设置面板
 * ---------------------------------------------------------------------
 * 面板只做两件事：把配置摊成控件、把控件变化写回配置。
 * 所有数值校验由 core.js 的 normalize 负责，这里不做第二套判断。
 * ========================================================================= */
(function (root) {
  'use strict';

  const Core = root.Core;

  const UNIT = { monthly: '元 / 月', daily: '元 / 天', hourly: '元 / 时' };
  const MODE_LABEL = { monthly: '月薪', daily: '日薪', hourly: '时薪' };
  const THEME_LABEL = { A: '纸质', B: '仪表', C: '像素' };
  /* 预览块里的字样，用各主题自己的字形渲染出来才看得出区别 */
  const THEME_SAMPLE = { A: '¥88.00', B: '88.00', C: '¥88' };

  /* ------------------------------------------------------------ 渲染 */

  function render(c, cfg) {
    const raw = root.App ? root.App.getRaw() : rawOf(cfg);
    const first = root.App ? root.App.isFirstRun() : false;
    const configured = root.App ? root.App.isConfigured() : true;

    /*
     * 首次使用的引导条。只在 needFirstRun 时出现，用户填过之后永远不再出现。
     * 语气不劝、不哄，只说明这些数只有他自己知道。
     */
    const guide = first
      ? '<div class="pn-guide">' +
          '<b>第一次使用</b>' +
          '<span>填一下你的工资。上下班时间和工时如果和默认不一样，顺手改掉。' +
          '这些数只有你自己清楚，我不替你猜。</span>' +
        '</div>'
      : '';

    return '' +
      '<div class="panel' + (first ? ' is-first' : '') + '">' +
        '<div class="pn-title">' +
          '<h3>' + (first ? '先设置一下' : '设置') + '</h3>' +
          '<span class="pn-x" data-act="closePanel" title="关闭">✕</span>' +
        '</div>' +

        guide +

        '<div class="pn-grp">收入口径</div>' +
        '<div class="seg">' +
          ['monthly', 'daily', 'hourly'].map(function (m) {
            return '<b class="' + (cfg.mode === m ? 'on' : '') + '" data-mode="' + m + '">' +
              MODE_LABEL[m] + '</b>';
          }).join('') +
        '</div>' +

        '<div class="inp' + (first ? ' need' : '') + '">' +
          '<span>金额</span>' +
          '<input type="text" inputmode="decimal" data-f="pay.value" value="' +
            esc(raw.pay.value) + '">' +
          '<em data-unit>' + UNIT[cfg.mode] + '</em>' +
        '</div>' +

        '<div class="pn-grp">折算结果</div>' +
        '<div class="out">' +
          '<div><span>日薪</span><b data-out="daily">' +
            (configured ? '¥' + Core.yuan(c.daily) : '¥ —') + '</b></div>' +
          '<div><span>时薪</span><b data-out="hourly">' +
            (configured ? '¥' + Core.yuan(c.hourly) : '¥ —') + '</b></div>' +
        '</div>' +

        '<div class="pn-grp">工时设定</div>' +
        '<div class="pn-line">' +
          '<span class="k">每月工作日</span>' +
          '<input class="pn-num" type="text" inputmode="decimal" data-f="pay.daysPerMonth" value="' +
            esc(raw.pay.daysPerMonth) + '">' +
          '<span class="pn-unit">天 · 可自填</span>' +
        '</div>' +
        '<div class="pn-line">' +
          '<span class="k">每日工时</span>' +
          '<input class="pn-num" type="text" inputmode="decimal" data-f="pay.hoursPerDay" value="' +
            esc(raw.pay.hoursPerDay) + '">' +
          '<span class="pn-unit">小时</span>' +
        '</div>' +
        '<div class="pn-line">' +
          '<span class="k">上班 / 下班</span>' +
          '<input type="time" data-f="schedule.start" value="' + esc(raw.schedule.start) + '">' +
          '<span class="pn-unit">–</span>' +
          '<input type="time" data-f="schedule.end" value="' + esc(raw.schedule.end) + '">' +
        '</div>' +
        '<div class="pn-line">' +
          '<span class="k">午休</span>' +
          '<input type="time" data-f="schedule.lunchStart" value="' + esc(raw.schedule.lunchStart) + '">' +
          '<span class="pn-unit">–</span>' +
          '<input type="time" data-f="schedule.lunchEnd" value="' + esc(raw.schedule.lunchEnd) + '">' +
        '</div>' +
        '<div class="chk" data-toggle="schedule.excludeLunch">' +
          '<i class="box ' + (cfg.excludeLunch ? 'on' : '') + '"></i>午休不计工时' +
        '</div>' +

        '<div class="pn-grp">外观</div>' +
        '<div class="thm-row">' +
          ['A', 'B', 'C'].map(function (t) {
            return '<div class="thm ' + (cfg.theme === t ? 'on' : '') + '" data-theme="' + t + '">' +
              '<i>' + THEME_SAMPLE[t] + '</i><em>' + THEME_LABEL[t] + '</em></div>';
          }).join('') +
        '</div>' +
        '<div class="sw-wrap">' +
          '<span class="k">背景</span>' +
          '<div class="sw-row">' +
            Core.BG_PRESETS.map(function (b) {
              return '<i class="sw ' + (cfg.background === b.id ? 'on' : '') +
                '" style="background:' + b.hex + '" data-bg="' + b.id + '" title="' + b.name + '"></i>';
            }).join('') +
            '<i class="sw up" title="选一张背景图（也可以直接把图片拖进来）" data-act="pickBg">+</i>' +
          '</div>' +
        '</div>' +
        '<div class="pn-line">' +
          '<span class="k">自定义图</span>' +
          '<span class="pn-unit" data-bgname>' +
            (cfg.bgImage ? '已设置' : '未上传') +
          '</span>' +
          (cfg.bgImage ? '<span class="pn-link" data-act="clearBg">清除</span>' : '') +
        '</div>' +

        '<div class="pn-grp">行为</div>' +
        '<div class="chk" data-toggle="behaviour.alwaysOnTop">' +
          '<i class="box ' + (cfg.alwaysOnTop ? 'on' : '') + '"></i>窗口置顶' +
        '</div>' +
        '<div class="chk" data-toggle="behaviour.clickThrough">' +
          '<i class="box ' + (cfg.clickThrough ? 'on' : '') + '"></i>鼠标点击穿透' +
        '</div>' +
        '<div class="chk" data-toggle="behaviour.autoStart">' +
          '<i class="box ' + (cfg.autoStart ? 'on' : '') + '"></i>开机自动启动' +
        '</div>' +

        '<div class="pn-foot">' +
          (first ? '' : '<button class="btn" data-act="reset">恢复默认</button>') +
          '<button class="btn primary' + (first ? ' full' : '') + '" data-act="closePanel">' +
            (first ? '开始使用' : '完成') +
          '</button>' +
        '</div>' +
      '</div>';
  }

  function rawOf(cfg) { return Core.DEFAULT_CONFIG; }

  /* ------------------------------------------------------------ 局部刷新 */

  /* 改工资时只更新这两个数，不重绘面板 —— 否则输入框每秒失焦，没法打字 */
  function refreshDerived(c, cfg) {
    /* 还没填过自己的工资时保持「—」，不要把占位值算出来的数摆到用户面前 */
    if (root.App && !root.App.isConfigured()) return;

    const q = function (s) { return document.querySelector(s); };
    const d = q('[data-out="daily"]'), h = q('[data-out="hourly"]');
    if (d) d.textContent = '¥' + Core.yuan(c.daily);
    if (h) h.textContent = '¥' + Core.yuan(c.hourly);

    const u = q('[data-unit]');
    if (u) u.textContent = UNIT[cfg.mode];
  }

  /* ------------------------------------------------------------ 事件 */

  function bind() {
    const rootEl = document.getElementById('root');

    /* 文本 / 数字输入：边打边算，但只在失焦或回车时落盘 */
    rootEl.addEventListener('input', function (e) {
      const key = e.target.getAttribute && e.target.getAttribute('data-f');
      if (!key) return;

      /*
       * 只要用户在金额框里真的打过字，就认定他确认过自己的工资 ——
       * 必须赶在 setValue 之前标记，这样同一轮里的折算结果才会更新
       * （否则这一帧还算「未设置」，日薪时薪会停在「—」上）。
       */
      if (key === 'pay.value' && root.App) root.App.markConfigured();

      setValue(key, e.target.value, true);
    });

    rootEl.addEventListener('change', function (e) {
      const key = e.target.getAttribute && e.target.getAttribute('data-f');
      if (!key) return;
      setValue(key, e.target.value, false);
    });

    rootEl.addEventListener('click', function (e) {
      /* 口径切换 */
      const modeEl = e.target.closest('[data-mode]');
      if (modeEl) {
        const m = modeEl.getAttribute('data-mode');
        apply(function (raw) { raw.pay.mode = m; });
        return;
      }

      /* 主题 */
      const thmEl = e.target.closest('[data-theme]');
      if (thmEl) {
        const t = thmEl.getAttribute('data-theme');
        apply(function (raw) { raw.look.theme = t; });
        return;
      }

      /* 背景色 */
      const bgEl = e.target.closest('[data-bg]');
      if (bgEl) {
        const id = bgEl.getAttribute('data-bg');
        apply(function (raw) { raw.look.background = id; raw.look.bgImage = null; });
        return;
      }

      /* 复选框 */
      const togEl = e.target.closest('[data-toggle]');
      if (togEl) {
        const key = togEl.getAttribute('data-toggle');
        apply(function (raw) { setPath(raw, key, !getPath(raw, key, true)); });
        return;
      }

      /* 按钮 */
      const actEl = e.target.closest('[data-act]');
      if (!actEl) return;
      const act = actEl.getAttribute('data-act');

      /*
       * 关闭面板统一由 app.js 的 document 级处理器收口（closeSettings），
       * 这里不重复处理 —— 两处都发会让宿主收到两次 closeSettings。
       */
      if (act === 'reset') {
        apply(function (raw) {
          const d = JSON.parse(JSON.stringify(Core.DEFAULT_CONFIG));
          raw.pay = d.pay; raw.schedule = d.schedule; raw.look = d.look;
        });
      } else if (act === 'clearBg') {
        apply(function (raw) { raw.look.bgImage = null; });
      } else if (act === 'pickBg') {
        /*
         * 选图交给宿主。
         * 原来这里是个 <input type="file">，但在「无边框 + 置顶 + 不进任务栏」
         * 的小窗口上，WebView2 自带的文件框弹不出来 —— 点了完全没反应。
         * 宿主用 WPF 的 OpenFileDialog 弹，选完把图片按 data URL 传回来。
         */
        if (root.App) root.App.pickBackground();
      }
    });

    /* 上传背景图不再是页面自己的事：宿主弹框、读盘、编码，回传 bgImage 消息 */
  }

  /* ------------------------------------------------------------ 写配置 */

  function setValue(key, value, live) {
    if (!root.App) return;
    root.App.updateConfig(function (raw) {
      const num = (key === 'pay.value' || key === 'pay.daysPerMonth' || key === 'pay.hoursPerDay');
      setPath(raw, key, num ? parseFloat(String(value).replace(/[^\d.\-]/g, '')) : value);
    }, { silent: !!live });
  }

  function apply(fn) {
    if (!root.App) return;
    root.App.updateConfig(fn, { silent: false });
  }

  function setPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function getPath(obj, path, dflt) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
      if (!cur || typeof cur !== 'object') return dflt;
      cur = cur[parts[i]];
    }
    return cur === undefined ? dflt : cur;
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  bind();

  root.Panel = { render: render, refreshDerived: refreshDerived };
})(window);
