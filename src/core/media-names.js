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
  // ffmpeg's own codec names (from its log, for MKV and WebM input).
  const ff = { mpeg4: 'MPEG-4 Part 2', vp8: 'VP8', mpeg2video: 'MPEG-2', mpeg1video: 'MPEG-1', theora: 'Theora', vc1: 'VC-1', wmv3: 'Windows Media Video 9',
    msmpeg4v3: 'MS MPEG-4 v3', h264: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1', prores: 'Apple ProRes', mjpeg: 'Motion JPEG' }[c];
  if (ff) return ff;
  const fourcc = { apcn: 'Apple ProRes 422', apch: 'Apple ProRes 422 HQ', apcs: 'Apple ProRes 422 LT', apco: 'Apple ProRes 422 Proxy',
    ap4h: 'Apple ProRes 4444', ap4x: 'Apple ProRes 4444 XQ', aprh: 'Apple ProRes RAW HQ', aprn: 'Apple ProRes RAW', mjpa: 'Motion JPEG', mjpb: 'Motion JPEG',
    jpeg: 'Motion JPEG', h263: 'H.263', s263: 'H.263', svq1: 'Sorenson Video', svq3: 'Sorenson Video 3', cvid: 'Cinepak', vp08: 'VP8',
    dvh1: 'Dolby Vision', dvhe: 'Dolby Vision', dva1: 'Dolby Vision', dvav: 'Dolby Vision', r210: 'uncompressed RGB', v210: 'uncompressed 10-bit YUV',
    '2vuy': 'uncompressed YUV', yuv2: 'uncompressed YUV', avdn: 'Avid DNxHD', avdh: 'Avid DNxHR' }[c.slice(0, 4)];
  if (fourcc) return fourcc;
  if (/^mp4v\.20\b/.test(c) || c === 'mp4v') return 'MPEG-4 Part 2';
  if (/^mp4v\.6[0-5]\b/.test(c)) return 'MPEG-2';
  if (/^mp4v\.6a\b/.test(c)) return 'MPEG-1';
  if (/^dv(c |cp|5n|5p|h)/.test(c)) return 'DV';
  return c || 'unknown';
}
module.exports = { codecName };
