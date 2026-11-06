'use strict';
// Messages between the extension host and the webview. Everything from the webview is checked here.

const MAX_PNG_CHARS = 60 * 1024 * 1024; // a 4K frame as base64 PNG fits well under this

/** Returns a clean message object, or null if it is not one we accept. */
function parseFromWebview(m) {
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return null;
  switch (m.type) {
    case 'ready':
    case 'enableSound':
    case 'openSettings':
    case 'retrySound':
      return { type: m.type };
    case 'screenshot': {
      if (typeof m.dataUrl !== 'string' || m.dataUrl.length > MAX_PNG_CHARS || !m.dataUrl.startsWith('data:image/png;base64,')) return null;
      const t = Number(m.time);
      return { type: 'screenshot', dataUrl: m.dataUrl, time: Number.isFinite(t) && t >= 0 ? t : 0 };
    }
    case 'copyText':
      return typeof m.text === 'string' && m.text.length <= 20000 ? { type: 'copyText', text: m.text } : null;
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
  toast: (text) => ({ type: 'toast', text }),
};

const SOUND_STATES = ['native', 'none', 'decoding', 'ready', 'needs-trust', 'needs-helper', 'too-big', 'error', 'off'];

module.exports = { parseFromWebview, pngFromDataUrl, toWebview, SOUND_STATES, MAX_PNG_CHARS };
