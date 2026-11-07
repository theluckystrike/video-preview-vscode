'use strict';
// Remembered playback position per file (LRU in globalState) and the last volume/mute.
const crypto = require('crypto');
const { resumeAt } = require('./resume-rule');

const POS_KEY = 'videoPreview.positions';
const VOL_KEY = 'videoPreview.volume';
const MAX_ENTRIES = 200;

function keyOf(file) { return crypto.createHash('sha1').update(String(file)).digest('hex'); }

/** memento: {get(key, default), update(key, value)} (vscode globalState). */
function createStore(memento, { max = MAX_ENTRIES, now = () => Date.now() } = {}) {
  const all = () => ({ ...(memento.get(POS_KEY, {}) || {}) });
  return {
    get(file) { const e = all()[keyOf(file)]; return e && Number.isFinite(e.t) ? { t: e.t, rate: e.rate || 1, updated: e.updated } : null; },
    set(file, { t, rate }) {
      const m = all();
      m[keyOf(file)] = { t: Math.round(t * 1000) / 1000, rate: rate || 1, updated: now() };
      const keys = Object.keys(m);
      if (keys.length > max) {
        keys.sort((a, b) => m[a].updated - m[b].updated);
        for (const k of keys.slice(0, keys.length - max)) delete m[k];
      }
      return memento.update(POS_KEY, m);
    },
    size() { return Object.keys(all()).length; },
    getVolume() { const v = memento.get(VOL_KEY, null); return v && Number.isFinite(v.volume) ? { volume: v.volume, muted: !!v.muted } : null; },
    setVolume(volume, muted) { return memento.update(VOL_KEY, { volume, muted: !!muted }); },
  };
}

module.exports = { createStore, resumeAt, keyOf, MAX_ENTRIES, POS_KEY, VOL_KEY };
