'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sub = require('../src/core/subtitles');
const { matchSidecars, findSidecars, loadTrack, langOf } = require('../src/core/sidecars');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-sub-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('SRT: BOM, CRLF, comma millis, ids, tags stripped, line breaks kept, no blank line at the end', () => {
  const srt = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> <b>there</b>\r\n<font color="#ff0000">second</font> line\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n{\\an8}Top &amp; more';
  assert.deepStrictEqual(sub.parseSrt(srt), [
    { start: 1, end: 2.5, text: 'Hello there\nsecond line' },
    { start: 3, end: 4, text: 'Top & more' },
  ]);
});

test('SRT: malformed blocks are skipped, not thrown; output is sorted; dot millis accepted', () => {
  const srt = '3\n00:00:09.000 --> 00:00:10.000\nlate\n\nnot a block at all\n\n1\n00:00:xx,000 --> 00:00:02,000\nbad time\n\n2\n00:00:05,000 --> 00:00:04,000\nends before start\n\n4\n00:00:01,000 --> 00:00:02,000\nearly\n\n\n\n';
  assert.deepStrictEqual(sub.parseSrt(srt).map((c) => c.text), ['early', 'late']);
  assert.deepStrictEqual(sub.parseSrt(''), []);
  assert.deepStrictEqual(sub.parseSrt('garbage\n\x00\x01'), []);
});

test('VTT: header, NOTE and STYLE blocks, hours optional, cue settings, ids, voice and class tags', () => {
  const vtt = 'WEBVTT - title\n\nNOTE a comment\nspanning lines\n\nSTYLE\n::cue { color: red }\n\nintro\n00:01.000 --> 00:02.000 align:start line:0\n<v Roger>Hi</v> <c.yellow>you</c>\n\n01:00:00.250 --> 01:00:01.000\nAn hour <00:00:00.500>later';
  assert.deepStrictEqual(sub.parseVtt(vtt), [
    { start: 1, end: 2, text: 'Hi you' },
    { start: 3600.25, end: 3601, text: 'An hour later' },
  ]);
  assert.strictEqual(sub.parseSubtitles('a.srt', vtt).length, 2, 'WEBVTT header wins over the extension');
});

test('cuesAt: binary search with overlaps, gaps and edges', () => {
  const cues = sub.parseSrt('1\n00:00:01,000 --> 00:00:05,000\nlong\n\n2\n00:00:02,000 --> 00:00:03,000\nshort\n\n3\n00:00:10,000 --> 00:00:11,000\nlater\n');
  assert.deepStrictEqual(sub.cuesAt(cues, 0.5), []);
  assert.deepStrictEqual(sub.cuesAt(cues, 1).map((c) => c.text), ['long']);
  assert.deepStrictEqual(sub.cuesAt(cues, 2.5).map((c) => c.text), ['long', 'short']);
  assert.deepStrictEqual(sub.cuesAt(cues, 5), []);
  assert.deepStrictEqual(sub.cuesAt(cues, 10.5).map((c) => c.text), ['later']);
  assert.deepStrictEqual(sub.cuesAt([], 1), []);
});

test('limits: at most 20,000 cues', () => {
  let s = '';
  for (let i = 0; i < 20100; i++) s += `${i}\n00:00:${String(i % 60).padStart(2, '0')},000 --> 00:00:${String(i % 60).padStart(2, '0')},500\nx\n\n`;
  assert.strictEqual(sub.parseSrt(s).length, sub.MAX_CUES);
});

test('decodeText: UTF-8 with BOM, and latin1 when the bytes are not UTF-8', () => {
  assert.strictEqual(sub.decodeText(Buffer.from('﻿çã', 'utf8')), 'çã');
  assert.strictEqual(sub.decodeText(Buffer.from([0x63, 0xe7, 0xe3, 0x6f])), 'cção');
});

test('sidecar names: plain, language and label tags, case, other videos ignored', () => {
  const names = ['Movie.mp4', 'movie.srt', 'Movie.en.srt', 'Movie.pt-BR.vtt', 'Movie.en.forced.srt', 'Movie.sdh.srt', 'Movie2.srt', 'Other.srt', 'Movie.txt', 'Movie.srt.bak'];
  const m = matchSidecars('Movie.mp4', names);
  assert.deepStrictEqual(m.map((x) => x.name), ['movie.srt', 'Movie.en.srt', 'Movie.en.forced.srt', 'Movie.pt-BR.vtt', 'Movie.sdh.srt']);
  assert.deepStrictEqual(m.map((x) => x.tag), ['', 'en', 'en.forced', 'pt-BR', 'sdh']);
  assert.strictEqual(langOf('pt-BR'), 'pt-BR');
  assert.strictEqual(langOf('en.forced'), 'en');
  assert.strictEqual(langOf('sdh'), '');
  assert.strictEqual(langOf('forced'), '');
  const many = Array.from({ length: 30 }, (_, i) => `v.t${i}.srt`);
  assert.strictEqual(matchSidecars('v.mp4', many).length, 20);
});

test('findSidecars reads real files next to the video; bad and huge files are skipped', async () => {
  const dir = path.join(tmp, 'side'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'clip.mov'), 'x');
  fs.writeFileSync(path.join(dir, 'clip.srt'), '1\n00:00:01,000 --> 00:00:02,000\nhello\n');
  fs.writeFileSync(path.join(dir, 'clip.fr.vtt'), 'WEBVTT\n\n00:01.000 --> 00:02.000\nbonjour\n');
  fs.writeFileSync(path.join(dir, 'clip.empty.srt'), 'nothing here');
  fs.writeFileSync(path.join(dir, 'clip.big.srt'), Buffer.alloc(sub.MAX_BYTES + 1, 0x41));
  const tracks = await findSidecars(path.join(dir, 'clip.mov'));
  assert.deepStrictEqual(tracks.map((t) => [t.label, t.lang, t.file]), [['Subtitles (SRT)', '', 'clip.srt'], ['fr', 'fr', 'clip.fr.vtt']]);
  assert.strictEqual(tracks[1].cues[0].text, 'bonjour');
  assert.match((await loadTrack(path.join(dir, 'clip.big.srt'))).error, /larger than 5 MB/);
  assert.match((await loadTrack(path.join(dir, 'missing.srt'))).error, /Could not read/);
  assert.deepStrictEqual(await findSidecars(path.join(tmp, 'no-such-dir', 'a.mp4')), []);
});
