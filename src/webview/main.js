'use strict';
// Player UI. All file text goes through textContent; nothing from the file becomes HTML.
const { syncAction, loopTarget, stepFrame, frameNumber, formatTime, formatBytes, nextSpeed, SPEEDS } = require('../core/sync');
const { codecName } = require('../core/media-names');

const vscode = acquireVsCodeApi();
const saved = vscode.getState() || {};
const app = document.getElementById('app');

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

const S = { init: null, fps: 30, duration: 0, a: null, b: null, loop: false, audio: null, sound: 'pending', soundInfo: {}, volume: 1, muted: false, stats: null };

const video = el('video', { class: 'video', preload: 'auto', playsinline: '' });
const stage = el('div', { class: 'stage' }, video, el('div', { class: 'overlay', id: 'overlay' }));
const playBtn = el('button', { class: 'btn play', title: 'Play / pause (Space)', 'aria-label': 'Play', text: 'Play' });
const timeEl = el('span', { class: 'time', text: '0:00.000 / 0:00' });
const frameEl = el('span', { class: 'frame', title: 'Frame number', text: 'f 0' });
const seek = el('input', { class: 'seek', type: 'range', min: '0', max: '1000', value: '0', step: '1', 'aria-label': 'Seek' });
const loopBar = el('div', { class: 'loopbar' });
const seekWrap = el('div', { class: 'seekwrap' }, loopBar, seek);
const prevF = el('button', { class: 'btn', title: 'Previous frame (,)', text: '◀ frame' });
const nextF = el('button', { class: 'btn', title: 'Next frame (.)', text: 'frame ▶' });
const speedSel = el('select', { class: 'speed', title: 'Speed ([ and ])', 'aria-label': 'Speed' }, ...SPEEDS.map((s) => el('option', { value: String(s), text: s + '×' })));
speedSel.value = '1';
const aBtn = el('button', { class: 'btn', title: 'Set loop start (A)', text: 'A' });
const bBtn = el('button', { class: 'btn', title: 'Set loop end (B)', text: 'B' });
const loopBtn = el('button', { class: 'btn', title: 'Loop A-B on/off (L)', text: 'Loop' });
const muteBtn = el('button', { class: 'btn', title: 'Mute (M)', text: 'Mute' });
const vol = el('input', { class: 'vol', type: 'range', min: '0', max: '1', step: '0.05', value: '1', 'aria-label': 'Volume' });
const shotBtn = el('button', { class: 'btn', title: 'Save this frame as PNG (S)', text: 'Save frame' });
const infoBtn = el('button', { class: 'btn', title: 'Show metadata (I)', text: 'Info' });
const soundChip = el('span', { class: 'chip', role: 'status', text: 'Sound: checking' });
const soundAction = el('button', { class: 'btn link hidden', text: '' });
const toast = el('div', { class: 'toast hidden', role: 'status' });
const info = el('aside', { class: 'info hidden' });
const msg = el('div', { class: 'msg hidden' });

const bar1 = el('div', { class: 'bar' }, playBtn, timeEl, frameEl, seekWrap);
const bar2 = el('div', { class: 'bar' }, prevF, nextF, speedSel, aBtn, bBtn, loopBtn, el('span', { class: 'sep' }), muteBtn, vol, shotBtn, infoBtn, el('span', { class: 'grow' }), soundChip, soundAction);
app.replaceChildren(el('div', { class: 'player' }, el('div', { class: 'main' }, stage, msg, bar1, bar2), info), toast);

function showToast(t) { toast.textContent = t; toast.classList.remove('hidden'); clearTimeout(showToast.t); showToast.t = setTimeout(() => toast.classList.add('hidden'), 2200); }
function showMsg(t) { msg.textContent = t; msg.classList.toggle('hidden', !t); }

// ---- playback ----
function playing() { return !video.paused && !video.ended; }
function togglePlay() {
  if (playing()) { video.pause(); return; }
  if (!video.src) return;
  const p = video.play();
  if (S.audio) { S.audio.currentTime = video.currentTime; S.audio.play().catch(() => {}); }
  if (p) p.catch((e) => showMsg('Cannot play: ' + e.message));
}
function seekTo(t) {
  t = Math.max(0, Math.min(S.duration || video.duration || 0, t));
  video.currentTime = t;
  if (S.audio) S.audio.currentTime = t;
}
function step(dir) { video.pause(); seekTo(stepFrame(video.currentTime, S.fps, dir, S.duration)); }
function setSpeed(r) { video.playbackRate = r; speedSel.value = String(r); if (S.audio) S.audio.playbackRate = r; }
function applyVolume() {
  const target = S.audio || video;
  target.volume = S.volume;
  target.muted = S.muted;
  if (S.audio) video.muted = true;
  muteBtn.textContent = S.muted ? 'Unmute' : 'Mute';
  vol.value = String(S.volume);
}

