import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../site/js/captions.js';

const words = [
  { text: 'this', start: 0.0, end: 0.3 }, { text: 'is', start: 0.3, end: 0.5 }, { text: 'how', start: 0.5, end: 0.8 },
  { text: 'your', start: 0.8, end: 1.0 }, { text: 'reels', start: 1.0, end: 1.4 }, { text: 'go', start: 1.4, end: 1.6 },
  { text: 'viral.', start: 1.6, end: 2.1 }, { text: 'Later', start: 4.0, end: 4.4 },
];

test('segmentsFromWords groups by word count, sentence end and pauses', () => {
  const segs = C.segmentsFromWords(words, 3);
  assert.deepEqual(segs.map(C.segmentText), ['this is how', 'your reels go', 'viral.', 'Later']);
  assert.equal(segs[0].start, 0); assert.equal(segs[0].end, 0.8);
  assert.equal(segs.every(s => !s.approx), true);
});

test('rechunk keeps every word and its timing', () => {
  const segs = C.rechunk(C.segmentsFromWords(words, 3), 1);
  assert.equal(segs.length, words.length);
  assert.deepEqual(C.flattenWords(segs).map(w => [w.text, w.start, w.end]), words.map(w => [w.text, w.start, w.end]));
});

test('setText keeps measured times when the word count is unchanged', () => {
  const [s] = C.segmentsFromWords(words, 3);
  const t = C.setText(s, 'that was how');
  assert.deepEqual(t.words.map(w => w.start), [0, 0.3, 0.5]);
  assert.equal(t.approx, false);
});

test('setText re-spreads and flags estimated timing when words are added', () => {
  const [s] = C.segmentsFromWords(words, 3);
  const t = C.setText(s, 'this is exactly how');
  assert.equal(t.words.length, 4);
  assert.equal(t.approx, true);
  assert.equal(t.words[0].start, s.start); assert.equal(t.words[3].end, s.end);
  assert.equal(C.setText(s, '   '), null);
});

test('setTimes rescales words into the new range and enforces a minimum length', () => {
  const [s] = C.segmentsFromWords(words, 3);
  const t = C.setTimes(s, 1, 2.6);
  assert.equal(t.start, 1); assert.equal(t.end, 2.6);
  assert.equal(t.words[0].start, 1); assert.equal(t.words[2].end, 2.6);
  const tiny = C.setTimes(s, 5, 5);
  assert.ok(tiny.end - tiny.start >= C.MIN_DUR - 1e-9);
});

test('split and merge are inverse operations', () => {
  const [s] = C.segmentsFromWords(words, 3);
  const [a, b] = C.split(s, 1);
  assert.equal(C.segmentText(a), 'this'); assert.equal(C.segmentText(b), 'is how');
  assert.equal(a.end, 0.3); assert.equal(b.start, 0.3);
  const m = C.merge(a, b);
  assert.equal(C.segmentText(m), 'this is how'); assert.equal(m.start, 0); assert.equal(m.end, 0.8);
  assert.equal(C.split(C.segmentsFromWords([words[0]], 1)[0], 1), null);
});

test('newSegmentAfter fits in the gap before the next caption', () => {
  const segs = C.segmentsFromWords(words, 3);
  const n = C.newSegmentAfter(segs, 2, 'hello there');
  assert.ok(n.start >= segs[2].end); assert.ok(n.end <= segs[3].start);
  assert.equal(n.approx, true);
});

test('normalize sorts captions and drops empty ones', () => {
  const segs = C.segmentsFromWords(words, 3);
  const out = C.normalize([segs[2], null, segs[0], { ...segs[1], words: [] }]);
  assert.deepEqual(out.map(C.segmentText), ['this is how', 'viral.']);
});

test('toChunks holds a caption until the next one, but not across long pauses', () => {
  const segs = C.segmentsFromWords(words, 3);
  const ch = C.toChunks(segs, t => t.toUpperCase());
  assert.equal(ch[0].end, segs[1].start);
  assert.equal(ch[2].end, segs[2].end + 0.6);
  assert.equal(ch[0].words[0].text, 'THIS');
});

