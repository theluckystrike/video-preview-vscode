'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { buildHtml } = require('./html');
const media = require('./core/media');
const decoder = require('./core/decoder');
const { parseFromWebview, pngFromDataUrl, toWebview } = require('./core/protocol');
const { shotName } = require('./core/sync');

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

class Provider {
  constructor(ctx) { this.ctx = ctx; this.jobs = new Map(); }

  openCustomDocument(uri) { return { uri, dispose: () => {} }; }

  async resolveCustomEditor(doc, panel) {
    const uri = doc.uri;
    const cacheDir = path.join(this.ctx.globalStorageUri.fsPath, 'cache');
    const isLocal = uri.scheme === 'file';
    const roots = [vscode.Uri.joinPath(this.ctx.extensionUri, 'dist'), vscode.Uri.joinPath(this.ctx.extensionUri, 'media'), vscode.Uri.file(cacheDir)];
    roots.push(isLocal ? vscode.Uri.file(path.dirname(uri.fsPath)) : vscode.Uri.joinPath(uri, '..'));
    panel.webview.options = { enableScripts: true, localResourceRoots: roots };
    const w = panel.webview;
    const name = path.basename(uri.path);
    w.html = buildHtml({
      cspSource: w.cspSource,
      scriptUri: w.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview.js')).toString(),
      styleUri: w.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'player.css')).toString(),
      title: name,
    });

    let job = null;
    const post = (m) => { w.postMessage(m).then(undefined, () => {}); };
    const state = { meta: null, plan: null, stat: null };

    const startSound = async (userAsked) => {
      if (!isLocal) { post(toWebview.sound('off', { text: 'Sound decoding needs a file on local disk.' })); return; }
      const c = cfg();
      const p = state.plan;
      const needFfmpeg = p.mode === 'remux';
      if (!vscode.workspace.isTrusted && !userAsked) { post(toWebview.sound('needs-trust', { text: 'This workspace is not trusted, so no helper runs by itself.' })); return; }
      if (!c.autoSound && !userAsked) { post(toWebview.sound('needs-trust', { text: 'Automatic sound decoding is off.' })); return; }
      if (state.stat.size > c.maxDecodeMB * 1048576) {
        post(toWebview.sound('too-big', { text: `This file is ${(state.stat.size / 1048576).toFixed(0)} MB. Sound decoding stops at ${c.maxDecodeMB} MB (setting videoPreview.maxDecodeSizeMB).` }));
        return;
      }
      const helper = decoder.findHelper({ setting: c.ffmpegPath, preferred: c.helper, needFfmpeg });
      if (!helper) {
        post(toWebview.sound('needs-helper', { mode: p.mode, text: needFfmpeg ? 'Install ffmpeg to open this file. VS Code cannot read ' + path.extname(name) + ' by itself.' : 'Install ffmpeg to hear this file. VS Code has no ' + media.codecName(p.audioCodec) + ' decoder.' }));
        return;
      }
      fs.mkdirSync(cacheDir, { recursive: true });
      const key = decoder.cacheKey(uri.fsPath, state.stat, helper.tool, p.mode);
      const out = path.join(cacheDir, key + (p.mode === 'remux' ? '.mp4' : '.flac'));
      const done = (file, ms, cached) => {
        try { const now = new Date(); fs.utimesSync(file, now, now); } catch { /* ignore */ }
        const src = w.asWebviewUri(vscode.Uri.file(file)).toString();
        if (p.mode === 'remux') post(toWebview.media(src));
        post(toWebview.sound('ready', { src: p.mode === 'remux' ? null : src, tool: helper.tool, ms, cached, mode: p.mode }));
      };
      if (fs.existsSync(out)) { done(out, 0, true); return; }
      post(toWebview.sound('decoding', { tool: helper.tool, progress: null, mode: p.mode }));
      const duration = state.meta && state.meta.ok ? state.meta.duration : 0;
      job = decoder.run({ helper, input: uri.fsPath, output: out, mode: p.mode, duration, timeoutMs: c.timeoutSec * 1000,
        onProgress: (f) => post(toWebview.sound('decoding', { tool: helper.tool, progress: f, mode: p.mode })) });
      const r = await job.promise;
      job = null;
      if (r.ok) { done(out, r.ms, false); decoder.pruneCache(cacheDir, c.cacheMB * 1048576, new Set([out])); }
      else post(toWebview.sound('error', { tool: helper.tool, mode: p.mode, text: helper.tool + ' could not read this file: ' + r.error }));
    };

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
          state.meta = isLocal && !media.REMUX_EXT.has(ext) ? await probeFile(uri.fsPath, stat.size).catch((e) => ({ ok: false, error: String(e.message || e) })) : null;
          const probeMs = Date.now() - t0;
          state.plan = media.plan(ext, state.meta);
          post(toWebview.init({ name, size: stat.size, meta: state.meta, plan: state.plan, probeMs,
            src: state.plan.mode === 'remux' ? null : w.asWebviewUri(uri).toString(), e2e: !!process.env.VIDEO_PREVIEW_E2E }));
          if (state.plan.mode === 'native') post(toWebview.sound('native'));
          else if (state.plan.mode === 'video-only') post(toWebview.sound('none'));
          else if (state.plan.mode === 'unsupported') post(toWebview.sound('error', { text: state.plan.reason }));
          else await startSound(false);
        } catch (e) {
          post(toWebview.sound('error', { text: 'Could not open the file: ' + (e.message || e) }));
        }
      } else if (m.type === 'enableSound' || m.type === 'retrySound') {
        if (state.plan) await startSound(true);
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
      vscode.window.showInformationMessage(`Video Preview: removed ${removed.length} cached sound file(s).`);
    }),
    vscode.commands.registerCommand('videoPreview.openWalkthrough', () =>
      vscode.commands.executeCommand('workbench.action.openWalkthrough', 'zovo.video-preview-with-sound#videoPreview.start', false)),
  );
}

function deactivate() {}

module.exports = { activate, deactivate, Provider };