playBtn.onclick = togglePlay;
video.addEventListener('click', togglePlay);
prevF.onclick = () => step(-1);
nextF.onclick = () => step(1);
speedSel.onchange = () => setSpeed(Number(speedSel.value));
aBtn.onclick = () => { S.a = video.currentTime; if (S.b != null && S.b <= S.a) S.b = null; drawLoop(); };
bBtn.onclick = () => { S.b = video.currentTime; if (S.a == null || S.a >= S.b) S.a = 0; S.loop = true; drawLoop(); };
loopBtn.onclick = () => { S.loop = !S.loop; if (S.loop && (S.a == null || S.b == null)) { S.a = 0; S.b = S.duration; } drawLoop(); };
muteBtn.onclick = () => { S.muted = !S.muted; applyVolume(); };
vol.oninput = () => { S.volume = Number(vol.value); S.muted = S.volume === 0; applyVolume(); };
shotBtn.onclick = saveFrame;
infoBtn.onclick = () => info.classList.toggle('hidden');
seek.oninput = () => { if (S.duration) seekTo((Number(seek.value) / 1000) * S.duration); };

function drawLoop() {
  loopBtn.classList.toggle('on', S.loop);
  aBtn.classList.toggle('on', S.a != null);
  bBtn.classList.toggle('on', S.b != null);
  if (S.a != null && S.b != null && S.duration) {
    loopBar.style.left = (S.a / S.duration) * 100 + '%';
    loopBar.style.width = ((S.b - S.a) / S.duration) * 100 + '%';
    loopBar.classList.toggle('on', S.loop);
    loopBar.classList.remove('hidden');
    loopBtn.title = 'Loop ' + formatTime(S.a, true) + ' to ' + formatTime(S.b, true) + ' (L)';
  } else loopBar.classList.add('hidden');
}

function tick() {
  const t = video.currentTime;
  timeEl.textContent = formatTime(t, true) + ' / ' + formatTime(S.duration);
  frameEl.textContent = 'f ' + frameNumber(t, S.fps);
  if (S.duration && document.activeElement !== seek) seek.value = String(Math.round((t / S.duration) * 1000));
  playBtn.textContent = playing() ? 'Pause' : 'Play';
  playBtn.setAttribute('aria-label', playBtn.textContent);
  if (S.loop) { const to = loopTarget(t, S.a, S.b); if (to != null) seekTo(to); }
  if (Math.abs(t - (saved.t || 0)) > 0.5 || video.paused) { saved.t = t; vscode.setState({ t, rate: video.playbackRate, a: S.a, b: S.b, loop: S.loop }); }
}
video.addEventListener('timeupdate', tick);
video.addEventListener('seeked', tick);
video.addEventListener('play', () => { if (S.audio && S.audio.paused) S.audio.play().catch(() => setChip('Sound ready: press Play')); tick(); });
video.addEventListener('pause', () => { if (S.audio) S.audio.pause(); tick(); });
video.addEventListener('ratechange', () => { if (S.audio) S.audio.playbackRate = video.playbackRate; });
video.addEventListener('waiting', () => { if (S.audio) S.audio.pause(); });
video.addEventListener('playing', () => { if (S.audio && S.audio.paused) S.audio.play().catch(() => {}); });
video.addEventListener('loadedmetadata', () => {
  if (!S.duration || !Number.isFinite(S.duration)) S.duration = video.duration;
  if (saved.t > 0 && !S.restored) { S.restored = true; seekTo(Math.min(saved.t, S.duration || saved.t)); if (saved.rate) setSpeed(saved.rate); S.a = saved.a ?? null; S.b = saved.b ?? null; S.loop = !!saved.loop; drawLoop(); }
  showMsg('');
  fillInfo();
  tick();
});
video.addEventListener('error', () => {
  const e = video.error;
  showMsg('VS Code could not play this file' + (e && e.message ? ': ' + e.message : '.'));
});
function loopFrame() { if (playing()) tick(); requestAnimationFrame(loopFrame); }
requestAnimationFrame(loopFrame);

setInterval(() => {
  if (!S.audio || !playing() || S.audio.paused || S.audio.seeking) return;
  if (S.audio.duration && video.currentTime > S.audio.duration) return;
  const act = syncAction(video.currentTime, S.audio.currentTime, video.playbackRate);
  if (act.seek != null) S.audio.currentTime = act.seek;
  S.audio.playbackRate = act.rate;
}, 200);

