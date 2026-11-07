'use strict';
// The built-in sound decoder (Symphonia in WebAssembly, media/vp-audio.wasm) on the fixture files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fx, hasFfmpeg } = require('./helpers');
const builtin = require('../src/core/builtin');
const media = require('../src/core/media');
const { wavHeader } = require('../src/core/wav');

const ROOT = path.join(__dirname, '..');
const WASM = path.join(ROOT, 'media', 'vp-audio.wasm');
const WORKER = path.join(ROOT, 'src', 'audio-worker.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-builtin-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function probe(file) {
  const fd = fs.openSync(file, 'r'); const size = fs.fstatSync(fd).size;
  try { return await media.probeMp4((pos, len) => { const b = Buffer.alloc(len); return Promise.resolve(b.subarray(0, fs.readSync(fd, b, 0, len, pos))); }, size); } finally { fs.closeSync(fd); }
}
async function decode(name, extra = {}) {
  const meta = /\.(mp4|mov|m4v)$/.test(name) ? await probe(fx(name)) : null;
  const out = path.join(tmp, name + '.wav');
  return { meta, out, r: await builtin.run({ input: fx(name), output: out, wasmPath: WASM, workerPath: WORKER, ...builtin.startFrames(meta), ...extra }).promise };
}
function pcm(file) { const b = fs.readFileSync(file); return { rate: b.readUInt32LE(24), ch: b.readUInt16LE(22), data: new Int16Array(b.buffer, b.byteOffset + 44, (b.length - 44) >> 1) }; }

test('the WASM file ships and is small', () => {
  const s = fs.statSync(WASM).size;
  assert.ok(s > 100000 && s < 1500000, s + ' bytes');
});

test('AAC in MP4, MOV and ProRes MOV decode to a WAV of the right length', async () => {
  for (const [name, secs] of [['demo-h264-aac.mp4', 6], ['clip-aac.mov', 2], ['clip-prores422-aac.mov', 2]]) {
    const { r, out } = await decode(name);
    assert.ok(r.ok, name + ': ' + r.error);
    assert.strictEqual(r.codec, 'aac');
    const p = pcm(out);
    assert.strictEqual(p.rate, 48000); assert.strictEqual(p.ch, 2);
    const got = p.data.length / p.ch / p.rate;
    assert.ok(Math.abs(got - secs) < 0.03, name + ': ' + got + ' s');
    assert.ok(p.data.some((x) => Math.abs(x) > 1000), name + ': silent');
  }
});

test('MP3 in MP4 decodes too', async () => {
  const { r } = await decode('h264-mp3.mp4');
  assert.ok(r.ok, r.error); assert.strictEqual(r.codec, 'mp3');
});

test('the edit list trims the AAC encoder delay: same samples as ffmpeg, within 1 ms', { skip: !hasFfmpeg() && 'ffmpeg not on PATH' }, async () => {
  const { r, out, meta } = await decode('demo-h264-aac.mp4');
  assert.ok(r.ok);
  const a = meta.tracks.find((t) => t.type === 'audio');
  assert.strictEqual(Math.round(a.startSkip * 48000), 1024);
  const ref = path.join(tmp, 'ref.wav');
  const ff = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', fx('demo-h264-aac.mp4'), '-map', '0:a:0', '-c:a', 'pcm_s16le', ref]);
  assert.strictEqual(ff.status, 0);
  const x = pcm(out).data; const y = pcm(ref).data;
  // Best lag in -100..100 frames over the first 2 s (left channel).
  let best = [0, -Infinity];
  for (let lag = -100; lag <= 100; lag++) {
    let s = 0;
    for (let i = 4800; i < 96000; i++) { const j = i + lag; s += x[2 * i] * (y[2 * j] || 0); }
    if (s > best[1]) best = [lag, s];
  }
  assert.ok(Math.abs(best[0]) <= 48, 'lag ' + best[0] + ' frames');
});

