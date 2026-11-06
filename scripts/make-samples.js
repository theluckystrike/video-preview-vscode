'use strict';
// Writes small real sample videos with ffmpeg (dev only; the extension never bundles ffmpeg).
// usage: node scripts/make-samples.js <outDir>
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const out = path.resolve(process.argv[2] || 'test/fixtures');
fs.mkdirSync(out, { recursive: true });
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const src = (secs, size = '640x360') => ['-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30`, '-f', 'lavfi', '-i', `sine=frequency=440:beep_factor=4:sample_rate=48000`, '-t', String(secs)];
const h264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-crf', '28'];
const aac = ['-c:a', 'aac', '-b:a', '96k', '-ac', '2'];
const f = (n) => path.join(out, n);
ff([...src(6, '1280x720'), ...h264, ...aac, '-movflags', '+faststart', f('demo-h264-aac.mp4')]);
ff([...src(2), ...h264, ...aac, f('moov-at-end.mp4')]);
ff([...src(2), ...h264, '-c:a', 'libmp3lame', '-b:a', '96k', f('h264-mp3.mp4')]);
ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-t', '2', ...h264, f('no-audio.mp4')]);
ff([...src(2), ...h264, ...aac, f('clip-aac.mov')]);
ff([...src(2), ...h264, ...aac, f('clip-h264-aac.mkv')]);
ff([...src(2), '-c:v', 'libvpx-vp9', '-b:v', '200k', '-deadline', 'realtime', '-c:a', 'libopus', '-b:a', '64k', f('clip-vp9-opus.webm')]);
fs.writeFileSync(f('not-a-video.mp4'), 'This is plain text, not an MP4 file.\n<script>alert(1)</script>\n');
for (const n of fs.readdirSync(out).sort()) console.log(n.padEnd(24), fs.statSync(f(n)).size);
