'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseFromWebview, pngFromDataUrl, toWebview, MAX_PNG_CHARS } = require('../src/core/protocol');
const { buildHtml } = require('../src/html');

const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).toString('base64');

test('accepts the known messages and drops extra fields', () => {
  assert.deepStrictEqual(parseFromWebview({ type: 'ready', evil: 1 }), { type: 'ready' });
  assert.deepStrictEqual(parseFromWebview({ type: 'enableSound' }), { type: 'enableSound' });
  assert.deepStrictEqual(parseFromWebview({ type: 'screenshot', dataUrl: PNG, time: 1.5 }), { type: 'screenshot', dataUrl: PNG, time: 1.5 });
  assert.strictEqual(parseFromWebview({ type: 'screenshot', dataUrl: PNG, time: -3 }).time, 0);
  assert.deepStrictEqual(parseFromWebview({ type: 'copyText', text: 'a' }), { type: 'copyText', text: 'a' });
});

test('rejects bad messages', () => {
  for (const m of [null, 1, 'ready', {}, { type: 'exec', cmd: 'rm' }, { type: 'screenshot', dataUrl: 'data:text/html;base64,PGI+' },
    { type: 'screenshot', dataUrl: 'data:image/png;base64,' + 'A'.repeat(MAX_PNG_CHARS) }, { type: 'copyText', text: 'x'.repeat(20001) }, { type: 'copyText', text: 5 }]) {
    assert.strictEqual(parseFromWebview(m), null, JSON.stringify(m).slice(0, 60));
  }
});

test('new messages: convert, open in default app, load subtitles, playFailed, remember', () => {
  for (const type of ['convertVideo', 'openExternal', 'loadSubtitles']) assert.deepStrictEqual(parseFromWebview({ type, path: '/etc/passwd' }), { type });
  assert.deepStrictEqual(parseFromWebview({ type: 'playFailed', code: 4, noPicture: false, src: 'x' }), { type: 'playFailed', code: 4, noPicture: false });
  assert.deepStrictEqual(parseFromWebview({ type: 'playFailed', code: 'rm -rf', noPicture: 'yes' }), { type: 'playFailed', code: 0, noPicture: false });
  assert.deepStrictEqual(parseFromWebview({ type: 'playFailed', code: 99, noPicture: true }), { type: 'playFailed', code: 0, noPicture: true });
  assert.deepStrictEqual(parseFromWebview({ type: 'remember', t: 83.5, rate: 1.5, volume: 0.4, muted: true, file: '/x' }), { type: 'remember', t: 83.5, rate: 1.5, volume: 0.4, muted: true });
  assert.deepStrictEqual(parseFromWebview({ type: 'remember', t: 1, rate: 100, volume: 7, muted: 'yes' }), { type: 'remember', t: 1, rate: 1, volume: null, muted: false });
  for (const t of [-1, 'a', NaN, Infinity, 1e8, undefined]) assert.strictEqual(parseFromWebview({ type: 'remember', t }), null, String(t));
  assert.deepStrictEqual(toWebview.subtitles([{ label: 'en', lang: 'en', cues: [] }], { auto: true }), { type: 'subtitles', tracks: [{ label: 'en', lang: 'en', cues: [] }], auto: true });
  assert.strictEqual(toWebview.plan({ mode: 'transcode' }).type, 'plan');
});

test('pngFromDataUrl checks the PNG signature', () => {
  assert.ok(pngFromDataUrl(PNG));
  assert.strictEqual(pngFromDataUrl('data:image/png;base64,' + Buffer.from('GIF89a....').toString('base64')), null);
});

test('host messages', () => {
  assert.deepStrictEqual(toWebview.sound('ready', { src: 'u' }), { type: 'sound', state: 'ready', src: 'u' });
  assert.strictEqual(toWebview.init({ name: 'a' }).type, 'init');
});

test('HTML: strict CSP with a nonce, no inline or remote code, title escaped', () => {
  const h = buildHtml({ cspSource: 'https://res', scriptUri: 'https://res/w.js', styleUri: 'https://res/s.css', title: '<img src=x onerror=alert(1)>.mp4', nonce: 'N1' });
  const csp = h.match(/content="([^"]+)"/)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'nonce-N1'(;|$)/);
  assert.match(csp, /media-src https:\/\/res(;|$)/);
  assert.ok(!/unsafe-inline|unsafe-eval|http:|\*/.test(csp), csp);
  assert.ok(!h.includes('<img'));
  assert.match(h, /<script nonce="N1" src="https:\/\/res\/w.js">/);
});

test('the webview never builds HTML from strings', () => {
  const src = require('fs').readFileSync(require.resolve('../src/webview/main.js'), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(src));
});
