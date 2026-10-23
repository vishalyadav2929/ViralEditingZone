import { TEMPLATES, FONTS_URL, loadTemplateFonts, fontString } from './templates.js';
import { buildChunks, findChunk, drawCaption, spreadWords } from './renderer.js';
import { LANGUAGES, toHinglish } from './languages.js';
import { detectTextLang, onlineTranslate, looksEnglish } from './translate.js';
import { mountGallery, mountPhone } from './gallery.js';
import { mountIntro } from './intro.js';
import * as C from './captions.js';
import { extractAacAdts } from './mp4audio.js';
import { exportWebCodecs } from './export-webcodecs.js';
import { exportFast } from './export-fast.js';
import { Grader, LOOKS, buildLut, parseCube, DEFAULT_GRADE, isGraded } from './grade.js';
import { mountTimeline, wavePeaks } from './timeline.js';
import { SOUNDS, soundBuffer, mixWithSfx } from './sfx.js';
import { TEXT_FONTS, newLayer, drawLayer, layersAt, hitLayer, layout } from './text-layers.js';
import { findClips, cropRect, ASPECTS, aspectSize } from './clips.js';
import { TEXT_ANIMS, animState, breakApart } from './text-fx.js';
import { youtubeId, titleCheck } from './grow.js';
import { seriesOrder, partOf, partLabel, seriesCaptions } from './series.js';
import { SIZES, OVERLAYS, THUMBS, photoRect, drawOverlay } from './thumbs.js';
import { newId, listProjects, getProject, getProjectFile, putProject, putProjectFile, patchProject, deleteProject } from './projects.js';
import { cloudAvailable, cloudTranscribe } from './cloud-asr.js';
import './vendor/fix-webm-duration.js'; // sets window.ysFixWebmDuration (MIT)

const $ = id => document.getElementById(id);
$('fonts').href = FONTS_URL;

const canvas = $('stage');
const ctx = canvas.getContext('2d');
const video = document.createElement('video');
video.playsInline = true;
video.preload = 'auto';
video.crossOrigin = 'anonymous';

const urlTpl = new URLSearchParams(location.search).get('t');
const S = {
  mode: 'file',
  tplId: (TEMPLATES.find(t => t.id === urlTpl) || TEMPLATES[0]).id,
  o: { scale: 1 },     // style overrides on top of the template
  segments: [],        // source of truth for captions — see captions.js
  hinglish: false,
  file: null,
  fileURL: null,
  exporting: false,
  active: -1,
  selected: -1,
};

// ---------- small helpers ----------
const fmt = s => { if (!isFinite(s)) return '--:--'; s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const fmtT = s => { s = Math.max(0, s || 0); const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(2).padStart(5, '0')}`; };
const parseT = v => {
  v = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(v)) return +v;
  const m = v.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  return m ? +m[1] * 60 + +m[2] : NaN;
};
const fmtBytes = b => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.max(0.1, b / 1e6).toFixed(1)} MB`);
let toastTimer;
function toast(msg, ms = 3600) {
  $('toast').textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').textContent = ''; }, ms);
}
function status(text, progress) {
  const el = $('status');
  el.textContent = text || '';
  if (progress != null) {
    const bar = document.createElement('div'); bar.className = 'bar';
    const i = document.createElement('i'); i.style.width = `${Math.round(progress)}%`;
    bar.appendChild(i); el.appendChild(bar);
  }
}
const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
function toHex(c) {
  if (typeof c !== 'string') return '#ffffff';
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  const x = document.createElement('canvas').getContext('2d');
  x.fillStyle = c; return /^#[0-9a-f]{6}$/i.test(x.fillStyle) ? x.fillStyle : '#ffffff';
}
const baseTpl = () => TEMPLATES.find(t => t.id === S.tplId) || TEMPLATES[0];
const transform = t => (S.hinglish ? toHinglish(t) : t);

// The template with the user's style overrides applied. Used by preview AND export.
function tpl() {
  const t = baseTpl(), o = S.o, r = { ...t };
  if (o.color) r.color = o.color;
  if (o.hiColor) { r.hiColor = o.hiColor; if (t.hi === 'none') r.hi = 'color'; }
  if (o.weight) r.weight = +o.weight;
  if (o.font) r.font = o.font;
  // Animation overrides: entry, speed, how words appear, and the spoken-word highlight.
  if (o.anim) r.anim = o.anim;
  if (o.animSpeed) r.animDur = o.animSpeed === 'slow' ? 0.45 : 0.12;
  if (o.reveal) r.reveal = o.reveal;
  if (o.hi) { r.hi = o.hi; if (o.hi !== 'none' && !r.hiColor) r.hiColor = '#FFE600'; if (o.hi === 'box' && !r.boxText) r.boxText = '#111111'; }
  if (o.case) {
    r.upper = o.case === 'upper'; r.lower = o.case === 'lower'; r.title = false;
    if (r.roles) r.roles = r.roles.map(x => ({ ...x, upper: undefined, lower: undefined, title: undefined }));
  }
  if (o.strokeW != null) r.stroke = o.strokeW > 0 ? { w: o.strokeW / 100, c: o.strokeColor || '#000000' } : null;
  else if (o.strokeColor && t.stroke) r.stroke = { ...t.stroke, c: o.strokeColor };
  if (o.shadow != null) r.shadow = o.shadow ? { c: 'rgba(0,0,0,.7)', b: 0.18, x: 0, y: 0.05 } : null;
  if (o.bgOp != null) r.bg = o.bgOp > 0 ? { c: hexA(o.bgColor || '#000000', o.bgOp / 100), pad: 0.3, r: 0.18 } : null;
  if (o.align) r.align = o.align;
  if (o.oneLine) r.oneLine = true;
  if (o.maxWidth) r.maxWidth = o.maxWidth;
  if (o.lineGap) r.lineGap = o.lineGap;
  return r;
}
const wordsPerCaption = () => S.o.words || baseTpl().words;
// What survives a template change or "Reset to template": everything that isn't caption styling.
const keepO = () => ({ scale: S.o.scale || 1, sfx: S.o.sfx, sfxAuto: S.o.sfxAuto, grade: S.o.grade, texts: S.o.texts, clip: S.o.clip, found: S.o.found, series: S.o.series, trim: S.o.trim });

// ---------- undo / redo ----------
let hist = [], hIdx = -1;
const snap = () => JSON.stringify({ segments: S.segments, o: S.o, tplId: S.tplId, hinglish: S.hinglish });
function commit() {
  const s = snap();
  if (hist[hIdx] === s) return;
  hist = hist.slice(0, hIdx + 1);
  hist.push(s);
  if (hist.length > 100) hist.shift();
  hIdx = hist.length - 1;
  document.body.classList.toggle('design', !!(S.image && S.o.frame));
  if (typeof syncActions === 'function') syncActions();
  syncUndo();
  scheduleSave();
}
function restore(s) {
  const d = JSON.parse(s);
  S.segments = d.segments; S.o = d.o; S.tplId = d.tplId; S.hinglish = d.hinglish;
  gallery.select(S.tplId);
  if (S.textSel && !texts().some(l => l.id === S.textSel)) S.textSel = null;
  syncControls(); renderSegs(); syncActions(); renderTextUI(); renderClipUI(); renderWordUI();
}
function undo() { if (hIdx > 0 && !S.exporting) { hIdx--; restore(hist[hIdx]); syncUndo(); } }
function redo() { if (hIdx < hist.length - 1 && !S.exporting) { hIdx++; restore(hist[hIdx]); syncUndo(); } }
function syncUndo() {
  $('undoBtn').disabled = hIdx <= 0;
  $('redoBtn').disabled = hIdx >= hist.length - 1;
}
$('undoBtn').onclick = undo;
$('redoBtn').onclick = redo;

// ---------- languages ----------
LANGUAGES.forEach((l, i) => {
  const o = document.createElement('option');
  o.value = i; o.textContent = l.name;
  $('lang').appendChild(o);
});
$('lang').onchange = () => {
  const l = LANGUAGES[$('lang').value];
  if (l.hinglish && !S.hinglish) { S.hinglish = true; $('hinglish').checked = true; renderSegs(); commit(); }
  if (S.mode === 'live' && recog) { stopRecognition(); startRecognition(); }
};

// ---------- templates ----------
const gallery = mountGallery({
  tabsEl: $('tabs'), gridEl: $('grid'), langEl: $('langTabs'), selected: S.tplId,
  // Tiles show the user's own video frame and words.
  backdrop: () => thumbBgReady && thumbBg,
  sampleText: () => {
    const L = typeof curText === 'function' && curText();
    const w = L ? L.text : S.segments.length ? C.segmentText(S.segments[0]) : '';
    return w ? w.split(/\s+/).slice(0, 8).join(' ') : null;
  },
  onSelect: t => {
    if (S.exporting) return;
    if (document.fonts) document.fonts.load(fontString(t, 40), 'Aa अ').catch(() => {});
    // "Style goes on" decides: captions or text. Unset, a selected text wins (like any editor's text templates).
    const target = styleTarget();
    const L = target === 'text' && curText();
    if (L) {
      Object.assign(L, withTpl(L, t));
      renderTextUI(); timeline.render(); commit();
      S.textTpl = t.id;
      return toast(`“${t.name}” applied to your text. To style the captions instead, click an empty spot on the video first.`, 4500);
    }
    // No captions (a photo, or a video without captions yet): styles are for text. Pick first, type after.
    // Photos have no captions, so styles are for text there. On videos: when the visitor came from the
    // Text tool, or already has text but no captions. Otherwise the style is for the captions.
    if (target === 'text' && S.file) {
      S.textTpl = t.id;
      gallery.select(t.id);
      if (texts().length) {
        S.o.texts = texts().map(x => ({ ...x, ...withTpl(x, t) }));
        commit(); renderTextUI(); timeline.render();
        return toast(`“${t.name}” applied to your text.`);
      }
      addText();
      return toast(`“${t.name}” chosen. Type your text: it appears in this style.`, 4500);
    }
    applyCaptionTpl(t);
  },
});

function applyCaptionTpl(t) {
  if (document.fonts) document.fonts.load(fontString(t, 40), 'Aa अ').catch(() => {});
  S.tplId = t.id;
  gallery.select(t.id);
  if (S.file && !S.image && !S.segments.length && !genRunning) toast(`“${t.name}” set for captions. Press ✨ Make captions in Captions.`, 4500);
  // Style overrides belong to the old template. Captions are untouched: each template shows long captions
  // in pieces of its own size at render time (e.g. one word at a time for "Pill").
  S.o = keepO();
  syncControls(); renderSegs(); commit();
}
/** Where a picked style goes: 'cap' (captions) or 'text'. The visitor can choose; otherwise it's guessed. */
function styleTarget() {
  if (S.image) return 'text';
  // A selected text always takes the style (choosing "Captions" in the switch deselects it).
  if (curText()) return 'text';
  if (S.styleFor) return S.styleFor;
  return S.lastTool === 'text' || (!S.segments.length && texts().length > 0) ? 'text' : 'cap';
}
function renderStyleFor() {
  $('styleForRow').hidden = !!S.image;
  const v = styleTarget();
  $('styleFor').querySelectorAll('button').forEach(b => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
}
$('styleFor').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  S.styleFor = b.dataset.v;
  if (S.styleFor === 'cap') { deselectText(); gallery.select(S.tplId); }
  else { const L = curText(); gallery.select(L && L.tpl ? L.tpl : S.textTpl || null); }
  renderStyleFor();
  toast(S.styleFor === 'cap' ? 'Styles now change the captions.' : 'Styles now change your text.');
});

// On phones and tablets the template strip sits right under the video, so a tap shows the change at once.
{
  const mq = window.matchMedia('(max-width: 1100px)');
  const home = $('grid').parentElement;
  const place = () => {
    (mq.matches ? $('mTpl') : home).append($('styleForRow'), $('grid'));
    // The timeline would make the pinned preview too tall on phones: put it in the page flow below it.
    if (mq.matches) $('main').after($('timeline')); else $('tlDock').appendChild($('timeline'));
    $('editor').classList.toggle('no-tl', mq.matches || $('timeline').hidden);
    if (mq.matches && $('ltabTpl').classList.contains('on')) showLTab('captions');
  };
  if (mq.addEventListener) mq.addEventListener('change', place); else mq.addListener(place);
  place();
}

// ---------- editor layout (computers): preview left / middle / right, panel sizes, saved ----------
{
  const app = $('editor'), KEY = 'vcz-layout', DEF = { lay: 'right', lw: 300, rw: 320, th: 200, v: 3 };
  const L = { ...DEF };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY)) || {};
    // Layouts saved before the bigger-preview defaults keep only where the preview sits.
    // Layouts saved before the full-height preview became the default start again from the defaults.
    Object.assign(L, saved.v === 3 ? saved : { big: saved.big });
  } catch { /* private mode */ }
  const apply = () => {
    app.dataset.lay = L.lay;
    app.style.setProperty('--lw', `${L.lw}px`); app.style.setProperty('--rw', `${L.rw}px`); app.style.setProperty('--th', `${L.th}px`);
    document.querySelectorAll('[data-lay]').forEach(b => b.classList.toggle('on', b.dataset.lay === L.lay));
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(L)); } catch { /* private mode */ } };
  const limits = { lw: [220, () => innerWidth * 0.4], rw: [260, () => innerWidth * 0.4], th: [140, () => innerHeight * 0.6] };
  const set = (key, v) => { const [min, max] = limits[key]; L[key] = Math.round(Math.min(max(), Math.max(min, v))); apply(); };
  const splitter = (el, key, target) => {
    el.tabIndex = 0;
    // Which way grows the panel depends on which side of the bar it sits (it changes with the layout).
    const sign = () => (key === 'th' ? -1 : target().getBoundingClientRect().left < el.getBoundingClientRect().left ? 1 : -1);
    el.onpointerdown = e => {
      e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('on');
      const p0 = key === 'th' ? e.clientY : e.clientX, v0 = L[key], k = sign();
      el.onpointermove = ev => set(key, v0 + k * ((key === 'th' ? ev.clientY : ev.clientX) - p0));
      el.onpointerup = el.onpointercancel = () => { el.onpointermove = el.onpointerup = el.onpointercancel = null; el.classList.remove('on'); save(); timeline.render(); };
    };
    el.onkeydown = e => {
      const d = { ArrowLeft: -16, ArrowUp: -16, ArrowRight: 16, ArrowDown: 16 }[e.key];
      if (!d) return;
      e.preventDefault(); set(key, L[key] + d * sign() * (key === 'th' ? 1 : 1)); save(); timeline.render();
    };
  };
  splitter($('splitL'), 'lw', () => document.querySelector('.panel.tools'));
  splitter($('splitR'), 'rw', () => document.querySelector('.panel.props'));
  splitter($('splitT'), 'th', () => $('tlDock'));
  const menu = $('layMenu'), btn = $('layBtn');
  const open = on => { menu.hidden = !on; btn.setAttribute('aria-expanded', on); };
  btn.onclick = e => { e.stopPropagation(); open(menu.hidden); };
  menu.onclick = e => {
    e.stopPropagation();
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.lay) L.lay = b.dataset.lay;
    if (b.id === 'layReset') Object.assign(L, { lw: DEF.lw, rw: DEF.rw, th: DEF.th });
    apply(); save(); open(false); timeline.render();
  };
  document.addEventListener('click', () => open(false));
  // Big preview: hide the side panels (computers). Remembered with the layout.
  const big = on => {
    L.big = on; app.classList.toggle('big', on);
    $('bigBtn').setAttribute('aria-pressed', on); $('bigBtn').classList.toggle('on', on);
    save(); setTimeout(() => timeline.render(), 50);
  };
  $('bigBtn').onclick = () => big(!L.big);
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if (!typing && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'b' && !$('editor').hidden) big(!L.big);
  });
  // Phones/tablets: drag the bar under the preview to make it bigger or smaller.
  const stage = $('main'), grip = $('pvGrip');
  const setPv = vh => { L.pvh = Math.round(Math.min(62, Math.max(24, vh))); stage.style.setProperty('--pv-h', `${L.pvh}vh`); };
  if (L.pvh) setPv(L.pvh);
  grip.onpointerdown = e => {
    e.preventDefault(); grip.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = $('box').getBoundingClientRect().height / innerHeight * 100;
    grip.onpointermove = ev => setPv(h0 + (ev.clientY - y0) / innerHeight * 100);
    grip.onpointerup = grip.onpointercancel = () => { grip.onpointermove = grip.onpointerup = grip.onpointercancel = null; save(); };
  };
  apply();
  if (L.big) big(true);
}

