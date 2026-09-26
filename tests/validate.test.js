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
  circles: [],
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
  assert.ok(Validate.scenario(r1, OPTS).errors.some((e) => e.includes('宽、高')));
  const r2 = baseRaw(); r2.rects[0].x = 950; r2.rects[0].w = 50;
  assert.ok(Validate.scenario(r2, OPTS).errors.some((e) => e.includes('超出')));
  const r3 = baseRaw(); r3.markers[0] = { x: 1000, y: 10 };
  assert.ok(Validate.scenario(r3, OPTS).errors.some((e) => e.includes('超出')));
});

test('圆形保护区为可选（0 个是合法旧草稿）', () => {
  const v = Validate.scenario(baseRaw(), OPTS);
  assert.deepEqual(v.errors, []);
  assert.ok(v.parsed.circles && v.parsed.circles.length === 0);
});

test('圆形保护区最多 3 个', () => {
  const r = baseRaw();
  r.circles = [{ cx: 200, cy: 200, r: 20 }, { cx: 300, cy: 200, r: 20 },
    { cx: 400, cy: 200, r: 20 }, { cx: 500, cy: 200, r: 20 }];
  assert.ok(Validate.scenario(r, OPTS).errors.some((e) => e.includes('最多 3')));
});

test('圆形保护区半径与画布边界', () => {
  const r1 = baseRaw(); r1.circles = [{ cx: 200, cy: 200, r: 2 }];
  assert.ok(Validate.scenario(r1, OPTS).errors.some((e) => e.includes('半径')));
  const r2 = baseRaw(); r2.circles = [{ cx: 30, cy: 200, r: 40 }];
  assert.ok(Validate.scenario(r2, OPTS).errors.some((e) => e.includes('超出画布')));
});

test('标记点不得落在圆内或圆周上', () => {
  const r1 = baseRaw(); r1.circles = [{ cx: 480, cy: 400, r: 20 }];
  assert.ok(Validate.scenario(r1, OPTS).errors.some((e) => e.includes('M1') && e.includes('C1')));
  const r2 = baseRaw(); r2.circles = [{ cx: 460, cy: 400, r: 20 }]; // 标记在圆周上
  assert.ok(Validate.scenario(r2, OPTS).errors.some((e) => e.includes('圆周')));
});

test('关键帧相机位置不得落在圆内或圆周上', () => {
  const r = baseRaw(); r.circles = [{ cx: 60, cy: 100, r: 20 }];
  assert.ok(Validate.scenario(r, OPTS).errors.some((e) => e.includes('K1') && e.includes('C1')));
});