test('not a video, no audio track, and a missing file fail with a clear status', async () => {
  const a = await decode('not-a-video.mp4');
  assert.strictEqual(a.r.ok, false); assert.strictEqual(a.r.status, -1);
  const b = await decode('no-audio.mp4');
  assert.strictEqual(b.r.ok, false); assert.strictEqual(b.r.status, -2);
  assert.ok(!fs.existsSync(b.out));
  const c = await builtin.run({ input: path.join(tmp, 'missing.mp4'), output: path.join(tmp, 'm.wav'), wasmPath: WASM, workerPath: WORKER }).promise;
  assert.strictEqual(c.ok, false);
});

test('cancel stops the worker and leaves no partial file', async () => {
  const job = builtin.run({ input: fx('demo-h264-aac.mp4'), output: path.join(tmp, 'c.wav'), wasmPath: WASM, workerPath: WORKER });
  job.cancel();
  const r = await job.promise;
  assert.strictEqual(r.ok, false);
  await new Promise((z) => setTimeout(z, 100));
  assert.deepStrictEqual(fs.readdirSync(tmp).filter((n) => n.startsWith('c.wav')), []);
});

test('supports: AAC, ALAC, MP3, PCM yes; AC-3, E-AC-3, Opus, DTS no', () => {
  for (const c of ['mp4a.40.2', 'mp4a.40.5', 'mp4a.67', 'alac', '.mp3', 'mp4a.6b', 'sowt', 'twos', 'lpcm', 'in24', '']) assert.ok(builtin.supports(c), c);
  for (const c of ['ac-3', 'ec-3', 'Opus', 'dtsc', 'mp4a.a5', 'mp4a.a6', 'samr']) assert.ok(!builtin.supports(c), c);
});

test('edit list offsets: media_time skip and an empty edit', () => {
  assert.deepStrictEqual(media.editOffsets([{ media_time: 1024, segment_duration: 100 }], 1000, 48000), { startSkip: 0.021333, startPad: 0 });
  assert.deepStrictEqual(media.editOffsets([{ media_time: -1, segment_duration: 500 }, { media_time: 0, segment_duration: 100 }], 1000, 48000), { startSkip: 0, startPad: 0.5 });
  assert.deepStrictEqual(builtin.startFrames({ ok: true, tracks: [{ type: 'audio', sampleRate: 44100, startSkip: 0.5, startPad: 0.25 }] }), { skip: 0.5, pad: 0.25 });
  assert.deepStrictEqual(builtin.startFrames(null), { skip: null, pad: 0 });
});

test('wav header', () => {
  const h = wavHeader(44100, 2, 1000);
  assert.strictEqual(h.toString('ascii', 0, 4), 'RIFF'); assert.strictEqual(h.readUInt32LE(4), 1036);
  assert.strictEqual(h.readUInt32LE(28), 176400); assert.strictEqual(h.readUInt32LE(40), 1000);
  assert.strictEqual(wavHeader(48000, 2, 2 ** 33).readUInt32LE(40), 0xffffffff - 36);
});

test('PCM in MOV and ALAC: seen as sound (mp4box calls them metadata), planned for decoding, and decoded', async () => {
  for (const [name, codec, rate] of [['clip-pcm.mov', 'pcm_s16le', 48000], ['clip-alac.m4v', 'alac', 44100]]) {
    const meta = await probe(fx(name));
    const a = meta.tracks.find((t) => t.type === 'audio');
    assert.ok(a, name + ': no audio track');
    assert.strictEqual(media.plan(path.extname(name), meta).mode, 'decode-audio');
    assert.ok(builtin.supports(a.codec), a.codec);
    const { r, out } = await decode(name);
    assert.ok(r.ok, r.error); assert.strictEqual(r.codec, codec); assert.strictEqual(r.rate, rate);
    const p = pcm(out);
    assert.ok(Math.abs(p.data.length / p.ch / p.rate - 1) < 0.03);
  }
});
