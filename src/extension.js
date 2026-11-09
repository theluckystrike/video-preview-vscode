'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { buildHtml } = require('./html');
const media = require('./core/media');
const decoder = require('./core/decoder');
const builtin = require('./core/builtin');
const { parseFromWebview, pngFromDataUrl, toWebview } = require('./core/protocol');
const { shotName } = require('./core/sync');
const { findSidecars, loadTrack } = require('./core/sidecars');
const { createStore, resumeAt } = require('./core/resume');
const { createRatingPrompt } = require('./rate');
const { registerSupport, commandUris, showLinks } = require('./support');
const { createPro } = require('./pro');
const clip = require('./core/clip');

let rating = { success() {}, failure() {} };
let pro = null;
let nextJob = 1;

// The sound decoder shipped in the extension (WebAssembly in a worker thread). It starts no program.
const BUILTIN = { tool: 'built-in decoder', path: null, builtin: true };

const VIEW_TYPE = 'videoPreview.player';

function cfg() {
  const c = vscode.workspace.getConfiguration('videoPreview');
  return {
    helper: c.get('soundHelper', 'auto'),
    ffmpegPath: c.get('ffmpegPath', ''),
    maxDecodeMB: c.get('maxDecodeSizeMB', 4096),
    cacheMB: c.get('cacheSizeMB', 2048),
    timeoutSec: c.get('helperTimeoutSeconds', 900),
    autoSound: c.get('decodeSoundAutomatically', true),
    convert: c.get('convertUnsupportedVideo', true),
    autoSubs: c.get('subtitles.autoLoad', true),
    remember: c.get('rememberPosition', true),
    autoplay: c.get('autoplay', false),
  };
}

function readRange(fd) {
  return (pos, len) => new Promise((resolve, reject) => {
    const b = Buffer.allocUnsafe(len);
    fs.read(fd, b, 0, len, pos, (err, n) => (err ? reject(err) : resolve(b.subarray(0, n))));
  });
}

async function probeFile(file, size) {
  const fd = await fs.promises.open(file, 'r');
  try { return await media.probeMp4(readRange(fd.fd), size); } finally { await fd.close(); }
}

/** In-memory stand-in when the context has no globalState (tests). */
function memoryMemento() { const m = new Map(); return { get: (k, d) => (m.has(k) ? m.get(k) : d), update: async (k, v) => { m.set(k, v); } }; }

class Provider {
  constructor(ctx) { this.ctx = ctx; this.jobs = new Map(); this.store = createStore(ctx.globalState || memoryMemento()); }

  openCustomDocument(uri) { return { uri, dispose: () => {} }; }

