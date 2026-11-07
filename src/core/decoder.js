'use strict';
// Finds the user's own ffmpeg (or macOS afconvert) and turns a file's sound into FLAC.
// Nothing is bundled. Helpers run with spawn() and an argument list, never through a shell.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const AFCONVERT = '/usr/bin/afconvert';

function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

/** Search PATH (and the usual Homebrew/MacPorts folders) for an executable. */
function which(name, env = process.env, platform = process.platform) {
  const exts = platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase()) : [''];
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  if (platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin');
  if (platform === 'linux') dirs.push('/usr/bin', '/usr/local/bin', '/snap/bin');
  for (const d of dirs) {
    for (const e of exts) {
      const p = path.join(d, name + (e && !name.toLowerCase().endsWith(e) ? e : ''));
      if (isFile(p)) return p;
    }
  }
  return null;
}

/**
 * Pick the helper. setting = videoPreview.ffmpegPath ('' = search PATH).
 * Returns {tool:'ffmpeg'|'afconvert', path} or null.
 */
function findHelper({ setting = '', preferred = 'auto', env = process.env, platform = process.platform, needFfmpeg = false } = {}) {
  if (preferred === 'off') return null;
  const ff = setting ? (isFile(setting) ? setting : null) : which('ffmpeg', env, platform);
  if (preferred !== 'afconvert' && ff) return { tool: 'ffmpeg', path: ff };
  if (!needFfmpeg && platform === 'darwin' && preferred !== 'ffmpeg' && isFile(AFCONVERT)) return { tool: 'afconvert', path: AFCONVERT };
  if (preferred === 'afconvert' && ff) return { tool: 'ffmpeg', path: ff };
  return null;
}

/** ffmpeg reads `file:` so a name like `concat:a|b` or `-x.mp4` is never read as a protocol or an option. */
function ffmpegInput(p) { return 'file:' + path.resolve(p); }

/** Video encoder arguments for mode 'transcode'. libx264 by default; hardware encoders when ffmpeg was built without it. */
function encoderArgs(encoder = 'libx264') {
  if (encoder === 'h264_videotoolbox') return ['-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-b:v', '8M'];
  if (encoder === 'h264_mf') return ['-c:v', 'h264_mf', '-b:v', '8M'];
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];
}

/** The encoder to try after `failed` when ffmpeg says it has no such encoder, or null (no second try). */
function fallbackEncoder(errorText, failed = 'libx264', platform = process.platform) {
  if (failed !== 'libx264') return null;
  const t = String(errorText || '');
  if (!/Unknown encoder|Encoder not found|Error selecting an encoder/i.test(t)) return null;
  if (platform === 'darwin') return 'h264_videotoolbox';
  if (platform === 'win32') return 'h264_mf';
  return null;
}

