import test from 'node:test';
import assert from 'node:assert/strict';
import { onsetEnvelope, detectBeats, groupBeats, nearestBeat } from '../../site/js/beats.js';

test('detects a steady tempo from a periodic envelope (120 BPM = every 0.5s)', () => {
  const step = 0.01, n = 1000; const env = new Float32Array(n); // 10 s
  for (let t = 0; t < 10; t += 0.5) env[Math.round(t / step)] = 1; // a spike every 0.5 s
  const { beats, bpm } = detectBeats(env, step);
  assert.ok(Math.abs(bpm - 120) <= 2, `bpm ~120, got ${bpm}`);
  assert.ok(beats.length >= 18 && beats.length <= 21, `~20 beats, got ${beats.length}`);
  // beats land on the half-second grid
  for (const b of beats) assert.ok(Math.abs(b * 2 - Math.round(b * 2)) < 0.03, `beat on grid: ${b}`);
});

test('onsetEnvelope returns a positive-change envelope and the right step', () => {
  const sr = 8000, hop = 400; const s = new Float32Array(sr); // 1 s
  for (let i = 0; i < sr; i++) s[i] = i % 800 < 50 ? 1 : 0; // periodic bursts
  const { env, step } = onsetEnvelope(s, sr, hop);
  assert.equal(step, hop / sr);
  assert.equal(env.length, Math.floor(sr / hop));
  assert.ok(env.every(v => v >= 0));
});

test('groupBeats marks every Nth beat strong', () => {
  const beats = Array.from({ length: 16 }, (_, i) => i * 0.5);
  assert.deepEqual(groupBeats(beats, 4).filter(b => b.strong).map(b => b.t), [0, 2, 4, 6]);
  assert.deepEqual(groupBeats(beats, 8).filter(b => b.strong).map(b => b.t), [0, 4]);
});

test('nearestBeat snaps to the closest', () => {
  assert.equal(nearestBeat([0, 0.5, 1, 1.5], 1.2), 1);
  assert.equal(nearestBeat([], 1.2), null);
});

test('no envelope → no beats', () => {
  assert.deepEqual(detectBeats(new Float32Array(2), 0.01).beats, []);
});
