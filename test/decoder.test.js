'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const d = require('../src/core/decoder');
const { fx, hasFfmpeg } = require('./helpers');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-dec-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('ffmpeg args: file: prefix, no shell words, FLAC out', () => {
  const a = d.buildArgs('ffmpeg', '/x/concat:evil|-y.mp4', '/c/o.flac', 'decode-audio');
  assert.strictEqual(a[a.indexOf('-i') + 1], 'file:/x/concat:evil|-y.mp4');
  assert.ok(a.includes('-nostdin'));
  assert.deepStrictEqual(a.slice(a.indexOf('-c:a'), a.indexOf('-c:a') + 2), ['-c:a', 'flac']);
  assert.strictEqual(a[a.length - 1], 'file:/c/o.flac');
  const r = d.buildArgs('ffmpeg', '/x/a.mkv', '/c/o.mp4', 'remux');
  assert.deepStrictEqual(r.slice(r.indexOf('-c:v'), r.indexOf('-c:v') + 2), ['-c:v', 'copy']);
  assert.ok(r.includes('+faststart'));
  assert.deepStrictEqual(d.buildArgs('afconvert', '/x/a.mp4', '/c/o.flac'), ['-f', 'flac', '-d', 'flac', '/x/a.mp4', '/c/o.flac']);
});

test('parseProgress reads the last out_time', () => {
  assert.strictEqual(d.parseProgress('frame=1\nout_time_us=1500000\nout_time_us=2500000\nprogress=continue\n'), 2.5);
  assert.strictEqual(d.parseProgress('nothing'), null);
});

test('which and findHelper honour PATH, the setting and "off"', () => {
  const bin = path.join(tmp, 'bin'); fs.mkdirSync(bin, { recursive: true });
  const ff = path.join(bin, 'ffmpeg'); fs.writeFileSync(ff, '#!/bin/sh\n'); fs.chmodSync(ff, 0o755);
  const env = { PATH: bin };
  assert.strictEqual(d.which('ffmpeg', env, 'freebsd'), ff);
  assert.strictEqual(d.which('nope', env, 'freebsd'), null);
  assert.deepStrictEqual(d.findHelper({ env, platform: 'freebsd' }), { tool: 'ffmpeg', path: ff });
  assert.strictEqual(d.findHelper({ env, platform: 'freebsd', preferred: 'off' }), null);
  assert.strictEqual(d.findHelper({ env: { PATH: '' }, platform: 'freebsd' }), null);
  assert.deepStrictEqual(d.findHelper({ env: { PATH: '' }, platform: 'freebsd', setting: ff }), { tool: 'ffmpeg', path: ff });
  assert.strictEqual(d.findHelper({ env: { PATH: '' }, platform: 'freebsd', setting: path.join(tmp, 'missing') }), null);
  if (process.platform === 'darwin' && fs.existsSync(d.AFCONVERT)) {
    assert.strictEqual(d.findHelper({ env: { PATH: '' }, platform: 'darwin', setting: path.join(tmp, 'missing') }).tool, 'afconvert');
    assert.strictEqual(d.findHelper({ env: { PATH: '' }, platform: 'darwin', setting: path.join(tmp, 'missing'), needFfmpeg: true }), null);
    assert.strictEqual(d.findHelper({ env, platform: 'darwin', preferred: 'afconvert' }).tool, 'afconvert');
  }
});

test('cacheKey changes when the file changes', () => {
  const a = d.cacheKey('/v/a.mp4', { size: 10, mtimeMs: 1 }, 'ffmpeg', 'decode-audio');
  assert.notStrictEqual(a, d.cacheKey('/v/a.mp4', { size: 10, mtimeMs: 2 }, 'ffmpeg', 'decode-audio'));
  assert.notStrictEqual(a, d.cacheKey('/v/a.mp4', { size: 10, mtimeMs: 1 }, 'afconvert', 'decode-audio'));
  assert.strictEqual(a, d.cacheKey('/v/a.mp4', { size: 10, mtimeMs: 1 }, 'ffmpeg', 'decode-audio'));
});

