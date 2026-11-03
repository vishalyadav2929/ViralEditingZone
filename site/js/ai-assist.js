// AI assistant for the caption editor — bring your own key (BYOK).
//
// Privacy model (same promise as the rest of the site):
//   * The visitor pastes THEIR OWN OpenAI-compatible API key. It is stored ONLY in this
//     browser's localStorage and is sent ONLY to the endpoint the visitor configured.
//   * No key is bundled with the site, and there is no owner key anywhere in this file.
//   * Only caption TEXT (the transcript) is ever sent. Video and audio never leave the device.
//   * Until a key is saved, every feature stays visibly off — nothing pretends to work.
//
// The editor itself is reached only through window.BB_AI (a small bridge defined in app.js):
// segments are read as display text and written back through the editor's own edit path,
// so caption timings, undo and autosave behave exactly like a manual edit.

// ---------- config ----------
const LS_KEY = 'bb-ai-assist-v1';
const DEFAULTS = { key: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' };

function loadConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_KEY) || 'null') || {};
    return { key: String(c.key || ''), baseUrl: String(c.baseUrl || DEFAULTS.baseUrl), model: String(c.model || DEFAULTS.model) };
  } catch { return { ...DEFAULTS }; }
}
function saveConfig(c) { try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch { /* private mode */ } }
function clearConfig() { try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ } }
const hasKey = () => !!loadConfig().key.trim();

// ---------- OpenAI-compatible chat client ----------
async function aiChat(messages, { timeoutMs = 60000, temperature = 0.7 } = {}) {
  const cfg = loadConfig();
  if (!cfg.key.trim()) throw new Error('Add your API key first (AI tab → API key settings).');
  const base = cfg.baseUrl.trim().replace(/\/+$/, '');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key.trim()}` },
      body: JSON.stringify({ model: cfg.model.trim() || DEFAULTS.model, messages, temperature }),
    });
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? 'The AI took too long to answer. Try again.' : 'Could not reach the AI endpoint. Check your internet and the base URL.');
  } finally { clearTimeout(timer); }
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = (j && j.error && j.error.message) || '';
    if (r.status === 401 || r.status === 403) throw new Error('Your API key was rejected by the endpoint. Check the key and base URL.');
    if (r.status === 429) throw new Error('Rate limit or balance reached on your API account. Try again later.');
    throw new Error(`AI endpoint error (${r.status})${msg ? `: ${msg}` : ''}`);
  }
  const text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!text) throw new Error('The AI endpoint returned an empty answer.');
  return String(text);
}

/** Ask for JSON and parse tolerantly (code fences / surrounding prose are stripped). */
async function aiJSON(messages, opts) {
  const raw = await aiChat(messages, opts);
  const clean = raw.replace(/```(?:json)?/gi, '');
  const starts = [clean.indexOf('{'), clean.indexOf('[')].filter(i => i >= 0).sort((a, b) => a - b);
  if (!starts.length) throw new Error('The AI did not return usable data. Try again.');
  const start = starts[0];
  const end = Math.max(clean.lastIndexOf('}'), clean.lastIndexOf(']'));
  try { return JSON.parse(clean.slice(start, end + 1)); }
  catch { throw new Error('The AI returned data that could not be read. Try again.'); }
}

// ---------- editor bridge ----------
const B = () => window.BB_AI || null;
const segLines = () => { const b = B(); return b.segments().map((s, i) => ({ i, start: s.start, end: s.end, text: b.displayText(i) })); };
const stampedTranscript = maxChars => {
  const b = B();
  let out = '';
  for (const l of segLines()) {
    const line = `[${b.fmt(l.start)}] ${l.text}\n`;
    if (out.length + line.length > maxChars) return { text: out, truncated: true };
    out += line;
  }
  return { text: out, truncated: false };
};
function styleNote() {
  const b = B(); if (!b) return 'the same language and style as the transcript';
  if (b.hinglish()) return 'Hinglish — Hindi written in Roman letters, the way Indian creators actually speak it';
  const l = b.textLang();
  if (l === 'hi') return 'Hindi (Devanagari script)';
  if (l === 'en') return 'English';
  return 'the same language and style as the transcript';
}
const SYSTEM_BASE = 'You help Indian short-video creators (Reels, Shorts, YouTube) who work from auto-generated captions. Be concrete and brief. Never invent facts that are not in the transcript.';