// ---------- style controls ----------
function syncControls() {
  const t = tpl(), o = S.o;
  $('words').value = wordsPerCaption(); $('wordsVal').textContent = wordsPerCaption();
  syncLangPicker();
  if (typeof syncGradeControls === 'function') syncGradeControls();
  $('size').value = Math.round((o.scale || 1) * 100); $('sizeVal').textContent = `${$('size').value}%`;
  $('weight').value = o.weight || '';
  $('fontSel').value = o.font || '';
  $('animSel').value = o.anim || ''; $('animSpeed').value = o.animSpeed || ''; $('revealSel').value = o.reveal || ''; $('hiSel').value = o.hi || '';
  syncCapStyle();
  $('caseSel').value = o.case || '';
  $('color').value = toHex(t.color);
  $('hiColor').value = toHex(t.hiColor || '#FFE600');
  $('strokeColor').value = toHex((t.stroke && t.stroke.c) || '#000000');
  $('strokeW').value = Math.round(((t.stroke && t.stroke.w) || 0) * 100); $('strokeWVal').textContent = $('strokeW').value;
  $('shadow').checked = !!t.shadow;
  $('bgColor').value = toHex(o.bgColor || '#000000');
  $('bgOp').value = o.bgOp ?? (t.bg ? 60 : 0); $('bgOpVal').textContent = `${$('bgOp').value}%`;
  $('pos').value = Math.round((o.pos ?? baseTpl().pos ?? 0.72) * 100); $('posVal').textContent = `${$('pos').value}%`;
  $('maxW').value = Math.round((t.maxWidth ?? 0.88) * 100); $('maxWVal').textContent = `${$('maxW').value}%`;
  $('lineGap').value = Math.round((t.lineGap ?? 1.16) * 100); $('lineGapVal').textContent = ($('lineGap').value / 100).toFixed(2);
  const one = t.oneLine ? 'one' : 'auto';
  $('linesCtl').querySelectorAll('button').forEach(b => { const on = b.dataset.v === one; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  const align = t.align || 'center';
  $('alignCtl').querySelectorAll('button').forEach(b => { const on = b.dataset.v === align; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  $('hinglish').checked = S.hinglish;
}
const bind = (id, apply, label) => {
  const el = $(id);
  el.addEventListener('input', () => { apply(el); if (label) label(el); });
  el.addEventListener('change', () => commit());
};
bind('size', el => { S.o.scale = el.value / 100; }, el => { $('sizeVal').textContent = `${el.value}%`; });
bind('pos', el => { S.o.pos = el.value / 100; }, el => { $('posVal').textContent = `${el.value}%`; });
bind('maxW', el => { S.o.maxWidth = el.value / 100; }, el => { $('maxWVal').textContent = `${el.value}%`; });
bind('lineGap', el => { S.o.lineGap = el.value / 100; }, el => { $('lineGapVal').textContent = (el.value / 100).toFixed(2); });
bind('weight', el => { S.o.weight = el.value || null; });
bind('animSel', el => { S.o.anim = el.value || null; });
bind('animSpeed', el => { S.o.animSpeed = el.value || null; });
bind('revealSel', el => { S.o.reveal = el.value || null; });
bind('hiSel', el => { S.o.hi = el.value || null; });
$('animOff').onclick = () => {
  Object.assign(S.o, { anim: 'none', reveal: 'none', hi: 'none' });
  syncControls(); commit(); toast('Animation off: captions just appear. Pick any animation to turn it back on.');
};
TEXT_FONTS.forEach(f => { const o = document.createElement('option'); o.value = o.textContent = f; o.style.fontFamily = `'${f}'`; $('fontSel').appendChild(o); });
bind('fontSel', el => { S.o.font = el.value || null; if (el.value && document.fonts) document.fonts.load(`700 40px '${el.value}'`, 'Aa अ').catch(() => {}); });

// The captions panel has the main caption style controls too (above the language), so styling
// captions doesn't need another panel. They drive the same controls as the Caption style tab.
function CAP_TPLS() { return TEMPLATES.filter(t => !t.none).slice(0, 16); }
function renderCapTpls() {
  const strip = $('capTplStrip'); strip.innerHTML = '';
  for (const t of CAP_TPLS()) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cap-tpl' + (t.id === S.tplId ? ' on' : '');
    b.setAttribute('role', 'option'); b.setAttribute('aria-selected', t.id === S.tplId);
    b.textContent = t.name; b.style.fontFamily = `'${t.font}'`; b.style.fontWeight = t.weight || 700;
    b.style.color = toHex(t.color) === '#ffffff' ? '' : t.color;
    b.onclick = () => applyCaptionTpl(t);
    strip.appendChild(b);
  }
}
function syncCapStyle() {
  if (!$('capStyle')) return;
  $('capStyle').hidden = !S.file || !!S.image || S.mode !== 'file';
  const t = tpl();
  $('capTplName').textContent = baseTpl().name;
  $('capFont').value = S.o.font || '';
  $('capCase').value = S.o.case || '';
  $('capAnim').value = S.o.anim || ''; $('capHiSel').value = S.o.hi || '';
  $('capSize').value = $('size').value; $('capSizeVal').textContent = `${$('size').value}%`;
  $('capColor').value = $('color').value; $('capHi').value = $('hiColor').value; $('capStroke').value = $('strokeColor').value;
  $('capTplStrip').querySelectorAll('.cap-tpl').forEach((b, i) => { const on = CAP_TPLS()[i].id === S.tplId; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  void t;
}
{
  $('capFont').innerHTML = $('fontSel').innerHTML.replace('Template font', 'Style’s font');
  $('capCase').innerHTML = $('caseSel').innerHTML;
  $('capAnim').innerHTML = $('animSel').innerHTML; $('capHiSel').innerHTML = $('hiSel').innerHTML;
  // Each mirror control forwards to the real one, which applies the change and saves it.
  const mirror = (from, to) => {
    const send = type => { $(to).value = $(from).value; $(to).dispatchEvent(new Event(type)); };
    $(from).addEventListener('input', () => send('input'));
    $(from).addEventListener('change', () => { send('input'); send('change'); });
  };
  [['capFont', 'fontSel'], ['capCase', 'caseSel'], ['capAnim', 'animSel'], ['capHiSel', 'hiSel'], ['capSize', 'size'], ['capColor', 'color'], ['capHi', 'hiColor'], ['capStroke', 'strokeColor']].forEach(([a, b]) => mirror(a, b));
  $('capSize').addEventListener('input', () => { $('capSizeVal').textContent = `${$('capSize').value}%`; });
  $('capAllStyles').onclick = () => { S.styleFor = 'cap'; showLTab('tpl'); };
  $('capMoreType').onclick = () => showRTab('style');
}
renderCapTpls();
bind('caseSel', el => { S.o.case = el.value || null; });
bind('color', el => { S.o.color = el.value; });
bind('hiColor', el => { S.o.hiColor = el.value; });
bind('strokeColor', el => { S.o.strokeColor = el.value; if (S.o.strokeW == null && !baseTpl().stroke) S.o.strokeW = 12; syncControls(); });
bind('strokeW', el => { S.o.strokeW = +el.value; }, el => { $('strokeWVal').textContent = el.value; });
bind('shadow', el => { S.o.shadow = el.checked; });
bind('bgColor', el => { S.o.bgColor = el.value; if (S.o.bgOp == null) S.o.bgOp = 60; syncControls(); });
bind('bgOp', el => { S.o.bgOp = +el.value; }, el => { $('bgOpVal').textContent = `${el.value}%`; });
$('linesCtl').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  S.o.oneLine = b.dataset.v === 'one' || null; syncControls(); commit();
});
$('alignCtl').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  S.o.align = b.dataset.v; syncControls(); commit();
});
$('resetStyle').onclick = () => { S.o = { ...keepO(), scale: 1 }; syncControls(); commit(); toast('Style reset to the template.'); };
$('words').addEventListener('input', e => { $('wordsVal').textContent = e.target.value; });
$('words').addEventListener('change', e => {
  S.o.words = +e.target.value;
  if (S.segments.length) S.segments = C.rechunk(S.segments, S.o.words);
  renderSegs(); commit();
});
$('hinglish').onchange = e => { S.hinglish = e.target.checked; renderSegs(); commit(); };

// Left: tools (what to add). Right: details of what's selected. On phones the styles sit under the video.
const LTABS = [['ltabMedia', 'paneMedia', 'media'], ['ltabClips', 'paneClips', 'clips'], ['ltabThumb', 'paneThumb', 'thumb'], ['tabCaptions', 'paneCaptions', 'captions'], ['ltabText', 'paneText', 'text'], ['ltabSnd', 'paneSnd', 'snd'],
  ['ltabTpl', 'paneTpl', 'tpl'], ['tabColor', 'paneColor', 'color'], ['ltabAdj', 'paneAdjust', 'adjust']];
function showLTab(which) {
  if (which === 'tpl' && matchMedia('(max-width: 1100px)').matches) which = 'captions';
  if (which !== 'tpl') S.lastTool = which; else renderStyleFor();
  for (const [tab, pane, id] of LTABS) {
    const on = which === id;
    $(tab).classList.toggle('on', on); $(tab).setAttribute('aria-selected', on); $(pane).hidden = !on;
  }
  if (which === 'color') refreshLookThumbs();
  if (which === 'thumb') renderThumbUI();
  if (which === 'text') renderTextUI();
}
LTABS.forEach(([tab, , id]) => { $(tab).onclick = () => showLTab(id); });
const RTABS = [['tabStyle', 'paneStyle', 'style'], ['tabTxt', 'paneTxtProps', 'text'], ['tabInfo', 'paneInfo', 'info']];
function showRTab(which) {
  for (const [tab, pane, id] of RTABS) {
    const on = which === id;
    $(tab).classList.toggle('on', on); $(tab).setAttribute('aria-selected', on); $(pane).hidden = !on;
  }
  if (which === 'info') renderInfo();
}
RTABS.forEach(([tab, , id]) => { $(tab).onclick = () => showRTab(id); });
function showTab(which) { if (which === 'style') showRTab('style'); else showLTab(which); }

// ---------- colour grading ----------
const grader = new Grader();
const lutCache = {};
const grade = () => ({ ...DEFAULT_GRADE, ...(S.o.grade || {}) });
function lutFor(look) {
  if (look === 'none') return null;
  if (look === 'custom') return S.customLut || null;
  return lutCache[look] || (lutCache[look] = buildLut(LOOKS[look].fn));
}
/** The frame to draw: the source itself, or its graded copy when a look/adjustment is on. */
function graded(src, w, h, g = grade()) {
  if (!isGraded(g) || !grader.ok) return src;
  grader.setLut(lutFor(g.look), g.look === 'custom' ? `custom:${S.customLutName}` : g.look);
  return grader.render(src, w, h, g) || src;
}
const GSLIDERS = { gExp: ['exp', 100], gCon: ['con', 100], gSat: ['sat', 100], gTemp: ['temp', 100], gTint: ['tint', 100], gVig: ['vig', 100], gMix: ['mix', 100] };
function setGrade(patch, save = true) {
  S.o.grade = { ...grade(), ...patch };
  syncGradeControls();
  if (save) commit();
}
function syncGradeControls() {
  const g = grade();
  for (const [id, [k, div]] of Object.entries(GSLIDERS)) {
    $(id).value = Math.round(g[k] * div);
    const v = Math.round(g[k] * div);
    $(id + 'Val').textContent = id === 'gMix' ? `${v}%` : v > 0 ? `+${v}` : String(v);
  }
  document.querySelectorAll('.look').forEach(b => b.classList.toggle('on', b.dataset.look === g.look));
}
for (const [id, [k, div]] of Object.entries(GSLIDERS)) {
  $(id).oninput = e => setGrade({ [k]: +e.target.value / div }, false);
  $(id).onchange = () => commit();
}
$('gReset').onclick = () => { S.o.grade = { ...DEFAULT_GRADE }; syncGradeControls(); commit(); };
const LOOK_LIST = [['none', 'Original'], ...Object.entries(LOOKS).map(([id, l]) => [id, l.name])];
function renderLooks() {
  const box = $('looks');
  box.innerHTML = '';
  const list = S.customLut ? [...LOOK_LIST, ['custom', S.customLutName || 'My LUT']] : LOOK_LIST;
  for (const [id, name] of list) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'look'; b.dataset.look = id;
    const c = document.createElement('canvas'); c.width = 96; c.height = 120;
    const nm = document.createElement('span'); nm.textContent = name;
    b.append(c, nm);
    b.onclick = () => setGrade({ look: id });
    box.appendChild(b);
  }
  syncGradeControls();
  refreshLookThumbs();
}
/** Each look's thumbnail shows the current video frame in that look. */
function refreshLookThumbs() {
  if (!grader.ok || $('paneColor').hidden) return;
  const src = S.image || (video.readyState >= 2 && video.videoWidth ? video : null);
  document.querySelectorAll('.look canvas').forEach(c => {
    const x = c.getContext('2d');
    if (!src) { x.fillStyle = '#ccc'; x.fillRect(0, 0, c.width, c.height); return; }
    const id = c.parentElement.dataset.look;
    const out = id === 'none' ? src : graded(src, c.width, c.height, { ...DEFAULT_GRADE, look: id });
    const vw = src.videoWidth || src.naturalWidth, vh = src.videoHeight || src.naturalHeight, k = Math.max(c.width / vw, c.height / vh);
    if (out === src) x.drawImage(src, (c.width - vw * k) / 2, (c.height - vh * k) / 2, vw * k, vh * k);
    else x.drawImage(out, 0, 0, c.width, c.height);
  });
}
$('cubeIn').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const lut = parseCube(await f.text());
    S.customLut = lut; S.customLutName = lut.title || f.name.replace(/\.cube$/i, '');
    renderLooks();
    setGrade({ look: 'custom' });
    toast(`LUT “${S.customLutName}” added.`);
  } catch (err) { toast(err.message || 'That file isn’t a valid .cube LUT.', 5000); }
};
if (!grader.ok) $('looks').insertAdjacentHTML('beforebegin', '<p class="hint">This browser can’t run colour grading (WebGL 2 is missing).</p>');
renderLooks();
video.addEventListener('seeked', refreshLookThumbs);
video.addEventListener('loadeddata', refreshLookThumbs);

// ---------- caption list ----------
// ---------- timeline ----------
// var: renderSegs can run before this line during start-up.
var timeline = mountTimeline($('timeline'), {
  segments: () => S.segments,
  duration: () => (isFinite(video.duration) ? video.duration : 0),
  time: () => video.currentTime || 0,
  playing: () => !video.paused,
  seek: t => seekTo(t),
  show: t => transform(t),
  wave: () => S.wave,
  selectSeg: i => { S.selected = i; markSel(); },
  pos: () => S.o.pos ?? baseTpl().pos ?? 0.72,
  setPos: p => { S.o.pos = p; syncControls(); commit(); },
  editWord: (si, wi, text) => {
    const arr = JSON.parse(JSON.stringify(S.segments));
    if (!text) arr[si].words.splice(wi, 1); else arr[si].words[wi].text = text;
    setSegments(arr.filter(s => s.words.length));
  },
  sounds: SOUNDS,
  soundsHost: $('paneSnd'),
  openSounds: () => { showLTab('snd'); if (matchMedia('(max-width: 1100px)').matches) $('paneSnd').scrollIntoView({ block: 'start', behavior: 'smooth' }); return true; },
  addText: () => addText(),
  selectWord: (si, wi) => { S.wordSel = si == null ? null : [si, wi]; renderWordUI(); if (si != null) showRTab('style'); },
  clip: () => S.o.clip || null,
  media: () => (S.file && !S.image && S.fileURL ? { url: S.fileURL, name: S.file.name.replace(/\.[^.]+$/, ''), dur: video.duration || 0 } : null),
  trim: () => S.o.trim || null,
  setTrim: (start, end, save) => {
    const d = video.duration || 0;
    S.o.trim = start <= 0.05 && end >= d - 0.05 ? null : { start: +start.toFixed(2), end: +end.toFixed(2) };
    if (save) { commit(); timeline.render(); if (S.o.trim) toast(`Trimmed: ${fmt(S.o.trim.start)}–${fmt(S.o.trim.end)}. The export uses only this part.`); }
  },
  splitAt: t => {
    const i = C.indexAt(S.segments, t), seg = S.segments[i];
    const at = seg ? seg.words.filter(w => w.start < t).length : 0;
    if (!seg || at <= 0 || at >= seg.words.length) return toast('Move the playhead inside a caption, between two words, then press Split.');
    const arr = S.segments.slice(); arr.splice(i, 1, ...C.split(seg, at)); setSegments(arr);
  },
  deleteSelected: () => {
    if (S.textSel) return $('txtDel').click();
    if (S.selected >= 0 && S.segments[S.selected]) { const arr = S.segments.slice(); arr.splice(S.selected, 1); setSegments(arr, false); return toast('Caption deleted. Press Ctrl+Z to undo.'); }
    toast('Select a word, caption, text or sound first.');
  },
  texts: () => texts(),
  selectedText: () => S.textSel,
  selectText: id => selectText(id),
  timeText: (id, start, end, save) => {
    const L = texts().find(l => l.id === id); if (!L) return;
    L.start = +start.toFixed(2); L.end = +end.toFixed(2);
    if (save) { commit(); renderTextUI(); timeline.render(); }
  },
  soundList: () => allSounds(),
  previewSound: id => playSound(id, 0),
  addSound: id => { S.o.sfx = [...(S.o.sfx || []), { t: +(video.currentTime || 0).toFixed(2), id, vol: 0.8 }]; commit(); timeline.render(); playSound(id, 0); },
  deleteSound: i => { S.o.sfx = (S.o.sfx || []).filter((_, k) => k !== i); commit(); timeline.render(); },
  autoSound: () => S.o.sfxAuto || null,
  setAutoSound: id => { S.o.sfxAuto = id; commit(); timeline.render(); },
  deleteWord: (si, wi) => {
    const arr = JSON.parse(JSON.stringify(S.segments));
    arr[si].words.splice(wi, 1);
    setSegments(arr.filter(s => s.words.length));
  },
});

// ---------- text layers (typed by hand, shown exactly as typed) ----------
S.textSel = null;
S.textBoxes = [];
const texts = () => S.o.texts || (S.o.texts = []);
const curText = () => texts().find(l => l.id === S.textSel) || null;
TEXT_FONTS.forEach(f => { const o = document.createElement('option'); o.value = f; o.textContent = f; o.style.fontFamily = `'${f}'`; $('txtFont').appendChild(o); });
const mediaDur = () => (S.image ? 0 : isFinite(video.duration) ? video.duration : 0);
function renderTextUI() {
  const list = $('txtList');
  list.innerHTML = '';
  texts().forEach(L => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'txt-item' + (L.id === S.textSel ? ' on' : '');
    const nm = document.createElement('span'); nm.textContent = L.text.split('\n')[0] || '(empty)'; nm.style.fontFamily = `'${L.font}'`;
    b.appendChild(nm);
    if (!S.image) { const t = document.createElement('small'); t.textContent = `${fmtT(L.start)} – ${fmtT(L.end)}`; b.appendChild(t); }
    b.onclick = () => selectText(L.id);
    list.appendChild(b);
  });
  const L = curText();
  $('txtAutoCap').hidden = !!S.image || !S.file || S.segments.length > 0;
  renderStyleFor();
  $('txtEdit').hidden = !L; $('txtNone').hidden = !!L;
  $('txtTime').hidden = !!S.image;
  if (!L) return;
  if (document.activeElement !== $('txtText')) $('txtText').value = L.text;
  const chips = $('txtChips'); chips.innerHTML = '';
  L.text.split(/\s+/).filter(Boolean).forEach((w, i) => {
    const c = document.createElement('button'); c.type = 'button'; c.className = 'chip' + (S.txtWord === i ? ' on' : '');
    c.textContent = w; if (L.wordColors && L.wordColors[i]) c.style.color = L.wordColors[i];
    c.onclick = () => { S.txtWord = S.txtWord === i ? null : i; renderTextUI(); };
    chips.appendChild(c);
  });
  $('txtWordRow').hidden = S.txtWord == null;
  if (S.txtWord != null) { $('txtWordName').textContent = L.text.split(/\s+/).filter(Boolean)[S.txtWord] || ''; $('txtWordColor').value = (L.wordColors && L.wordColors[S.txtWord]) || '#ffe600'; }
  const tp = L.tpl && TEMPLATES.find(x => x.id === L.tpl);
  $('txtTplName').textContent = tp ? tp.name : 'None (plain text)';
  $('txtTplClear').hidden = !tp; $('txtBreak').hidden = !tp;
  $('txtAnim').value = L.anim || '';
  $('txtAnim').options[0].textContent = tp ? 'Default (the style’s own)' : 'Default (none)';
  if (![...$('txtFont').options].some(o => o.value === L.font)) { const o = document.createElement('option'); o.value = o.textContent = L.font; $('txtFont').appendChild(o); }
  $('txtEdit').classList.toggle('has-tpl', !!tp);
  $('txtFont').value = L.font;
  $('txtSize').value = Math.round(L.size * 100); $('txtSizeVal').textContent = $('txtSize').value;
  $('txtBold').setAttribute('aria-pressed', !!L.bold); $('txtItalic').setAttribute('aria-pressed', !!L.italic); $('txtOneLine').setAttribute('aria-pressed', !!L.oneLine);
  $('txtAlign').querySelectorAll('button').forEach(b => { const on = b.dataset.v === L.align; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  $('txtColor').value = L.color; $('txtShadow').checked = !!L.shadow;
  $('txtStroke').value = L.stroke; $('txtStrokeW').value = Math.round(L.strokeW * 100); $('txtStrokeWVal').textContent = $('txtStrokeW').value;
  $('txtBg').value = L.bg; $('txtBgOp').value = L.bgOp; $('txtBgOpVal').textContent = `${L.bgOp}%`;
  if (document.activeElement !== $('txtStart')) $('txtStart').value = fmtT(L.start);
  if (document.activeElement !== $('txtEnd')) $('txtEnd').value = fmtT(L.end);
}
function selectText(id, focus) {
  if (S.textSel !== id) S.txtWord = null;
  S.styleFor = null; // working on a text: styles go on it again
  S.textSel = id;
  showRTab('text'); renderTextUI(); timeline.render();
  const L = curText(); gallery.select(L && L.tpl ? L.tpl : null);
  if (focus) { $('txtText').focus(); $('txtText').select(); }
}
function patchText(p, save = true) {
  const L = curText(); if (!L) return;
  Object.assign(L, p);
  if (L.tpl && !('tpl' in p)) for (const k of Object.keys(p)) if (TPL_LOOK[k]) L.ov = { ...(L.ov || {}), [TPL_LOOK[k]]: true };
  if (p.font && document.fonts) document.fonts.load(`700 40px '${p.font}'`, L.text || 'Aa').catch(() => {});
  renderTextUI(); timeline.render();
  if (save) commit();
}
function addText() {
  const dur = mediaDur(), t = S.image ? 0 : video.currentTime || 0;
  let start = t < 0.3 ? 0 : t, end = S.image ? 1 : dur ? Math.min(dur, start + 3) : start + 3;
  if (dur && end - start < 1) start = Math.max(0, end - 3);
  const last = texts()[texts().length - 1];
  const L = newLayer({ start: +start.toFixed(2), end: +end.toFixed(2), y: 0.22 + (texts().length % 5) * 0.12, tpl: S.textTpl || null,
    ...(last ? { font: last.font, color: last.color, bold: last.bold, stroke: last.stroke, strokeW: last.strokeW, bg: last.bg, bgOp: last.bgOp, size: last.size } : {}) });
  if (S.textTpl) Object.assign(L, withTpl(L, TEMPLATES.find(x => x.id === S.textTpl)));
  S.o.texts = [...texts(), L];
  if (!video.paused) video.pause();
  commit();
  showLTab('text');
  selectText(L.id, true);
}
$('txtAdd').onclick = () => addText();
$('txtAdd2').onclick = () => addText();
$('txtTplPick').onclick = () => { showLTab('tpl'); toast('Pick a style for your text.'); };
$('txtTplClear').onclick = () => { S.textTpl = null; patchText({ tpl: null, ov: {} }); };
TEXT_ANIMS.forEach(([v, n]) => { const o = document.createElement('option'); o.value = v; o.textContent = n; $('txtAnim').appendChild(o); });
$('txtAnim').onchange = e => patchText({ anim: e.target.value || null });
$('txtAnimAll').onclick = () => {
  const L = curText(); if (!L) return;
  S.o.texts = texts().map(x => ({ ...x, anim: L.anim || null }));
  commit(); renderTextUI(); toast('Same animation on every text.');
};
// Break a template text into plain texts (one per line), each with its own font, colours and animation.
$('txtBreak').onclick = () => {
  const L = curText(); const tp = L && TEMPLATES.find(x => x.id === L.tpl); if (!tp) return;
  const pieces = breakApart(L, tp, canvas.width / canvas.height).map(p => newLayer(p));
  if (!pieces.length) return;
  pieces.forEach(p => { if (document.fonts) document.fonts.load(`700 40px '${p.font}'`, p.text).catch(() => {}); });
  const i = texts().findIndex(x => x.id === L.id);
  S.o.texts = [...texts().slice(0, i), ...pieces, ...texts().slice(i + 1)];
  S.textTpl = null;
  commit(); selectText(pieces[0].id);
  toast(`Split into ${pieces.length} text${pieces.length > 1 ? 's' : ''}. Click each one to change its font, colours or animation.`, 4500);
};
$('txtMakeCaps').onclick = () => {
  showLTab('captions');
  if (!S.segments.length && !genRunning) startCaptions();
};
const txtWordColour = (color, save) => {
  const L = curText(); if (!L || S.txtWord == null) return;
  const wc = { ...(L.wordColors || {}) };
  if (color) wc[S.txtWord] = color; else delete wc[S.txtWord];
  patchText({ wordColors: wc }, save);
};
$('txtWordColor').addEventListener('input', e => txtWordColour(e.target.value, false));
$('txtWordColor').addEventListener('change', e => txtWordColour(e.target.value, true));
$('txtWordReset').onclick = () => txtWordColour(null, true);
$('txtText').addEventListener('input', e => patchText({ text: e.target.value }, false));
$('txtText').addEventListener('change', () => commit());
$('txtFont').onchange = e => patchText({ font: e.target.value });
const tbind = (id, key, conv, label) => {
  $(id).addEventListener('input', e => { patchText({ [key]: conv(e.target) }, false); });
  $(id).addEventListener('change', () => commit());
};
tbind('txtSize', 'size', el => +el.value / 100);
tbind('txtColor', 'color', el => el.value);
tbind('txtStroke', 'stroke', el => el.value);
tbind('txtStrokeW', 'strokeW', el => +el.value / 100);
tbind('txtBg', 'bg', el => el.value);
tbind('txtBgOp', 'bgOp', el => +el.value);
$('txtStroke').addEventListener('input', () => { const L = curText(); if (L && !L.strokeW) patchText({ strokeW: 0.12 }, false); });
$('txtBg').addEventListener('input', () => { const L = curText(); if (L && !L.bgOp) patchText({ bgOp: 70 }, false); });
$('txtShadow').onchange = e => patchText({ shadow: e.target.checked });
$('txtBold').onclick = () => { const L = curText(); L && patchText({ bold: !L.bold }); };
$('txtItalic').onclick = () => { const L = curText(); L && patchText({ italic: !L.italic }); };
$('txtOneLine').onclick = () => { const L = curText(); L && patchText({ oneLine: !L.oneLine }); };
$('txtAlign').addEventListener('click', e => { const b = e.target.closest('button'); if (b) patchText({ align: b.dataset.v }); });
const txtTimeIn = which => () => {
  const L = curText(); if (!L) return;
  const v = parseT($(which === 'start' ? 'txtStart' : 'txtEnd').value), dur = mediaDur() || Infinity;
  if (isNaN(v)) { renderTextUI(); return toast('Use a time like 0:03.25 or 3.25'); }
  if (which === 'start') patchText({ start: Math.max(0, Math.min(v, dur - 0.2)), end: Math.max(L.end, Math.min(dur, v + 0.2)) });
  else patchText({ end: Math.min(dur, Math.max(L.start + 0.2, v)) });
};
$('txtStart').onchange = txtTimeIn('start');
$('txtEnd').onchange = txtTimeIn('end');
$('txtHere').onclick = () => {
  const L = curText(); if (!L) return;
  const t = video.currentTime || 0, len = L.end - L.start, dur = mediaDur() || Infinity;
  patchText({ start: +t.toFixed(2), end: +Math.min(dur, t + len).toFixed(2) });
};
$('txtWhole').onclick = () => { const dur = mediaDur(); if (dur) patchText({ start: 0, end: +dur.toFixed(2) }); };
$('txtDup').onclick = () => {
  const L = curText(); if (!L) return;
  const c = newLayer({ ...L, id: undefined, y: Math.min(0.92, L.y + 0.1) });
  c.id = Math.random().toString(36).slice(2, 9);
  S.o.texts = [...texts(), c]; commit(); selectText(c.id);
};
$('txtDel').onclick = () => {
  S.o.texts = texts().filter(l => l.id !== S.textSel); S.textSel = null;
  commit(); renderTextUI(); timeline.render(); toast('Text deleted. Press Ctrl+Z to undo.');
};
// A text can wear one of the caption templates: same renderer as captions, so it looks and animates the
// same, but shown whole (one block) over the text's own time, at its own place and size.
const tplChunkCache = new Map();
function tplChunk(L, still) {
  const key = `${L.text}|${L.start}|${L.end}|${still}|${JSON.stringify(L.wordColors || {})}`;
  let c = tplChunkCache.get(L.id);
  if (!c || c.key !== key) {
    const wc = L.wordColors || {};
    const words = spreadWords(L.text.replace(/\s+/g, ' ').trim(), still ? 0 : L.start, still ? 1 : L.end).map((w, i) => (wc[i] ? { ...w, color: wc[i] } : w));
    c = { key, chunk: buildChunks(words, 999, 9999)[0] || null };
    tplChunkCache.set(L.id, c);
  }
  return c.chunk;
}
// A text wearing a template can still change its font, colours, weight, outline and box (like CapCut):
// whatever the visitor changed (L.ov) replaces the template's value, for every word.
const TPL_LOOK = { font: 'font', color: 'color', bold: 'weight', italic: 'weight', stroke: 'stroke', strokeW: 'stroke', bg: 'bg', bgOp: 'bg', shadow: 'shadow' };
function tplFor(L, tp) {
  const ov = L.ov || {}, r = { ...tp, ...(L.oneLine ? { oneLine: true, layout: null, lines: null } : {}) };
  const drop = keys => { if (r.roles) r.roles = r.roles.map(x => { const y = { ...x }; for (const k of keys) delete y[k]; return y; }); if (r.emph) { r.emph = { ...r.emph }; for (const k of keys) delete r.emph[k]; } };
  if (ov.font) { r.font = L.font; drop(['font']); }
  if (ov.weight) { r.weight = L.bold ? 800 : 500; r.italic = !!L.italic; drop(['weight', 'italic']); }
  if (ov.color) { r.color = L.color; r.gradient = null; r.glow = null; drop(['color', 'gradient', 'glow']); }
  if (ov.stroke) { r.stroke = L.strokeW > 0 ? { w: L.strokeW, c: L.stroke } : null; r.stroke2 = null; drop(['stroke', 'stroke2']); }
  if (ov.bg) r.bg = L.bgOp > 0 ? { c: hexA(L.bg, L.bgOp / 100), pad: 0.3, r: 0.18 } : null;
  if (ov.shadow) r.shadow = L.shadow ? { c: 'rgba(0,0,0,.7)', b: 0.18, x: 0, y: 0.05 } : null;
  return r;
}
/** The fields to set on a text when it takes a template: the template's look, shown in the controls. */
function withTpl(L, t) {
  if (!t) return { tpl: null, ov: {} };
  const st = t.stroke || null;
  return { tpl: t.id, ov: {}, font: t.font || L.font, bold: (t.weight || 700) >= 700, italic: !!t.italic, color: toHex(t.color || '#ffffff'),
    stroke: toHex((st && st.c) || '#000000'), strokeW: st ? st.w : 0, bgOp: 0, shadow: !!t.shadow };
}
function drawTplText(c2, W, H, L, t, still) {
  const tp = TEMPLATES.find(x => x.id === L.tpl);
  const chunk = String(L.text).trim() && tplChunk(L, still);
  if (!tp || !chunk) return null;
  const scale = L.size / (tp.size * 1.6), px = tp.size * Math.min(W, H) * 1.6 * scale;
  c2.save();
  c2.translate((L.x - 0.5) * W, 0);
  drawCaption(c2, W, H, chunk, still ? 1 : t, tplFor(L, tp), { scale, pos: L.y });
  c2.restore();
  return { px, ...tplBox(L, tp, W, H, scale) };
}
// Where a template actually puts the text: drawn once off-screen (final state) and measured, then cached.
const boxCache = new Map(), boxCanvas = document.createElement('canvas');
function tplBox(L, tp, W, H, scale) {
  const key = `${L.text}|${L.tpl}|${L.size}|${L.x}|${L.y}|${W}|${H}|${!!L.oneLine}|${JSON.stringify(L.ov || {})}|${L.font}|${L.bold}|${L.italic}|${L.strokeW}|${L.bgOp}`;
  const hit = boxCache.get(L.id);
  if (hit && hit.key === key) return hit.box;
  const k = Math.min(1, 360 / Math.max(W, H)), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  boxCanvas.width = w; boxCanvas.height = h;
  const c = boxCanvas.getContext('2d', { willReadFrequently: true });
  c.clearRect(0, 0, w, h);
  const words = spreadWords(L.text.replace(/\s+/g, ' ').trim(), 0, 1), chunk = buildChunks(words, 999, 9999)[0];
  c.save(); c.translate((L.x - 0.5) * w, 0);
  if (chunk) drawCaption(c, w, h, chunk, 1, tplFor(L, tp), { scale, pos: L.y });
  c.restore();
  const d = c.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const box = x1 < 0 ? { x0: L.x * W - 20, y0: L.y * H - 20, w: 40, h: 40 } : { x0: x0 / k, y0: y0 / k, w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k };
  boxCache.set(L.id, { key, box });
  return box;
}
/** Draw every text visible at t (all of them on a photo); returns their boxes for hit-testing. */
function drawTexts(c2, W, H, t, still = false) {
  const boxes = [];
  for (const L of layersAt(texts(), t, still)) {
    const b = drawTextAnimated(c2, W, H, L, t, still);
    if (b) boxes.push({ id: L.id, ...b });
  }
  return boxes;
}
// A text's own animation (picked per text) wraps whatever draws it. A template text with its own
// animation is drawn in its final state and moved by this one instead, so the two never stack.
function drawTextAnimated(c2, W, H, L, t, still) {
  const draw = (X, st) => (X.tpl ? drawTplText(c2, W, H, X, t, st) : drawLayer(c2, W, H, X));
  if (still || !L.anim) return draw(L, still);
  const a = animState(L.anim, t, L.start, L.end);
  let X = L;
  if (a.typeP < 1) {
    const n = Math.round(String(L.text).length * a.typeP);
    if (!n) return boxOnly(c2, W, H, L);
    X = { ...L, text: String(L.text).slice(0, n) };
  }
  const cx = L.x * W, cy = L.y * H;
  c2.save();
  c2.globalAlpha *= a.alpha;
  c2.translate(cx + a.dx * W, cy + a.dy * H); c2.scale(a.scale, a.scale); c2.translate(-cx, -cy);
  const b = draw(X, true);
  c2.restore();
  return X === L ? b : boxOnly(c2, W, H, L) || b;
}
// The box of the whole text (for clicking and dragging) without drawing it.
function boxOnly(c2, W, H, L) {
  if (L.tpl) { const tp = TEMPLATES.find(x => x.id === L.tpl); return tp ? { px: L.size * Math.min(W, H), ...tplBox(L, tp, W, H, L.size / (tp.size * 1.6)) } : null; }
  c2.save(); const b = layout(c2, W, H, L); c2.restore(); return b;
}
function deselectText() {
  if (!S.textSel) return false;
  S.textSel = null;
  renderTextUI(); timeline.render(); gallery.select(S.tplId);
  return true;
}
// Template thumbnails use a frame of the user's own video (or photo).
var thumbBg = document.createElement('canvas'), thumbBgReady = false;
thumbBg.width = 400; thumbBg.height = 300;
function updateThumbBg() {
  const src = S.image || (video.readyState >= 2 && video.videoWidth ? video : null);
  if (!src) { thumbBgReady = false; return; }
  const w = src.naturalWidth || src.videoWidth, h = src.naturalHeight || src.videoHeight, k = Math.max(400 / w, 300 / h);
  const x = thumbBg.getContext('2d');
  x.drawImage(src, (400 - w * k) / 2, (300 - h * k) / 2, w * k, h * k);
  x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, 0, 400, 300);
  thumbBgReady = true;
}
video.addEventListener('seeked', updateThumbBg);
video.addEventListener('loadeddata', () => setTimeout(updateThumbBg, 150));

