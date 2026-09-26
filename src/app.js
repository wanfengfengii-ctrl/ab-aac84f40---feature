/*
 * app.js — 画布交互（关键帧/标记点/保护矩形的拖动与录入）、实时精确校核与证据展示。
 * 任何编辑都会立即重新校核：一旦移动中首次擦到保护边界，结论与首个遮挡证据即刻可见。
 */
(function () {
  'use strict';
  const Geo = window.Geo;
  const Validate = window.Validate;
  const W = 960, H = 600;

  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx.scale(dpr, dpr);

  const $ = (id) => document.getElementById(id);
  const els = {
    verdict: $('verdict'), errors: $('errors'), evidence: $('evidence'), report: $('report'),
    keyList: $('keyList'), markerList: $('markerList'), rectList: $('rectList'), circleList: $('circleList'),
    scrub: $('scrubT'), scrubLabel: $('scrubLabel'), scrubBox: $('scrubBox'), hint: $('hint'),
  };

  let uid = 1;
  let drag = null;
  const state = {
    mode: 'select', keyframes: [], markers: [], rects: [], circles: [],
    selected: null, result: null, parsed: null, errors: [], scrub: 0,
  };

  /* ---------------- 工具 ---------------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (f) => Geo.fmt(f);
  const fmtP = (p) => `(${fmt(p.x)}, ${fmt(p.y)})`;
  // 圆区证据坐标可能是 Q(√d) 精确代数数：用根式精确展示
  const fmtAny = (x) => Geo.fmtAny(x);
  const fmtAnyFull = (x) => Geo.fmtFullAny(x);
  const fmtAnyP = (p) => `(${fmtAny(p.x)}, ${fmtAny(p.y)})`;
  const num = (x) => (x && typeof x.toNumber === 'function' ? x.toNumber() : Number(x));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function hint(msg) {
    els.hint.textContent = msg;
    if (msg) setTimeout(() => { if (els.hint.textContent === msg) els.hint.textContent = ''; }, 3500);
  }
  const findItem = (kind, id) => {
    const arr = kind === 'keyframe' ? state.keyframes
      : kind === 'marker' ? state.markers
        : kind === 'rect' ? state.rects : state.circles;
    return arr.find((a) => a.id === id);
  };

  /* ---------------- 校核 ---------------- */
  const rawFromState = () => ({
    keyframes: state.keyframes.map((k) => ({ tStr: k.tStr, x: k.x, y: k.y })),
    markers: state.markers.map((m) => ({ x: m.x, y: m.y })),
    rects: state.rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
    circles: state.circles.map((c) => ({ cx: c.cx, cy: c.cy, r: c.r })),
  });

  function recheck() {
    const v = Validate.scenario(rawFromState(), { width: W, height: H });
    state.errors = v.errors;
    state.parsed = v.parsed;
    state.result = v.parsed ? Geo.checkScenario(v.parsed) : null;
    if (state.result && state.result.firstOcclusion) {
      // 把时间轴定位到最早遮挡时刻，让摄影师立即看到首个证据（时刻可能含根式，toNumber 精确逼近）
      const r = state.result, span = r.t1.toNumber() - r.t0.toNumber();
      state.scrub = span === 0 ? 0 : (r.firstOcclusion.t.toNumber() - r.t0.toNumber()) / span;
      els.scrub.value = String(Math.round(state.scrub * 1000));
    }
    renderPanels();
    draw();
  }

  // 时间轴当前对应的精确时刻
  function scrubT() {
    const ks = state.parsed.keyframes;
    const t0 = ks[0].t, t1 = ks[ks.length - 1].t;
    const v = new Geo.Frac(BigInt(Math.round(state.scrub * 1000)), 1000n);
    return t0.add(t1.sub(t0).mul(v));
  }

  // 某一精确时刻的相机位置与各视线的遮挡情况（连续判定的逐点版本，仍非抽样枚举）
  function instantInfo(t) {
    const ks = state.parsed.keyframes;
    let i = ks.length - 2;
    for (let s = 0; s < ks.length - 1; s++) { if (t.cmp(ks[s + 1].t) <= 0) { i = s; break; } }
    const t0 = ks[i].t, t1 = ks[i + 1].t;
    const u = t1.gt(t0) ? t.sub(t0).div(t1.sub(t0)) : new Geo.Frac(0n);
    const C = Geo.cameraAt(ks[i].p, ks[i + 1].p, u);
    const lines = state.parsed.markers.map((M, mi) => {
      const hits = [];
      state.parsed.rects.forEach((R, ri) => { if (Geo.sweepInterval(C, C, M, R)) hits.push({ kind: 'rect', index: ri }); });
      (state.parsed.circles || []).forEach((O, ci) => { if (Geo.sightHitsCircle(C, M, O)) hits.push({ kind: 'circle', index: ci }); });
      return { mi, M, hits };
    });
    return { C, lines, segIndex: i, u };
  }

  /* ---------------- 面板渲染 ---------------- */
  function renderPanels() {
    const v = els.verdict;
    if (state.errors.length) { v.className = 'verdict invalid'; v.textContent = '配置无效，无法校核'; }
    else if (!state.result) { v.className = 'verdict pending'; v.textContent = '待校核'; }
    else if (state.result.ok) { v.className = 'verdict ok'; v.textContent = '✓ 校核通过：全程无遮挡，曝光可执行'; }
    else { v.className = 'verdict bad'; v.textContent = '✗ 存在遮挡：该次曝光不可执行'; }

    els.errors.innerHTML = state.errors.map((e) => `<div class="err">• ${esc(e)}</div>`).join('');
    renderEvidence();
    renderReport();
    els.scrubBox.style.display = state.parsed && state.parsed.keyframes.length >= 2 ? '' : 'none';
    updateScrubLabel();
  }

  function renderEvidence() {
    const r = state.result;
    if (!r || !r.firstOcclusion) { els.evidence.innerHTML = ''; return; }
    const f = r.firstOcclusion;
    const seg = r.segments[f.segmentIndex];
    const M = state.parsed.markers[f.markerIndex];
    const isCircle = f.kind === 'circle';
    const zoneLine = isCircle
      ? (() => { const O = state.parsed.circles[f.circleIndex];
          return `<li>圆形保护区：O${f.circleIndex + 1}　圆心 ${esc(fmtAnyP({ x: O.cx, y: O.cy }))}，半径 ${esc(fmtAny(O.r))}</li>`; })()
      : (() => { const R = state.parsed.rects[f.rectIndex];
          return `<li>保护矩形：R${f.rectIndex + 1}　x∈[${esc(fmt(R.x1))}, ${esc(fmt(R.x2))}]，y∈[${esc(fmt(R.y1))}, ${esc(fmt(R.y2))}]</li>`; })();
    els.evidence.innerHTML = `
      <div class="card danger">
        <h3>最早遮挡证据（可复核）</h3>
        <ul>
          <li>时刻：<b>t = ${esc(fmtAnyFull(f.t))}</b>${f.tangent
            ? '（<b>相切</b>：首次擦到保护边界）'
            : `（进入遮挡区间 [${esc(fmtAny(f.t))}, ${esc(fmtAny(f.tMax))}]）`}</li>
          <li>航段：K${f.segmentIndex + 1} → K${f.segmentIndex + 2}（t ∈ [${esc(fmt(seg.t0))}, ${esc(fmt(seg.t1))}]）</li>
          <li>标记点：M${f.markerIndex + 1} ${esc(fmtP(M))}</li>
          ${zoneLine}
          <li>相机位置：C(t) = (${esc(fmtAnyFull(f.camera.x))}, ${esc(fmtAnyFull(f.camera.y))})</li>
          <li>${isCircle ? '圆周接触点' : '接触点（在矩形边界上）'}：${esc(fmtAnyP(f.contact))}${isCircle ? ` <span class="note">（精确根式坐标，已在圆周上）</span>` : ''}</li>
        </ul>
        <p class="note">画布已用红色虚线绘制该时刻的相机位置、视线与接触点；拖动时间轴可逐时刻复核。摄影师据此即可判定：<b>该次曝光不可执行</b>。</p>
      </div>`;
  }

  function renderReport() {
    const r = state.result;
    if (!r) { els.report.innerHTML = '<p class="muted">完成有效配置后，此处自动给出每个航段、每条视线的安全区间。</p>'; return; }
    els.report.innerHTML = r.segments.map((seg) => {
      const rows = seg.byMarker.map((bm) => {
        if (!bm.occluded.length) return `<div class="row ok">M${bm.markerIndex + 1}：全程安全</div>`;
        const srcLabel = (o) => {
          const rs = (o.rects || []).map((ri) => `R${ri + 1}`);
          const cs = (o.circles || []).map((ci) => `O${ci + 1}`);
          return [...rs, ...cs].join('/');
        };
        const occ = bm.occluded.map((o) => o.tangent
          ? `相切于 t = ${esc(fmtAny(o.tMin))}（${srcLabel(o)}）`
          : `遮挡 [${esc(fmtAny(o.tMin))}, ${esc(fmtAny(o.tMax))}]（${srcLabel(o)}）`).join('；');
        const safe = bm.safe.length
          ? bm.safe.map((s) => `${s.fromClosed ? '[' : '('}${esc(fmtAny(s.from))}, ${esc(fmtAny(s.to))}${s.toClosed ? ']' : ')'}`).join(' ∪ ')
          : '无';
        return `<div class="row bad">M${bm.markerIndex + 1}：${occ}<br><span class="safe">安全区间：${safe}</span></div>`;
      }).join('');
      return `<div class="seg"><h4>航段 K${seg.index + 1} → K${seg.index + 2}（t ∈ [${esc(fmt(seg.t0))}, ${esc(fmt(seg.t1))}]）</h4>${rows}</div>`;
    }).join('');
  }

  function renderLists() {
    const selCls = (kind, id) => (state.selected && state.selected.kind === kind && state.selected.id === id ? 'sel' : '');
    els.keyList.innerHTML = state.keyframes.map((k, i) => `
      <div class="item ${selCls('keyframe', k.id)}">
        <span class="tag">K${i + 1}</span>
        <label>t <input data-kind="keyframe" data-id="${k.id}" data-field="tStr" value="${esc(k.tStr)}"></label>
        <label>x <input type="number" data-kind="keyframe" data-id="${k.id}" data-field="x" value="${k.x}"></label>
        <label>y <input type="number" data-kind="keyframe" data-id="${k.id}" data-field="y" value="${k.y}"></label>
        <button type="button" data-act="del" data-kind="keyframe" data-id="${k.id}" title="删除">×</button>
      </div>`).join('');
    els.markerList.innerHTML = state.markers.map((m, i) => `
      <div class="item ${selCls('marker', m.id)}">
        <span class="tag tag-m">M${i + 1}</span>
        <label>x <input type="number" data-kind="marker" data-id="${m.id}" data-field="x" value="${m.x}"></label>
        <label>y <input type="number" data-kind="marker" data-id="${m.id}" data-field="y" value="${m.y}"></label>
        <button type="button" data-act="del" data-kind="marker" data-id="${m.id}" title="删除">×</button>
      </div>`).join('');
    els.rectList.innerHTML = state.rects.map((r, i) => `
      <div class="item ${selCls('rect', r.id)}">
        <span class="tag tag-r">R${i + 1}</span>
        <label>x <input type="number" data-kind="rect" data-id="${r.id}" data-field="x" value="${r.x}"></label>
        <label>y <input type="number" data-kind="rect" data-id="${r.id}" data-field="y" value="${r.y}"></label>
        <label>宽 <input type="number" data-kind="rect" data-id="${r.id}" data-field="w" value="${r.w}"></label>
        <label>高 <input type="number" data-kind="rect" data-id="${r.id}" data-field="h" value="${r.h}"></label>
        <button type="button" data-act="del" data-kind="rect" data-id="${r.id}" title="删除">×</button>
      </div>`).join('');
    els.circleList.innerHTML = state.circles.map((c, i) => `
      <div class="item ${selCls('circle', c.id)}">
        <span class="tag tag-c">O${i + 1}</span>
        <label>圆心 x <input type="number" data-kind="circle" data-id="${c.id}" data-field="cx" value="${c.cx}"></label>
        <label>圆心 y <input type="number" data-kind="circle" data-id="${c.id}" data-field="cy" value="${c.cy}"></label>
        <label>半径 <input type="number" data-kind="circle" data-id="${c.id}" data-field="r" value="${c.r}" min="4"></label>
        <button type="button" data-act="del" data-kind="circle" data-id="${c.id}" title="删除">×</button>
      </div>`).join('');
  }

  // 拖动时同步右侧面板数值（不重渲染列表，避免输入框失焦）
  function syncInputs() {
    document.querySelectorAll('aside input[data-field]').forEach((inp) => {
      if (inp.dataset.field === 'tStr' || document.activeElement === inp) return;
      const it = findItem(inp.dataset.kind, Number(inp.dataset.id));
      if (it) inp.value = it[inp.dataset.field];
    });
  }

  function updateScrubLabel() {
    if (!state.parsed || state.parsed.keyframes.length < 2) { els.scrubLabel.textContent = ''; return; }
    const t = scrubT();
    const info = instantInfo(t);
    const occ = info.lines.filter((l) => l.hits.length);
    const occTxt = occ.length
      ? '　⚠ 遮挡：' + occ.map((l) => `M${l.mi + 1}×${l.hits.map((h) => (h.kind === 'rect' ? 'R' : 'O') + (h.index + 1)).join('/')}`).join('，')
      : '　✓ 此时刻全部视线安全';
    els.scrubLabel.textContent = `t = ${Geo.fmtFull(t)}（航段 K${info.segIndex + 1}→K${info.segIndex + 2}）` + occTxt;
  }

  /* ---------------- 画布绘制 ---------------- */
  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawGrid();
    drawPath();
    state.rects.forEach((r, i) => drawRect(r, i));
    state.circles.forEach((c, i) => drawCircle(c, i));
    drawAllContacts();
    drawScrubLines();
    state.markers.forEach((m, i) => drawMarker(m, i));
    state.keyframes.forEach((k, i) => drawKey(k, i));
    drawEvidence();
    if (drag && drag.type === 'create-rect') drawGhostRect(drag);
    if (drag && drag.type === 'create-circle') drawGhostCircle(drag);
  }

  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = '#1b222b'; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
    ctx.restore();
  }

  function drawPath() {
    const ks = state.keyframes;
    if (ks.length < 2) return;
    ctx.save();
    ctx.strokeStyle = '#4da3ff'; ctx.fillStyle = '#4da3ff'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(ks[0].x, ks[0].y);
    for (let i = 1; i < ks.length; i++) ctx.lineTo(ks[i].x, ks[i].y);
    ctx.stroke(); ctx.setLineDash([]);
    for (let i = 1; i < ks.length; i++) {
      const a = ks[i - 1], b = ks[i], ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.beginPath(); ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - 10 * Math.cos(ang - 0.4), b.y - 10 * Math.sin(ang - 0.4));
      ctx.lineTo(b.x - 10 * Math.cos(ang + 0.4), b.y - 10 * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function drawKey(k, i) {
    const sel = state.selected && state.selected.kind === 'keyframe' && state.selected.id === k.id;
    ctx.save();
    ctx.beginPath(); ctx.arc(k.x, k.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#4da3ff'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = sel ? '#ffd84d' : '#0b1521'; ctx.stroke();
    ctx.fillStyle = '#0b1521'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`K${i + 1}`, k.x, k.y);
    ctx.fillStyle = '#9fc7ff'; ctx.font = '11px sans-serif'; ctx.textBaseline = 'top';
    ctx.fillText(`t=${k.tStr}`, k.x, k.y + 14);
    ctx.restore();
  }

  function drawMarker(m, i) {
    const sel = state.selected && state.selected.kind === 'marker' && state.selected.id === m.id;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(m.x, m.y - 9); ctx.lineTo(m.x + 9, m.y); ctx.lineTo(m.x, m.y + 9); ctx.lineTo(m.x - 9, m.y);
    ctx.closePath();
    ctx.fillStyle = '#ffb84d'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = sel ? '#ffffff' : '#5a3d00'; ctx.stroke();
    ctx.fillStyle = '#ffd9a0'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`M${i + 1}`, m.x, m.y - 12);
    ctx.restore();
  }

  function drawRect(r, i) {
    const sel = state.selected && state.selected.kind === 'rect' && state.selected.id === r.id;
    ctx.save();
    ctx.fillStyle = 'rgba(255,90,90,0.14)'; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 2; ctx.strokeStyle = sel ? '#ffd84d' : '#ff5a5a'; ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#ff8a8a'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`R${i + 1}`, r.x + 4, r.y + 4);
    if (sel) { ctx.fillStyle = '#ffd84d'; ctx.fillRect(r.x + r.w - 4, r.y + r.h - 4, 8, 8); }
    ctx.restore();
  }

  function drawCircle(c, i) {
    const sel = state.selected && state.selected.kind === 'circle' && state.selected.id === c.id;
    ctx.save();
    ctx.beginPath(); ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(177,110,255,0.13)'; ctx.fill();
    ctx.lineWidth = 2;
    ctx.setLineDash(sel ? [] : [7, 4]);
    ctx.strokeStyle = sel ? '#ffd84d' : '#b16eff'; ctx.stroke();
    ctx.setLineDash([]);
    // 圆心小十字
    ctx.beginPath();
    ctx.moveTo(c.cx - 4, c.cy); ctx.lineTo(c.cx + 4, c.cy);
    ctx.moveTo(c.cx, c.cy - 4); ctx.lineTo(c.cx, c.cy + 4);
    ctx.strokeStyle = sel ? '#ffd84d' : '#b16eff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#c79aff'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`O${i + 1}`, c.cx + c.r + 4, c.cy - c.r);
    if (sel) { // 半径拖动手柄（右边缘）
      ctx.fillStyle = '#ffd84d';
      ctx.beginPath(); ctx.arc(c.cx + c.r, c.cy, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawAllContacts() {
    const r = state.result;
    if (!r) return;
    ctx.save();
    for (const seg of r.segments) for (const e of seg.entries) {
      ctx.fillStyle = e.kind === 'circle' ? 'rgba(196,140,255,0.95)' : 'rgba(255,90,90,0.9)';
      ctx.beginPath(); ctx.arc(num(e.contactMin.x), num(e.contactMin.y), e.kind === 'circle' ? 3.5 : 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawScrubLines() {
    if (!state.parsed || state.parsed.keyframes.length < 2) return;
    const info = instantInfo(scrubT());
    const cx = info.C.x.toNumber(), cy = info.C.y.toNumber();
    ctx.save();
    for (const ln of info.lines) {
      const bad = ln.hits.length > 0;
      ctx.strokeStyle = bad ? '#ff5a5a' : '#3fbf6f'; ctx.lineWidth = bad ? 2 : 1.2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ln.M.x.toNumber(), ln.M.y.toNumber()); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('C(t)', cx, cy - 10);
    ctx.restore();
  }

  function drawEvidence() {
    const r = state.result;
    if (!r || !r.firstOcclusion) return;
    const f = r.firstOcclusion;
    const M = state.parsed.markers[f.markerIndex];
    const cx = num(f.camera.x), cy = num(f.camera.y);
    const mx = num(M.x), my = num(M.y);
    const px = num(f.contact.x), py = num(f.contact.y);
    ctx.save();
    ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 2.5; ctx.setLineDash([8, 5]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(mx, my); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px - 9, py); ctx.lineTo(px + 9, py); ctx.moveTo(px, py - 9); ctx.lineTo(px, py + 9);
    ctx.stroke();
    ctx.fillStyle = '#ffd84d'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`首次遮挡 t=${fmtAny(f.t)}`, clamp(px + 10, 4, W - 130), clamp(py - 10, 14, H - 4));
    ctx.restore();
  }

  function drawGhostRect(d) {
    const x = Math.min(d.anchor.x, d.cur.x), y = Math.min(d.anchor.y, d.cur.y);
    const w = Math.abs(d.anchor.x - d.cur.x), h = Math.abs(d.anchor.y - d.cur.y);
    ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#ff5a5a'; ctx.strokeRect(x, y, w, h); ctx.restore();
  }

  function drawGhostCircle(d) {
    ctx.save();
    ctx.beginPath(); ctx.arc(d.anchor.x, d.anchor.y, Math.hypot(d.cur.x - d.anchor.x, d.cur.y - d.anchor.y), 0, Math.PI * 2);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#b16eff'; ctx.stroke();
    ctx.beginPath(); ctx.arc(d.anchor.x, d.anchor.y, 2, 0, Math.PI * 2); ctx.fillStyle = '#b16eff'; ctx.fill();
    ctx.restore();
  }

  /* ---------------- 画布交互 ---------------- */
  function canvasPos(e) {
    const r = cv.getBoundingClientRect();
    return {
      x: clamp(Math.round((e.clientX - r.left) * W / r.width), 0, W),
      y: clamp(Math.round((e.clientY - r.top) * H / r.height), 0, H),
    };
  }

  function hitTest(p) {
    if (state.selected && state.selected.kind === 'rect') {
      const r = findItem('rect', state.selected.id);
      if (r && Math.abs(p.x - (r.x + r.w)) <= 8 && Math.abs(p.y - (r.y + r.h)) <= 8) return { kind: 'rect-handle', id: r.id };
    }
    if (state.selected && state.selected.kind === 'circle') {
      const c = findItem('circle', state.selected.id);
      if (c && Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.r) <= 7) return { kind: 'circle-handle', id: c.id };
    }
    for (let i = state.keyframes.length - 1; i >= 0; i--) {
      const k = state.keyframes[i];
      if (Math.hypot(p.x - k.x, p.y - k.y) <= 12) return { kind: 'keyframe', id: k.id };
    }
    for (let i = state.markers.length - 1; i >= 0; i--) {
      const m = state.markers[i];
      if (Math.hypot(p.x - m.x, p.y - m.y) <= 10) return { kind: 'marker', id: m.id };
    }
    for (let i = state.rects.length - 1; i >= 0; i--) {
      const r = state.rects[i];
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return { kind: 'rect', id: r.id };
    }
    for (let i = state.circles.length - 1; i >= 0; i--) {
      const c = state.circles[i];
      const d = Math.hypot(p.x - c.cx, p.y - c.cy);
      if (d <= Math.max(8, c.r)) return { kind: 'circle', id: c.id, edge: d >= c.r - 7 };
    }
    return null;
  }

  cv.addEventListener('pointerdown', (e) => {
    const p = canvasPos(e);
    cv.setPointerCapture(e.pointerId);
    if (state.mode === 'keyframe') {
      if (state.keyframes.length >= 4) return hint('最多 4 个相机关键帧');
      state.keyframes.push({ id: uid++, tStr: defaultTime(), x: p.x, y: p.y });
      renderLists(); recheck(); return;
    }
    if (state.mode === 'marker') {
      if (state.markers.length >= 6) return hint('最多 6 个标记点');
      state.markers.push({ id: uid++, x: p.x, y: p.y });
      renderLists(); recheck(); return;
    }
    if (state.mode === 'rect') {
      if (state.rects.length >= 4) return hint('最多 4 个保护矩形');
      drag = { type: 'create-rect', anchor: p, cur: p }; return;
    }
    if (state.mode === 'circle') {
      if (state.circles.length >= 3) return hint('最多 3 个圆形保护区');
      drag = { type: 'create-circle', anchor: p, cur: p }; return;
    }
    const hit = hitTest(p);
    if (hit) {
      const selKind = hit.kind === 'rect-handle' ? 'rect' : hit.kind === 'circle-handle' ? 'circle'
        : hit.kind === 'circle' && hit.edge ? 'circle' : hit.kind;
      state.selected = { kind: selKind, id: hit.id };
      drag = hit.kind === 'rect-handle'
        ? { type: 'resize-rect', id: hit.id }
        : (hit.kind === 'circle-handle' || (hit.kind === 'circle' && hit.edge))
          ? { type: 'resize-circle', id: hit.id }
          : { type: 'move', kind: selKind, id: hit.id, last: p };
    } else {
      state.selected = null;
    }
    renderLists(); draw();
  });

  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = canvasPos(e);
    if (drag.type === 'create-rect' || drag.type === 'create-circle') { drag.cur = p; draw(); return; }
    if (drag.type === 'move') {
      const it = findItem(drag.kind, drag.id);
      if (!it) return;
      const dx = p.x - drag.last.x, dy = p.y - drag.last.y;
      drag.last = p;
      if (drag.kind === 'rect') { it.x = clamp(it.x + dx, 0, W - it.w); it.y = clamp(it.y + dy, 0, H - it.h); }
      else if (drag.kind === 'circle') {
        it.cx = clamp(it.cx + dx, it.r, W - it.r);
        it.cy = clamp(it.cy + dy, it.r, H - it.r);
      } else { it.x = clamp(it.x + dx, 0, W); it.y = clamp(it.y + dy, 0, H); }
      syncInputs(); recheck(); return;
    }
    if (drag.type === 'resize-rect') {
      const r = findItem('rect', drag.id);
      if (!r) return;
      r.w = clamp(p.x - r.x, 8, W - r.x);
      r.h = clamp(p.y - r.y, 8, H - r.y);
      syncInputs(); recheck();
    }
    if (drag.type === 'resize-circle') {
      const c = findItem('circle', drag.id);
      if (!c) return;
      // 半径受画布边界约束，保持圆心不变
      const maxR = Math.min(c.cx, W - c.cx, c.cy, H - c.cy);
      c.r = clamp(Math.round(Math.hypot(p.x - c.cx, p.y - c.cy)), 4, Math.max(4, maxR));
      syncInputs(); recheck();
    }
  });

  cv.addEventListener('pointerup', () => {
    if (drag && drag.type === 'create-rect') {
      const a = drag.anchor, b = drag.cur;
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
      if (w >= 8 && h >= 8) {
        const r = { id: uid++, x, y, w, h };
        state.rects.push(r);
        state.selected = { kind: 'rect', id: r.id };
      } else hint('矩形太小，未创建');
    }
    if (drag && drag.type === 'create-circle') {
      const a = drag.anchor;
      const rr = Math.round(Math.hypot(drag.cur.x - a.x, drag.cur.y - a.y));
      const maxR = Math.min(a.x, W - a.x, a.y, H - a.y);
      const rad = clamp(rr, 4, Math.max(4, maxR));
      if (rr >= 4) {
        const c = { id: uid++, cx: a.x, cy: a.y, r: rad };
        state.circles.push(c);
        state.selected = { kind: 'circle', id: c.id };
      } else hint('圆区半径太小（至少 4），未创建');
    }
    drag = null;
    renderLists(); recheck();
  });

  function defaultTime() {
    if (!state.keyframes.length) return '0';
    const last = state.keyframes[state.keyframes.length - 1];
    const t = Geo.tryParse(last.tStr);
    return t ? String(t.toNumber() + 1) : String((parseFloat(last.tStr) || 0) + 1);
  }

  /* ---------------- 工具栏与面板事件 ---------------- */
  function setMode(m) {
    state.mode = m;
    document.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('active', x.dataset.mode === m));
    cv.style.cursor = m === 'select' ? 'default' : 'crosshair';
    hint({
      keyframe: '在画布上点击放置相机关键帧（2–4 个）',
      marker: '在画布上点击放置标记点（2–6 个）',
      rect: '在画布上按住拖拽画出保护矩形（1–4 个）',
      circle: '按住拖拽：落点为圆心、拖出半径，新增圆形保护区（0–3 个）',
      select: '',
    }[m] || '');
  }
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  function deleteSelected() {
    const s = state.selected;
    if (!s) return;
    const arr = s.kind === 'keyframe' ? state.keyframes
      : s.kind === 'marker' ? state.markers
        : s.kind === 'rect' ? state.rects : state.circles;
    const i = arr.findIndex((a) => a.id === s.id);
    if (i >= 0) arr.splice(i, 1);
    state.selected = null;
    renderLists(); recheck();
  }

  $('btnDelete').addEventListener('click', deleteSelected);
  $('btnClear').addEventListener('click', () => {
    state.keyframes = []; state.markers = []; state.rects = []; state.circles = []; state.selected = null;
    renderLists(); recheck();
  });
  $('btnSample').addEventListener('click', loadSample);
  $('btnCheck').addEventListener('click', () => {
    recheck();
    hint(state.errors.length ? '请先修正配置错误'
      : state.result && state.result.ok ? '校核通过：全程无遮挡'
      : '校核完成：存在遮挡，最早证据见右侧面板');
  });
  els.scrub.addEventListener('input', () => {
    state.scrub = Number(els.scrub.value) / 1000;
    draw(); updateScrubLabel();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && document.activeElement.tagName !== 'INPUT') deleteSelected();
    if (e.key === 'Escape') setMode('select');
  });

  document.querySelector('aside').addEventListener('input', (e) => {
    const d = e.target.dataset;
    if (!d.field) return;
    const it = findItem(d.kind, Number(d.id));
    if (!it) return;
    if (d.field === 'tStr') it.tStr = e.target.value;
    else {
      const v = Math.round(Number(e.target.value));
      if (Number.isFinite(v)) it[d.field] = v;
    }
    recheck();
  });
  document.querySelector('aside').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.act !== 'del') return;
    const arr = b.dataset.kind === 'keyframe' ? state.keyframes
      : b.dataset.kind === 'marker' ? state.markers
        : b.dataset.kind === 'rect' ? state.rects : state.circles;
    const i = arr.findIndex((a) => a.id === Number(b.dataset.id));
    if (i >= 0) arr.splice(i, 1);
    if (state.selected && state.selected.id === Number(b.dataset.id) && state.selected.kind === b.dataset.kind) state.selected = null;
    renderLists(); recheck();
  });

  /* ---------------- 示例与初始化 ---------------- */
  function loadSample() {
    state.keyframes = [
      { tStr: '0', x: 60, y: 100 },
      { tStr: '4', x: 900, y: 100 },
      { tStr: '6', x: 900, y: 500 },
    ].map((k) => ({ id: uid++, ...k }));
    state.markers = [
      { x: 480, y: 400 },
      { x: 150, y: 520 },
    ].map((m) => ({ id: uid++, ...m }));
    state.rects = [
      { x: 380, y: 140, w: 200, h: 120 },
      { x: 700, y: 300, w: 120, h: 90 },
    ].map((r) => ({ id: uid++, ...r }));
    state.circles = [
      { cx: 300, cy: 180, r: 40 },
    ].map((c) => ({ id: uid++, ...c }));
    state.selected = null;
    renderLists(); recheck();
    hint('已载入示例：含矩形与圆形保护区，最早遮挡证据见右侧面板；可拖圆心/边缘或右侧录入观察实时校核');
  }

  setMode('select');
  loadSample();
})();