// ---------- tiny DOM helpers ----------
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = el('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove();
  }
  if (btn) { const old = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = old; }, 1500); }
  const b = B(); if (b) b.toast('Copied.');
}
function setBusy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = label || 'Working…'; }
  else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
}
function requireCaptions() {
  const b = B();
  if (!b || !b.hasVideo()) { if (b) b.toast('Open a video first.'); return false; }
  if (!b.segments().length) { b.toast('Make captions first (✨ Auto captions) — the AI works from what is said in the video.', 6000); return false; }
  if (b.isBusy()) { b.toast('The editor is busy right now. Try again in a moment.'); return false; }
  return true;
}

// ---------- mount ----------
const STYLE = `
.bbai-sec{border-top:1px solid rgba(127,127,127,.25);padding:10px 2px 14px}
.bbai-sec h3{margin:4px 0 6px;font-size:14px}
.bbai-sec p.hint{margin:0 0 8px}
.bbai-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0}
.bbai-out{margin-top:8px}
.bbai-item{display:flex;gap:6px;align-items:flex-start;padding:6px 8px;border:1px solid rgba(127,127,127,.25);border-radius:8px;margin:5px 0}
.bbai-item .t{flex:1;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.45}
.bbai-err{color:#ff7a7a;font-size:12.5px;min-height:1em;margin:4px 0;white-space:pre-wrap}
.bbai-note{border:1px dashed rgba(255,190,0,.55);border-radius:8px;padding:8px 10px;font-size:12.5px;line-height:1.5;margin:8px 0}
.bbai-log{max-height:300px;overflow:auto;display:flex;flex-direction:column;gap:6px;margin:8px 0}
.bbai-msg{padding:7px 9px;border-radius:10px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-width:92%}
.bbai-msg.u{align-self:flex-end;background:rgba(90,11,25,.55)}
.bbai-msg.a{align-self:flex-start;background:rgba(127,127,127,.16)}
.bbai-msg .seek{cursor:pointer;text-decoration:underline;padding:0;border:none;background:none;color:inherit;font:inherit}
.bbai-sec textarea,.bbai-sec input[type=text],.bbai-sec input[type=password]{width:100%;box-sizing:border-box}
.bbai-sec details{margin:6px 0}
.bbai-sec summary{cursor:pointer;font-weight:600;font-size:13.5px}
.bbai-chip{font-size:12px}
.bbai-prog{font-size:12.5px;opacity:.85;min-height:1em}
`;