/** Dashed box around the selected text in the preview (never in the export). */
function drawTextSelection() {
  const b = S.textBoxes.find(x => x.id === S.textSel);
  if (!b) return;
  const pad = b.px * 0.3;
  ctx.save(); ctx.setLineDash([8, 6]); ctx.lineWidth = Math.max(2, canvas.width / 400); ctx.strokeStyle = '#a78bfa';
  ctx.strokeRect(b.x0 - pad, b.y0 - pad * 0.6, b.w + pad * 2, b.h + pad * 1.2); ctx.restore();
}

// ---------- one word, its own colour ----------
S.wordSel = null;
const normW = w => String(w).toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
function selWord() { const [si, wi] = S.wordSel || []; return S.wordSel && S.segments[si] && S.segments[si].words[wi] || null; }
function renderWordUI() {
  const w = selWord();
  $('wordGroup').hidden = !w; $('wordTip').hidden = !!w;
  if (!w) return;
  $('wordName').textContent = `“${transform(w.text)}”`;
  $('wordColor').value = toHex(w.color || tpl().hiColor || tpl().color || '#FFE600');
}
/** Set (or clear, with null) the colour of the selected word, or of every same word. */
function colourWord(color, save) {
  const w = selWord(); if (!w) return;
  const all = $('wordAll').checked, key = normW(w.text);
  const [si, wi] = S.wordSel;
  S.segments = S.segments.map((seg, i) => ({ ...seg, words: seg.words.map((x, j) => {
    if (!((i === si && j === wi) || (all && normW(x.text) === key))) return x;
    const y = { ...x }; if (color) y.color = color; else delete y.color; return y;
  }) }));
  timeline.render();
  if (save) commit();
}
$('wordColor').addEventListener('input', e => colourWord(e.target.value, false));
$('wordColor').addEventListener('change', e => colourWord(e.target.value, true));
$('wordReset').onclick = () => { colourWord(null, true); renderWordUI(); };

// ---------- sound effects ----------
/** Hand-placed sounds (with their index) plus the automatic one on every caption. */
function allSounds() {
  const list = (S.o.sfx || []).map((s, index) => ({ ...s, index }));
  if (S.o.sfxAuto) for (const seg of S.segments) list.push({ t: seg.start, id: S.o.sfxAuto, vol: 0.6, auto: true });
  return list.sort((a, b) => a.t - b.t);
}
async function playSound(id, vol = 0.8) {
  try {
    ensureAudioGraph(); await audioCtx.resume();
    const src = audioCtx.createBufferSource(); src.buffer = await soundBuffer(id, audioCtx.sampleRate);
    const g = audioCtx.createGain(); g.gain.value = vol || 0.8;
    src.connect(g); g.connect(audioCtx.destination); g.connect(audioDest); // audioDest: heard by the real-time export too
    src.start();
  } catch { /* audio not available */ }
}
let sfxLastT = 0;
/** During playback, fire each sound whose time was just passed. */
function fireSounds(t) {
  const from = sfxLastT; sfxLastT = t;
  if (video.paused || t <= from || t - from > 0.5) return;
  if (S.exporting && S.exportVia === 'webcodecs') return; // that export mixes them into the file itself
  for (const fx of allSounds()) if (fx.t > from && fx.t <= t) playSound(fx.id, fx.vol);
}

function setSegments(next, keepSel = true) {
  S.segments = C.normalize(next);
  if (!keepSel) S.selected = -1;
  renderSegs(); syncActions(); commit();
}
function seekTo(t) { if (S.mode === 'file' && video.src) video.currentTime = Math.max(0, t + 0.01); }

function renderSegs() {
  $('timeline').hidden = !S.file || S.mode !== 'file' || !!S.image;
  $('editor').classList.toggle('no-tl', $('timeline').hidden || !$('tlDock').contains($('timeline')));
  if (timeline && !$('timeline').hidden) timeline.render();
  const box = $('segs');
  box.innerHTML = '';
  S.active = -1;
  $('segCount').textContent = S.segments.length ? `· ${S.segments.length}` : '';
  $('capBar').hidden = !S.segments.length; // language + words-on-screen only matter once there are captions
  syncCapStyle();
  if (!S.segments.length) {
    const p = document.createElement('div'); p.className = 'empty';
    p.innerHTML = '<strong>No captions yet</strong>';
    const d = document.createElement('p');
    d.textContent = S.image ? 'This is a photo, so there’s nothing to caption. Use Text (left panel) to type on it.' : genRunning ? 'Your captions are being made. They appear here as they’re ready.' : S.mode === 'live' ? 'Start the camera and speak. Live captions appear here.' : S.file ? '' : 'Upload a video first.';
    if (d.textContent) p.appendChild(d);
    if (S.file && !S.image && !genRunning && S.mode === 'file') {
      // The one thing to do next, right where the captions will appear.
      const l = LANGUAGES[$('lang').value];
      const go = document.createElement('button');
      go.className = 'btn btn-primary btn-lg make-btn'; go.id = 'makeCaptions'; go.type = 'button';
      go.textContent = '✨ Make captions';
      go.onclick = () => startCaptions();
      const which = document.createElement('p');
      which.className = 'make-lang';
      which.append(`Spoken language: ${l ? l.name.split(' — ')[0] : 'Auto-detect'} · `);
      const ch = document.createElement('button');
      ch.className = 'link'; ch.type = 'button'; ch.textContent = 'change';
      ch.onclick = () => { $('moreOpts').open = true; $('lang').focus(); $('lang').scrollIntoView({ block: 'center', behavior: 'smooth' }); };
      which.appendChild(ch);
      p.append(go, which);
    }
    box.appendChild(p);
    return;
  }
  S.segments.forEach((seg, i) => {
    const row = document.createElement('div');
    row.className = 'seg' + (i === S.selected ? ' sel' : '');
    row.dataset.i = i;

    const top = document.createElement('div'); top.className = 'seg-top';
    const num = document.createElement('button'); num.className = 'seg-num'; num.textContent = i + 1;
    num.title = 'Play from here'; num.setAttribute('aria-label', `Caption ${i + 1}: jump to ${fmtT(seg.start)}`);
    num.onclick = () => { S.selected = i; seekTo(seg.start + Math.min(0.25, (seg.end - seg.start) / 3)); markSel(); };
    const tin = (val, which) => {
      const inp = document.createElement('input');
      inp.className = 't-in'; inp.value = fmtT(val); inp.inputMode = 'decimal';
      inp.setAttribute('aria-label', `Caption ${i + 1} ${which} time`);
      inp.onchange = () => {
        const v = parseT(inp.value);
        if (isNaN(v)) { inp.value = fmtT(val); return toast('Use a time like 0:03.25 or 3.25'); }
        const s = S.segments[i];
        const next = which === 'start' ? C.setTimes(s, v, Math.max(v + C.MIN_DUR, s.end)) : C.setTimes(s, s.start, v);
        const arr = S.segments.slice(); arr[i] = next; setSegments(arr);
      };
      return inp;
    };
    const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.textContent = '→';
    top.append(num, tin(seg.start, 'start'), arrow, tin(seg.end, 'end'));
    if (seg.approx) {
      const b = document.createElement('span'); b.className = 'est';
      b.textContent = 'est.'; b.title = 'Word timing inside this caption is estimated, not measured by the speech model.';
      top.appendChild(b);
    }
    const acts = document.createElement('span'); acts.className = 'seg-acts';
    const act = (label, title, fn, disabled) => {
      const b = document.createElement('button'); b.className = 'mini'; b.textContent = label; b.title = title;
      b.setAttribute('aria-label', `${title} (caption ${i + 1})`); b.disabled = !!disabled; b.onclick = fn; acts.appendChild(b);
    };
    act('✂', 'Split at cursor', () => {
      const ta = row.querySelector('textarea');
      const before = ta.value.slice(0, ta.selectionStart).trim().split(/\s+/).filter(Boolean).length;
      const at = before > 0 && before < seg.words.length ? before : Math.ceil(seg.words.length / 2);
      const parts = C.split(S.segments[i], at);
      if (!parts) return toast('A one-word caption can’t be split.');
      const arr = S.segments.slice(); arr.splice(i, 1, ...parts); setSegments(arr);
    }, seg.words.length < 2);
    act('⤓', 'Merge with next', () => {
      const arr = S.segments.slice(); arr.splice(i, 2, C.merge(arr[i], arr[i + 1])); setSegments(arr);
    }, i === S.segments.length - 1);
    act('+', 'Add caption after', () => {
      const arr = S.segments.slice(); arr.splice(i + 1, 0, C.newSegmentAfter(arr, i)); S.selected = i + 1; setSegments(arr);
      requestAnimationFrame(() => { const t = $('segs').children[i + 1]; t && t.querySelector('textarea').select(); });
    });
    act('🗑', 'Delete caption', () => {
      const arr = S.segments.slice(); arr.splice(i, 1); setSegments(arr, false); toast('Caption deleted. Press Ctrl+Z to undo.');
    });
    top.appendChild(acts);

    const ta = document.createElement('textarea');
    ta.rows = 1; ta.value = transform(C.segmentText(seg));
    ta.setAttribute('aria-label', `Caption ${i + 1} text`);
    ta.onfocus = () => { S.selected = i; markSel(); if (video.paused) seekTo(seg.start); };
    ta.onchange = () => {
      const next = C.setText(S.segments[i], ta.value);
      const arr = S.segments.slice();
      if (!next) arr.splice(i, 1); else arr[i] = next;
      setSegments(arr);
    };
    row.append(top, ta);
    box.appendChild(row);
  });
}
function markSel() {
  [...$('segs').children].forEach((r, k) => r.classList.toggle('sel', k === S.selected));
}
function highlightSeg(t) {
  const idx = C.indexAt(S.segments, t);
  const cur = idx >= 0 && t <= S.segments[idx].end + 0.6 ? idx : -1;
  if (cur === S.active) return;
  const rows = $('segs').children;
  if (rows[S.active]) rows[S.active].classList.remove('on');
  if (rows[cur] && rows[cur].classList) {
    rows[cur].classList.add('on');
    if (!video.paused && !$('segs').contains(document.activeElement)) rows[cur].scrollIntoView({ block: 'nearest' });
  }
  S.active = cur;
}
$('addSeg').onclick = () => {
  const t = S.mode === 'file' ? video.currentTime || 0 : 0;
  const i = C.indexAt(S.segments, t);
  const arr = S.segments.slice();
  const seg = i < 0 && !arr.length ? C.newSegmentAfter([], -1, 'New caption', t) : C.newSegmentAfter(arr, Math.max(i, -1) < 0 ? -1 : i, 'New caption', t);
  arr.splice(i + 1, 0, seg); S.selected = i + 1; setSegments(arr);
  showTab('captions');
  requestAnimationFrame(() => { const r = $('segs').children[S.selected]; r && r.querySelector('textarea').select(); });
};

function syncActions() {
  const has = S.segments.length > 0;
  $('srtBtn').disabled = !has || S.exporting;
  $('exportBtn').disabled = S.exporting || !(S.file && S.mode === 'file');
  $('exportBtn').textContent = S.image ? (S.o.frame ? 'Download design' : 'Download photo') : 'Export video';
  $('genBtn').disabled = !S.file || !!S.image || S.exporting || genRunning;
}

