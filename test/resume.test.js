'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createStore, resumeAt, keyOf, POS_KEY } = require('../src/core/resume');

function memento() { const m = new Map(); return { data: m, get: (k, d) => (m.has(k) ? m.get(k) : d), update: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); } }; }

test('resume rule: only between 5 s and duration - 5 s', () => {
  assert.strictEqual(resumeAt(83, 600), 83);
  assert.strictEqual(resumeAt(5, 600), 0);
  assert.strictEqual(resumeAt(5.1, 600), 5.1);
  assert.strictEqual(resumeAt(595, 600), 0);
  assert.strictEqual(resumeAt(594.9, 600), 594.9);
  assert.strictEqual(resumeAt(8, 12), 0);
  assert.strictEqual(resumeAt(30, NaN), 0);
  assert.strictEqual(resumeAt(NaN, 100), 0);
  assert.strictEqual(resumeAt(30, 0), 0);
});

test('store: per-file position and speed keyed by sha1 of the path; volume is global', async () => {
  const mem = memento();
  const s = createStore(mem);
  assert.strictEqual(s.get('/v/a.mp4'), null);
  await s.set('/v/a.mp4', { t: 12.3456, rate: 1.5 });
  assert.deepStrictEqual({ ...s.get('/v/a.mp4'), updated: 0 }, { t: 12.346, rate: 1.5, updated: 0 });
  assert.strictEqual(s.get('/v/b.mp4'), null);
  assert.ok(Object.keys(mem.data.get(POS_KEY)).every((k) => /^[0-9a-f]{40}$/.test(k)));
  assert.ok(!JSON.stringify(mem.data.get(POS_KEY)).includes('/v/a.mp4'), 'the path itself is not stored');
  assert.strictEqual(keyOf('/v/a.mp4'), keyOf('/v/a.mp4'));
  assert.strictEqual(s.getVolume(), null);
  await s.setVolume(0.4, true);
  assert.deepStrictEqual(s.getVolume(), { volume: 0.4, muted: true });
});

test('store: LRU keeps the 200 most recent files', async () => {
  let clock = 0;
  const s = createStore(memento(), { now: () => ++clock });
  for (let i = 0; i < 205; i++) await s.set('/v/' + i + '.mp4', { t: i, rate: 1 });
  assert.strictEqual(s.size(), 200);
  for (let i = 0; i < 5; i++) assert.strictEqual(s.get('/v/' + i + '.mp4'), null, String(i));
  await s.set('/v/5.mp4', { t: 99, rate: 1 }); // touch the oldest one left, so it survives
  await s.set('/v/new.mp4', { t: 1, rate: 1 });
  assert.strictEqual(s.get('/v/5.mp4').t, 99);
  assert.strictEqual(s.get('/v/6.mp4'), null);
  assert.strictEqual(s.size(), 200);
});
