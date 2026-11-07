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
// Video VS Code cannot decode: converted to H.264 by the user's ffmpeg (feature "convert").
ff([...src(2, '480x270'), '-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le', ...aac, f('clip-prores422-aac.mov')]);
ff([...src(2), '-c:v', 'mpeg4', '-q:v', '6', '-c:a', 'libmp3lame', '-b:a', '96k', f('clip-mpeg4-mp3.avi')]);
// Sidecar subtitles next to the demo clip: one plain .srt and one tagged .vtt.
fs.writeFileSync(f('demo-h264-aac.srt'), '\ufeff1\r\n00:00:00,500 --> 00:00:02,500\r\nSubtitles load by themselves\r\n<i>from demo-h264-aac.srt</i>\r\n\r\n2\r\n00:00:03,000 --> 00:00:05,500\r\nPress C to turn them off\r\n');
fs.writeFileSync(f('demo-h264-aac.pt-BR.vtt'), 'WEBVTT\n\nNOTE sample track\n\n00:00.500 --> 00:02.500 line:90%\nLegendas carregam sozinhas\n\n00:03.000 --> 00:05.500\nAperte C para desligar\n');
fs.writeFileSync(f('not-a-video.mp4'), 'This is plain text, not an MP4 file.\n<script>alert(1)</script>\n');
for (const n of fs.readdirSync(out).sort()) console.log(n.padEnd(28), fs.statSync(f(n)).size);