document.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'SELECT' || (e.target.tagName === 'INPUT' && e.target.type !== 'range'))) return;
  const k = e.key;
  const handled = {
    ' ': togglePlay, k: togglePlay, ',': () => step(-1), '.': () => step(1),
    ArrowLeft: () => seekTo(video.currentTime - (e.shiftKey ? 1 : 5)), ArrowRight: () => seekTo(video.currentTime + (e.shiftKey ? 1 : 5)),
    '[': () => setSpeed(nextSpeed(video.playbackRate, -1)), ']': () => setSpeed(nextSpeed(video.playbackRate, 1)),
    a: () => aBtn.onclick(), b: () => bBtn.onclick(), l: () => loopBtn.onclick(), m: () => muteBtn.onclick(), s: saveFrame, i: () => infoBtn.onclick(),
    Home: () => seekTo(0), End: () => seekTo(S.duration),
  }[k.length === 1 ? k.toLowerCase() : k];
  if (handled && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); handled(); }
});

function saveFrame() {
  if (!video.videoWidth) { showToast('No frame yet'); return; }
  const c = document.createElement('canvas');
  c.width = video.videoWidth; c.height = video.videoHeight;
  try {
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    vscode.postMessage({ type: 'screenshot', dataUrl: c.toDataURL('image/png'), time: video.currentTime });
  } catch (e) { showToast('Could not grab the frame: ' + e.message); }
}

// ---- sound ----
function setChip(text, cls) { soundChip.textContent = text; soundChip.className = 'chip ' + (cls || ''); }
function setAction(text, type) {
  soundAction.textContent = text || '';
  soundAction.classList.toggle('hidden', !text);
  soundAction.onclick = type ? () => vscode.postMessage({ type }) : null;
}

function onSound(m) {
  S.sound = m.state; S.soundInfo = m;
  setAction('');
  const mode = m.mode === 'remux' ? 'video and sound' : 'sound';
  switch (m.state) {
    case 'native': setChip('Sound: on', 'ok'); if (S.init && S.init.e2e) e2eMeter(video); break;
    case 'none': setChip('No audio track', 'muted'); break;
    case 'decoding': setChip('Preparing ' + mode + ' with ' + m.tool + (m.progress != null ? ' ' + Math.round(m.progress * 100) + '%' : '...'), 'busy'); break;
    case 'ready':
      setChip((m.mode === 'remux' ? 'Remuxed' : 'Sound: on') + ' (' + m.tool + (m.cached ? ', cached' : m.ms ? ', ' + (m.ms / 1000).toFixed(1) + ' s' : '') + ')', 'ok');
      if (m.src) attachAudio(m.src);
      else if (S.init && S.init.e2e) e2eMeter(video);
      break;
    case 'needs-trust': setChip(m.text, 'warn'); setAction('Turn on sound', 'enableSound'); break;
    case 'needs-helper': setChip(m.text, 'warn'); setAction('Settings', 'openSettings'); break;
    case 'too-big': setChip(m.text, 'warn'); setAction('Settings', 'openSettings'); break;
    case 'error': setChip(m.text || 'Sound failed', 'err'); setAction('Retry', 'retrySound'); break;
    case 'off': setChip(m.text, 'muted'); break;
  }
  fillInfo();
}

function attachAudio(src) {
  if (S.audio) { S.audio.pause(); S.audio.remove(); }
  const a = el('audio', { preload: 'auto' });
  a.src = src;
  document.body.append(a);
  S.audio = a;
  a.addEventListener('loadedmetadata', () => { a.currentTime = video.currentTime; a.playbackRate = video.playbackRate; if (playing()) a.play().catch(() => setChip('Sound ready: press Play', 'ok')); });
  applyVolume();
  if (S.init && S.init.e2e) e2eMeter(a);
}

