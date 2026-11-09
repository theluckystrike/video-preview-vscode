'use strict';
// Zovo Pro (lane PRO4): the ffmpeg call behind the MP4 clip export (the frame math is in proplan.js).
// ffmpeg is the user's own (same search as the sound decoder); it runs with spawn() and an argument list, never a shell.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { ffmpegInput, encoderArgs, fallbackEncoder, parseProgress } = require('./decoder');
const plan = require('./proplan');

/** ffmpeg arguments for a clip from a to b. mode 'exact' re-encodes (H.264 + AAC), 'copy' copies the streams. */
function clipArgs({ input, output, a, b, mode, encoder }) {
  const ss = Math.max(0, a).toFixed(3), t = Math.max(0.001, b - a).toFixed(3);
  const head = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-ss', ss, '-i', ffmpegInput(input), '-t', t, '-map', '0:v:0?', '-map', '0:a:0?', '-sn', '-dn'];
  const tail = ['-movflags', '+faststart', '-f', 'mp4', '-progress', 'pipe:1', '-nostats', ffmpegInput(output)];
  if (mode === 'copy') return [...head, '-c', 'copy', '-avoid_negative_ts', 'make_zero', ...tail];
  return [...head, ...encoderArgs(encoder), '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:a', 'aac', '-b:a', '192k', ...tail];
}

function runOnce(ffmpeg, args, output, { duration, timeoutMs, onProgress }) {
  const t0 = Date.now();
  let child, killed = false, timer;
  const promise = new Promise((resolve) => {
    try { child = spawn(ffmpeg, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { resolve({ ok: false, error: String((e && e.message) || e) }); return; }
    let err = '';
    child.stdout.on('data', (d) => { const s = parseProgress(d.toString()); if (s != null && duration > 0 && onProgress) onProgress(Math.min(1, s / duration)); });
    child.stderr.on('data', (d) => { err += d.toString(); if (err.length > 8000) err = err.slice(-4000); });
    timer = setTimeout(() => { killed = 'timeout'; child.kill('SIGKILL'); }, timeoutMs || 900000);
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: String(e.message || e) }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && !killed) { resolve({ ok: true, ms: Date.now() - t0 }); return; }
      const lines = err.trim().split('\n').filter((l) => !/^\s*(Conversion failed!|Exiting normally)/.test(l));
      resolve({ ok: false, log: err.slice(-4000), error: killed === 'timeout' ? `ffmpeg took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.` : killed ? 'Stopped.' : (lines.slice(-3).join(' ') || `ffmpeg exit code ${code}`) });
    });
  });
  return { promise, cancel: () => { if (child && child.exitCode === null) { killed = killed || 'cancel'; child.kill('SIGKILL'); } } };
}

/**
 * Cut a clip with ffmpeg into a temp file next to the target, then rename it. 'exact' tries libx264 first and the
 * platform's hardware encoder when this ffmpeg has no libx264. Returns { promise, cancel }; promise gives
 * { ok, ms, encoder } or { ok: false, error }.
 */
function runClip({ ffmpeg, input, output, a, b, mode, timeoutMs, onProgress, platform = process.platform }) {
  const tmp = path.join(path.dirname(output), '.' + path.basename(output) + '.part' + crypto.randomBytes(4).toString('hex') + '.mp4');
  const duration = Math.max(0.001, b - a);
  let current = null, cancelled = false;
  const attempt = (encoder) => { current = runOnce(ffmpeg, clipArgs({ input, output: tmp, a, b, mode, encoder }), tmp, { duration, timeoutMs, onProgress }); return current.promise; };
  const finish = (r, encoder) => {
    if (r.ok) {
      try { fs.renameSync(tmp, output); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* gone */ } return { ok: false, error: String(e.message || e) }; }
      return { ok: true, ms: r.ms, encoder };
    }
    try { fs.unlinkSync(tmp); } catch { /* not there */ }
    return r;
  };
  const promise = (async () => {
    if (mode === 'copy') return finish(await attempt(null), 'copy');
    const r = await attempt('libx264');
    const next = !r.ok && !cancelled && fallbackEncoder(r.error + '\n' + (r.log || ''), 'libx264', platform);
    if (!next) return finish(r, 'libx264');
    return finish(await attempt(next), next);
  })();
  return { promise, cancel: () => { cancelled = true; if (current) current.cancel(); } };
}

module.exports = { ...plan, clipArgs, runClip };
