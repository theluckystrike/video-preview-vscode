// Dev-only end-to-end check in a real VS Code: opens a video with this extension, clicks Play,
// measures the sound level inside the webview and saves a screenshot of the window.
// usage: node scripts/e2e-vscode.mjs <workDir> <video> <soundHelper> <port> [shot.png] [keys]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [work, video, helper, port, shot, keys = ''] = process.argv.slice(2);
const ext = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ud = path.join(work, 'ud'); const out = path.join(work, 'out-' + path.basename(video) + '-' + helper);
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(ud, 'User'), { recursive: true }); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(ud, 'User', 'settings.json'), JSON.stringify({ 'update.mode': 'none', 'window.restoreWindows': 'none', 'workbench.editor.restoreViewState': false, 'telemetry.telemetryLevel': 'off', 'workbench.startupEditor': 'none', 'chat.disableAIFeatures': true,
  'videoPreview.soundHelper': helper, 'window.zoomLevel': 0, 'workbench.colorTheme': process.env.THEME || 'Default Dark Modern', 'workbench.activityBar.location': 'hidden', 'workbench.statusBar.visible': false, 'window.commandCenter': false, 'workbench.layoutControl.enabled': false, 'workbench.editor.showTabs': 'single', 'workbench.editorAssociations': { '*.mp4': 'videoPreview.player', '*.mov': 'videoPreview.player', '*.mkv': 'videoPreview.player', '*.webm': 'videoPreview.player', '*.m4v': 'videoPreview.player' } }));
const code = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const child = spawn(code, [`--remote-debugging-port=${port}`, '--user-data-dir', ud, '--extensions-dir', path.join(work, 'ext'), '--skip-welcome', '--disable-workspace-trust',
  ...(process.env.NO_DEV ? [] : [`--extensionDevelopmentPath=${ext}`]), '--new-window'], { env: { ...process.env, VIDEO_PREVIEW_E2E: out }, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Open the file once the window is up, so the custom editor is registered.
await sleep(5000);
spawn(code, ['--user-data-dir', ud, '--reuse-window', path.resolve(video)], { stdio: 'ignore' });
const stats = () => { try { return JSON.parse(fs.readFileSync(path.join(out, 'stats.json'), 'utf8')); } catch { return null; } };
let result = { video: path.basename(video), helper };
try {
  let s; const t0 = Date.now();
  while (Date.now() - t0 < 40000) { s = stats(); if (s && s.w && ['ready', 'native', 'none', 'error', 'needs-helper', 'too-big'].includes(s.sound)) break; await sleep(300); }
  result.beforeClick = s; result.openMs = Date.now() - t0; await sleep(1500);
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && !t.url.includes('webview'));
  const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const lay = await send('Runtime.evaluate', { expression: 'JSON.stringify([innerWidth, innerHeight])', returnByValue: true });
  const [w, h] = JSON.parse(lay.result.result.value);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: w * 0.5, y: h * 0.4, button: 'left', clickCount: 1 });
  await sleep(2500); result.playing = stats();
  for (const k of keys) {
    if (k === '_') { await sleep(800); continue; }
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k, unmodifiedText: k }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k }); await sleep(250);
  }
  await sleep(1000); result.afterKeys = stats();
  result.pngs = fs.readdirSync(out).filter((n) => n.endsWith('.png'));
  if (shot) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(shot, Buffer.from(r.result.data, 'base64')); }
  ws.close();
} catch (e) { result.error = String(e.stack || e); }
child.kill('SIGTERM'); await sleep(1500);
spawn('pkill', ['-f', ud]);
console.log(JSON.stringify(result, null, 1));