  async resolveCustomEditor(doc, panel) {
    const uri = doc.uri;
    const cacheDir = path.join(this.ctx.globalStorageUri.fsPath, 'cache');
    const isLocal = uri.scheme === 'file';
    const roots = [vscode.Uri.joinPath(this.ctx.extensionUri, 'dist'), vscode.Uri.joinPath(this.ctx.extensionUri, 'media'), vscode.Uri.file(cacheDir)];
    roots.push(isLocal ? vscode.Uri.file(path.dirname(uri.fsPath)) : vscode.Uri.joinPath(uri, '..'));
    // Command links are limited to the two support commands and the settings page (footer "Hide" link).
    panel.webview.options = { enableScripts: true, enableCommandUris: commandUris('videoPreview'), localResourceRoots: roots };
    const w = panel.webview;
    const name = path.basename(uri.path);
    w.html = buildHtml({
      cspSource: w.cspSource,
      scriptUri: w.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview.js')).toString(),
      styleUri: w.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'player.css')).toString(),
      title: name,
      showSupportLinks: showLinks(vscode, 'videoPreview'),
    });

    let job = null;
    let counted = false; // one success per opened tab, for the rating prompt
    const post = (m) => {
      // Rating: a file counts once its picture and sound are ready; any error state blocks the ask.
      if (m && m.type === 'sound') {
        if (m.state === 'error') rating.failure();
        else if (!counted && ['native', 'none', 'ready', 'off'].includes(m.state)) { counted = true; rating.success(); }
      }
      w.postMessage(m).then(undefined, () => {});
    };
    const state = { meta: null, plan: null, stat: null };

    let gen = 0; // bumped when a newer job replaces the running one, so the old result is dropped quietly
    const startSound = async (userAsked) => {
      const my = ++gen;
      const p = state.plan;
      const mode = p.mode;
      const tc = mode === 'transcode';
      if (!isLocal) { post(toWebview.sound('off', { mode, text: tc ? 'Converting the video needs a file on local disk.' : 'Sound decoding needs a file on local disk.' })); return; }
      if (state.stat && state.stat.size === 0) { post(toWebview.sound('error', { mode, final: true, text: media.notVideoText(0) })); return; }
      const c = cfg();
      const needFfmpeg = mode === 'remux' || tc;
      // AAC, ALAC, MP3 and PCM in MP4 and MOV: the built-in decoder works with no install, and also in an
      // untrusted workspace, because it runs no program.
      const builtinOk = mode === 'decode-audio' && ['auto', 'afconvert', 'builtin'].includes(c.helper) && builtin.supports(p.audioCodec);
      const untrustedAuto = !vscode.workspace.isTrusted && !userAsked;
      const cannotPlay = p.videoCodec ? 'This video uses ' + media.codecName(p.videoCodec) + ', which VS Code cannot play.' : 'VS Code cannot play ' + path.extname(name).toLowerCase() + ' files.';
      if (untrustedAuto && !builtinOk) {
        post(toWebview.sound('needs-trust', { mode, text: tc ? cannotPlay + ' This workspace is not trusted, so ffmpeg does not start by itself.' : 'This workspace is not trusted, so no helper runs by itself.' }));
        return;
      }
      if (!userAsked && (tc ? !c.convert : !c.autoSound)) {
        post(toWebview.sound('needs-trust', { mode, text: tc ? cannotPlay + ' Automatic conversion is off (videoPreview.convertUnsupportedVideo).' : 'Automatic sound decoding is off.' }));
        return;
      }
      if (state.stat.size > c.maxDecodeMB * 1048576) {
        post(toWebview.sound('too-big', { mode, text: `This file is ${(state.stat.size / 1048576).toFixed(0)} MB. ${tc ? 'Conversion' : 'Sound decoding'} stops at ${c.maxDecodeMB} MB (setting videoPreview.maxDecodeSizeMB).` }));
        return;
      }
      let helper = c.helper === 'builtin' || untrustedAuto ? null : decoder.findHelper({ setting: c.ffmpegPath, preferred: c.helper, needFfmpeg });
      if (!helper && builtinOk) helper = BUILTIN;
      if (!helper) {
        let text;
        if (c.helper === 'off') text = (tc ? cannotPlay + ' ' : '') + 'The helper is turned off (setting videoPreview.soundHelper is "off"), so ffmpeg does not run.';
        else if (tc) text = cannotPlay + ' Install ffmpeg to convert it for playback.';
        else if (mode === 'remux') text = 'Install ffmpeg to open this file. VS Code cannot read ' + path.extname(name) + ' by itself.';
        else if (c.helper === 'ffmpeg') text = 'Install ffmpeg to hear this file (setting videoPreview.soundHelper is "ffmpeg"). VS Code has no ' + media.codecName(p.audioCodec) + ' decoder.';
        else text = 'Install ffmpeg to hear this file. VS Code and the built-in decoder have no ' + media.codecName(p.audioCodec) + ' decoder.';
        post(toWebview.sound('needs-helper', { mode, text, off: c.helper === 'off' }));
        return;
      }
      fs.mkdirSync(cacheDir, { recursive: true });
      const isVideo = mode === 'remux' || tc;
      const outFor = (h) => path.join(cacheDir, decoder.cacheKey(uri.fsPath, state.stat, h.tool, mode) + (isVideo ? '.mp4' : h.builtin ? '.wav' : '.flac'));
      let out = outFor(helper);
      const done = (file, ms, cached, encoder, doneMode = mode) => {
        try { const now = new Date(); fs.utimesSync(file, now, now); } catch { /* ignore */ }
        const src = w.asWebviewUri(vscode.Uri.file(file)).toString();
        if (doneMode === 'transcode') state.converted = true;
        if (isVideo) post(toWebview.media(src));
        post(toWebview.sound('ready', { src: isVideo ? null : src, tool: helper.tool, ms, cached, mode: doneMode, encoder, format: helper.builtin ? 'WAV' : 'FLAC' }));
      };
      if (fs.existsSync(out)) { done(out, 0, true); return; }
      const duration = state.meta && state.meta.ok ? state.meta.duration : 0;
      const runWith = async (h) => {
        post(toWebview.sound('decoding', { tool: h.tool, progress: null, mode }));
        const onProgress = (f) => { if (my === gen) post(toWebview.sound('decoding', { tool: h.tool, progress: f, mode })); };
        const thisJob = h.builtin
          ? builtin.run({ input: uri.fsPath, output: out, ...builtin.startFrames(state.meta), duration, timeoutMs: c.timeoutSec * 1000, onProgress,
            wasmPath: path.join(this.ctx.extensionUri.fsPath, 'media', 'vp-audio.wasm'), workerPath: path.join(this.ctx.extensionUri.fsPath, 'dist', 'audio-worker.js') })
          : decoder.run({ helper: h, input: uri.fsPath, output: out, mode, duration, timeoutMs: c.timeoutSec * 1000, onProgress });
        job = thisJob;
        const res = await thisJob.promise;
        if (job === thisJob) job = null;
        return res;
      };
      let r = await runWith(helper);
      if (my !== gen) return;
      if (!r.ok && !helper.builtin && builtinOk && !/^Stopped\.$/.test(r.error || '') && !media.isNotMediaError(r.error)) {
        // ffmpeg or afconvert failed on the sound: one more try with the built-in decoder.
        helper = BUILTIN; out = outFor(helper);
        r = await runWith(helper);
        if (my !== gen) return;
      }
      if (r.ok && mode === 'remux' && r.mode === 'transcode') {
        // The MKV or WebM held a video codec that MP4 or VS Code cannot take, so ffmpeg converted it to H.264.
        state.plan = media.transcodePlan(r.videoCodec, false);
        post(toWebview.plan(state.plan));
      }
      if (r.ok) { done(out, r.ms, false, r.encoder, r.mode === 'transcode' ? 'transcode' : mode); decoder.pruneCache(cacheDir, c.cacheMB * 1048576, new Set([out])); }
      else if (helper.builtin && (r.status === -2 || r.status === -3) && state.meta && state.meta.ok) {
        // A sound format the built-in decoder does not have (5.1 AAC, a codec mp4box names but Symphonia does not).
        post(toWebview.sound('needs-helper', { mode, text: 'Install ffmpeg to hear this file. ' + r.error }));
      } else if ((media.isNotMediaError(r.error) || (helper.builtin && r.status === -1)) && !(state.meta && state.meta.ok)) post(toWebview.sound('error', { tool: helper.tool, mode, final: true, text: media.notVideoText(state.stat ? state.stat.size : null, helper.builtin ? 'the built-in decoder' : helper.tool) }));
      else post(toWebview.sound('error', { tool: helper.tool, mode, text: helper.tool + (tc ? ' could not convert this video: ' : ' could not read this file: ') + r.error }));
    };

    const posKey = isLocal ? uri.fsPath : uri.toString();
    const e2e = !!process.env.VIDEO_PREVIEW_E2E;

    // ---- Zovo Pro: Clip export, Frame export, Contact sheet (src/pro.js). A free try is used when a file is saved. ----
    let proJob = null; // { id, feature, kind: 'gif' | 'png' | 'frames' | 'mp4', target | dir, written, bytes, pending, run }
    const postPro = () => post({ type: 'pro', ...(pro ? pro.view() : { shown: false, pro: false, features: {} }) });
    const proSub = pro ? pro.onDidChange(() => postPro()) : null;
    const cfgSub = vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('videoPreview.showProFeatures')) postPro(); });
    const stem = () => path.basename(name).replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'video';
    const where = (u) => (u.scheme === 'file' ? u.fsPath : u.toString());
    const folderUri = isLocal ? vscode.Uri.file(path.dirname(uri.fsPath)) : vscode.Uri.joinPath(uri, '..');
    const tcode = (t) => { const m = Math.floor(t / 60); const sec = t - m * 60; return `${String(m).padStart(2, '0')}m${sec.toFixed(1).padStart(4, '0').replace('.', 's')}`; };
    const videoFps = () => (state.meta && state.meta.ok ? (state.meta.tracks.find((t) => t.type === 'video') || {}).fps : 0) || 30;
    const saveTo = async (defName, filter, ext) => {
      const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(folderUri, defName), filters: { [filter]: [ext] }, saveLabel: 'Save' });
      if (!target) return null;
      if (target.toString() === uri.toString() || !new RegExp('\\.' + ext + '$', 'i').test(target.path)) {
        post(toWebview.toast(`Choose a file name that ends in .${ext}. The video itself is never overwritten.`));
        return null;
      }
      return target;
    };
    const proFinished = async (j, ok, text) => {
      proJob = null;
      if (ok) await pro.use(j.feature);
      post({ type: 'proProgress', text: '', running: false });
      post(toWebview.toast(text));
      postPro();
    };
    const proAsk = async (m) => {
      if (!pro) return;
      if (proJob) { post(toWebview.toast('An export is already running. Esc stops it.')); return; }
      const f = m.feature;
      if (!(await pro.allow(f))) { postPro(); return; }
      const duration = m.duration || (state.meta && state.meta.ok ? state.meta.duration : 0);
      const r = clip.range(m.a, m.b, duration);
      if (!(r.end > r.start)) { post(toWebview.toast('The video has no length yet. Wait until it plays.')); return; }
      const fps = videoFps();
      const span = r.end - r.start;
      const what = r.ab ? `A to B, ${span.toFixed(1)} s` : `the whole video, ${span.toFixed(1)} s`;
      const id = nextJob++;
      if (f === 'clip') {
        const c = cfg();
        const ff = isLocal && c.helper !== 'off' ? decoder.findHelper({ setting: c.ffmpegPath, preferred: 'ffmpeg', needFfmpeg: true }) : null;
        const longGif = span > clip.MAX_GIF_SECONDS;
        const items = [
          ...clip.GIF_PRESETS.map((g) => { const sz = clip.gifSize(m.width, m.height, g.width); return { label: g.label, description: sz.width ? `${sz.width} × ${sz.height}` : '', detail: `${g.detail}. ${longGif ? `The first ${clip.MAX_GIF_SECONDS} s of ${what}.` : `From ${what}.`}`, g }; }),
          ...clip.MP4_PRESETS.map((x) => ({ label: x.label, description: !isLocal ? 'needs a file on this computer' : ff ? '' : 'ffmpeg not found', detail: `${x.detail} From ${what}.`, x })),
        ];
        const pick = await vscode.window.showQuickPick(items, { title: 'Clip export (Zovo Pro)', placeHolder: r.ab ? 'Save the A-B part as' : 'No A-B loop set: save the whole video as (set A and B with the A and B keys)' });
        if (!pick) return;
        if (pick.x) {
          if (!ff) {
            const msg = !isLocal ? 'MP4 export needs the video on this computer.' : 'MP4 export needs ffmpeg: winget install ffmpeg (Windows), brew install ffmpeg (macOS) or sudo apt install ffmpeg (Linux). GIF export works without it.';
            const b = await vscode.window.showWarningMessage(msg, ...(isLocal ? ['Settings'] : []));
            if (b === 'Settings') vscode.commands.executeCommand('workbench.action.openSettings', 'videoPreview.ffmpegPath');
            return;
          }
          const target = await saveTo(`${stem()}-${tcode(r.start)}-${tcode(r.end)}.mp4`, 'MP4 video', 'mp4');
          if (!target) return;
          if (target.scheme !== 'file') { post(toWebview.toast('Pick a folder on this computer for the MP4.')); return; }
          const j = { id, feature: 'clip', kind: 'mp4' };
          proJob = j;
          post({ type: 'proProgress', text: `Cutting the clip with ffmpeg... Esc stops.`, running: true });
          j.run = clip.runClip({ ffmpeg: ff.path, input: uri.fsPath, output: target.fsPath, a: r.start, b: r.end, mode: pick.x.mode, timeoutMs: c.timeoutSec * 1000,
            onProgress: (p) => post({ type: 'proProgress', text: `Cutting the clip with ffmpeg: ${Math.round(p * 100)}%. Esc stops.`, running: true }) });
          const res = await j.run.promise;
          if (res.ok) {
            let bytes = 0; try { bytes = fs.statSync(target.fsPath).size; } catch { /* gone */ }
            await proFinished(j, true, `Saved ${path.basename(target.fsPath)} (${(bytes / 1048576).toFixed(1)} MB, ${res.encoder}, ${(res.ms / 1000).toFixed(1)} s)`);
          } else await proFinished(j, false, (res.error === 'Stopped.' ? 'Clip export stopped.' : 'ffmpeg could not cut the clip: ' + res.error) + ' No free try was used.');
          return;
        }
        const sz = clip.gifSize(m.width, m.height, pick.g.width);
        if (!sz.width) { post(toWebview.toast('No picture yet. Play the video once, then export.')); return; }
        const target = await saveTo(`${stem()}-${tcode(r.start)}-${tcode(r.end)}.gif`, 'GIF image', 'gif');
        if (!target) return;
        proJob = { id, feature: 'clip', kind: 'gif', target, written: 0 };
        post({ type: 'proJob', job: id, feature: 'clip', width: sz.width, height: sz.height, fps: pick.g.fps, start: r.start, end: Math.min(r.end, r.start + clip.MAX_GIF_SECONDS) });
        return;
      }
      if (f === 'frames') {
        const items = clip.FRAME_MODES.map((x) => {
          const n = clip.frameTimes(x.id, { start: r.start, end: r.end, fps }).times.length;
          return { label: x.label, description: `${n.toLocaleString('en-US')} PNG ${n === 1 ? 'file' : 'files'}${n >= clip.MAX_FRAMES ? ' (the first 1,000)' : ''}`, detail: `From ${what}, ${m.width || '?'} × ${m.height || '?'} pixels each.`, x };
        });
        const pick = await vscode.window.showQuickPick(items, { title: 'Frame export (Zovo Pro)', placeHolder: r.ab ? 'Frames from the A-B part' : 'No A-B loop set: frames from the whole video' });
        if (!pick) return;
        const dirs = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, defaultUri: folderUri, openLabel: 'Save Frames Here' });
        if (!dirs || !dirs[0]) return;
        proJob = { id, feature: 'frames', kind: 'frames', dir: dirs[0], written: 0 };
        post({ type: 'proJob', job: id, feature: 'frames', mode: pick.x.id, fps, start: r.start, end: r.end });
        return;
      }
      if (f === 'sheet') {
        const pick = await vscode.window.showQuickPick(clip.SHEET_PRESETS.map((x) => ({ label: x.label, detail: `${x.cols * x.rows} frames evenly spaced over ${what}, with times and frame numbers.`, x })), { title: 'Contact sheet (Zovo Pro)' });
        if (!pick) return;
        const target = await saveTo(`${stem()}-sheet.png`, 'PNG image', 'png');
        if (!target) return;
        proJob = { id, feature: 'sheet', kind: 'png', target, written: 0 };
        post({ type: 'proJob', job: id, feature: 'sheet', cols: pick.x.cols, rows: pick.x.rows, fps, start: r.start, end: r.end });
      }
    };

    panel.onDidDispose(() => {
      if (job) job.cancel();
      if (proJob && proJob.run) proJob.run.cancel();
      proJob = null;
      if (proSub) proSub.dispose();
      cfgSub.dispose();
    });

    w.onDidReceiveMessage(async (raw) => {
      const m = parseFromWebview(raw);
      if (!m) return;
      if (m.type === 'ready') {
        try {
          const stat = isLocal ? await fs.promises.stat(uri.fsPath) : { size: (await vscode.workspace.fs.stat(uri)).size, mtimeMs: 0 };
          state.stat = stat;
          const ext = path.extname(name).toLowerCase();
          const t0 = Date.now();
          state.meta = isLocal && !media.REMUX_EXT.has(ext) && !media.TRANSCODE_EXT.has(ext) ? await probeFile(uri.fsPath, stat.size).catch((e) => ({ ok: false, error: String(e.message || e) })) : null;
          const probeMs = Date.now() - t0;
          state.plan = media.plan(ext, state.meta);
          const c = cfg();
          // Resume (position, speed, volume) and autoplay never apply in the e2e run, so it always starts at 0 and paused.
          let resume = null;
          if (c.remember && !e2e) {
            const pos = this.store.get(posKey); const vol = this.store.getVolume();
            if (pos || vol) resume = { t: pos ? pos.t : 0, rate: pos ? pos.rate : 1, volume: vol ? vol.volume : null, muted: vol ? vol.muted : false };
          }
          const videoSrc = state.plan.mode === 'remux' || state.plan.mode === 'transcode' ? null : w.asWebviewUri(uri).toString();
          // The Pro state rides on init; later changes come as 'pro' messages.
          post(toWebview.init({ name, size: stat.size, meta: state.meta, plan: state.plan, probeMs, src: videoSrc, e2e, resume, autoplay: !!c.autoplay && !e2e, pro: pro ? pro.view() : null }));
          if (isLocal) {
            const tracks = await findSidecars(uri.fsPath);
            if (tracks.length) post(toWebview.subtitles(tracks, { auto: !!c.autoSubs }));
          }
          if (state.plan.mode === 'native') post(toWebview.sound('native'));
          else if (state.plan.mode === 'video-only') post(toWebview.sound('none'));
          else if (state.plan.mode === 'unsupported') post(toWebview.sound('error', { text: state.plan.reason }));
          else await startSound(false);
        } catch (e) {
          post(toWebview.sound('error', { text: 'Could not open the file: ' + (e.message || e) }));
        }
      } else if (m.type === 'enableSound' || m.type === 'retrySound' || m.type === 'convertVideo') {
        if (state.plan) await startSound(true);
      } else if (m.type === 'playFailed') {
        rating.failure();
        // The player could not show the video (no decoder on this GPU, odd codec): convert once per tab.
        if (!state.plan) return;
        if (state.plan.mode === 'transcode') {
          if (state.converted) post(toWebview.sound('error', { mode: 'transcode', final: true, text: 'VS Code could not play this video, even after converting it to H.264.' }));
          return;
        }
        const next = media.fallbackPlan(state.plan, state.meta);
        if (!next) return;
        if (job) job.cancel();
        state.plan = next;
        post(toWebview.plan(next));
        await startSound(false);
      } else if (m.type === 'openExternal') {
        if (!isLocal) { post(toWebview.toast('Only files on this computer can open in another app.')); return; }
        try {
          const ok = await vscode.env.openExternal(uri);
          if (!ok) post(toWebview.toast('No default app opened this file.'));
        } catch (e) { post(toWebview.toast('Could not open the file: ' + (e.message || e))); }
      } else if (m.type === 'loadSubtitles') {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Load subtitles',
          defaultUri: isLocal ? vscode.Uri.file(path.dirname(uri.fsPath)) : undefined, filters: { Subtitles: ['srt', 'vtt'] } });
        const f = picked && picked[0];
        if (!f) return;
        if (f.scheme !== 'file') { post(toWebview.toast('Pick a subtitle file on local disk.')); return; }
        const t = await loadTrack(f.fsPath, null);
        if (t.error) post(toWebview.toast(t.error));
        else post(toWebview.subtitles([t], { add: true, auto: true }));
      } else if (m.type === 'remember') {
        if (!cfg().remember || e2e) return;
        await this.store.set(posKey, { t: m.t, rate: m.rate });
        if (m.volume != null) await this.store.setVolume(m.volume, m.muted);
      } else if (m.type === 'openSettings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'videoPreview');
      } else if (m.type === 'copyText') {
        await vscode.env.clipboard.writeText(m.text);
        post(toWebview.toast('Copied'));
      } else if (m.type === 'screenshot') {
        const png = pngFromDataUrl(m.dataUrl);
        if (!png) return;
        const dir = isLocal ? path.dirname(uri.fsPath) : (vscode.workspace.workspaceFolders || [])[0]?.uri.fsPath || '';
        const fname = shotName(name, m.time, state.meta && state.meta.ok ? (state.meta.tracks.find((t) => t.type === 'video') || {}).fps : 30);
        let target;
        if (process.env.VIDEO_PREVIEW_E2E) target = vscode.Uri.file(path.join(process.env.VIDEO_PREVIEW_E2E, fname));
        else target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(dir, fname)), filters: { 'PNG image': ['png'] } });
        if (!target) return;
        await vscode.workspace.fs.writeFile(target, png);
        post(toWebview.toast('Saved ' + path.basename(target.fsPath)));
      } else if (m.type === 'proAsk') {
        try { await proAsk(m); } catch (e) { proJob = null; post(toWebview.toast('Export failed: ' + (e.message || e))); }
      } else if (m.type === 'proCmd') {
        if (!pro) return;
        if (m.cmd === 'getPro') await pro.license.getPro();
        else if (m.cmd === 'unlock') await pro.license.unlock();
        else if (m.cmd === 'enterKey') await pro.license.unlock('license-key');
        postPro();
      } else if (m.type === 'proCancel') {
        if (proJob && proJob.run) proJob.run.cancel();
      } else if (m.type === 'proFrame') {
        const j = proJob;
        if (!j || j.id !== m.job || j.kind !== 'frames') return;
        const file = vscode.Uri.joinPath(j.dir, shotName(name, m.t, videoFps()));
        try { await vscode.workspace.fs.writeFile(file, m.data); j.written++; post({ type: 'proAck', job: j.id, index: m.index }); }
        catch (e) { post({ type: 'proAck', job: j.id, index: m.index, error: String(e.message || e) }); }
      } else if (m.type === 'proData') {
        const j = proJob;
        if (!j || j.id !== m.job || (j.kind !== 'gif' && j.kind !== 'png') || m.kind !== j.kind) return;
        // proEnd can arrive while this write runs; it waits for j.pending.
        j.pending = Promise.resolve(vscode.workspace.fs.writeFile(j.target, m.data)).then(() => { j.written = 1; j.bytes = m.data.length; });
        await j.pending.catch(() => {});
      } else if (m.type === 'proEnd') {
        const j = proJob;
        if (!j || j.id !== m.job || j.kind === 'mp4') return;
        let writeError = '';
        if (j.pending) await j.pending.catch((e) => { writeError = String(e.message || e); });
        const label = { clip: 'Clip export', frames: 'Frame export', sheet: 'Contact sheet' }[j.feature];
        if (writeError) await proFinished(j, false, `${label} failed: ${writeError}. No free try was used.`);
        else if (m.ok && j.written) {
          const text = j.kind === 'frames' ? `Saved ${j.written} PNG ${j.written === 1 ? 'file' : 'files'} in ${where(j.dir)}${m.capped ? ' (the first 1,000)' : ''}` : `Saved ${path.basename(j.target.path)} (${(j.bytes / 1048576).toFixed(1)} MB)`;
          await proFinished(j, true, text);
        } else await proFinished(j, false, `${label} ${m.cancelled ? 'stopped' : 'failed' + (m.error ? ': ' + m.error : '')}. No free try was used.`);
      } else if (m.type === 'stats' && process.env.VIDEO_PREVIEW_E2E) {
        fs.writeFileSync(path.join(process.env.VIDEO_PREVIEW_E2E, 'stats.json'), JSON.stringify(m.stats, null, 1));
      }
    });
  }
}

