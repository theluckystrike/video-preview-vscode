'use strict';
// Frame math for Clip export, Frame export and the Contact sheet (Zovo Pro, lane PRO4).
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/core/proplan');

test('range: A to B when both are set and in order, else the whole video', () => {
  assert.deepStrictEqual(P.range(2, 5, 10), { start: 2, end: 5, ab: true });
  assert.deepStrictEqual(P.range(null, 5, 10), { start: 0, end: 10, ab: false });
  assert.deepStrictEqual(P.range(6, 5, 10), { start: 0, end: 10, ab: false });
  assert.deepStrictEqual(P.range(2, 50, 10), { start: 2, end: 10, ab: true });
});

test('gifSize keeps the aspect, even sizes, never larger than the video', () => {
  assert.deepStrictEqual(P.gifSize(1920, 1080, 480), { width: 480, height: 270 });
  assert.deepStrictEqual(P.gifSize(1280, 720, 640), { width: 640, height: 360 });
  assert.deepStrictEqual(P.gifSize(320, 241, 960), { width: 320, height: 242 });
  assert.deepStrictEqual(P.gifSize(0, 0, 480), { width: 0, height: 0 });
});

test('frameTimes: every frame lands in the middle of its frame, A to B inclusive of partial frames', () => {
  const r = P.frameTimes('all', { start: 1, end: 2, fps: 30 });
  assert.strictEqual(r.times.length, 30);
  assert.strictEqual(r.times[0].frame, 30);
  assert.strictEqual(r.times[29].frame, 59);
  assert.ok(Math.abs(r.times[0].t - 30.25 / 30) < 1e-9);
  const { frameNumber } = require('../src/core/sync');
  assert.ok(r.times.every((x) => frameNumber(x.t, 30) === x.frame), 'the player counter reads the same frame');
  assert.strictEqual(r.capped, false);
});

test('frameTimes: every 5th, every 10th, one per second, 10 evenly spaced', () => {
  assert.deepStrictEqual(P.frameTimes('n5', { start: 0, end: 1, fps: 30 }).times.map((x) => x.frame), [0, 5, 10, 15, 20, 25]);
  assert.strictEqual(P.frameTimes('n10', { start: 0, end: 6, fps: 30 }).times.length, 18);
  assert.deepStrictEqual(P.frameTimes('sec', { start: 0, end: 3, fps: 25 }).times.map((x) => x.frame), [0, 25, 50]);
  const e = P.frameTimes('even10', { start: 0, end: 10, fps: 25 }).times.map((x) => x.frame);
  assert.strictEqual(e.length, 10);
  assert.ok(e.every((f, i) => i === 0 || f > e[i - 1]));
  assert.ok(e[0] > 0 && e[9] < 250);
  assert.strictEqual(P.frameTimes('even10', { start: 0, end: 0.1, fps: 30 }).times.length, 3, 'never more frames than the range has');
});

test('frameTimes: capped at 1,000 per export', () => {
  const r = P.frameTimes('all', { start: 0, end: 120, fps: 30 });
  assert.strictEqual(r.times.length, 1000);
  assert.strictEqual(r.capped, true);
});

test('gifTimes: fps steps from A, at most 60 seconds', () => {
  assert.strictEqual(P.gifTimes(0, 1, 10).length, 10);
  assert.strictEqual(P.gifTimes(5, 500, 15).length, 900);
  assert.ok(Math.abs(P.gifTimes(2, 3, 10)[0] - 2.05) < 1e-9);
});

test('sheetTimes: evenly spaced, snapped a quarter into a frame when fps is known', () => {
  assert.deepStrictEqual(P.sheetTimes(4, 0, 8), [1, 3, 5, 7]);
  assert.deepStrictEqual(P.sheetTimes(2, 0, 1, 10), [0.225, 0.725]);
});
