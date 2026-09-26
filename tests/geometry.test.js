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

/* ================= 圆区：连续精确判定（非多边形、非抽样） ================= */
test('圆区扫描：相交区间端点为精确根式，接触点在圆周上', () => {
  // 相机 (0,0)→(10,0)，标记 (5,10)，圆心 (5,5) 半径 2
  // 解析解（光线从 (10u,0) 过 (5,10) 与圆相切）：
  //   u± = 1/2 ∓ (2√21)/21；接触点 = (5 ∓ 4√21/21, 29/5)
  const ivs = Geo.sweepCircleIntervals(P(0, 0), P(10, 0), P(5, 10), Geo.circleFrom(5, 5, 2));
  assert.equal(ivs.length, 1);
  const [v] = ivs;
  assert.equal(v.tangent, false);
  const wantLo = new Geo.Q2(F(1, 2), F(-2, 21), 21n);
  const wantHi = new Geo.Q2(F(1, 2), F(2, 21), 21n);
  assert.ok(Geo.Q2.eq(v.uMin, wantLo), `uMin=${Geo.Q2.from(v.uMin).toRadString()}`);
  assert.ok(Geo.Q2.eq(v.uMax, wantHi), `uMax=${Geo.Q2.from(v.uMax).toRadString()}`);
  // 接触点到圆心距离精确等于半径 2
  const onCircle = (Pt2) => {
    const dx = Pt2.x.sub(Geo.Q2.from(5n)), dy = Pt2.y.sub(Geo.Q2.from(5n));
    return dx.mul(dx).add(dy.mul(dy)).eq(Geo.Q2.from(4n));
  };
  assert.ok(onCircle(v.contactMin));
  assert.ok(onCircle(v.contactMax));
  assert.ok(Geo.Q2.eq(v.contactMin.y, Geo.Q2.from(29n).div(Geo.Q2.from(5n))));
});

test('圆区扫描：视线与圆单点相切被精确捕获（抽样极易漏检）', () => {
  // 相机 (−10,10)→(0,10)，标记 (0,0)，圆心 (3,5) 半径 3
  // 仅在 u=1 时视线 x=0 与圆相切于 (0,5)；之前全程不相交
  const ivs = Geo.sweepCircleIntervals(P(-10, 10), P(0, 10), P(0, 0), Geo.circleFrom(3, 5, 3));
  assert.equal(ivs.length, 1);
  const [v] = ivs;
  assert.ok(v.tangent && eqF(v.uMin, 1) && eqF(v.uMax, 1));
  assert.ok(Geo.Q2.eq(v.contactMin.x, Geo.Q2.from(0n)));
  assert.ok(Geo.Q2.eq(v.contactMin.y, Geo.Q2.from(5n)));
});

test('圆区扫描：相机路径与圆相切（判别式恰为零）', () => {
  // 相机 (0,0)→(10,0)，路径 y=0 与圆心 (5,3) r=3 在 u=1/2 单点相切
  const ivs = Geo.sweepCircleIntervals(P(0, 0), P(10, 0), P(5, -10), Geo.circleFrom(5, 3, 3));
  assert.equal(ivs.length, 1);
  assert.ok(ivs[0].tangent && eqF(ivs[0].uMin, 1, 2));
  assert.ok(eqF(Geo.Q2.from(ivs[0].contactMin.x).scalar(), 5));
  assert.ok(eqF(Geo.Q2.from(ivs[0].contactMin.y).scalar(), 0));
});

test('圆区扫描：持续遮挡区间端点精确为有理数', () => {
  // 相机 (−10,10)→(10,10)，标记 (0,0)，圆心 (0,5) 半径 3：
  // 光线斜率为 (10)/(10u)=1/u 的解析推导给出相切 u = ±1/8（相对中心），即 [1/8, 7/8]
  const ivs = Geo.sweepCircleIntervals(P(-10, 10), P(10, 10), P(0, 0), Geo.circleFrom(0, 5, 3));
  assert.equal(ivs.length, 1);
  const [v] = ivs;
  assert.equal(v.tangent, false);
  assert.ok(eqF(v.uMin, 1, 8) && eqF(v.uMax, 7, 8), `[${v.uMin}, ${v.uMax}]`);
  assert.ok(Geo.Q2.eq(v.contactMin.x, Geo.Q2.from(-12n).div(Geo.Q2.from(5n))));
  assert.ok(Geo.Q2.eq(v.contactMin.y, Geo.Q2.from(16n).div(Geo.Q2.from(5n))));
  assert.ok(Geo.Q2.eq(v.contactMax.x, Geo.Q2.from(12n).div(Geo.Q2.from(5n))));
  assert.ok(Geo.Q2.eq(v.contactMax.y, Geo.Q2.from(16n).div(Geo.Q2.from(5n))));
});

