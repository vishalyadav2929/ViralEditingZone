import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLut, parseCube, LOOKS, isGraded, DEFAULT_GRADE } from '../../site/js/grade.js';

test('identity LUT round-trips and looks change colours', () => {
  const id = buildLut((r, g, b) => [r, g, b], 5);
  assert.equal(id.data.length, 5 ** 3 * 3);
  assert.deepEqual([...id.data.slice(0, 3)], [0, 0, 0]);
  assert.deepEqual([...id.data.slice(-3)], [255, 255, 255]);
  assert.deepEqual([...id.data.slice(3, 6)], [64, 0, 0], 'red changes fastest, like .cube');
  for (const [name, look] of Object.entries(LOOKS)) {
    const c = look.fn(0.6, 0.4, 0.3);
    assert.ok(c.every(Number.isFinite), name);
    assert.notDeepEqual(c, [0.6, 0.4, 0.3], `${name} changes colour`);
  }
  const bw = LOOKS.bw.fn(0.9, 0.2, 0.1);
  assert.ok(bw[0] === bw[1] && bw[1] === bw[2], 'B&W is grey');
  const noir = LOOKS.noir.fn(0.9, 0.2, 0.1);
  assert.ok(noir[0] === noir[1] && noir[1] === noir[2], 'Film Noir is grey');
  const sep = LOOKS.sepia.fn(0.5, 0.5, 0.5);
  assert.ok(sep[0] > sep[1] && sep[1] > sep[2], 'Sepia is brown');
  assert.equal(Object.keys(LOOKS).length, 18);
});

test('parseCube reads .cube files, honours DOMAIN and rejects bad ones', () => {
  const rows = [];
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${r * 2} ${g * 2} ${b * 2}`);
  const lut = parseCube(`# made by hand\nTITLE "Test Look"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n${rows.join('\n')}\n`);
  assert.equal(lut.size, 2); assert.equal(lut.title, 'Test Look');
  assert.deepEqual([...lut.data.slice(-3)], [255, 255, 255]);
  assert.deepEqual([...lut.data.slice(3, 6)], [255, 0, 0]);
  assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n'), /should have 8/);
  assert.throws(() => parseCube('hello'), /LUT_3D_SIZE/);
  assert.throws(() => parseCube('LUT_1D_SIZE 4\n'), /1D/);
});

test('isGraded only when something is set', () => {
  assert.equal(isGraded(DEFAULT_GRADE), false);
  assert.equal(isGraded({ ...DEFAULT_GRADE, look: 'warm' }), true);
  assert.equal(isGraded({ ...DEFAULT_GRADE, vig: 0.3 }), true);
});
