'use strict';
/** 44-byte header of a 16-bit PCM WAV with `dataBytes` of samples (clamped to the 4 GB RIFF limit). */
function wavHeader(rate, channels, dataBytes) {
  const d = Math.min(dataBytes, 0xffffffff - 36);
  const b = Buffer.alloc(44);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + d, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * channels * 2, 28); b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(d, 40);
  return b;
}
module.exports = { wavHeader };