// ---------- file input ----------
const OK_EXT = /\.(mp4|m4v|mov|webm|mkv|ogv|m4a|mp3|wav|aac|ogg|oga|flac)$/i;
function validateFile(file) {
  if (!file) return 'No file selected.';
  if (!(/^(video|audio)\//.test(file.type) || OK_EXT.test(file.name))) return `“${file.name}” isn’t a video or audio file.`;
  if (file.size > 2 * 1024 ** 3) return `That file is ${fmtBytes(file.size)}. The limit is 2 GB because everything runs inside your browser.`;
  return null;
}
const isImage = f => !!f && (/^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));
async function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  const ok = await new Promise(r => { img.onload = () => r(true); img.onerror = () => r(false); img.src = url; });
  if (!ok || !img.naturalWidth) {
    URL.revokeObjectURL(url);
    toast('This browser can’t open that photo. iPhone HEIC photos: share them as JPG (Most Compatible) first.', 6500);
    return false;
  }
  video.pause(); video.removeAttribute('src'); video.load();
  if (S.fileURL) URL.revokeObjectURL(S.fileURL);
  S.fileURL = url; S.file = file; S.image = img; S.wave = null; S.audioP = null;
  if (!opening) { S.projectId = null; Object.assign(S.o, { clip: null, found: null, texts: [], sfx: [], sfxAuto: null, frame: null, overlay: null }); S.textSel = null; }
  S.segments = []; S.selected = -1;
  document.body.classList.add('photo');
  hist = []; hIdx = -1; commit();
  fitCanvas(img.naturalWidth, img.naturalHeight);
  $('drop').classList.add('hide');
  $('playBtn').disabled = true; $('seek').disabled = true;
  $('meta').textContent = `${file.name} · ${img.naturalWidth}×${img.naturalHeight} · photo · ${fmtBytes(file.size)}`;
  $('time').textContent = 'Photo';
  renderSegs(); syncActions(); refreshLookThumbs();
  if (S.wantThumb) {
    const want = S.wantThumb; S.wantThumb = false;
    setFrame(want.size); commit(); showLTab('thumb');
    if (want.layout) applyThumb(want.layout);
  } else if (!texts().length) addText(); else { renderTextUI(); showLTab('text'); showRTab('text'); }
  renderMedia(); updateThumbBg();
  if (!opening) createProject(file, 'photo');
  status('Photo loaded. Type your text on the left, drag it on the photo, then press Export.');
  return true;
}
async function loadFile(file) {
  if (isImage(file)) return loadImage(file);
  const err = validateFile(file);
  if (err) { toast(err, 5000); return false; }
  const url = URL.createObjectURL(file);
  video.srcObject = null;
  video.src = url;
  video.muted = false;
  const ok = await new Promise(res => {
    const done = v => { clearTimeout(timer); video.onloadedmetadata = video.onerror = null; res(v); };
    const timer = setTimeout(() => done(false), 20000);
    video.onloadedmetadata = () => done(true);
    video.onerror = () => done(false);
  });
  if (!ok) {
    URL.revokeObjectURL(url);
    if (S.fileURL) video.src = S.fileURL;
    toast('This browser can’t play that file. iPhone HEVC videos often need converting to MP4 (H.264) first.', 6500);
    return false;
  }
  // iPhone Safari loads no picture until a video has played once, so the preview stayed black while
  // captions were generated. Play it silently for a moment to get the first frame on screen.
  if (video.readyState < 2) {
    const wasMuted = video.muted;
    video.muted = true;
    const p = video.play();
    const back = () => { video.pause(); video.muted = wasMuted; if (video.currentTime > 0.5) video.currentTime = 0; };
    if (p && p.then) p.then(() => setTimeout(back, 60), () => { video.muted = wasMuted; video.currentTime = 0.001; });
  }
  if (S.fileURL) URL.revokeObjectURL(S.fileURL);
  S.fileURL = url;
  S.file = file;
  S.image = null; document.body.classList.remove('photo');
  // A new file is a new project: its own text, sounds and shorts (the chosen look stays).
  if (!opening) { S.projectId = null; Object.assign(S.o, { clip: null, found: null, texts: [], sfx: [], sfxAuto: null, frame: null, overlay: null }); S.textSel = null; }
  S.decodeFailed = false;
  // Start reading the sound right away, so it's ready by the time captions are requested.
  S.audioP = decodeFull(file); S.audioP.catch(() => {});
  S.wave = null; timeline && timeline.reset();
  S.audioP.then(a => { if (S.file === file) { S.wave = wavePeaks(a); timeline && timeline.render(); } }, () => {});
  S.segments = []; S.selected = -1;
  hist = []; hIdx = -1; commit();
  fitCanvas(video.videoWidth || 1080, video.videoHeight || 1920);
  $('drop').classList.add('hide');
  $('playBtn').disabled = false; $('seek').disabled = false;
  const meta = fileMeta();
  $('meta').textContent = meta;
  status(`Loaded “${file.name}”.`);
  renderMedia(); renderClipUI();
  showLTab(S.wantClips ? 'clips' : 'captions');
  if (!opening) createProject(file, 'video');
  if (video.duration > 600) toast('Long video: transcription and export both take a while. Under 3 minutes works best.', 6000);
  renderSegs(); syncActions();
  return true;
}
function fileMeta() {
  if (!S.file) return '';
  const dims = video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : 'audio only';
  return `${S.file.name} · ${dims} · ${fmt(video.duration)} · ${fmtBytes(S.file.size)}`;
}
function fitCanvas(w, h) {
  if (!(w >= 16 && h >= 16)) return;
  // The preview is shown a few hundred pixels tall: 1280 is sharp on retina and far lighter than 4K.
  const k = Math.min(1, 1280 / Math.max(w, h));
  canvas.width = Math.round(w * k / 2) * 2;
  canvas.height = Math.round(h * k / 2) * 2;
}
$('fileIn').onchange = e => { const files = [...e.target.files]; e.target.value = ''; importFiles(files); };
const box = $('box');
['dragenter', 'dragover'].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); $('drop').classList.remove('over'); }));
box.addEventListener('drop', e => { if (S.mode === 'file' && !S.exporting) importFiles([...e.dataTransfer.files]); });

// ---------- playback ----------
function togglePlay() { if (!video.src || S.exporting || S.mode !== 'file') return; video.paused ? video.play() : video.pause(); }
$('playBtn').onclick = togglePlay;
video.onplay = () => { $('playBtn').textContent = '❚❚ Pause'; $('playBtn').setAttribute('aria-label', 'Pause'); };
video.onpause = () => { $('playBtn').textContent = '▶ Play'; $('playBtn').setAttribute('aria-label', 'Play'); };
$('seek').oninput = e => {
  if (!isFinite(video.duration)) return;
  const c = S.o.clip;
  video.currentTime = c ? c.start + e.target.value / 1000 * (c.end - c.start) : e.target.value / 1000 * video.duration;
};
// Drag captions up/down on the video; a tap without dragging plays/pauses.
{
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (S.exporting || S.mode !== 'file') return;
    const r = canvas.getBoundingClientRect();
    const id = hitLayer(S.textBoxes, (e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height);
    if (id) {
      const L = texts().find(l => l.id === id);
      drag = { text: L, x0: e.clientX, y0: e.clientY, lx: L.x, ly: L.y, moved: false, w: r.width, h: r.height };
      if (S.textSel !== id) selectText(id);
    } else if (S.image && S.o.frame) {
      const f = S.o.frame, rc = photoRect(S.image.naturalWidth, S.image.naturalHeight, canvas.width, canvas.height, f);
      drag = { pan: true, x0: e.clientX, y0: e.clientY, fx: f.x ?? 0.5, fy: f.y ?? 0.5, ow: rc.w - canvas.width, oh: rc.h - canvas.height, k: canvas.width / r.width, moved: false, wasSel: !!S.textSel };
    } else drag = { y0: e.clientY, pos0: S.o.pos ?? baseTpl().pos ?? 0.72, moved: false, wasSel: !!S.textSel };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('dblclick', () => { if (curText()) { $('txtText').focus(); $('txtText').select(); } });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.pan) {
      const dx = (e.clientX - drag.x0) * drag.k, dy = (e.clientY - drag.y0) * drag.k;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      const cl = v => Math.min(1, Math.max(0, v));
      if (Math.abs(drag.ow) > 1) S.o.frame.x = cl(drag.fx - dx / drag.ow);
      if (Math.abs(drag.oh) > 1) S.o.frame.y = cl(drag.fy - dy / drag.oh);
      return;
    }
    if (drag.text) {
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true; canvas.classList.add('dragging');
      drag.text.x = Math.min(0.98, Math.max(0.02, drag.lx + dx / drag.w));
      drag.text.y = Math.min(0.98, Math.max(0.02, drag.ly + dy / drag.h));
      return;
    }
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) < 6) return;
    drag.moved = true;
    canvas.classList.add('dragging');
    const h = canvas.getBoundingClientRect().height || 1;
    S.o.pos = Math.min(0.95, Math.max(0.06, drag.pos0 + dy / h));
    $('pos').value = Math.round(S.o.pos * 100); $('posVal').textContent = `${$('pos').value}%`;
  });
  const end = () => {
    if (!drag) return;
    canvas.classList.remove('dragging');
    if (drag.moved) commit();
    else if (!drag.text) { if (drag.wasSel) deselectText(); else togglePlay(); }
    drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', () => { if (drag) { canvas.classList.remove('dragging'); drag = null; } });
}
const nudgeSize = d => {
  S.o.scale = Math.min(2.5, Math.max(0.4, Math.round(((S.o.scale || 1) + d) * 100) / 100));
  syncControls(); commit();
};
$('szDown').onclick = () => nudgeSize(-0.1);
$('szUp').onclick = () => nudgeSize(0.1);
// Full screen. iPhone Safari can't make a page element full screen, so fill the window instead.
const pseudoFs = on => { box.classList.toggle('pseudo-fs', on); document.body.classList.toggle('no-scroll', on); };
const isFs = () => !!document.fullscreenElement || box.classList.contains('pseudo-fs');
$('fsBtn').onclick = () => {
  if (box.requestFullscreen && document.fullscreenEnabled) box.requestFullscreen().catch(() => pseudoFs(true));
  else pseudoFs(true);
};
$('fsExit').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else pseudoFs(false); };
$('fsPlay').onclick = () => $('playBtn').click();
document.addEventListener('keydown', e => { if (e.key === 'Escape' && box.classList.contains('pseudo-fs')) pseudoFs(false); });
window.__vczIsFs = isFs; window.__vczVideo = video; // tests

// ---------- speech-to-text ----------
// Fast mode switch: shown only when the site owner has set it up; the visitor's choice is remembered.
const useCloud = () => !window.__vczNoCloud && $('cloudMode').checked;
try { if (localStorage.getItem('vcz-cloud') === 'off') $('cloudMode').checked = false; } catch { /* private mode */ }
$('cloudMode').onchange = e => { try { localStorage.setItem('vcz-cloud', e.target.checked ? 'on' : 'off'); } catch { /* ignore */ } };
cloudAvailable().then(on => { $('cloudRow').hidden = !on; });
let worker = null, busyGen = null;
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
    worker.onerror = () => { if (!busyGen) { worker.terminate(); worker = null; } };
  }
  return worker;
}
/** Download and load the speech model in the background while the user picks languages. */
async function preloadModel(quality) {
  if (useCloud() && await cloudAvailable()) return; // Fast mode needs no download
  if (!store.get()) return; // languages not chosen yet: the model to load isn't known, don't download one for nothing
  try { getWorker().postMessage({ type: 'preload', quality, noWordTiming: noWordList(), cpuOnly: cpuOnly() }); } catch { /* not critical */ }
}
// Model builds that couldn't give word timing on this device before (so we don't retry them every time).
const noWordMem = new Set(); // also kept in memory, for private browsing where storage fails
function noWordList() { let saved = []; try { saved = JSON.parse(localStorage.getItem('vcz-noword')) || []; } catch { /* private mode */ } return [...new Set([...saved, ...noWordMem])]; }
// ---- audio extraction ----
// 1) Decode the whole file at the browser's native rate (works for MP4/WebM/M4A in Chrome, Edge, Firefox).
// 2) If the browser can't decode the container (e.g. iPhone .mov in Safari), play the video once,
//    silently, and record its sound in real time.
function toMono16k(chans, rate) {
  const n = chans[0].length, mono = new Float32Array(n);
  for (const ch of chans) for (let i = 0; i < n; i++) mono[i] += ch[i] / chans.length;
  if (rate === 16000) return mono;
  const ratio = rate / 16000, out = new Float32Array(Math.floor(n / ratio));
  const win = Math.max(1, Math.round(ratio));
  for (let i = 0; i < out.length; i++) {
    // Box low-pass over the source samples that map to this output sample, then pick.
    const c = Math.floor(i * ratio); let sum = 0, k = 0;
    for (let j = c; j < c + win && j < n; j++, k++) sum += mono[j];
    out[i] = k ? sum / k : 0;
  }
  return out;
}
// QuickTime (.mov) and MP4 share the same box layout; some browsers only refuse the 'qt  ' brand.
function patchMovBrand(buf) {
  const u = new Uint8Array(buf.slice(0));
  const tag = String.fromCharCode(...u.subarray(4, 8));
  if (tag !== 'ftyp') return null;
  const brand = String.fromCharCode(...u.subarray(8, 12));
  if (brand !== 'qt  ') return null;
  u.set([0x69, 0x73, 0x6f, 0x6d], 8); // 'isom'
  return u.buffer;
}
async function decodeBuffer(data, raw = false) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try {
    const buf = await new Promise((res, rej) => {
      const p = ac.decodeAudioData(data, res, rej);
      if (p && p.then) p.then(res, rej);
    });
    if (raw) return buf;
    const chans = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
    return toMono16k(chans, buf.sampleRate);
  } finally { ac.close && ac.close(); }
}
async function decodeFull(file) {
  const data = await file.arrayBuffer();
  // MP4/MOV: pull the AAC sound track out ourselves and decode only that. Handing a big (4K, 400 MB) video
  // to the browser's audio decoder copies and parses the whole file and froze the editor.
  try {
    const { adts } = extractAacAdts(data);
    return await decodeBuffer(adts.slice().buffer);
  } catch { /* not MP4/AAC, or this browser can't decode it */ }
  try { return await decodeBuffer(data.slice(0)); } catch (err) {
    const patched = patchMovBrand(data);
    if (!patched) throw err;
    return decodeBuffer(patched);
  }
}
let realtimeJob = null;
async function captureRealtime(ui, rate = 3) {
  ensureAudioGraph();
  // iPhone only starts audio after a tap. Without it the video silently never plays.
  await Promise.race([audioCtx.resume(), new Promise(r => setTimeout(r, 1500))]);
  if (audioCtx.state !== 'running') throw new Error('needs-tap');
  const dur = video.duration;
  if (!isFinite(dur) || dur <= 0) throw new Error('Couldn’t read the video length.');
  const sp = audioCtx.createScriptProcessor(4096, 2, 1);
  const chunks = [];
  sp.onaudioprocess = e => {
    if (video.paused) return;
    const ib = e.inputBuffer, chans = [];
    for (let c = 0; c < ib.numberOfChannels; c++) chans.push(new Float32Array(ib.getChannelData(c)));
    chunks.push(chans);
  };
  mediaNode.connect(sp); sp.connect(audioCtx.destination);
  speakerGain.gain.value = 0;
  const job = realtimeJob = { cancelled: false };
  // Play faster than real time. With pitch correction off the browser simply resamples, so the
  // captured audio is exact — it just arrives `rate` times faster (higher pitch), and reading it back at
  // sampleRate / rate restores the original speed and pitch.
  const setRate = r => {
    video.playbackRate = r;
    for (const k of ['preservesPitch', 'webkitPreservesPitch', 'mozPreservesPitch']) if (k in video) video[k] = r === 1;
  };
  setRate(rate);
  try {
    video.pause();
    video.currentTime = 0;
    await new Promise(r => { video.onseeked = () => { video.onseeked = null; r(); }; });
    try {
      await Promise.race([video.play(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    } catch { throw new Error('needs-tap'); }
    const startedAt = Date.now();
    await new Promise((resolve, reject) => {
      const tick = setInterval(() => {
        if (video.currentTime < 0.05 && Date.now() - startedAt > 4000) { clearInterval(tick); reject(new Error('needs-tap')); return; }
        ui.onText(`Reading audio… ${fmt(video.currentTime)} of ${fmt(dur)}`);
        ui.onPct(video.currentTime / dur * 100);
        if (job.cancelled || video.ended) { clearInterval(tick); resolve(); }
      }, 200);
    });
    if (job.cancelled) throw new Error('cancelled');
  } finally {
    video.pause();
    setRate(1);
    sp.disconnect(); try { mediaNode.disconnect(sp); } catch { /* already */ }
    speakerGain.gain.value = 1;
    realtimeJob = null;
  }
  const nch = Math.max(...chunks.map(c => c.length), 1);
  const total = chunks.reduce((a, c) => a + c[0].length, 0);
  const merged = Array.from({ length: nch }, () => new Float32Array(total));
  let o = 0;
  for (const c of chunks) { for (let k = 0; k < nch; k++) merged[k].set(c[Math.min(k, c.length - 1)], o); o += c[0].length; }
  // Each captured sample covers `rate` times more of the video, so the effective rate is sampleRate / rate.
  return toMono16k(merged, audioCtx.sampleRate / rate);
}
async function extractAudio(ui) {
  if (!S.decodeFailed && !window.__vczForceRealtime) {
    const pre = S.audioP; S.audioP = null;
    try { return await (pre || decodeFull(S.file)); } catch { S.decodeFailed = true; }
  }
  const fast = await captureRealtime(ui, 3);
  // Some browsers mute audio at higher speeds; if we got silence, read it once more at normal speed.
  let peak = 0;
  for (let i = 0; i < fast.length; i += 50) peak = Math.max(peak, Math.abs(fast[i]));
  return peak > 0.002 ? fast : captureRealtime(ui, 1);
}

/**
 * Transcribe the loaded file. ui: { onText(text), onPct(pct|null) }
 * Resolves to { words, level } or rejects (Error 'cancelled' on cancel).
 */
async function transcribe({ lang, task, quality }, ui) {
  ui.onText('Reading the audio track…'); ui.onPct(null);
  const audio = await extractAudio(ui);
  window.__vczAudioLength = audio.length;
  if (window.__vczKeepAudio) window.__vczAudio = audio.slice(); // tests only
  let peak = 0;
  for (let i = 0; i < audio.length; i += 50) peak = Math.max(peak, Math.abs(audio[i]));
  if (!audio.length || peak < 0.002) throw new Error('This video seems to have no sound, so there is nothing to transcribe.');
  // Fast mode (only if the site owner set it up and the visitor didn't switch it off).
  if (useCloud() && await cloudAvailable()) {
    const ctrl = new AbortController();
    let cancelled = false;
    try {
      ui.onText('⚡ Fast mode: listening…'); ui.onPct(5);
      const job = cloudTranscribe(audio, {
        lang: lang.whisper ? lang.bcp.split('-')[0] : null, task, signal: ctrl.signal, onWords: ui.onWords,
        onProgress: (d, t) => { ui.onText(`⚡ Fast mode… ${d} of ${t}`); ui.onPct(d / t * 100); },
      });
      const res = await new Promise((resolve, reject) => {
        busyGen = { reject, abort: () => { cancelled = true; ctrl.abort(); reject(new Error('cancelled')); } };
        job.then(resolve, reject);
      });
      busyGen = null;
      return { ...res, cloud: true };
    } catch (err) {
      busyGen = null;
      if (cancelled || err.message === 'cancelled') throw new Error('cancelled');
      console.warn('Fast mode failed, using on-device captions', err);
      ui.onReset && ui.onReset();
      ui.onText(err.message === 'busy' ? 'Fast mode is busy right now, so captions are made on your device…' : 'Fast mode isn’t reachable, so captions are made on your device…');
      S.cloudFailed = err.message;
    }
  }
  // On-device. A second attempt (in a fresh worker) happens only if the first model build couldn't
  // give word timing; the worker has then remembered to skip that build.
  for (let attempt = 0; ; attempt++) {
    try {
      return await runWorker(audio.slice(), { lang, task, quality }, ui);
    } catch (err) {
      if (err.switchBuild && attempt === 0) { ui.onReset && ui.onReset(); ui.onText('Switching to a model with word-by-word timing…'); continue; }
      if (err.gpuStall && attempt < 2) {
        try { localStorage.setItem('vcz-nogpu', '1'); } catch { /* private mode */ }
        noGpuMem = true;
        ui.onReset && ui.onReset(); ui.onText('This computer’s graphics chip is too slow for this, switching to the processor…');
        continue;
      }
      throw err;
    }
  }
}
// If the worker goes silent this long, the phone most likely killed it (out of memory).
const WORKER_SILENCE_MS = 150000;
// On the graphics chip (WebGPU) the first part takes a few seconds; some laptop chips stall instead.
const GPU_STALL_MS = 40000;
let noGpuMem = false;
const cpuOnly = () => { if (noGpuMem || window.__vczNoGpu) return true; try { return localStorage.getItem('vcz-nogpu') === '1'; } catch { return false; } };
function runWorker(audio, { lang, task, quality }, ui) {
  getWorker();
  return new Promise((resolve, reject) => {
    let last = Date.now(), listenStart = Date.now(), device = null, listening = false, partsDone = 0;
    const fail = err => { clearInterval(watch); busyGen = null; if (worker) { worker.terminate(); worker = null; } reject(err); };
    const watch = setInterval(() => {
      if (device === 'webgpu' && listening && !partsDone && Date.now() - listenStart > (window.__vczGpuStallMs || GPU_STALL_MS)) {
        return fail(Object.assign(new Error('graphics chip stalled'), { gpuStall: true }));
      }
      if (Date.now() - last > WORKER_SILENCE_MS) fail(new Error('The speech model stopped responding. The phone may be low on memory: close other apps, or pick “Fast” quality under More options, and try again.'));
    }, 5000);
    busyGen = { reject: err => { clearInterval(watch); reject(err); } };
    worker.onerror = e => {
      // Usually the speech library couldn't be fetched (offline, firewall or an ad-blocker). Start fresh next time.
      fail(new Error(e.message && !/^Script error/.test(e.message) ? e.message : 'Couldn’t load the speech library from cdn.jsdelivr.net (offline, firewall or ad-blocker?).'));
    };
    worker.onmessage = ({ data }) => {
      last = Date.now();
      if (data.type === 'download') {
        const pct = data.loaded / data.total * 100;
        ui.onText(`Loading speech model… ${fmtBytes(data.loaded)} of ${fmtBytes(data.total)} (downloaded only the first time)`); ui.onPct(pct);
      } else if (data.type === 'status') {
        if (/Listening/.test(data.text)) { listenStart = Date.now(); listening = true; ui.onPct(3); }
        ui.onText(data.text);
      }
      else if (data.type === 'model') { device = window.__vczPretendGpu && !cpuOnly() ? 'webgpu' : data.device; } // (pretend: tests only)
      else if (data.type === 'partial') { ui.onWords && ui.onWords(data.words); }
      else if (data.type === 'noWordTiming') { noWordMem.add(data.name); try { localStorage.setItem('vcz-noword', JSON.stringify([...new Set([...noWordList(), data.name])])); } catch { /* private mode */ } }
      else if (data.type === 'transcribe') {
        partsDone = data.done;
        // After the first part we know this phone's speed, so say roughly how long is left.
        const left = data.done && data.done < data.total ? Math.round((Date.now() - listenStart) / data.done * (data.total - data.done) / 1000) : 0;
        ui.onText(`Writing captions… part ${Math.min(data.done + 1, data.total)} of ${data.total}${left ? ` · about ${left} s left` : ''}`); ui.onPct(data.done / data.total * 100);
      } else if (data.type === 'error') { fail(Object.assign(new Error(data.text), { switchBuild: data.switchBuild })); }
      else if (data.type === 'done') { clearInterval(watch); busyGen = null; resolve(data); }
    };
    worker.postMessage({ type: 'transcribe', audio, quality, language: lang.whisper, task, noWordTiming: noWordList(), cpuOnly: cpuOnly(), debugFailWord: window.__vczDebugFailWord }, [audio.buffer]);
  });
}
function cancelTranscribe() {
  if (realtimeJob) { realtimeJob.cancelled = true; return; }
  if (!busyGen) return;
  if (busyGen.abort) busyGen.abort();
  else if (worker) { worker.terminate(); worker = null; }
  const r = busyGen.reject; busyGen = null;
  r(new Error('cancelled'));
}
function applyTranscript(res, captionMode) {
  if (!res.words.length) return false;
  S.hinglish = captionMode === 'hinglish';
  const hint = captionMode === 'english' ? 'en' : (S.genLang && S.genLang.bcp ? S.genLang.bcp.split('-')[0] : null);
  S.textLang = detectTextLang(res.words.map(w => w.text).join(' '), hint);
  S.segments = C.segmentsFromWords(res.words, wordsPerCaption(), 32);
  S.selected = -1;
  syncControls(); renderSegs(); syncActions(); commit();
  return true;
}
function describeResult(res) {
  const n = res.words.length;
  return `Done: ${n} words in ${S.segments.length} captions${res.cloud ? ' (⚡ Fast mode)' : ''}.` +
    (res.level === 'segment' ? ` Word-by-word timing wasn’t available on this device${res.wordError ? ` (${res.wordError})` : ''}, so it’s estimated from the voice (marked “est.”).` : ' Word timing comes from the speech model.') +
    ' Check the text, pick a template, then export.';
}

// One generation runner for both the start screen and the editor. Progress shows in the editor's card.
let genRunning = false;
function genUI(on) {
  $('genOv').hidden = !on;
  $('genOvTap').hidden = true;
  $('genOvCancel').hidden = !on;
  $('genCancel').hidden = !on;
}
async function runGeneration({ lang, mode, quality }) {
  if (!S.file || genRunning) return;
  genRunning = true;
  const task = mode === 'english' && lang.whisper !== 'english' ? 'translate' : 'transcribe';
  S.pendingMode = mode;
  S.genLang = lang.whisper ? lang : null;
  genUI(true); syncActions(); renderSegs(); status('');
  $('genOv').classList.remove('wait');
  $('genOvBar').style.width = '0';
  $('genOvText').textContent = 'Starting…';
  try {
    // Show captions part by part while the rest is still being transcribed.
    const soFar = [];
    S.hinglish = mode === 'hinglish';
    const res = await transcribe({ lang, task, quality }, {
      onReset: () => { soFar.length = 0; S.segments = []; renderSegs(); },
      onWords: words => {
        soFar.push(...words);
        S.segments = C.segmentsFromWords(soFar, wordsPerCaption(), 32);
        renderSegs();
      },
      onText: t => { $('genOvText').textContent = t; },
      onPct: p => { $('genOvBar').style.width = p == null ? '0' : `${p}%`; },
    });
    if (!applyTranscript(res, mode)) {
      // Small on-device models often miss short or noisy Hindi. Say what will actually help.
      const fast = !res.cloud && await cloudAvailable();
      status(`The speech model couldn’t make out any words.${fast ? ' Turn on ⚡ Fast mode under More options and try again (it hears Hindi far better),' : ' Try “Best for Hindi” quality under More options,'} or tap “+ Add” and type the words; timing and styles still work.`);
    }
    else status(describeResult(res));
    genUI(false);
    // Small models sometimes write English for Hindi (or Hinglish) speech. Turn it back into what was asked for.
    if (S.segments.length && mode !== 'english' && lang.whisper && lang.whisper !== 'english' && S.textLang === 'en' && looksEnglish(S.segments.map(C.segmentText).join(' '))) {
      const want = LANGUAGES.find(l => l.whisper === lang.whisper && !!l.hinglish === (mode === 'hinglish'));
      toast(`The speech model wrote English. Converting to ${want.name.split(' — ')[0]}… For exact words, use “Best for Hindi” quality.`, 7000);
      await translateTo(want);
    }
    if (S.wantClips && S.segments.length) { S.wantClips = false; showLTab('clips'); findAndShowClips(); }
  } catch (err) {
    if (err.message === 'needs-tap') {
      // iPhone needs a fresh tap before it will play the video to read its sound.
      $('genOvText').textContent = 'Tap once so your phone lets us read the video’s sound.';
      $('genOvBar').style.width = '0';
      $('genOvTap').hidden = false; $('genOvCancel').hidden = false;
      $('genOv').classList.add('wait');
      $('genOvTap').onclick = () => {
        // Unlock audio and playback inside the tap itself (required on iPhone), then retry.
        ensureAudioGraph();
        audioCtx.resume();
        const p = video.play(); if (p && p.then) p.then(() => video.pause(), () => {});
        S.decodeFailed = true; S.awaitingTap = null;
        $('genOvTap').hidden = true;
        genRunning = false;
        runGeneration({ lang, mode, quality });
      };
      genRunning = false;
      S.awaitingTap = { lang, mode, quality };
      return;
    }
    genUI(false);
    status(err.message === 'cancelled' ? 'Transcription cancelled. Open “Generate captions from audio” to try again.'
      : `Couldn’t generate captions: ${err.message} The first run needs internet to download the speech model.`);
    $('moreOpts').open = true;
  } finally {
    genRunning = false; syncActions();
  }
}
$('genOvCancel').onclick = () => {
  if (S.awaitingTap) { S.awaitingTap = null; genUI(false); status('Cancelled. Open “More options” to generate captions again.'); return; }
  cancelTranscribe();
};

$('genBtn').onclick = () => {
  if (!S.file || genRunning) return;
  if (S.segments.length && !confirm('Replace the current captions with a new transcription?')) return;
  const lang = LANGUAGES[$('lang').value];
  const mode = lang.hinglish || S.hinglish ? 'hinglish' : $('translate').checked ? 'english' : 'native';
  runGeneration({ lang, mode, quality: $('model').value });
};
$('genCancel').onclick = () => cancelTranscribe();

// ---------- live mode ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let cam = null, recog = null, liveT0 = 0, liveFinal = [], liveInterim = [], interimTimes = [], wantLive = false;
const liveNow = () => (performance.now() - liveT0) / 1000;

function setMode(mode) {
  if (S.exporting || mode === S.mode) return;
  S.mode = mode;
  document.body.classList.toggle('live-mode', mode === 'live');
  $('modeFile').classList.toggle('on', mode === 'file');
  $('modeLive').classList.toggle('on', mode === 'live');
  $('fileControls').hidden = mode !== 'file';
  $('meta').hidden = mode !== 'file';
  $('liveControls').hidden = mode !== 'live';
  $('fileOnly').hidden = mode !== 'file';
  if (mode === 'live') {
    S.fileSegments = S.segments;
    S.segments = [];
    video.pause();
    $('drop').classList.add('hide');
    fitCanvas(1080, 1920);
    status(SR ? 'Start the camera and speak. Captions appear as you talk (Chrome, Edge or Safari). Their timing is approximate.'
      : 'Live captions need Chrome, Edge or Safari. Uploading a video works in every browser.');
  } else {
    stopLive();
    $('drop').classList.toggle('hide', !!S.file);
    if (S.file) { video.muted = false; video.src = S.fileURL; }
    S.segments = S.fileSegments || [];
    status(S.file ? '' : 'Upload a video to get started.');
  }
  renderSegs(); syncActions();
}
$('modeFile').onclick = () => setMode('file');
$('srtOut').onclick = () => { if (!S.segments.length) return toast('There are no captions yet.'); $('srtBtn').click(); };
$('liveOpen').onclick = () => { setMode(S.mode === 'live' ? 'file' : 'live'); $('liveOpen').textContent = S.mode === 'live' ? 'Back to video' : 'Live captions'; window.scrollTo({ top: 0, behavior: 'smooth' }); };
// Phones: remember how tall the pinned preview is (so scrolled-to items land below it), and
// un-pin it while typing so the keyboard leaves room for the text field.
{
  const stage = document.querySelector('.stage');
  new ResizeObserver(() => document.documentElement.style.setProperty('--stage-h', `${stage.offsetHeight}px`)).observe(stage);
  const typingField = el => el && el.matches && el.matches('aside textarea, aside input:not([type=checkbox]):not([type=range]):not([type=file])');
  document.addEventListener('focusin', e => document.body.classList.toggle('typing', typingField(e.target)));
  document.addEventListener('focusout', () => setTimeout(() => document.body.classList.toggle('typing', typingField(document.activeElement)), 50));
}
$('modeLive').onclick = () => setMode('live');

$('camBtn').onclick = async () => {
  if (cam) return stopLive();
  try {
    cam = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1080 }, height: { ideal: 1920 }, facingMode: 'user' },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch { return toast('Camera or microphone permission was denied.'); }
  video.removeAttribute('src');
  video.srcObject = cam;
  video.muted = true;
  await video.play();
  fitCanvas(1080, 1920); // Reels are vertical; the camera is centre-cropped to 9:16.
  liveT0 = performance.now(); liveFinal = []; liveInterim = []; interimTimes = [];
  S.segments = []; renderSegs();
  $('camBtn').textContent = 'Stop camera';
  $('recBtn').disabled = false;
  wantLive = true;
  startRecognition();
};

function startRecognition() {
  if (!SR) return;
  recog = new SR();
  recog.lang = LANGUAGES[$('lang').value].bcp;
  recog.continuous = true;
  recog.interimResults = true;
  recog.onresult = e => {
    const now = liveNow();
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        const parts = r[0].transcript.trim().split(/\s+/).filter(Boolean);
        parts.forEach((p, k) => {
          const prev = liveFinal[liveFinal.length - 1];
          const start = Math.max(prev ? prev.start + 0.05 : 0, interimTimes[k] ?? now);
          liveFinal.push({ text: p, start, end: Math.max(start + 0.2, interimTimes[k + 1] ?? now), approx: true });
        });
        interimTimes = [];
      } else interim += r[0].transcript;
    }
    const parts = interim.trim().split(/\s+/).filter(Boolean);
    while (interimTimes.length < parts.length) interimTimes.push(now);
    interimTimes.length = parts.length;
    liveInterim = parts.map((p, k) => ({ text: p, start: interimTimes[k], end: interimTimes[k] + 0.3 }));
  };
  recog.onerror = e => {
    if (e.error === 'not-allowed') { wantLive = false; toast('Microphone permission was denied.'); }
    else if (e.error === 'language-not-supported') toast('This browser can’t do live captions in that language. Try uploading a video instead.');
  };
  // Browsers end recognition after silence. Restart while the camera is on.
  recog.onend = () => { if (wantLive && recog) try { recog.start(); } catch { /* already started */ } };
  try { recog.start(); } catch { /* already started */ }
}
function stopRecognition() {
  if (!recog) return;
  const r = recog; recog = null; r.onend = null;
  try { r.stop(); } catch { /* not running */ }
}
function stopLive() {
  wantLive = false;
  stopRecognition();
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  if (cam) cam.getTracks().forEach(t => t.stop());
  cam = null;
  if (S.mode === 'live') {
    video.srcObject = null;
    if (liveFinal.length) { S.segments = C.segmentsFromWords(liveFinal, wordsPerCaption(), 32, true); renderSegs(); syncActions(); }
  }
  $('camBtn').textContent = 'Start camera';
  $('recBtn').disabled = true;
}

