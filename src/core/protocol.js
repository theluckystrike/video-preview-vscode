'use strict';
// Messages between the extension host and the webview. Everything from the webview is checked here.

const MAX_PNG_CHARS = 60 * 1024 * 1024; // a 4K frame as base64 PNG fits well under this
const MB = 1024 * 1024;
const PRO_FEATURES = ['clip', 'frames', 'sheet'];
const isPng = (d) => d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47 && d[4] === 0x0d && d[5] === 0x0a && d[6] === 0x1a && d[7] === 0x0a;
const isGif = (d) => d[0] === 0x47 && d[1] === 0x49 && d[2] === 0x46 && d[3] === 0x38 && d[4] === 0x39 && d[5] === 0x61;

/** Returns a clean message object, or null if it is not one we accept. */
function parseFromWebview(m) {
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return null;
  switch (m.type) {
    case 'ready':
    case 'enableSound':
    case 'openSettings':
    case 'retrySound':
    case 'convertVideo':
    case 'openExternal':
    case 'loadSubtitles':
      return { type: m.type };
    case 'playFailed': {
      // The <video> could not decode the file (error 3/4, or no picture although the file has a video track).
      const code = Number(m.code);
      return { type: 'playFailed', code: Number.isInteger(code) && code >= 0 && code <= 4 ? code : 0, noPicture: m.noPicture === true };
    }
    case 'remember': {
      const t = Number(m.t); const rate = Number(m.rate); const volume = Number(m.volume);
      if (!Number.isFinite(t) || t < 0 || t > 1e7) return null;
      return { type: 'remember', t, rate: Number.isFinite(rate) && rate >= 0.0625 && rate <= 16 ? rate : 1,
        volume: Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : null, muted: m.muted === true };
    }
    case 'screenshot': {
      if (typeof m.dataUrl !== 'string' || m.dataUrl.length > MAX_PNG_CHARS || !m.dataUrl.startsWith('data:image/png;base64,')) return null;
      const t = Number(m.time);
      return { type: 'screenshot', dataUrl: m.dataUrl, time: Number.isFinite(t) && t >= 0 ? t : 0 };
    }
    case 'copyText':
      return typeof m.text === 'string' && m.text.length <= 20000 ? { type: 'copyText', text: m.text } : null;
    // Zovo Pro (lane PRO4)
    case 'proAsk': {
      if (!PRO_FEATURES.includes(m.feature)) return null;
      const n = (v) => { const x = Number(v); return v != null && Number.isFinite(x) && x >= 0 && x < 1e7 ? x : null; };
      return { type: 'proAsk', feature: m.feature, a: n(m.a), b: n(m.b), duration: n(m.duration), width: Math.floor(n(m.width) || 0), height: Math.floor(n(m.height) || 0) };
    }
    case 'proCmd':
      return ['getPro', 'unlock', 'enterKey'].includes(m.cmd) ? { type: 'proCmd', cmd: m.cmd } : null;
    case 'proCancel':
      return { type: 'proCancel' };
    case 'proFrame': {
      const t = Number(m.t);
      if (!Number.isInteger(m.job) || !Number.isInteger(m.index) || m.index < 0 || m.index > 100000 || !Number.isFinite(t) || t < 0) return null;
      if (!(m.data instanceof Uint8Array) || m.data.length < 8 || m.data.length > 200 * MB || !isPng(m.data)) return null;
      return { type: 'proFrame', job: m.job, index: m.index, t, data: m.data };
    }
    case 'proData': {
      if (!Number.isInteger(m.job) || !(m.data instanceof Uint8Array) || m.data.length < 14 || m.data.length > 1024 * MB) return null;
      if (!isPng(m.data) && !isGif(m.data)) return null;
      return { type: 'proData', job: m.job, data: m.data, kind: isGif(m.data) ? 'gif' : 'png' };
    }
    case 'proEnd':
      if (!Number.isInteger(m.job)) return null;
      return { type: 'proEnd', job: m.job, ok: m.ok === true, cancelled: m.cancelled === true, count: Number.isInteger(m.count) && m.count >= 0 ? m.count : 0,
        capped: m.capped === true, error: typeof m.error === 'string' && m.error.length <= 500 ? m.error : '' };
    case 'stats': // e2e test hook only
      return m.stats && typeof m.stats === 'object' ? { type: 'stats', stats: JSON.parse(JSON.stringify(m.stats)) } : null;
    default:
      return null;
  }
}

function pngFromDataUrl(dataUrl) {
  const b = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (b.length < 8 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return b;
}

/** host -> webview */
const toWebview = {
  init: (p) => ({ type: 'init', ...p }),
  sound: (state, extra = {}) => ({ type: 'sound', state, ...extra }),
  media: (src) => ({ type: 'media', src }),
  plan: (plan) => ({ type: 'plan', plan }),
  toast: (text) => ({ type: 'toast', text }),
  /** tracks: [{label, lang, file, cues:[{start,end,text}]}]; add = appended by "Load subtitles...". */
  subtitles: (tracks, extra = {}) => ({ type: 'subtitles', tracks, ...extra }),
};

const SOUND_STATES = ['native', 'none', 'decoding', 'ready', 'needs-trust', 'needs-helper', 'too-big', 'error', 'off'];

module.exports = { parseFromWebview, pngFromDataUrl, toWebview, SOUND_STATES, MAX_PNG_CHARS, PRO_FEATURES };
