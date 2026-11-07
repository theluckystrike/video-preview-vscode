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

test('plan: MKV and WebM need a remux; a video codec VS Code cannot decode is converted', () => {
  assert.strictEqual(plan('.mkv', null).mode, 'remux');
  assert.strictEqual(plan('.WEBM', null).mode, 'remux');
  const meta = { ok: true, tracks: [{ type: 'video', codec: 'mp4v.20.9' }, { type: 'audio', codec: 'mp4a.40.2' }] };
  assert.strictEqual(plan('.mp4', meta).mode, 'transcode');
  assert.match(plan('.mp4', meta).reason, /no decoder for MPEG-4 Part 2 video, so ffmpeg converts it to H\.264/);
  assert.ok(nativeVideo('hvc1.1.6.L93.B0') && nativeVideo('vp09.00.10.08') && !nativeVideo('mp4v.20.9'));
  assert.ok(!nativeAudio('mp4a.40.2') && !nativeAudio('opus') && nativeAudio('mp4a.6b') && nativeAudio('flac'));
  assert.strictEqual(codecName('mp4a.40.5'), 'AAC');
  assert.strictEqual(codecName('ec-3'), 'E-AC-3');
});

test('plan: ProRes MOV (mp4box calls it metadata) is a video track and gets transcode', async () => {
  const { meta } = await probe('clip-prores422-aac.mov');
  assert.ok(meta.ok);
  const v = meta.tracks.find((t) => t.type === 'video');
  assert.strictEqual(v.codec, 'apcn');
  assert.deepStrictEqual([v.width, v.height], [480, 270]);
  const p = plan('.mov', meta);
  assert.strictEqual(p.mode, 'transcode');
  assert.strictEqual(p.reason, 'VS Code has no decoder for Apple ProRes 422 video, so ffmpeg converts it to H.264 for playback.');
});

test('plan: AVI, MPEG, WMV, FLV, OGV, M2TS always transcode; .ts and .mts are never claimed', () => {
  const { TRANSCODE_EXT, fallbackPlan } = require('../src/core/media');
  for (const e of ['.avi', '.AVI', '.mpg', '.mpeg', '.wmv', '.flv', '.ogv', '.m2ts']) assert.strictEqual(plan(e, null).mode, 'transcode', e);
  assert.ok(!TRANSCODE_EXT.has('.ts') && !TRANSCODE_EXT.has('.mts'));
  assert.match(plan('.avi', null).reason, /cannot open \.avi files/);
  const pkg = require('../package.json');
  const pats = pkg.contributes.customEditors[0].selector.map((x) => x.filenamePattern);
  for (const e of ['avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ogv', 'm2ts']) assert.ok(pats.includes('*.' + e), e);
  assert.ok(!pats.includes('*.ts') && !pats.includes('*.mts'));
  const when = pkg.contributes.menus['explorer/context'][0].when;
  const re = new RegExp(when.match(/=~ \/(.*)\/i$/)[1], 'i');
  assert.ok(re.test('.avi') && re.test('.m2ts') && re.test('.mp4') && !re.test('.ts') && !re.test('.mts'));
  // Runtime fallback: once for a native plan, never again after a transcode.
  const meta = { ok: true, tracks: [{ type: 'video', codec: 'hvc1.2.4.L153' }, { type: 'audio', codec: 'mp4a.40.2' }] };
  const fb = fallbackPlan(plan('.mp4', meta), meta);
  assert.strictEqual(fb.mode, 'transcode');
  assert.ok(fb.runtime);
  assert.match(fb.reason, /could not decode the HEVC video on this computer/);
  assert.strictEqual(fallbackPlan(fb, meta), null);
  assert.strictEqual(fallbackPlan(plan('.mkv', null), null).mode, 'transcode');
});

test('codec names for ProRes, MPEG-4 Part 2 and friends', () => {
  assert.strictEqual(codecName('apch'), 'Apple ProRes 422 HQ');
  assert.strictEqual(codecName('apcs'), 'Apple ProRes 422 LT');
  assert.strictEqual(codecName('ap4h'), 'Apple ProRes 4444');
  assert.strictEqual(codecName('mp4v.20.9'), 'MPEG-4 Part 2');
  assert.strictEqual(codecName('mp4v.6a'), 'MPEG-1');
  assert.strictEqual(codecName('mjpa'), 'Motion JPEG');
});

test('not-media ffmpeg errors and their message', () => {
  const { isNotMediaError, notVideoText } = require('../src/core/media');
  assert.ok(isNotMediaError('[in#0 @ 0x1] Error opening input: Invalid data found when processing input'));
  assert.ok(isNotMediaError('moov atom not found'));
  assert.ok(!isNotMediaError('Unknown encoder libx264'));
  assert.strictEqual(notVideoText(0), 'This file is empty (0 bytes), so there is no video to play.');
  assert.match(notVideoText(63, 'ffmpeg'), /ffmpeg cannot read it/);
});
