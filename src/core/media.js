'use strict';
// Container metadata through mp4box.js, read in chunks so big files never load whole.
const MP4Box = require('mp4box');

const MP4_EXT = new Set(['.mp4', '.m4v', '.mov', '.3gp', '.3g2']);
const REMUX_EXT = new Set(['.mkv', '.webm']);
// Containers VS Code never opens: ffmpeg converts them to H.264 MP4. Never .ts or .mts: those are TypeScript.
const TRANSCODE_EXT = new Set(['.avi', '.mpg', '.mpeg', '.wmv', '.flv', '.ogv', '.m2ts']);
// Sample entries that are video even when mp4box does not know them (it reports ProRes as 'metadata').
// Sample entries that are sound when mp4box reports them as 'metadata' (QuickTime PCM, ALAC and others).
const AUDIO_4CC = /^(sowt|twos|lpcm|raw |in24|in32|fl32|fl64|ulaw|alaw|ima4|alac|ac-3|ec-3|ac-4|opus|flac|fla1|dtsc|dtsh|dtsl|dtse|samr|sawb|mp4a|\.mp3|ipcm|fpcm)/i;
const VIDEO_4CC = /^(avc[1-4]|hvc1|hev1|dvh[1e]|dva[1v]|vp0[89]|av01|apc[nhso]|ap4[hx]|aprh|aprn|mp4v|mjp[ab]|jpeg|h263|s263|svq[13]|cvid|dv(c |cp|5n|5p|h[1-6p])|r210|v210|2vuy|yuv2|avdn|avdh|ai[5p]|xd5|xdv)/i;

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
  const out = { ok: true, bytesRead: total, ...summarize(info, size) };
  addEdits(out, file, info.timescale);
  return out;
}

/**
 * Edit lists (elst) of each track: `startSkip` = seconds of media cut at the start (the AAC encoder delay, 1024
 * samples), `startPad` = seconds of empty edit before the track starts. The built-in sound decoder uses them so
 * the sound lands where ffmpeg would put it.
 */
function addEdits(out, file, movieTimescale) {
  try {
    for (const trak of (file.moov && file.moov.traks) || []) {
      const t = out.tracks.find((x) => x.id === trak.tkhd.track_id);
      const entries = trak.edts && trak.edts.elst && trak.edts.elst.entries;
      if (!t || !entries || !entries.length) continue;
      const e = editOffsets(entries, movieTimescale, trak.mdia && trak.mdia.mdhd ? trak.mdia.mdhd.timescale : 0);
      if (e.startSkip) t.startSkip = e.startSkip;
      if (e.startPad) t.startPad = e.startPad;
    }
  } catch { /* odd box tree: no edits */ }
}

function editOffsets(entries, movieTimescale, mediaTimescale) {
  let startPad = 0; let startSkip = 0;
  for (const e of entries) {
    const mt = Number(e.media_time);
    if (mt === -1 || mt === 0xffffffff) { if (movieTimescale > 0) startPad += Number(e.segment_duration) / movieTimescale; continue; }
    if (mediaTimescale > 0 && mt > 0) startSkip = mt / mediaTimescale;
    break;
  }
  return { startSkip: round(startSkip, 6), startPad: round(startPad, 6) };
}

function summarize(info, size) {
  const tracks = (info.tracks || []).map((t) => {
    const seconds = t.timescale ? t.duration / t.timescale : 0;
    const base = { id: t.id, type: t.type, codec: t.codec, language: t.language && t.language !== 'und' ? t.language : '', seconds: round(seconds, 3), bitrate: Math.round(t.bitrate || 0), samples: t.nb_samples };
    if (t.type === 'video' || t.video || VIDEO_4CC.test(String(t.codec || ''))) {
      const fps = seconds > 0 ? t.nb_samples / seconds : 0;
      return { ...base, type: 'video', width: t.video ? t.video.width : Math.round(t.track_width || 0), height: t.video ? t.video.height : Math.round(t.track_height || 0), fps: round(fps, 3) };
    }
    if (t.type === 'audio' || t.audio || AUDIO_4CC.test(String(t.codec || ''))) return { ...base, type: 'audio', sampleRate: t.audio ? t.audio.sample_rate : 0, channels: t.audio ? t.audio.channel_count : 0 };
    return base;
  });
  const duration = info.timescale ? info.duration / info.timescale : Math.max(0, ...tracks.map((t) => t.seconds));
  return { container: (info.brands || [])[0] || 'mp4', brands: [...new Set(info.brands || [])], duration: round(duration, 3), size, fragmented: !!info.isFragmented, tracks };
}

