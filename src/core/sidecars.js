'use strict';
// Finds subtitle files next to a video: movie.srt, movie.vtt, movie.en.srt, movie.pt-BR.forced.vtt ...
const fs = require('fs');
const path = require('path');
const { parseSubtitles, decodeText, MAX_BYTES } = require('./subtitles');

const MAX_FILES = 20;
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/i;

/** Sidecar file names for `videoPath`, sorted: plain name first, then by tag. Pure helper over a name list. */
function matchSidecars(videoName, names) {
  const base = videoName.slice(0, videoName.length - path.extname(videoName).length).toLowerCase();
  const found = [];
  for (const n of names) {
    const m = /^(.*)\.(srt|vtt)$/i.exec(n);
    if (!m) continue;
    const stem = m[1];
    let tag = null;
    if (stem.toLowerCase() === base) tag = '';
    else if (stem.toLowerCase().startsWith(base + '.')) tag = stem.slice(base.length + 1);
    if (tag == null || tag.length > 40 || /[/\\]/.test(tag)) continue;
    found.push({ name: n, tag, ext: m[2].toLowerCase() });
  }
  found.sort((a, b) => (a.tag === '' ? -1 : b.tag === '' ? 1 : a.tag.localeCompare(b.tag)) || a.ext.localeCompare(b.ext));
  return found.slice(0, MAX_FILES);
}

function trackLabel(tag, ext) {
  return tag ? tag.split('.').join(' ') : 'Subtitles (' + ext.toUpperCase() + ')';
}

function langOf(tag) {
  const first = String(tag || '').split('.')[0];
  return LANG.test(first) && !/^(sdh|cc|hi)$/i.test(first) ? first : '';
}

/** Read and parse one subtitle file. Returns {label, lang, file, cues} or {error}. */
async function loadTrack(file, tag = null) {
  const name = path.basename(file);
  try {
    const st = await fs.promises.stat(file);
    if (!st.isFile()) return { error: name + ' is not a file.' };
    if (st.size > MAX_BYTES) return { error: name + ' is larger than 5 MB.' };
    const cues = parseSubtitles(name, decodeText(await fs.promises.readFile(file)));
    if (!cues.length) return { error: 'No subtitles found in ' + name + '.' };
    const ext = path.extname(name).slice(1).toLowerCase();
    const label = tag == null ? name : trackLabel(tag, ext);
    return { label, lang: tag == null ? '' : langOf(tag), file: name, cues };
  } catch (e) {
    return { error: 'Could not read ' + name + ': ' + (e.code || e.message) };
  }
}

/** All sidecar tracks for a local video file. Never throws. */
async function findSidecars(videoPath) {
  let names;
  try { names = await fs.promises.readdir(path.dirname(videoPath)); } catch { return []; }
  const tracks = [];
  for (const s of matchSidecars(path.basename(videoPath), names)) {
    const t = await loadTrack(path.join(path.dirname(videoPath), s.name), s.tag);
    if (!t.error) tracks.push(t);
  }
  return tracks;
}

module.exports = { matchSidecars, findSidecars, loadTrack, langOf, MAX_FILES };
