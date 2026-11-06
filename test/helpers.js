'use strict';
const fs = require('fs');
const path = require('path');
const FIX = path.join(__dirname, 'fixtures');
const fx = (n) => path.join(FIX, n);
function reader(file) {
  const fd = fs.openSync(file, 'r');
  const calls = [];
  const read = async (pos, len) => { calls.push([pos, len]); const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, pos); return b.subarray(0, n); };
  return { read, size: fs.fstatSync(fd).size, calls, close: () => fs.closeSync(fd) };
}
function hasFfmpeg() { return !!require('../src/core/decoder').which('ffmpeg'); }
module.exports = { FIX, fx, reader, hasFfmpeg };
