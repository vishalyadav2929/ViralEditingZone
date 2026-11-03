// Match this look: pick a reference photo (or a frame you like) and the editor reads its colours —
// on this device, nothing is uploaded — then suggests the closest built-in colour look and caption
// style. Pure maths on pixels (tested in Node): character stats (warmth, saturation, contrast,
// brightness) are compared with each look's measured character, and the reference's strongest accent
// colour is compared with each caption style's colours.
import { LOOKS } from './grade.js';
import { TEMPLATES } from './templates.js';

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** RGB (0..1) → [h 0..360, s 0..1, l 0..1]. */
export function rgbToHsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (mx === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

const hexToRgb = hex => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};

/**
 * Character stats of a set of RGB colours (each 0..1):
 * lum/sat/warm averages, contrast (luminance spread), and the dominant accent colour
 * (the most saturated hue family, saturation-weighted).
 */
export function colourStats(colours) {
  const n = colours.length || 1;
  let r = 0, g = 0, b = 0, sat = 0, lumSum = 0, lumSq = 0;
  const buckets = new Array(12).fill(0), bucketRgb = Array.from({ length: 12 }, () => [0, 0, 0]);
  for (const [cr, cg, cb] of colours) {
    r += cr; g += cg; b += cb;
    const l = lumOf(cr, cg, cb);
    lumSum += l; lumSq += l * l;
    const [h, s] = rgbToHsl(cr, cg, cb);
    sat += s;
    if (s > 0.25) { const k = Math.floor(h / 30) % 12; buckets[k] += s; bucketRgb[k][0] += cr * s; bucketRgb[k][1] += cg * s; bucketRgb[k][2] += cb * s; }
  }
  const lum = lumSum / n;
  let accent = null, best = 0.35; // an accent must be clearly present, not just noise
  buckets.forEach((wgt, k) => {
    if (wgt > best) { best = wgt; const t = bucketRgb[k]; accent = [t[0] / wgt, t[1] / wgt, t[2] / wgt]; }
  });
  return {
    avg: [r / n, g / n, b / n],
    lum,
    sat: sat / n,
    warm: (r - b) / n,
    contrast: Math.sqrt(Math.max(0, lumSq / n - lum * lum)),
    accent,
    accentHue: accent ? rgbToHsl(...accent)[0] : null,
  };
}

/** Sample an ImageData-like { data, width, height } down to at most ~4000 colours. */
export function sampleImageData(img) {
  const { data, width, height } = img;
  const total = width * height, step = Math.max(1, Math.floor(total / 4000));
  const out = [];
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    if (data[o + 3] < 200) continue; // skip (near-)transparent pixels
    out.push([data[o] / 255, data[o + 1] / 255, data[o + 2] / 255]);
  }
  return out;
}

// A balanced probe palette: every look is measured by what it does to the same colours.
const PROBE = [];
for (const r of [0.15, 0.4, 0.65, 0.9]) for (const g of [0.15, 0.4, 0.65, 0.9]) for (const b of [0.15, 0.4, 0.65, 0.9]) PROBE.push([r, g, b]);
const PROBE_STATS = colourStats(PROBE);
const lookProfileCache = {};
/** A look's character: how it shifts the probe palette's stats. */
export function lookProfile(id) {
  if (lookProfileCache[id]) return lookProfileCache[id];
  const fn = LOOKS[id] && LOOKS[id].fn;
  if (!fn) return null;
  const after = colourStats(PROBE.map(([r, g, b]) => fn(r, g, b).map(clamp01)));
  const p = { warm: after.warm - PROBE_STATS.warm, sat: after.sat - PROBE_STATS.sat, contrast: after.contrast - PROBE_STATS.contrast, lum: after.lum - PROBE_STATS.lum, satAbs: after.sat };
  lookProfileCache[id] = p;
  return p;
}

