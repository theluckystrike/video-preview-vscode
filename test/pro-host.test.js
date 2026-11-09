'use strict';
// Zovo Pro in the extension host (lane PRO4): Clip export, Frame export, Contact sheet, free tries and the modal.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { fx, hasFfmpeg } = require('./helpers');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-pro-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const settings = { soundHelper: 'auto', ffmpegPath: '', maxDecodeSizeMB: 4096, cacheSizeMB: 100, helperTimeoutSeconds: 60, decodeSoundAutomatically: true, rememberPosition: false };
const state = { saveTarget: null, openPick: null, pick: null, modal: undefined, infos: [], warnings: [], status: [] };
const Uri = {
  file: (p) => ({ scheme: 'file', fsPath: p, path: p, toString: () => 'file://' + p }),
  joinPath: (u, ...parts) => Uri.file(path.join(u.fsPath, ...parts)),
  parse: (s) => ({ toString: () => s }),
};
const vscodeMock = {
  Uri,
  workspace: {
    getConfiguration: () => ({ get: (k, d) => (k in settings ? settings[k] : d) }),
    isTrusted: true,
    fs: { writeFile: async (u, b) => { fs.writeFileSync(u.fsPath, b); } },
    workspaceFolders: [],
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  authentication: { getSession: async () => undefined },
  window: {
    state: { focused: true },
    registerCustomEditorProvider: () => ({ dispose() {} }),
    registerUriHandler: () => ({ dispose() {} }),
    showSaveDialog: async () => state.saveTarget,
    showOpenDialog: async () => state.openPick,
    showQuickPick: async (items) => (state.pick == null ? undefined : (await items)[state.pick]),
    showInformationMessage: async (...a) => { state.infos.push(a); return a[1] && a[1].modal ? state.modal : undefined; },
    showWarningMessage: async (...a) => { state.warnings.push(a); },
    setStatusBarMessage: (t) => { state.status.push(t); return { dispose() {} }; },
  },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => {} },
  env: { clipboard: { writeText: async () => {} }, openExternal: async () => true, uriScheme: 'vscode', appName: 'Visual Studio Code' },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'vscode' ? vscodeMock : origLoad.call(this, req, ...rest); };
const ext = require('../src/extension');

const secrets = () => { const m = new Map(); return { get: async (k) => m.get(k), store: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, onDidChange: () => ({ dispose() {} }) }; };
const memento = () => { const m = new Map(); return { data: m, get: (k, d) => (m.has(k) ? m.get(k) : d), update: async (k, v) => { m.set(k, v); }, setKeysForSync() {} }; };
function context() { return { extensionUri: Uri.file(path.join(__dirname, '..')), globalStorageUri: Uri.file(tmp), subscriptions: [], globalState: memento(), secrets: secrets() }; }
async function open(ctx, file = fx('demo-h264-aac.mp4')) {
  const sent = []; let handler; let disposed;
  const panel = {
    webview: { options: null, html: '', cspSource: 'https://res', asWebviewUri: (u) => ({ toString: () => 'https://res' + u.fsPath }),
      postMessage: (m) => { sent.push(m); return Promise.resolve(true); }, onDidReceiveMessage: (h) => { handler = h; } },
    onDidDispose: (h) => { disposed = h; },
  };
  await new ext.Provider(ctx).resolveCustomEditor({ uri: Uri.file(file) }, panel);
  await handler({ type: 'ready' });
  return { sent, send: (m) => handler(m), dispose: () => disposed && disposed(), last: (t) => sent.filter((m) => m.type === t).at(-1) };
}
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x70, 0, 0, 0x3b]);
const ASK = (feature, extra = {}) => ({ type: 'proAsk', feature, a: 1, b: 3, duration: 6, width: 1280, height: 720, ...extra });
const tries = (ctx) => ctx.globalState.get('videoPreview.proTrial') || {};

