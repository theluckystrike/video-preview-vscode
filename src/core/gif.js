'use strict';
// Animated GIF writer with no dependencies (lane PRO4). Runs in the webview and in node tests.
// Each frame gets its own palette of up to 256 colours (median cut on a 15-bit colour histogram), then LZW.
//   const g = createGifWriter(480, 270);
//   g.addFrame(rgbaPixels, 7);          // delay in 1/100 s
//   const bytes = g.finish();          // Uint8Array, a complete .gif file

/** Growable byte buffer. */
function byteSink(initial) {
  let buf = new Uint8Array(initial || 65536);
  let n = 0;
  const grow = (need) => {
    if (n + need <= buf.length) return;
    let size = buf.length * 2;
    while (size < n + need) size *= 2;
    const b = new Uint8Array(size);
    b.set(buf.subarray(0, n));
    buf = b;
  };
  return {
    byte(v) { grow(1); buf[n++] = v & 255; },
    u16(v) { grow(2); buf[n++] = v & 255; buf[n++] = (v >> 8) & 255; },
    bytes(a) { grow(a.length); buf.set(a, n); n += a.length; },
    ascii(s) { grow(s.length); for (let i = 0; i < s.length; i++) buf[n++] = s.charCodeAt(i) & 255; },
    get length() { return n; },
    result() { return buf.slice(0, n); },
  };
}

/**
 * Reduce RGBA pixels to at most maxColors colours.
 * Returns { palette: Uint8Array (3 per colour), colors, index: Uint8Array (one per pixel) }.
 */
function quantize(rgba, maxColors) {
  const max = Math.max(2, Math.min(256, maxColors || 256));
  const px = rgba.length >> 2;
  const count = new Uint32Array(32768);
  const sumR = new Float64Array(32768), sumG = new Float64Array(32768), sumB = new Float64Array(32768);
  const key = new Uint16Array(px);
  for (let i = 0, p = 0; p < px; p++, i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    key[p] = k;
    count[k]++; sumR[k] += r; sumG[k] += g; sumB[k] += b;
  }
  const bins = [];
  for (let k = 0; k < 32768; k++) if (count[k]) bins.push(k);
  // Boxes over the bin list. Each box is a range [lo, hi) of `bins`, sorted on demand by its widest channel.
  const ch = (k, c) => (c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31);
  const boxInfo = (lo, hi) => {
    let mn = [31, 31, 31], mx = [0, 0, 0], w = 0;
    for (let i = lo; i < hi; i++) {
      const k = bins[i];
      for (let c = 0; c < 3; c++) { const v = ch(k, c); if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; }
      w += count[k];
    }
    const span = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    const c = span[0] >= span[1] && span[0] >= span[2] ? 0 : span[1] >= span[2] ? 1 : 2;
    return { lo, hi, w, c, span: span[c] };
  };
  const boxes = [boxInfo(0, bins.length)];
  while (boxes.length < max) {
    // Split the box with the most pixels among those that can still split (weight times span keeps detail in
    // large flat areas and in wide gradients).
    let best = -1, score = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.hi - b.lo < 2 || b.span === 0) continue;
      const s = b.w * (b.span + 1);
      if (s > score) { score = s; best = i; }
    }
    if (best < 0) break;
    const b = boxes[best];
    const part = bins.slice(b.lo, b.hi).sort((x, y) => ch(x, b.c) - ch(y, b.c));
    for (let i = 0; i < part.length; i++) bins[b.lo + i] = part[i];
    let acc = 0, cut = b.lo + 1;
    for (let i = b.lo; i < b.hi - 1; i++) { acc += count[bins[i]]; if (acc * 2 >= b.w) { cut = i + 1; break; } cut = i + 1; }
    boxes.splice(best, 1, boxInfo(b.lo, cut), boxInfo(cut, b.hi));
  }
  const colors = Math.max(1, boxes.length);
  const palette = new Uint8Array(colors * 3);
  const map = new Uint8Array(32768);
  const average = () => {
    const acc = new Float64Array(colors * 4);
    for (const k of bins) { const c = map[k] * 4; acc[c] += sumR[k]; acc[c + 1] += sumG[k]; acc[c + 2] += sumB[k]; acc[c + 3] += count[k]; }
    for (let c = 0; c < colors; c++) {
      const w = acc[c * 4 + 3];
      if (!w) continue; // an emptied colour keeps its old value
      palette[c * 3] = Math.round(acc[c * 4] / w); palette[c * 3 + 1] = Math.round(acc[c * 4 + 1] / w); palette[c * 3 + 2] = Math.round(acc[c * 4 + 2] / w);
    }
  };
  boxes.forEach((b, bi) => { for (let i = b.lo; i < b.hi; i++) map[bins[i]] = bi; });
  average();
  // One k-means pass on the bins: each bin moves to its nearest palette colour, then the colours are averaged again.
  // It removes most of the banding median cut leaves at box edges, for about 30 ms on a busy 640 x 360 frame.
  if (colors > 1 && bins.length > colors) {
    for (const k of bins) {
      const r = sumR[k] / count[k], g = sumG[k] / count[k], b = sumB[k] / count[k];
      let best = map[k], bd = Infinity;
      for (let c = 0; c < colors; c++) {
        const dr = palette[c * 3] - r, dg = palette[c * 3 + 1] - g, db = palette[c * 3 + 2] - b;
        const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (d < bd) { bd = d; best = c; }
      }
      map[k] = best;
    }
    average();
  }
  const index = new Uint8Array(px);
  for (let p = 0; p < px; p++) index[p] = map[key[p]];
  return { palette, colors, index };
}

