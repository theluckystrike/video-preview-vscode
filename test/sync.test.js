'use strict';
const test = require('node:test');
const assert = require('node:assert');
const s = require('../src/core/sync');

test('syncAction: in step, nudge, seek', () => {
  assert.deepStrictEqual(s.syncAction(10, 10.01, 1), { rate: 1 });
  assert.ok(s.syncAction(10, 10.1, 1).rate < 1);
  assert.ok(s.syncAction(10, 9.9, 1).rate > 1);
  assert.deepStrictEqual(s.syncAction(10, 11, 2), { seek: 10, rate: 2 });
  assert.deepStrictEqual(s.syncAction(10, NaN, 1), { rate: 1 });
});

test('loopTarget', () => {
  assert.strictEqual(s.loopTarget(5, 2, 4), 2);
  assert.strictEqual(s.loopTarget(3, 2, 4), null);
  assert.strictEqual(s.loopTarget(0.5, 2, 4), 2);
  assert.strictEqual(s.loopTarget(3, 4, 2), null);
  assert.strictEqual(s.loopTarget(3, null, 4), null);
});

test('stepFrame snaps to the frame grid and stays in range', () => {
  let t = 0;
  for (let i = 0; i < 90; i++) t = s.stepFrame(t, 30, 1, 10);
  assert.strictEqual(s.frameNumber(t, 30), 90);
  assert.strictEqual(s.stepFrame(0, 30, -1, 10), 0);
  assert.ok(s.stepFrame(9.99, 30, 1, 10) < 10);
  assert.strictEqual(s.frameNumber(s.stepFrame(1.0101, 29.97, 1, 0), 29.97), 31);
  assert.strictEqual(s.stepFrame(1, 0, 1, 0), 31 / 30);
});

test('formatTime, formatBytes, nextSpeed', () => {
  assert.strictEqual(s.formatTime(0), '0:00');
  assert.strictEqual(s.formatTime(65.5, true), '1:05.500');
  assert.strictEqual(s.formatTime(3725), '1:02:05');
  assert.strictEqual(s.formatTime(-1), '0:00');
  assert.strictEqual(s.formatBytes(1536), '1.50 KB');
  assert.strictEqual(s.nextSpeed(1, 1), 1.25);
  assert.strictEqual(s.nextSpeed(1, -1), 0.75);
  assert.strictEqual(s.nextSpeed(4, 1), 4);
  assert.strictEqual(s.nextSpeed(0.1, -1), 0.1);
  assert.strictEqual(s.nextSpeed(1.1, -1), 1);
});

test('shotName strips path characters', () => {
  assert.strictEqual(s.shotName('demo clip.mp4', 12.345, 30), 'demo_clip-00m12s345-f370.png');
  const n = s.shotName('../../etc/passwd<x>.mov', 0, 30);
  assert.ok(!n.includes('/') && !n.includes('<'), n);
});
