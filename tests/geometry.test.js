'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../src/geometry.js');

const F = (n, d = 1) => new Geo.Frac(BigInt(n), BigInt(d));
const eqF = (f, n, d = 1) => f.eq(F(n, d));
const P = Geo.Pt;

test('Frac：约分与四则运算', () => {
  assert.equal(F(6, 8).toString(), '3/4');
  assert.equal(F(0, 7).toString(), '0');
  assert.ok(F(1, 2).add(F(1, 3)).eq(F(5, 6)));
  assert.ok(F(2, 3).mul(F(3, 4)).eq(F(1, 2)));
  assert.ok(F(1, 2).div(F(3, 4)).eq(F(2, 3)));
  assert.ok(F(1, 2).neg().eq(F(-1, 2)));
  assert.ok(F(1, 3).lt(F(1, 2)));
  assert.ok(F(1, 2).lte(F(1, 2)) && F(1, 2).gte(F(1, 2)));
});

test('十进制解析与格式化', () => {
  assert.ok(Geo.tryParse('2.75').eq(F(11, 4)));
  assert.ok(Geo.tryParse('-0.5').eq(F(-1, 2)));
  assert.ok(Geo.tryParse('10').eq(F(10)));
  assert.ok(Geo.tryParse(' 3 ').eq(F(3)));
  assert.equal(Geo.tryParse('abc'), null);
  assert.equal(Geo.tryParse('1.2.3'), null);
  assert.equal(Geo.tryParse(''), null);
  assert.equal(Geo.fmt(F(1, 4)), '0.25');
  assert.equal(Geo.fmt(F(1, 3)), '0.333333333…');
  assert.equal(Geo.fmt(F(7)), '7');
  assert.equal(Geo.fmtFull(F(1, 2)), '0.5（= 1/2）');
});

test('orient 符号与共线', () => {
  assert.ok(Geo.orient(P(0, 0), P(1, 0), P(0, 1)).gt(F(0)));
  assert.ok(Geo.orient(P(0, 0), P(0, 1), P(1, 0)).lt(F(0)));
  assert.ok(Geo.orient(P(0, 0), P(1, 1), P(2, 2)).isZero());
});

test('三角形裁剪：矩形完全含于三角形时交集即矩形', () => {
  const poly = Geo.clipPolygonRect([P(0, 0), P(10, 0), P(5, 10)], Geo.rectFrom(4, 4, 2, 2));
  const keys = poly.map((p) => `${p.x},${p.y}`).sort();
  assert.deepEqual(keys, ['4,4', '4,6', '6,4', '6,6']);
});

test('sweep：相交区间的精确端点与接触点', () => {
  // 相机 (0,0)→(10,0)，标记 (5,10)，矩形 [4,6]×[4,6]
  // 解析解：u(x,y)=(x−y/2)/(10−y)，在 (4,6) 取最小 1/4，在 (6,6) 取最大 3/4
  const r = Geo.sweepInterval(P(0, 0), P(10, 0), P(5, 10), Geo.rectFrom(4, 4, 2, 2));
  assert.ok(eqF(r.uMin, 1, 4), `uMin=${r.uMin}`);
  assert.ok(eqF(r.uMax, 3, 4), `uMax=${r.uMax}`);
  assert.ok(eqF(r.contactMin.x, 4) && eqF(r.contactMin.y, 6));
  assert.ok(eqF(r.contactMax.x, 6) && eqF(r.contactMax.y, 6));
});

test('sweep：角点相切退化为单点区间', () => {
  // 矩形 [8,9]×[4,6] 仅角点 (8,4) 落在三角形边上 ⇒ u = 1 处相切
  const r = Geo.sweepInterval(P(0, 0), P(10, 0), P(5, 10), Geo.rectFrom(8, 4, 1, 2));
  assert.ok(eqF(r.uMin, 1) && eqF(r.uMax, 1));
  assert.ok(eqF(r.contactMin.x, 8) && eqF(r.contactMin.y, 4));
});

test('sweep：完全不相交返回 null', () => {
  assert.equal(Geo.sweepInterval(P(0, 0), P(10, 0), P(5, 10), Geo.rectFrom(20, 20, 5, 5)), null);
});

test('sweep：相机自身穿过矩形', () => {
  // 相机 (0,0)→(10,0)，标记 (5,−10)，矩形 [4,6]×[−1,1]
  // 解析解：u=(x+y/2)/(10+y)，在 (4,−1) 取 7/18，在 (6,−1) 取 11/18
  const r = Geo.sweepInterval(P(0, 0), P(10, 0), P(5, -10), Geo.rectFrom(4, -1, 2, 2));
  assert.ok(eqF(r.uMin, 7, 18), `uMin=${r.uMin}`);
  assert.ok(eqF(r.uMax, 11, 18), `uMax=${r.uMax}`);
});