/** GIF LZW, the classic compress(1) hash scheme (5003 slots). Writes the code size byte and the data sub-blocks. */
function lzw(indices, minCodeSize, out) {
  const HSIZE = 5003;
  const BITS = 12, MAXMAX = 1 << BITS;
  const htab = new Int32Array(HSIZE).fill(-1);
  const codetab = new Int32Array(HSIZE);
  const initBits = minCodeSize + 1;
  const clearCode = 1 << minCodeSize, eofCode = clearCode + 1;
  let nBits = initBits, maxcode = (1 << nBits) - 1, freeEnt = clearCode + 2, clearFlg = false;
  let accum = 0, accBits = 0;
  const block = new Uint8Array(255);
  let blen = 0;
  const flushBlock = () => { if (blen) { out.byte(blen); out.bytes(block.subarray(0, blen)); blen = 0; } };
  const emitByte = (v) => { block[blen++] = v; if (blen === 255) flushBlock(); };
  const output = (code) => {
    accum |= code << accBits;
    accBits += nBits;
    while (accBits >= 8) { emitByte(accum & 255); accum >>>= 8; accBits -= 8; }
    if (freeEnt > maxcode || clearFlg) {
      if (clearFlg) { nBits = initBits; maxcode = (1 << nBits) - 1; clearFlg = false; }
      else { nBits++; maxcode = nBits === BITS ? MAXMAX : (1 << nBits) - 1; }
    }
    if (code === eofCode) { while (accBits > 0) { emitByte(accum & 255); accum >>>= 8; accBits -= 8; } accBits = 0; flushBlock(); }
  };
  let hshift = 0;
  for (let f = HSIZE; f < 65536; f *= 2) hshift++;
  hshift = 8 - hshift;
  out.byte(minCodeSize);
  output(clearCode);
  if (!indices.length) { output(eofCode); out.byte(0); return; }
  let ent = indices[0];
  outer: for (let i = 1; i < indices.length; i++) {
    const c = indices[i];
    const fcode = (c << BITS) + ent;
    let h = (c << hshift) ^ ent;
    if (htab[h] === fcode) { ent = codetab[h]; continue; }
    if (htab[h] >= 0) {
      const disp = h === 0 ? 1 : HSIZE - h;
      do {
        h -= disp;
        if (h < 0) h += HSIZE;
        if (htab[h] === fcode) { ent = codetab[h]; continue outer; }
      } while (htab[h] >= 0);
    }
    output(ent);
    ent = c;
    if (freeEnt < MAXMAX) { codetab[h] = freeEnt++; htab[h] = fcode; }
    else { htab.fill(-1); freeEnt = clearCode + 2; clearFlg = true; output(clearCode); }
  }
  output(ent);
  output(eofCode);
  out.byte(0); // block terminator
}

/**
 * opts.loop: 0 = repeat forever (default), null = play once.
 * addFrame(rgba, delayCs): rgba is width*height*4 bytes. Returns the file size so far.
 */
function createGifWriter(width, height, opts) {
  const w = Math.max(1, Math.min(65535, width | 0)), h = Math.max(1, Math.min(65535, height | 0));
  const o = opts || {};
  const out = byteSink(1 << 20);
  let frames = 0, done = false;
  out.ascii('GIF89a');
  out.u16(w); out.u16(h);
  out.byte(0x70); // no global colour table, 8-bit colour resolution
  out.byte(0); out.byte(0);
  if (o.loop !== null) {
    out.bytes([0x21, 0xff, 0x0b]); out.ascii('NETSCAPE2.0'); out.bytes([3, 1]); out.u16(o.loop || 0); out.byte(0);
  }
  return {
    width: w, height: h,
    get frames() { return frames; },
    get size() { return out.length; },
    addFrame(rgba, delayCs) {
      if (done) throw new Error('The GIF is already finished.');
      if (!rgba || rgba.length < w * h * 4) throw new Error(`A frame needs ${w * h * 4} bytes of RGBA, got ${rgba ? rgba.length : 0}.`);
      const q = quantize(rgba.length === w * h * 4 ? rgba : rgba.subarray(0, w * h * 4), o.colors || 256);
      let bits = 1;
      while ((1 << bits) < q.colors) bits++;
      const delay = Math.max(2, Math.min(65535, Math.round(delayCs || 10)));
      out.bytes([0x21, 0xf9, 4, 0x04]); out.u16(delay); out.byte(0); out.byte(0); // disposal 1 (keep), no transparency
      out.byte(0x2c); out.u16(0); out.u16(0); out.u16(w); out.u16(h);
      out.byte(0x80 | (bits - 1)); // local colour table
      const table = new Uint8Array(3 << bits);
      table.set(q.palette);
      out.bytes(table);
      lzw(q.index, Math.max(2, bits), out);
      frames++;
      return out.length;
    },
    finish() {
      if (!done) { out.byte(0x3b); done = true; }
      return out.result();
    },
  };
}

module.exports = { createGifWriter, quantize, lzw };
