'use strict';
// Video player Pro features (lane PRO4) on the shared Zovo license module (src/license, copied unchanged from
// factory/sprint/license) and the gate in src/pro-gate.js: 3 free tries per feature, no prompt on open, no network
// except what the user starts. Everything that was free in 0.2.x stays free.
const { createLicense } = require('./license');
const { createProGate } = require('./pro-gate');

const SKU = 'video-pro';
const FEATURES = {
  clip: {
    title: 'Clip export',
    detail: 'Saves the part between A and B (or the whole video) as a GIF for a pull request, an issue or docs, with no other tool, or as an MP4 cut by your ffmpeg: exact (H.264 and AAC) or a fast copy without re-encoding. Each saved clip uses one free try.',
  },
  frames: {
    title: 'Frame export',
    detail: 'Saves frames between A and B (or the whole video) as numbered full-size PNG files: every frame, every 5th or 10th, one per second, or 10 evenly spaced, up to 1,000 per export. Each file name carries the time and the frame number. Each export uses one free try.',
  },
  sheet: {
    title: 'Contact sheet',
    detail: 'Saves one PNG with 16, 30 or 48 evenly spaced frames in a grid, each labelled with its time and frame number, under a header with the file name, length, frame size and codecs. Each saved sheet uses one free try.',
  },
};
const FREE_LINE = 'Everything else in the video player stays free: playback with sound, MKV, WebM and AVI through ffmpeg, frame stepping, speed, the A-B loop, subtitles, picture-in-picture, metadata and Save frame.';

function createPro({ vscode, context, license, enabled }) {
  return createProGate({ vscode, context, license, createLicense, sku: SKU, prefix: 'videoPreview', product: 'Video Preview', features: FEATURES, freeLine: FREE_LINE, enabled });
}

module.exports = { createPro, FEATURES, SKU, FREE_LINE };
