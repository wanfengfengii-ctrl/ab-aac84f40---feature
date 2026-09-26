/*
 * smoke.js — 遮挡判定冒烟测试：用有解析解的场景验证连续精确判定结果，
 * 覆盖「相交区间」「端点相切（抽样极易漏检）」「全程安全」三种情况。
 * 全部断言通过退出码 0，否则退出码 1。
 */
'use strict';
const Geo = require('../src/geometry.js');

const F = (n, d = 1) => new Geo.Frac(BigInt(n), BigInt(d));
const eqF = (f, n, d = 1) => f && f.eq(F(n, d));
const P = Geo.Pt;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ` — 实际：${extra}` : ''}`); }
}

console.log('冒烟 1：相交区间 + 端点相切（连续判定，非抽样）');
// K1(0,0)@t=0 → K2(10,0)@t=2；M1(5,10)，M2(50,−50)
// R1=[4,6]×[4,6] ⇒ 遮挡 t∈[1/2, 3/2]，首接触点 (4,6)，相机 (5/2,0)
// R2=[8,9]×[4,6] ⇒ 仅在 t=2（航段终点）与角点 (8,4) 相切：抽样时刻极易漏检
const r1 = Geo.checkScenario({
  keyframes: [{ t: F(0), p: P(0, 0) }, { t: F(2), p: P(10, 0) }],
  markers: [P(5, 10), P(50, -50)],
  rects: [Geo.rectFrom(4, 4, 2, 2), Geo.rectFrom(8, 4, 1, 2)],
});
check('判定为不可执行', r1.ok === false);
const f = r1.firstOcclusion;
check('最早遮挡时刻 t = 1/2', eqF(f && f.t, 1, 2), f && f.t.toString());
check('涉及标记点 M1', f && f.markerIndex === 0);
check('涉及矩形 R1', f && f.rectIndex === 0);
check('相机位置 C(t) = (5/2, 0)', f && eqF(f.camera.x, 5, 2) && eqF(f.camera.y, 0));
check('接触点 = (4, 6)', f && eqF(f.contact.x, 4) && eqF(f.contact.y, 6));
const tangent = r1.segments[0].entries.find((e) => e.tangent);
check('检出端点相切条目（t = 2，R2）', !!tangent && eqF(tangent.tMin, 2) && tangent.rectIndex === 1);
check('相切接触点 = (8, 4)', tangent && eqF(tangent.contactMin.x, 8) && eqF(tangent.contactMin.y, 4));
const safe = r1.segments[0].byMarker[0].safe;
check('安全区间数量 = 2', safe.length === 2);
check('安全区间 [0, 1/2)', safe[0] && eqF(safe[0].from, 0) && eqF(safe[0].to, 1, 2) && safe[0].fromClosed && !safe[0].toClosed);
check('安全区间 (3/2, 2)', safe[1] && eqF(safe[1].from, 3, 2) && eqF(safe[1].to, 2) && !safe[1].fromClosed && !safe[1].toClosed);
check('M2 全程安全', r1.segments[0].byMarker[1].occluded.length === 0);

console.log('冒烟 2：全程安全场景');
const r2 = Geo.checkScenario({
  keyframes: [{ t: F(0), p: P(0, 0) }, { t: F(2), p: P(10, 0) }],
  markers: [P(50, -50), P(60, -60)],
  rects: [Geo.rectFrom(4, 4, 2, 2)],
});
check('判定为可执行', r2.ok === true);
check('无最早遮挡记录', r2.firstOcclusion === null);

// 旧草稿回归：无 circles 字段时，首个证据仍精确来自矩形，结论/区间/首项不变
check('旧草稿回归：首个证据来自保护矩形', r1.firstOcclusion.kind === 'rect' && r1.firstOcclusion.rectIndex === 0);

function eqRad(x, an, ad, bn, bd, q) {
  return x instanceof Geo.Rad && x.a.eq(F(an, ad)) && x.b.eq(F(bn, bd)) && x.q === BigInt(q);
}

console.log('冒烟 3：圆形保护区——相交区间（连续精确二次根式，非多边形/非抽样）');
// K1(0,0)@t=0 → K2(10,0)@t=2；M(5,10)；圆 (5,7) r=1
// 解析解：垂足距离 ≤1 ⟺ |5−10u| ≤ √(25/2)
//   u ∈ [(2−√2)/4, (2+√2)/4]，t=2u ⇒ t ∈ [(2−√2)/2, (2+√2)/2]
const r3 = Geo.checkScenario({
  keyframes: [{ t: F(0), p: P(0, 0) }, { t: F(2), p: P(10, 0) }],
  markers: [P(5, 10)],
  rects: [Geo.rectFrom(40, 40, 4, 4)], // 不参与遮挡，仅保证旧矩形路径共存
  circles: [Geo.circleFrom(5, 7, 1)],
});
check('判定为不可执行', r3.ok === false);
const f3 = r3.firstOcclusion;
check('最早证据来自圆形保护区', f3.kind === 'circle' && f3.circleIndex === 0);
check('最早时刻 t = (2−√2)/2（精确根式）', eqRad(f3.t, 1, 1, -1, 2, 2), f3.t && f3.t.toString());
check('数值近似 ≈ 0.292893', Math.abs(f3.t.toNumber() - (2 - Math.SQRT2) / 2) < 1e-12);
check('非相切（区间有正长度）', f3.tangent === false);
check('相机 x = 5 − (5/2)√2', eqRad(f3.camera.x, 5, 1, -5, 2, 2), f3.camera.x.toString());
check('圆周接触点 y = 22/3', f3.contact.y.eq(F(22, 3)), f3.contact.y.toString());
check('圆周接触点 x = 5 − (2/3)√2', eqRad(f3.contact.x, 5, 1, -2, 3, 2), f3.contact.x.toString());
// 接触点确实在圆周上（精确距离 = 半径）
{
  const dx = f3.contact.x.sub(new Geo.Rad(F(5))), dy = f3.contact.y.sub(new Geo.Rad(F(7)));
  const d2 = dx.mul(dx).add(dy.mul(dy));
  check('接触点到圆心距离平方 = r² = 1（精确）', d2.a.eq(F(1)) && d2.b.isZero(), d2.toString());
}
{
  const occ = r3.segments[0].byMarker[0].occluded;
  check('合并区间记录圆编号 C1', occ.length === 1 && occ[0].circles[0] === 0 && occ[0].rects.length === 0);
}

console.log('冒烟 4：圆形保护区——相切（单点区间，抽样极易漏检）');
// 圆 (5,2) r=2 与相机航线 y=0 相切于 (5,0)；标记在下方 (5,−10)；span=2
// 仅在 u=1/2（t=1）时视线（相机点）与圆闭接触
const r4 = Geo.checkScenario({
  keyframes: [{ t: F(0), p: P(0, 0) }, { t: F(2), p: P(10, 0) }],
  markers: [P(5, -10)],
  rects: [Geo.rectFrom(40, 40, 4, 4)],
  circles: [Geo.circleFrom(5, 2, 2)],
});
check('判定为不可执行', r4.ok === false);
const f4 = r4.firstOcclusion;
check('相切证据来自圆', f4.kind === 'circle' && f4.tangent === true);
check('相切时刻 t = 1', f4.t.eq(F(1)), f4.t.toString());
check('圆周接触点（相切点）= (5, 0)', f4.contact.x.eq(F(5)) && f4.contact.y.eq(F(0)));
check('相机位置 = (5, 0)', f4.camera.x.eq(F(5)) && f4.camera.y.eq(F(0)));
{
  const occ = r4.segments[0].byMarker[0].occluded;
  check('遮挡区间退化为单点', occ.length === 1 && occ[0].tangent && occ[0].tMin.eq(occ[0].tMax));
  const safe = r4.segments[0].byMarker[0].safe;
  check('安全区间为 [0,1) ∪ (1,2]（相切点被精确挖空）',
    safe.length === 2 && safe[0].to.eq(F(1)) && !safe[0].toClosed
    && safe[1].from.eq(F(1)) && !safe[1].fromClosed);
}

console.log('冒烟 5：圆区不遮挡时判定可执行（旧矩形路径结论不受影响）');
const r5 = Geo.checkScenario({
  keyframes: [{ t: F(0), p: P(0, 0) }, { t: F(2), p: P(10, 0) }],
  markers: [P(50, -50)],
  rects: [Geo.rectFrom(40, 40, 4, 4)],
  circles: [Geo.circleFrom(50, 50, 2)],
});
check('判定为可执行', r5.ok === true);

if (failures) {
  console.error(`\n冒烟失败：${failures} 项断言未通过`);
  process.exit(1);
}
console.log('\n冒烟通过：连续遮挡判定（含相切）与解析解完全一致');
