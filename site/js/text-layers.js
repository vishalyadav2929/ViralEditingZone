// Free text on the video or photo (titles, hooks, labels): typed by hand, shown exactly as typed,
// all at once — not word by word like captions. Each layer has its own font, size, colours, place and
// time range. Sizes and positions are fractions of the frame, so preview and export look the same.
import { fontString } from './templates.js';

export const TEXT_FONTS = ['Poppins', 'Montserrat', 'Inter', 'Anton', 'Bebas Neue', 'Oswald', 'Archivo Black', 'Teko',
  'Bangers', 'Luckiest Guy', 'Lilita One', 'Righteous', 'Bungee', 'Fredoka', 'Permanent Marker', 'Pacifico',
  'Dancing Script', 'Great Vibes', 'Caveat', 'Kalam', 'Playfair Display', 'Abril Fatface', 'Rozha One', 'Yatra One',
  'Baloo 2', 'Mukta', 'Space Mono'];

export function newLayer(o = {}) {
  return {
    id: Math.random().toString(36).slice(2, 9),
    text: 'Your text', start: 0, end: 3, x: 0.5, y: 0.3, size: 0.07, font: 'Poppins', bold: true, italic: false,
    color: '#ffffff', stroke: '#000000', strokeW: 0, bg: '#000000', bgOp: 0, shadow: true, align: 'center', ...o,
  };
}

/** Layers to draw at time t. Photos have no time, so every layer shows. */
export const layersAt = (list, t, still = false) => (list || []).filter(l => still || (t >= l.start && t < l.end));

/** Break text into lines: the user's own line breaks are kept, long lines wrap between words. */
export function wrapLines(text, maxW, measure) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let cur = words[0];
    for (const w of words.slice(1)) {
      const next = `${cur} ${w}`;
      if (measure(next) > maxW) { out.push(cur); cur = w; } else cur = next;
    }
    out.push(cur);
  }
  return out;
}

const fontOf = (L, px) => fontString({ font: L.font, weight: L.bold ? 800 : 500, italic: L.italic }, px);

/** Where a layer sits on a W×H frame (box in frame pixels). */
export function layout(ctx, W, H, L) {
  let px = Math.max(6, L.size * Math.min(W, H));
  ctx.font = fontOf(L, px);
  let lines;
  if (L.oneLine) {
    // One line: no wrapping; shrink the text if it's wider than the frame.
    lines = [String(L.text).replace(/\s+/g, ' ').trim()];
    const w0 = ctx.measureText(lines[0]).width;
    if (w0 > W * 0.94) { px *= W * 0.94 / w0; ctx.font = fontOf(L, px); }
  } else lines = wrapLines(L.text, W * 0.92, s => ctx.measureText(s).width);
  const widths = lines.map(s => ctx.measureText(s).width);
  const lineH = px * 1.2, w = Math.max(px * 0.5, ...widths), h = lines.length * lineH;
  // Keep the whole block inside the frame (e.g. a layout made for 16:9 used on a tall cover).
  const mx = W * 0.03, my = H * 0.02;
  const x0 = Math.min(Math.max(L.x * W - w / 2, mx), Math.max(mx, W - mx - w));
  const y0 = Math.min(Math.max(L.y * H - h / 2, my), Math.max(my, H - my - h));
  return { px, lines, widths, lineH, w, h, x0, y0, cx: x0 + w / 2 };
}

const hexA = (hex, a) => {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export function drawLayer(ctx, W, H, L) {
  if (!String(L.text).trim()) return null;
  const b = layout(ctx, W, H, L);
  ctx.save();
  if (L.op != null && L.op < 1) ctx.globalAlpha *= Math.max(0, L.op);
  ctx.font = fontOf(L, b.px);
  ctx.textBaseline = 'middle';
  const pad = b.px * 0.3;
  if (L.bgOp > 0) {
    ctx.fillStyle = hexA(L.bg, L.bgOp / 100);
    const r = Math.min(b.px * 0.35, (b.h + pad * 2) / 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(b.x0 - pad, b.y0 - pad * 0.6, b.w + pad * 2, b.h + pad * 1.2, r);
    else ctx.rect(b.x0 - pad, b.y0 - pad * 0.6, b.w + pad * 2, b.h + pad * 1.2);
    ctx.fill();
  }
  ctx.textAlign = L.align === 'left' ? 'left' : L.align === 'right' ? 'right' : 'center';
  const x = L.align === 'left' ? b.x0 : L.align === 'right' ? b.x0 + b.w : b.cx;
  const wc = L.wordColors || {};
  const coloured = Object.keys(wc).length > 0;
  let wi = 0; // word index across lines
  b.lines.forEach((s, i) => {
    const y = b.y0 + b.lineH * (i + 0.5);
    if (L.strokeW > 0) {
      ctx.lineJoin = 'round'; ctx.miterLimit = 2;
      ctx.lineWidth = b.px * L.strokeW; ctx.strokeStyle = L.stroke;
      ctx.strokeText(s, x, y);
    }
    if (L.shadow || L.glow) {
      const k = L.shadowS != null ? L.shadowS : 1; // 0..2, from the strength slider
      if (L.glow) { ctx.shadowColor = hexA(L.color, 0.9); ctx.shadowBlur = b.px * 0.3 * k; ctx.shadowOffsetY = 0; }
      else { ctx.shadowColor = `rgba(0,0,0,${Math.min(0.85, 0.55 * k)})`; ctx.shadowBlur = b.px * 0.18 * k; ctx.shadowOffsetY = b.px * 0.05 * k; }
    }
    const words = s.split(' ').filter(Boolean);
    if (!coloured || !words.length) { ctx.fillStyle = L.color; ctx.fillText(s, x, y); wi += words.length; }
    else {
      // Word by word, so each can have its own colour; same positions as the whole line.
      const lw = ctx.measureText(s).width, sp = ctx.measureText(' ').width;
      let cx = ctx.textAlign === 'left' ? x : ctx.textAlign === 'right' ? x - lw : x - lw / 2;
      const al = ctx.textAlign; ctx.textAlign = 'left';
      for (const w of words) { ctx.fillStyle = wc[wi] || L.color; ctx.fillText(w, cx, y); cx += ctx.measureText(w).width + sp; wi++; }
      ctx.textAlign = al;
    }
    ctx.shadowColor = 'transparent';
  });
  ctx.restore();
  return b;
}

/** Draw every visible layer; returns their boxes (topmost last) for hit-testing. */
export function drawLayers(ctx, W, H, list, t, still = false) {
  const boxes = [];
  for (const L of layersAt(list, t, still)) { const b = drawLayer(ctx, W, H, L); if (b) boxes.push({ id: L.id, ...b }); }
  return boxes;
}

/** The id of the topmost layer under (x, y), from the boxes drawLayers returned. */
export function hitLayer(boxes, x, y) {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i], pad = b.px * 0.4;
    if (x >= b.x0 - pad && x <= b.x0 + b.w + pad && y >= b.y0 - pad && y <= b.y0 + b.h + pad) return b.id;
  }
  return null;
}