// ---------- recording & export ----------
let recorder = null, audioCtx = null, mediaNode = null, audioDest = null, speakerGain = null;
function pickMime() {
  // MP4 only with H.264 video (plays everywhere). A bare 'video/mp4' can mean VP9-in-MP4, which iPhones can't play,
  // so without H.264 we record WebM instead.
  const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,opus', 'video/mp4;codecs=avc1,opus', 'video/mp4;codecs=avc1',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

$('recBtn').onclick = () => {
  if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
  if (!window.MediaRecorder) return toast('Recording isn’t supported in this browser.');
  const mimeType = pickMime();
  const stream = canvas.captureStream(30);
  cam.getAudioTracks().forEach(t => stream.addTrack(t));
  const parts = [];
  recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  recorder.ondataavailable = e => e.data.size && parts.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(parts, { type: mimeType || 'video/webm' });
    if (blob.size) download(blob, `viralcaptionzone-live.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
    $('recBtn').textContent = '● Record'; $('liveTime').textContent = '';
    toast(blob.size ? 'Recording saved to your downloads.' : 'Recording was empty.');
  };
  recorder.start(500);
  $('recBtn').textContent = '■ Stop';
  $('liveTime').innerHTML = '<span class="live-dot"></span> REC';
};

function ensureAudioGraph() {
  const AC = window.AudioContext || window.webkitAudioContext;
  audioCtx = audioCtx || new AC();
  if (!mediaNode) {
    mediaNode = audioCtx.createMediaElementSource(video);
    speakerGain = audioCtx.createGain();
    audioDest = audioCtx.createMediaStreamDestination();
    mediaNode.connect(speakerGain).connect(audioCtx.destination);
    mediaNode.connect(audioDest);
  }
}

let exportJob = null;
function setExportUI(on) {
  S.exporting = on;
  $('exportOv').hidden = !on;
  document.body.classList.toggle('exporting', on);
  syncActions();
}

// Export canvas: separate from the preview so the file keeps the original resolution.
// One opaque canvas for normal video, one with an alpha channel for transparent captions.
const xcanvasOpaque = document.createElement('canvas');
const xcanvasAlpha = document.createElement('canvas');
const xctxOpaque = xcanvasOpaque.getContext('2d', { alpha: false });
const xctxAlpha = xcanvasAlpha.getContext('2d', { alpha: true });

function exportSizes() {
  const r = srcRect(), vw = r.sw || 1080, vh = r.sh || 1920;
  const long = Math.max(vw, vh), out = [];
  const add = (label, l) => {
    const k = Math.min(1, l / long);
    const w = Math.round(vw * k / 2) * 2, h = Math.round(vh * k / 2) * 2;
    if (!out.some(o => o.w === w)) out.push({ label: `${label} · ${w}×${h}`, w, h });
  };
  add('Original', long); add('1080p', 1920); add('720p', 1280);
  // A short cut from a 1080p video is only 608×1080: offer the full Shorts size too.
  if (S.o.clip) {
    const z = aspectSize(S.o.clip.aspect);
    if (!out.some(o => o.w === z.w && o.h === z.h)) out.push({ label: `${S.o.clip.aspect || '9:16'} · ${z.w}×${z.h}`, w: z.w, h: z.h });
  }
  return out;
}
const alphaMime = () => ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';

function openExportDialog() {
  if (S.exporting || !S.file) return;
  if (S.image) return exportPhoto();
  const sizes = exportSizes();
  const sel = $('xRes'); sel.innerHTML = '';
  sizes.forEach((o, i) => { const opt = document.createElement('option'); opt.value = i; opt.textContent = o.label + (i === 0 && sizes.length > 1 && Math.max(o.w, o.h) > 1920 ? ' (slow)' : ''); sel.appendChild(opt); });
  // Instagram, YouTube Shorts and WhatsApp show at most 1080p, and 4K export is 4× slower: default to 1080p.
  const z = S.o.clip && aspectSize(S.o.clip.aspect);
  const hd = z ? sizes.findIndex(o => o.w === z.w && o.h === z.h) : sizes.findIndex(o => Math.max(o.w, o.h) === 1920);
  if (hd > 0) sel.value = hd;
  const hasAlpha = !!alphaMime();
  $('xKindAlpha').disabled = !hasAlpha;
  $('xAlphaNote').textContent = hasAlpha ? 'WebM with a real transparent background. Works in Premiere, DaVinci Resolve, After Effects and Final Cut (with a plug-in).'
    : 'Not available in this browser (Safari can’t record WebM). Use green screen instead, or open this site in Chrome.';
  if (!hasAlpha && $('xKindAlpha').checked) $('xKindVideo').checked = true;
  const long = Math.max(video.videoWidth, video.videoHeight);
  $('xNote').textContent = `Takes about ${fmt(video.duration)} (it records in real time). Keep this tab open.` +
    (long > 1920 ? ' Original 4K needs a fast computer; choose 1080p if the export stutters.' : '');
  $('xDlg').showModal ? $('xDlg').showModal() : $('xDlg').setAttribute('open', '');
}
$('exportBtn').onclick = openExportDialog;
async function exportPhoto() {
  const img = S.image, f = S.o.frame, k = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = f ? f.w : Math.round(img.naturalWidth * k), h = f ? f.h : Math.round(img.naturalHeight * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  drawPhoto(x, w, h);
  drawTexts(x, w, h, 0, true);
  const png = /png/i.test(S.file.type);
  const blob = await new Promise(r => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.95));
  if (!blob) return toast('Couldn’t save the photo in this browser.');
  const name = `${S.file.name.replace(/\.[^.]+$/, '')}-${f ? 'thumbnail' : 'text'}.${png ? 'png' : 'jpg'}`;
  download(blob, name);
  status(`Saved “${name}” (${w}×${h}, ${fmtBytes(blob.size)}).`);
}
$('xClose').onclick = () => $('xDlg').close();
$('xGo').onclick = e => {
  e.preventDefault();
  const kind = document.querySelector('input[name=xKind]:checked').value;
  const size = exportSizes()[+$('xRes').value];
  $('xDlg').close();
  exportVideo({ kind, size });
};

async function exportVideo({ kind = 'video', size, batch } = {}) {
  if (S.exporting || !S.file) return;
  if (!window.MediaRecorder || !xcanvasOpaque.captureStream) return toast('Export needs MediaRecorder, which this browser doesn’t support. Try Chrome, Edge, Firefox or Safari.', 6000);
  const overlay = kind !== 'video';
  const mimeType = kind === 'alpha' ? alphaMime() : pickMime();
  if (!mimeType) return toast('This browser can’t record video. Try Chrome, Edge, Firefox or Safari.', 6000);
  // A short: only its part of the video. Otherwise the whole thing.
  const part = S.o.clip || S.o.trim;
  const range = part ? { start: part.start, end: Math.min(part.end, video.duration) } : { start: 0, end: video.duration };
  const dur = range.end - range.start;
  if (!isFinite(dur) || dur <= 0) return toast('Couldn’t read the video length, so it can’t be exported.');
  if (!S.segments.length && !texts().length && !confirm(overlay ? 'There are no captions yet, so this file would be empty. Continue anyway?' : 'There are no captions yet. Export the video without captions?')) return;
  if (dur > 300 && !confirm(`This video is ${fmt(dur)} long. Export runs in real time, so it will take about ${fmt(dur)} and the tab must stay open. Continue?`)) return;

  size = size || exportSizes()[0];
  const xcanvas = kind === 'alpha' ? xcanvasAlpha : xcanvasOpaque;
  const xctx = kind === 'alpha' ? xctxAlpha : xctxOpaque;
  xcanvas.width = size.w; xcanvas.height = size.h;
  setExportUI(true);
  $('exportTitle').textContent = batch ? `Exporting short ${batch}…` : kind === 'video' ? 'Exporting video…' : kind === 'alpha' ? 'Exporting transparent captions…' : 'Exporting green-screen captions…';
  $('exportBar').style.width = '0%';
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  $('exportText').textContent = `Preparing ${ext.toUpperCase()} · ${size.w}×${size.h}…`;
  const job = exportJob = { cancelled: false, hidden: false };
  const t0 = tpl(), opts = { scale: S.o.scale, pos: S.o.pos ?? undefined, fill: video };
  const paint = t => {
    if (kind === 'alpha') xctx.clearRect(0, 0, size.w, size.h);
    else if (kind === 'green') { xctx.fillStyle = '#00FF00'; xctx.fillRect(0, 0, size.w, size.h); }
    else if (video.readyState >= 2 && video.videoWidth) drawVideo(xctx, size.w, size.h);
    else { xctx.fillStyle = '#0d0d16'; xctx.fillRect(0, 0, size.w, size.h); }
    drawCaption(xctx, size.w, size.h, findChunk(fileChunks(), t), t, t0, overlay ? { ...opts, fill: null } : opts);
    drawTexts(xctx, size.w, size.h, t);
  };
  let stopClock = null;
  try {
    const srcBps = S.file.size * 8 / video.duration;
    // Best quality first: WebCodecs (H.264 at ≥ source bitrate, original audio copied as-is).
    // Fastest first: decode → draw → encode without real-time playback (H.264 MP4). Sound effects need the
    // real-time mix below, so they skip this path for now.
    if (kind === 'video' && !window.__vczNoFast && !allSounds().some(f => f.t >= range.start && f.t < range.end)) {
      S.exportVia = 'fast';
      const bitrate = Math.round(Math.min(80e6, Math.max(srcBps * 1.5, size.w * size.h * 30 * 0.15, 4e6)));
      const t0x = performance.now();
      const fast = await exportFast({
        file: S.file, width: size.w, height: size.h, start: range.start, end: range.end, canvas: xcanvas, bitrate, job,
        draw: (src, t, w, h) => {
          drawVideo(xctx, size.w, size.h, src, w, h);
          drawCaption(xctx, size.w, size.h, findChunk(fileChunks(), t), t, t0, opts);
          drawTexts(xctx, size.w, size.h, t);
        },
        onProgress: (p, t) => {
          $('exportBar').style.width = `${(p * 100).toFixed(1)}%`;
          $('exportText').textContent = `${Math.round(p * 100)}% · ${fmt(t)} of ${fmt(dur)} · ${size.w}×${size.h} · fast MP4`;
        },
      }).catch(err => { console.warn('Fast export failed, trying the real-time path', err); return null; });
      if (fast === 'cancelled' || job.cancelled) { status('Export cancelled.'); return; }
      if (fast) {
        const name = `${S.file.name.replace(/\.[^.]+$/, '')}-${S.o.clip ? shortTag(range) : 'captioned'}.mp4`;
        download(fast, name);
        const secs = (performance.now() - t0x) / 1000;
        status(`Exported “${name}” (${fmtBytes(fast.size)}, ${size.w}×${size.h}) in ${secs.toFixed(1)} s.`);
        window.__vczLastExport = 'fast';
        return;
      }
    }
    if (kind === 'video' && !window.__vczNoWebCodecs) {
      const sounds = allSounds().filter(f => f.t >= range.start && f.t < range.end).map(f => ({ ...f, t: f.t - range.start }));
      S.exportVia = 'webcodecs';
      const wc = await exportWebCodecs({
        video, file: S.file, canvas: xcanvas, paint, dur, start: range.start, srcBps, job, mixAudio: sounds.length > 0 || !!S.o.clip,
        decodePcm: async () => {
          let raw = null;
          const data = await S.file.arrayBuffer();
          try { raw = await decodeBuffer(data.slice(0), true); } catch {
            try { raw = await decodeBuffer(extractAacAdts(data).adts.slice().buffer, true); } catch { /* no decodable sound */ }
          }
          if (raw && S.o.clip) raw = sliceBuffer(raw, range.start, range.end);
          return sounds.length ? mixWithSfx(raw, dur, sounds, raw ? raw.sampleRate : 48000) : raw;
        },
        onProgress: (p, t) => {
          $('exportBar').style.width = `${(p * 100).toFixed(1)}%`;
          $('exportText').textContent = `${Math.round(p * 100)}% · ${fmt(t)} of ${fmt(dur)} · ${size.w}×${size.h} · original-quality MP4`;
        },
      }).catch(err => { console.warn('WebCodecs export failed, using MediaRecorder', err); return null; });
      if (wc === 'cancelled' || job.cancelled) { status('Export cancelled.'); return; }
      if (wc) {
        const name = `${S.file.name.replace(/\.[^.]+$/, '')}-${S.o.clip ? shortTag(range) : 'captioned'}.mp4`;
        download(wc, name);
        status(`Exported “${name}” (${fmtBytes(wc.size)}, ${size.w}×${size.h}, original audio kept).`);
        window.__vczLastExport = 'webcodecs';
        return;
      }
      video.currentTime = 0;
    }
    window.__vczLastExport = 'mediarecorder';
    S.exportVia = 'mediarecorder';
    // Match the source: bitrate from the file (capped), frame rate from the decoded frames.
    const k = (size.w * size.h) / ((video.videoWidth || size.w) * (video.videoHeight || size.h));
    const vbr = Math.round(Math.min(60e6, Math.max(4e6, srcBps * 1.15 * k)));
    const useRVFC = !overlay && !!video.requestVideoFrameCallback;
    const stream = useRVFC ? xcanvas.captureStream() : xcanvas.captureStream(30);

    if (!overlay) {
      ensureAudioGraph();
      await audioCtx.resume();
      speakerGain.gain.value = 0; // silent while exporting; the audio still goes into the file
      audioDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
      video.pause();
      video.currentTime = range.start;
      await new Promise(r => { video.onseeked = () => { video.onseeked = null; r(); }; });
    }
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: vbr, ...(overlay ? {} : { audioBitsPerSecond: 192000 }) });
    const parts = [];
    rec.ondataavailable = e => e.data.size && parts.push(e.data);
    const stopped = new Promise(r => { rec.onstop = r; });
    const onVis = () => { if (document.hidden) job.hidden = true; };
    document.addEventListener('visibilitychange', onVis);
    let clock;
    const ended = new Promise(r => { job.finish = r; });
    if (overlay) {
      // Captions only: no video to play, so drive time from the clock.
      const start = performance.now();
      clock = () => (performance.now() - start) / 1000;
      paint(0);
      const timer = setInterval(() => { const t = clock(); paint(range.start + Math.min(t, dur)); if (t >= dur) job.finish(); }, 1000 / 30);
      stopClock = () => clearInterval(timer);
      rec.start(1000);
    } else {
      clock = () => video.currentTime - range.start;
      video.onended = () => job.finish();
      if (useRVFC) {
        const step = () => { if (S.exporting) { if (video.currentTime >= range.end) return job.finish(); paint(video.currentTime); video.requestVideoFrameCallback(step); } };
        video.requestVideoFrameCallback(step);
      } else {
        const timer = setInterval(() => { if (video.currentTime >= range.end) job.finish(); paint(video.currentTime); }, 1000 / 30);
        stopClock = () => clearInterval(timer);
      }
      paint(range.start);
      rec.start(1000);
      await video.play();
    }
    const tick = setInterval(() => {
      const p = Math.min(1, clock() / dur);
      $('exportBar').style.width = `${(p * 100).toFixed(1)}%`;
      $('exportText').textContent = `${Math.round(p * 100)}% · ${fmt(clock())} of ${fmt(dur)} · ${size.w}×${size.h}${job.hidden ? ' · tab was hidden, some frames may be missing' : ''}`;
    }, 250);
    await ended;
    clearInterval(tick);
    stopClock && stopClock();
    video.onended = null;
    document.removeEventListener('visibilitychange', onVis);
    video.pause();
    rec.stop();
    await stopped;
    stream.getVideoTracks().forEach(t => t.stop());
    if (job.cancelled) { status('Export cancelled.'); return; }
    let blob = new Blob(parts, { type: mimeType.split(';')[0] });
    if (!blob.size) throw new Error('The recorder produced an empty file.');
    // MediaRecorder WebM files have no duration header, so players can't show length or seek. Patch it in.
    if (ext === 'webm' && window.ysFixWebmDuration) {
      $('exportText').textContent = 'Finishing file…';
      blob = await window.ysFixWebmDuration(blob, dur * 1000, { logger: false });
    }
    const suffix = S.o.clip ? shortTag(range) : kind === 'video' ? 'captioned' : kind === 'alpha' ? 'captions-transparent' : 'captions-greenscreen';
    const name = `${S.file.name.replace(/\.[^.]+$/, '')}-${suffix}.${ext}`;
    download(blob, name);
    status(`Exported “${name}” (${fmtBytes(blob.size)}, ${size.w}×${size.h}).` +
      (kind === 'green' ? ' In CapCut or InShot: add it as an overlay, then use Chroma Key on the green.' : '') +
      (kind === 'video' && ext === 'webm' ? ' This browser can only record WebM. YouTube accepts it; for Instagram or iPhone, export from Chrome (126+) or Safari to get MP4.' : ''));
  } catch (err) {
    status(`Export failed: ${err.message || err}`);
  } finally {
    stopClock && stopClock();
    if (speakerGain) speakerGain.gain.value = 1;
    exportJob = null;
    setExportUI(false);
    video.currentTime = S.o.clip ? S.o.clip.start : 0;
  }
}
$('exportCancel').onclick = () => { S.batchCancelled = true; if (exportJob) { exportJob.cancelled = true; exportJob.cancel && exportJob.cancel(); exportJob.finish && exportJob.finish(); } };

// ---------- translation ----------
// Chrome (desktop, 138+) has a free on-device translator. Every other browser (iPhone Safari, Android,
// Firefox) uses the free MyMemory service, which receives the caption text only, never the video.
const hasTranslator = () => 'Translator' in self;
LANGUAGES.forEach((l, i) => {
  if (!l.whisper && !l.hinglish) return;
  const o = document.createElement('option');
  o.value = i; o.textContent = l.name;
  $('trTarget').appendChild(o);
});
$('trTarget').value = String(LANGUAGES.findIndex(l => l.whisper === 'english'));
$('trNote').textContent = hasTranslator()
  ? 'Translates on your device with Chrome’s built-in translator. Timing is kept; word highlights inside each caption become estimated.'
  : 'Translates the caption text with the free MyMemory service (your video is never sent). Hindi ↔ Hinglish works offline. Timing is kept; word highlights become estimated.';
$('trOpen').onclick = () => { $('moreOpts').open = true; $('trHead').scrollIntoView({ block: 'start', behavior: 'smooth' }); };
// Keep the caption-language picker showing what the captions are in now.
function syncLangPicker() {
  const code = S.textLang || (S.genLang && S.genLang.bcp.split('-')[0]);
  if (!code) return;
  const i = LANGUAGES.findIndex(l => l.whisper && l.bcp.split('-')[0] === code && !!l.hinglish === !!(S.hinglish && code === 'hi'));
  if (i >= 0) $('trTarget').value = String(i);
}
// Picking a language applies it right away.
$('trTarget').onchange = () => $('trBtn').click();

// The language the caption text is really in, judged from its script.
function sourceLangCode() {
  const l = LANGUAGES[$('lang').value];
  const hint = S.textLang || (l && l.whisper ? l.bcp.split('-')[0] : null);
  return detectTextLang(S.segments.map(C.segmentText).join(' '), hint);
}
async function getTranslator(src, tgt) {
  if (hasTranslator()) {
    try {
      const avail = await self.Translator.availability({ sourceLanguage: src, targetLanguage: tgt });
      if (avail !== 'unavailable') {
        status('Preparing translator…');
        const tr = await self.Translator.create({
          sourceLanguage: src, targetLanguage: tgt,
          monitor(m) { m.addEventListener('downloadprogress', e => status(`Downloading translator… ${Math.round((e.loaded || 0) * 100)}%`, (e.loaded || 0) * 100)); },
        });
        return t => tr.translate(t);
      }
    } catch { /* fall through to the online service */ }
  }
  return t => onlineTranslate(t, src, tgt);
}
$('trBtn').onclick = () => translateTo(LANGUAGES[$('trTarget').value]);
async function translateTo(target) {
  const tgt = target.bcp.split('-')[0];
  if (!S.segments.length) return toast('There are no captions to translate yet.');
  const src = sourceLangCode();
  if (src === tgt) {
    if (!!target.hinglish !== S.hinglish) { S.hinglish = !!target.hinglish; S.textLang = src; syncControls(); renderSegs(); commit(); }
    return toast(target.hinglish ? 'Showing Hindi as Hinglish.' : tgt === 'hi' ? 'Showing Hindi in Devanagari.' : 'Captions are already in that language.');
  }
  const btn = $('trBtn');
  btn.disabled = true;
  try {
    const translate = await getTranslator(src, tgt);
    const groups = C.sentenceGroups(S.segments);
    const next = [];
    for (let g = 0; g < groups.length; g++) {
      status(`Translating… ${g + 1} of ${groups.length}`, (g / groups.length) * 100);
      const text = groups[g].map(i => C.segmentText(S.segments[i])).join(' ');
      next.push(...C.applyTranslation(S.segments, groups[g], await translate(text)));
    }
    S.textLang = tgt;
    S.hinglish = !!target.hinglish;
    setSegments(next);
    syncControls();
    status(`Translated to ${target.name.split(' — ')[0]}. Press Undo to go back.`);
  } catch (err) {
    status(`Translation failed: ${err.message || err}`);
  } finally {
    btn.disabled = false;
  }
}

// ---------- SRT ----------
$('srtBtn').onclick = () => {
  download(new Blob([C.toSRT(S.segments, transform)], { type: 'text/plain' }), `${S.file ? S.file.name.replace(/\.[^.]+$/, '') : 'captions'}.srt`);
};
$('srtIn').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const segs = C.parseSRT(await f.text());
  if (!segs.length) return toast('No captions found in that file.');
  if (S.segments.length && !confirm('Replace the current captions with this file?')) return;
  S.selected = -1;
  setSegments(segs);
  status(`Imported ${segs.length} captions. Word timing inside each caption is estimated.`);
};

// ---------- render loop ----------
function drawPlaceholder() {
  const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  g.addColorStop(0, '#24203a'); g.addColorStop(1, '#0d0d16');
  ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
}
let chunkCache = { key: null, chunks: [] };
function fileChunks() {
  const key = S.segments;
  const max = wordsPerCaption();
  if (chunkCache.key !== key || chunkCache.hinglish !== S.hinglish || chunkCache.max !== max) chunkCache = { key, max, hinglish: S.hinglish, chunks: C.toChunks(S.segments, transform, max) };
  return chunkCache.chunks;
}
// Sample words shown on the video until real captions exist, so template choice is visible immediately.
const SAMPLE_TEXT = { hinglish: 'aapke captions bilkul aise dikhenge', native: 'your captions will look like this', english: 'your captions will look like this' };
let sampleCache = { key: null, chunks: [] };
function sampleChunks() {
  const lang = LANGUAGES[$('lang').value] || {};
  const text = S.pendingMode === 'hinglish' || S.hinglish ? SAMPLE_TEXT.hinglish
    : lang.whisper === 'hindi' && S.pendingMode !== 'english' ? 'आपके कैप्शन बिल्कुल ऐसे दिखेंगे' : SAMPLE_TEXT.native;
  const key = text + wordsPerCaption();
  if (sampleCache.key !== key) sampleCache = { key, chunks: C.toChunks([C.makeSegment(C.spreadWords(text, 0.15, 3.6))], t => t, wordsPerCaption()) };
  return sampleCache.chunks;
}
function drawFrame() {
  const W = canvas.width, H = canvas.height;
  const t0 = tpl(), opts = { scale: S.o.scale, pos: S.o.pos ?? undefined, fill: video };
  if (S.mode === 'file' && S.image) {
    const img = S.image, f = S.o.frame, fw = f ? f.w : img.naturalWidth, fh = f ? f.h : img.naturalHeight;
    if (Math.abs(W / H - fw / fh) > 0.01) fitCanvas(fw, fh);
    drawPhoto(ctx, canvas.width, canvas.height);
    S.textBoxes = drawTexts(ctx, canvas.width, canvas.height, 0, true);
    drawTextSelection();
    return 0;
  }
  if (S.mode === 'file') {
    if (S.exporting) return video.currentTime; // the export canvas does the work; the preview is covered
    const vw = video.videoWidth, vh = video.videoHeight;
    const r = srcRect();
    if (vw && Math.abs(W / H - r.sw / r.sh) > 0.01) fitCanvas(r.sw, r.sh);
    if (video.readyState >= 2 && vw) drawVideo(ctx, canvas.width, canvas.height); else drawPlaceholder();
    const t = video.currentTime;
    if (!S.segments.length && S.file && !texts().length) {
      const st = (performance.now() / 1000) % 4.2;
      drawCaption(ctx, canvas.width, canvas.height, findChunk(sampleChunks(), st), st, t0, opts);
      const fs = Math.max(11, canvas.width * 0.028);
      ctx.save(); ctx.font = `600 ${fs}px Inter, sans-serif`; ctx.textBaseline = 'top';
      const label = genRunning ? 'Sample text · your captions are being generated' : 'Sample text · no captions yet';
      const w = ctx.measureText(label).width + fs;
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(fs * 0.6, fs * 0.6, w, fs * 1.6);
      ctx.fillStyle = '#fff'; ctx.fillText(label, fs * 1.1, fs * 0.9); ctx.restore();
    } else {
      drawCaption(ctx, canvas.width, canvas.height, findChunk(fileChunks(), t), t, t0, opts);
    }
    S.textBoxes = drawTexts(ctx, canvas.width, canvas.height, t);
    drawTextSelection();
    return t;
  }
  if (cam && video.readyState >= 2) {
    // Mirror the selfie view, the way creators expect to see themselves.
    ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
    const vw = video.videoWidth, vh = video.videoHeight, k = Math.max(W / vw, H / vh);
    ctx.drawImage(graded(video, vw, vh), (W - vw * k) / 2, (H - vh * k) / 2, vw * k, vh * k);
    ctx.restore();
    const t = liveNow();
    const words = liveFinal.slice(-40).concat(liveInterim).map(w => ({ ...w, text: transform(w.text) }));
    drawCaption(ctx, W, H, findChunk(buildChunks(words, wordsPerCaption()), t), t, t0, opts);
  } else drawPlaceholder();
  return 0;
}
function loop() {
  const t = drawFrame();
  if (S.mode === 'file' && isFinite(video.duration) && video.duration) {
    const c = S.o.clip || S.o.trim;
    if (c && !S.exporting) {
      // A short plays only its own part, on a loop.
      if (!video.paused && t >= c.end - 0.03) { video.pause(); video.currentTime = c.start; }
      $('time').textContent = `${fmt(Math.max(0, t - c.start))} / ${fmt(c.end - c.start)}`;
      if (document.activeElement !== $('seek')) $('seek').value = Math.round(Math.max(0, t - c.start) / (c.end - c.start) * 1000);
    } else {
      $('time').textContent = `${fmt(t)} / ${fmt(video.duration)}`;
      if (!S.exporting && document.activeElement !== $('seek')) $('seek').value = Math.round(t / video.duration * 1000);
    }
    highlightSeg(t);
    timeline && !$('timeline').hidden && timeline.tick(t);
    fireSounds(t);
  }
  requestAnimationFrame(loop);
}

// ---------- keyboard ----------
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); }
  else if (e.key === 'Escape' && !typing && S.textSel) deselectText();
  else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && S.textSel && !$('timeline').contains(document.activeElement)) { e.preventDefault(); $('txtDel').click(); }
  else if (e.key === ' ' && !typing && document.activeElement.tagName !== 'BUTTON' && !$('editor').hidden) { e.preventDefault(); togglePlay(); }
});

// ---------- long video → shorts ----------
const srcRect = (vw = video.videoWidth, vh = video.videoHeight) => (S.o.clip && vw ? cropRect(vw, vh, ASPECTS[S.o.clip.aspect] || 9 / 16, S.o.clip.x ?? 0.5) : { sx: 0, sy: 0, sw: vw, sh: vh });
/** Draw a video frame (graded, and cropped to 9:16 for a short) to fill W×H. src: the <video> or a decoded frame. */
function drawVideo(c2, W, H, src = video, vw = video.videoWidth, vh = video.videoHeight) {
  if (!S.o.clip) { c2.drawImage(graded(src, W, H), 0, 0, W, H); return; }
  const r = srcRect(vw, vh), k = W / r.sw;
  const g = graded(src, Math.round(vw * k), Math.round(vh * k));
  if (g === src) c2.drawImage(src, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
  else c2.drawImage(g, r.sx * k, r.sy * k, r.sw * k, r.sh * k, 0, 0, W, H);
}
function sliceBuffer(buf, from, to) {
  const sr = buf.sampleRate, a = Math.max(0, Math.floor(from * sr)), b = Math.min(buf.length, Math.ceil(to * sr));
  const out = new AudioBuffer({ length: Math.max(1, b - a), numberOfChannels: buf.numberOfChannels, sampleRate: sr });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b), c);
  return out;
}
/** How loud a stretch is compared with the whole video (0..1), from the waveform. */
function loudness(from, to) {
  const w = S.wave; if (!w || !w.length) return 0.5;
  const step = 0.02, a = Math.floor(from / step), b = Math.min(w.length, Math.ceil(to / step));
  let sum = 0, all = 0;
  for (let i = a; i < b; i++) sum += w[i];
  for (let i = 0; i < w.length; i++) all += w[i];
  const m = sum / Math.max(1, b - a), g = all / w.length || 1;
  return Math.max(0, Math.min(1, m / g / 2));
}
video.addEventListener('play', () => {
  const c = S.o.clip;
  if (c && !S.exporting && (video.currentTime < c.start - 0.05 || video.currentTime >= c.end - 0.05)) video.currentTime = c.start;
});
async function findAndShowClips() {
  if (S.image) return toast('Shorts need a video, not a photo.');
  if (!S.file) return toast('Upload a long video first.');
  if (!S.segments.length) {
    if (genRunning) { S.wantClips = true; return toast('Captions are being made. Clips appear right after.'); }
    S.wantClips = true;
    toast('Making captions first (clips are picked from what is said)…', 5000);
    showLTab('captions');
    return startCaptions();
  }
  const [a, b] = $('clipLen').value.split('-').map(Number);
  let clips = findClips(S.segments, { minLen: a, maxLen: b, ideal: (a + b) / 2, count: +$('clipCount').value, energy: loudness });
  let ai = false;
  if (clips.length && await aiHooksOn()) {
    $('clipFind').disabled = true; $('clipNote').textContent = 'Writing hooks with AI…';
    try { const r = await aiHooks(clips); if (r) { clips = r; ai = true; } } finally { $('clipFind').disabled = false; }
  }
  S.o.found = clips;
  commit();
  renderClipUI();
  $('clipNote').textContent = clips.length
    ? `${clips.length} clip${clips.length > 1 ? 's' : ''} found${ai ? ', hooks written by AI' : ''}. Best first. Edit the hook, preview, then export each one.`
    : `No clips found: this video needs at least ${a} seconds of continuous speech. Try a shorter length.`;
}
// AI hooks (only when the site owner has switched them on; sends caption text, never media).
let aiHooksP = null;
const aiHooksOn = () => (window.__vczNoCloud ? Promise.resolve(false) : aiHooksP || (aiHooksP = fetch('api/clips', { cache: 'no-store' }).then(r => (r.ok ? r.json() : {})).then(j => !!j.enabled).catch(() => false)));
async function aiHooks(clips) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch('api/clips', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal, body: JSON.stringify({ clips: clips.map(c => ({ start: c.start, end: c.end, text: c.text })) }) });
    if (!r.ok) return null;
    const { clips: rated } = await r.json();
    if (!rated || !rated.length) return null;
    const out = clips.map(c => ({ ...c }));
    for (const x of rated) Object.assign(out[x.i], { score: x.score, title: x.hook || out[x.i].title, why: [x.why || 'AI pick', ...(out[x.i].why || [])].filter(Boolean).slice(0, 3), ai: true });
    return out.sort((p, q) => q.score - p.score);
  } catch { return null; } finally { clearTimeout(timer); }
}
function applyClip(i) {
  const c = (S.o.found || [])[i];
  if (!c || S.exporting) return;
  const others = texts().filter(l => !l.hook);
  const prev = S.o.clip || {};
  const hook = c.title && prev.hook !== false ? [newLayer({ text: c.title, start: c.start, end: Math.min(c.end, c.start + 3.5), x: 0.5, y: 0.18, size: 0.072, font: 'Montserrat', bold: true, color: '#ffffff', stroke: '#000000', strokeW: 0.16, shadow: true, hook: true })] : [];
  // Series: a "PART n/total" badge for the whole short (removed with the hook when leaving the short).
  const sr = S.o.series, part = sr && sr.on ? partOf(S.o.found, i, sr.order) : 0;
  if (part) hook.push(newLayer({ text: partLabel(part, S.o.found.length, sr.name), start: c.start, end: c.end, x: 0.5, y: 0.07, size: 0.042, font: 'Montserrat', bold: true, color: '#111111', bg: '#FFE600', bgOp: 100, shadow: false, oneLine: true, hook: true, part: true }));
  S.o.clip = { start: c.start, end: c.end, x: prev.x ?? 0.5, aspect: prev.aspect || '9:16', hook: prev.hook !== false, i, part };
  S.o.texts = [...others, ...hook];
  commit();
  renderClipUI(); renderTextUI(); timeline.renderNow(); timeline.scrollTo(c.start);
  video.currentTime = c.start + 0.01;
}
function exitClip() {
  if (!S.o.clip || S.exporting) return;
  S.o.clip = null;
  S.o.texts = texts().filter(l => !l.hook);
  commit();
  renderClipUI(); renderTextUI(); timeline.render();
}
function renderClipUI() {
  const c = S.o.clip;
  $('clipActive').hidden = !c;
  $('clipAll').hidden = !(S.o.found && S.o.found.length > 1);
  $('clipSeries').hidden = $('clipAll').hidden;
  const sr = S.o.series || {};
  $('seriesOn').checked = !!sr.on; if (document.activeElement !== $('seriesName')) $('seriesName').value = sr.name || ''; $('seriesOrder').value = sr.order || 'time';
  if (c) {
    $('clipRange').textContent = `${fmt(c.start)}–${fmt(c.end)} · ${Math.round(c.end - c.start)} s`;
    $('clipX').value = Math.round((c.x ?? 0.5) * 100); $('clipXVal').textContent = `${$('clipX').value}%`;
    $('clipAspect').value = c.aspect || '9:16'; $('clipHook').checked = c.hook !== false;
    if (document.activeElement !== $('clipStart')) $('clipStart').value = fmtT(c.start);
    if (document.activeElement !== $('clipEnd')) $('clipEnd').value = fmtT(c.end);
  }
  const list = $('clipList');
  list.innerHTML = '';
  (S.o.found || []).forEach((f, i) => {
    const card = document.createElement('div');
    card.className = 'clip-card' + (c && c.i === i ? ' on' : '');
    const top = document.createElement('div'); top.className = 'clip-top';
    const sc = document.createElement('span'); sc.className = 'clip-score'; sc.textContent = f.score; sc.title = 'How likely this moment is to hold viewers (estimate)';
    const tm = document.createElement('b'); tm.textContent = `${fmt(f.start)}–${fmt(f.end)} · ${Math.round(f.end - f.start)} s`;
    top.append(sc, tm);
    const title = document.createElement('input'); title.className = 'clip-title'; title.value = f.title; title.setAttribute('aria-label', `Hook title for clip ${i + 1}`);
    title.onchange = () => {
      f.title = title.value.trim();
      if (c && c.i === i) { const h = texts().find(l => l.hook); if (h) h.text = f.title; else return applyClip(i); renderTextUI(); timeline.render(); }
      commit();
    };
    const chips = document.createElement('div'); chips.className = 'clip-hooks';
    (f.hooks || []).filter(h => h !== f.title).forEach(h => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = h; b.title = 'Use this hook';
      b.onclick = () => { title.value = h; title.onchange(); renderClipUI(); };
      chips.appendChild(b);
    });
    const tx = document.createElement('p'); tx.className = 'clip-text'; tx.textContent = f.text.length > 170 ? `${f.text.slice(0, 170)}…` : f.text;
    const why = document.createElement('small'); why.textContent = f.why && f.why.length ? `Why: ${f.why.join(' · ')}` : '';
    const row = document.createElement('div'); row.className = 'row';
    const pv = document.createElement('button'); pv.type = 'button'; pv.className = 'btn btn-sm'; pv.textContent = '▶ Preview';
    pv.onclick = () => { applyClip(i); video.play().catch(() => {}); };
    const ed = document.createElement('button'); ed.type = 'button'; ed.className = 'btn btn-sm btn-primary'; ed.textContent = c && c.i === i ? 'Editing' : 'Use this short';
    ed.onclick = () => applyClip(i);
    row.append(pv, ed);
    card.append(top, title, chips, tx, why, row);
    list.appendChild(card);
  });
}
$('clipFind').onclick = () => findAndShowClips();
// Export every suggested short, one after another (each is its own download).
$('clipAll').onclick = () => exportAllShorts(true);
async function exportAllShorts(ask) {
  const list = S.o.found || [];
  if (!list.length || S.exporting) return 0;
  if (ask && !confirm(`Export all ${list.length} shorts one after another? Your browser may ask once to allow several downloads.`)) return 0;
  const was = S.o.clip;
  let done = 0;
  // A series exports in part order, so the downloads are numbered like the parts.
  const order = S.o.series && S.o.series.on ? seriesOrder(list, S.o.series.order) : list.map((_, k) => k);
  for (let i = 0; i < order.length; i++) {
    applyClip(order[i]);
    const z = aspectSize(S.o.clip.aspect);
    $('exportTitle').textContent = `${S.batchVideo ? `${S.batchVideo} · ` : ''}Exporting short ${i + 1} of ${list.length}…`;
    await exportVideo({ kind: 'video', size: { w: z.w, h: z.h, label: '' }, batch: `${i + 1}/${list.length}` });
    if (S.batchCancelled) break;
    done++;
  }
  const cancelled = S.batchCancelled;
  S.batchCancelled = false;
  status(done === list.length ? `Exported ${done} shorts.` : `Stopped after ${done} of ${list.length} shorts.`);
  if (!was) exitClip();
  return cancelled ? -1 : done;
}
// Every video in Media, one after another: captions (if missing) → best moments → export all its shorts.
const until = (ok, ms = 500) => new Promise(res => { const t = setInterval(() => { if (ok()) { clearInterval(t); res(); } }, ms); });
async function reelsFromAll() {
  const vids = (await listProjects()).filter(p => p.kind !== 'photo' && p.hasFile).reverse();
  if (!vids.length) return toast('Import your videos in Media first (you can pick many at once).');
  if (S.exporting || genRunning) return toast('Wait for the current job to finish.');
  if (!confirm(`Make reels from all ${vids.length} videos? Each one gets captions (if it has none), its best ${$('clipCount').value} moments, and an export of each. This runs on your device and can take a long time: keep this tab open and the laptop plugged in.`)) return;
  const asSeries = $('allSeries').checked;
  let total = 0, skipped = [];
  S.batchAll = true;
  try {
    for (let k = 0; k < vids.length; k++) {
      const p = vids[k];
      S.batchVideo = `Video ${k + 1} of ${vids.length}`;
      $('clipNote').textContent = `${S.batchVideo}: opening “${p.name}”…`;
      if (p.id !== S.projectId) { await saveNow(); await openProject(p.id); }
      if (!S.file || S.image) { skipped.push(p.name); continue; }
      S.wantClips = false;
      if (!S.segments.length) {
        $('clipNote').textContent = `${S.batchVideo}: making captions for “${p.name}”…`;
        startCaptions();
        await until(() => !genRunning);
        S.wantClips = false;
      }
      showLTab('clips');
      if (!S.segments.length) { skipped.push(p.name); continue; }
      await findAndShowClips();
      if (!(S.o.found && S.o.found.length)) { skipped.push(p.name); continue; }
      if (asSeries) S.o.series = { on: true, name: (S.o.series && S.o.series.name) || p.name.slice(0, 24), order: 'time' };
      const n = await exportAllShorts(false);
      if (n < 0) break;
      total += n;
      await saveNow();
    }
  } finally { S.batchAll = false; S.batchVideo = null; }
  const msg = `Done: ${total} reels from ${vids.length - skipped.length} video${vids.length - skipped.length === 1 ? '' : 's'}.${skipped.length ? ` Skipped (no speech found): ${skipped.join(', ')}.` : ''}`;
  $('clipNote').textContent = msg; status(msg);
}
$('clipAllVideos').onclick = () => reelsFromAll();
$('clipExit').onclick = () => exitClip();
const shortTag = range => (S.o.clip && S.o.clip.part ? `part-${S.o.clip.part}` : `short-${Math.round(range.start)}s`);
const setSeries = p => {
  S.o.series = { on: false, name: '', order: 'time', ...(S.o.series || {}), ...p };
  if (S.o.clip) applyClip(S.o.clip.i); else { commit(); renderClipUI(); }
};
$('seriesOn').onchange = e => setSeries({ on: e.target.checked });
$('seriesName').onchange = e => setSeries({ name: e.target.value.trim() });
$('seriesOrder').onchange = e => setSeries({ order: e.target.value });
$('seriesCaps').onclick = () => {
  const sr = S.o.series || {};
  const caps = seriesCaptions(S.o.found || [], { name: sr.name || '', order: sr.order || 'time' });
  $('seriesOut').value = caps.map(c => `— Part ${c.part} —\n${c.text}`).join('\n\n');
  $('seriesOut').hidden = false; $('seriesOut').select();
  if (navigator.clipboard) navigator.clipboard.writeText($('seriesOut').value).then(() => toast('Captions copied. Paste each part’s caption when you post it.'), () => {});
};
$('clipExport').onclick = () => openExportDialog();
$('clipX').addEventListener('input', e => { if (S.o.clip) { S.o.clip.x = e.target.value / 100; $('clipXVal').textContent = `${e.target.value}%`; } });
$('clipX').addEventListener('change', () => commit());
$('clipAspect').onchange = e => { if (S.o.clip) { S.o.clip.aspect = e.target.value; commit(); renderClipUI(); } };
$('clipHook').onchange = e => {
  const c = S.o.clip; if (!c) return;
  c.hook = e.target.checked;
  const f = (S.o.found || [])[c.i];
  S.o.texts = texts().filter(l => !l.hook);
  if (c.hook && f && f.title) S.o.texts.push(newLayer({ text: f.title, start: c.start, end: Math.min(c.end, c.start + 3.5), x: 0.5, y: 0.18, size: 0.072, font: 'Montserrat', bold: true, color: '#ffffff', stroke: '#000000', strokeW: 0.16, shadow: true, hook: true }));
  commit(); renderTextUI(); timeline.render();
};
const clipTime = which => () => {
  const c = S.o.clip; if (!c) return;
  const v = parseT($(which === 'start' ? 'clipStart' : 'clipEnd').value), D = video.duration || 0;
  if (isNaN(v)) { renderClipUI(); return toast('Use a time like 1:05.20 or 65.2'); }
  if (which === 'start') c.start = Math.max(0, Math.min(v, c.end - 1)); else c.end = Math.min(D, Math.max(v, c.start + 1));
  const f = (S.o.found || [])[c.i]; if (f) { f.start = c.start; f.end = c.end; }
  const h = texts().find(l => l.hook); if (h) { h.start = c.start; h.end = Math.min(c.end, c.start + 3.5); }
  commit(); renderClipUI(); timeline.render(); video.currentTime = c.start + 0.01;
};
$('clipStart').onchange = clipTime('start');
$('clipEnd').onchange = clipTime('end');
// Long video → Shorts: upload a file, or paste a YouTube link (details + how to get your own file).
['cardClips', 'toolClips', 'navClips'].forEach(id => $(id).addEventListener('click', e => {
  e.preventDefault(); S.wantClips = true;
  $('lsOut').hidden = true; $('lsDlg').showModal ? $('lsDlg').showModal() : $('startFile').click();
}));
$('lsDlg').querySelector('.ls-up').addEventListener('click', () => { S.wantClips = true; $('lsDlg').close(); });
async function checkLink() {
  const url = $('lsUrl').value.trim(), id = youtubeId(url), out = $('lsOut');
  out.hidden = false;
  if (!id) { out.innerHTML = '<p class="warn">That isn’t a YouTube video link.</p>'; return; }
  out.innerHTML = '<p class="hint">Checking…</p>';
  let meta = null;
  try { const r = await fetch(`/api/yt?url=${encodeURIComponent(url)}`); if (r.ok) meta = await r.json(); } catch { /* offline */ }
  const tips = meta && meta.title ? titleCheck(meta.title).tips : [];
  out.innerHTML = '';
  const card = document.createElement('div'); card.className = 'ls-card';
  const img = document.createElement('img'); img.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`; img.alt = '';
  const info = document.createElement('div');
  const t = document.createElement('b'); t.textContent = meta ? meta.title : 'YouTube video';
  const ch = document.createElement('small'); ch.textContent = meta ? meta.channel : '';
  info.append(t, document.createElement('br'), ch);
  card.append(img, info);
  const steps = document.createElement('ol'); steps.className = 'ls-steps';
  steps.innerHTML = '<li><b>Your own video?</b> In YouTube Studio: Content → ⋮ next to the video → <b>Download</b>. All your videos at once: <b>takeout.google.com</b> → YouTube → videos.</li><li>Upload that file here: we find the best moments, cut 9:16 shorts with hooks and captions, and number them as a series.</li>';
  // Studio opens only for the channel that owns the video; its ⋮ menu has Download.
  const studio = document.createElement('a'); studio.className = 'btn ls-studio'; studio.href = `https://studio.youtube.com/video/${id}/edit`; studio.target = '_blank'; studio.rel = 'noopener';
  studio.textContent = '⬇ Download it in YouTube Studio (your own videos)';
  const up = document.createElement('label'); up.className = 'btn btn-primary'; up.htmlFor = 'startFile'; up.textContent = '⬆ Upload the downloaded video';
  up.onclick = () => { S.wantClips = true; $('lsDlg').close(); };
  const plan = document.createElement('a'); plan.className = 'btn btn-sm'; plan.href = `grow.html?url=${encodeURIComponent(url)}`; plan.textContent = '📈 Growth plan + new title & thumbnail ideas';
  const note = document.createElement('p'); note.className = 'hint'; note.textContent = 'We don’t download videos from YouTube links: YouTube’s terms only allow its own download options, and other people’s videos aren’t yours to re-post.';
  out.append(card);
  if (tips.length) { const ul = document.createElement('ul'); ul.className = 'ls-tips'; tips.slice(0, 3).forEach(x => { const li = document.createElement('li'); li.textContent = x; ul.appendChild(li); }); out.append(ul); }
  out.append(steps, studio, up, plan, note);
}
$('lsCheck').onclick = checkLink;
$('lsUrl').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); checkLink(); } });

