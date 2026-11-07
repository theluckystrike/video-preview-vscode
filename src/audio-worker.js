'use strict';
// Worker thread: runs the bundled WASM sound decoder (Symphonia) on one file and writes a 16-bit WAV.
// The file is read in small pieces through host_read, so a big video never loads whole.
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const { wavHeader } = require('./core/wav');

const { wasmPath, input, output, hint, skip = 0, pad = 0 } = workerData;
let mem = null;
const view = (ptr, len) => new Uint8Array(mem.buffer, ptr, len);
let inFd = -1; let outFd = -1; let info = null; let dataBytes = 0;
const size = fs.fstatSync((inFd = fs.openSync(input, 'r'))).size;
outFd = fs.openSync(output, 'w');

const env = {
  host_size: () => size,
  host_read: (pos, ptr, len) => {
    try { return fs.readSync(inFd, view(ptr, len), 0, len, pos); } catch { return -1; }
  },
  host_write: (ptr, len) => { fs.writeSync(outFd, view(ptr, len)); dataBytes += len; },
  host_info: (rate, channels, srcChannels, namePtr, nameLen, start) => {
    info = { rate, channels, srcChannels, codec: Buffer.from(view(namePtr, nameLen)).toString('utf8'), start };
    fs.writeSync(outFd, wavHeader(rate, channels, 0xffffffff - 36), 0, 44, 0);
    parentPort.postMessage({ type: 'info', info });
  },
  host_progress: (seconds) => parentPort.postMessage({ type: 'progress', seconds }),
};

try {
  const mod = new WebAssembly.Module(fs.readFileSync(wasmPath));
  const inst = new WebAssembly.Instance(mod, { env });
  mem = inst.exports.memory;
  const r = inst.exports.decode(hint, skip, pad);
  if (r > 0) fs.writeSync(outFd, wavHeader(info.rate, info.channels, dataBytes), 0, 44, 0);
  fs.closeSync(outFd); fs.closeSync(inFd);
  parentPort.postMessage({ type: 'done', status: r > 0 ? 0 : r, frames: r > 0 ? r : 0, info, bytes: dataBytes });
} catch (e) {
  try { fs.closeSync(outFd); fs.closeSync(inFd); } catch { /* closed */ }
  parentPort.postMessage({ type: 'done', status: -9, error: String(e && e.message || e) });
}