// ---- metadata ----
function row(k, v) { return v == null || v === '' ? null : el('tr', {}, el('th', { text: k }), el('td', { text: String(v) })); }
function infoText() {
  return [...info.querySelectorAll('tr')].map((r) => r.children[0].textContent + ': ' + r.children[1].textContent).join('\n');
}
function fillInfo() {
  if (!S.init) return;
  const m = S.init.meta;
  const v = m && m.ok ? m.tracks.find((t) => t.type === 'video') : null;
  const a = m && m.ok ? m.tracks.find((t) => t.type === 'audio') : null;
  const rows = [
    row('File', S.init.name), row('Size', formatBytes(S.init.size)),
    row('Container', m && m.ok ? m.brands.join(', ') : (S.init.name.split('.').pop() || '').toUpperCase()),
    row('Duration', formatTime(S.duration || (m && m.duration) || 0, true)),
    row('Video', v ? codecName(v.codec) + ' (' + v.codec + ')' : null), row('Frame size', v ? v.width + ' × ' + v.height : video.videoWidth ? video.videoWidth + ' × ' + video.videoHeight : null),
    row('Frame rate', v && v.fps ? v.fps + ' fps' : null), row('Frames', v ? v.samples : null),
    row('Video bitrate', v && v.bitrate ? Math.round(v.bitrate / 1000) + ' kb/s' : null),
    row('Audio', a ? codecName(a.codec) + ' (' + a.codec + ')' : m && m.ok ? 'none' : null),
    row('Sample rate', a && a.sampleRate ? a.sampleRate + ' Hz' : null), row('Channels', a ? a.channels : null),
    row('Audio bitrate', a && a.bitrate ? Math.round(a.bitrate / 1000) + ' kb/s' : null),
    row('Language', a && a.language ? a.language : null),
    row('Sound path', soundPath()),
    row('Header read', S.init.probeMs != null && m ? S.init.probeMs + ' ms, ' + formatBytes(m.bytesRead) : null),
  ].filter(Boolean);
  const copy = el('button', { class: 'btn', text: 'Copy info', onclick: () => vscode.postMessage({ type: 'copyText', text: infoText() }) });
  info.replaceChildren(el('h2', { text: 'Metadata' }), el('table', {}, ...rows), copy, S.init.plan ? el('p', { class: 'note', text: S.init.plan.reason }) : null);
}
function soundPath() {
  const i = S.soundInfo;
  if (S.sound === 'native') return 'played by VS Code';
  if (S.sound === 'ready') return (i.mode === 'remux' ? 'remuxed to MP4 + FLAC by ' : 'decoded to FLAC by ') + i.tool;
  if (S.sound === 'none') return 'no audio track';
  return i.text || S.sound;
}

// ---- e2e test hook (only when the host runs with VIDEO_PREVIEW_E2E) ----
function e2eMeter(a) {
  try {
    const ctx = new AudioContext();
    const src = ctx.createMediaElementSource(a);
    const an = ctx.createAnalyser(); an.fftSize = 2048;
    src.connect(an); an.connect(ctx.destination);
    const buf = new Float32Array(2048);
    S.stats = { peakRms: 0 };
    setInterval(() => {
      an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x;
      const rms = Math.sqrt(s / buf.length);
      S.stats.peakRms = Math.max(S.stats.peakRms, rms);
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
    }, 50);
  } catch (e) { S.stats = { meterError: String(e) }; }
}
function e2eReport() {
  vscode.postMessage({ type: 'stats', stats: { ...(S.stats || {}), sound: S.sound, tool: S.soundInfo.tool || null, playing: playing(), t: video.currentTime,
    audioT: S.audio ? S.audio.currentTime : null, drift: S.audio ? S.audio.currentTime - video.currentTime : null, videoMuted: video.muted,
    w: video.videoWidth, h: video.videoHeight, vBytes: video.webkitVideoDecodedByteCount, aBytes: S.audio ? S.audio.webkitAudioDecodedByteCount : video.webkitAudioDecodedByteCount,
    rate: video.playbackRate, loop: S.loop, a: S.a, b: S.b, frame: frameNumber(video.currentTime, S.fps), chip: soundChip.textContent, msg: msg.textContent } });
}

window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (!m || typeof m !== 'object') return;
  if (m.type === 'init') {
    S.init = m;
    const v = m.meta && m.meta.ok ? m.meta.tracks.find((t) => t.type === 'video') : null;
    if (v && v.fps) S.fps = v.fps;
    if (m.meta && m.meta.ok) S.duration = m.meta.duration;
    if (m.src) { video.src = m.src; video.muted = false; }
    else showMsg('Preparing the video...');
    if (m.plan && m.plan.mode === 'decode-audio') video.muted = true;
    document.title = m.name;
    fillInfo();
    if (m.e2e) setInterval(e2eReport, 500);
  } else if (m.type === 'media') {
    const t = video.currentTime; video.src = m.src; video.currentTime = t; video.muted = false;
  } else if (m.type === 'sound') onSound(m);
  else if (m.type === 'toast') showToast(m.text);
});

vscode.postMessage({ type: 'ready' });