test('圆区扫描：相机静止（航段退化）', () => {
  const hit = Geo.sweepCircleIntervals(P(0, 0), P(0, 0), P(10, 0), Geo.circleFrom(5, 0, 2));
  assert.equal(hit.length, 1);
  assert.ok(hit[0].stationary && eqF(hit[0].uMin, 0) && eqF(hit[0].uMax, 1));
  const safe = Geo.sweepCircleIntervals(P(0, 0), P(0, 0), P(10, 0), Geo.circleFrom(20, 0, 1));
  assert.equal(safe.length, 0);
});

test('圆区扫描：全程不相交返回空', () => {
  const ivs = Geo.sweepCircleIntervals(P(0, 0), P(10, 0), P(5, 10), Geo.circleFrom(50, 50, 3));
  assert.deepEqual(ivs, []);
});

test('圆区扫描：解析解端点附近逐点状态一致（连续性自检）', () => {
  // 区间 [1/2∓2√21/21]：恰在区间外的两个有理时刻必安全，区间内中点必遮挡
  const A = P(0, 0), B = P(10, 0), M = P(5, 10), C = Geo.circleFrom(5, 5, 2);
  const ivs = Geo.sweepCircleIntervals(A, B, M, C);
  const lo = ivs[0].uMin.toNumber(), hi = ivs[0].uMax.toNumber();
  const stateAt = (u) => {
    const Cam = { x: A.x.add(B.x.sub(A.x).mul(F(Math.round(u * 1e9), 1e9))), y: A.y };
    return Geo.sightHitsCircle(Cam, M, C);
  };
  assert.equal(stateAt(lo - 0.01), false);
  assert.equal(stateAt((lo + hi) / 2), true);
  assert.equal(stateAt(hi + 0.01), false);
});

test('checkScenario：圆区最早遮挡证据（航段/标记/圆区/相机/圆周接触点）', () => {
  // K1(0,0)@0 → K2(10,0)@2；M(5,10)；圆 (5,5) r=2
  const parsed = {
    keyframes: [{ t: F(0), p: P(0, 0) }, { t: F(2), p: P(10, 0) }],
    markers: [P(5, 10)],
    rects: [Geo.rectFrom(40, 40, 2, 2)], // 与本场景无关的矩形，保证矩形链路仍参与
    circles: [Geo.circleFrom(5, 5, 2)],
  };
  const r = Geo.checkScenario(parsed);
  assert.equal(r.ok, false);
  const f = r.firstOcclusion;
  assert.equal(f.kind, 'circle');
  assert.equal(f.circleIndex, 0);
  assert.equal(f.rectIndex, -1);
  assert.equal(f.segmentIndex, 0);
  assert.equal(f.markerIndex, 0);
  // t = 0 + 2·uMin = 1 − 4√21/21
  assert.ok(Geo.Q2.eq(f.t, new Geo.Q2(F(1), F(-4, 21), 21n)), `t=${Geo.Q2.from(f.t).toRadString()}`);
  // 相机 x = 10·uMin = 5 − 20√21/21，y = 0
  assert.ok(Geo.Q2.eq(f.camera.y, Geo.Q2.from(0n)));
  // 接触点在圆周上
  const dx = f.contact.x.sub(Geo.Q2.from(5n)), dy = f.contact.y.sub(Geo.Q2.from(5n));
  assert.ok(dx.mul(dx).add(dy.mul(dy)).eq(Geo.Q2.from(4n)));
});

test('旧场景回归：无圆区时结论、区间与首项证据逐项不变', () => {
  const mk = () => ({
    keyframes: [{ t: F(0), p: P(0, 0) }, { t: F(2), p: P(10, 0) }, { t: F(4), p: P(10, 10) }],
    markers: [P(5, 10), P(50, -50)],
    rects: [Geo.rectFrom(4, 4, 2, 2), Geo.rectFrom(8, 4, 1, 2)],
  });
  const r1 = Geo.checkScenario(mk());           // 旧草稿：根本没有 circles 字段
  const r2 = Geo.checkScenario({ ...mk(), circles: [] }); // 显式空圆区
  assert.equal(r1.ok, false);
  assert.equal(r1.ok, r2.ok);
  assert.deepEqual(r1.firstOcclusion, r2.firstOcclusion);
  for (let i = 0; i < r1.segments.length; i++) {
    assert.deepEqual(r1.segments[i].byMarker, r2.segments[i].byMarker);
    // 首项证据（矩形条目）坐标均为 Frac
    for (const e of r1.segments[i].entries) {
      assert.ok(e.tMin instanceof Geo.Frac && e.tMax instanceof Geo.Frac);
      assert.ok(e.contactMin.x instanceof Geo.Frac);
    }
  }
});
