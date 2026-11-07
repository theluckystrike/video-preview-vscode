'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { buildHtml } = require('./html');
const media = require('./core/media');
const decoder = require('./core/decoder');
const { parseFromWebview, pngFromDataUrl, toWebview } = require('./core/protocol');
const { shotName } = require('./core/sync');
const { findSidecars, loadTrack } = require('./core/sidecars');
const { createStore, resumeAt } = require('./core/resume');
const { createRatingPrompt } = require('./rate');
const { registerSupport, commandUris, showLinks } = require('./support');

let rating = { success() {} };

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
    const post = (m) => { w.postMessage(m).then(undefined, () => {}); };
    const state = { meta: null, plan: null, stat: null };
    let counted = false; // one success per opened tab, for the rating prompt

    let gen = 0; // bumped when a newer job replaces the running one, so the old result is dropped quietly
    const startSound = async (userAsked) => {
      const my = ++gen;
      const p = state.plan;
      const mode = p.mode;
      const tc = mode === 'transcode';
      if (!isLocal) { post(toWebview.sound('off', { mode, text: tc ? 'Converting the video needs a file on local disk.' : 'Sound decoding needs a file on local disk.' })); return; }
      const c = cfg();
      const needFfmpeg = mode === 'remux' || tc;
      const cannotPlay = p.videoCodec ? 'This video uses ' + media.codecName(p.videoCodec) + ', which VS Code cannot play.' : 'VS Code cannot play ' + path.extname(name).toLowerCase() + ' files.';
      if (!vscode.workspace.isTrusted && !userAsked) {
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
      const helper = decoder.findHelper({ setting: c.ffmpegPath, preferred: c.helper, needFfmpeg });
      if (!helper) {
        let text;
        if (c.helper === 'off') text = (tc ? cannotPlay + ' ' : '') + 'The helper is turned off (setting videoPreview.soundHelper is "off"), so ffmpeg does not run.';
        else if (tc) text = cannotPlay + ' Install ffmpeg to convert it for playback.';
        else if (mode === 'remux') text = 'Install ffmpeg to open this file. VS Code cannot read ' + path.extname(name) + ' by itself.';
        else text = 'Install ffmpeg to hear this file. VS Code has no ' + media.codecName(p.audioCodec) + ' decoder.';
        post(toWebview.sound('needs-helper', { mode, text, off: c.helper === 'off' }));
        return;
      }
      fs.mkdirSync(cacheDir, { recursive: true });
      const key = decoder.cacheKey(uri.fsPath, state.stat, helper.tool, mode);
      const isVideo = mode === 'remux' || tc;
      const out = path.join(cacheDir, key + (isVideo ? '.mp4' : '.flac'));
      const done = (file, ms, cached, encoder) => {
        try { const now = new Date(); fs.utimesSync(file, now, now); } catch { /* ignore */ }
        const src = w.asWebviewUri(vscode.Uri.file(file)).toString();
        if (tc) state.converted = true;
        if (isVideo) post(toWebview.media(src));
        post(toWebview.sound('ready', { src: isVideo ? null : src, tool: helper.tool, ms, cached, mode, encoder }));
      };
      if (fs.existsSync(out)) { done(out, 0, true); return; }
      post(toWebview.sound('decoding', { tool: helper.tool, progress: null, mode }));
      const duration = state.meta && state.meta.ok ? state.meta.duration : 0;
      const thisJob = decoder.run({ helper, input: uri.fsPath, output: out, mode, duration, timeoutMs: c.timeoutSec * 1000,
        onProgress: (f) => { if (my === gen) post(toWebview.sound('decoding', { tool: helper.tool, progress: f, mode })); } });
      job = thisJob;
      const r = await thisJob.promise;
      if (job === thisJob) job = null;
      if (my !== gen) return;
      if (r.ok) { done(out, r.ms, false, r.encoder); decoder.pruneCache(cacheDir, c.cacheMB * 1048576, new Set([out])); }
      else post(toWebview.sound('error', { tool: helper.tool, mode, text: helper.tool + (tc ? ' could not convert this video: ' : ' could not read this file: ') + r.error }));
    };

    const posKey = isLocal ? uri.fsPath : uri.toString();
    const e2e = !!process.env.VIDEO_PREVIEW_E2E;

    panel.onDidDispose(() => { if (job) job.cancel(); });

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
          post(toWebview.init({ name, size: stat.size, meta: state.meta, plan: state.plan, probeMs, src: videoSrc, e2e, resume, autoplay: !!c.autoplay && !e2e }));
          if (isLocal) {
            const tracks = await findSidecars(uri.fsPath);
            if (tracks.length) post(toWebview.subtitles(tracks, { auto: !!c.autoSubs }));
          }
          if (state.plan.mode !== 'unsupported' && !counted) { counted = true; rating.success(); }
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
      } else if (m.type === 'stats' && process.env.VIDEO_PREVIEW_E2E) {
        fs.writeFileSync(path.join(process.env.VIDEO_PREVIEW_E2E, 'stats.json'), JSON.stringify(m.stats, null, 1));
      }
    });
  }
}

function activate(ctx) {
  registerSupport({ vscode, context: ctx, prefix: 'videoPreview', selfId: 'zovo.video-preview-with-sound' });
  rating = createRatingPrompt({ vscode, context: ctx, extensionId: 'zovo.video-preview-with-sound', section: 'videoPreview', message: (n) => `Video Preview has opened ${n} files for you. A rating helps other people find it.` });
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
