'use strict';
// Pure resume rule, shared by the host and the webview bundle (no Node modules here).
const MARGIN = 5; // seconds: no resume in the first or the last 5 s

/** Where to start: t when 5 s < t < duration - 5 s, else 0. */
function resumeAt(t, duration) {
  t = Number(t); duration = Number(duration);
  if (!Number.isFinite(t) || !Number.isFinite(duration) || duration <= 0) return 0;
  return t > MARGIN && t < duration - MARGIN ? t : 0;
}

module.exports = { resumeAt, MARGIN };
