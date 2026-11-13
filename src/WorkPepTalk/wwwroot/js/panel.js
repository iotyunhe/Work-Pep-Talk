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

  /* ------------------------------------------------------------ 渲染 */

  function render(c, cfg) {
    const raw = root.App ? root.App.getRaw() : rawOf(cfg);

    return '' +
      '<div class="panel">' +
        '<div class="pn-title">' +
          '<h3>设置</h3>' +
          '<span class="pn-x" data-act="closePanel" title="关闭">✕</span>' +
        '</div>' +

        '<div class="pn-grp">收入口径</div>' +
        '<div class="seg">' +
          ['monthly', 'daily', 'hourly'].map(function (m) {
            return '<b class="' + (cfg.mode === m ? 'on' : '') + '" data-mode="' + m + '">' +
              MODE_LABEL[m] + '</b>';
          }).join('') +
        '</div>' +

        '<div class="inp">' +
          '<span>金额</span>' +
          '<input type="text" inputmode="decimal" data-f="pay.value" value="' +
            esc(raw.pay.value) + '">' +
          '<em data-unit>' + UNIT[cfg.mode] + '</em>' +
        '</div>' +

        '<div class="pn-grp">折算结果</div>' +
        '<div class="out">' +
          '<div><span>日薪</span><b data-out="daily">¥' + Core.yuan(c.daily) + '</b></div>' +
          '<div><span>时薪</span><b data-out="hourly">¥' + Core.yuan(c.hourly) + '</b></div>' +
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
              '<i></i><em>' + THEME_LABEL[t] + '</em></div>';
          }).join('') +
        '</div>' +
        '<div class="sw-wrap">' +
          '<span class="k">背景</span>' +
          '<div class="sw-row">' +
            Core.BG_PRESETS.map(function (b) {
              return '<i class="sw ' + (cfg.background === b.id ? 'on' : '') +
                '" style="background:' + b.hex + '" data-bg="' + b.id + '" title="' + b.name + '"></i>';
            }).join('') +
            '<i class="sw up" title="上传背景图">+' +
              '<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-upload="bg">' +
            '</i>' +
          '</div>' +
        '</div>' +
        '<div class="pn-line">' +
          '<span class="k">自定义图</span>' +
          '<span class="pn-unit" data-bgname>' +
            (cfg.bgImage ? '已设置' : '未上传') +
          '</span>' +
          (cfg.bgImage ? '<span class="pn-x" data-act="clearBg" style="margin-left:auto">清除</span>' : '') +
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
          '<button class="btn" data-act="reset">恢复默认</button>' +
          '<button class="btn primary" data-act="closePanel">完成</button>' +
        '</div>' +
      '</div>';
  }

  function rawOf(cfg) { return Core.DEFAULT_CONFIG; }

  /* ------------------------------------------------------------ 局部刷新 */

  /* 改工资时只更新这两个数，不重绘面板 —— 否则输入框每秒失焦，没法打字 */
  function refreshDerived(c, cfg) {
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

      if (act === 'closePanel') {
        if (root.App) root.App.setView('widget');
        if (window.chrome && window.chrome.webview) {
          window.chrome.webview.postMessage({ type: 'closeSettings' });
        }
      } else if (act === 'reset') {
        apply(function (raw) {
          const d = JSON.parse(JSON.stringify(Core.DEFAULT_CONFIG));
          raw.pay = d.pay; raw.schedule = d.schedule; raw.look = d.look;
        });
      } else if (act === 'clearBg') {
        apply(function (raw) { raw.look.bgImage = null; });
      }
    });

    /* 上传背景图：读成 data URL 存进配置，绿色版不依赖文件路径跑丢 */
    rootEl.addEventListener('change', function (e) {
      if (!e.target || e.target.getAttribute('data-upload') !== 'bg') return;
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 6 * 1024 * 1024) {
        alert('图片太大（超过 6MB）。挂件常驻内存，别放这么大的图。');
        return;
      }
      const reader = new FileReader();
      reader.onload = function () {
        apply(function (raw) { raw.look.bgImage = reader.result; });
      };
      reader.readAsDataURL(file);
    });
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
