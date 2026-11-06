'use strict';
// Codec names, kept apart from media.js so the webview bundle does not pull in mp4box.
function codecName(c) {
  c = String(c || '').toLowerCase();
  if (c.startsWith('mp4a.40')) return 'AAC';
  if (c === 'mp4a.6b' || c === 'mp4a.69' || c === '.mp3') return 'MP3';
  if (c === 'ac-3') return 'AC-3';
  if (c === 'ec-3') return 'E-AC-3';
  if (c === 'opus') return 'Opus';
  if (c === 'flac') return 'FLAC';
  if (c === 'alac') return 'ALAC';
  if (c.startsWith('avc')) return 'H.264';
  if (c.startsWith('hvc') || c.startsWith('hev')) return 'HEVC';
  if (c.startsWith('vp09')) return 'VP9';
  if (c.startsWith('av01')) return 'AV1';
  return c || 'unknown';
}
module.exports = { codecName };
