import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLines, buildPrompt, parsePlan, SCHEMA } from '../../netlify/functions/ai-edit.mjs';

const lines = Array.from({ length: 12 }, (_, i) => ({ start: i * 5, end: i * 5 + 4.5, text: i === 3 ? 'Ye 5000 rupaye ka setup hai' : `line ${i} baat` }));

test('lines are cleaned, sorted and capped', () => {
  const { lines: l, tooLong } = cleanLines([{ start: 5, end: 6, text: ' b  ' }, { start: 1, end: 2, text: 'a' }, { start: 3, end: 2, text: 'bad' }, { start: 0, end: 1, text: '' }]);
  assert.equal(tooLong, false);
  assert.deepEqual(l, [{ start: 1, end: 2, text: 'a' }, { start: 5, end: 6, text: 'b' }]);
  assert.equal(cleanLines(Array.from({ length: 401 }, (_, i) => ({ start: i, end: i + 1, text: 'x' }))).tooLong, true);
});

test('prompt numbers every line with its time', () => {
  const p = buildPrompt(lines.slice(0, 2));
  assert.match(p, /^0 \[0\.0-4\.5\] line 0 baat$/m);
  assert.match(p, /^1 \[5\.0-9\.5\] line 1 baat$/m);
});

test('plan line numbers become times; bad entries are dropped', () => {
  const plan = parsePlan({
    cuts: [{ from: 1, to: 1, reason: 'bad take' }, { from: 1, to: 2, reason: 'overlap' }, { from: 9, to: 99, reason: 'out of range' }, { from: 5, to: 4, reason: 'backwards' }],
    hook: 'Sirf 5000 me pura setup, dekho kaise ban gaya ye sab',
    highlights: ['5000', 'setup', 'not-in-video', 'two words'],
    shorts: [{ from: 2, to: 5, title: 'Setup ka sach' }, { from: 0, to: 0, title: 'too short' }],
    title: 'My setup', description: 'All about it.',
  }, lines);
  assert.deepEqual(plan.cuts, [{ start: 5, end: 9.5, reason: 'bad take' }]);
  assert.equal(plan.hook.split(' ').length, 10);
  assert.deepEqual(plan.highlights, ['5000', 'setup']);
  assert.deepEqual(plan.shorts, [{ start: 10, end: 29.5, title: 'Setup ka sach' }]);
  assert.equal(plan.title, 'My setup');
});

test('never cuts more than a third of the video', () => {
  const plan = parsePlan({ cuts: [{ from: 0, to: 3, reason: 'a' }, { from: 4, to: 7, reason: 'b' }], hook: '', highlights: [], shorts: [], title: '', description: '' }, lines);
  assert.equal(plan.cuts.length, 1);
});

test('garbage replies give an empty plan', () => {
  assert.deepEqual(parsePlan(null, lines), { cuts: [], hook: '', highlights: [], shorts: [], title: '', description: '' });
});

test('schema is strict enough for structured outputs', () => {
  assert.equal(SCHEMA.additionalProperties, false);
  assert.deepEqual(SCHEMA.required.sort(), Object.keys(SCHEMA.properties).sort());
  assert.equal(SCHEMA.properties.cuts.items.additionalProperties, false);
});

test('off without a key; either engine switches it on; other sites and empty transcripts refused first', async () => {
  const { default: handler } = await import('../../netlify/functions/ai-edit.mjs');
  const url = 'https://viral.example/api/ai-edit';
  delete process.env.ANTHROPIC_API_KEY; delete process.env.GROQ_API_KEY;
  assert.deepEqual(await (await handler(new Request(url))).json(), { enabled: false, engine: null });
  try {
    // Groq alone turns it on; Claude wins when both are set.
    process.env.GROQ_API_KEY = 'g';
    assert.deepEqual(await (await handler(new Request(url))).json(), { enabled: true, engine: 'groq' });
    process.env.ANTHROPIC_API_KEY = 'a';
    assert.deepEqual(await (await handler(new Request(url))).json(), { enabled: true, engine: 'claude' });
    const post = (origin, body) => handler(new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }), { ip: '1.2.3.4' });
    assert.equal((await post('https://evil.example', { lines })).status, 403);
    assert.equal((await post('https://viral.example', { lines: [] })).status, 400);
    assert.equal((await post('https://viral.example', { lines: Array.from({ length: 500 }, (_, i) => ({ start: i, end: i + 1, text: 'x' })) })).status, 413);
  } finally { delete process.env.ANTHROPIC_API_KEY; delete process.env.GROQ_API_KEY; }
});
