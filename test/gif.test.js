'use strict';
// GIF writer: decoded by an independent LZW decoder here, and by ffmpeg when it is installed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createGifWriter, quantize } = require('../src/core/gif');

/** Minimal GIF reader for the tests: returns { w, h, loop, frames: [{ delay, palette, index }] }. */
function readGif(b) {
  assert.strictEqual(Buffer.from(b.subarray(0, 6)).toString('latin1'), 'GIF89a');
  const w = b[6] | (b[7] << 8), h = b[8] | (b[9] << 8);
  let p = 13;
  if (b[10] & 0x80) p += 3 << ((b[10] & 7) + 1);
  const frames = [];
  let loop = null, delay = 0;
  for (;;) {
    const t = b[p++];
    if (t === 0x3b) break;
    if (t === 0x21) {
      const label = b[p++];
      if (label === 0xf9) delay = b[p + 2] | (b[p + 3] << 8);
      if (label === 0xff && Buffer.from(b.subarray(p + 1, p + 12)).toString('latin1') === 'NETSCAPE2.0') loop = b[p + 14] | (b[p + 15] << 8);
      while (b[p]) p += b[p] + 1;
      p++;
      continue;
    }
    assert.strictEqual(t, 0x2c, 'image descriptor expected at ' + (p - 1));
    const fw = b[p + 4] | (b[p + 5] << 8), fh = b[p + 6] | (b[p + 7] << 8), flags = b[p + 8];
    p += 9;
    assert.ok(flags & 0x80, 'local colour table');
    const n = 1 << ((flags & 7) + 1);
    const palette = b.subarray(p, p + n * 3);
    p += n * 3;
    const min = b[p++];
    const data = [];
    while (b[p]) { for (let i = 1; i <= b[p]; i++) data.push(b[p + i]); p += b[p] + 1; }
    p++;
    frames.push({ delay, palette, index: unlzw(data, min, fw * fh) });
  }
  return { w, h, loop, frames };
}

function unlzw(data, min, count) {
  const clear = 1 << min, eoi = clear + 1;
  let size = min + 1, dict = [], next = 0, prev = null;
  const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = []; next = eoi + 1; size = min + 1; prev = null; };
  reset();
  const out = [];
  let bit = 0;
  const read = () => { let v = 0; for (let i = 0; i < size; i++, bit++) v |= ((data[bit >> 3] >> (bit & 7)) & 1) << i; return v; };
  while (bit + size <= data.length * 8) {
    const code = read();
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    let entry;
    if (code < next && dict[code]) entry = dict[code];
    else if (code === next && prev) entry = prev.concat(prev[0]);
    else throw new Error('bad code ' + code + ' at bit ' + bit);
    out.push(...entry);
    if (prev && next < 4096) { dict[next++] = prev.concat(entry[0]); if (next === (1 << size) && size < 12) size++; }
    prev = entry;
  }
  assert.strictEqual(out.length, count, 'pixel count');
  return Uint8Array.from(out);
}

function pattern(w, h, seed) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    px[i] = (x * 255 / w + seed * 40) & 255; px[i + 1] = (y * 255 / h) & 255; px[i + 2] = ((x ^ y) * 3 + seed * 17) & 255; px[i + 3] = 255;
  }
  return px;
}

test('a two-colour frame keeps its exact colours', () => {
  const w = 10, h = 4, px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { const red = i % 3 === 0; px.set(red ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4); }
  const g = createGifWriter(w, h);
  g.addFrame(px, 5);
  const r = readGif(g.finish());
  assert.strictEqual(r.frames.length, 1);
  assert.strictEqual(r.frames[0].delay, 5);
  assert.strictEqual(r.loop, 0);
  for (let i = 0; i < w * h; i++) {
    const c = r.frames[0].index[i];
    assert.deepStrictEqual([...r.frames[0].palette.subarray(c * 3, c * 3 + 3)], i % 3 === 0 ? [255, 0, 0] : [0, 0, 255]);
  }
});

test('many colours: the decoded indices equal the quantizer output and the colour error stays small', () => {
  const w = 160, h = 90;
  const g = createGifWriter(w, h);
  const frames = [pattern(w, h, 0), pattern(w, h, 1), pattern(w, h, 2)];
  for (const f of frames) g.addFrame(f, 7);
  const r = readGif(g.finish());
  assert.strictEqual(r.frames.length, 3);
  frames.forEach((f, k) => {
    const q = quantize(f, 256);
    assert.deepStrictEqual(Buffer.from(r.frames[k].index), Buffer.from(q.index));
    let err = 0;
    for (let i = 0; i < w * h; i++) { const c = q.index[i]; for (let ch = 0; ch < 3; ch++) err += Math.abs(f[i * 4 + ch] - q.palette[c * 3 + ch]); }
    assert.ok(err / (w * h * 3) < 6, 'mean error per channel ' + (err / (w * h * 3)).toFixed(2));
  });
});

test('long runs fill the LZW table and clear it (4096 codes) without breaking the stream', () => {
  const w = 600, h = 400; // 240,000 pixels of noise force several table resets
  const px = new Uint8Array(w * h * 4);
  let s = 12345;
  for (let i = 0; i < px.length; i += 4) { s = (s * 1103515245 + 12345) >>> 0; px[i] = s >>> 24; px[i + 1] = (s >>> 16) & 255; px[i + 2] = (s >>> 8) & 255; px[i + 3] = 255; }
  const g = createGifWriter(w, h);
  g.addFrame(px, 10);
  const r = readGif(g.finish());
  assert.deepStrictEqual(Buffer.from(r.frames[0].index), Buffer.from(quantize(px, 256).index));
});

test('one flat colour and a tiny frame', () => {
  const g = createGifWriter(1, 1);
  g.addFrame(new Uint8Array([9, 8, 7, 255]), 1);
  const r = readGif(g.finish());
  assert.deepStrictEqual([...r.frames[0].palette.subarray(0, 3)], [9, 8, 7]);
  assert.strictEqual(r.frames[0].delay, 2, 'delays under 2/100 s are raised to 2 (browsers slow them down anyway)');
});

test('wrong frame size is refused, finish twice gives the same file', () => {
  const g = createGifWriter(4, 4);
  assert.throws(() => g.addFrame(new Uint8Array(10), 5), /needs 64 bytes/);
  g.addFrame(new Uint8Array(64).fill(200), 5);
  const a = g.finish(), b = g.finish();
  assert.deepStrictEqual(a, b);
  assert.throws(() => g.addFrame(new Uint8Array(64), 5), /already finished/);
});

const ffmpeg = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find((p) => fs.existsSync(p));
test('ffmpeg decodes the file to the same pixels', { skip: !ffmpeg && 'ffmpeg not installed' }, () => {
  const w = 64, h = 36;
  const g = createGifWriter(w, h);
  const f0 = pattern(w, h, 3), f1 = pattern(w, h, 5);
  g.addFrame(f0, 10); g.addFrame(f1, 10);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gif-test-'));
  try {
    const file = path.join(dir, 'a.gif');
    fs.writeFileSync(file, g.finish());
    const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 });
    assert.strictEqual(r.status, 0, String(r.stderr));
    assert.strictEqual(r.stdout.length, w * h * 3 * 2);
    [f0, f1].forEach((f, k) => {
      const q = quantize(f, 256);
      for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) assert.strictEqual(r.stdout[k * w * h * 3 + i * 3 + c], q.palette[q.index[i] * 3 + c]);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

module.exports = { readGif };
