'use strict';
// The built-in sound decoder: Symphonia compiled to WebAssembly, shipped in the extension, run in a worker
// thread. Needs no ffmpeg, starts no program and makes no network request.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Codecs the built-in decoder handles: AAC-LC (HE-AAC plays its AAC-LC core), ALAC, MP3, PCM and ADPCM.
// mp4box names: mp4a.40.x (AAC), mp4a.67/.66/.68 (MPEG-2 AAC), alac, .mp3/mp4a.6b/mp4a.69, lpcm/sowt/twos/in24/fl32, ima4.
function supports(codec) {
  const c = String(codec || '').toLowerCase();
  if (!c) return true; // unknown (MKV or unreadable metadata): let the decoder try
  return /^mp4a\.40(\.\d+)?$/.test(c) || /^mp4a\.6[6-9b]$/.test(c) || c === 'mp4a' || c === 'alac' || c === '.mp3' || c === 'mp3'
    || /^(lpcm|sowt|twos|raw |in24|in32|fl32|fl64|ulaw|alaw|ima4|ipcm|fpcm)$/.test(c);
}

/**
 * Seconds to drop and to pad at the start, from the probed MP4 audio track (edit list). null skip = let the
 * decoder use what the container states. The decoder turns them into frames at the decoded sample rate.
 */
function startFrames(meta) {
  const a = meta && meta.ok ? meta.tracks.find((t) => t.type === 'audio') : null;
  if (!a) return { skip: null, pad: 0 };
  return { skip: a.startSkip || 0, pad: a.startPad || 0 };
}

/** Why a codec is out (shown with "Install ffmpeg"), e.g. AC-3, E-AC-3, DTS, Opus in MP4. */
function unsupportedReason(codec) { return supports(codec) ? null : 'The built-in decoder cannot read this sound format.'; }

function hintFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (['.mkv', '.webm', '.mka'].includes(ext)) return 2;
  if (['.mp4', '.m4v', '.mov', '.m4a', '.3gp', '.3g2'].includes(ext)) return 1;
  return 0;
}

const STATUS = { '-1': 'The built-in decoder cannot read this container.', '-2': 'The file has no sound track the built-in decoder can find.',
  '-3': 'The built-in decoder reads mono and stereo AAC, ALAC, MP3 and PCM. This sound is in another format or has more than 2 channels.', '-4': 'The built-in decoder found no sound it could decode.' };

/**
 * Decode `input`'s first audio track to a WAV at `output`. Same result shape as decoder.run():
 * {promise -> {ok, output, ms, codec, rate, channels} | {ok:false, error, status}, cancel}.
 */
function run({ input, output, wasmPath, workerPath, skip = null, pad = 0, duration = 0, timeoutMs = 900000, onProgress = () => {} }) {
  const { Worker } = require('worker_threads');
  const tmp = output + '.part' + process.pid + '-' + crypto.randomBytes(4).toString('hex') + '.wav';
  const t0 = Date.now();
  let worker = null; let finished = false; let timer; let resolveFn;
  const promise = new Promise((resolve) => {
    resolveFn = resolve;
    const end = (r) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (!r.ok) { try { fs.unlinkSync(tmp); } catch { /* not there */ } }
      resolve(r);
    };
    resolveFn = end;
    try {
      worker = new Worker(workerPath, { workerData: { wasmPath, input: path.resolve(input), output: tmp, hint: hintFor(input), skip: skip == null ? -1 : skip, pad }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    } catch (e) { end({ ok: false, error: String(e && e.message || e) }); return; }
    let info = null;
    worker.on('message', (m) => {
      if (m.type === 'info') info = m.info;
      else if (m.type === 'progress') { if (duration > 0) onProgress(Math.min(1, m.seconds / duration)); }
      else if (m.type === 'done') {
        if (m.status === 0) {
          try { fs.renameSync(tmp, output); } catch (e) { end({ ok: false, error: String(e.message) }); return; }
          end({ ok: true, output, ms: Date.now() - t0, codec: info && info.codec, rate: info && info.rate, channels: info && info.channels, srcChannels: info && info.srcChannels, start: info && info.start, bytes: m.bytes });
        } else end({ ok: false, status: m.status, error: STATUS[String(m.status)] || ('The built-in decoder stopped: ' + (m.error || m.status)) });
      }
    });
    worker.on('error', (e) => end({ ok: false, error: 'The built-in decoder stopped: ' + String(e && e.message || e) }));
    worker.on('exit', (code) => end({ ok: false, error: code ? 'The built-in decoder stopped (exit ' + code + ').' : 'The built-in decoder ended without a result.' }));
    timer = setTimeout(() => { if (!finished) { worker.terminate(); end({ ok: false, error: 'The built-in decoder took longer than ' + Math.round(timeoutMs / 1000) + ' s and was stopped.' }); } }, timeoutMs);
  });
  return { promise, cancel: () => { if (!finished && worker) { worker.terminate(); resolveFn({ ok: false, error: 'Stopped.' }); } } };
}

module.exports = { run, startFrames, supports, unsupportedReason, hintFor, STATUS };
