import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCuts, keepRanges, cutAt, keptLength, findSilences, wordGaps } from '../../site/js/cuts.js';

test('cuts merge, clamp and sort', () => {
  assert.deepEqual(mergeCuts([{ start: 5, end: 6 }, { start: 1, end: 2 }, { start: 1.5, end: 3 }, { start: 9, end: 12 }, { start: 4, end: 4.01 }], 10),
    [{ start: 1, end: 3 }, { start: 5, end: 6 }, { start: 9, end: 10 }]);
});

test('kept parts and their length', () => {
  const cuts = [{ start: 2, end: 3 }, { start: 5, end: 7 }];
  assert.deepEqual(keepRanges(cuts, 0, 10), [{ start: 0, end: 2 }, { start: 3, end: 5 }, { start: 7, end: 10 }]);
  assert.deepEqual(keepRanges(cuts, 2.5, 6), [{ start: 3, end: 5 }]);
  assert.equal(keptLength(cuts, 0, 10), 7);
  assert.deepEqual(cutAt(cuts, 6), { start: 5, end: 7 });
  assert.equal(cutAt(cuts, 4), null);
});

test('silences from loudness, keeping a little air around speech', () => {
  const step = 0.02, peaks = new Float32Array(500).fill(0.8);
  for (let i = 100; i < 200; i++) peaks[i] = 0.01; // 2 s quiet at 2–4 s
  for (let i = 300; i < 310; i++) peaks[i] = 0.01; // 0.2 s: too short to cut
  const s = findSilences(peaks, step);
  assert.equal(s.length, 1);
  assert.deepEqual(s[0], { start: 2.15, end: 3.85 });
});

test('pauses between words', () => {
  const w = (start, end) => ({ text: 'x', start, end });
  assert.deepEqual(wordGaps([{ words: [w(0, 0.5), w(0.6, 1)] }, { words: [w(3, 3.5)] }]), [{ start: 1.15, end: 2.85 }]);
});