test('toChunks shows long captions in balanced pieces without changing them', () => {
  const segs = C.segmentsFromWords(words.slice(0, 7), 7);
  assert.equal(segs.length, 1);
  const ch = C.toChunks(segs, t => t, 3);
  assert.deepEqual(ch.map(c => c.words.map(w => w.text).join(' ')), ['this is how', 'your reels', 'go viral.']);
  assert.equal(ch[1].start, 0.8);
  assert.equal(ch[0].end, ch[1].start);
  assert.equal(segs[0].words.length, 7, 'caption untouched');
});

test('SRT round trip', () => {
  const segs = C.segmentsFromWords(words, 3);
  const srt = C.toSRT(segs);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:00,800\nthis is how\n/);
  const back = C.parseSRT(srt);
  assert.deepEqual(back.map(C.segmentText), segs.map(C.segmentText));
  assert.deepEqual(back.map(s => [s.start, s.end]), segs.map(s => [s.start, s.end]));
  assert.equal(back.every(s => s.approx), true);
});

test('parseSRT accepts WebVTT and strips tags', () => {
  const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.500\n<b>Hello</b> world\n\n00:03.000 --> 00:02.000\nbad cue\n';
  const segs = C.parseSRT(vtt);
  assert.equal(segs.length, 1);
  assert.equal(C.segmentText(segs[0]), 'Hello world');
  assert.equal(segs[0].start, 1); assert.equal(segs[0].end, 2.5);
});

test('indexAt finds the caption that has started', () => {
  const segs = C.segmentsFromWords(words, 3);
  assert.equal(C.indexAt(segs, -1), -1);
  assert.equal(C.indexAt(segs, 0.9), 1);
  assert.equal(C.indexAt(segs, 10), 3);
});

test('sentenceGroups splits on sentence ends and pauses', () => {
  const segs = C.segmentsFromWords(words, 3);
  assert.deepEqual(C.sentenceGroups(segs), [[0, 1, 2], [3]]);
});

test('applyTranslation shares translated words across the original captions and keeps their time span', () => {
  const segs = C.segmentsFromWords(words, 3); // 'this is how' | 'your reels go' | 'viral.'
  const out = C.applyTranslation(segs, [0, 1, 2], 'aise aapki reels har baar viral hongi');
  assert.equal(out.length, 3);
  assert.equal(out.flatMap(s => s.words.map(w => w.text)).join(' '), 'aise aapki reels har baar viral hongi');
  out.forEach((s, j) => { assert.equal(s.start, segs[j].start); assert.equal(s.end, segs[j].end); assert.equal(s.approx, true); });
  // Shorter translation than captions: no empty captions.
  assert.ok(C.applyTranslation(segs, [0, 1, 2], 'hello').every(s => s.words.length));
});

test('title and lower-case styles keep acronyms like AC and UPI', async () => {
  const { textFor } = await import('../../site/js/renderer.js');
  assert.equal(textFor('AC', { title: true }), 'AC');
  assert.equal(textFor('UPI,', { lower: true }), 'UPI,');
  assert.equal(textFor('bhaiya,', { title: true }), 'Bhaiya,');
  assert.equal(textFor('HELLO', { upper: true }), 'HELLO');
  assert.equal(textFor('Raha', { lower: true }), 'raha');
  assert.equal(textFor('I', { lower: true }), 'i');
});

test('filler words are removed, real words stay', async () => {
  const { removeFillers } = await import('../../site/js/captions.js');
  const w = (text, start) => ({ text, start, end: start + 0.3 });
  const { segments, removed } = removeFillers([
    { start: 0, end: 2, words: [w('Umm,', 0), w('so', 0.4), w('like', 0.8), w('uh', 1.2), w('this', 1.6)] },
    { start: 3, end: 3.3, words: [w('hmm...', 3)] },
    { start: 4, end: 4.6, words: [w('matlab', 4), w('अं', 4.3)] },
  ]);
  assert.equal(removed, 4);
  assert.deepEqual(segments.map(s => s.words.map(x => x.text).join(' ')), ['so like this', 'matlab']);
  assert.equal(segments[0].start, 0.4);
});
