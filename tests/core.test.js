/* =========================================================================
 * 计算内核断言。node tests/core.test.js
 * 每一条对应设计书里的一条规格或验收项，不通过就不算完成。
 * ========================================================================= */
const path = require('path');
const Core = require(path.join(__dirname, '..', 'src', 'WorkPepTalk', 'wwwroot', 'js', 'core.js'));

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail ? '  →  ' + detail : ''));
}

function eq(name, actual, expected) {
  const a = typeof actual === 'number' ? round(actual) : actual;
  const e = typeof expected === 'number' ? round(expected) : expected;
  ok(name + '  [' + a + ' == ' + e + ']', a === e);
}
function round(v) { return Math.round(v * 1e6) / 1e6; }

/* 便捷：默认配置 + 覆盖 */
function cfgOf(patch) {
  const base = JSON.parse(JSON.stringify(Core.DEFAULT_CONFIG));
  if (patch) deepMerge(base, patch);
  return Core.normalize(base);
}
function deepMerge(a, b) {
  Object.keys(b).forEach(k => {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) {
      a[k] = a[k] || {}; deepMerge(a[k], b[k]);
    } else a[k] = b[k];
  });
  return a;
}
const at = (h, m, s) => h * 60 + m + (s || 0) / 60;

/* ---------------------------------------------------- 1. 三口径折算 */
{
  const c = cfgOf({ pay: { mode: 'monthly', value: 8000, daysPerMonth: 22, hoursPerDay: 8 } });
  const d = Core.derive(c);
  eq('月薪口径 · 日薪 8000/22', d.daily, 363.64);
  eq('月薪口径 · 时薪 日薪/8', d.hourly, 45.45);
}
{
  const c = cfgOf({ pay: { mode: 'daily', value: 400, hoursPerDay: 8 } });
  const d = Core.derive(c);
  eq('日薪口径 · 日薪原值', d.daily, 400);
  eq('日薪口径 · 时薪 400/8', d.hourly, 50);
}
{
  const c = cfgOf({ pay: { mode: 'hourly', value: 50, hoursPerDay: 8 } });
  const d = Core.derive(c);
  eq('时薪口径 · 日薪 50*8', d.daily, 400);
  eq('时薪口径 · 时薪原值', d.hourly, 50);
}
{
  const c = cfgOf({ pay: { mode: 'monthly', value: 8000, daysPerMonth: 21.75, hoursPerDay: 8 } });
  eq('法定 21.75 天口径 · 日薪', Core.derive(c).daily, 367.82);
}

/* ---------------------------------------------------- 2. 午休分段 */
{
  const c = cfgOf({});
  eq('扣午休 · 全天总工时 8 小时', Core.totalSec(c), 8 * 3600);
  const c2 = cfgOf({ schedule: { excludeLunch: false } });
  eq('不扣午休 · 全天总工时 9 小时', Core.totalSec(c2), 9 * 3600);
}
{
  /* 午休不在班次内 → 不切分，否则会出现负长度段 */
  const c = cfgOf({ schedule: { start: '09:00', end: '11:00', lunchStart: '12:00', lunchEnd: '13:00' } });
  eq('午休落在班次外 · 不扣', Core.segments(c).length, 1);
  eq('午休落在班次外 · 总时长 2 小时', Core.totalSec(c), 2 * 3600);
}

/* ---------------------------------------------------- 3. 午后金额 */
{
  const c = cfgOf({});
  const r = Core.compute(c, at(14, 12, 33));
  eq('14:12:33 · 日薪', r.daily, 363.64);
  eq('14:12:33 · 时薪', r.hourly, 45.45);
  /* 上午 3h + 下午 1h12m33s = 15153 秒 */
  eq('14:12:33 · 已工作秒数', r.worked, 15153);
  /* 期望值用全精度算，不能拿显示用的 45.45 去反推 —— 那样差 4 分钱 */
  eq('14:12:33 · 已赚金额',
     Math.round(r.earned * 100) / 100,
     Math.round((8000 / 22 / 8) * 15153 / 3600 * 100) / 100);
  eq('14:12:33 · 阶段', r.phase, 'working');
  eq('14:12:33 · 状态', Core.moodOf(r), 'mid');
}

/* ---------------------------------------------------- 4. 未开工 */
{
  const c = cfgOf({});
  const r = Core.compute(c, at(8, 52, 10));
  eq('08:52 · 已赚为 0', r.earned, 0);
  eq('08:52 · 已工作为 0', r.worked, 0);
  eq('08:52 · 剩余为全天', r.remain, 8 * 3600);
  eq('08:52 · 阶段', r.phase, 'before');
  eq('08:52 · 状态', Core.moodOf(r), 'before');
}

/* ---------------------------------------------------- 5. 加班锁定 */
{
  const c = cfgOf({});
  const r = Core.compute(c, at(19, 6, 44));
  eq('19:06 · 已赚锁在日薪', Math.round(r.earned * 100) / 100, 363.64);
  eq('19:06 · 阶段', r.phase, 'overtime');
  eq('19:06 · 已加班秒数', r.otSec, 4004);      // 1h6m44s
  eq('19:06 · 在工位总时长', r.deskSec, 8 * 3600 + 4004);
  eq('19:06 · 状态', Core.moodOf(r), 'overtime');
  /* 关键回归：加班时段绝不能加进 earned */
  ok('19:06 · 加班不额外计钱', Math.round(r.earned * 100) / 100 === 363.64);
}
{
  /* 加班到凌晨也不许超过日薪 */
  const c = cfgOf({});
  const r = Core.compute(c, at(23, 59, 59));
  ok('23:59 · 已赚不超过日薪', Math.round(r.earned * 100) / 100 <= 363.64 + 0.005);
}

