// AI edit: reads the timed transcript and returns an edit plan (bad takes / repeats / rambling to cut, a
// hook, words to highlight, the best Shorts, a title and description). The browser applies the plan with its
// own editor, so everything stays editable and undoable. Only caption text is sent, never media.
// Two engines, whichever key the site owner has set: Claude (ANTHROPIC_API_KEY, best) or Groq's free tier
// (GROQ_API_KEY, the same key as Fast mode). Off until one of them is set. Limits: requests from this site
// only, a few per visitor per day, a daily total for the whole site, and a cap on transcript length.
import Anthropic from '@anthropic-ai/sdk';
import { getStore } from '@netlify/blobs';

const MODEL = 'claude-opus-5-5';
const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const MAX_LINES = 400, MAX_CHARS = 30000;
const env = k => (globalThis.Netlify && Netlify.env.get(k)) || process.env[k] || '';
const anthropicKey = () => env('ANTHROPIC_API_KEY');
const groqKey = () => env('GROQ_API_KEY');
// Claude first (best edits), else Groq's free tier. Null when neither key is set.
const engine = () => (anthropicKey() ? 'claude' : groqKey() ? 'groq' : null);
const perUser = () => Math.max(1, +env('AI_EDIT_PER_USER') || 5);
const perDay = () => Math.max(1, +env('AI_EDIT_PER_DAY') || 200);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const SYSTEM = `You are a senior video editor for Indian YouTube and Instagram creators. You get a video's transcript as numbered lines with times, and you plan the edit the way a careful human editor would.

Cut:
- bad takes: a line the speaker says again (usually better) soon after; cut the earlier, weaker take
- false starts and broken sentences that are restarted
- rambling, off-topic tangents and repeated points that add nothing
Keep everything that carries the story, information or emotion. When unsure, keep it. Never cut more than a third of the video. Do not cut a line just for having a pause or an "umm" - the editor removes those separately.

Also write:
- hook: on-screen text for the first 3 seconds, at most 8 words, curiosity-driven, true to the video (no clickbait lies)
- highlights: up to 12 single words from the transcript worth colouring on screen (key nouns, numbers, strong emotions), copied exactly as written
- shorts: up to 5 self-contained moments of 15-60 seconds that work alone as Reels/Shorts, each with a hook title of at most 8 words
- title: a YouTube title under 70 characters; description: 2-3 short sentences
Write hook, titles and description in the SAME language and script as the transcript (Hinglish stays in Roman script, Hindi stays in Devanagari). Never invent facts that are not in the transcript. Line numbers must come from the transcript; "from" and "to" are inclusive.`;

const RANGE = { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: { type: 'integer' }, to: { type: 'integer' } } };
export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cuts', 'hook', 'highlights', 'shorts', 'title', 'description'],
  properties: {
    cuts: { type: 'array', items: { ...RANGE, required: ['from', 'to', 'reason'], properties: { ...RANGE.properties, reason: { type: 'string' } } } },
    hook: { type: 'string' },
    highlights: { type: 'array', items: { type: 'string' } },
    shorts: { type: 'array', items: { ...RANGE, required: ['from', 'to', 'title'], properties: { ...RANGE.properties, title: { type: 'string' } } } },
    title: { type: 'string' },
    description: { type: 'string' },
  },
};

/** Clean the lines the browser sent: numbers for times, trimmed text, sorted, capped. */
export function cleanLines(lines) {
  const out = [];
  let chars = 0;
  for (const l of Array.isArray(lines) ? lines : []) {
    const start = +l.start, end = +l.end, text = String((l && l.text) || '').replace(/\s+/g, ' ').trim();
    if (!text || !(end > start) || start < 0) continue;
    chars += text.length;
    if (out.length >= MAX_LINES || chars > MAX_CHARS) return { lines: out, tooLong: true };
    out.push({ start, end, text });
  }
  return { lines: out.sort((a, b) => a.start - b.start), tooLong: false };
}

export function buildPrompt(lines) {
  const list = lines.map((l, i) => `${i} [${l.start.toFixed(1)}-${l.end.toFixed(1)}] ${l.text}`).join('\n');
  return `Plan the edit for this video (${lines.length} lines, ${Math.round(lines[lines.length - 1].end)} seconds).\n\n${list}`;
}

const words = s => String(s || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 10).join(' ');
const range = (r, lines) => {
  const a = Number(r && r.from), b = Number(r && r.to);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a || b >= lines.length) return null;
  return { start: lines[a].start, end: lines[b].end };
};

