'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Validate = require('../src/validate.js');

const OPTS = { width: 960, height: 600 };
const baseRaw = () => ({
  keyframes: [
    { tStr: '0', x: 60, y: 100 },
    { tStr: '4', x: 900, y: 100 },
  ],
  markers: [
    { x: 480, y: 400 },
    { x: 150, y: 520 },
  ],
  rects: [{ x: 380, y: 140, w: 200, h: 120 }],
});

test('合法配置通过并给出解析结果', () => {
  const v = Validate.scenario(baseRaw(), OPTS);
  assert.deepEqual(v.errors, []);
  assert.ok(v.parsed);
  assert.equal(v.parsed.keyframes.length, 2);
});

test('关键帧数量限制 2–4', () => {
  const r1 = baseRaw(); r1.keyframes = r1.keyframes.slice(0, 1);
  assert.ok(Validate.scenario(r1, OPTS).errors.some((e) => e.includes('2–4')));
  const r2 = baseRaw();
  for (let i = 0; i < 4; i++) r2.keyframes.push({ tStr: String(5 + i), x: 100, y: 100 });
  assert.ok(Validate.scenario(r2, OPTS).errors.some((e) => e.includes('2–4')));
});

test('标记点数量限制 2–6', () => {
  const r = baseRaw(); r.markers = [{ x: 1, y: 1 }];
  assert.ok(Validate.scenario(r, OPTS).errors.some((e) => e.includes('2–6')));
});

test('保护矩形数量限制 1–4', () => {
  const r = baseRaw(); r.rects = [];
  assert.ok(Validate.scenario(r, OPTS).errors.some((e) => e.includes('1–4')));
});

test('时间须严格递增', () => {
  const r = baseRaw(); r.keyframes[1].tStr = '0';
  assert.ok(Validate.scenario(r, OPTS).errors.some((e) => e.includes('严格递增')));
  const r2 = baseRaw(); r2.keyframes[1].tStr = '-1';
  assert.ok(Validate.scenario(r2, OPTS).errors.some((e) => e.includes('严格递增')));
});

test('时间无法解析', () => {
  const r = baseRaw(); r.keyframes[0].tStr = 'abc';
  assert.ok(Validate.scenario(r, OPTS).errors.some((e) => e.includes('无法解析')));
});

test('标记点不得落在矩形内或边界上', () => {
  const r1 = baseRaw(); r1.markers[0] = { x: 400, y: 200 };
  assert.ok(Validate.scenario(r1, OPTS).errors.some((e) => e.includes('M1')));
  const r2 = baseRaw(); r2.markers[0] = { x: 380, y: 140 }; // 恰好角点
  assert.ok(Validate.scenario(r2, OPTS).errors.some((e) => e.includes('边界')));
});

test('相机位置不得落在矩形内', () => {
  const r = baseRaw(); r.keyframes[0].x = 400; r.keyframes[0].y = 200;
  assert.ok(Validate.scenario(r, OPTS).errors.some((e) => e.includes('K1')));
});

test('矩形尺寸与画布边界', () => {
  const r1 = baseRaw(); r1.rects[0].w = 0;
  assert.ok(Validate.scenario(r1, OPTS).errors.length > 0);
  const r2 = baseRaw(); r2.rects[0].x = 950; r2.rects[0].w = 50;
  assert.ok(Validate.scenario(r2, OPTS).errors.some((e) => e.includes('超出')));
  const r3 = baseRaw(); r3.markers[0] = { x: 1000, y: 10 };
  assert.ok(Validate.scenario(r3, OPTS).errors.some((e) => e.includes('超出')));
});

/* ================= 圆形保护区校验 ================= */
const withCircle = (c, extra) => { const r = baseRaw(); r.circles = c == null ? [] : [c]; return Object.assign(r, extra || {}); };

test('旧草稿无圆区字段仍合法（向后兼容）', () => {
  const v = Validate.scenario(baseRaw(), OPTS);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.parsed.circles, []);
});

test('圆区数量限制 0–3', () => {
  const r = withCircle({ cx: 100, cy: 100, r: 20 });
  r.circles = [r.circles[0], { cx: 200, cy: 100, r: 20 }, { cx: 300, cy: 100, r: 20 }, { cx: 400, cy: 100, r: 20 }];
  assert.ok(Validate.scenario(r, OPTS).errors.some((e) => e.includes('圆形保护区数量')));
});

test('圆区半径下限与画布边界', () => {
  assert.ok(Validate.scenario(withCircle({ cx: 100, cy: 100, r: 3 }), OPTS).errors.some((e) => e.includes('半径')));
  assert.ok(Validate.scenario(withCircle({ cx: 20, cy: 100, r: 30 }), OPTS).errors.some((e) => e.includes('超出')));
});

test('标记点不得落在圆区内或圆周上', () => {
  // 标记点 (480,400)；圆心 (480,420) 半径 20 ⇒ 距离恰为 20（圆周上）
  const r1 = withCircle({ cx: 480, cy: 420, r: 20 });
  assert.ok(Validate.scenario(r1, OPTS).errors.some((e) => e.includes('M1') && e.includes('O1')));
  const r2 = withCircle({ cx: 480, cy: 400, r: 20 });
  assert.ok(Validate.scenario(r2, OPTS).errors.some((e) => e.includes('M1')));
});

test('关键帧相机位置不得落在圆区内', () => {
  // K1=(60,100)，圆心 (60,100) 半径 10
  const r = withCircle({ cx: 60, cy: 100, r: 10 });
  assert.ok(Validate.scenario(r, OPTS).errors.some((e) => e.includes('K1') && e.includes('O1')));
});

test('合法圆区被解析为精确圆心与半径', () => {
  const v = Validate.scenario(withCircle({ cx: 300, cy: 200, r: 45 }), OPTS);
  assert.deepEqual(v.errors, []);
  const o = v.parsed.circles[0];
  assert.equal(o.cx.toString(), '300');
  assert.equal(o.cy.toString(), '200');
  assert.equal(o.r.toString(), '45');
});