test('sweep：共线退化（标记在航线延长线上）', () => {
  // 相机 (0,0)→(10,0)，标记 (18,0)，矩形 [2,4]×[−1,1]
  // 视线段覆盖 x∈[10u,18]，碰到矩形 ⟺ 10u ≤ 4 ⟺ u ≤ 2/5
  const r = Geo.sweepInterval(P(0, 0), P(10, 0), P(18, 0), Geo.rectFrom(2, -1, 2, 2));
  assert.ok(r.collinear);
  assert.ok(eqF(r.uMin, 0) && eqF(r.uMax, 2, 5), `[${r.uMin}, ${r.uMax}]`);
  assert.ok(eqF(r.contactMin.x, 2) && eqF(r.contactMax.x, 4));
});

test('sweep：相机静止（航段两端同点）', () => {
  const hit = Geo.sweepInterval(P(5, 5), P(5, 5), P(5, 10), Geo.rectFrom(4, 7, 2, 2));
  assert.ok(hit.stationary && eqF(hit.uMin, 0) && eqF(hit.uMax, 1));
  assert.equal(Geo.sweepInterval(P(0, 0), P(0, 0), P(1, 1), Geo.rectFrom(5, 5, 2, 2)), null);
});

test('sweep：标记在矩形内（防御分支，正常流程由校验拦截）', () => {
  const r = Geo.sweepInterval(P(0, 0), P(10, 0), P(5, 5), Geo.rectFrom(4, 4, 2, 2));
  assert.ok(r.markerInside && eqF(r.uMin, 0) && eqF(r.uMax, 1));
});

test('checkScenario：多航段、最早遮挡证据与安全区间', () => {
  // K1(0,0)@0 → K2(10,0)@2 → K3(10,10)@4；M1(5,10)，M2(50,−50)
  // R1=[4,6]×[4,6]：航段1 遮挡 u∈[1/4,3/4] ⇒ t∈[1/2,3/2]
  // R2=[8,9]×[4,6]：航段1 于 u=1（t=2）相切于 (8,4)；航段2 遮挡 t∈[2,3]
  const parsed = {
    keyframes: [{ t: F(0), p: P(0, 0) }, { t: F(2), p: P(10, 0) }, { t: F(4), p: P(10, 10) }],
    markers: [P(5, 10), P(50, -50)],
    rects: [Geo.rectFrom(4, 4, 2, 2), Geo.rectFrom(8, 4, 1, 2)],
  };
  const r = Geo.checkScenario(parsed);
  assert.equal(r.ok, false);

  const f = r.firstOcclusion;
  assert.ok(eqF(f.t, 1, 2), `t=${f.t}`);
  assert.equal(f.segmentIndex, 0);
  assert.equal(f.markerIndex, 0);
  assert.equal(f.rectIndex, 0);
  assert.ok(eqF(f.camera.x, 5, 2) && eqF(f.camera.y, 0));
  assert.ok(eqF(f.contact.x, 4) && eqF(f.contact.y, 6));
  assert.equal(f.tangent, false);

  // 航段 1 / M1：遮挡 [1/2,3/2] 与相切点 t=2；安全区间 [0,1/2) ∪ (3/2,2)
  const bm = r.segments[0].byMarker[0];
  assert.equal(bm.occluded.length, 2);
  assert.ok(eqF(bm.occluded[0].tMin, 1, 2) && eqF(bm.occluded[0].tMax, 3, 2));
  assert.ok(bm.occluded[1].tangent && eqF(bm.occluded[1].tMin, 2));
  assert.equal(bm.safe.length, 2);
  assert.ok(eqF(bm.safe[0].from, 0) && eqF(bm.safe[0].to, 1, 2));
  assert.ok(bm.safe[0].fromClosed && !bm.safe[0].toClosed);
  assert.ok(eqF(bm.safe[1].from, 3, 2) && eqF(bm.safe[1].to, 2));
  assert.ok(!bm.safe[1].fromClosed && !bm.safe[1].toClosed);

  // 航段 1 / M2：全程安全
  assert.equal(r.segments[0].byMarker[1].occluded.length, 0);
  assert.equal(r.segments[0].byMarker[1].safe.length, 1);

  // 航段 2 / M1 × R2：t∈[2,3]，接触点 (8,4)→(9,6)
  const e2 = r.segments[1].entries.find((e) => e.markerIndex === 0 && e.rectIndex === 1);
  assert.ok(e2 && eqF(e2.tMin, 2) && eqF(e2.tMax, 3), e2 && `[${e2.tMin}, ${e2.tMax}]`);
  assert.ok(eqF(e2.contactMin.x, 8) && eqF(e2.contactMin.y, 4));
  assert.ok(eqF(e2.contactMax.x, 9) && eqF(e2.contactMax.y, 6));
});

