'use strict';
// Zovo Pro tools in the player (lane PRO4): Clip export (GIF here, MP4 by the host's ffmpeg), Frame export and the
// Contact sheet. The host decides whether a tool may run (license or a free try), asks for the file or folder and
// writes every file. Frames are grabbed by seeking the player's own <video> and drawing it on a canvas.
const { createGifWriter } = require('../core/gif');
const { frameTimes, sheetTimes, gifTimes } = require('../core/proplan');
const { formatTime, frameNumber, formatBytes } = require('../core/sync');
const { codecName } = require('../core/media-names');

function setupPro(c) {
  const { el, vscode, video } = c;
  const view = { shown: false, pro: false, features: {} };
  const run = { busy: false, cancel: false, host: false, acks: new Map() };

  const badge = () => el('span', { class: 'pro-badge', text: 'PRO' });
  const mk = (label, title, feature) => {
    const b = el('button', { class: 'btn pro', title, 'data-pro': feature }, label + ' ', badge());
    b.onclick = () => ask(feature);
    return b;
  };
  const buttons = {
    clip: mk('Clip', 'Clip export: save A to B as a GIF or an MP4 (Zovo Pro)', 'clip'),
    frames: mk('Frames', 'Frame export: save frames as PNG files (Zovo Pro)', 'frames'),
    sheet: mk('Sheet', 'Contact sheet: one PNG with a grid of frames (Zovo Pro)', 'sheet'),
  };

  function ask(feature) {
    if (run.busy || run.host) { c.toast('An export is running. Esc stops it.'); return; }
    const S = c.S;
    vscode.postMessage({ type: 'proAsk', feature, a: S.a, b: S.b, duration: S.duration || video.duration || 0, width: video.videoWidth, height: video.videoHeight });
  }

  /** Seek the player and wait until that frame is on screen. */
  function seekExact(t) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        video.removeEventListener('seeked', onSeeked); clearTimeout(timer);
        if (typeof video.requestVideoFrameCallback === 'function') {
          let fired = false;
          video.requestVideoFrameCallback(() => { fired = true; resolve(); });
          setTimeout(() => { if (!fired) resolve(); }, 150);
        } else setTimeout(resolve, 40);
      };
      const onSeeked = () => finish();
      const timer = setTimeout(() => { if (done) return; done = true; video.removeEventListener('seeked', onSeeked); reject(new Error(`the video did not seek to ${t.toFixed(3)} s within 10 s`)); }, 10000);
      video.addEventListener('seeked', onSeeked);
      video.currentTime = t;
    });
  }
  const blobBytes = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error('the frame could not be encoded as PNG'))), 'image/png'));
  const stopped = () => { if (run.cancel) throw Object.assign(new Error('stopped'), { cancelled: true }); };
  const progress = (t) => c.showMsg(t);

  async function gifJob(j) {
    const times = gifTimes(j.start, j.end, j.fps);
    const canvas = document.createElement('canvas');
    canvas.width = j.width; canvas.height = j.height;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const gif = createGifWriter(j.width, j.height);
    const delay = Math.round(100 / j.fps);
    for (let i = 0; i < times.length; i++) {
      stopped();
      await seekExact(times[i]);
      g.drawImage(video, 0, 0, j.width, j.height);
      gif.addFrame(g.getImageData(0, 0, j.width, j.height).data, delay);
      progress(`Clip export: GIF frame ${i + 1} of ${times.length}, ${formatBytes(gif.size)}. Esc stops.`);
    }
    vscode.postMessage({ type: 'proData', job: j.job, data: gif.finish() });
    return { count: times.length };
  }

  async function framesJob(j) {
    const { times, capped } = frameTimes(j.mode, { start: j.start, end: j.end, fps: j.fps });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const g = canvas.getContext('2d');
    for (let i = 0; i < times.length; i++) {
      stopped();
      await seekExact(times[i].t);
      g.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = await blobBytes(canvas);
      const ack = new Promise((resolve, reject) => { run.acks.set(i, { resolve, reject }); setTimeout(() => reject(new Error('VS Code did not confirm the frame within 30 s')), 30000); });
      vscode.postMessage({ type: 'proFrame', job: j.job, index: i, t: times[i].t, data });
      await ack;
      progress(`Frame export: ${i + 1} of ${times.length} PNG files. Esc stops.`);
    }
    return { count: times.length, capped };
  }

  async function sheetJob(j) {
    const n = j.cols * j.rows;
    const times = sheetTimes(n, j.start, j.end, j.fps);
    const vw = video.videoWidth, vh = video.videoHeight;
    const tw = Math.min(320, vw), th = Math.round((tw * vh) / vw);
    const pad = 8, label = 18, head = 54;
    const canvas = document.createElement('canvas');
    canvas.width = pad + j.cols * (tw + pad);
    canvas.height = head + j.rows * (th + label + pad) + pad;
    const g = canvas.getContext('2d');
    const font = (px, bold) => `${bold ? '600 ' : ''}${px}px -apple-system, "Segoe UI", system-ui, sans-serif`;
    g.fillStyle = '#1b1b1f'; g.fillRect(0, 0, canvas.width, canvas.height);
    const S = c.S, m = S.init && S.init.meta;
    const vt = m && m.ok ? m.tracks.find((t) => t.type === 'video') : null;
    const at = m && m.ok ? m.tracks.find((t) => t.type === 'audio') : null;
    g.fillStyle = '#f2f2f2'; g.font = font(16, true); g.textBaseline = 'top';
    g.fillText(S.init ? S.init.name : 'video', pad, 10, canvas.width - 2 * pad);
    g.fillStyle = '#b8b8c0'; g.font = font(12);
    const facts = [formatTime(S.duration || video.duration || 0, true), `${vw} × ${vh}`, vt && vt.fps ? `${vt.fps} fps` : null,
      vt ? codecName(vt.codec) : null, at ? codecName(at.codec) : null, S.init ? formatBytes(S.init.size) : null,
      j.end - j.start < (S.duration || 0) - 0.01 ? `A-B ${formatTime(j.start, true)} to ${formatTime(j.end, true)}` : null].filter(Boolean);
    g.fillText(facts.join('  ·  '), pad, 32, canvas.width - 2 * pad);
    for (let i = 0; i < n; i++) {
      stopped();
      await seekExact(times[i]);
      const x = pad + (i % j.cols) * (tw + pad), y = head + Math.floor(i / j.cols) * (th + label + pad);
      g.drawImage(video, x, y, tw, th);
      g.fillStyle = '#d6d6dc'; g.font = font(11);
      g.fillText(`${formatTime(times[i], true)}   f ${frameNumber(times[i], j.fps)}`, x, y + th + 3, tw);
      progress(`Contact sheet: frame ${i + 1} of ${n}. Esc stops.`);
    }
    vscode.postMessage({ type: 'proData', job: j.job, data: await blobBytes(canvas) });
    return { count: n };
  }

  async function runJob(j) {
    if (run.busy) { vscode.postMessage({ type: 'proEnd', job: j.job, ok: false, error: 'another export is running' }); return; }
    if (!video.videoWidth) { vscode.postMessage({ type: 'proEnd', job: j.job, ok: false, error: 'the video has no picture yet' }); return; }
    run.busy = true; run.cancel = false;
    const before = { t: video.currentTime, playing: !video.paused && !video.ended };
    video.pause();
    for (const b of Object.values(buttons)) b.disabled = true;
    try {
      const r = j.feature === 'clip' ? await gifJob(j) : j.feature === 'frames' ? await framesJob(j) : await sheetJob(j);
      vscode.postMessage({ type: 'proEnd', job: j.job, ok: true, count: r.count, capped: !!r.capped });
    } catch (e) {
      vscode.postMessage({ type: 'proEnd', job: j.job, ok: false, cancelled: !!(e && e.cancelled), error: e && e.message ? String(e.message).slice(0, 400) : String(e) });
    } finally {
      run.acks.clear();
      run.busy = false;
      for (const b of Object.values(buttons)) b.disabled = false;
      progress('');
      try { await seekExact(before.t); } catch { /* the user can seek */ }
      if (before.playing) c.play();
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !(run.busy || run.host)) return;
    if (run.busy) run.cancel = true;
    else vscode.postMessage({ type: 'proCancel' });
    e.preventDefault(); e.stopPropagation();
  }, true);

  function applyView() {
    const show = view.shown || view.pro;
    for (const [f, b] of Object.entries(buttons)) {
      b.classList.toggle('hidden', !show);
      const bd = b.querySelector('.pro-badge');
      const lab = view.features[f] && view.features[f].label;
      bd.classList.toggle('hidden', view.pro);
      b.title = b.title.replace(/ \((Zovo Pro|Pro[^)]*)\)$/, '') + (view.pro ? '' : ` (${lab || 'Zovo Pro'})`);
    }
  }
  applyView();

  return {
    buttons: Object.values(buttons),
    busy: () => run.busy || run.host,
    onMessage(m) {
      if (m.type === 'pro') { view.shown = !!m.shown; view.pro = !!m.pro; view.features = m.features || {}; applyView(); return true; }
      if (m.type === 'proJob') { runJob(m); return true; }
      if (m.type === 'proAck') { const a = run.acks.get(m.index); if (a) { run.acks.delete(m.index); if (m.error) a.reject(new Error(m.error)); else a.resolve(); } return true; }
      if (m.type === 'proProgress') { run.host = !!m.running; progress(m.text || ''); return true; }
      return false;
    },
    probe: () => ({ shown: view.shown, pro: view.pro, labels: Object.fromEntries(Object.entries(view.features).map(([k, v]) => [k, v.label])), busy: run.busy || run.host }),
  };
}

module.exports = { setupPro };
