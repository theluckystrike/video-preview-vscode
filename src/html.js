'use strict';
// Webview HTML. No vscode import so tests can check the CSP.
const crypto = require('crypto');
const { footerHtml, FOOTER_CSS } = require('./support');

// The footer gets its own thin row under the player, so it never covers the video or the controls.
const FOOTER_LAYOUT = 'body{display:flex;flex-direction:column;height:100vh}#app{flex:1;min-height:0;height:auto}#app .player{height:100%}.zovo-support{flex:none;text-align:right;border-top:1px solid var(--vscode-panel-border,rgba(128,128,128,.3))}';

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** p.showSupportLinks false hides the small Sponsor and More free viewers line (setting videoPreview.showSupportLinks). */
function buildHtml(p) {
  const n = p.nonce || crypto.randomBytes(24).toString('base64url');
  const footer = footerHtml('videoPreview', p.showSupportLinks !== false, '');
  const csp = [
    "default-src 'none'",
    `style-src ${p.cspSource} 'nonce-${n}'`,
    `script-src 'nonce-${n}'`,
    `media-src ${p.cspSource}`,
    `img-src ${p.cspSource} data: blob:`,
    `font-src ${p.cspSource}`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${escapeAttr(p.styleUri)}">
${footer ? `<style nonce="${n}">${FOOTER_CSS}\n${FOOTER_LAYOUT}</style>` : ''}
<title>${escapeAttr(p.title)}</title>
</head>
<body>
<div id="app"><p class="loading">Opening the video...</p></div>
${footer}
<script nonce="${n}" src="${escapeAttr(p.scriptUri)}"></script>
</body>
</html>`;
}

module.exports = { buildHtml, escapeAttr };