// ---------- thumbnail maker ----------
/** The photo in its frame (fill or fit with blurred edges, panned), graded, plus the overlay. */
function drawPhoto(c2, W, H, img = S.image, f = S.o.frame, overlay = S.o.overlay) {
  if (!f) { c2.drawImage(graded(img, W, H), 0, 0, W, H); drawOverlay(c2, W, H, overlay); return; }
  const iw = img.naturalWidth || img.videoWidth, ih = img.naturalHeight || img.videoHeight, r = photoRect(iw, ih, W, H, f);
  c2.fillStyle = '#000'; c2.fillRect(0, 0, W, H);
  if (f.fit === 'contain') {
    const b = photoRect(iw, ih, W, H, { fit: 'cover' });
    c2.save(); if ('filter' in c2) c2.filter = 'blur(22px) brightness(.65)'; c2.drawImage(img, b.x, b.y, b.w, b.h); c2.restore();
  }
  c2.drawImage(graded(img, Math.max(1, Math.round(r.w)), Math.max(1, Math.round(r.h))), r.x, r.y, r.w, r.h);
  drawOverlay(c2, W, H, overlay);
}
SIZES.forEach(z => { const o = document.createElement('option'); o.value = z.id; o.textContent = z.name; $('thumbSize').appendChild(o); });
OVERLAYS.forEach(([id, nm]) => { const o = document.createElement('option'); o.value = id; o.textContent = nm; $('thumbOverlay').appendChild(o); });
const defaultSize = () => SIZES.find(z => z.id === ((S.image ? S.image.naturalHeight > S.image.naturalWidth : video.videoHeight > video.videoWidth) ? 'reel' : 'yt'));
function setFrame(sizeId) {
  const z = SIZES.find(x => x.id === sizeId) || defaultSize();
  S.o.frame = { ...(S.o.frame || { fit: 'cover', x: 0.5, y: 0.5 }), id: z.id, w: z.w, h: z.h };
}
function renderThumbUI() {
  const photo = !!S.image;
  $('thumbNoPhoto').hidden = photo; $('thumbTools').hidden = !photo; $('thumbExport').hidden = !photo;
  $('thumbFromFrame').disabled = !(S.file && !S.image && video.readyState >= 2);
  if (photo) {
    const f = S.o.frame;
    $('thumbSize').value = f ? f.id : ''; $('thumbFit').value = f ? f.fit : 'cover';
    $('thumbOverlay').value = (S.o.overlay && S.o.overlay.type) || 'none';
    $('thumbOvColor').value = (S.o.overlay && S.o.overlay.color) || '#7c3aed';
  }
  renderThumbGrid();
}
/** Layout previews drawn on the user's own photo (or the current video frame). */
function renderThumbGrid() {
  const grid = $('thumbGrid');
  grid.innerHTML = '';
  const src = S.image || (video.readyState >= 2 && video.videoWidth ? video : null);
  const z = (S.o.frame && S.image) ? S.o.frame : defaultSize() || SIZES[0];
  const tw = 160, th = Math.round(tw * z.h / z.w);
  for (const tp of THUMBS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'thumb-tile'; b.title = `Use “${tp.name}”`;
    const c = document.createElement('canvas'); c.width = tw; c.height = th;
    const x = c.getContext('2d');
    if (src) drawPhoto(x, tw, th, src, { fit: 'cover', x: 0.5, y: 0.5 }, tp.overlay);
    else { const g = x.createLinearGradient(0, 0, tw, th); g.addColorStop(0, '#3b2a66'); g.addColorStop(1, '#0d0d16'); x.fillStyle = g; x.fillRect(0, 0, tw, th); drawOverlay(x, tw, th, tp.overlay); }
    for (const t of tp.texts) drawLayer(x, tw, th, newLayer(t));
    const nm = document.createElement('span'); nm.textContent = tp.name;
    b.append(c, nm);
    b.onclick = () => applyThumb(tp.id);
    grid.appendChild(b);
  }
}
async function frameToPhoto() {
  if (!S.file || S.image || video.readyState < 2) return false;
  const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.94));
  if (!blob) return false;
  const name = `${S.file.name.replace(/\.[^.]+$/, '')}-frame-${Math.round(video.currentTime)}s.jpg`;
  S.wantThumb = true;
  await importFiles([new File([blob], name, { type: 'image/jpeg' })]);
  return !!S.image;
}
/** A new empty design (gradient background) of a given size, optionally with a starter layout. */
async function blankDesign(sizeId, layout) {
  const z = SIZES.find(x => x.id === sizeId) || SIZES[0];
  const c = document.createElement('canvas'); c.width = z.w; c.height = z.h;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, z.w, z.h);
  g.addColorStop(0, '#3b2a66'); g.addColorStop(1, '#0d0d16');
  x.fillStyle = g; x.fillRect(0, 0, z.w, z.h);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  S.wantThumb = { size: z.id, layout };
  await importFiles([new File([blob], `design-${z.id}.png`, { type: 'image/png' })]);
}
/** Swap the photo under a design and keep every text, overlay and the size. */
async function replacePhoto(file) {
  const url = URL.createObjectURL(file), img = new Image();
  const ok = await new Promise(r => { img.onload = () => r(true); img.onerror = () => r(false); img.src = url; });
  if (!ok) { URL.revokeObjectURL(url); return toast('This browser can’t open that photo.'); }
  if (S.fileURL) URL.revokeObjectURL(S.fileURL);
  S.fileURL = url; S.file = file; S.image = img;
  if (S.o.frame) S.o.frame = { ...S.o.frame, x: 0.5, y: 0.5 };
  commit(); updateThumbBg(); renderThumbUI();
  toast('Photo replaced. Drag it on the preview to move it.');
}
// Ready-made elements: text presets and stickers, all ordinary editable texts.
const ELEMENTS = [
  ['Heading', { text: 'BIG HEADING', font: 'Anton', size: 0.12, strokeW: 0.1 }],
  ['Subheading', { text: 'Subheading goes here', font: 'Montserrat', size: 0.06 }],
  ['Body', { text: 'A line of small text', font: 'Inter', bold: false, size: 0.04 }],
  ['Badge', { text: 'NEW', font: 'Montserrat', size: 0.05, color: '#111111', bg: '#FFE600', bgOp: 100, shadow: false }],
  ['Red tag', { text: 'MUST WATCH', font: 'Montserrat', size: 0.05, bg: '#E11D48', bgOp: 100, shadow: false }],
  ['Script', { text: 'my story', font: 'Pacifico', bold: false, size: 0.08 }],
];
const STICKERS = ['🔥', '😱', '🤯', '✅', '❌', '➡️', '👉', '💰', '⭐', '👀', '❤️', '💯', '🚀', '⚠️', '🎯', '😂'];
function addElement(o) {
  const L = newLayer({ start: 0, end: S.image ? 1 : 3, y: 0.3 + (texts().length % 5) * 0.1, ...o });
  S.o.texts = [...texts(), L]; commit(); selectText(L.id);
}
{
  const box = $('thumbElements');
  for (const [name, o] of ELEMENTS) { const b = document.createElement('button'); b.type = 'button'; b.className = 'el-btn'; b.textContent = name; b.style.fontFamily = `'${o.font}'`; b.onclick = () => addElement(o); box.appendChild(b); }
  const st = $('thumbStickers');
  for (const e of STICKERS) { const b = document.createElement('button'); b.type = 'button'; b.className = 'st-btn'; b.textContent = e; b.setAttribute('aria-label', `Add ${e}`); b.onclick = () => addElement({ text: e, size: 0.14, shadow: false, x: 0.75, y: 0.25 }); st.appendChild(b); }
  $('thumbReplaceIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) replacePhoto(f); };
  document.querySelectorAll('[data-blank]').forEach(b => b.addEventListener('click', () => { openEditor(); blankDesign(b.dataset.blank); }));
}
async function applyThumb(id) {
  const tp = THUMBS.find(x => x.id === id); if (!tp) return;
  if (!S.image && !(await frameToPhoto())) return toast('Upload a photo or load a video first.');
  if (!S.o.frame) setFrame();
  S.o.overlay = { ...tp.overlay };
  S.o.texts = tp.texts.map(t => newLayer({ ...t, start: 0, end: 1 }));
  commit();
  renderThumbUI(); renderTextUI(); timeline.render();
  selectText(S.o.texts[0].id);
  toast(`“${tp.name}” applied. Click any text to change it.`);
}
$('thumbFromFrame').onclick = async () => { if (await frameToPhoto()) { showLTab('thumb'); toast('Frame saved as a photo. Pick a layout.'); } };
$('photoFile2').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) { S.wantThumb = true; importFiles([f]); } };
$('thumbSize').onchange = e => { setFrame(e.target.value); commit(); renderThumbUI(); };
$('thumbFit').onchange = e => { if (!S.o.frame) setFrame(); S.o.frame.fit = e.target.value; commit(); };
$('thumbOverlay').onchange = e => { S.o.overlay = e.target.value === 'none' ? null : { type: e.target.value, color: $('thumbOvColor').value }; commit(); };
$('thumbOvColor').addEventListener('input', e => { if (S.o.overlay) S.o.overlay.color = e.target.value; });
$('thumbOvColor').addEventListener('change', () => commit());
$('thumbExport').onclick = () => exportPhoto();

