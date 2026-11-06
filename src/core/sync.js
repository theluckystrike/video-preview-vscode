'use strict';
// Keeps a separate <audio> element in step with a muted <video>.
// Small drift is fixed by nudging the audio rate; big drift by a seek.

const HARD = 0.25; // seconds: seek
const SOFT = 0.04; // seconds: nudge

function syncAction(videoTime, audioTime, rate) {
  const d = audioTime - videoTime;
  if (!Number.isFinite(d)) return { rate };
  if (Math.abs(d) > HARD) return { seek: videoTime, rate };
  if (Math.abs(d) > SOFT) return { rate: rate * (d > 0 ? 0.96 : 1.04) };
  return { rate };
}

/** Where the A-B loop sends the playhead, or null to keep going. */
function loopTarget(t, a, b) {
  if (a == null || b == null || !(b > a)) return null;
  if (t >= b || t < a - 0.5) return a;
  return null;
}

/** Time of the next or previous frame. Snaps to the frame grid so repeated steps do not drift. */
function stepFrame(t, fps, dir, duration) {
  const f = fps > 0 ? fps : 30;
  const idx = Math.round(t * f) + (dir < 0 ? -1 : 1);
  const n = Math.max(0, idx) / f;
  return duration > 0 ? Math.min(n, Math.max(0, duration - 1 / f)) : n;
}

function frameNumber(t, fps) { return Math.round(t * (fps > 0 ? fps : 30)); }

function formatTime(s, withMs) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 1000);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0') + (withMs ? '.' + String(ms).padStart(3, '0') : '');
}

function formatBytes(n) {
  if (!(n >= 0)) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 2 : 1) : n) + ' ' + u[i];
}

/** PNG file name for a frame grab: clip-00m12s345-f370.png */
function shotName(base, t, fps) {
  const stem = String(base || 'frame').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'frame';
  const m = Math.floor(t / 60); const s = Math.floor(t % 60); const ms = Math.floor((t % 1) * 1000);
  return `${stem}-${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s${String(ms).padStart(3, '0')}-f${frameNumber(t, fps)}.png`;
}

const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
function nextSpeed(cur, dir) {
  let i = SPEEDS.findIndex((s) => s >= cur - 1e-9);
  if (i < 0) i = SPEEDS.length - 1;
  if (SPEEDS[i] !== cur && dir < 0) return SPEEDS[Math.max(0, i - 1)];
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + dir))];
}

module.exports = { syncAction, loopTarget, stepFrame, frameNumber, formatTime, formatBytes, shotName, nextSpeed, SPEEDS, HARD, SOFT };
