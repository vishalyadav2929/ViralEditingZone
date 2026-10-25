// Text effects: per-text entry animations, and "break apart" — turn a text wearing a caption template
// into plain text pieces (one per line of the template) that are each fully editable and can each get
// their own animation. Pure functions (tested in Node).
import { textFor } from './renderer.js';

export const TEXT_ANIMS = [
  ['', 'Default'], ['none', 'None'], ['fade', 'Fade in'], ['pop', 'Pop'], ['bounce', 'Bounce'], ['zoom', 'Zoom out'],
  ['slide-up', 'Slide up'], ['slide-down', 'Slide down'], ['slide-left', 'Slide from right'], ['slide-right', 'Slide from left'],
  ['type', 'Typewriter'],
];

const clamp01 = v => Math.min(1, Math.max(0, v));
const easeOut = p => 1 - (1 - p) ** 3;
const easeBack = p => { const c = 1.70158; return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2; };

/**
 * How a text looks at time t under its own animation: { alpha, dx, dy (fractions of the frame), scale,
 * typeP (typewriter: share of characters showing) }. Entry lasts `dur` seconds; typewriter spreads
 * over up to 60 % of the text's time.
 */
export function animState(anim, t, start, end, dur = 0.45) {
  const s = { alpha: 1, dx: 0, dy: 0, scale: 1, typeP: 1 };
  if (!anim || anim === 'none') return s;
  const p = clamp01((t - start) / dur), e = easeOut(p);
  switch (anim) {
    case 'fade': s.alpha = e; break;
    case 'pop': s.scale = 0.4 + 0.6 * easeBack(p); s.alpha = clamp01(p * 3); break;
    case 'bounce': s.dy = -0.06 * Math.abs(Math.cos(p * Math.PI * 1.5)) * (1 - p); s.alpha = clamp01(p * 4); break;
    case 'zoom': s.scale = 1.8 - 0.8 * e; s.alpha = e; break;
    case 'slide-up': s.dy = 0.08 * (1 - e); s.alpha = e; break;
    case 'slide-down': s.dy = -0.08 * (1 - e); s.alpha = e; break;
    case 'slide-left': s.dx = 0.25 * (1 - e); s.alpha = e; break;
    case 'slide-right': s.dx = -0.25 * (1 - e); s.alpha = e; break;
    case 'type': {
      const len = Math.max(0.3, Math.min(2, (end - start) * 0.6));
      s.typeP = clamp01((t - start) / len); // share of the characters showing
      break;
    }
  }
  return s;
}

const lerp = (a, b, u) => a + (b - a) * u;
/**
 * Position of a text at time t from its motion keyframes (free movement across the frame).
 * Keyframes are {t, x, y} (x, y are fractions of the frame). Returns {x, y} eased between the two
 * surrounding keyframes, or null when there are no keyframes. Before the first / after the last it holds.
 */
export function kfSample(kf, t) {
  const s = (kf || []).filter(k => Number.isFinite(k.t) && Number.isFinite(k.x) && Number.isFinite(k.y)).sort((a, b) => a.t - b.t);
  if (!s.length) return null;
  if (t <= s[0].t) return { x: s[0].x, y: s[0].y };
  const last = s[s.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y };
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].t) {
      const a = s[i - 1], b = s[i], u = (t - a.t) / ((b.t - a.t) || 1), e = u * u * (3 - 2 * u); // smoothstep
      return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e) };
    }
  }
  return { x: last.x, y: last.y };
}

/** Add or replace a keyframe near time t (within `snap` seconds). Returns a new, sorted keyframe list. */
export function upsertKf(kf, t, x, y, snap = 0.08) {
  const out = (kf || []).filter(k => Math.abs(k.t - t) > snap);
  out.push({ t: +(+t).toFixed(2), x: +(+x).toFixed(4), y: +(+y).toFixed(4) });
  return out.sort((a, b) => a.t - b.t);
}

// Template entry animations → the closest text animation.
const TPL_ANIM = { pop: 'pop', bounce: 'bounce', slide: 'slide-left', rise: 'slide-up', zoom: 'zoom', fade: 'fade', type: 'type', none: 'none' };

/** Group a template's words into lines the way the template lays them out. */
export function templateLines(words, tp) {
  if (tp.oneLine) return [words];
  if (tp.layout === 'stack') return words.map(w => [w]);
  if (Array.isArray(tp.lines) && tp.lines.length) {
    const out = [];
    let i = 0, k = 0;
    while (i < words.length) {
      const n = Math.max(1, tp.lines[Math.min(k, tp.lines.length - 1)]);
      out.push(words.slice(i, i + n)); i += n; k++;
    }
    return out;
  }
  return [words];
}

/**
 * Break a template text into plain text layers, one per template line, each with the look of its
 * first word's role (font, size, colour, box, outline). Glows and gradients become a plain colour.
 * `aspect` = frame width / height, used to stack the pieces at the right spacing.
 */
export function breakApart(L, tp, aspect = 9 / 16) {
  const words = String(L.text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [];
  const lines = templateLines(words, tp);
  let wi = 0;
  const pieces = lines.map(ws => {
    const role = (tp.roles && tp.roles[wi]) || {};
    const m = { ...tp, ...role };
    const first = wi;
    wi += ws.length;
    const color = m.box ? (m.box.text || m.color) : (m.gradient ? m.gradient[Math.floor(m.gradient.length / 2)] : m.color) || '#ffffff';
    const wc = {};
    ws.forEach((_, j) => { const c = L.wordColors && L.wordColors[first + j]; if (c) wc[j] = c; });
    return {
      text: ws.map(w => textFor(w, m)).join(' '),
      font: m.font || 'Montserrat', bold: (m.weight || 700) >= 700, italic: !!m.italic,
      size: +(L.size * (role.size || 1)).toFixed(4), color,
      stroke: m.stroke ? m.stroke.c : '#000000', strokeW: m.stroke && !m.box ? m.stroke.w : 0,
      bg: m.box ? m.box.c : '#000000', bgOp: m.box ? 100 : 0,
      shadow: !m.box, align: tp.align === 'left' ? 'left' : 'center',
      ...(Object.keys(wc).length ? { wordColors: wc } : {}),
    };
  });
  // Stack the pieces around the original centre. Sizes are fractions of the short side.
  const shortOverH = Math.min(1, aspect); // short side / height
  const gap = tp.lineGap || 1;
  const hs = pieces.map(p => p.size * shortOverH * 1.25 * gap);
  const total = hs.reduce((a, b) => a + b, 0);
  let y = L.y - total / 2;
  return pieces.map((p, i) => {
    const cy = y + hs[i] / 2; y += hs[i];
    return { ...p, x: L.x, y: +Math.min(0.97, Math.max(0.03, cy)).toFixed(4), start: L.start, end: L.end, oneLine: true, anim: L.anim || TPL_ANIM[tp.anim] || 'fade', tpl: null };
  });
}