test('init carries the Pro state: shown, 3 free tries each, nothing else on open', async () => {
  const ctx = context(); ext.activate(ctx);
  state.infos.length = 0;
  const v = await open(ctx);
  const init = v.sent.find((m) => m.type === 'init');
  assert.strictEqual(init.pro.shown, true);
  assert.strictEqual(init.pro.pro, false);
  assert.deepStrictEqual(Object.values(init.pro.features).map((f) => f.label), ['Pro, 3 free tries', 'Pro, 3 free tries', 'Pro, 3 free tries']);
  assert.strictEqual(state.infos.length, 0);
});

test('Clip GIF: quick pick, save dialog, job sized from the video; the try is used when the file is saved', async () => {
  const ctx = context(); ext.activate(ctx);
  const v = await open(ctx);
  state.pick = null;
  await v.send(ASK('clip'));
  assert.strictEqual(v.last('proJob'), undefined, 'cancelled pick: nothing');
  state.pick = 1; state.saveTarget = Uri.file(path.join(tmp, 'a.gif'));
  await v.send(ASK('clip'));
  const j = v.last('proJob');
  assert.deepStrictEqual([j.feature, j.width, j.height, j.fps, j.start, j.end], ['clip', 640, 360, 15, 1, 3]);
  await Promise.all([v.send({ type: 'proData', job: j.job, data: GIF }), v.send({ type: 'proEnd', job: j.job, ok: true, count: 30 })]);
  assert.deepStrictEqual([...fs.readFileSync(path.join(tmp, 'a.gif'))], [...GIF]);
  assert.strictEqual(tries(ctx).clip, 1);
  assert.match(v.last('toast').text, /^Saved a\.gif/);
  assert.match(state.status.at(-1), /2 left on this computer/);
  assert.strictEqual(v.last('pro').features.clip.label, 'Pro, 2 free tries');
});

test('a stopped or failed export uses no try; a PNG for a GIF job is ignored', async () => {
  const ctx = context(); ext.activate(ctx);
  const v = await open(ctx);
  state.pick = 0; state.saveTarget = Uri.file(path.join(tmp, 'b.gif'));
  await v.send(ASK('clip'));
  let j = v.last('proJob');
  await v.send({ type: 'proEnd', job: j.job, ok: false, cancelled: true });
  assert.match(v.last('toast').text, /stopped\. No free try was used/);
  await v.send(ASK('clip'));
  j = v.last('proJob');
  await v.send({ type: 'proData', job: j.job, data: PNG });
  await v.send({ type: 'proEnd', job: j.job, ok: true, count: 1 });
  assert.strictEqual(fs.existsSync(path.join(tmp, 'b.gif')), false);
  assert.strictEqual(tries(ctx).clip, undefined);
});

test('Frames: folder pick, each PNG named by time and frame, acknowledged; try used at the end', async () => {
  const ctx = context(); ext.activate(ctx);
  const v = await open(ctx);
  const dir = path.join(tmp, 'frames'); fs.mkdirSync(dir);
  state.pick = 4; state.openPick = [Uri.file(dir)];
  await v.send(ASK('frames'));
  const j = v.last('proJob');
  assert.deepStrictEqual([j.feature, j.mode, j.start, j.end], ['frames', 'even10', 1, 3]);
  await v.send({ type: 'proFrame', job: j.job, index: 0, t: 30.25 / 30, data: PNG });
  await v.send({ type: 'proFrame', job: j.job, index: 1, t: 2.5, data: PNG });
  assert.deepStrictEqual(v.sent.filter((m) => m.type === 'proAck').map((m) => m.index), [0, 1]);
  await v.send({ type: 'proEnd', job: j.job, ok: true, count: 2 });
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['demo-h264-aac-00m01s008-f30.png', 'demo-h264-aac-00m02s500-f75.png']);
  assert.strictEqual(tries(ctx).frames, 1);
  assert.match(v.last('toast').text, /Saved 2 PNG files/);
});