function round(n, d) { const f = 10 ** d; return Math.round(n * f) / f; }

/**
 * Decide how to play a file.
 * mode: 'native' (VS Code plays video and sound), 'decode-audio' (video plays, sound needs a helper),
 * 'remux' (container VS Code cannot open: needs ffmpeg), 'transcode' (video codec or container VS Code
 * cannot decode: ffmpeg converts the video to H.264), 'video-only' (no audio track), 'unsupported'.
 */
function plan(ext, meta) {
  ext = String(ext || '').toLowerCase();
  if (REMUX_EXT.has(ext)) return { mode: 'remux', reason: 'VS Code cannot open ' + ext + ' files by itself. ffmpeg copies the video into MP4 and turns the sound into FLAC.' };
  if (TRANSCODE_EXT.has(ext)) return { mode: 'transcode', reason: 'VS Code cannot open ' + ext + ' files by itself, so ffmpeg converts the video to H.264 for playback.', what: ext + ' files' };
  if (!meta || !meta.ok) return { mode: 'decode-audio', reason: 'Metadata unreadable; trying the helper for sound.', unknown: true };
  const v = meta.tracks.find((t) => t.type === 'video');
  const a = meta.tracks.find((t) => t.type === 'audio');
  if (v && !nativeVideo(v.codec)) return transcodePlan(v.codec);
  if (!a) return { mode: 'video-only', reason: 'This file has no audio track.' };
  if (nativeAudio(a.codec)) return { mode: 'native', reason: a.codec + ' sound plays in VS Code directly.' };
  return { mode: 'decode-audio', reason: 'VS Code ships without an ' + codecName(a.codec) + ' decoder, so the sound is decoded to FLAC by a helper.', audioCodec: a.codec };
}

/** Plan for a video codec VS Code has no decoder for. `runtime` = the player tried and failed. */
function transcodePlan(codec, runtime = false) {
  const name = codecName(codec);
  const reason = runtime
    ? 'VS Code could not decode the ' + name + ' video on this computer, so ffmpeg converts it to H.264 for playback.'
    : 'VS Code has no decoder for ' + name + ' video, so ffmpeg converts it to H.264 for playback.';
  return { mode: 'transcode', reason, videoCodec: codec || '', what: name, runtime };
}

/** Plan after the player failed to show the video. null = no second try (already converted, or no video). */
function fallbackPlan(current, meta) {
  if (!current || current.mode === 'transcode' || current.mode === 'unsupported') return null;
  const v = meta && meta.ok ? meta.tracks.find((t) => t.type === 'video') : null;
  return transcodePlan(v ? v.codec : '', true);
}

const { codecName } = require('./media-names');

/** ffmpeg errors that mean the input is not media at all (not a codec problem). */
function isNotMediaError(text) {
  return /Invalid data found when processing input|moov atom not found|could not find codec parameters|Error opening input/i.test(String(text || ''));
}

/** The message for a file that is empty or holds no video, in place of the raw ffmpeg output. */
function notVideoText(size, tool) {
  if (size === 0) return 'This file is empty (0 bytes), so there is no video to play.';
  return 'This file does not look like a video. VS Code cannot play it' + (tool ? ' and ' + tool + ' cannot read it' : '') + '. It may be damaged, still downloading, or another kind of file with a video extension.';
}

module.exports = { AUDIO_4CC, editOffsets, isNotMediaError, notVideoText, probeMp4, summarize, plan, transcodePlan, fallbackPlan, nativeAudio, nativeVideo, codecName, MP4_EXT, REMUX_EXT, TRANSCODE_EXT, VIDEO_4CC };