/* ---------------------------------------------------- 6. 正好到点 */
{
  const c = cfgOf({});
  const r = Core.compute(c, 18 * 60);
  eq('18:00 · 进度满', r.progress, 1);
  eq('18:00 · 剩余 0', r.remain, 0);
  eq('18:00 · 状态为已收工', Core.moodOf(r), 'done');
  /* 18:00:00 整，phase 仍是 working（overtime 要 now > endMin） */
  eq('18:00 · 阶段', r.phase, 'working');
}

/* ---------------------------------------------------- 7. 状态阈值 */
{
  const c = cfgOf({});
  eq('09:38 · 刚开工', Core.moodOf(Core.compute(c, at(9, 38, 20))), 'early');
  eq('17:22 · 临近下班', Core.moodOf(Core.compute(c, at(17, 22, 8))), 'late');
  eq('12:30 午休中 · 进度冻在上午', Core.compute(c, at(12, 30)).worked, 3 * 3600);
  eq('12:30 午休中 · 阶段仍是上班中', Core.moodOf(Core.compute(c, at(12, 30))), 'mid');
}

/* ---------------------------------------------------- 8. 八小时不漂移 */
{
  /* 模拟每秒 tick 一次，跑满 8 小时，最后与一次性计算比对 */
  const c = cfgOf({});
  let last = null;
  for (let s = at(9, 0, 0); s <= at(18, 0, 0); s += 1 / 60) last = Core.compute(c, s);
  const direct = Core.compute(c, 18 * 60);
  ok('逐秒 tick 8 小时后金额不漂移',
     Math.abs(last.earned - direct.earned) < 1e-9,
     'looping=' + last.earned + ' direct=' + direct.earned);
  eq('跑满后已赚 = 日薪（全精度）', Math.round(last.earned * 100) / 100, 363.64);
  ok('跑满后已工作 = 8 小时', Math.abs(last.worked - 8 * 3600) < 1e-6);
}

/* ---------------------------------------------------- 9. 零时长防御 */
{
  const c = cfgOf({ schedule: { start: '09:00', end: '09:00' } });
  const r = Core.compute(c, at(9, 0));
  eq('班次零长度 · progress 记 1', r.progress, 1);
  ok('班次零长度 · 不产生 NaN', isFinite(r.earned) && isFinite(r.progress));
}

/* ---------------------------------------------------- 10. 配色 */
{
  const white = Core.bgTokens('white');
  const black = Core.bgTokens('black');
  const yellow = Core.bgTokens('yellow');
  ok('白底 · 深字', white['--wd-ink'] === '#1E1C19');
  ok('黑底 · 浅字', black['--wd-ink'] === '#F7F3E9');
  ok('黄底 · 深字（亮度 0.51）', yellow['--wd-ink'] === '#1E1C19');
  ok('黄底 · 进度条换青绿', yellow['--wd-fill'] === '#2F6B5E');
  ok('白底 · 进度条朱红', white['--wd-fill'] === '#A8442A');
  ok('黑底亮度 < 0.42', Core.lum('#181715') < Core.LUM_THRESHOLD);
  ok('白底亮度 > 0.42', Core.lum('#FBFAF7') > Core.LUM_THRESHOLD);
  /* 九个预设逐个验证：字色与背景的对比度必须都在 4.5:1 以上 */
  Core.BG_PRESETS.forEach(function (b) {
    const t = Core.bgTokens(b.id);
    const cr = contrast(b.hex, t['--wd-ink']);
    ok('预设 ' + b.name + ' 对比度 ' + cr.toFixed(1) + ':1 ≥ 4.5', cr >= 4.5, b.hex);
  });
}
function contrast(hexA, hexB) {
  const a = Core.lum(hexA), b = Core.lum(hexB);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------------------------------------------------- 11. 坏配置回落 */
{
  const bad = Core.normalize({
    pay: { mode: 'weekly', value: 'abc', daysPerMonth: 0, hoursPerDay: -3 },
    schedule: { start: '25:00', end: 'xx', excludeLunch: 'yes' },
    look: { theme: 'Z', background: 'gold' }
  });
  eq('坏 mode → monthly', bad.mode, 'monthly');
  eq('坏 value → 8000', bad.value, 8000);
  eq('坏 daysPerMonth → 22', bad.daysPerMonth, 22);
  eq('坏 hoursPerDay → 8', bad.hoursPerDay, 8);
  eq('坏 start → 09:00', bad.startMin, 540);
  eq('坏 end → 18:00', bad.endMin, 1080);
  eq('坏 theme → A', bad.theme, 'A');
  eq('坏 background → white', bad.background, 'white');
  ok('坏 excludeLunch 不算 false', bad.excludeLunch === true);
  ok('坏配置仍能算出有限值', isFinite(Core.compute(bad, 720).earned));
}

/* ---------------------------------------------------- 输出 */
if (fail) {
  console.log('\n失败 ' + fail + ' 项：');
  failures.forEach(f => console.log('  ✗ ' + f));
}
console.log('\n通过 ' + pass + ' / ' + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