// How far the reference sits from a plain, neutral photo on each axis — the direction a look
// should push in. (Probe stats stand in for "neutral".)
const direction = st => ({
  warm: st.warm - PROBE_STATS.warm,
  sat: st.sat - PROBE_STATS.sat,
  contrast: st.contrast - PROBE_STATS.contrast,
  lum: st.lum - PROBE_STATS.lum,
});

const W4 = { warm: 2.2, sat: 1.6, contrast: 1.4, lum: 1.1 }; // warmth differences are small in absolute terms
function lookScore(st, id) {
  const d = direction(st), p = lookProfile(id);
  if (!p) return -1;
  // The reference is already graded by life: the best look is the one whose own push lands the
  // palette closest to the reference's character — direction and size both count.
  let s = 0;
  for (const k of ['warm', 'sat', 'contrast', 'lum']) s -= Math.abs(d[k] - p[k]) * W4[k];
  // A black-and-white look only wins when the reference really has almost no colour.
  if (p.satAbs < 0.08 && st.sat > 0.16) s -= 0.6;
  return s;
}

const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Every colour a caption style wears (base, highlight, boxes, emphasis gradients…). */
export function templateColours(t) {
  const out = [];
  const add = c => { const rgb = typeof c === 'string' && hexToRgb(c); if (rgb) out.push(rgb); };
  add(t.color); add(t.hiColor); add(t.glow);
  if (t.bg) add(t.bg.c);
  if (t.pill) add(t.pill.c);
  if (t.emph) { add(t.emph.glow); (t.emph.gradient || []).forEach(add); if (t.emph.key) add(t.emph.key.color); if (t.emph.other) add(t.emph.other.color); }
  for (const r of t.roles || []) { add(r.color); add(r.glow); (r.gradient || []).forEach(add); if (r.box) add(r.box.c); }
  return out;
}

function templateScore(st, t) {
  if (t.none) return -1;
  const cols = templateColours(t);
  // Plain white styles go with anything — a fair baseline, beaten by a real colour match.
  let best = 0.32;
  if (st.accentHue != null) {
    for (const c of cols) {
      const [h, s] = rgbToHsl(...c);
      if (s < 0.35) continue; // greys/whites carry no hue to match
      const score = (1 - hueDist(h, st.accentHue) / 180) * (0.45 + 0.55 * s);
      if (score > best) best = score;
    }
  }
  // A dark reference wants styles that stay readable on dark frames (they nearly all are); a very
  // bright reference slightly favours styles with a box/plate behind the words.
  if (st.lum > 0.62 && (t.bg || t.pill)) best += 0.06;
  return best;
}

/** Plain-words description of the reference's character, for showing the user why. */
export function describeStats(st) {
  const bits = [];
  bits.push(st.lum > 0.62 ? 'bright' : st.lum < 0.34 ? 'dark' : 'mid-bright');
  bits.push(st.warm > 0.045 ? 'warm' : st.warm < -0.045 ? 'cool' : 'neutral colours');
  bits.push(st.sat > 0.42 ? 'very colourful' : st.sat < 0.16 ? 'barely any colour' : 'softly coloured');
  bits.push(st.contrast > 0.24 ? 'high contrast' : st.contrast < 0.15 ? 'flat, soft contrast' : 'normal contrast');
  return bits.join(' · ');
}

/**
 * Suggest the closest colour look + caption style for a reference image's pixels.
 * img: an ImageData-like { data, width, height }. Returns { stats, look, lookName, tpl, tplName, why }.
 */
export function matchLook(img) {
  const st = colourStats(sampleImageData(img));
  let look = null, lookBest = -Infinity;
  for (const id of Object.keys(LOOKS)) { const s = lookScore(st, id); if (s > lookBest) { lookBest = s; look = id; } }
  let tpl = null, tplBest = -Infinity;
  for (const t of TEMPLATES) { const s = templateScore(st, t); if (s > tplBest) { tplBest = s; tpl = t; } }
  return { stats: st, look, lookName: LOOKS[look].name, tpl, tplName: tpl.name, why: describeStats(st) };
}
