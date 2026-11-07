'use strict';
// SRT and WebVTT parsing to plain-text cues. No DOM, no HTML: cue text is shown with textContent only.

const MAX_CUES = 20000;
const MAX_BYTES = 5 * 1024 * 1024;

/** Decode a subtitle file: UTF-8 (BOM removed), or latin1 when the bytes are not valid UTF-8. */
function decodeText(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { s = new TextDecoder('latin1').decode(bytes); }
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// 01:02:03,456  01:02:03.456  02:03.456 (VTT without hours)  also tolerates 1-3 digit millis.
const TIME = /^\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?\s*$/;
function parseTime(s) {
  const m = TIME.exec(s);
  if (!m) return null;
  const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + ms / 1000;
}

/** Remove markup: HTML-like tags (<i>, <b>, <font ...>, <c.x>, <v Name>, <00:01.000>) and ASS override blocks ({\an8}). */
function stripTags(text) {
  return text.replace(/<[^>\n]*>/g, '').replace(/\{\\[^}\n]*\}/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&lrm;|&rlm;/g, '')
    .split('\n').map((l) => l.trim()).filter((l) => l !== '').join('\n');
}

function normalize(text) {
  text = String(text || '');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n?/g, '\n');
}

/** Shared block parser: each block has an optional id line, a "start --> end [settings]" line and text lines. */
function parseBlocks(text, { vtt }) {
  const cues = [];
  const blocks = normalize(text).split(/\n[ \t]*\n/);
  for (let bi = 0; bi < blocks.length && cues.length < MAX_CUES; bi++) {
    const lines = blocks[bi].split('\n');
    while (lines.length && lines[0].trim() === '') lines.shift();
    if (!lines.length) continue;
    if (vtt && /^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) continue;
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0 || ti > 1) continue; // no timing line where one belongs: skip the block
    const [a, rest] = lines[ti].split('-->');
    const start = parseTime(a);
    const end = parseTime(String(rest).trim().split(/\s+/)[0] || '');
    if (start == null || end == null || end < start) continue;
    const body = stripTags(lines.slice(ti + 1).join('\n'));
    if (!body) continue;
    cues.push({ start, end, text: body });
  }
  cues.sort((x, y) => x.start - y.start || x.end - y.end);
  return cues;
}

function parseSrt(text) { return parseBlocks(text, { vtt: false }); }
function parseVtt(text) { return parseBlocks(text, { vtt: true }); }

/** Parse by file name (.vtt or .srt); also accepts an SRT named .vtt and the other way round. */
function parseSubtitles(name, text) {
  const isVtt = /\.vtt$/i.test(name) || /^﻿?WEBVTT/.test(text);
  return isVtt ? parseVtt(text) : parseSrt(text);
}

/** Cues showing at time t (sorted cues). Binary search for the last cue that starts at or before t, then walk back over overlaps. */
function cuesAt(cues, t) {
  if (!cues || !cues.length) return [];
  let lo = 0; let hi = cues.length - 1; let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const out = [];
  for (let i = idx; i >= 0 && i > idx - 20; i--) if (t < cues[i].end) out.unshift(cues[i]);
  return out;
}

module.exports = { parseSrt, parseVtt, parseSubtitles, parseTime, stripTags, decodeText, cuesAt, MAX_CUES, MAX_BYTES };