// ---------- media library: several files, each its own saved project ----------
/** Import files: the first opens in the editor, the rest wait in the media library. */
async function importFiles(files) {
  files = files.filter(Boolean);
  if (!files.length || S.exporting) return;
  if (genRunning) return toast('Captions are being made. Import more files when they are done.');
  const [first, ...rest] = files;
  if (S.projectId) await saveNow(); // the current file keeps its edits in its own project
  if (await loadFile(first)) autoCaption();
  for (const f of rest) await addToBin(f);
  if (rest.length) { showLTab('media'); toast(`${files.length} files imported. Click one in Media to open it.`); }
  renderBin();
}
async function addToBin(file) {
  const bad = isImage(file) ? null : validateFile(file);
  if (bad) { toast(bad, 5000); return; }
  const id = newId(), now = Date.now();
  await putProject({ id, name: file.name.replace(/\.[^.]+$/, ''), fileName: file.name, type: file.type, size: file.size, kind: isImage(file) ? 'photo' : 'video', created: now, updated: now, dur: 0, thumb: null, state: null, hasFile: false });
  if (await putProjectFile(id, file)) await patchProject(id, { hasFile: true });
  thumbOf(file).then(t => t && patchProject(id, t)).then(renderBin);
}
/** A small picture (and duration) of a file, without opening it in the editor. */
function thumbOf(file) {
  return new Promise(res => {
    const url = URL.createObjectURL(file), done = v => { URL.revokeObjectURL(url); res(v); };
    const shot = (src, w, h, dur) => {
      try {
        const k = 240 / Math.max(w, h), c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
        done({ thumb: c.toDataURL('image/jpeg', 0.7), dur: dur || 0 });
      } catch { done(null); }
    };
    if (isImage(file)) { const im = new Image(); im.onload = () => shot(im, im.naturalWidth, im.naturalHeight, 0); im.onerror = () => done(null); im.src = url; return; }
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.onloadeddata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
    v.onseeked = () => shot(v, v.videoWidth, v.videoHeight, v.duration);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 15000);
    v.src = url;
  });
}
async function renderBin() {
  const list = await listProjects(), bin = $('mediaBin');
  bin.innerHTML = '';
  $('binCount').textContent = list.length ? `· ${list.length}` : '';
  for (const p of list) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'media-item' + (p.id === S.projectId ? ' on' : '');
    b.title = p.id === S.projectId ? `${p.name} (open)` : `Open ${p.name}`;
    const th = document.createElement('div'); th.className = 'media-th';
    if (p.thumb) { const im = document.createElement('img'); im.src = p.thumb; im.alt = ''; th.appendChild(im); }
    const badge = document.createElement('span'); badge.textContent = p.kind === 'photo' ? 'Photo' : p.dur ? fmt(p.dur) : 'Video'; th.appendChild(badge);
    const nm = document.createElement('b'); nm.textContent = p.name;
    b.append(th, nm);
    b.onclick = async () => {
      if (p.id === S.projectId || S.exporting) return;
      if (genRunning) return toast('Captions are being made. Open another file when they are done.');
      await saveNow();
      await openProject(p.id);
      renderBin();
    };
    bin.appendChild(b);
  }
}
{
  const md = $('mediaDrop');
  ['dragenter', 'dragover'].forEach(ev => md.addEventListener(ev, e => { e.preventDefault(); md.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => md.addEventListener(ev, e => { e.preventDefault(); md.classList.remove('over'); }));
  md.addEventListener('drop', e => importFiles([...e.dataTransfer.files]));
}

// ---------- projects (saved on this device) ----------
S.projectId = null;
var opening = false; // true while a saved project is being reopened: don't create a new one
async function createProject(file, kind) {
  const id = S.projectId = newId(), now = Date.now();
  await putProject({ id, name: file.name.replace(/\.[^.]+$/, ''), fileName: file.name, type: file.type, size: file.size, kind, created: now, updated: now, dur: 0, thumb: null, state: null, hasFile: false });
  const stored = await putProjectFile(id, file);
  if (stored) await patchProject(id, { hasFile: true });
  else toast('Project saved, but this device has no room to keep the video itself. Keep the original file to reopen it.', 6500);
  scheduleSave();
  setTimeout(() => saveNow().then(renderBin), 1200);
}
let saveTimer = null;
function scheduleSave() {
  if (!S.projectId || opening) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 900);
}
function makeThumb() {
  try {
    const k = 240 / Math.max(canvas.width, canvas.height), c = document.createElement('canvas');
    c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
  } catch { return null; }
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!S.projectId || S.exporting) return;
  await patchProject(S.projectId, { state: snap(), thumb: makeThumb(), dur: S.image ? 0 : (isFinite(video.duration) ? video.duration : 0) });
}
video.addEventListener('loadeddata', () => setTimeout(scheduleSave, 300));
async function openProject(id) {
  const p = await getProject(id);
  if (!p) return renderProjects();
  const blob = p.hasFile ? await getProjectFile(id) : null;
  if (!blob) return toast('This project’s video isn’t stored on this device. Start a new project with the original file.', 6500);
  const file = blob instanceof File ? blob : new File([blob], p.fileName || p.name, { type: p.type || blob.type });
  opening = true;
  try {
    if (!(await loadFile(file))) return;
    S.projectId = id;
    if (p.state) { restore(p.state); hist = [p.state]; hIdx = 0; syncUndo(); }
    openEditor();
    showLTab(S.image ? 'text' : 'captions');
    status(`Opened “${p.name}”.`);
    renderBin();
  } finally { opening = false; }
}
async function renderProjects() {
  const list = await listProjects(), grid = $('projGrid');
  grid.innerHTML = '';
  $('projEmpty').hidden = list.length > 0;
  $('projCount').textContent = list.length ? `· ${list.length}` : '';
  for (const p of list) {
    const card = document.createElement('div'); card.className = 'proj';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'proj-open';
    const th = document.createElement('div'); th.className = 'proj-thumb';
    if (p.thumb) { const im = document.createElement('img'); im.src = p.thumb; im.alt = ''; th.appendChild(im); }
    if (p.dur) { const d = document.createElement('span'); d.textContent = fmt(p.dur); th.appendChild(d); }
    const nm = document.createElement('b'); nm.textContent = p.name;
    const sm = document.createElement('small');
    sm.textContent = `${p.kind === 'photo' ? 'Photo' : 'Video'} · ${new Date(p.updated).toLocaleDateString()} · ${fmtBytes(p.size || 0)}${p.hasFile ? '' : ' · file not stored'}`;
    open.append(th, nm, sm);
    open.onclick = () => openProject(p.id);
    const del = document.createElement('button'); del.type = 'button'; del.className = 'proj-del'; del.textContent = '🗑';
    del.title = 'Delete project'; del.setAttribute('aria-label', `Delete ${p.name}`);
    del.onclick = async () => { if (!confirm(`Delete “${p.name}” from this device?`)) return; await deleteProject(p.id); if (S.projectId === p.id) S.projectId = null; renderProjects(); };
    card.append(open, del);
    grid.appendChild(card);
  }
}
function goHome() {
  if (S.exporting) return toast('Wait for the export to finish (or cancel it) first.');
  if (genRunning) return toast('Captions are still being made. Cancel them first, or wait a moment.');
  video.pause();
  if (S.mode === 'live') setMode('file');
  saveNow().then(renderProjects);
  $('editor').hidden = true; $('navActions').hidden = true;
  $('newProj').hidden = true; $('start').hidden = false;
  renderProjects();
}
$('homeBtn').onclick = goHome;
// The logo is the home page (this studio): inside the editor it goes back to the projects without reloading.
$('logoLink').addEventListener('click', e => { if (!$('editor').hidden) { e.preventDefault(); goHome(); } });

