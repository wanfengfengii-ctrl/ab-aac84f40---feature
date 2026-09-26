/*
 * geometry.js — 连续、精确的「视线段 × 保护矩形」遮挡判定（BigInt 有理数，非抽样）。
 *
 * 场景：相机在相邻关键帧之间匀速直线移动，C(u) = A + u·(B−A)，u ∈ [0,1]。
 * 对每个固定标记点 M，所有时刻的视线段 C(u)M 的并集恰好是三角形 T = △ABM，因此
 *   视线段在参数 u 处与矩形 R 相交/相切  ⟺  存在 P ∈ T∩R 落在视线段 C(u)M 上。
 * 非退化时 P 的重心坐标唯一，u(P) = β/(α+β) 是线性分式（quasilinear）函数，
 * 在凸多边形 T∩R 的顶点处取得最值 ⇒ 遮挡参数区间 = 各顶点处 u 的最小/最大值。
 * 退化（A,B,M 共线）时改用投影参数 λ 的区间覆盖论证；A==B 时退化为单条视线段。
 * 全部使用 BigInt 分数运算：相切（区间退化为单点）也能精确捕获，不做任何时刻抽样。
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

  /* ============= 二次域 Q(√d) 精确代数数 =============
   * 圆与直线的相交/相切天然带平方根（切点含 √(d²−r²)，穿圆时刻含 √判别式），
   * 一般不是有理数，无法用 Frac 表示。数 x = p + q·√d（p,q∈Q，d 为非负整数，
   * d=0 表示有理数）在域内做精确 BigInt 四则与定号；不同根式域之间的大小比较用
   * 「整数平方根严格界」不断加细有理区间，直到区间严格分离才算出符号——
   * 相等先做代数判定，因此相切（相等）永远不会被误判成大小关系。全程无浮点抽样。
   */
  function isqrt(n) { // ⌊√n⌋（BigInt，牛顿迭代）
    if (n < 0n) throw new Error('isqrt: 负数');
    if (n < 2n) return n;
    let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
    for (;;) { const y = (x + n / x) >> 1n; if (y >= x) return x; x = y; }
  }
  function sfMul(a, b) { return a * b; }

  class Q2 {
    constructor(p, q = F0(), d = 0n) {
      this.p = p instanceof Frac ? p : new Frac(p);
      this.q = q instanceof Frac ? q : new Frac(q);
      this.d = BigInt(d);
      if (this.d !== 0n && this.q.isZero()) { this.d = 0n; }
    }
    // 不经归一化的内部构造（有理数置入指定根式域参与运算时需要）
    static raw(p, q, d) {
      const z = Object.create(Q2.prototype);
      z.p = p instanceof Frac ? p : new Frac(p);
      z.q = q instanceof Frac ? q : new Frac(q);
      z.d = BigInt(d);
      return z;
    }
    static from(x) { return x instanceof Q2 ? x : new Q2(Frac.of(x)); }
    isRational() { return this.d === 0n; }
    scalar() { return this.d === 0n ? this.p : null; }
    // 不同根式域仅在其中一方为有理标量时可运算：有理标量可置入任意域
    static _pair(x, y) {
      if (x.d === y.d) return [x, y];
      if (x.q.isZero()) return [Q2.raw(x.p, F0(), y.d), y];
      if (y.q.isZero()) return [x, Q2.raw(y.p, F0(), x.d)];
      throw new Error('Q2：两个不同无理域不可做四则运算（比较请走 Q2.cmp）');
    }
    add(o) { const [a, b] = Q2._pair(this, Q2.from(o)); return new Q2(a.p.add(b.p), a.q.add(b.q), a.d); }
    sub(o) { const [a, b] = Q2._pair(this, Q2.from(o)); return new Q2(a.p.sub(b.p), a.q.sub(b.q), a.d); }
    neg() { return new Q2(this.p.neg(), this.q.neg(), this.d); }
    mul(o) {
      const [a, b] = Q2._pair(this, Q2.from(o));
      const d = a.d;
      return new Q2(
        a.p.mul(b.p).add(a.q.mul(b.q).mul(new Frac(d))),
        a.p.mul(b.q).add(a.q.mul(b.p)), d);
    }
    mulF(f) { f = Frac.of(f); return new Q2(this.p.mul(f), this.q.mul(f), this.d); }
    addF(f) { f = Frac.of(f); return new Q2(this.p.add(f), this.q, this.d); }
    inv() {
      // 1/(p+q√d) = (p−q√d)/(p²−q²d)
      const den = this.p.mul(this.p).sub(this.q.mul(this.q).mul(new Frac(this.d)));
      if (den.isZero()) throw new Error('Q2.inv: 除以零');
      return new Q2(this.p.div(den), this.q.neg().div(den), this.d);
    }
    div(o) { const [a, b] = Q2._pair(this, Q2.from(o)); return a.mul(b.inv()); }
    // 域内精确定号：p+q√d 的符号（同域，直接 BigInt 比较）
    sign() {
      if (this.d === 0n) return this.p.isZero() ? 0 : (this.p.n < 0n ? -1 : 1);
      const sp = this.p.isZero() ? 0 : (this.p.n < 0n ? -1 : 1);
      const sq = this.q.isZero() ? 0 : (this.q.n < 0n ? -1 : 1);
      if (sq === 0) return sp;
      if (sp === 0) return sq;
      if (sp === sq) return sp; // p、q 同号 ⇒ 同号
      // 异号：比较 |q|√d 与 |p|
      const lhs = this.q.mul(this.q).mul(new Frac(this.d)); // q²d
      const rhs = this.p.mul(this.p);
      const c = lhs.cmp(rhs);
      return c === 0 ? 0 : (sq > 0 ? c : -c);
    }
    isZero() { return this.sign() === 0; }
    eq(o) { return Q2.eq(this, Q2.from(o)); }
    lt(o) { return this.cmp(o) < 0; }
    lte(o) { return this.cmp(o) <= 0; }
    gt(o) { return this.cmp(o) > 0; }
    gte(o) { return this.cmp(o) >= 0; }
    cmp(o) { return Q2.cmp(this, Q2.from(o)); }
    toNumber() {
      return Number(this.p.n) / Number(this.p.d) +
        (this.d ? Math.sqrt(Number(this.d)) * Number(this.q.n) / Number(this.q.d) : 0);
    }
    // 精确根式写法，供证据复核；有理数则与 Frac.toString 一致
    toRadString() {
      if (this.d === 0n) return this.p.toString();
      const qs = this.q.n < 0n ? ` - ${this.q.neg().toString()}·√${this.d}` : ` + ${this.q.toString()}·√${this.d}`;
      return `(${this.p.toString()}${qs})`;
    }
    // 严格有理界：lo ≤ x ≤ hi，两端为 Frac，宽度 ≤ 10^-k
    bounds(k) {
      if (this.d === 0n) return { lo: this.p, hi: this.p };
      const s = isqrt(this.d * (10n ** BigInt(2 * k))); // ⌊√d·10^k⌋
      const tenk = new Frac(10n ** BigInt(k));
      const rlo = new Frac(s).div(tenk), rhi = new Frac(s + 1n).div(tenk);
      const qn = this.q.n < 0n;
      const a = qn ? rhi : rlo, b = qn ? rlo : rhi; // q·√d 的严格界
      return { lo: this.p.add(this.q.mul(a)), hi: this.p.add(this.q.mul(b)) };
    }
  }

  // 把整数 n 写成 s²·d0（d0 无平方因子）；√n = s·√d0
  function squarefreePart(n) {
    let d0 = 1n, s = 1n;
    for (let p = 2n; p * p <= n; p++) {
      let e = 0n;
      while (n % p === 0n) { n /= p; e++; }
      s *= p ** (e >> 1n);
      if (e & 1n) d0 *= p;
    }
    if (n > 1n) d0 *= n; // 残余素因子次数为 1
    return { s, d0 };
  }

  // √f（f>0 的 Frac）：√(p/q) = √(pq)/q；先提出平方因子 s，落在无平方因子域 d0
  function sqrtFrac(f) {
    if (f.lt(F0())) throw new Error('sqrtFrac: 负数');
    if (f.isZero()) return new Q2(F0());
    const { s, d0 } = squarefreePart(sfMul(f.n, f.d));
    const coef = new Frac(s, f.d); // √(pq)/q = s·√d0/q
    if (d0 === 1n) return new Q2(coef); // 完全平方数 ⇒ 精确有理数
    return new Q2(F0(), coef, d0);
  }

  // 跨域相等判定：(p−p') + q√d1 = q'√d2。移项平方一次消去一个根式，
  // 必要时再平方，全部为 BigInt 有理等式，并回代原符号防止增根。
  function q2Eq(x, y) {
    if (x.d === y.d) return x.p.eq(y.p) && x.q.eq(y.q);
    if (x.d === 0n) { if (y.d === 0n) return x.p.eq(y.p); return false; } // 无理数 ≠ 有理数
    if (y.d === 0n) return false;
    // qx√d1 − qy√d2 = py − px = c
    const c = y.p.sub(x.p), X2 = x.q.mul(x.q).mul(new Frac(x.d));
    const Y2 = y.q.mul(y.q).mul(new Frac(y.d));
    // 平方：X2 + Y2 − 2 qx qy √(d1d2) = c²  ⟺  R = 2 qx qy √(d1d2)
    const R = X2.add(Y2).sub(c.mul(c));
    const coef = x.q.mul(y.q); // 含符号
    if (coef.isZero()) return R.isZero() && c.isZero() && x.q.isZero() === y.q.isZero();
    // R 必须为有理数且 R² = 4 qx² qy² d1 d2，且 R 与 coef 同号（回代）
    const rhs = new Frac(4n).mul(x.q.mul(x.q)).mul(y.q.mul(y.q)).mul(new Frac(x.d * y.d));
    if (!R.mul(R).eq(rhs)) return false;
    return (R.n < 0n) === (coef.n < 0n);
  }
  Q2.eq = (x, y) => q2Eq(x, y);

  // 跨域比较：先代数判等；否则按 k 倍增计算严格有理界，直到两区间严格分离。
  // 不相等的代数数必有间距，加细必然给出确定符号，绝无「近似相等」误判。
  function q2Cmp(x, y) {
    if (x.d === y.d) {
      const d = x.sub(y).sign();
      return d;
    }
    if (q2Eq(x, y)) return 0;
    for (let k = 8; k <= 256; k *= 2) {
      const bx = x.bounds(k), by = y.bounds(k);
      if (bx.hi.lt(by.lo)) return -1;
      if (bx.lo.gt(by.hi)) return 1;
    }
    throw new Error('Q2.cmp: 区间加细 256 位仍未分离（不应发生）');
  }
  Q2.cmp = (x, y) => q2Cmp(x, y);

  // 任意精确数（Frac 或 Q2）的比较/相等
  function numCmp(a, b) {
    a = Q2.from(a); b = Q2.from(b);
    return q2Cmp(a, b);
  }
  function numEq(a, b) { return numCmp(a, b) === 0; }
  function numLt(a, b) { return numCmp(a, b) < 0; }
  function numGt(a, b) { return numCmp(a, b) > 0; }
  // 有理数则转回 Frac（保持旧场景输出类型不变），否则保留 Q2
  function numScalar(x) { const s = Q2.from(x).scalar(); return s === null ? x : s; }
  // 展示：精确根式给出的高保证小数（下界截取，加省略号）
  function fmtAny(x, maxPlaces = 9) {
    const q = Q2.from(x);
    if (q.isRational()) return fmt(q.p, maxPlaces);
    return decimalOf(q.bounds(20).lo, maxPlaces).text + '…';
  }
  function fmtFullAny(x) {
    const q = Q2.from(x);
    if (q.isRational()) return fmtFull(q.p);
    const lo = q.bounds(16).lo.toNumber(), hi = q.bounds(16).hi.toNumber();
    return ((lo + hi) / 2).toFixed(9) + `…（精确值 ${q.toRadString()}）`;
  }

  /* ================= 点与矩形 ================= */
  const Pt = (x, y) => ({ x: Frac.of(x), y: Frac.of(y) });
  const rectFrom = (x, y, w, h) => {
    const fx = Frac.of(x), fy = Frac.of(y);
    return { x1: fx, y1: fy, x2: fx.add(Frac.of(w)), y2: fy.add(Frac.of(h)) };
  };
  // 圆形脆弱纹样保护区：{cx, cy, r}，半径为正
  const circleFrom = (cx, cy, r) => ({ cx: Frac.of(cx), cy: Frac.of(cy), r: Frac.of(r) });
  function orient(a, b, c) {
    return b.x.sub(a.x).mul(c.y.sub(a.y)).sub(b.y.sub(a.y).mul(c.x.sub(a.x)));
  }
  function pointInRectClosed(p, r) {
    return p.x.gte(r.x1) && p.x.lte(r.x2) && p.y.gte(r.y1) && p.y.lte(r.y2);
  }
  // 点是否落在圆区内（含圆周），全部为精确平方比较
  function pointInCircleClosed(p, c) {
    const dx = p.x.sub(c.cx), dy = p.y.sub(c.cy);
    return dx.mul(dx).add(dy.mul(dy)).lte(c.r.mul(c.r));
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

  /* ========== 圆区：连续精确扫描（精确二次域，非多边形、非抽样） ==========
   * 思路（全程精确，不以多边形近似圆周，也不抽样时刻）：
   *   相机 C(u)=A+uD 匀速移动，视线段为 C(u)M。对固定标记点 M（在圆外），
   *   「视线与圆相交/相切」的状态只能在两类精确边界时刻发生切换：
   *     (1) 视线与圆相切：切点必是 M 到圆的两条切线之一的切点 T（共 2 个，
   *         坐标为 Q(√d) 精确根式）；C(u)、T、M 共线是关于 u 的线性方程
   *         （|T+uD−M|²=r² 中二次项恰为 0），直接精确求 u，并校验 T∈线段C(u)M；
   *     (2) 相机自身穿过圆周：|A+uD−O|²=r²，精确二次方程求根。
   *   这些边界把 [0,1] 切成若干区间；在每个区间内取一个严格有理的代表 u
   *   （由相邻根式时刻的严格有理界构造），判定此刻相机是否在圆内或视线是否
   *   穿圆（Frac 系数二次方程，判别式精确定号）。区间内状态不变，
   *   故得到的是完整的遮挡闭区间（含单点相切），首次进入时刻被连续精确捕获。
   */
  const F2 = () => new Frac(2n);
  const toQ = (p) => Q2.from(p);
  const subP = (p, q) => ({ x: p.x.sub(q.x), y: p.y.sub(q.y) });
  const addP = (p, q) => ({ x: p.x.add(q.x), y: p.y.add(q.y) });
  const dotF = (p, q) => p.x.mul(q.x).add(p.y.mul(q.y));
  const crossF = (p, q) => p.x.mul(q.y).sub(p.y.mul(q.x));
  const crossQ = (p, q) => p.x.mul(q.y).sub(p.y.mul(q.x));
  function segPointFrac(P0, P1, s) {
    return { x: P0.x.add(P1.x.sub(P0.x).mul(s)), y: P0.y.add(P1.y.sub(P0.y).mul(s)) };
  }
  function segPointQ(P0, P1, s) {
    const d = { x: Q2.from(P1.x).sub(Q2.from(P0.x)), y: Q2.from(P1.y).sub(Q2.from(P0.y)) };
    return { x: Q2.from(P0.x).add(d.x.mul(s)), y: Q2.from(P0.y).add(d.y.mul(s)) };
  }
  function onSegmentQ(P0, P1, P) { // P0,P1 为 Frac/Q2 点，P 为 Q2 点；闭线段包含判定
    const ab = { x: Q2.from(P1.x).sub(Q2.from(P0.x)), y: Q2.from(P1.y).sub(Q2.from(P0.y)) };
    const ap = { x: P.x.sub(Q2.from(P0.x)), y: P.y.sub(Q2.from(P0.y)) };
    if (!crossQ(ab, ap).isZero()) return false;
    const between = (a, b, x) => {
      const lo = numCmp(a, b) <= 0 ? a : b, hi = numCmp(a, b) <= 0 ? b : a;
      return numCmp(x, lo) >= 0 && numCmp(x, hi) <= 0;
    };
    return between(Q2.from(P0.x), Q2.from(P1.x), P.x) && between(Q2.from(P0.y), Q2.from(P1.y), P.y);
  }

  // 线段 P0P1（Frac）与圆的全部交点参数 s（Q2，闭区间 [0,1]，已精确去重）
  function segCircleFrac(P0, P1, C) {
    const d = subP(P1, P0), e = subP(P0, { x: C.cx, y: C.cy });
    const a = dotF(d, d), b = F2().mul(dotF(d, e)), c = dotF(e, e).sub(C.r.mul(C.r));
    if (a.isZero()) { // 退化为点
      return c.lte(F0()) ? [F0()] : [];
    }
    const disc = b.mul(b).sub(new Frac(4n).mul(a).mul(c));
    if (disc.lt(F0())) return [];
    const sq = sqrtFrac(disc), twoA = F2().mul(a);
    const roots = [toQ(b.neg()).sub(sq).div(toQ(twoA)), toQ(b.neg()).add(sq).div(toQ(twoA))];
    const out = [];
    for (const s of roots) {
      if (numCmp(s, F0()) >= 0 && numCmp(s, F1()) <= 0 && !out.some((t) => numEq(s, t))) out.push(numScalar(s));
    }
    // 两端均在圆内（二次项在两端均为负）⇒ 整段在圆内，两圆周交点落在线段外
    if (!out.length && c.lt(F0()) && a.add(b).add(c).lt(F0())) return [F0(), F1()];
    return out;
  }
  // 仅判定线段 P0P1 是否与圆区相交/相切：只需判别式符号与根落区间，不求根、不开方
  function segCircleHits(P0, P1, C) {
    const d = subP(P1, P0), e = subP(P0, { x: C.cx, y: C.cy });
    const a = dotF(d, d);
    if (a.isZero()) return dotF(e, e).lte(C.r.mul(C.r));
    const b = F2().mul(dotF(d, e)), c = dotF(e, e).sub(C.r.mul(C.r));
    const disc = b.mul(b).sub(new Frac(4n).mul(a).mul(c));
    if (disc.lt(F0())) return false;
    // 根 s = (−b ± √disc)/(2a)（a>0）：区间 [0,1] 内有根 ⟺ f(0)=c≤0 或 f(1)≤0，
    // 或顶点 −b/2a ∈[0,1] 且判别式≥0。
    if (c.lte(F0())) return true;
    const f1 = a.add(b).add(c);
    if (f1.lte(F0())) return true;
    return b.lt(F0()) && b.add(a.mul(F2())).gt(F0());
  }
  // 视线（任意 Frac 线段）是否与圆区相交或相切（供逐时刻复核）
  function sightHitsCircle(P0, P1, C) {
    return segCircleHits(P0, P1, C);
  }

  // 圆外点 M 到圆的两个切点（Q(√d) 精确坐标）
  function tangentPoints(C, M) {
    const dx = M.x.sub(C.cx), dy = M.y.sub(C.cy);
    const L2 = dx.mul(dx).add(dy.mul(dy)), rr = C.r.mul(C.r);
    const t = rr.div(L2);
    const H = { x: C.cx.add(dx.mul(t)), y: C.cy.add(dy.mul(t)) };
    const k = sqrtFrac(rr.mul(L2.sub(rr))).div(toQ(L2)); // r√(L²−r²)/L²
    const ox = toQ(dy).mul(k), oy = toQ(dx).mul(k);
    return [
      { x: toQ(H.x).sub(ox), y: toQ(H.y).add(oy) },
      { x: toQ(H.x).add(ox), y: toQ(H.y).sub(oy) },
    ];
  }

  // 相切时刻：相机 C(u)=A+uD 与 M、切点 T（Q(√d)）共线。
  // cross(C(u)−M, T−M) = cross(A−M, T−M) + u·cross(D, T−M) = 0，精确求 u；接触点即 T。
  function tangentEvent(A, D, M, T) {
    const TM = { x: T.x.sub(toQ(M.x)), y: T.y.sub(toQ(M.y)) };
    const den = toQ(D.x).mul(TM.y).sub(toQ(D.y).mul(TM.x));
    if (den.isZero()) return null;
    const AM = { x: toQ(A.x).sub(toQ(M.x)), y: toQ(A.y).sub(toQ(M.y)) };
    const u = AM.x.mul(TM.y).sub(AM.y.mul(TM.x)).div(den).neg();
    if (numCmp(u, F0()) < 0 || numCmp(u, F1()) > 0) return null;
    return { u: numScalar(u), G: T };
  }

  // 相机路径直线穿圆：|A+uD−O|²=r² 的根（Q2），接触点即相机自身位置
  function cameraPathRoots(A, D, C) {
    const e = subP(A, { x: C.cx, y: C.cy });
    const a = dotF(D, D), b = F2().mul(dotF(D, e)), c = dotF(e, e).sub(C.r.mul(C.r));
    const disc = b.mul(b).sub(new Frac(4n).mul(a).mul(c));
    if (disc.lt(F0())) return [];
    const sq = sqrtFrac(disc), twoA = F2().mul(a);
    const roots = [toQ(b.neg()).sub(sq).div(toQ(twoA)), toQ(b.neg()).add(sq).div(toQ(twoA))];
    const out = [];
    for (const u of roots) {
      if (numCmp(u, F0()) >= 0 && numCmp(u, F1()) <= 0 && !out.some((e2) => numEq(e2.u, u))) {
        const uu = numScalar(u);
        out.push({ u: uu, G: { x: toQ(A.x).add(toQ(D.x).mul(u)), y: toQ(A.y).add(toQ(D.y).mul(u)) } });
      }
    }
    return out;
  }

  // 严格位于 lo<hi 之间的有理数（用整数平方根的严格界构造）
  function rationalBetween(lo, hi) {
    lo = toQ(lo); hi = toQ(hi);
    for (let k = 6; k <= 200; k *= 2) {
      const bl = lo.bounds(k), bh = hi.bounds(k);
      if (bl.hi.lt(bh.lo)) return bl.hi.add(bh.lo).div(F2());
    }
    throw new Error('rationalBetween：有理界构造失败');
  }

  // 相机在有理参数 u 处：是否在圆内或视线穿圆（状态在事件区间内不变）；
  // 只需定号，不求根式根，避免大数因式分解。
  function occludedAtRational(A, B, M, C, u) {
    const P = segPointFrac(A, B, u);
    if (pointInCircleClosed(P, C)) return true;
    return segCircleHits(P, M, C);
  }
  // 相机点 P（Frac）视线穿圆时，近相机侧圆周交点（Q2）；P 在圆内则取 P
  function nearContact(P, M, C) {
    if (pointInCircleClosed(P, C)) return P;
    const ss = segCircleFrac(P, M, C).sort((x, y) => numCmp(x, y));
    return ss.length ? segPointQ(P, M, Q2.from(ss[0])) : P;
  }

  // 圆区扫描：返回遮挡区间数组（一般 0–2 段；相切为单点区间）。
  // 接触点坐标为 Q(√d) 精确点（圆周上），供证据复核。
  function sweepCircleIntervals(A, B, M, C) {
    if (pointInCircleClosed(M, C)) { // 防御分支：配置校验本应拦截
      return [{ uMin: F0(), uMax: F1(), contactMin: M, contactMax: M, markerInside: true }];
    }
    const D = subP(B, A), stationary = D.x.isZero() && D.y.isZero();
    const Ainside = pointInCircleClosed(A, C);
    if (stationary) { // 相机原地不动：单条视线，状态全程一致
      if (Ainside) return [{ uMin: F0(), uMax: F1(), contactMin: A, contactMax: A, stationary: true }];
      const ss = segCircleFrac(A, M, C).sort((x, y) => numCmp(x, y));
      if (!ss.length) return [];
      const P = segPointQ(A, M, toQ(ss[0]));
      return [{ uMin: F0(), uMax: F1(), contactMin: P, contactMax: P, stationary: true }];
    }

    // 收集全部精确切换事件 {u, G}（相切时刻/相机穿越圆周时刻）
    let events = cameraPathRoots(A, D, C);
    // 视线相切事件与相机是否在圆内无关（相机穿出后仍可能有一段视线遮挡，止于相切）：
    for (const T of tangentPoints(C, M)) {
      const e2 = tangentEvent(A, D, M, T);
      if (e2) {
        // 校验切点确实位于该时刻的视线段 C(u)M 上（共线由求根保证，此处验闭线段）
        const Cam = segPointQ(A, B, Q2.from(e2.u));
        if (onSegmentQ(M, { x: numScalar(Cam.x), y: numScalar(Cam.y) }, T) &&
            !events.some((g) => numEq(g.u, e2.u))) events.push(e2);
      }
    }
    events.sort((a, b) => numCmp(a.u, b.u));

    const Binside = pointInCircleClosed(B, C);
    if (!events.length) { // 无任何切换：状态全程一致（直接用完整遮挡谓词判端点）
      return occludedAtRational(A, B, M, C, F0())
        ? [{ uMin: F0(), uMax: F1(),
             contactMin: nearContact(A, M, C), contactMax: nearContact(B, M, C) }]
        : [];
    }
    const eventAt = (u) => events.find((e) => numEq(e.u, u));
    // 端点（非事件）处视线与圆的近相机交点（在圆周上）
    const boundaryContact = (u) => {
      const P = segPointFrac(A, B, u);
      const ss = segCircleFrac(P, M, C).sort((x, y) => numCmp(x, y));
      return ss.length ? segPointQ(P, M, toQ(ss[0])) : P;
    };

    // 被遮挡的闭片段：事件点恒遮挡；相邻事件之间的开区间用严格有理内点判态。
    // 遮挡片段必然覆盖其两端事件点，故只需收集「遮挡间隙」再并入未覆盖的事件点。
    const pieces = [];
    const pushPiece = (a, b, Ga, Gb) => pieces.push({ a, b, Ga, Gb });
    const us = events.map((e) => e.u);
    if (numLt(us[0], F0()) || numGt(us[us.length - 1], F1())) return []; // 防御
    if (numGt(us[0], F0())) { // 首间隙 [0, u0)
      if (occludedAtRational(A, B, M, C, F0())) pushPiece(F0(), us[0], boundaryContact(F0()), eventAt(us[0]).G);
    }
    for (let i = 0; i + 1 < us.length; i++) {
      if (numEq(us[i], us[i + 1])) continue;
      if (occludedAtRational(A, B, M, C, rationalBetween(us[i], us[i + 1])))
        pushPiece(us[i], us[i + 1], eventAt(us[i]).G, eventAt(us[i + 1]).G);
    }
    if (numLt(us[us.length - 1], F1())) { // 尾间隙 (un, 1]
      if (occludedAtRational(A, B, M, C, F1()))
        pushPiece(us[us.length - 1], F1(), eventAt(us[us.length - 1]).G, boundaryContact(F1()));
    }
    for (const u of us) { // 未被遮挡间隙覆盖的事件点 = 单点相切
      if (!pieces.some((p) => numCmp(u, p.a) >= 0 && numCmp(u, p.b) <= 0)) {
        const G = eventAt(u).G;
        pushPiece(u, u, G, G);
      }
    }
    pieces.sort((p, q) => numCmp(p.a, q.a) || numCmp(p.b, q.b));

    // 合并端点相接的闭片段
    const merged = [];
    for (const p of pieces) {
      const last = merged[merged.length - 1];
      if (last && numCmp(p.a, last.b) <= 0) {
        if (numGt(p.b, last.b)) { last.b = p.b; last.Gb = p.Gb; }
      } else merged.push({ ...p });
    }
    return merged.map((g) => ({
      uMin: numScalar(g.a), uMax: numScalar(g.b),
      contactMin: g.Ga, contactMax: g.Gb, tangent: numEq(g.a, g.b),
    }));
  }

  /* ================= 区间并集与安全补集 ================= */
  // items: [{tMin,tMax,rectIndex}]（均为 Frac），闭区间，相邻/重叠即合并
  function mergeIntervals(items) {
    const out = [];
    const sorted = items.slice().sort((a, b) => a.tMin.cmp(b.tMin) || a.tMax.cmp(b.tMax));
    for (const it of sorted) {
      const last = out[out.length - 1];
      if (last && it.tMin.lte(last.tMax)) {
        if (it.tMax.gt(last.tMax)) last.tMax = it.tMax;
        last.rects.push(it.rectIndex);
      } else {
        out.push({ tMin: it.tMin, tMax: it.tMax, rects: [it.rectIndex] });
      }
    }
    for (const iv of out) iv.tangent = iv.tMin.eq(iv.tMax); // 单点区间 = 相切
    return out;
  }

  // 混合保护区（矩形 Frac 端点 / 圆区 Q(√d) 端点）的通用闭区间合并；
  // 无圆区时端点经 numScalar 仍为 Frac，结论与 mergeIntervals 逐点一致（旧场景回归）。
  function mergeBlocked(items) {
    const sorted = items.slice().sort(
      (a, b) => numCmp(a.tMin, b.tMin) || numCmp(a.tMax, b.tMax));
    const out = [];
    for (const it of sorted) {
      const last = out[out.length - 1];
      if (last && numCmp(it.tMin, last.tMax) <= 0) {
        if (numGt(it.tMax, last.tMax)) last.tMax = it.tMax;
        for (const s of it.sources) last.sources.push(s);
      } else {
        out.push({ tMin: it.tMin, tMax: it.tMax, sources: it.sources.slice() });
      }
    }
    return out.map((iv) => ({
      tMin: numScalar(iv.tMin), tMax: numScalar(iv.tMax),
      tangent: numEq(iv.tMin, iv.tMax),
      rects: iv.sources.filter((s) => s.kind === 'rect').map((s) => s.index),
      circles: iv.sources.filter((s) => s.kind === 'circle').map((s) => s.index),
    }));
  }
  // 遮挡为闭区间 ⇒ 安全区间为开/半开区间，fromClosed/toClosed 标记端点开闭（Frac/Q2 通用）
  function safeComplement(merged, t0, t1) {
    const safe = [];
    let cur = t0, first = true;
    for (const iv of merged) {
      if (numGt(iv.tMin, cur)) safe.push({ from: numScalar(cur), to: numScalar(iv.tMin), fromClosed: first, toClosed: false });
      if (numGt(iv.tMax, cur)) cur = iv.tMax;
      first = false;
    }
    if (numLt(cur, t1)) safe.push({ from: numScalar(cur), to: t1, fromClosed: first, toClosed: true });
    return safe;
  }

  /* ================= 全场景校核 ================= */
  // parsed: { keyframes:[{t,p}], markers:[p], rects:[{x1,y1,x2,y2}], circles:[{cx,cy,r}] }
  // 矩形全部为 Frac；圆区扫描端点为 Q(√d) 精确代数数。无圆区时走纯 Frac 路径，
  // 结论、区间、首项证据与旧版本完全一致（见旧场景回归测试）。
  function checkScenario(parsed) {
    const K = parsed.keyframes, Ms = parsed.markers;
    const Rs = parsed.rects || [], Cs = parsed.circles || [];
    const segments = [];
    let first = null;
    const consider = (e, i, mi) => {
      if (!first || numLt(e.tMin, first.t)) {
        const cam = e.kind === 'rect'
          ? cameraAt(K[i].p, K[i + 1].p, e.uMin)
          : segPointQ(K[i].p, K[i + 1].p, Q2.from(e.uMin));
        first = {
          t: numScalar(e.tMin), tMax: numScalar(e.tMax),
          segmentIndex: i, markerIndex: mi, kind: e.kind,
          rectIndex: e.kind === 'rect' ? e.zoneIndex : -1,
          circleIndex: e.kind === 'circle' ? e.zoneIndex : -1,
          u: numScalar(e.uMin), camera: cam, contact: e.contactMin, tangent: e.tangent,
        };
      }
    };
    for (let i = 0; i < K.length - 1; i++) {
      const A = K[i].p, B = K[i + 1].p, t0 = K[i].t, t1 = K[i + 1].t;
      const span = t1.sub(t0);
      const entries = [];
      const addEntry = (kind, mi, zi, sw) => {
        const u0 = numScalar(sw.uMin), u1 = numScalar(sw.uMax);
        // 矩形端点恒为 Frac：保持精确 Frac 时刻（旧场景逐点回归）；
        // 圆区端点可能为 Q(√d)：时刻同域精确表示。
        const tMin = u0 instanceof Frac ? t0.add(u0.mul(span))
          : numScalar(Q2.from(t0).add(Q2.from(u0).mul(Q2.from(span))));
        const tMax = u1 instanceof Frac ? t0.add(u1.mul(span))
          : numScalar(Q2.from(t0).add(Q2.from(u1).mul(Q2.from(span))));
        const e = {
          kind, markerIndex: mi, zoneIndex: zi,
          rectIndex: kind === 'rect' ? zi : -1, circleIndex: kind === 'circle' ? zi : -1,
          uMin: u0, uMax: u1, tMin, tMax,
          contactMin: sw.contactMin, contactMax: sw.contactMax,
          tangent: numEq(u0, u1),
          collinear: !!sw.collinear, stationary: !!sw.stationary, markerInside: !!sw.markerInside,
        };
        entries.push(e);
        consider(e, i, mi);
      };
      for (let mi = 0; mi < Ms.length; mi++) {
        for (let ri = 0; ri < Rs.length; ri++) {
          const sw = sweepInterval(A, B, Ms[mi], Rs[ri]);
          if (sw) addEntry('rect', mi, ri, sw);
        }
        for (let ci = 0; ci < Cs.length; ci++) {
          for (const sw of sweepCircleIntervals(A, B, Ms[mi], Cs[ci])) addEntry('circle', mi, ci, sw);
        }
      }
      const byMarker = Ms.map((_, mi) => {
        const mine = entries.filter((e) => e.markerIndex === mi);
        const occluded = Cs.length
          ? mergeBlocked(mine.map((e) => ({
              tMin: e.tMin, tMax: e.tMax,
              sources: [{ kind: e.kind, index: e.zoneIndex }],
            })))
          : mergeIntervals(mine.filter((e) => e.kind === 'rect')
              .map((e) => ({ tMin: e.tMin, tMax: e.tMax, rectIndex: e.zoneIndex })));
        const safe = safeComplement(occluded, t0, t1);
        return { markerIndex: mi, occluded, safe };
      });
      segments.push({ index: i, t0, t1, A, B, entries, byMarker });
    }
    return { ok: !first, firstOcclusion: first, segments, t0: K[0].t, t1: K[K.length - 1].t };
  }

  return {
    Frac, Q2, Pt, rectFrom, circleFrom, tryParse, fmt, fmtFull, fmtAny, fmtFullAny,
    orient, pointInRectClosed, pointInCircleClosed, sightHitsCircle,
    clipPolygonRect, paramU, cameraAt,
    sweepInterval, sweepCircleIntervals, tangentPoints, segCircleFrac,
    mergeIntervals, mergeBlocked, safeComplement, checkScenario,
  };
});