function activate(ctx) {
  registerSupport({ vscode, context: ctx, prefix: 'videoPreview', selfId: 'zovo.video-preview-with-sound' });
  // Zovo Pro (clip export, frame export, contact sheet). Reads local caches only: no network on start.
  pro = createPro({ vscode, context: ctx });
  if (vscode.window.registerUriHandler) ctx.subscriptions.push(vscode.window.registerUriHandler({ handleUri: (u) => pro.handleUri(u) }));
  rating = createRatingPrompt({ vscode, context: ctx, extensionId: 'zovo.video-preview-with-sound', section: 'videoPreview', name: 'MP4, MOV & MKV Viewer' });
  const provider = new Provider(ctx);
  ctx.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, { webviewOptions: { retainContextWhenHidden: false }, supportsMultipleEditorsPerDocument: true }),
    vscode.commands.registerCommand('videoPreview.openWith', async (uri) => {
      const target = uri || vscode.window.activeTextEditor?.document.uri;
      if (target) await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
    }),
    vscode.commands.registerCommand('videoPreview.clearCache', async () => {
      const dir = path.join(ctx.globalStorageUri.fsPath, 'cache');
      const removed = decoder.pruneCache(dir, 0);
      vscode.window.showInformationMessage(`Video Preview: removed ${removed.length} cached sound and video file(s).`);
    }),
    vscode.commands.registerCommand('videoPreview.openWalkthrough', () =>
      vscode.commands.executeCommand('workbench.action.openWalkthrough', 'zovo.video-preview-with-sound#videoPreview.start', false)),
  );
}

function deactivate() {}

module.exports = { activate, deactivate, Provider };
