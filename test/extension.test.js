'use strict';
// Drives the real Provider with a fake vscode module and the fixture files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { fx, hasFfmpeg } = require('./helpers');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-ext-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const settings = { soundHelper: 'auto', ffmpegPath: '', maxDecodeSizeMB: 4096, cacheSizeMB: 100, helperTimeoutSeconds: 60, decodeSoundAutomatically: true };
const state = { trusted: true, clipboard: '', written: [], saveTarget: null };
const Uri = {
  file: (p) => ({ scheme: 'file', fsPath: p, path: p, toString: () => 'file://' + p }),
  joinPath: (u, ...parts) => Uri.file(path.join(u.fsPath, ...parts)),
};
const vscodeMock = {
  Uri,
  workspace: {
    getConfiguration: () => ({ get: (k, d) => (k in settings ? settings[k] : d) }),
    get isTrusted() { return state.trusted; },
    fs: { writeFile: async (u, b) => { state.written.push([u.fsPath, b]); } },
    workspaceFolders: [],
  },
  window: { registerCustomEditorProvider: () => ({ dispose() {} }), showSaveDialog: async () => state.saveTarget, showInformationMessage: () => {} },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => {} },
  env: { clipboard: { writeText: async (t) => { state.clipboard = t; } } },
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'vscode' ? 'vscode' : origResolve.call(this, req, ...rest); };
require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscodeMock };
const { Provider } = require('../src/extension');

function open(file) {
  const sent = []; let handler; let disposed;
  const panel = {
    webview: { options: null, html: '', cspSource: 'https://res', asWebviewUri: (u) => ({ toString: () => 'https://res' + u.fsPath }),
      postMessage: (m) => { sent.push(m); return Promise.resolve(true); }, onDidReceiveMessage: (h) => { handler = h; } },
    onDidDispose: (h) => { disposed = h; },
  };
  const ctx = { extensionUri: Uri.file('/ext'), globalStorageUri: Uri.file(tmp), subscriptions: [] };
  const p = new Provider(ctx);
  const done = p.resolveCustomEditor({ uri: Uri.file(file) }, panel);
  return { sent, panel, send: (m) => handler(m), done, dispose: () => disposed && disposed() };
}
const waitFor = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = fn(); if (r) return r; await new Promise((z) => setTimeout(z, 20)); } throw new Error('timeout'); };

test('HTML and resource roots', async () => {
  const v = open(fx('h264-mp3.mp4')); await v.done;
  assert.match(v.panel.webview.html, /Content-Security-Policy/);
  const roots = v.panel.webview.options.localResourceRoots.map((u) => u.fsPath);
  assert.ok(roots.includes(path.dirname(fx('h264-mp3.mp4'))));
  assert.ok(roots.includes(path.join(tmp, 'cache')));
});

test('MP3 in MP4: init then native sound, no helper', async () => {
  const v = open(fx('h264-mp3.mp4')); await v.done;
  await v.send({ type: 'ready' });
  assert.strictEqual(v.sent[0].type, 'init');
  assert.strictEqual(v.sent[0].plan.mode, 'native');
  assert.ok(v.sent[0].src.endsWith('h264-mp3.mp4'));
  assert.deepStrictEqual(v.sent[1], { type: 'sound', state: 'native' });
});

test('no audio track', async () => {
  const v = open(fx('no-audio.mp4')); await v.done; await v.send({ type: 'ready' });
  assert.strictEqual(v.sent[1].state, 'none');
});

test('untrusted workspace: AAC waits for a click', async () => {
  state.trusted = false;
  try {
    const v = open(fx('clip-aac.mov')); await v.done; await v.send({ type: 'ready' });
    assert.strictEqual(v.sent[1].state, 'needs-trust');
  } finally { state.trusted = true; }
});

test('file over the size limit plays without a helper and says why', async () => {
  settings.maxDecodeSizeMB = 0.01;
  try {
    const v = open(fx('clip-aac.mov')); await v.done; await v.send({ type: 'ready' });
    assert.strictEqual(v.sent[1].state, 'too-big');
    assert.match(v.sent[1].text, /maxDecodeSizeMB/);
  } finally { settings.maxDecodeSizeMB = 4096; }
});

test('helper off: says to install ffmpeg', async () => {
  settings.soundHelper = 'off';
  try {
    const v = open(fx('clip-h264-aac.mkv')); await v.done; await v.send({ type: 'ready' });
    assert.strictEqual(v.sent[0].src, null);
    assert.strictEqual(v.sent[1].state, 'needs-helper');
    assert.match(v.sent[1].text, /ffmpeg/);
  } finally { settings.soundHelper = 'auto'; }
});