test('Contact sheet: after 3 saved sheets the 4th click shows one modal, no job', async () => {
  const ctx = context(); ext.activate(ctx);
  const v = await open(ctx);
  for (let i = 0; i < 3; i++) {
    state.pick = 0; state.saveTarget = Uri.file(path.join(tmp, `s${i}.png`));
    await v.send(ASK('sheet'));
    const j = v.last('proJob');
    assert.deepStrictEqual([j.cols, j.rows], [4, 4]);
    await v.send({ type: 'proData', job: j.job, data: PNG });
    await v.send({ type: 'proEnd', job: j.job, ok: true, count: 16 });
  }
  assert.strictEqual(tries(ctx).sheet, 3);
  const jobs = v.sent.filter((m) => m.type === 'proJob').length;
  state.infos.length = 0; state.modal = undefined;
  await v.send(ASK('sheet'));
  assert.strictEqual(v.sent.filter((m) => m.type === 'proJob').length, jobs);
  const modal = state.infos.find((a) => a[1] && a[1].modal);
  assert.match(modal[0], /Contact sheet is part of Zovo Pro/);
  assert.match(modal[1].detail, /USD 19 once/);
  assert.ok(modal.includes('Get Zovo Pro'));
});

test('the video itself is never overwritten; a wrong extension is refused', async () => {
  const ctx = context(); ext.activate(ctx);
  const src = path.join(tmp, 'keep.mp4'); fs.copyFileSync(fx('demo-h264-aac.mp4'), src);
  const size = fs.statSync(src).size;
  const v = await open(ctx, src);
  state.pick = 0; state.saveTarget = Uri.file(src);
  await v.send(ASK('sheet'));
  assert.strictEqual(v.last('proJob'), undefined);
  state.saveTarget = Uri.file(path.join(tmp, 'x.txt'));
  await v.send(ASK('sheet'));
  assert.strictEqual(v.last('proJob'), undefined);
  assert.match(v.last('toast').text, /never overwritten/);
  assert.strictEqual(fs.statSync(src).size, size);
});

test('MP4 without ffmpeg: a clear message, no try used', async () => {
  const ctx = context(); ext.activate(ctx);
  settings.ffmpegPath = path.join(tmp, 'no-such-ffmpeg');
  try {
    const v = await open(ctx);
    state.pick = 3; state.warnings.length = 0;
    await v.send(ASK('clip'));
    assert.match(state.warnings.at(-1)[0], /MP4 export needs ffmpeg/);
    assert.strictEqual(tries(ctx).clip, undefined);
  } finally { settings.ffmpegPath = ''; }
});

test('MP4 exact cut with the real ffmpeg: saved, try used', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, async () => {
  const ctx = context(); ext.activate(ctx);
  const v = await open(ctx);
  state.pick = 3; state.saveTarget = Uri.file(path.join(tmp, 'cut.mp4'));
  await v.send(ASK('clip'));
  assert.ok(fs.statSync(path.join(tmp, 'cut.mp4')).size > 1000);
  assert.strictEqual(tries(ctx).clip, 1);
  assert.match(v.last('toast').text, /^Saved cut\.mp4 .*libx264|^Saved cut\.mp4/);
  assert.strictEqual(v.last('proProgress').running, false);
});

test('no network on activation, open, ask and save', async () => {
  const orig = global.fetch; let calls = 0;
  global.fetch = async () => { calls++; throw new Error('no network'); };
  try {
    const ctx = context(); ext.activate(ctx);
    const v = await open(ctx);
    state.pick = 0; state.saveTarget = Uri.file(path.join(tmp, 'n.png'));
    await v.send(ASK('sheet'));
    const j = v.last('proJob');
    await v.send({ type: 'proData', job: j.job, data: PNG });
    await v.send({ type: 'proEnd', job: j.job, ok: true });
    assert.strictEqual(calls, 0);
  } finally { global.fetch = orig; }
});
