'use strict';
// Zovo Pro (lane PRO4): presets and frame math for Clip export, Frame export and the Contact sheet.
// No node or vscode modules here: the webview bundle and the extension host both use it.

const MAX_GIF_SECONDS = 60;
const MAX_FRAMES = 1000;

/** GIF presets for the quick pick. width 0 = the video's own width, at most 960. */
const GIF_PRESETS = [
  { id: 'gif480', label: 'GIF, 480 px wide, 10 fps', detail: 'Small, for a pull request, an issue or a chat', width: 480, fps: 10 },
  { id: 'gif640', label: 'GIF, 640 px wide, 15 fps', detail: 'Smoother, for a README or docs', width: 640, fps: 15 },
  { id: 'gif960', label: 'GIF, up to 960 px wide, 15 fps', detail: 'The video size up to 960 px, a large file', width: 960, fps: 15 },
];
const MP4_PRESETS = [
  { id: 'mp4', label: 'MP4, exact cut', detail: 'H.264 video and AAC sound, cut at the A and B frames. Needs ffmpeg.', mode: 'exact' },
  { id: 'copy', label: 'MP4, fast copy', detail: 'No re-encoding, so it is quick and keeps the quality, but it starts at the keyframe before A. Needs ffmpeg.', mode: 'copy' },
];
const FRAME_MODES = [
  { id: 'all', label: 'Every frame', detail: 'Each frame between A and B (or the whole video) as a PNG' },
  { id: 'n5', label: 'Every 5th frame', n: 5 },
  { id: 'n10', label: 'Every 10th frame', n: 10 },
  { id: 'sec', label: 'One frame per second' },
  { id: 'even10', label: '10 frames, evenly spaced', count: 10 },
];
const SHEET_PRESETS = [
  { id: '4x4', label: 'Contact sheet, 4 × 4 frames', cols: 4, rows: 4 },
  { id: '5x6', label: 'Contact sheet, 5 × 6 frames', cols: 5, rows: 6 },
  { id: '6x8', label: 'Contact sheet, 6 × 8 frames', cols: 6, rows: 8 },
];

/** The range a tool works on: A to B when both are set, else the whole video. */
function range(a, b, duration) {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (Number.isFinite(a) && Number.isFinite(b) && b > a) return { start: Math.max(0, a), end: d ? Math.min(b, d) : b, ab: true };
  return { start: 0, end: d, ab: false };
}

/** GIF size: at most maxWidth wide (and the video's own width), even numbers, aspect kept. */
function gifSize(w, h, maxWidth) {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const width = Math.max(2, Math.min(w, maxWidth || w) & ~1);
  const height = Math.max(2, Math.round((h * width) / w / 2) * 2);
  return { width, height };
}

// A grab time sits a quarter into its frame: the seek lands inside frame k, and the player's frame counter
// (round(t × fps), sync.js) reads k there too.
const AT = 0.25;

/**
 * Times of the frames to grab, one per frame k at (k + AT) / fps.
 * mode: one of FRAME_MODES ids. Returns { times: [{ t, frame }], capped }.
 */
function frameTimes(mode, { start, end, fps, max = MAX_FRAMES }) {
  const f = fps > 0 ? fps : 30;
  const first = Math.max(0, Math.ceil(start * f - 1e-6)), last = Math.max(first, Math.floor(end * f - 1e-6));
  const at = (k) => ({ t: (k + AT) / f, frame: k });
  let list = [];
  const m = FRAME_MODES.find((x) => x.id === mode) || FRAME_MODES[0];
  if (m.id === 'sec') {
    for (let s = start; s < end - 1e-9 && list.length <= max; s += 1) list.push(at(Math.floor(s * f + 1e-6)));
  } else if (m.count) {
    const n = Math.min(m.count, last - first + 1);
    for (let i = 0; i < n; i++) list.push(at(first + Math.floor(((i + 0.5) * (last - first + 1)) / n)));
  } else {
    const step = m.n || 1;
    for (let k = first; k <= last && list.length <= max; k += step) list.push(at(k));
  }
  const capped = list.length > max;
  if (capped) list = list.slice(0, max);
  return { times: list, capped };
}

/** Evenly spaced times for a contact sheet of n cells, snapped to their frames when fps is known. */
function sheetTimes(n, start, end, fps) {
  const span = Math.max(0, end - start);
  return Array.from({ length: n }, (_, i) => {
    const t = start + ((i + 0.5) * span) / n;
    return fps > 0 ? (Math.floor(t * fps) + AT) / fps : t;
  });
}

/** GIF frame times from start to end at fps (frame centres), at most MAX_GIF_SECONDS long. */
function gifTimes(start, end, fps) {
  const stop = Math.min(end, start + MAX_GIF_SECONDS);
  const out = [];
  for (let i = 0; start + (i + 0.5) / fps < stop; i++) out.push(start + (i + 0.5) / fps);
  return out;
}

module.exports = { range, gifSize, frameTimes, sheetTimes, gifTimes, GIF_PRESETS, MP4_PRESETS, FRAME_MODES, SHEET_PRESETS, MAX_GIF_SECONDS, MAX_FRAMES };
