/*
 * validate.js — 拍摄配置的合法性校验（数量、时间严格递增、边界、标记点/相机不得落入保护矩形或保护圆）。
 * 浏览器与 Node 双端可用；校验通过时返回解析好的精确（Frac）场景供 checkScenario 使用。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./geometry.js'));
  else root.Validate = factory(root.Geo);
})(typeof self !== 'undefined' ? self : globalThis, function (Geo) {
  'use strict';

  const LIMITS = { keyframes: [2, 4], markers: [2, 6], rects: [1, 4], circles: [0, 3] };

  // raw: { keyframes:[{tStr,x,y}], markers:[{x,y}], rects:[{x,y,w,h}], circles:[{cx,cy,r}] }；opts: {width,height}
  function scenario(raw, opts) {
    const errors = [];
    const W = opts && opts.width, H = opts && opts.height;
    const kf = raw.keyframes || [], mk = raw.markers || [], rc = raw.rects || [], cc = raw.circles || [];

    if (kf.length < LIMITS.keyframes[0] || kf.length > LIMITS.keyframes[1])
      errors.push(`相机关键帧数量须为 ${LIMITS.keyframes[0]}–${LIMITS.keyframes[1]} 个（当前 ${kf.length} 个）`);
    if (mk.length < LIMITS.markers[0] || mk.length > LIMITS.markers[1])
      errors.push(`标记点数量须为 ${LIMITS.markers[0]}–${LIMITS.markers[1]} 个（当前 ${mk.length} 个）`);
    if (rc.length < LIMITS.rects[0] || rc.length > LIMITS.rects[1])
      errors.push(`保护矩形数量须为 ${LIMITS.rects[0]}–${LIMITS.rects[1]} 个（当前 ${rc.length} 个）`);
    if (cc.length > LIMITS.circles[1])
      errors.push(`圆形脆弱纹样保护区最多 ${LIMITS.circles[1]} 个（当前 ${cc.length} 个）`);

    const ts = [];
    kf.forEach((k, i) => {
      const t = Geo.tryParse(String(k.tStr == null ? '' : k.tStr));
      if (!t) errors.push(`关键帧 K${i + 1} 的时间「${k.tStr}」无法解析`);
      ts.push(t);
    });
    for (let i = 0; i + 1 < ts.length; i++) {
      if (ts[i] && ts[i + 1] && ts[i].cmp(ts[i + 1]) >= 0)
        errors.push(`关键帧时间须严格递增：K${i + 1}（${kf[i].tStr}）不小于 K${i + 2}（${kf[i + 1].tStr}）`);
    }

    const finite = (v) => Number.isFinite(v);
    const inBounds = (x, y) => W == null || (x >= 0 && x <= W && y >= 0 && y <= H);
    kf.forEach((k, i) => {
      if (!finite(k.x) || !finite(k.y)) errors.push(`关键帧 K${i + 1} 坐标无效`);
      else if (!inBounds(k.x, k.y)) errors.push(`关键帧 K${i + 1} 超出画布范围`);
    });
    mk.forEach((m, i) => {
      if (!finite(m.x) || !finite(m.y)) errors.push(`标记点 M${i + 1} 坐标无效`);
      else if (!inBounds(m.x, m.y)) errors.push(`标记点 M${i + 1} 超出画布范围`);
    });
    rc.forEach((r, i) => {
      if (![r.x, r.y, r.w, r.h].every(finite)) errors.push(`保护矩形 R${i + 1} 参数无效`);
      else if (!(r.w >= 4 && r.h >= 4)) errors.push(`保护矩形 R${i + 1} 的宽、高均须 ≥ 4`);
      else if (W != null && (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H)) errors.push(`保护矩形 R${i + 1} 超出画布范围`);
    });
    cc.forEach((c, i) => {
      if (![c.cx, c.cy, c.r].every(finite)) errors.push(`圆形保护区 C${i + 1} 参数无效`);
      else if (!(c.r >= 4)) errors.push(`圆形保护区 C${i + 1} 的半径须 ≥ 4`);
      else if (W != null && (c.cx - c.r < 0 || c.cy - c.r < 0 || c.cx + c.r > W || c.cy + c.r > H))
        errors.push(`圆形保护区 C${i + 1} 超出画布范围`);
    });

    if (errors.length) return { errors, parsed: null };

    const parsed = { keyframes: [], markers: [], rects: [], circles: [] };
    kf.forEach((k, i) => parsed.keyframes.push({ t: ts[i], p: Geo.Pt(Math.round(k.x), Math.round(k.y)) }));
    mk.forEach((m) => parsed.markers.push(Geo.Pt(Math.round(m.x), Math.round(m.y))));
    rc.forEach((r) => parsed.rects.push(Geo.rectFrom(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h))));
    cc.forEach((c) => parsed.circles.push(Geo.circleFrom(Math.round(c.cx), Math.round(c.cy), Math.round(c.r))));

    parsed.markers.forEach((M, mi) => parsed.rects.forEach((R, ri) => {
      if (Geo.pointInRectClosed(M, R)) errors.push(`标记点 M${mi + 1} 落在保护矩形 R${ri + 1} 内（或边界上），不允许`);
    }));
    parsed.keyframes.forEach((K, ki) => parsed.rects.forEach((R, ri) => {
      if (Geo.pointInRectClosed(K.p, R)) errors.push(`关键帧 K${ki + 1} 的相机位置落在保护矩形 R${ri + 1} 内（或边界上），不允许`);
    }));
    parsed.markers.forEach((M, mi) => parsed.circles.forEach((C, ci) => {
      if (Geo.pointInCircleClosed(M, C)) errors.push(`标记点 M${mi + 1} 落在圆形保护区 C${ci + 1} 内（或圆周上），不允许`);
    }));
    parsed.keyframes.forEach((K, ki) => parsed.circles.forEach((C, ci) => {
      if (Geo.pointInCircleClosed(K.p, C)) errors.push(`关键帧 K${ki + 1} 的相机位置落在圆形保护区 C${ci + 1} 内（或圆周上），不允许`);
    }));

    return { errors, parsed: errors.length ? null : parsed };
  }

  return { scenario, LIMITS };
});
