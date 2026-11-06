'use strict';
// Container metadata through mp4box.js, read in chunks so big files never load whole.
const MP4Box = require('mp4box');

const MP4_EXT = new Set(['.mp4', '.m4v', '.mov', '.3gp', '.3g2']);
const REMUX_EXT = new Set(['.mkv', '.webm']);

/** Audio codecs that VS Code's own Chromium can play inside MP4 (tested on VS Code 1.142, Electron 43). */
function nativeAudio(codec) {
  const c = String(codec || '').toLowerCase();
  return c === 'mp4a.6b' || c === 'mp4a.69' || c === '.mp3' || c === 'mp3' || c === 'flac';
}

/** Video codecs that played in the same test: H.264, HEVC (macOS hardware), VP9 in MP4. AV1 depends on the GPU. */
function nativeVideo(codec) {
  const c = String(codec || '').toLowerCase();
  return /^(avc[13]|hvc1|hev1|vp09|av01)/.test(c);
}

/**
 * Read MP4/MOV metadata. `read(position, length)` returns a Promise<Buffer>.
 * Stops after `maxBytes` so a file with a broken index cannot keep us reading.
 */
async function probeMp4(read, size, opts = {}) {
  const chunk = opts.chunk || 1024 * 1024;
  const maxBytes = opts.maxBytes || 64 * 1024 * 1024;
  const file = MP4Box.createFile();
  let info = null; let error = null;
  file.onReady = (i) => { info = i; };
  file.onError = (e) => { error = String(e); };
  let pos = 0; let total = 0;
  while (!info && !error && pos < size && total < maxBytes) {
    const len = Math.min(chunk, size - pos);
    const buf = await read(pos, len);
    if (!buf || buf.length === 0) break;
    total += buf.length;
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    const next = file.appendBuffer(MP4Box.MP4BoxBuffer.fromArrayBuffer(ab, pos));
    pos = typeof next === 'number' && next > pos ? next : pos + buf.length;
  }
  try { file.flush(); } catch { /* ignore */ }
  if (!info) return { ok: false, error: error || (total >= maxBytes ? 'No movie header in the first ' + Math.round(maxBytes / 1048576) + ' MB' : 'No movie header found'), bytesRead: total };
  return { ok: true, bytesRead: total, ...summarize(info, size) };
}

function summarize(info, size) {
  const tracks = (info.tracks || []).map((t) => {
    const seconds = t.timescale ? t.duration / t.timescale : 0;
    const base = { id: t.id, type: t.type, codec: t.codec, language: t.language && t.language !== 'und' ? t.language : '', seconds: round(seconds, 3), bitrate: Math.round(t.bitrate || 0), samples: t.nb_samples };
    if (t.type === 'video' || t.video) {
      const fps = seconds > 0 ? t.nb_samples / seconds : 0;
      return { ...base, type: 'video', width: t.video ? t.video.width : t.track_width, height: t.video ? t.video.height : t.track_height, fps: round(fps, 3) };
    }
    if (t.type === 'audio' || t.audio) return { ...base, type: 'audio', sampleRate: t.audio ? t.audio.sample_rate : 0, channels: t.audio ? t.audio.channel_count : 0 };
    return base;
  });
  const duration = info.timescale ? info.duration / info.timescale : Math.max(0, ...tracks.map((t) => t.seconds));
  return { container: (info.brands || [])[0] || 'mp4', brands: [...new Set(info.brands || [])], duration: round(duration, 3), size, fragmented: !!info.isFragmented, tracks };
}

function round(n, d) { const f = 10 ** d; return Math.round(n * f) / f; }

/**
 * Decide how to play a file.
 * mode: 'native' (VS Code plays video and sound), 'decode-audio' (video plays, sound needs a helper),
 * 'remux' (container VS Code cannot open: needs ffmpeg), 'video-only' (no audio track), 'unsupported'.
 */
function plan(ext, meta) {
  ext = String(ext || '').toLowerCase();
  if (REMUX_EXT.has(ext)) return { mode: 'remux', reason: 'VS Code cannot open ' + ext + ' files by itself. ffmpeg copies the video into MP4 and turns the sound into FLAC.' };
  if (!meta || !meta.ok) return { mode: 'decode-audio', reason: 'Metadata unreadable; trying the helper for sound.', unknown: true };
  const v = meta.tracks.find((t) => t.type === 'video');
  const a = meta.tracks.find((t) => t.type === 'audio');
  if (v && !nativeVideo(v.codec)) return { mode: 'unsupported', reason: 'VS Code has no decoder for the ' + v.codec + ' video codec.' };
  if (!a) return { mode: 'video-only', reason: 'This file has no audio track.' };
  if (nativeAudio(a.codec)) return { mode: 'native', reason: a.codec + ' sound plays in VS Code directly.' };
  return { mode: 'decode-audio', reason: 'VS Code ships without an ' + codecName(a.codec) + ' decoder, so the sound is decoded to FLAC by a helper.', audioCodec: a.codec };
}

const { codecName } = require('./media-names');

module.exports = { probeMp4, summarize, plan, nativeAudio, nativeVideo, codecName, MP4_EXT, REMUX_EXT };
