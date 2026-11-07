'use strict';
// Convert videos VS Code cannot decode to H.264: arguments, encoder fallback, and one real ffmpeg run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const d = require('../src/core/decoder');
const { hasFfmpeg } = require('./helpers');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-tc-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('transcode args: map, libx264 veryfast crf 20, even size, FLAC, faststart, file: prefix on both ends', () => {
  const a = d.buildArgs('ffmpeg', '/v/-evil|concat:x.mov', '/c/o.mp4', 'transcode');
  assert.strictEqual(a[a.indexOf('-i') + 1], 'file:/v/-evil|concat:x.mov');
  assert.strictEqual(a[a.length - 1], 'file:/c/o.mp4');
  const seq = a.join(' ');
  assert.ok(seq.includes('-map 0:v:0 -map 0:a:0? -sn -dn -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -vf scale=trunc(iw/2)*2:trunc(ih/2)*2 -c:a flac -strict -2 -movflags +faststart -f mp4'), seq);
  assert.ok(seq.includes('-progress pipe:1 -nostats'));
  assert.ok(a.includes('-nostdin'));
  assert.ok(a.every((x) => typeof x === 'string'));
  const vt = d.buildArgs('ffmpeg', '/v/a.mov', '/c/o.mp4', 'transcode', { encoder: 'h264_videotoolbox' });
  assert.deepStrictEqual(vt.slice(vt.indexOf('-c:v'), vt.indexOf('-c:v') + 6), ['-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-b:v', '8M']);
  assert.ok(!vt.includes('-crf') && !vt.includes('libx264'));
  const mf = d.buildArgs('ffmpeg', '/v/a.mov', '/c/o.mp4', 'transcode', { encoder: 'h264_mf' });
  assert.ok(mf.includes('h264_mf') && !mf.includes('-crf'));
});

test('encoder fallback: only for a missing libx264, per platform, once', () => {
  const missing = "[vost#0:0 @ 0x1] Unknown encoder 'libx264'\nError selecting an encoder\nError opening output files: Encoder not found";
  assert.strictEqual(d.fallbackEncoder(missing, 'libx264', 'darwin'), 'h264_videotoolbox');
  assert.strictEqual(d.fallbackEncoder(missing, 'libx264', 'win32'), 'h264_mf');
  assert.strictEqual(d.fallbackEncoder(missing, 'libx264', 'linux'), null);
  assert.strictEqual(d.fallbackEncoder(missing, 'h264_videotoolbox', 'darwin'), null);
  assert.strictEqual(d.fallbackEncoder('Invalid data found when processing input', 'libx264', 'darwin'), null);
  assert.strictEqual(d.fallbackEncoder('', 'libx264', 'darwin'), null);
});

test('parseDuration reads the input duration from the ffmpeg log', () => {
  assert.strictEqual(d.parseDuration('  Duration: 00:01:02.50, start: 0.000000, bitrate: 1 kb/s'), 62.5);
  assert.strictEqual(d.parseDuration('Duration: N/A'), 0);
});

test('cache key: the transcode is a separate file from the sound and the remux', () => {
  const st = { size: 1, mtimeMs: 1 };
  const k = (m) => d.cacheKey('/v/a.mov', st, 'ffmpeg', m);
  assert.strictEqual(new Set([k('transcode'), k('decode-audio'), k('remux')]).size, 3);
});

test('run: an ffmpeg without libx264 is retried once with the fallback encoder, and says which ran', { skip: process.platform === 'win32' && 'needs sh' }, async () => {
  // Fake ffmpeg: fails like a build without libx264, otherwise writes the output (last arg, after "file:").
  const fake = path.join(tmp, 'fake-ffmpeg');
  const log = path.join(tmp, 'calls.txt');
  fs.writeFileSync(fake, `#!/bin/sh
echo "$*" >> '${log}'
for a in "$@"; do last="$a"; done
case "$*" in *libx264*) echo "Unknown encoder 'libx264'" >&2; echo "Error opening output files: Encoder not found" >&2; exit 8;; esac
printf 'xxxxftypisom' > "\${last#file:}"
`);
  fs.chmodSync(fake, 0o755);
  const out = path.join(tmp, 'fb.mp4');
  const platform = process.platform === 'win32' ? 'win32' : 'darwin';
  const r = await d.run({ helper: { tool: 'ffmpeg', path: fake }, input: path.join(tmp, 'in.mov'), output: out, mode: 'transcode', platform }).promise;
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.encoder, 'h264_videotoolbox');
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.strictEqual(calls.length, 2);
  assert.match(calls[0], /libx264/);
  assert.match(calls[1], /h264_videotoolbox/);
  // No second fallback on Linux: the libx264 error is reported.
  fs.rmSync(log);
  const r2 = await d.run({ helper: { tool: 'ffmpeg', path: fake }, input: path.join(tmp, 'in.mov'), output: path.join(tmp, 'fb2.mp4'), mode: 'transcode', platform: 'linux' }).promise;
  assert.strictEqual(r2.ok, false);
  assert.match(r2.error, /Encoder not found/);
  assert.strictEqual(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1);
  assert.deepStrictEqual(fs.readdirSync(tmp).filter((n) => n.includes('.part')), []);
});

test('run: real ffmpeg converts a generated 1 s ProRes clip to H.264 MP4', { skip: !hasFfmpeg() && 'ffmpeg not on PATH' }, async () => {
  const ff = d.which('ffmpeg');
  const src = path.join(tmp, 'gen-prores.mov');
  const out = path.join(tmp, 'gen-prores.h264.mp4');
  test.after(() => { fs.rmSync(src, { force: true }); fs.rmSync(out, { force: true }); });
  execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=321x181:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '1', '-c:v', 'prores_ks', '-profile:v', '2', '-c:a', 'aac', src]);
  const prog = [];
  const r = await d.run({ helper: { tool: 'ffmpeg', path: ff }, input: src, output: out, mode: 'transcode', duration: 0, onProgress: (f) => prog.push(f) }).promise;
  assert.ok(r.ok, r.error);
  assert.ok(['libx264', 'h264_videotoolbox', 'h264_mf'].includes(r.encoder));
  const b = fs.readFileSync(out);
  assert.strictEqual(b.subarray(4, 8).toString(), 'ftyp');
  assert.ok(b.includes('avc1'), 'H.264 sample entry');
  assert.ok(b.includes('fLaC'), 'FLAC sound');
  assert.ok(prog.length > 0 && prog.every((f) => f >= 0 && f <= 1), 'progress from the logged duration');
});
