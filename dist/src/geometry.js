/*
 * geometry.js — 连续、精确的「视线段 × 保护矩形 / 保护圆」遮挡判定（BigInt 有理数与二次根式，非抽样）。
 *
 * 矩形场景：相机在相邻关键帧之间匀速直线移动，C(u) = A + u·(B−A)，u ∈ [0,1]。
 * 对每个固定标记点 M，所有时刻的视线段 C(u)M 的并集恰好是三角形 T = △ABM，因此
 *   视线段在参数 u 处与矩形 R 相交/相切  ⟺  存在 P ∈ T∩R 落在视线段 C(u)M 上。
 * 非退化时 P 的重心坐标唯一，u(P) = β/(α+β) 是线性分式（quasilinear）函数，
 * 在凸多边形 T∩R 的顶点处取得最值 ⇒ 遮挡参数区间 = 各顶点处 u 的最小/最大值。
 * 退化（A,B,M 共线）时改用投影参数 λ 的区间覆盖论证；A==B 时退化为单条视线段。
 *
 * 圆形场景：圆区不得离散为多边形。视线段 C(u)M 与圆盘 {|X−O|≤r} 相交/相切，当且仅当
 * O 到该线段的距离 ≤ r。对 u 做解析量化（全程二次以内，闭式精确求解）：
 *   q=C−O，w=M−C，m=M−O，e=M−A，d=B−A，
 *   G0(u)=|q|²−r² ≤ 0                       （相机自身在圆内/圆周上，二次）
 *   或垂足落在线段内部且
 *   V(u)=h(u)²−r²|w|² ≤ 0，L(u)=q·w ≤ 0，J(u)=w·m ≥ 0   （均不超过二次）
 * 其中 h=(C−O)×(M−O)、L 为二次、J 为一次。遮挡 u 集的边界只能是 G0/V 的实根；
 * 连同分段根 L/J/|w|² 一起，把 [0,1] 切成胞腔，各多项式在胞腔上符号恒定，逐胞腔精确判定。
 * 根是二次方程的精确解 a+b·√q（BigInt 有理数 a,b,q），不同圆产生的不同二次域之间
 * 仍通过（最多两次）平方作精确比较；相切天然表现为单点区间。
 * 全部不做任何时刻抽样，也不把圆周近似成多边形。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Geo = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /* ================= 精确有理数 ================= */
  function gcd(a, b) {
    a = a < 0n ? -a : a; b = b < 0n ? -b : b;
    while (b) { const t = a % b; a = b; b = t; }
    return a;
  }

  class Frac {
    constructor(num, den = 1n) {
      if (typeof num === 'number') num = BigInt(num);
      if (typeof den === 'number') den = BigInt(den);
      if (den === 0n) throw new Error('Frac: 分母为零');
      if (den < 0n) { num = -num; den = -den; }
      const g = gcd(num, den);
      this.n = num / g;
      this.d = den / g;
    }
    static of(x) { return x instanceof Frac ? x : new Frac(BigInt(x)); }
    add(o) { o = Frac.of(o); return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
    sub(o) { o = Frac.of(o); return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
    mul(o) { o = Frac.of(o); return new Frac(this.n * o.n, this.d * o.d); }
    div(o) { o = Frac.of(o); if (o.n === 0n) throw new Error('Frac: 除以零'); return new Frac(this.n * o.d, this.d * o.n); }
    neg() { return new Frac(-this.n, this.d); }
    cmp(o) { o = Frac.of(o); const l = this.n * o.d, r = o.n * this.d; return l < r ? -1 : l > r ? 1 : 0; }
    eq(o) { return this.cmp(o) === 0; }
    lt(o) { return this.cmp(o) < 0; }
    lte(o) { return this.cmp(o) <= 0; }
    gt(o) { return this.cmp(o) > 0; }
    gte(o) { return this.cmp(o) >= 0; }
    isZero() { return this.n === 0n; }
    toNumber() { return Number(this.n) / Number(this.d); }
    toString() { return this.d === 1n ? String(this.n) : `${this.n}/${this.d}`; }
  }

  // 严格解析十进制字符串（如 "2"、"-0.5"、"2.75"）为精确分数；非法返回 null
  const DEC_RE = /^([+-]?)(\d+)(?:\.(\d+))?$/;
  function tryParse(s) {
    if (typeof s !== 'string') return null;
    const m = DEC_RE.exec(s.trim());
    if (!m) return null;
    const sign = m[1] === '-' ? -1n : 1n;
    const frac = m[3] || '';
    const den = 10n ** BigInt(frac.length);
    return new Frac(sign * (BigInt(m[2]) * den + (frac ? BigInt(frac) : 0n)), den);
  }

  function decimalOf(f, maxPlaces) {
    let n = f.n; const d = f.d; const neg = n < 0n;
    if (neg) n = -n;
    const ip = n / d; let rem = n % d; let digits = '';
    while (rem !== 0n && digits.length < maxPlaces) { rem *= 10n; digits += (rem / d).toString(); rem %= d; }
    return { text: (neg ? '-' : '') + ip.toString() + (digits ? '.' + digits : ''), exact: rem === 0n };
  }
  // 十进制展示：能除尽则精确，否则加省略号
  function fmt(f, maxPlaces = 9) { const p = decimalOf(f, maxPlaces); return p.exact ? p.text : p.text + '…'; }
  // 同时给出分数形式，便于复核
  function fmtFull(f) { const s = fmt(f); return f.d === 1n ? s : `${s}（= ${f.n}/${f.d}）`; }

  /* ================= 点与矩形 ================= */
  const Pt = (x, y) => ({ x: Frac.of(x), y: Frac.of(y) });
  const rectFrom = (x, y, w, h) => {
    const fx = Frac.of(x), fy = Frac.of(y);
    return { x1: fx, y1: fy, x2: fx.add(Frac.of(w)), y2: fy.add(Frac.of(h)) };
  };
  function orient(a, b, c) {
    return b.x.sub(a.x).mul(c.y.sub(a.y)).sub(b.y.sub(a.y).mul(c.x.sub(a.x)));
  }
  function pointInRectClosed(p, r) {
    return p.x.gte(r.x1) && p.x.lte(r.x2) && p.y.gte(r.y1) && p.y.lte(r.y2);
  }

  /* ================= 点与圆 ================= */
  // {cx, cy, r}，半径为正 Frac
  const circleFrom = (cx, cy, r) => ({ cx: Frac.of(cx), cy: Frac.of(cy), r: Frac.of(r) });
  function pointInCircleClosed(p, c) {
    const dx = p.x.sub(c.cx), dy = p.y.sub(c.cy);
    return dx.mul(dx).add(dy.mul(dy)).lte(c.r.mul(c.r));
  }

  /* ================= 精确二次根式 a + b·√q（a,b,q 为精确分数/正整数；q=1 折叠为有理数） ================= */
  class Rad {
    constructor(a, b = F0(), q = 1n) {
      a = Frac.of(a); b = Frac.of(b); q = q < 0n ? -q : q;
      if (q === 1n) { a = a.add(b); b = F0(); } // √1 是有理数，并入 a
      this.a = a; this.b = b; this.q = q;
    }
    static of(x) {
      if (x instanceof Rad) return new Rad(x.a, x.b, x.q);
      return new Rad(Frac.of(x));
    }
    cmp(o) {
      o = Rad.of(o);
      if (this.q === o.q) return radSignHelper(this.a.sub(o.a), this.b.sub(o.b), this.q);
      // 不同二次域：判定 (a1−a2) + b1√q1 − b2√q2 的符号
      return sign3(this.a.sub(o.a), this.b, this.q, o.b.neg(), o.q);
    }
    eq(o) { return this.cmp(o) === 0; }
    lt(o) { return this.cmp(o) < 0; }
    lte(o) { return this.cmp(o) <= 0; }
    gt(o) { return this.cmp(o) > 0; }
    gte(o) { return this.cmp(o) >= 0; }
    isZero() { return this.a.isZero() && this.b.isZero(); }
    toNumber() { return this.a.toNumber() + this.b.toNumber() * Math.sqrt(Number(this.q)); }
    toString() {
      if (this.b.isZero()) return this.a.toString();
      const sign = this.b.n < 0n ? '−' : '+';
      const babs = this.b.n < 0n ? this.b.neg() : this.b;
      return `${fmt(this.a)} ${sign} ${fmt(babs)}√${this.q}（≈ ${this.toNumber().toFixed(6)}）`;
    }
  }
  function signFrac(f) { return f.n < 0n ? -1 : f.n > 0n ? 1 : 0; }
  // a + b·√q 的精确符号（q>1；异号时比平方）
  function radSignHelper(a, b, q) {
    const sa = signFrac(a), sb = signFrac(b);
    if (sb === 0) return sa;
    if (sa === 0) return sb;
    if (sa === sb) return sa;
    const s = a.mul(a).cmp(b.mul(b).mul(new Frac(q))); // a² 对 b²q
    return sa > 0 ? s : -s;
  }
  // A + B·√Q + C·√P 的精确符号（Q≠P，均 >1）
  function sign3(A, B, Q, C, P) {
    const sL = radSignHelper(A, B, Q); // L = A+B√Q
    const sR = signFrac(C);            // R = C√P
    if (sL === 0) return sR;
    if (sR === 0) return sL;
    if (sL === sR) return sL;          // 同号，和的符号确定
    // 异号：比 |L| 与 |R|，对平方 L²−R² 取符号
    const tau = radSignHelper(
      A.mul(A).add(B.mul(B).mul(new Frac(Q))).sub(C.mul(C).mul(new Frac(P))),
      new Frac(2n).mul(A).mul(B), Q);
    return sL * tau;
  }

  /* ================= u 的多项式（系数为精确 Frac，次数 ≤2） ================= */
  // poly: [c0, c1, c2] 表示 c0 + c1·u + c2·u²；缺项用 0
  function polyEval(p, u) {
    return p[0].add(p[1].mul(u)).add(p[2].mul(u.mul(u)));
  }

  // 求 p(u)=c0+c1u+c2u² 的全部实根（Rad），升序；polyRootsIn 再按区间过滤
  function polyRealRoots(p) {
    if (p[2].isZero()) {
      if (p[1].isZero()) return [];
      return [new Rad(p[0].neg().div(p[1]))];
    }
    const A = p[2], B = p[1], C = p[0];
    const disc = B.mul(B).sub(new Frac(4n).mul(A).mul(C));
    if (disc.n < 0n) return [];
    const twoA = new Frac(2n).mul(A);
    const a = B.neg().div(twoA);
    if (disc.n === 0n) return [new Rad(a)];
    // √disc = √(n/d) = √(n·d)/d；抽出平方因子 s²，记 q 无平方因子：√disc = s·√q/d
    const dn = disc.n, dd = disc.d;
    const q0 = dn * dd;
    const q = squareFree(q0);
    const s = isqrt(q0 / q); // 必为整数
    const mk = (sign) => new Rad(a, new Frac(sign * s).div(twoA.mul(new Frac(dd))), q);
    return [mk(-1n), mk(1n)].sort((x, y) => x.cmp(y));
  }

  // 求 p 在 [lo,hi] 内的全部实根（Rad，含端点），精确；返回升序去重
  function polyRootsIn(p, lo, hi) {
    return polyRealRoots(p).filter((u) => u.gte(new Rad(lo)) && u.lte(new Rad(hi)));
  }
  function isqrt(n) { // 向下取整平方根
    let x = n, y = (x + 1n) / 2n;
    while (y < x) { x = y; y = (x + n / x) / 2n; }
    return x;
  }
  // 无平方因子部分（仅用于根式展示化简；不化简也不影响正确性）
  function squareFree(n) {
    let q = n, k = 2n;
    while (k * k <= q) { const k2 = k * k; while (q % k2 === 0n) q /= k2; k++; }
    return q;
  }

  /* ============ 多边形裁剪（Sutherland–Hodgman，精确） ============ */
  function clipHalfPlane(poly, axis, bound, keepGe) {
    const val = (p) => (axis === 'x' ? p.x : p.y);
    const inside = (p) => (keepGe ? val(p).gte(bound) : val(p).lte(bound));
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = val(a).sub(bound), db = val(b).sub(bound);
      const ain = inside(a), bin = inside(b);
      if (ain) out.push(a);
      if (ain !== bin) { // 恰有一个端点在界内 ⇒ da≠db，可安全求交点
        const t = da.div(da.sub(db));
        out.push({ x: a.x.add(b.x.sub(a.x).mul(t)), y: a.y.add(b.y.sub(a.y).mul(t)) });
      }
    }
    return out;
  }
  function dedupe(poly) {
    const out = [];
    for (const p of poly) {
      const l = out[out.length - 1];
      if (!l || !l.x.eq(p.x) || !l.y.eq(p.y)) out.push(p);
    }
    if (out.length > 1) {
      const f = out[0], l = out[out.length - 1];
      if (f.x.eq(l.x) && f.y.eq(l.y)) out.pop();
    }
    return out;
  }
  function clipPolygonRect(poly, r) {
    let p = poly;
    p = clipHalfPlane(p, 'x', r.x1, true);
    p = clipHalfPlane(p, 'x', r.x2, false);
    p = clipHalfPlane(p, 'y', r.y1, true);
    p = clipHalfPlane(p, 'y', r.y2, false);
    return dedupe(p);
  }

  /* ================= 视线扫描 ================= */
  function cameraAt(A, B, u) {
    return { x: A.x.add(B.x.sub(A.x).mul(u)), y: A.y.add(B.y.sub(A.y).mul(u)) };
  }
  // 非退化三角形 ABM 中，点 P 被视线段 C(u)M 覆盖的唯一参数 u = β/(α+β) = β/(1−γ)
  function paramU(A, B, M, P) {
    const abx = B.x.sub(A.x), aby = B.y.sub(A.y);
    const amx = M.x.sub(A.x), amy = M.y.sub(A.y);
    const det = abx.mul(amy).sub(aby.mul(amx)); // (B−A)×(M−A)
    if (det.isZero()) return null;
    const apx = P.x.sub(A.x), apy = P.y.sub(A.y);
    const beta = apx.mul(amy).sub(apy.mul(amx)).div(det);  // (P−A)×(M−A)/det
    const gamma = abx.mul(apy).sub(aby.mul(apx)).div(det); // (B−A)×(P−A)/det
    const denom = new Frac(1n).sub(gamma); // = 0 仅当 P == M（调用方保证 M∉R）
    if (denom.isZero()) return null;
    return beta.div(denom);
  }

  const F0 = () => new Frac(0n), F1 = () => new Frac(1n);

  /*
   * 相机从 A 匀速移动到 B（u∈[0,1]），求视线段 C(u)M 与矩形 R 相交/相切的 u 区间。
   * 返回 null（全程安全）或 { uMin, uMax, contactMin, contactMax, ...标记 }，
   * 其中 contactMin/contactMax 是最早/最晚遮挡时视线与矩形的接触点（在矩形边界上，可复核）。
   */
  function sweepInterval(A, B, M, R) {
    if (pointInRectClosed(M, R)) { // 防御分支：配置校验本应拦截
      return { uMin: F0(), uMax: F1(), contactMin: M, contactMax: M, markerInside: true };
    }
    const poly = clipPolygonRect([A, B, M], R);
    if (!poly.length) return null;
    const abx = B.x.sub(A.x), aby = B.y.sub(A.y);
    if (abx.isZero() && aby.isZero()) { // 相机原地不动：单条视线段，要么全程遮挡要么安全
      return { uMin: F0(), uMax: F1(), contactMin: poly[0], contactMax: poly[0], stationary: true };
    }
    const det = orient(A, B, M);
    if (det.isZero()) {
      // A,B,M 共线：视线段始终在该直线上，用投影参数 λ 的区间覆盖判断。
      // 交点 λ 区间 [h1,h2] 必整体位于 m=λ(M) 的一侧（否则 M∈R，已被拦截）：
      //   h2 < m ⇒ 覆盖集 S = ⋃_{p≤h2}[0,p] = [0,h2]；h1 > m ⇒ S = [h1,1]。
      const len2 = abx.mul(abx).add(aby.mul(aby));
      const lam = (P) => P.x.sub(A.x).mul(abx).add(P.y.sub(A.y).mul(aby)).div(len2);
      const m = lam(M);
      let h1 = null, h2 = null;
      for (const V of poly) {
        const l = lam(V);
        if (h1 === null || l.lt(h1)) h1 = l;
        if (h2 === null || l.gt(h2)) h2 = l;
      }
      const at = (l) => ({ x: A.x.add(abx.mul(l)), y: A.y.add(aby.mul(l)) });
      let uMin, uMax;
      if (h2.lt(m)) { uMin = F0(); uMax = h2; } else { uMin = h1; uMax = F1(); }
      if (uMax.lt(F0()) || uMin.gt(F1())) return null;
      if (uMin.lt(F0())) uMin = F0();
      if (uMax.gt(F1())) uMax = F1();
      return { uMin, uMax, contactMin: at(h1), contactMax: at(h2), collinear: true };
    }
    // 一般情形：u(P) 是线性分式函数，最值在 T∩R 顶点处取得
    let uMin = null, uMax = null, cMin = null, cMax = null;
    for (const V of poly) {
      const u = paramU(A, B, M, V);
      if (!u) continue;
      if (uMin === null || u.lt(uMin)) { uMin = u; cMin = V; }
      if (uMax === null || u.gt(uMax)) { uMax = u; cMax = V; }
    }
    if (uMin === null) return null;
    return { uMin, uMax, contactMin: cMin, contactMax: cMax };
  }

  /* ================= 视线扫描 × 保护圆（连续精确，圆周不离散、时刻不抽样） ================= */
  // Rad 的同域四则（q 相同）；有理数视为 q=1，可与任意域相加减
  Object.assign(Rad.prototype, {
    add(o) {
      o = Rad.of(o);
      if (this.q === o.q) return new Rad(this.a.add(o.a), this.b.add(o.b), this.q);
      if (o.b.isZero()) return new Rad(this.a.add(o.a), this.b, this.q);
      if (this.b.isZero()) return new Rad(o.a.add(this.a), o.b, o.q);
      throw new Error('Rad.add：不同二次域不能直接相加');
    },
    sub(o) { return this.add(Rad.of(o).neg()); },
    neg() { return new Rad(this.a.neg(), this.b.neg(), this.q); },
    mulFrac(k) { k = Frac.of(k); return new Rad(this.a.mul(k), this.b.mul(k), this.q); },
    mul(o) {
      o = Rad.of(o);
      if (o.b.isZero()) return this.mulFrac(o.a);
      if (this.b.isZero()) return o.mulFrac(this.a);
      if (this.q !== o.q) throw new Error('Rad.mul：不同二次域');
      return new Rad(
        this.a.mul(o.a).add(this.b.mul(o.b).mul(new Frac(this.q))),
        this.a.mul(o.b).add(this.b.mul(o.a)),
        this.q);
    },
    div(o) {
      o = Rad.of(o);
      if (o.b.isZero()) return this.mulFrac(new Frac(1n).div(o.a));
      if (this.q !== o.q) throw new Error('Rad.div：不同二次域');
      const m = o.a.mul(o.a).sub(o.b.mul(o.b).mul(new Frac(this.q))); // 共轭分母
      return new Rad(
        this.a.mul(o.a).sub(this.b.mul(o.b).mul(new Frac(this.q))).div(m),
        this.b.mul(o.a).sub(this.a.mul(o.b)).div(m), this.q);
    },
  });
  const radOf = (f) => new Rad(Frac.of(f));
  const evalLin = (c, u) => radOf(c[0]).add(u.mulFrac(c[1])); // c0+c1·u，u 为 Rad

  // 区间（端点为 Rad，loOpen/hiOpen 仅用于视线退化为点的孤立剔除）
  const IV = (lo, hi, loOpen = false, hiOpen = false) => ({ lo, hi, loOpen, hiOpen });
  const cmpR = (x, y) => Rad.of(x).cmp(Rad.of(y));
  const minR = (x, y) => (cmpR(x, y) <= 0 ? Rad.of(x) : Rad.of(y));
  const maxR = (x, y) => (cmpR(x, y) >= 0 ? Rad.of(x) : Rad.of(y));
  const ZERO = () => new Rad(F0()), ONE = () => new Rad(F1());

  // 二次（含）以下多项式 p≤0 在 [0,1] 内的精确解集（闭区间数组）
  function quadLE(p) {
    const [c0, c1, c2] = p;
    if (c2.isZero()) {
      if (c1.isZero()) return c0.lte(F0()) ? [IV(ZERO(), ONE())] : [];
      const r = c0.neg().div(c1);
      if (c1.gt(F0())) return clampList([[F0(), r]]);   // u ≤ r
      return clampList([[r, F1()]]);                     // u ≥ r
    }
    const roots = polyRealRoots(p);
    const disc = c1.mul(c1).sub(new Frac(4n).mul(c2).mul(c0));
    if (disc.n < 0n) return c2.lt(F0()) ? [IV(ZERO(), ONE())] : [];
    if (disc.n === 0n) {
      if (c2.lt(F0())) return [IV(ZERO(), ONE())];       // 恒 ≤0，顶点取等
      return clampList([[roots[0], roots[0]]]);          // 仅顶点处相切
    }
    // 两个不同实根 α<β
    const [a, b] = roots;
    if (c2.gt(F0())) return clampList([[a, b]]);         // 开口向上：≤0 在两根之间
    return clampList([[F0(), a], [b, F1()]]);            // 开口向下：≤0 在两根之外
  }
  function clampList(list) { // [[lo,hi] Frac/Rad] → 与 [0,1] 求交
    const out = [];
    for (const [l, h] of list) {
      const lo = maxR(l, F0()), hi = minR(h, F1());
      if (cmpR(lo, hi) <= 0) out.push(IV(lo, hi));
    }
    return out;
  }
  // 一次式 c0+c1·u ≥ 0 的解集
  function linearGE(c0, c1) {
    if (c1.isZero()) return c0.gte(F0()) ? [IV(ZERO(), ONE())] : [];
    const r = c0.neg().div(c1);
    return clampList([c1.gt(F0()) ? [r, F1()] : [F0(), r]]);
  }
  function intersectSets(A, B) {
    const out = [];
    for (const a of A) for (const b of B) {
      const lo = cmpR(a.lo, b.lo) >= 0 ? a.lo : b.lo;
      const hi = cmpR(a.hi, b.hi) <= 0 ? a.hi : b.hi;
      const loOpen = (cmpR(lo, a.lo) === 0 && a.loOpen) || (cmpR(lo, b.lo) === 0 && b.loOpen);
      const hiOpen = (cmpR(hi, a.hi) === 0 && a.hiOpen) || (cmpR(hi, b.hi) === 0 && b.hiOpen);
      if (cmpR(lo, hi) < 0 || (cmpR(lo, hi) === 0 && !loOpen && !hiOpen)) out.push(IV(lo, hi, loOpen, hiOpen));
    }
    return out;
  }
  function unionSets(A, B) { // 区间集合并；相接点只要被其中一方闭包含即合并
    const all = A.concat(B).sort((x, y) => cmpR(x.lo, y.lo));
    const out = [];
    for (const iv of all) {
      const last = out[out.length - 1];
      if (last && (cmpR(iv.lo, last.hi) < 0
        || (cmpR(iv.lo, last.hi) === 0 && !(iv.loOpen && last.hiOpen)))) {
        if (cmpR(iv.hi, last.hi) > 0) { last.hi = iv.hi; last.hiOpen = iv.hiOpen; }
      } else out.push({ ...iv });
    }
    return out;
  }
  // 从区间集中剔除孤立点 u*（相机恰好与标记重合，视线退化为点，必安全）
  function subtractPoint(set, ustar) {
    const out = [];
    for (const iv of set) {
      if (cmpR(ustar, iv.lo) > 0 && cmpR(ustar, iv.hi) < 0) {
        out.push(IV(iv.lo, ustar, iv.loOpen, true), IV(ustar, iv.hi, true, iv.hiOpen));
      } else if (cmpR(ustar, iv.lo) === 0 && cmpR(ustar, iv.hi) !== 0) {
        out.push(IV(ustar, iv.hi, true, iv.hiOpen));
      } else if (cmpR(ustar, iv.hi) === 0 && cmpR(ustar, iv.lo) !== 0) {
        out.push(IV(iv.lo, ustar, iv.loOpen, true));
      } else if (cmpR(ustar, iv.lo) !== 0 || cmpR(ustar, iv.hi) !== 0) out.push(iv);
    }
    return out;
  }
  function inClosedSet(set, u) {
    return set.some((iv) => (cmpR(u, iv.lo) > 0 || (cmpR(u, iv.lo) === 0 && !iv.loOpen))
      && (cmpR(u, iv.hi) < 0 || (cmpR(u, iv.hi) === 0 && !iv.hiOpen)));
  }

  // 分数平方根：√(n/d) = s·√q/d（q 无平方因子），精确表示为 Rad
  Rad.sqrtFrac = function (f) {
    f = Frac.of(f);
    if (f.n < 0n) throw new Error('Rad.sqrtFrac：负数无实平方根');
    if (f.n === 0n) return new Rad(F0());
    const q0 = f.n * f.d;
    const q = squareFree(q0);
    const s = isqrt(q0 / q);
    return new Rad(F0(), new Frac(s).div(new Frac(f.d)), q);
  };

  // 相机在 u 处的位置（Rad 坐标）
  function cameraAtRad(A, d, u) {
    return { x: evalLin([A.x, d.x], u), y: evalLin([A.y, d.y], u) };
  }
  /*
   * 圆上「进入接触点」：在遮挡时刻 u，视线段与圆盘交集靠相机一端的点 P=C+s*·w。
   * 解 |C+s w−O|²=r²：W s² + 2L s + (|q|²−r²)=0，
   *   W=|w|²，L=q·w，h=q×w，Δ=W r²−h² ≥0，s*=(−L−√Δ)/W。
   * 相机在圆内时 s*=0；V=0 端点 Δ=0 即垂足（相切）；
   * 有理端点（u∈Q，含静止相机）Δ 退化为单一平方根 √(分数)，仍是精确 Rad。
   */
  function circleContact(A, B, M, c, u, entry = true) {
    const dx = B.x.sub(A.x), dy = B.y.sub(A.y);
    const C = cameraAtRad(A, { x: dx, y: dy }, u);
    const wx = radOf(M.x).sub(C.x), wy = radOf(M.y).sub(C.y);
    const qx = C.x.sub(radOf(c.cx)), qy = C.y.sub(radOf(c.cy));
    const W = wx.mul(wx).add(wy.mul(wy));
    const L = qx.mul(wx).add(qy.mul(wy));
    const h = qx.mul(wy).sub(qy.mul(wx));
    const rr = c.r.mul(c.r);
    const G0v = qx.mul(qx).add(qy.mul(qy)).sub(radOf(rr)); // 相机端：|C−O|²−r²
    // 进入接触点：相机在圆内/圆周（G0≤0）时，最近点即相机
    if (entry && G0v.lte(ZERO())) return { point: C, via: 'camera', s: ZERO() };
    const Delta = W.mulFrac(rr).sub(h.mul(h)); // = −V = W·r²−h² ≥ 0
    let s;
    if (Delta.isZero()) s = L.neg().div(W);     // V=0：垂足，圆周相切
    else if (G0v.isZero()) {
      // G0=0 时 Δ=L²（可能在二次域中），√Δ=|L| 由精确符号给出
      const absL = L.cmp(ZERO()) < 0 ? L.neg() : L;
      s = entry ? L.neg().sub(absL).div(W) : L.neg().add(absL).div(W);
    } else {
      // 其余无理端点只能是 V 根（Δ=0，已处理）；此处 u、Δ 必退化为有理数
      if (!u.b.isZero() || !Delta.b.isZero()) throw new Error('circleContact：内部不变量失败');
      const root = Rad.sqrtFrac(Delta.a);
      s = (entry ? radOf(L.a.neg()).sub(root) : radOf(L.a.neg()).add(root)).div(radOf(W.a));
    }
    return { point: { x: C.x.add(s.mul(wx)), y: C.y.add(s.mul(wy)) }, via: 'circle', s };
  }

  /*
   * 相机 A→B（u∈[0,1]），求视线段 C(u)M 与保护圆 c 相交/相切的全部 u 区间。
   * 返回 null 或 { intervals:[{uMin,uMax,tangent,contactMin,contactMax,viaMin,...}] }。
   * 端点是精确 Rad（二次根式）；相切 = 单点闭区间。
   */
  function circleSweep(A, B, M, c) {
    if (pointInCircleClosed(M, c)) { // 防御分支：配置校验本应拦截
      const cm = { point: radPoint(M), via: 'marker' };
      return { intervals: [{
        uMin: ZERO(), uMax: ONE(), loOpen: false, hiOpen: false, tangent: false,
        contactMin: cm, contactMax: cm, markerInside: true,
      }] };
    }
    const dx = B.x.sub(A.x), dy = B.y.sub(A.y);
    const stationary = dx.isZero() && dy.isZero();
    // q = C−O 系数，e = M−A，m = M−O
    const q0x = A.x.sub(c.cx), q0y = A.y.sub(c.cy);
    const ex = M.x.sub(A.x), ey = M.y.sub(A.y);
    const mx = M.x.sub(c.cx), my = M.y.sub(c.cy);
    const rr = c.r.mul(c.r);
    // h(u) = (C−O)×(M−O) = (q0+u·d)×m
    const h0 = q0x.mul(my).sub(q0y.mul(mx));
    const h1 = dx.mul(my).sub(dy.mul(mx));
    // 各二次多项式 [c0,c1,c2]
    const G0 = [
      q0x.mul(q0x).add(q0y.mul(q0y)).sub(rr),
      q0x.mul(dx).add(q0y.mul(dy)).mul(new Frac(2n)),
      dx.mul(dx).add(dy.mul(dy)),
    ];
    const Wp = [
      ex.mul(ex).add(ey.mul(ey)),
      ex.mul(dx).add(ey.mul(dy)).mul(new Frac(-2n)),
      dx.mul(dx).add(dy.mul(dy)),
    ];
    const Lp = [
      q0x.mul(ex).add(q0y.mul(ey)),
      dx.mul(ex).add(dy.mul(ey)).sub(q0x.mul(dx).add(q0y.mul(dy))),
      dx.mul(dx).add(dy.mul(dy)).neg(),
    ];
    const J0 = ex.mul(mx).add(ey.mul(my));
    const J1 = dx.mul(mx).add(dy.mul(my)).neg();
    const Vp = [
      h0.mul(h0).sub(rr.mul(Wp[0])),
      h0.mul(h1).mul(new Frac(2n)).sub(rr.mul(Wp[1])),
      h1.mul(h1).sub(rr.mul(Wp[2])),
    ];

    if (stationary) { // 单条固定视线段：要么全程遮挡要么安全
      const camInside = G0[0].lte(F0());
      if (!camInside) {
        const foot = intersectSets(intersectSets(quadLE(Vp), quadLE(Lp)), linearGE(J0, J1));
        if (!foot.length) return null;
      }
      const cm = circleContact(A, B, M, c, ZERO(), true);
      const cM = circleContact(A, B, M, c, ZERO(), false);
      return { intervals: [{
        uMin: ZERO(), uMax: ONE(), loOpen: false, hiOpen: false, tangent: false,
        contactMin: cm, contactMax: cM, stationary: true,
      }] };
    }

    // W>0：仅当相机航线经过标记点时剔除那个孤立 u（该时刻视线退化为点，必安全）
    let wSet = [IV(ZERO(), ONE())];
    if (!Wp[2].isZero()) {
      const ustar = Wp[1].neg().div(new Frac(2n).mul(Wp[2]));
      if (ustar.gt(F0()) && ustar.lt(F1()) && polyEval(Wp, ustar).isZero()) wSet = subtractPoint(wSet, ustar);
    } else if (Wp[0].isZero()) wSet = [];

    const gSet = quadLE(G0);
    const footSet = intersectSets(intersectSets(intersectSets(quadLE(Vp), quadLE(Lp)), linearGE(J0, J1)), wSet);
    const occ = unionSets(gSet, footSet).filter((iv) => cmpR(iv.lo, iv.hi) < 0
      || (cmpR(iv.lo, iv.hi) === 0 && !iv.loOpen && !iv.hiOpen));
    if (!occ.length) return null;

    const intervals = occ.map((iv) => ({
      uMin: iv.lo, uMax: iv.hi, loOpen: iv.loOpen, hiOpen: iv.hiOpen,
      tangent: cmpR(iv.lo, iv.hi) === 0,
      contactMin: circleContact(A, B, M, c, iv.lo, true),
      contactMax: circleContact(A, B, M, c, iv.hi, false),
    }));
    return { intervals };
  }
  const radPoint = (P) => ({ x: radOf(P.x), y: radOf(P.y) });


  /* ================= 区间并集与安全补集 ================= */
  // Frac 之间按 Frac 比；涉及圆（Rad 二次根式）时升级为 Rad 精确比较
  const asRad = (x) => (x instanceof Rad ? x : new Rad(Frac.of(x)));
  const cmpAny = (a, b) => (a instanceof Frac && b instanceof Frac) ? a.cmp(b) : asRad(a).cmp(asRad(b));
  const eqAny = (a, b) => cmpAny(a, b) === 0;

  function mergeIntervals(items) { // items: [{tMin,tMax,kind,...}]，闭区间（可带开端点标志），相邻/重叠即合并
    const sorted = items.slice().sort((a, b) => cmpAny(a.tMin, b.tMin) || cmpAny(a.tMax, b.tMax));
    const out = [];
    const absorb = (last, it) => {
      if (cmpAny(it.tMax, last.tMax) > 0) last.tMax = it.tMax;
      if (it.kind !== 'circle') last.rects.push(it.rectIndex);
      else last.circles.push(it.circleIndex);
    };
    for (const it of sorted) {
      const last = out[out.length - 1];
      const c = last ? cmpAny(it.tMin, last.tMax) : 1;
      if (last && c < 0) absorb(last, it);
      else if (last && c === 0 && !(last.hiOpen && it.loOpen)) absorb(last, it); // 相接且至少一方闭包含
      else out.push({
        tMin: it.tMin, tMax: it.tMax, loOpen: !!it.loOpen, hiOpen: !!it.hiOpen,
        rects: it.kind === 'circle' ? [] : [it.rectIndex],
        circles: it.kind === 'circle' ? [it.circleIndex] : [],
      });
    }
    for (const iv of out) iv.tangent = eqAny(iv.tMin, iv.tMax); // 单点区间 = 相切
    return out;
  }
  // 遮挡为闭区间（个别端点可开）⇒ 安全区间端点开闭取补；fromClosed/toClosed 标记
  function safeComplement(merged, t0, t1) {
    const safe = [];
    let cur = t0, first = true, curOpen = false;
    for (const iv of merged) {
      if (cmpAny(iv.tMin, cur) > 0) safe.push({ from: cur, to: iv.tMin, fromClosed: first && !curOpen, toClosed: !!iv.loOpen });
      if (cmpAny(iv.tMax, cur) > 0) { cur = iv.tMax; curOpen = !!iv.hiOpen; }
      first = false;
    }
    if (cmpAny(cur, t1) < 0) safe.push({ from: cur, to: t1, fromClosed: first && !curOpen, toClosed: true });
    return safe;
  }

  /* ================= 全场景校核 ================= */
  // parsed: { keyframes:[{t,p}], markers:[p], rects:[{x1,y1,x2,y2}], circles:[{cx,cy,r}] }（均为 Frac）
  function checkScenario(parsed) {
    const K = parsed.keyframes, Ms = parsed.markers, Rs = parsed.rects, Cs = parsed.circles || [];
    const segments = [];
    let first = null;
    for (let i = 0; i < K.length - 1; i++) {
      const A = K[i].p, B = K[i + 1].p, t0 = K[i].t, t1 = K[i + 1].t;
      const span = t1.sub(t0);
      const entries = [];
      const consider = (e) => {
        entries.push(e);
        if (!first || cmpAny(e.tMin, first.t) < 0) {
          first = e.kind === 'circle'
            ? { t: e.tMin, tMax: e.tMax, segmentIndex: i, markerIndex: e.markerIndex, kind: 'circle',
                circleIndex: e.circleIndex, u: e.uMin, camera: e.cameraMin, contact: e.contactMin,
                contactVia: e.viaMin, tangent: e.tangent }
            : { t: e.tMin, tMax: e.tMax, segmentIndex: i, markerIndex: e.markerIndex, kind: 'rect',
                rectIndex: e.rectIndex, u: e.uMin, camera: cameraAt(A, B, e.uMin), contact: e.contactMin, tangent: e.tangent };
        }
      };
      for (let mi = 0; mi < Ms.length; mi++) {
        for (let ri = 0; ri < Rs.length; ri++) {
          const sw = sweepInterval(A, B, Ms[mi], Rs[ri]);
          if (!sw) continue;
          consider({
            kind: 'rect', markerIndex: mi, rectIndex: ri,
            uMin: sw.uMin, uMax: sw.uMax,
            tMin: t0.add(sw.uMin.mul(span)), tMax: t0.add(sw.uMax.mul(span)),
            contactMin: sw.contactMin, contactMax: sw.contactMax,
            tangent: sw.uMin.eq(sw.uMax), loOpen: false, hiOpen: false,
            collinear: !!sw.collinear, stationary: !!sw.stationary, markerInside: !!sw.markerInside,
          });
        }
        for (let ci = 0; ci < Cs.length; ci++) {
          const sw = circleSweep(A, B, Ms[mi], Cs[ci]);
          if (!sw) continue;
          for (const iv2 of sw.intervals) {
            consider({
              kind: 'circle', markerIndex: mi, circleIndex: ci,
              uMin: iv2.uMin, uMax: iv2.uMax,
              tMin: radOf(t0).add(iv2.uMin.mulFrac(span)), tMax: radOf(t0).add(iv2.uMax.mulFrac(span)),
              loOpen: iv2.loOpen, hiOpen: iv2.hiOpen, tangent: iv2.tangent,
              contactMin: iv2.contactMin.point, contactMax: iv2.contactMax.point,
              viaMin: iv2.contactMin.via, viaMax: iv2.contactMax.via,
              cameraMin: cameraAtRad(A, { x: B.x.sub(A.x), y: B.y.sub(A.y) }, iv2.uMin),
              stationary: !!iv2.stationary, markerInside: !!iv2.markerInside,
            });
          }
        }
      }
      const byMarker = Ms.map((_, mi) => {
        const items = entries.filter((e) => e.markerIndex === mi);
        const occluded = mergeIntervals(items);
        const safe = safeComplement(occluded, t0, t1);
        return { markerIndex: mi, occluded, safe };
      });
      segments.push({ index: i, t0, t1, A, B, entries, byMarker });
    }
    return { ok: !first, firstOcclusion: first, segments, t0: K[0].t, t1: K[K.length - 1].t };
  }

  return {
    Frac, Rad, Pt, rectFrom, circleFrom, tryParse, fmt, fmtFull,
    orient, pointInRectClosed, pointInCircleClosed, clipPolygonRect, paramU, cameraAt,
    sweepInterval, circleSweep, cameraAtRad,
    mergeIntervals, safeComplement, checkScenario, cmpAny,
  };
});