function buildUI(root) {
  const style = el('style'); style.textContent = STYLE; root.appendChild(style);
  const b = B();

  // ----- settings -----
  const secSet = el('section', 'bbai-sec');
  const det = el('details'); det.id = 'bbaiSettings';
  const sum = el('summary', null, '🔑 API key settings (bring your own key)');
  det.appendChild(sum);
  const note = el('p', 'hint', 'Use your own OpenAI-compatible API key (OpenAI, OpenRouter, Groq, …). The key is stored only in this browser and is sent only to the endpoint below. Only caption text is sent to the AI — never your video or audio. No key? The AI features stay off; the rest of the editor works as always.');
  det.appendChild(note);
  const fKey = el('div', 'field'); fKey.append(el('label', null, 'API key'), Object.assign(el('input'), { type: 'password', id: 'bbaiKey', autocomplete: 'off', placeholder: 'sk-…' }));
  const fUrl = el('div', 'field'); fUrl.append(el('label', null, 'Base URL'), Object.assign(el('input'), { type: 'text', id: 'bbaiUrl', placeholder: DEFAULTS.baseUrl }));
  const fModel = el('div', 'field'); fModel.append(el('label', null, 'Model'), Object.assign(el('input'), { type: 'text', id: 'bbaiModel', placeholder: DEFAULTS.model }));
  det.append(fKey, fUrl, fModel);
  const rowSet = el('div', 'bbai-row');
  const btnSave = el('button', 'btn btn-sm', 'Save key'); btnSave.type = 'button';
  const btnTest = el('button', 'btn btn-sm', 'Test connection'); btnTest.type = 'button';
  const btnClear = el('button', 'btn btn-sm', 'Remove key'); btnClear.type = 'button';
  const setStat = el('span', 'bbai-prog');
  rowSet.append(btnSave, btnTest, btnClear, setStat);
  det.appendChild(rowSet);
  secSet.appendChild(det);
  const gate = el('div', 'bbai-note', 'AI features are off: add your API key above to switch them on. Nothing below will pretend to work without one.');
  gate.id = 'bbaiGate';
  secSet.appendChild(gate);
  root.appendChild(secSet);

  const keyIn = det.querySelector('#bbaiKey'), urlIn = det.querySelector('#bbaiUrl'), modelIn = det.querySelector('#bbaiModel');
  const fillSettings = () => { const c = loadConfig(); keyIn.value = c.key; urlIn.value = c.baseUrl; modelIn.value = c.model; };
  fillSettings();
  if (!hasKey()) det.open = true;

  const gateAll = () => {
    const on = hasKey();
    gate.hidden = on;
    root.querySelectorAll('[data-bbai-act]').forEach(n => { n.disabled = !on; });
    setStat.textContent = on ? `AI ready · ${loadConfig().model}` : '';
  };
  btnSave.onclick = () => {
    saveConfig({ key: keyIn.value.trim(), baseUrl: urlIn.value.trim() || DEFAULTS.baseUrl, model: modelIn.value.trim() || DEFAULTS.model });
    gateAll();
    if (b) b.toast(hasKey() ? 'API key saved in this browser only.' : 'Settings saved.');
  };
  btnClear.onclick = () => { clearConfig(); fillSettings(); gateAll(); if (b) b.toast('API key removed from this browser.'); };
  btnTest.onclick = async () => {
    saveConfig({ key: keyIn.value.trim(), baseUrl: urlIn.value.trim() || DEFAULTS.baseUrl, model: modelIn.value.trim() || DEFAULTS.model });
    if (!hasKey()) { setStat.textContent = 'Paste a key first.'; return; }
    setBusy(btnTest, true, 'Testing…');
    try { const out = await aiChat([{ role: 'user', content: 'Reply with exactly: OK' }], { timeoutMs: 30000, temperature: 0 }); setStat.textContent = `Connected ✓ (${out.trim().slice(0, 20)})`; }
    catch (e) { setStat.textContent = e.message; }
    finally { setBusy(btnTest, false); gateAll(); }
  };

  // ----- shared section builder -----
  function section(title, hintText) {
    const s = el('section', 'bbai-sec');
    s.appendChild(el('h3', null, title));
    if (hintText) s.appendChild(el('p', 'hint', hintText));
    const err = el('div', 'bbai-err'); err.setAttribute('role', 'alert');
    const out = el('div', 'bbai-out');
    s.append(err, out);
    root.appendChild(s);
    return { s, err, out };
  }
  const itemRow = (text, extraBtns) => {
    const row = el('div', 'bbai-item');
    row.appendChild(el('div', 't', text));
    const cp = el('button', 'btn btn-sm', 'Copy'); cp.type = 'button';
    cp.onclick = () => copyText(text, cp);
    row.appendChild(cp);
    (extraBtns || []).forEach(x => row.appendChild(x));
    return row;
  };

  // ----- 1) Hooks & titles -----
  {
    const { s, err, out } = section('🪝 Hooks & titles', 'Five scroll-stopping hooks and five titles from what is said in the video.');
    const row = el('div', 'bbai-row');
    const btn = el('button', 'btn btn-sm', 'Generate hooks & titles'); btn.type = 'button'; btn.dataset.bbaiAct = '1';
    row.appendChild(btn); s.insertBefore(row, err);
    btn.onclick = async () => {
      err.textContent = ''; out.textContent = '';
      if (!requireCaptions()) return;
      setBusy(btn, true);
      try {
        const t = stampedTranscript(12000);
        const j = await aiJSON([
          { role: 'system', content: `${SYSTEM_BASE} Output ONLY a JSON object.` },
          { role: 'user', content: `Here is the transcript of a short video (timestamps in brackets):\n\n${t.text}\n\nWrite in ${styleNote()}. Give exactly 5 hooks (each one short line a viewer reads in the first 2 seconds; no clickbait lies, no facts not in the transcript) and exactly 5 titles (clear, searchable, under 60 characters). Return JSON: {"hooks":["..."],"titles":["..."]}` },
        ]);
        const hooks = Array.isArray(j.hooks) ? j.hooks.filter(x => typeof x === 'string' && x.trim()) : [];
        const titles = Array.isArray(j.titles) ? j.titles.filter(x => typeof x === 'string' && x.trim()) : [];
        if (!hooks.length && !titles.length) throw new Error('The AI returned no hooks or titles. Try again.');
        if (hooks.length) { out.appendChild(el('h4', null, 'Hooks')); hooks.forEach(h => {
          const use = el('button', 'btn btn-sm', 'On-screen'); use.type = 'button';
          use.onclick = () => { if (B().addHook(h)) B().toast('Hook added as on-screen text at the start. Ctrl+Z undoes.'); };
          out.appendChild(itemRow(h, [use]));
        }); }
        if (titles.length) { out.appendChild(el('h4', null, 'Titles')); titles.forEach(t2 => out.appendChild(itemRow(t2))); }
      } catch (e) { err.textContent = e.message; }
      finally { setBusy(btn, false); }
    };
  }

  // ----- 2) Caption polish -----
  {
    const { s, err, out } = section('✨ Polish captions', 'Fixes hearing mistakes, spelling and punctuation, and makes the language natural. Your caption timings are never changed — if the AI reply does not line up 1-to-1 with your captions, nothing is applied.');
    const row = el('div', 'bbai-row');
    const btn = el('button', 'btn btn-sm', 'Polish captions'); btn.type = 'button'; btn.dataset.bbaiAct = '1';
    const prog = el('span', 'bbai-prog');
    row.append(btn, prog); s.insertBefore(row, err);
    btn.onclick = async () => {
      err.textContent = ''; out.textContent = ''; prog.textContent = '';
      if (!requireCaptions()) return;
      const lines = segLines();
      setBusy(btn, true);
      try {
        const fixed = new Array(lines.length);
        const BATCH = 40;
        for (let at = 0; at < lines.length; at += BATCH) {
          const batch = lines.slice(at, at + BATCH);
          prog.textContent = `Polishing captions ${at + 1}–${at + batch.length} of ${lines.length}…`;
          const numbered = batch.map((l, k) => `${k + 1}. ${l.text}`).join('\n');
          const j = await aiJSON([
            { role: 'system', content: `${SYSTEM_BASE} Output ONLY a JSON object.` },
            { role: 'user', content: `These are ${batch.length} numbered caption lines from a video, in ${styleNote()}:\n\n${numbered}\n\nFix each line: correct words the speech recogniser heard wrong, fix spelling and punctuation, and make the phrasing natural — without changing the meaning, without translating, and without adding or removing lines. Keep each line about the same length. Return JSON: {"lines":["line 1","line 2", ...]} with exactly ${batch.length} entries in the same order.` },
          ], { timeoutMs: 90000 });
          const arr = j && Array.isArray(j.lines) ? j.lines : null;
          if (!arr || arr.length !== batch.length || arr.some(x => typeof x !== 'string' || !x.trim())) {
            throw Object.assign(new Error('__mismatch'), { suggestions: j });
          }
          arr.forEach((x, k) => { fixed[at + k] = x.trim(); });
        }
        prog.textContent = '';
        const res = B().applyTexts(fixed);
        if (!res.ok) throw new Error('Could not apply the polish safely, so nothing was changed.');
        B().toast(res.changed ? `Polished ${res.changed} caption${res.changed > 1 ? 's' : ''}. Timings unchanged — Ctrl+Z undoes.` : 'Captions already look clean — nothing to change.', 6000);
      } catch (e) {
        prog.textContent = '';
        if (e.message === '__mismatch') {
          err.textContent = 'The AI reply did not line up 1-to-1 with your captions, so NOTHING was changed. You can copy any suggestion below by hand:';
          const arr = e.suggestions && Array.isArray(e.suggestions.lines) ? e.suggestions.lines : [];
          arr.forEach(x => { if (typeof x === 'string' && x.trim()) out.appendChild(itemRow(x)); });
        } else err.textContent = e.message;
      } finally { setBusy(btn, false); }
    };
  }

  // ----- 3) Post pack -----
  {
    const { s, err, out } = section('📣 Post pack', 'Ready-to-post description, hashtags and a pinned comment, written from the video itself.');
    const row = el('div', 'bbai-row');
    const btn = el('button', 'btn btn-sm', 'Make post pack'); btn.type = 'button'; btn.dataset.bbaiAct = '1';
    row.appendChild(btn); s.insertBefore(row, err);
    const block = (label, text) => {
      out.appendChild(el('h4', null, label));
      const row2 = el('div', 'bbai-item');
      row2.appendChild(el('div', 't', text));
      const cp = el('button', 'btn btn-sm', 'Copy'); cp.type = 'button';
      cp.onclick = () => copyText(text, cp);
      row2.appendChild(cp); out.appendChild(row2);
    };
    btn.onclick = async () => {
      err.textContent = ''; out.textContent = '';
      if (!requireCaptions()) return;
      setBusy(btn, true);
      try {
        const t = stampedTranscript(12000);
        const j = await aiJSON([
          { role: 'system', content: `${SYSTEM_BASE} Output ONLY a JSON object.` },
          { role: 'user', content: `Transcript of a short video:\n\n${t.text}\n\nWrite a posting pack in ${styleNote()}: (1) "description": 2–4 short lines for the post, ending with one question that invites comments; (2) "hashtags": 10–15 relevant hashtags (with #), mixing broad and niche, none invented-brand names; (3) "pinnedComment": one friendly first comment that asks viewers a question about the video. Return JSON: {"description":"...","hashtags":["#...", ...],"pinnedComment":"..."}` },
        ]);
        const desc = typeof j.description === 'string' ? j.description.trim() : '';
        const tags = Array.isArray(j.hashtags) ? j.hashtags.filter(x => typeof x === 'string' && x.trim()).map(x => (x.trim().startsWith('#') ? x.trim() : `#${x.trim()}`)) : [];
        const pin = typeof j.pinnedComment === 'string' ? j.pinnedComment.trim() : '';
        if (!desc && !tags.length && !pin) throw new Error('The AI returned an empty post pack. Try again.');
        if (desc) block('Description', desc);
        if (tags.length) block('Hashtags', tags.join(' '));
        if (pin) block('Pinned comment', pin);
      } catch (e) { err.textContent = e.message; }
      finally { setBusy(btn, false); }
    };
  }

  // ----- 4) Script match -----
  {
    const { s, err, out } = section('🎬 Script match', 'Paste the script you actually read out. Captions are rewritten in your script\u2019s exact words, keeping the original timings. Applied only if the reply lines up 1-to-1 and really follows your script.');
    const ta = el('textarea'); ta.rows = 5; ta.placeholder = 'Paste your script here…'; ta.id = 'bbaiScript';
    s.insertBefore(ta, err);
    const row = el('div', 'bbai-row');
    const btn = el('button', 'btn btn-sm', 'Match captions to script'); btn.type = 'button'; btn.dataset.bbaiAct = '1';
    const prog = el('span', 'bbai-prog');
    row.append(btn, prog); s.insertBefore(row, err);
    const normWords = t => (String(t).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
    btn.onclick = async () => {
      err.textContent = ''; out.textContent = ''; prog.textContent = '';
      if (!requireCaptions()) return;
      const script = ta.value.trim();
      if (!script) { err.textContent = 'Paste your script first.'; return; }
      const lines = segLines();
      if (lines.length > 200) { err.textContent = `This video has ${lines.length} captions — script match works up to 200 captions at a time. Split the video or trim it first.`; return; }
      setBusy(btn, true);
      try {
        prog.textContent = 'Matching captions to your script…';
        const numbered = lines.map((l, k) => `${k + 1}. ${l.text}`).join('\n');
        const j = await aiJSON([
          { role: 'system', content: `${SYSTEM_BASE} Output ONLY a JSON object.` },
          { role: 'user', content: `A creator read this script aloud:\n\n"""\n${script.slice(0, 14000)}\n"""\n\nThe speech recogniser produced these ${lines.length} numbered caption lines (same performance, with hearing mistakes):\n\n${numbered}\n\nRewrite the caption lines using the script's EXACT words, in script order, spread across the same ${lines.length} lines so each line still matches what is spoken at that moment. Keep line lengths similar to the originals. Do not add words that are not in the script, and do not drop script sentences. Return JSON: {"lines":["line 1", ...]} with exactly ${lines.length} entries.` },
        ], { timeoutMs: 120000 });
        prog.textContent = '';
        const arr = j && Array.isArray(j.lines) ? j.lines : null;
        if (!arr || arr.length !== lines.length || arr.some(x => typeof x !== 'string' || !x.trim())) {
          err.textContent = 'The AI reply did not line up 1-to-1 with your captions, so NOTHING was changed. Suggestions, if any:';
          (arr || []).forEach(x => { if (typeof x === 'string' && x.trim()) out.appendChild(itemRow(x)); });
          return;
        }
        // Local safeguard: the result must actually use the script's words.
        const bag = new Map();
        normWords(arr.join(' ')).forEach(w => bag.set(w, (bag.get(w) || 0) + 1));
        const sw = normWords(script);
        let hit = 0;
        const seen = new Map();
        sw.forEach(w => { const c = (seen.get(w) || 0) + 1; seen.set(w, c); if ((bag.get(w) || 0) >= c) hit++; });
        const coverage = sw.length ? hit / sw.length : 0;
        if (coverage < 0.7) {
          err.textContent = `The reply only used ${Math.round(coverage * 100)}% of your script's words, so NOTHING was changed — it may have drifted from your script. The suggestions are shown below so you can copy from them by hand:`;
          arr.forEach(x => out.appendChild(itemRow(x)));
          return;
        }
        const res = B().applyTexts(arr.map(x => x.trim()));
        if (!res.ok) { err.textContent = 'Could not apply the match safely, so nothing was changed.'; return; }
        B().toast(`Captions now follow your script (${Math.round(coverage * 100)}% of script words used). Timings unchanged — Ctrl+Z undoes.`, 7000);
      } catch (e) { prog.textContent = ''; err.textContent = e.message; }
      finally { setBusy(btn, false); }
    };
  }

  // ----- 5) Chat with the video -----
  {
    const { s, err, out } = section('💬 Chat with this video', 'Ask about the video\u2019s content: the strongest hook moment, a summary, where to cut Shorts. Answers use only the transcript.');
    const log = el('div', 'bbai-log'); log.id = 'bbaiChatLog';
    s.insertBefore(log, err);
    const chips = el('div', 'bbai-row');
    ['Best 15-second hook moment?', 'Summarise this video in 3 lines', 'Where can I cut Shorts from this?', 'Who is this video for?'].forEach(q => {
      const c = el('button', 'btn btn-sm bbai-chip', q); c.type = 'button'; c.dataset.bbaiAct = '1';
      c.onclick = () => { input.value = q; send(); };
      chips.appendChild(c);
    });
    s.insertBefore(chips, err);
    const row = el('div', 'bbai-row');
    const input = el('input'); input.type = 'text'; input.placeholder = 'Ask about this video…'; input.id = 'bbaiChatIn';
    const btn = el('button', 'btn btn-sm', 'Ask'); btn.type = 'button'; btn.dataset.bbaiAct = '1';
    row.append(input, btn); s.insertBefore(row, err);
    const history = [];
    const addMsg = (who, text) => {
      const m = el('div', `bbai-msg ${who === 'u' ? 'u' : 'a'}`);
      if (who === 'u') { m.textContent = text; }
      else {
        // Assistant text is inserted as text nodes; [m:ss] stamps become seek buttons.
        const re = /\[?(\d{1,3}):(\d{2})\]?/g; let last = 0, mm;
        while ((mm = re.exec(text))) {
          if (mm.index > last) m.appendChild(document.createTextNode(text.slice(last, mm.index)));
          const sec = +mm[1] * 60 + +mm[2];
          const sb = el('button', 'seek', mm[0]); sb.type = 'button';
          sb.onclick = () => B().seekTo(sec);
          m.appendChild(sb); last = mm.index + mm[0].length;
        }
        m.appendChild(document.createTextNode(text.slice(last)));
      }
      log.appendChild(m); log.scrollTop = log.scrollHeight;
      return m;
    };
    async function send() {
      err.textContent = '';
      const q = input.value.trim();
      if (!q) return;
      if (!requireCaptions()) return;
      input.value = '';
      addMsg('u', q);
      setBusy(btn, true, 'Thinking…');
      try {
        const t = stampedTranscript(24000);
        const sys = `${SYSTEM_BASE} You are answering questions about ONE video, using only its transcript below (timestamps in brackets). When you point to a moment, cite its timestamp like [1:23]. If the answer is not in the transcript, say so plainly.\n\nTRANSCRIPT${t.truncated ? ' (first part only — the video is long)' : ''}:\n${t.text}`;
        const msgs = [{ role: 'system', content: sys }, ...history.slice(-8), { role: 'user', content: q }];
        const ans = await aiChat(msgs, { timeoutMs: 90000 });
        history.push({ role: 'user', content: q }, { role: 'assistant', content: ans });
        addMsg('a', ans);
      } catch (e) { err.textContent = e.message; }
      finally { setBusy(btn, false); }
    }
    btn.onclick = send;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  }

  gateAll();
}

// Wait for the pane (added in app.html) and the editor bridge (defined in app.js, which
// loads before this module), then build once.
(function init(tries = 0) {
  const pane = document.getElementById('paneAI');
  const host = document.getElementById('bbaiRoot');
  if (pane && host && B()) { buildUI(host); return; }
  if (tries < 60) setTimeout(() => init(tries + 1), 100);
  else if (host) host.appendChild(el('p', 'hint', 'AI assistant could not start (editor bridge missing). The rest of the editor is unaffected.'));
})();