// ---------- media + details panels ----------
function renderMedia() {
  $('mediaCard').hidden = !S.file;
  if (!S.file) return;
  $('mediaName').textContent = S.file.name;
  $('mediaInfo').textContent = S.image ? `${S.image.naturalWidth}×${S.image.naturalHeight} · photo · ${fmtBytes(S.file.size)}` : fileMeta().split(' · ').slice(1).join(' · ');
  const c = $('mediaThumb'), x = c.getContext('2d'), src = S.image || video;
  const w = src.naturalWidth || src.videoWidth, h = src.naturalHeight || src.videoHeight;
  x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
  if (w && (S.image || video.readyState >= 2)) { const k = Math.min(c.width / w, c.height / h); x.drawImage(src, (c.width - w * k) / 2, (c.height - h * k) / 2, w * k, h * k); }
}
video.addEventListener('loadeddata', () => setTimeout(renderMedia, 100));
function renderInfo() {
  const rows = [];
  if (S.file) {
    rows.push(['Name', S.file.name]);
    rows.push(['Type', S.image ? 'Photo' : 'Video']);
    rows.push(['Resolution', S.image ? `${S.image.naturalWidth}×${S.image.naturalHeight}` : video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : 'audio only']);
    if (!S.image) rows.push(['Duration', fmt(video.duration)]);
    rows.push(['Size', fmtBytes(S.file.size)]);
  } else rows.push(['Project', 'No media yet']);
  rows.push(['Captions', String(S.segments.length)], ['Texts', String(texts().length)], ['Sounds', String(allSounds().length)]);
  rows.push(['Saved', S.projectId ? 'On this device (automatic)' : 'Not saved']);
  const dl = $('infoList'); dl.innerHTML = '';
  for (const [k, v] of rows) { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); }
}

// ---------- start screen: upload → languages → generate ----------
function openEditor() {
  $('start').hidden = true; $('newProj').hidden = true;
  $('editor').hidden = false;
  $('navActions').hidden = false;
  timeline.render(); renderBin();
}

// A small accessible searchable dropdown.
function combo(el, placeholder, searchText, onChange) {
  let items = [], value = null, pop = null, hi = -1, shown = [];
  el.innerHTML = '';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'combo-btn empty';
  btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  const label = document.createElement('span');
  btn.appendChild(label);
  el.appendChild(btn);
  const close = (focus) => {
    if (!pop) return;
    pop.remove(); pop = null; el.classList.remove('open'); btn.setAttribute('aria-expanded', 'false');
    if (focus) btn.focus();
  };
  const render = () => { label.textContent = value ? value.label : placeholder; btn.classList.toggle('empty', !value); };
  const choose = it => { value = it; render(); close(true); onChange(it); };
  btn.onclick = () => {
    if (pop) return close();
    el.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
    pop = document.createElement('div'); pop.className = 'combo-pop';
    const q = document.createElement('input'); q.placeholder = searchText; q.setAttribute('aria-label', searchText);
    const list = document.createElement('div'); list.className = 'combo-list'; list.setAttribute('role', 'listbox');
    const fill = () => {
      list.innerHTML = '';
      if (value) {
        const c = document.createElement('div'); c.className = 'combo-opt combo-clear'; c.textContent = '✕ Clear selection';
        c.onclick = () => { value = null; render(); close(true); onChange(null); };
        list.appendChild(c);
      }
      shown = items.filter(it => it.label.toLowerCase().includes(q.value.toLowerCase()));
      hi = Math.max(0, shown.findIndex(it => value && it.id === value.id));
      shown.forEach((it, k) => {
        const o = document.createElement('div');
        o.className = 'combo-opt' + (k === hi ? ' on' : '');
        o.setAttribute('role', 'option'); o.setAttribute('aria-selected', !!(value && value.id === it.id));
        o.textContent = it.label;
        o.onclick = () => choose(it);
        list.appendChild(o);
      });
      if (!shown.length) { const n = document.createElement('div'); n.className = 'combo-none'; n.textContent = 'No match'; list.appendChild(n); }
    };
    const move = d => {
      if (!shown.length) return;
      hi = (hi + d + shown.length) % shown.length;
      const opts = list.querySelectorAll('[role=option]');
      opts.forEach((o, k) => o.classList.toggle('on', k === hi));
      opts[hi] && opts[hi].scrollIntoView({ block: 'nearest' });
    };
    q.oninput = fill;
    q.onkeydown = e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); shown[hi] && choose(shown[hi]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    };
    fill();
    pop.append(q, list);
    el.appendChild(pop);
    q.focus();
  };
  document.addEventListener('click', e => { if (pop && !el.contains(e.target)) close(); });
  render();
  return {
    setItems(next) { items = next; if (value && !items.some(i => i.id === value.id)) { value = null; render(); } },
    set(id) { value = items.find(i => i.id === id) || null; render(); },
    get() { return value; },
  };
}

const store = {
  get() { try { return JSON.parse(localStorage.getItem('vcz-langs') || 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem('vcz-langs', JSON.stringify(v)); } catch { /* private mode */ } },
};
const spokenItems = LANGUAGES.map((l, i) => ({ id: i, label: l.name, lang: l }))
  .filter(it => !it.lang.hinglish)
  .sort((a, b) => (a.lang.whisper ? 1 : 0) - (b.lang.whisper ? 1 : 0) || a.label.localeCompare(b.label));
const start = { spoken: null, caption: null };
const captionCombo = combo($('captionCombo'), 'Select a language', 'Search caption language…', it => { start.caption = it; syncStart(); beginFromStart(); });
const spokenCombo = combo($('spokenCombo'), 'Select a language', 'Search spoken language…', it => {
  start.spoken = it;
  const l = it && it.lang;
  // Hindi is where the small model clearly beats base. Suggest it on computers (phones keep Balanced to save memory).
  const isPhone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
  // Balanced everywhere by default: "Best" is a 250 MB download and very slow on ordinary laptops.
  if (l) $('startModel').value = 'balanced';
  const own = l ? l.name.split(' — ')[0].replace(/ \(.*\)/, '') : '';
  const opts = !l ? [] : l.whisper === 'hindi'
    ? [{ id: 'native', label: 'Hindi' }, { id: 'hinglish', label: 'Hinglish (Roman Hindi)' }, { id: 'english', label: 'English' }]
    : l.whisper === 'english' ? [{ id: 'native', label: 'English' }]
      : !l.whisper ? [{ id: 'native', label: 'Same as spoken' }, { id: 'english', label: 'English' }]
        : [{ id: 'native', label: own }, { id: 'english', label: 'English' }];
  captionCombo.setItems(opts);
  if (opts.length === 1 || (start.caption && !opts.some(o => o.id === start.caption.id))) captionCombo.set(opts[0] && opts[0].id);
  start.caption = captionCombo.get();
  syncStart();
  if (it) beginFromStart();
});
spokenCombo.setItems(spokenItems);
{
  // Remember last languages so the next upload starts captions immediately.
  const saved = store.get();
  const sp = saved && spokenItems.find(x => x.lang.name === saved.spoken);
  if (sp) {
    spokenCombo.set(sp.id);
    start.spoken = sp;
    const own = sp.lang.name.split(' — ')[0].replace(/ \(.*\)/, '');
    const opts = sp.lang.whisper === 'hindi'
      ? [{ id: 'native', label: 'Hindi' }, { id: 'hinglish', label: 'Hinglish (Roman Hindi)' }, { id: 'english', label: 'English' }]
      : sp.lang.whisper === 'english' ? [{ id: 'native', label: 'English' }]
        : !sp.lang.whisper ? [{ id: 'native', label: 'Same as spoken' }, { id: 'english', label: 'English' }]
          : [{ id: 'native', label: own }, { id: 'english', label: 'English' }];
    captionCombo.setItems(opts);
    captionCombo.set(saved.caption);
    start.caption = captionCombo.get();
    if (saved.quality) $('startModel').value = saved.quality;
  }
}

function syncStart() {
  const go = $('startGo');
  go.disabled = !(S.file && start.spoken && start.caption) || genRunning;
  $('startGoText').textContent = !S.file ? 'Upload Video First' : !start.spoken || !start.caption ? 'Choose Languages' : 'Generate Captions';
  if (S.file && (!start.spoken || !start.caption)) $('startMsg').textContent = 'Choose the spoken language. Captions start automatically.';
  else if ($('startMsg').textContent.startsWith('Choose the spoken')) $('startMsg').textContent = '';
}
function beginFromStart() {
  if (!S.file || !start.spoken || !start.caption || genRunning) return;
  store.set({ spoken: start.spoken.lang.name, caption: start.caption.id, quality: $('startModel').value });
  $('lang').value = start.spoken.id;
  $('model').value = $('startModel').value;
  $('translate').checked = start.caption.id === 'english';
  openEditor();
  runGeneration({ lang: start.spoken.lang, mode: start.caption.id, quality: $('startModel').value });
}

/** Make captions with the editor's current language choice. */
function startCaptions() {
  if (!S.file || genRunning) return;
  const lang = LANGUAGES[$('lang').value];
  const mode = lang.hinglish || S.hinglish ? 'hinglish' : $('translate').checked ? 'english' : 'native';
  runGeneration({ lang, mode, quality: $('model').value });
}
/** A video was dropped into the editor: start captions straight away with the languages used last time. */
function autoCaption() {
  if (S.image) return;
  const saved = store.get();
  const sp = saved && spokenItems.find(x => x.lang.name === saved.spoken);
  if (!sp) { renderSegs(); return; } // no saved languages yet: the "Make captions" button is shown instead
  $('lang').value = sp.id;
  if (saved.quality) $('model').value = saved.quality;
  runGeneration({ lang: sp.lang, mode: saved.caption || 'native', quality: $('model').value });
}

async function startFile(file) {
  if (!file || genRunning) return;
  if (isImage(file)) { if (await loadImage(file)) openEditor(); return; }
  if (!(await loadFile(file))) return;
  $('startVideo').src = S.fileURL;
  $('newProj').hidden = false;
  $('startPreview').hidden = false;
  $('startMeta').textContent = fileMeta();
  preloadModel($('startModel').value);
  syncStart();
  beginFromStart();
}
$('startFile').onchange = e => { startFile(e.target.files[0]); e.target.value = ''; };
const sd = $('startDrop');
['dragenter', 'dragover'].forEach(ev => sd.addEventListener(ev, e => { e.preventDefault(); sd.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => sd.addEventListener(ev, e => { e.preventDefault(); sd.classList.remove('over'); }));
sd.addEventListener('drop', e => startFile(e.dataTransfer.files[0]));
$('startRemove').onclick = () => {
  if (genRunning) return;
  $('startVideo').removeAttribute('src'); $('startVideo').load();
  video.removeAttribute('src'); video.load();
  if (S.fileURL) URL.revokeObjectURL(S.fileURL);
  S.file = null; S.fileURL = null; S.segments = [];
  $('startPreview').hidden = true; $('newProj').hidden = true; $('startMeta').textContent = '';
  if (S.projectId) { deleteProject(S.projectId); S.projectId = null; renderProjects(); }
  $('drop').classList.remove('hide');
  renderSegs(); syncActions(); syncStart();
};
$('startGo').onclick = () => beginFromStart();
$('startCancel').onclick = () => cancelTranscribe();
$('startLive').onclick = e => { e.preventDefault(); openEditor(); setMode('live'); };
$('startSkip').onclick = e => { e.preventDefault(); openEditor(); };
$('photoFile').onchange = e => { startFile(e.target.files[0]); e.target.value = ''; };
document.querySelectorAll('.js-live').forEach(a => { a.onclick = e => { e.preventDefault(); openEditor(); setMode('live'); }; });
document.querySelector('[data-go="top"]').onclick = e => { e.preventDefault(); scrollTo({ top: 0, behavior: 'smooth' }); };

window.addEventListener('beforeunload', e => {
  if (S.exporting || busyGen) { e.preventDefault(); e.returnValue = ''; }
});
window.addEventListener('pagehide', () => { if (S.fileURL) URL.revokeObjectURL(S.fileURL); });

// ---------- home: live demo phones, trending strip, reveal-on-scroll ----------
{
  // Cinematic intro: CLICK HERE → warp speed → straight into the studio's Create project.
  const intro = mountIntro($('introFx'));
  $('introGo').onclick = () => {
    intro.go(1000);
    document.body.classList.add('warping');
    setTimeout(() => {
      document.body.classList.remove('warping');
      $('startDrop').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('startDrop').classList.add('call'); setTimeout(() => $('startDrop').classList.remove('call'), 2200);
    }, 750);
  };
  const demo = [['ph1', 'crazy', 'ye trick sabko pata honi chahiye', 280], ['ph2', 'emoji-pop', 'paisa bachao aur khush raho', 330], ['ph3', 'green-box', 'this is how reels go viral', 200]];
  for (const [cls, id, text, hue] of demo) { const c = document.querySelector(`.hero-phones .${cls}`); if (c) mountPhone(c, id, text, hue, { scene: true, w: 270, h: 480 }); }
  const strip = $('trendStrip');
  const lines = ['sabse badi galti yahi hai', 'this changed everything', 'paise kaise bachaye', 'wait for the end', 'ye mat karna kabhi', 'how i grew 10x'];
  TEMPLATES.filter(t => t.tags.includes('trending')).forEach((t, i) => {
    const card = document.createElement('label'); card.className = 'trend-card'; card.htmlFor = 'startFile'; card.title = `Use ${t.name}`;
    const c = document.createElement('canvas'); card.appendChild(c);
    const nm = document.createElement('span'); nm.textContent = t.name; card.appendChild(nm);
    card.addEventListener('click', () => { S.tplId = t.id; gallery.select(t.id); });
    strip.appendChild(card);
    mountPhone(c, t.id, lines[i % lines.length], (i * 47 + 200) % 360, { scene: true, w: 180, h: 320 });
  });
  // Slow auto-scroll of the strip; stops while the visitor touches or hovers it.
  let hold = false;
  ['pointerenter', 'touchstart', 'focusin'].forEach(ev => strip.addEventListener(ev, () => { hold = true; }, { passive: true }));
  ['pointerleave', 'touchend', 'focusout'].forEach(ev => strip.addEventListener(ev, () => { hold = false; }, { passive: true }));
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    (function drift() {
      requestAnimationFrame(drift);
      if (hold || $('start').hidden) return;
      strip.scrollLeft = strip.scrollLeft + 0.6 >= strip.scrollWidth - strip.clientWidth - 1 ? 0 : strip.scrollLeft + 0.6;
    })();
  }
  // Sections fade in as they scroll into view.
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 }) : null;
  document.querySelectorAll('.dash .reveal').forEach(el => (io ? io.observe(el) : el.classList.add('in')));
}

// ---------- boot ----------
renderTextUI();
renderClipUI();
renderProjects();
syncControls();
renderSegs();
syncActions();
commit();
status('Upload a video to get started.');
loadTemplateFonts();
if (location.hash === '#live') { openEditor(); setMode('live'); }
{
  // Design studio links: app.html#design=yt&layout=big-bold opens a new design of that size.
  const m = location.hash.match(/^#design=([a-z]+)(?:&layout=([a-z-]+))?(?:&text=([^&]*))?/);
  if (m) {
    history.replaceState(null, '', location.pathname); openEditor();
    // An optional headline (from the growth planner) replaces the layout's first text.
    const text = m[3] ? decodeURIComponent(m[3]).slice(0, 80) : '';
    blankDesign(m[1], m[2]).then(() => { if (text && texts()[0]) { texts()[0].text = text; commit(); renderTextUI(); } });
  }
}
requestAnimationFrame(loop);

// Exposed for automated end-to-end tests only.
window.__vcz = { S, tpl, setSegments, C, video };