test('pruneCache removes the oldest files first and keeps the current one', () => {
  const c = path.join(tmp, 'cache'); fs.mkdirSync(c, { recursive: true });
  const names = ['a', 'b', 'c'].map((n, i) => { const p = path.join(c, n); fs.writeFileSync(p, Buffer.alloc(100)); const t = new Date(Date.now() - (3 - i) * 60000); fs.utimesSync(p, t, t); return p; });
  const removed = d.pruneCache(c, 250, new Set([names[0]]));
  assert.deepStrictEqual(removed, [names[1]]);
  assert.ok(fs.existsSync(names[0]) && fs.existsSync(names[2]));
});

test('run: a missing helper and a slow helper fail cleanly, with no temp file left', async () => {
  const out = path.join(tmp, 'x.flac');
  const r1 = await d.run({ helper: { tool: 'ffmpeg', path: path.join(tmp, 'no-such-ffmpeg') }, input: fx('clip-aac.mov'), output: out }).promise;
  assert.strictEqual(r1.ok, false);
  if (process.platform !== 'win32') {
    const slow = path.join(tmp, 'slow'); fs.writeFileSync(slow, '#!/bin/sh\nsleep 5\n'); fs.chmodSync(slow, 0o755);
    const r2 = await d.run({ helper: { tool: 'ffmpeg', path: slow }, input: fx('clip-aac.mov'), output: out, timeoutMs: 300 }).promise;
    assert.strictEqual(r2.ok, false);
    assert.match(r2.error, /longer than/);
    assert.deepStrictEqual(fs.readdirSync(tmp).filter((n) => n.includes('.part')), []);
  }
});

test('run: two jobs on the same output do not clash', { skip: !hasFfmpeg() && 'ffmpeg not on PATH' }, async () => {
  const helper = d.findHelper({ preferred: 'ffmpeg' });
  const out = path.join(tmp, 'same.flac');
  const [a, b] = await Promise.all([1, 2].map(() => d.run({ helper, input: fx('clip-aac.mov'), output: out, mode: 'decode-audio' }).promise));
  assert.ok(a.ok && b.ok, (a.error || '') + (b.error || ''));
  assert.strictEqual(fs.readFileSync(out).subarray(0, 4).toString(), 'fLaC');
});

test('run: real ffmpeg turns AAC into FLAC and remuxes MKV', { skip: !hasFfmpeg() && 'ffmpeg not on PATH' }, async () => {
  const helper = d.findHelper({ preferred: 'ffmpeg' });
  const prog = [];
  const flac = path.join(tmp, 'a.flac');
  const r = await d.run({ helper, input: fx('demo-h264-aac.mp4'), output: flac, mode: 'decode-audio', duration: 6, onProgress: (f) => prog.push(f) }).promise;
  assert.ok(r.ok, r.error);
  assert.strictEqual(fs.readFileSync(flac).subarray(0, 4).toString(), 'fLaC');
  assert.ok(prog.length > 0 && prog.every((f) => f >= 0 && f <= 1));
  const mp4 = path.join(tmp, 'b.mp4');
  const r2 = await d.run({ helper, input: fx('clip-h264-aac.mkv'), output: mp4, mode: 'remux' }).promise;
  assert.ok(r2.ok, r2.error);
  assert.strictEqual(fs.readFileSync(mp4).subarray(4, 8).toString(), 'ftyp');
  const bad = await d.run({ helper, input: fx('not-a-video.mp4'), output: path.join(tmp, 'c.flac'), mode: 'decode-audio' }).promise;
  assert.strictEqual(bad.ok, false);
});

test('run: macOS afconvert turns AAC into FLAC', { skip: !(process.platform === 'darwin' && fs.existsSync(d.AFCONVERT)) && 'not macOS' }, async () => {
  const flac = path.join(tmp, 'af.flac');
  const r = await d.run({ helper: { tool: 'afconvert', path: d.AFCONVERT }, input: fx('clip-aac.mov'), output: flac }).promise;
  assert.ok(r.ok, r.error);
  assert.strictEqual(fs.readFileSync(flac).subarray(0, 4).toString(), 'fLaC');
});
