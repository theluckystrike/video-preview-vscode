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
const state = { trusted: true, clipboard: '', written: [], saveTarget: null, opened: [], openPick: null };
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
  window: { registerCustomEditorProvider: () => ({ dispose() {} }), showSaveDialog: async () => state.saveTarget, showOpenDialog: async () => state.openPick, showInformationMessage: () => {} },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => {} },
  env: { clipboard: { writeText: async (t) => { state.clipboard = t; } }, openExternal: async (u) => { state.opened.push(u.fsPath); return true; } },
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'vscode' ? 'vscode' : origResolve.call(this, req, ...rest); };
require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscodeMock };
const { Provider } = require('../src/extension');

function open(file, globalState) {
  const sent = []; let handler; let disposed;
  const panel = {
    webview: { options: null, html: '', cspSource: 'https://res', asWebviewUri: (u) => ({ toString: () => 'https://res' + u.fsPath }),
      postMessage: (m) => { sent.push(m); return Promise.resolve(true); }, onDidReceiveMessage: (h) => { handler = h; } },
    onDidDispose: (h) => { disposed = h; },
  };
  const ctx = { extensionUri: Uri.file('/ext'), globalStorageUri: Uri.file(tmp), subscriptions: [], globalState };
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

// ---------- convert (transcode) ----------
const sound = (v, state) => v.sent.find((m) => m.type === 'sound' && m.state === state);

test('ProRes MOV: plan transcode, no direct source, converted H.264 MP4 sent as media', { skip: !hasFfmpeg() && 'ffmpeg not on PATH' }, async () => {
  const v = open(fx('clip-prores422-aac.mov')); await v.done; await v.send({ type: 'ready' });
  assert.strictEqual(v.sent[0].plan.mode, 'transcode');
  assert.strictEqual(v.sent[0].src, null);
  const media = await waitFor(() => v.sent.find((m) => m.type === 'media'));
  const ready = sound(v, 'ready');
  assert.strictEqual(ready.mode, 'transcode');
  assert.ok(['libx264', 'h264_videotoolbox'].includes(ready.encoder));
  const file = media.src.replace('https://res', '');
  assert.ok(file.endsWith('.mp4') && file.startsWith(path.join(tmp, 'cache')));
  assert.ok(fs.readFileSync(file).includes('avc1'));
  assert.ok(v.sent.some((m) => m.state === 'decoding' && m.mode === 'transcode'));
  const v2 = open(fx('clip-prores422-aac.mov')); await v2.done; await v2.send({ type: 'ready' });
  assert.strictEqual(sound(v2, 'ready').cached, true);
});

test('AVI: no ffmpeg gives a stage message with the next step, never a blank page', async () => {
  settings.soundHelper = 'ffmpeg'; settings.ffmpegPath = '/nonexistent/ffmpeg';
  try {
    const v = open(fx('clip-mpeg4-mp3.avi')); await v.done; await v.send({ type: 'ready' });
    assert.strictEqual(v.sent[0].plan.mode, 'transcode');
    assert.strictEqual(sound(v, 'needs-helper').text, 'VS Code cannot play .avi files. Install ffmpeg to convert it for playback.');
    const p = open(fx('clip-prores422-aac.mov')); await p.done; await p.send({ type: 'ready' });
    assert.strictEqual(sound(p, 'needs-helper').text, 'This video uses Apple ProRes 422, which VS Code cannot play. Install ffmpeg to convert it for playback.');
    await p.send({ type: 'openExternal' });
    assert.deepStrictEqual(state.opened, [fx('clip-prores422-aac.mov')]);
  } finally { settings.soundHelper = 'auto'; settings.ffmpegPath = ''; state.opened = []; }
});

test('helper turned off: the message names the setting, not a missing ffmpeg', async () => {
  settings.soundHelper = 'off';
  try {
    const p = open(fx('clip-prores422-aac.mov')); await p.done; await p.send({ type: 'ready' });
    const m = sound(p, 'needs-helper');
    assert.strictEqual(m.off, true);
    assert.strictEqual(m.text, 'This video uses Apple ProRes 422, which VS Code cannot play. The helper is turned off (setting videoPreview.soundHelper is "off"), so ffmpeg does not run.');
  } finally { settings.soundHelper = 'auto'; }
});

test('convert: untrusted workspace and convertUnsupportedVideo=false wait for a click', async () => {
  state.trusted = false;
  try {
    const v = open(fx('clip-mpeg4-mp3.avi')); await v.done; await v.send({ type: 'ready' });
    assert.match(sound(v, 'needs-trust').text, /not trusted, so ffmpeg does not start by itself/);
    assert.ok(!v.sent.some((m) => m.state === 'decoding'));
  } finally { state.trusted = true; }
  settings.convertUnsupportedVideo = false;
  try {
    const v = open(fx('clip-mpeg4-mp3.avi')); await v.done; await v.send({ type: 'ready' });
    assert.match(sound(v, 'needs-trust').text, /Automatic conversion is off/);
    if (hasFfmpeg()) {
      await v.send({ type: 'convertVideo' });
      assert.strictEqual(sound(v, 'ready').mode, 'transcode');
    }
  } finally { delete settings.convertUnsupportedVideo; }
});

test('convert: file over maxDecodeSizeMB says so', async () => {
  settings.maxDecodeSizeMB = 0.01;
  try {
    const v = open(fx('clip-mpeg4-mp3.avi')); await v.done; await v.send({ type: 'ready' });
    assert.match(sound(v, 'too-big').text, /Conversion stops at 0.01 MB/);
  } finally { settings.maxDecodeSizeMB = 4096; }
});

test('playFailed: one runtime conversion per tab, then a final message if even that fails', { skip: !hasFfmpeg() && 'ffmpeg not on PATH' }, async () => {
  const v = open(fx('no-audio.mp4')); await v.done; await v.send({ type: 'ready' });
  assert.strictEqual(v.sent[0].plan.mode, 'video-only');
  await v.send({ type: 'playFailed', code: 4 });
  const planMsg = v.sent.find((m) => m.type === 'plan');
  assert.strictEqual(planMsg.plan.mode, 'transcode');
  assert.match(planMsg.plan.reason, /could not decode the H\.264 video on this computer/);
  assert.strictEqual(sound(v, 'ready').mode, 'transcode');
  const n = v.sent.length;
  await v.send({ type: 'playFailed', code: 4 });
  assert.strictEqual(v.sent.length, n + 1);
  assert.strictEqual(v.sent[n].final, true);
  assert.strictEqual(v.sent.filter((m) => m.type === 'media').length, 1);
});

// ---------- subtitles ----------
test('subtitles: sidecars next to the video are sent after init; Load subtitles adds a picked file', async () => {
  const v = open(fx('demo-h264-aac.mp4')); await v.done;
  settings.soundHelper = 'off';
  try { await v.send({ type: 'ready' }); } finally { settings.soundHelper = 'auto'; }
  const subs = v.sent.find((m) => m.type === 'subtitles');
  assert.deepStrictEqual(subs.tracks.map((t) => t.label), ['Subtitles (SRT)', 'pt-BR']);
  assert.strictEqual(subs.auto, true);
  assert.strictEqual(subs.tracks[0].cues[0].text, 'Subtitles load by themselves\nfrom demo-h264-aac.srt');
  state.openPick = [Uri.file(fx('demo-h264-aac.pt-BR.vtt'))];
  await v.send({ type: 'loadSubtitles' });
  const added = v.sent.filter((m) => m.type === 'subtitles')[1];
  assert.strictEqual(added.add, true);
  assert.strictEqual(added.tracks[0].label, 'demo-h264-aac.pt-BR.vtt');
  state.openPick = [Uri.file(fx('h264-mp3.mp4'))];
  await v.send({ type: 'loadSubtitles' });
  assert.match(v.sent[v.sent.length - 1].text, /No subtitles found/);
  state.openPick = null;
  settings['subtitles.autoLoad'] = false;
  try {
    const v2 = open(fx('demo-h264-aac.mp4')); await v2.done; settings.soundHelper = 'off'; await v2.send({ type: 'ready' });
    assert.strictEqual(v2.sent.find((m) => m.type === 'subtitles').auto, false);
  } finally { delete settings['subtitles.autoLoad']; settings.soundHelper = 'auto'; }
  const none = open(fx('h264-mp3.mp4')); await none.done; await none.send({ type: 'ready' });
  assert.ok(!none.sent.some((m) => m.type === 'subtitles'));
});

// ---------- remember position, autoplay ----------
test('remember: position saved per file and sent back on the next open; off and e2e send nothing', async () => {
  const mem = new Map(); const gs = { get: (k, d) => (mem.has(k) ? mem.get(k) : d), update: async (k, val) => { mem.set(k, val); } };
  const v = open(fx('h264-mp3.mp4'), gs); await v.done; await v.send({ type: 'ready' });
  assert.strictEqual(v.sent[0].resume, null);
  await v.send({ type: 'remember', t: 83, rate: 1.5, volume: 0.3, muted: false });
  const v2 = open(fx('h264-mp3.mp4'), gs); await v2.done; await v2.send({ type: 'ready' });
  assert.deepStrictEqual(v2.sent[0].resume, { t: 83, rate: 1.5, volume: 0.3, muted: false });
  const other = open(fx('no-audio.mp4'), gs); await other.done; await other.send({ type: 'ready' });
  assert.deepStrictEqual(other.sent[0].resume, { t: 0, rate: 1, volume: 0.3, muted: false });
  settings.rememberPosition = false;
  try {
    const v3 = open(fx('h264-mp3.mp4'), gs); await v3.done; await v3.send({ type: 'ready' });
    assert.strictEqual(v3.sent[0].resume, null);
  } finally { delete settings.rememberPosition; }
  process.env.VIDEO_PREVIEW_E2E = tmp;
  try {
    const v4 = open(fx('h264-mp3.mp4'), gs); await v4.done; await v4.send({ type: 'ready' });
    assert.strictEqual(v4.sent[0].resume, null);
    assert.strictEqual(v4.sent[0].e2e, true);
  } finally { delete process.env.VIDEO_PREVIEW_E2E; }
});

test('autoplay: off by default, on with the setting, never in the e2e run', async () => {
  const v = open(fx('h264-mp3.mp4')); await v.done; await v.send({ type: 'ready' });
  assert.strictEqual(v.sent[0].autoplay, false);
  settings.autoplay = true;
  try {
    const v2 = open(fx('h264-mp3.mp4')); await v2.done; await v2.send({ type: 'ready' });
    assert.strictEqual(v2.sent[0].autoplay, true);
    process.env.VIDEO_PREVIEW_E2E = tmp;
    try {
      const v3 = open(fx('h264-mp3.mp4')); await v3.done; await v3.send({ type: 'ready' });
      assert.strictEqual(v3.sent[0].autoplay, false);
    } finally { delete process.env.VIDEO_PREVIEW_E2E; }
  } finally { delete settings.autoplay; }
});

test('package.json: the new settings exist with their defaults', () => {
  const props = require('../package.json').contributes.configuration.properties;
  assert.strictEqual(props['videoPreview.convertUnsupportedVideo'].default, true);
  assert.strictEqual(props['videoPreview.subtitles.autoLoad'].default, true);
  assert.strictEqual(props['videoPreview.rememberPosition'].default, true);
  assert.strictEqual(props['videoPreview.autoplay'].default, false);
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

test('empty file: a clear final message, ffmpeg never starts', async () => {
  const f = path.join(tmp, 'empty.mp4'); fs.writeFileSync(f, '');
  const v = open(f); await v.done; await v.send({ type: 'ready' });
  const m = await waitFor(() => v.sent.find((x) => x.type === 'sound' && x.state === 'error'));
  assert.strictEqual(m.text, 'This file is empty (0 bytes), so there is no video to play.');
  assert.strictEqual(m.final, true);
  assert.ok(!v.sent.some((x) => x.state === 'decoding'));
});

test('not a video: the message says so instead of the raw ffmpeg output', { skip: !hasFfmpeg() && 'ffmpeg not on PATH' }, async () => {
  const v = open(fx('not-a-video.mp4')); await v.done; await v.send({ type: 'ready' });
  const m = await waitFor(() => v.sent.find((x) => x.type === 'sound' && x.state === 'error'));
  assert.match(m.text, /^This file does not look like a video\. VS Code cannot play it and ffmpeg cannot read it\./);
  assert.ok(!/\[in#0|Error opening input|\//.test(m.text), m.text);
  assert.strictEqual(m.final, true);
});
