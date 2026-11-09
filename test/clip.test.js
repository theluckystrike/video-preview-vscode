'use strict';
// MP4 clip export through the user's ffmpeg (Zovo Pro, lane PRO4).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('../src/core/clip');
const { which } = require('../src/core/decoder');
const { fx } = require('./helpers');

test('clipArgs: input seek before -i, file: paths, exact = H.264 + AAC, copy = no re-encode', () => {
  const a = C.clipArgs({ input: '/v/-x.mp4', output: '/o/c.mp4', a: 1.2345, b: 3, mode: 'exact', encoder: 'libx264' });
  assert.deepStrictEqual(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 4), ['-ss', '1.234', '-i', 'file:/v/-x.mp4']);
  assert.strictEqual(a[a.indexOf('-t') + 1], '1.766');
  assert.ok(a.includes('libx264') && a.includes('aac'));
  assert.strictEqual(a.at(-1), 'file:/o/c.mp4');
  const c = C.clipArgs({ input: '/v/a.mov', output: '/o/c.mp4', a: 0, b: 2, mode: 'copy' });
  assert.deepStrictEqual(c.slice(c.indexOf('-c'), c.indexOf('-c') + 2), ['-c', 'copy']);
  assert.ok(!c.includes('libx264'));
  assert.ok(!a.some((x) => /[;&|`$]/.test(x) && !x.startsWith('file:') && !x.startsWith('scale=')), 'no shell syntax');
});

const ffmpeg = which('ffmpeg');
const ffprobe = which('ffprobe');
const probe = (f) => JSON.parse(spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', f], { encoding: 'utf8' }).stdout);

test('runClip exact: a 1 s clip with picture and sound, no temp file left', { skip: !(ffmpeg && ffprobe) && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'));
  try {
    const out = path.join(dir, 'cut.mp4');
    let last = 0;
    const r = await C.runClip({ ffmpeg, input: fx('demo-h264-aac.mp4'), output: out, a: 1, b: 2, mode: 'exact', timeoutMs: 60000, onProgress: (p) => { last = p; } }).promise;
    assert.strictEqual(r.ok, true, r.error);
    const p = probe(out);
    assert.ok(Math.abs(Number(p.format.duration) - 1) < 0.1, 'duration ' + p.format.duration);
    assert.deepStrictEqual(p.streams.map((s) => s.codec_type).sort(), ['audio', 'video']);
    assert.ok(p.streams.some((s) => s.codec_name === 'h264') && p.streams.some((s) => s.codec_name === 'aac'));
    assert.deepStrictEqual(fs.readdirSync(dir), ['cut.mp4']);
    assert.ok(last >= 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('runClip copy: fast copy of an MKV part into MP4', { skip: !(ffmpeg && ffprobe) && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'));
  try {
    const out = path.join(dir, 'copy.mp4');
    const r = await C.runClip({ ffmpeg, input: fx('clip-h264-aac.mkv'), output: out, a: 0.5, b: 1.5, mode: 'copy', timeoutMs: 60000 }).promise;
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.encoder, 'copy');
    assert.ok(probe(out).streams.some((s) => s.codec_name === 'h264'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('runClip: a file that is not a video fails cleanly, no output and no temp file', { skip: !ffmpeg && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'));
  try {
    const r = await C.runClip({ ffmpeg, input: fx('not-a-video.mp4'), output: path.join(dir, 'x.mp4'), a: 0, b: 1, mode: 'exact', timeoutMs: 30000 }).promise;
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.length > 0);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('runClip: cancel stops ffmpeg and leaves nothing', { skip: !ffmpeg && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'));
  try {
    const job = C.runClip({ ffmpeg, input: fx('clip-prores422-aac.mov'), output: path.join(dir, 'x.mp4'), a: 0, b: 4, mode: 'exact', timeoutMs: 60000 });
    job.cancel();
    const r = await job.promise;
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
