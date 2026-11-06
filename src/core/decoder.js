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

function buildArgs(tool, input, output, mode) {
  if (tool === 'afconvert') return ['-f', 'flac', '-d', 'flac', path.resolve(input), path.resolve(output)];
  const head = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', ffmpegInput(input)];
  const tail = ['-progress', 'pipe:1', '-nostats'];
  if (mode === 'remux') {
    return [...head, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-c:v', 'copy', '-c:a', 'flac', '-strict', '-2', '-movflags', '+faststart', '-f', 'mp4', ...tail, ffmpegInput(output)];
  }
  return [...head, '-map', '0:a:0', '-vn', '-sn', '-dn', '-c:a', 'flac', '-f', 'flac', ...tail, ffmpegInput(output)];
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
function run({ helper, input, output, mode, duration, timeoutMs = 600000, onProgress = () => {} }) {
  const tmp = output + '.part' + process.pid + '-' + crypto.randomBytes(4).toString('hex') + path.extname(output);
  const args = buildArgs(helper.tool, input, tmp, mode);
  const t0 = Date.now();
  let child; let killed = false; let timer;
  const promise = new Promise((resolve) => {
    try {
      child = spawn(helper.path, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { resolve({ ok: false, error: String(e && e.message || e) }); return; }
    let err = '';
    child.stdout.on('data', (d) => { const s = parseProgress(d.toString()); if (s != null && duration > 0) onProgress(Math.min(1, s / duration)); });
    child.stderr.on('data', (d) => { if (err.length < 4000) err += d.toString(); });
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
      resolve({ ok: false, error: killed === 'timeout' ? 'The helper took longer than ' + Math.round(timeoutMs / 1000) + ' s and was stopped.' : killed ? 'Stopped.' : (err.trim().split('\n').slice(-3).join(' ') || 'Exit code ' + code) });
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

module.exports = { which, findHelper, buildArgs, parseProgress, cacheKey, run, pruneCache, ffmpegInput, AFCONVERT };