function buildArgs(tool, input, output, mode, opts = {}) {
  if (tool === 'afconvert') return ['-f', 'flac', '-d', 'flac', path.resolve(input), path.resolve(output)];
  // 'info' for transcode so the input duration is printed (progress for files without MP4 metadata, like AVI).
  const head = ['-nostdin', '-hide_banner', '-loglevel', mode === 'transcode' ? 'info' : 'error', '-y', '-i', ffmpegInput(input)];
  const tail = ['-progress', 'pipe:1', '-nostats'];
  if (mode === 'transcode') {
    return [...head, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', ...encoderArgs(opts.encoder), '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:a', 'flac', '-strict', '-2', '-movflags', '+faststart', '-f', 'mp4', ...tail, ffmpegInput(output)];
  }
  if (mode === 'remux') {
    return [...head, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-c:v', 'copy', '-c:a', 'flac', '-strict', '-2', '-movflags', '+faststart', '-f', 'mp4', ...tail, ffmpegInput(output)];
  }
  return [...head, '-map', '0:a:0', '-vn', '-sn', '-dn', '-c:a', 'flac', '-f', 'flac', ...tail, ffmpegInput(output)];
}

/** Input duration from ffmpeg's log ("Duration: 00:01:02.50"), or 0. */
function parseDuration(text) {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(String(text || ''));
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

/** Parse ffmpeg -progress output. Returns seconds done, or null. */
function parseProgress(text) {
  let last = null;
  const re = /out_time_(?:us|ms)=(\d+)/g;
  let m;
  while ((m = re.exec(text))) last = Number(m[1]) / 1e6;
  return last;
}

function cacheKey(file, stat, tool, mode) {
  return crypto.createHash('sha1').update([path.resolve(file), stat.size, Math.round(stat.mtimeMs), tool, mode, 'v1'].join('|')).digest('hex').slice(0, 24);
}

/**
 * Run a helper. Resolves {ok, output, ms} or {ok:false, error}. `onProgress(fraction|null)`.
 * Returns {promise, cancel}.
 */
function run(opts) {
  if (opts.mode !== 'transcode' || opts.helper.tool !== 'ffmpeg') return runOnce(opts);
  // Transcode: libx264 first; if this ffmpeg has no libx264, one more try with the platform's hardware encoder.
  let current = runOnce({ ...opts, encoder: 'libx264' });
  let cancelled = false;
  const promise = current.promise.then((r) => {
    const next = !r.ok && !cancelled && fallbackEncoder(r.error + '\n' + (r.log || ''), 'libx264', opts.platform || process.platform);
    if (!next) return { ...r, encoder: r.ok ? 'libx264' : undefined };
    current = runOnce({ ...opts, encoder: next });
    return current.promise.then((r2) => ({ ...r2, encoder: r2.ok ? next : undefined, firstError: r.error }));
  });
  return { promise, cancel: () => { cancelled = true; current.cancel(); } };
}

function runOnce({ helper, input, output, mode, duration, timeoutMs = 600000, onProgress = () => {}, encoder }) {
  const tmp = output + '.part' + process.pid + '-' + crypto.randomBytes(4).toString('hex') + path.extname(output);
  const args = buildArgs(helper.tool, input, tmp, mode, { encoder });
  const t0 = Date.now();
  let child; let killed = false; let timer;
  const promise = new Promise((resolve) => {
    try {
      child = spawn(helper.path, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { resolve({ ok: false, error: String(e && e.message || e) }); return; }
    let err = ''; let total = duration || 0;
    child.stdout.on('data', (d) => { const s = parseProgress(d.toString()); if (s != null && total > 0) onProgress(Math.min(1, s / total)); });
    // Keep the first part (input info) and the last part (the error) of the log.
    child.stderr.on('data', (d) => {
      err += d.toString();
      if (!total) total = parseDuration(err);
      if (err.length > 8000) err = err.slice(0, 2000) + '\n' + err.slice(-4000);
    });
    timer = setTimeout(() => { killed = 'timeout'; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: String(e.message || e) }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && !killed && isFile(tmp)) {
        try { fs.renameSync(tmp, output); } catch (e) { resolve({ ok: false, error: String(e.message) }); return; }
        resolve({ ok: true, output, ms: Date.now() - t0 });
        return;
      }
      try { fs.unlinkSync(tmp); } catch { /* not there */ }
      const lines = err.trim().split('\n').filter((l) => !/^\s*(Conversion failed!|Exiting normally|\[out#)/.test(l));
      resolve({ ok: false, log: err.slice(-4000), error: killed === 'timeout' ? 'The helper took longer than ' + Math.round(timeoutMs / 1000) + ' s and was stopped.' : killed ? 'Stopped.' : (lines.slice(-3).join(' ') || 'Exit code ' + code) });
    });
  });
  return { promise, cancel: () => { if (child && child.exitCode === null) { killed = killed || 'cancel'; child.kill('SIGKILL'); } } };
}

/** Delete the oldest cache files until the folder is under maxBytes. Returns the removed paths. */
function pruneCache(dir, maxBytes, keep = new Set()) {
  let files;
  try { files = fs.readdirSync(dir).map((n) => path.join(dir, n)).filter(isFile).map((p) => ({ p, s: fs.statSync(p) })); } catch { return []; }
  files.sort((a, b) => a.s.atimeMs - b.s.atimeMs);
  let total = files.reduce((n, f) => n + f.s.size, 0);
  const removed = [];
  for (const f of files) {
    if (total <= maxBytes) break;
    if (keep.has(f.p)) continue;
    try { fs.unlinkSync(f.p); total -= f.s.size; removed.push(f.p); } catch { /* in use */ }
  }
  return removed;
}

module.exports = { which, findHelper, buildArgs, encoderArgs, fallbackEncoder, parseProgress, parseDuration, cacheKey, run, pruneCache, ffmpegInput, AFCONVERT };
