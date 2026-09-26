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

/* ============ 圆区：相交、相切（连续精确求解，非多边形/非抽样） ============ */
console.log('冒烟 3：圆形保护区相交区间（精确根式端点）');
// K1(0,0)@0 → K2(10,0)@2；M(5,10)；圆 (5,5) r=2
// 解析解：u∈[1/2−2√21/21, 1/2+2√21/21]，t∈2u；首次接触点在圆周上
const r3 = Geo.checkScenario({
  keyframes: [{ t: F(0), p: P(0, 0) }, { t: F(2), p: P(10, 0) }],
  markers: [P(5, 10)],
  rects: [Geo.rectFrom(80, 80, 2, 2)],
  circles: [Geo.circleFrom(5, 5, 2)],
});
check('圆区遮挡判定为不可执行', r3.ok === false);
const f3 = r3.firstOcclusion;
check('首项来源为圆区 O1', f3 && f3.kind === 'circle' && f3.circleIndex === 0 && f3.rectIndex === -1);
check('最早时刻 t = 1 − 4√21/21（精确根式）',
  f3 && Geo.Q2.eq(f3.t, new Geo.Q2(F(1), F(-4, 21), 21n)), f3 && Geo.Q2.from(f3.t).toRadString());
check('最早时刻数值 ≈ 0.12712844', f3 && Math.abs(f3.t.toNumber() - 0.127128439) < 1e-8, f3 && f3.t.toNumber());
const dx = f3 && f3.contact.x.sub(Geo.Q2.from(5n)), dy = f3 && f3.contact.y.sub(Geo.Q2.from(5n));
check('圆周接触点到圆心距离精确等于半径 2', !!f3 && dx.mul(dx).add(dy.mul(dy)).eq(Geo.Q2.from(4n)));
check('首项含相机位置与标记', f3 && f3.markerIndex === 0 && f3.segmentIndex === 0 && Math.abs(f3.camera.y.toNumber()) < 1e-12);
const occ3 = r3.segments[0].byMarker[0].occluded;
check('圆区遮挡合并为 1 个闭区间（含 O1 标注）',
  occ3.length === 1 && occ3[0].circles.length === 1 && occ3[0].circles[0] === 0 && occ3[0].tangent === false);
check('安全补集为 [0,t₁) ∪ (t₂,2]', occ3.length === 1 && r3.segments[0].byMarker[0].safe.length === 2);

console.log('冒烟 4：圆区单点相切（抽样必漏，连续求解精确捕获）');
// 相机 (−10,10)→(0,10)@2，M(0,0)，圆 (3,5) r=3：仅在 t=2 视线与圆相切于 (0,5)
const r4 = Geo.checkScenario({
  keyframes: [{ t: F(0), p: P(-10, 10) }, { t: F(2), p: P(0, 10) }],
  markers: [P(0, 0)],
  rects: [Geo.rectFrom(80, 80, 2, 2)],
  circles: [Geo.circleFrom(3, 5, 3)],
});
check('判定为不可执行（相切也算遮挡）', r4.ok === false);
const f4 = r4.firstOcclusion;
check('相切时刻精确为 t = 2', f4 && f4.tangent && f4.t.eq(F(2)), f4 && Geo.fmtAny(f4.t));
check('圆周接触点精确为 (0, 5)',
  f4 && Geo.Q2.eq(f4.contact.x, Geo.Q2.from(0n)) && Geo.Q2.eq(f4.contact.y, Geo.Q2.from(5n)));
check('相切证据可逐点复核：t=1 时视线安全',
  (() => { const mid = Geo.sightHitsCircle(P(-5, 10), P(0, 0), Geo.circleFrom(3, 5, 3)); return mid === false; })());

console.log('冒烟 5：旧场景回归（无圆区时结论/区间/首项证据不变）');
const legacy = () => ({
  keyframes: [{ t: F(0), p: P(0, 0) }, { t: F(2), p: P(10, 0) }],
  markers: [P(5, 10), P(50, -50)],
  rects: [Geo.rectFrom(4, 4, 2, 2), Geo.rectFrom(8, 4, 1, 2)],
});
const r5a = Geo.checkScenario(legacy());
const r5b = Geo.checkScenario(Object.assign(legacy(), { circles: [] }));
check('无 circles 字段与空圆区结论一致', r5a.ok === false && r5a.ok === r5b.ok);
check('首项证据仍是矩形 R1、t=1/2、接触点 (4,6)',
  r5a.firstOcclusion.kind === 'rect' && r5a.firstOcclusion.rectIndex === 0 &&
  r5a.firstOcclusion.t.eq(F(1, 2)) &&
  r5a.firstOcclusion.contact.x.eq(F(4)) && r5a.firstOcclusion.contact.y.eq(F(6)));
check('矩形遮挡区间与相切点保持不变',
  (() => {
    const o = r5a.segments[0].byMarker[0].occluded;
    return o.length === 2 && o[0].tMin.eq(F(1, 2)) && o[0].tMax.eq(F(3, 2)) &&
      o[1].tangent && o[1].tMin.eq(F(2)) && o[1].rects.length === 1;
  })());
check('圆区标注为空（旧场景输出结构不变）',
  r5a.segments[0].byMarker[0].occluded.every((o) => !o.circles || o.circles.length === 0));

if (failures) {
  console.error(`\n冒烟失败：${failures} 项断言未通过`);
  process.exit(1);
}
console.log('\n冒烟通过：连续遮挡判定（含相切）与解析解完全一致');
