'use strict';
// Webview HTML. No vscode import so tests can check the CSP.
const crypto = require('crypto');

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHtml(p) {
  const n = p.nonce || crypto.randomBytes(24).toString('base64url');
  const csp = [
    "default-src 'none'",
    `style-src ${p.cspSource}`,
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
<title>${escapeAttr(p.title)}</title>
</head>
<body>
<div id="app"><p class="loading">Opening the video...</p></div>
<script nonce="${n}" src="${escapeAttr(p.scriptUri)}"></script>
</body>
</html>`;
}

module.exports = { buildHtml, escapeAttr };
