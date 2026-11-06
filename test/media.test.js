'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { probeMp4, plan, nativeAudio, nativeVideo } = require('../src/core/media');
const { codecName } = require('../src/core/media-names');
const { fx, reader } = require('./helpers');

async function probe(name, opts) { const r = reader(fx(name)); try { return { meta: await probeMp4(r.read, r.size, opts), r }; } finally { r.close(); } }

test('H.264 + AAC MP4: codecs, size, fps, duration', async () => {
  const { meta } = await probe('demo-h264-aac.mp4');
  assert.ok(meta.ok);
  const v = meta.tracks.find((t) => t.type === 'video'); const a = meta.tracks.find((t) => t.type === 'audio');
  assert.match(v.codec, /^avc1\./);
  assert.deepStrictEqual([v.width, v.height], [1280, 720]);
  assert.strictEqual(Math.round(v.fps), 30);
  assert.strictEqual(v.samples, 180);
  assert.strictEqual(a.codec, 'mp4a.40.2');
  assert.strictEqual(a.sampleRate, 48000);
  assert.strictEqual(a.channels, 2);
  assert.ok(Math.abs(meta.duration - 6) < 0.05, String(meta.duration));
  assert.strictEqual(plan('.mp4', meta).mode, 'decode-audio');
});

test('moov at the end is found without reading the whole mdat in one go', async () => {
  const { meta, r } = await probe('moov-at-end.mp4', { chunk: 4096 });
  assert.ok(meta.ok);
  assert.ok(r.calls.every(([, len]) => len <= 4096));
  assert.strictEqual(meta.tracks.length, 2);
});

test('MOV with AAC, MP3 in MP4, and no audio', async () => {
  assert.strictEqual(plan('.mov', (await probe('clip-aac.mov')).meta).mode, 'decode-audio');
  const mp3 = (await probe('h264-mp3.mp4')).meta;
  assert.ok(nativeAudio(mp3.tracks.find((t) => t.type === 'audio').codec));
  assert.strictEqual(plan('.mp4', mp3).mode, 'native');
  const silent = (await probe('no-audio.mp4')).meta;
  assert.strictEqual(silent.tracks.length, 1);
  assert.strictEqual(plan('.mp4', silent).mode, 'video-only');
});

test('a text file named .mp4 is reported, not thrown', async () => {
  const { meta } = await probe('not-a-video.mp4');
  assert.strictEqual(meta.ok, false);
  assert.strictEqual(plan('.mp4', meta).mode, 'decode-audio');
});

test('maxBytes stops a file with no movie header', async () => {
  const big = Buffer.alloc(3 * 1024 * 1024, 0x41);
  const meta = await probeMp4(async (p, l) => big.subarray(p, p + l), big.length, { chunk: 1024 * 1024, maxBytes: 2 * 1024 * 1024 });
  assert.strictEqual(meta.ok, false);
  assert.ok(meta.bytesRead <= 2 * 1024 * 1024);
});

test('plan: MKV and WebM need a remux; unknown video codec is refused', () => {
  assert.strictEqual(plan('.mkv', null).mode, 'remux');
  assert.strictEqual(plan('.WEBM', null).mode, 'remux');
  const meta = { ok: true, tracks: [{ type: 'video', codec: 'mp4v.20.9' }, { type: 'audio', codec: 'mp4a.40.2' }] };
  assert.strictEqual(plan('.mp4', meta).mode, 'unsupported');
  assert.ok(nativeVideo('hvc1.1.6.L93.B0') && nativeVideo('vp09.00.10.08') && !nativeVideo('mp4v.20.9'));
  assert.ok(!nativeAudio('mp4a.40.2') && !nativeAudio('opus') && nativeAudio('mp4a.6b') && nativeAudio('flac'));
  assert.strictEqual(codecName('mp4a.40.5'), 'AAC');
  assert.strictEqual(codecName('ec-3'), 'E-AC-3');
});