test('AAC: decoding, then ready with a FLAC in the cache; second open is cached', { skip: !hasFfmpeg() && process.platform !== 'darwin' && 'no helper' }, async () => {
  const v = open(fx('clip-aac.mov')); await v.done; await v.send({ type: 'ready' });
  assert.strictEqual(v.sent[0].plan.mode, 'decode-audio');
  const ready = await waitFor(() => v.sent.find((m) => m.type === 'sound' && m.state === 'ready'));
  assert.ok(v.sent.some((m) => m.state === 'decoding'));
  assert.ok(ready.src.endsWith('.flac'));
  const file = ready.src.replace('https://res', '');
  assert.strictEqual(fs.readFileSync(file).subarray(0, 4).toString(), 'fLaC');
  const v2 = open(fx('clip-aac.mov')); await v2.done; await v2.send({ type: 'ready' });
  assert.strictEqual(v2.sent[1].cached, true);
});

test('MKV: remuxed MP4 is sent as the new media source', { skip: !hasFfmpeg() && 'ffmpeg not on PATH' }, async () => {
  const v = open(fx('clip-h264-aac.mkv')); await v.done; await v.send({ type: 'ready' });
  const media = await waitFor(() => v.sent.find((m) => m.type === 'media'));
  assert.ok(media.src.endsWith('.mp4'));
  const ready = v.sent.find((m) => m.state === 'ready');
  assert.strictEqual(ready.src, null);
  assert.strictEqual(ready.mode, 'remux');
});

test('screenshot: PNG saved where the dialog says; junk ignored', async () => {
  const v = open(fx('h264-mp3.mp4')); await v.done; await v.send({ type: 'ready' });
  state.saveTarget = Uri.file(path.join(tmp, 'f.png'));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  await v.send({ type: 'screenshot', dataUrl: 'data:image/png;base64,' + png.toString('base64'), time: 1 });
  assert.strictEqual(state.written.length, 1);
  assert.deepStrictEqual(state.written[0][1], png);
  await v.send({ type: 'screenshot', dataUrl: 'data:image/png;base64,' + Buffer.from('notpng!!!').toString('base64'), time: 1 });
  await v.send({ type: 'unknown' });
  assert.strictEqual(state.written.length, 1);
  await v.send({ type: 'copyText', text: 'Size: 1 MB' });
  assert.strictEqual(state.clipboard, 'Size: 1 MB');
});

test('closing the editor stops a running helper', { skip: !hasFfmpeg() && 'ffmpeg not on PATH' }, async () => {
  fs.rmSync(path.join(tmp, 'cache'), { recursive: true, force: true });
  const v = open(fx('demo-h264-aac.mp4')); await v.done;
  const p = v.send({ type: 'ready' });
  await waitFor(() => v.sent.find((m) => m.state === 'decoding'));
  v.dispose();
  await p;
  const last = v.sent[v.sent.length - 1];
  assert.ok(last.state === 'error' || last.state === 'ready');
  assert.deepStrictEqual(fs.readdirSync(path.join(tmp, 'cache')).filter((n) => n.includes('.part')), []);
});

// ---------- support links (Sponsor, More free viewers) ----------
test('support: package.json has the sponsor field, the two commands and the setting', () => {
  const pkg = require('../package.json');
  const support = require('../src/support');
  assert.strictEqual(pkg.sponsor.url, 'https://github.com/sponsors/theluckystrike');
  assert.strictEqual(pkg.sponsor.url, support.sponsorUrl());
  const ids = pkg.contributes.commands.map((c) => c.command);
  assert.ok(ids.includes('videoPreview.supportDeveloper') && ids.includes('videoPreview.moreViewers'));
  const props = Object.assign({}, ...[].concat(pkg.contributes.configuration).map((c) => c.properties));
  assert.strictEqual(props['videoPreview.showSupportLinks'].default, true);
  assert.ok(support.otherProducts('zovo.video-preview-with-sound').every((x) => x.id !== 'zovo.video-preview-with-sound'));
});

test('support: the footer shows by default and videoPreview.showSupportLinks=false hides it', async () => {
  try {
    for (const [value, shown] of [[undefined, true], [false, false]]) {
      if (value === undefined) delete settings.showSupportLinks; else settings.showSupportLinks = value;
      const v = open(fx('h264-mp3.mp4')); await v.done;
      const html = v.panel.webview.html;
      assert.strictEqual(/id="zovo-support"/.test(html), shown, String(value));
      assert.strictEqual(html.includes('command:videoPreview.supportDeveloper'), shown);
      assert.deepStrictEqual(v.panel.webview.options.enableCommandUris, ['videoPreview.supportDeveloper', 'videoPreview.moreViewers', 'workbench.action.openSettings']);
      v.dispose();
    }
  } finally { delete settings.showSupportLinks; }
});