/** Turn Claude's plan (line numbers) into times, dropping anything malformed or unsafe. */
export function parsePlan(plan, lines) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const dur = lines.length ? lines[lines.length - 1].end - lines[0].start : 0;
  const cuts = [];
  let cut = 0;
  for (const c of Array.isArray(p.cuts) ? p.cuts : []) {
    const r = range(c, lines);
    if (!r || cuts.some(x => r.start < x.end && r.end > x.start)) continue;
    if (cut + (r.end - r.start) > dur / 3) continue; // never take out more than a third
    cut += r.end - r.start;
    cuts.push({ ...r, reason: String(c.reason || '').slice(0, 120) });
  }
  const text = lines.map(l => l.text.toLowerCase()).join(' ');
  const highlights = [...new Set((Array.isArray(p.highlights) ? p.highlights : []).map(w => String(w).trim()).filter(w => w && !/\s/.test(w) && w.length <= 30 && text.includes(w.toLowerCase())))].slice(0, 12);
  const shorts = [];
  for (const s of Array.isArray(p.shorts) ? p.shorts : []) {
    const r = range(s, lines);
    if (!r || r.end - r.start < 8 || r.end - r.start > 90 || shorts.some(x => r.start < x.end && r.end > x.start)) continue;
    shorts.push({ ...r, title: words(s.title) });
    if (shorts.length >= 5) break;
  }
  return { cuts, hook: words(p.hook), highlights, shorts, title: String(p.title || '').trim().slice(0, 100), description: String(p.description || '').trim().slice(0, 600) };
}

// Usage counts per day, kept in Netlify Blobs (shared by every function instance); in memory if Blobs is unavailable.
const mem = new Map();
async function overLimit(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const who = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${day}:${ip}`)))).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
  let store = null;
  try { store = getStore('ai-edit-usage'); } catch { /* local run without Blobs */ }
  const read = async k => { try { return store ? +(await store.get(k)) || 0 : mem.get(k) || 0; } catch { return mem.get(k) || 0; } };
  const write = async (k, v) => { mem.set(k, v); try { if (store) await store.set(k, String(v)); } catch { /* memory only */ } };
  const [mine, all] = await Promise.all([read(`${day}/u/${who}`), read(`${day}/all`)]);
  if (mine >= perUser()) return 'You have used today’s AI edits. Try again tomorrow.';
  if (all >= perDay()) return 'AI edit is busy today. Try again tomorrow.';
  await Promise.all([write(`${day}/u/${who}`, mine + 1), write(`${day}/all`, all + 1)]);
  return '';
}

/** Ask Claude for the plan. Returns the parsed JSON text; throws a tagged Error on failure. */
async function runClaude(lines) {
  const client = new Anthropic({ apiKey: anthropicKey(), timeout: 60000, maxRetries: 1 });
  let msg;
  try {
    msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(lines) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw tagged('AI is busy. Try again in a minute.', 429);
    if (e instanceof Anthropic.AuthenticationError) throw tagged('AI edit key is not valid. The site owner needs to check it.', 502);
    if (e instanceof Anthropic.APIError) throw tagged(`AI server error ${e.status || ''}`.trim(), 502);
    throw tagged('AI server unreachable', 502);
  }
  if (msg.stop_reason === 'refusal') throw tagged('AI could not edit this video.', 422);
  const block = msg.content.find(b => b.type === 'text');
  return block ? block.text : '';
}

/** Ask Groq (free tier, OpenAI-style chat) for the plan. Same prompt, plus the JSON shape it must return. */
async function runGroq(lines) {
  const shape = 'Reply with ONLY a JSON object: {"cuts":[{"from":<line>,"to":<line>,"reason":"..."}],"hook":"...","highlights":["word"],"shorts":[{"from":<line>,"to":<line>,"title":"..."}],"title":"...","description":"..."}';
  let res;
  try {
    res = await fetch(GROQ, {
      method: 'POST',
      headers: { authorization: `Bearer ${groqKey()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL, temperature: 0.3, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `${buildPrompt(lines)}\n\n${shape}` }],
      }),
    });
  } catch { throw tagged('AI server unreachable', 502); }
  if (!res.ok) throw tagged(res.status === 429 ? 'AI is busy. Try again in a minute.' : `AI server error ${res.status}`, res.status === 429 ? 429 : 502);
  const out = await res.json();
  return (out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content) || '';
}

const tagged = (msg, status) => Object.assign(new Error(msg), { status });

export default async function handler(req, context) {
  const eng = engine();
  if (req.method === 'GET') return json({ enabled: !!eng, engine: eng });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!eng) return json({ error: 'AI edit is not set up on this site.' }, 404);
  const origin = req.headers.get('origin');
  if (!origin || new URL(origin).host !== new URL(req.url).host) return json({ error: 'forbidden' }, 403);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad request' }, 400); }
  const { lines, tooLong } = cleanLines(body && body.lines);
  if (tooLong) return json({ error: `This video is too long for AI edit (up to ${MAX_LINES} caption lines). Cut it into parts first.` }, 413);
  if (lines.length < 3) return json({ error: 'Make captions first: AI edit reads what is said.' }, 400);
  const limited = await overLimit((context && context.ip) || req.headers.get('x-nf-client-connection-ip') || 'unknown');
  if (limited) return json({ error: limited }, 429);

  let text;
  try { text = eng === 'claude' ? await runClaude(lines) : await runGroq(lines); }
  catch (e) { return json({ error: e.message || 'AI server error' }, e.status || 502); }
  let plan;
  try { plan = JSON.parse(String(text).replace(/^```(json)?|```$/g, '').trim()); } catch { return json({ error: 'AI reply was incomplete. Try again.' }, 502); }
  return json(parsePlan(plan, lines));
}

export const config = { path: '/api/ai-edit' };
