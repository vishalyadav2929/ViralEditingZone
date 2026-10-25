import test from 'node:test';
import assert from 'node:assert/strict';
import { animState, templateLines, breakApart, kfSample, upsertKf } from '../../site/js/text-fx.js';
import { TEMPLATES } from '../../site/js/templates.js';

test('animations start hidden or moved and end at rest', () => {
  for (const a of ['fade', 'pop', 'zoom', 'slide-up', 'slide-left', 'bounce']) {
    const s0 = animState(a, 2, 2, 5), s1 = animState(a, 4, 2, 5);
    assert.ok(s0.alpha < 0.05 || s0.dx || s0.dy || s0.scale !== 1, `${a} starts different`);
    assert.deepEqual([s1.alpha, Math.abs(s1.dx), +Math.abs(s1.dy).toFixed(6), +s1.scale.toFixed(6)], [1, 0, 0, 1], `${a} ends at rest`);
  }
  assert.equal(animState('type', 2, 2, 5).typeP, 0);
  assert.equal(animState('type', 5, 2, 5).typeP, 1);
  assert.deepEqual(animState(null, 0, 2, 5), { alpha: 1, dx: 0, dy: 0, scale: 1, typeP: 1 });
});

test('template lines: fixed counts, stacks, single line', () => {
  const w = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(templateLines(w, { lines: [2, 2] }), [['a', 'b'], ['c', 'd'], ['e']]);
  assert.deepEqual(templateLines(w, { layout: 'stack' }).length, 5);
  assert.deepEqual(templateLines(w, {}), [w]);
});

test('break apart: one plain text per line, with the role look, stacked around the original', () => {
  const tp = TEMPLATES.find(t => t.id === 'red-wipe');
  const L = { text: 'hello dada kem chhooo', x: 0.3, y: 0.4, size: 0.08, start: 1, end: 4, wordColors: { 3: '#00ff00' } };
  const p = breakApart(L, tp, 16 / 9);
  assert.equal(p.length, 2);
  assert.equal(p[0].text, 'Hello Dada');
  assert.equal(p[1].text, 'kem chhooo');
  assert.equal(p[1].bg, '#C8102E'); assert.equal(p[1].bgOp, 100); assert.equal(p[1].italic, true);
  assert.deepEqual(p[1].wordColors, { 1: '#00ff00' });
  assert.ok(p[0].y < 0.4 && p[1].y > 0.4);
  for (const x of p) { assert.equal(x.tpl, null); assert.equal(x.start, 1); assert.equal(x.end, 4); assert.equal(x.x, 0.3); assert.equal(x.anim, 'slide-left'); }
});

test('export frame rate snaps to a standard one', async () => {
  const { standardFps } = await import('../../site/js/export-fast.js');
  assert.deepEqual([29.7, 30.02, 26.4, 59.4, 55, 24.1, 25.2, 47, 14].map(standardFps), [30, 30, 30, 60, 60, 24, 25, 50, 24]);
});

test('keyframes: holds before first and after last, eases between', () => {
  const kf = [{ t: 1, x: 0.2, y: 0.2 }, { t: 3, x: 0.8, y: 0.6 }];
  assert.deepEqual(kfSample(kf, 0), { x: 0.2, y: 0.2 });
  assert.deepEqual(kfSample(kf, 5), { x: 0.8, y: 0.6 });
  const mid = kfSample(kf, 2); // halfway in time → smoothstep gives the exact midpoint
  assert.ok(Math.abs(mid.x - 0.5) < 1e-9 && Math.abs(mid.y - 0.4) < 1e-9, JSON.stringify(mid));
  assert.equal(kfSample([], 1), null);
  assert.equal(kfSample(undefined, 1), null);
});

test('upsertKf adds, replaces a near one, and stays sorted', () => {
  let kf = upsertKf(undefined, 2, 0.5, 0.5);
  assert.deepEqual(kf, [{ t: 2, x: 0.5, y: 0.5 }]);
  kf = upsertKf(kf, 1, 0.1, 0.1);
  assert.deepEqual(kf.map(k => k.t), [1, 2]);
  kf = upsertKf(kf, 2.03, 0.9, 0.9); // within snap → replaces the t=2 one
  assert.equal(kf.length, 2);
  assert.deepEqual(kf[1], { t: 2.03, x: 0.9, y: 0.9 });
});