test('checkScenario：全程安全', () => {
  const parsed = {
    keyframes: [{ t: F(0), p: P(0, 0) }, { t: F(2), p: P(10, 0) }],
    markers: [P(50, -50), P(60, -60)],
    rects: [Geo.rectFrom(4, 4, 2, 2)],
  };
  const r = Geo.checkScenario(parsed);
  assert.equal(r.ok, true);
  assert.equal(r.firstOcclusion, null);
});

/* ================= 圆形保护区：连续精确求解（非多边形、非抽样） ================= */
const isRad = (x) => x instanceof Geo.Rad;
// 校验 x = an/ad + (bn/bd)·√q
const eqRad = (x, an, ad, bn, bd, q) =>
  isRad(x) && x.a.eq(F(an, ad)) && x.b.eq(F(bn, bd)) && x.q === BigInt(q);

test('Rad：精确二次根式的比较与运算', () => {
  const x = new Geo.Rad(F(1, 2), F(-1, 4), 2n); // (2−√2)/4 ≈ 0.1464
  const y = new Geo.Rad(F(1, 2), F(1, 4), 2n);  // (2+√2)/4 ≈ 0.8536
  assert.ok(x.lt(F(0)) === false);
  assert.ok(x.gt(F(0)) && y.lt(F(1)));
  assert.ok(x.lt(y));
  // 不同二次域的精确比较
  const z = new Geo.Rad(F(0), F(1), 3n); // √3 ≈ 1.732
  assert.ok(y.lt(z));
  assert.ok(Math.abs(x.toNumber() - (2 - Math.SQRT2) / 4) < 1e-12);
});

test('circleSweep：相交区间的精确根式端点与圆周接触点', () => {
  // 相机 (0,0)→(10,0)，标记 (5,10)，圆心 (5,7) r=1
  // 解析解：垂足距离 ≤1 ⟺ |5−10u| ≤ √(25/2) ⟺ u ∈ [(2−√2)/4, (2+√2)/4]
  const sw = Geo.circleSweep(P(0, 0), P(10, 0), P(5, 10), Geo.circleFrom(5, 7, 1));
  assert.ok(sw);
  assert.equal(sw.intervals.length, 1);
  const iv = sw.intervals[0];
  assert.equal(iv.tangent, false);
  assert.ok(eqRad(iv.uMin, 1, 2, -1, 4, 2), iv.uMin.toString());
  assert.ok(eqRad(iv.uMax, 1, 2, 1, 4, 2), iv.uMax.toString());
  // 进入接触点（垂足，恰在圆周上）：(5 − 2√2/3, 22/3)
  const cp = iv.contactMin.point;
  assert.ok(eqRad(cp.x, 5, 1, -2, 3, 2), cp.x.toString());
  assert.ok(eqRad(cp.y, 22, 3, 0, 1, 1), cp.y.toString());
});

test('circleSweep：相机航线与圆相切退化为单点区间', () => {
  // 圆 (5,2) r=2 与航线 y=0 相切于 (5,0)（u=1/2）；标记在下方 (5,−10)
  const sw = Geo.circleSweep(P(0, 0), P(10, 0), P(5, -10), Geo.circleFrom(5, 2, 2));
  assert.ok(sw);
  assert.equal(sw.intervals.length, 1);
  const iv = sw.intervals[0];
  assert.equal(iv.tangent, true);
  assert.ok(iv.uMin.eq(F(1, 2)) && iv.uMax.eq(F(1, 2)));
  // 接触点即相切时刻的相机位置 (5,0)
  assert.ok(iv.contactMin.point.x.eq(F(5)) && iv.contactMin.point.y.eq(F(0)));
});

test('circleSweep：圆在航段内部仅于端点 u=0 擦到（单点相切）', () => {
  // u=0 视线为竖直线 x=0，圆 (−3,5) r=3 与之相切于 (0,5)
  const sw = Geo.circleSweep(P(0, 0), P(10, 0), P(0, 10), Geo.circleFrom(-3, 5, 3));
  assert.ok(sw && sw.intervals.length === 1);
  assert.ok(sw.intervals[0].tangent);
  assert.ok(sw.intervals[0].uMin.eq(F(0)));
});

test('circleSweep：相机穿过圆时区间覆盖相机穿圆段，接触点在圆周上', () => {
  // 相机沿 y=0 穿过圆 (5,0) r=2，标记在上方 (5,100)；相机自身穿圆 u∈[0.3,0.7]
  const sw = Geo.circleSweep(P(0, 0), P(10, 0), P(5, 100), Geo.circleFrom(5, 0, 2));
  assert.ok(sw);
  const iv = sw.intervals[0];
  assert.equal(iv.tangent, false);
  // 视线束遮挡区间覆盖整个相机穿圆段（两端因视线擦圆略向外展）
  assert.ok(iv.uMin.toNumber() < 0.3 && iv.uMax.toNumber() > 0.7);
  const onCircle = (cp) => {
    const dx = cp.point.x.toNumber() - 5, dy = cp.point.y.toNumber() - 0;
    return Math.abs(Math.hypot(dx, dy) - 2) < 1e-9;
  };
  assert.ok(onCircle(iv.contactMin) && onCircle(iv.contactMax));
});

test('circleSweep：相机静止时单条视线的整体遮挡', () => {
  // 静止相机 (0,0)→标记 (10,0)，圆 (5,0) r=4：线段与圆盘相交 ⇒ 全程遮挡
  const hit = Geo.circleSweep(P(0, 0), P(0, 0), P(10, 0), Geo.circleFrom(5, 0, 4));
  assert.ok(hit && hit.intervals[0].stationary);
  assert.ok(hit.intervals[0].uMin.eq(F(0)) && hit.intervals[0].uMax.eq(F(1)));
  assert.equal(Geo.circleSweep(P(0, 0), P(0, 0), P(10, 0), Geo.circleFrom(50, 0, 5)), null);
});

test('circleSweep：相机航线经过标记点的孤立时刻必须安全', () => {
  // u=1/2 时相机与标记 (5,0) 重合（视线退化为点），即便该点在圆附近也不得判遮挡
  assert.equal(Geo.circleSweep(P(0, 0), P(10, 0), P(5, 0), Geo.circleFrom(5, 6, 2)), null);
});

test('circleSweep：完全不相交返回 null', () => {
  assert.equal(Geo.circleSweep(P(0, 0), P(10, 0), P(5, 10), Geo.circleFrom(50, 50, 2)), null);
});

test('checkScenario：矩形+圆混合，最早遮挡证据精确指向圆', () => {
  // t∈[0,4]，span=4；圆遮挡 u∈[(2−√2)/4,(2+√2)/4] ⇒ t∈[2−√2, 2+√2]
  const parsed = {
    keyframes: [{ t: F(0), p: P(0, 0) }, { t: F(4), p: P(10, 0) }],
    markers: [P(5, 10)],
    rects: [Geo.rectFrom(40, 40, 4, 4)],
    circles: [Geo.circleFrom(5, 7, 1)],
  };
  const r = Geo.checkScenario(parsed);
  assert.equal(r.ok, false);
  const f = r.firstOcclusion;
  assert.equal(f.kind, 'circle');
  assert.equal(f.circleIndex, 0);
  assert.ok(eqRad(f.t, 2, 1, -1, 1, 2), f.t.toString()); // 2−√2
  assert.ok(Math.abs(f.t.toNumber() - (2 - Math.SQRT2)) < 1e-12);
  assert.ok(eqRad(f.camera.x, 5, 1, -5, 2, 2), f.camera.x.toString());
  // 报告中的合并区间同时记录圆编号；安全区间端点也是精确根式
  const bm = r.segments[0].byMarker[0];
  assert.equal(bm.occluded[0].circles[0], 0);
  assert.ok(eqRad(bm.safe[0].to, 2, 1, -1, 1, 2));
});

test('checkScenario：无 circles 字段（旧草稿）时结构与结论与旧版一致', () => {
  const parsed = {
    keyframes: [{ t: F(0), p: P(0, 0) }, { t: F(2), p: P(10, 0) }],
    markers: [P(5, 10)],
    rects: [Geo.rectFrom(4, 4, 2, 2)],
  };
  const r = Geo.checkScenario(parsed);
  assert.equal(r.ok, false);
  assert.equal(r.firstOcclusion.kind, 'rect');
  assert.ok(r.firstOcclusion.t.eq(F(1, 2)));
  const iv0 = r.segments[0].byMarker[0].occluded[0];
  assert.deepEqual(iv0.circles, []);
  assert.deepEqual(iv0.rects, [0]);
});
