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

// ---------- vector shapes (stickers) ----------
// A shape layer is an ordinary text layer with `shape` set: the shape is its body, the text (if
// any) sits centred on top, and the layer's Box colour/opacity is the shape's fill — so the same
// controls, dragging, timing, animation and export paths all work unchanged. Paths live in a
// 100×100 box and scale to the layer's box, so one shape works at any size. (Hand-drawn paths and
// generated polygons — no AI, no image files.)
const poly = (n, r1, r2, phase = -Math.PI / 2) => {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1, a = phase + i * Math.PI / n;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)} ${(50 + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(' L')} Z`;
};
const circle = (cx, cy, r) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;

export const SHAPES = [
  { id: 'burst', name: 'Price burst', ar: 1, d: poly(16, 50, 37) },
  { id: 'tag', name: 'Price tag', ar: 1.3, evenOdd: true, d: `M8 32 L36 8 H92 V60 L64 92 L8 64 Z ${circle(26, 27, 5.5)}` },
  { id: 'seal', name: 'Badge', ar: 1, d: poly(18, 50, 45) },
  { id: 'star', name: 'Star', ar: 1, d: poly(5, 50, 21) },
  { id: 'heart', name: 'Heart', ar: 1, d: 'M50 84 C20 62 8 44 8 29 C8 15 19 7 31 7 C40 7 47 12 50 20 C53 12 60 7 69 7 C81 7 92 15 92 29 C92 44 80 62 50 84 Z' },
  { id: 'bubble', name: 'Speech bubble', ar: 1.3, d: 'M14 6 H86 A12 12 0 0 1 98 18 V58 A12 12 0 0 1 86 70 H54 L32 94 L36 70 H14 A12 12 0 0 1 2 58 V18 A12 12 0 0 1 14 6 Z' },
  { id: 'arrow-r', name: 'Arrow →', ar: 1.35, d: 'M6 37 H56 V20 L95 50 L56 80 V63 H6 Z' },
  { id: 'arrow-d', name: 'Arrow ↓', ar: 0.75, d: 'M37 6 H63 V56 H80 L50 95 L20 56 H37 Z' },
  { id: 'arrow-c', name: 'Curved arrow', ar: 1.15, d: 'M95 34 C66 10 30 12 14 36 L6 28 L12 58 L38 48 L31 39 C43 22 62 20 80 32 Z' },
  { id: 'ribbon', name: 'Ribbon', ar: 2.4, d: 'M6 22 H94 V56 H6 Z M6 56 L0 80 L24 67 L24 56 Z M94 56 L100 80 L76 67 L76 56 Z' },
  { id: 'ring', name: 'Ring badge', ar: 1, evenOdd: true, d: `${circle(50, 50, 48)} ${circle(50, 50, 33)}` },
];

/** Trace a shape's path into ctx at box (x, y, w, h); fill or stroke it with the current style. */
export function paintShape(ctx, x, y, w, h, id, mode = 'fill') {
  const sh = SHAPES.find(s => s.id === id);
  if (!sh) return false;
  ctx.save();
  ctx.translate(x, y); ctx.scale(w / 100, h / 100);
  const p = new Path2D(sh.d);
  if (mode === 'stroke') ctx.stroke(p); else if (sh.evenOdd) ctx.fill(p, 'evenodd'); else ctx.fill(p);
  ctx.restore();
  return true;
}

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
  const box = { px, lines, widths, lineH, w, h, x0, y0, cx: x0 + w / 2 };
  if (L.shape) {
    // The shape is the layer's body: at least as big as the text plus padding, or the size the
    // user picked when there's no text. The returned box is the shape's box (hit-testing uses it);
    // tx0/ty0 say where the text block sits inside it.
    const sh = SHAPES.find(s => s.id === L.shape);
    if (sh) {
      let sw = Math.max(w + px * 1.6, L.size * Math.min(W, H) * 3.4), shh = sw / sh.ar;
      const need = h + px * 1.1;
      if (shh < need) { shh = need; sw = shh * sh.ar; }
      const smx = W * 0.02, smy = H * 0.015;
      const sx0 = Math.min(Math.max(L.x * W - sw / 2, smx), Math.max(smx, W - smx - sw));
      const sy0 = Math.min(Math.max(L.y * H - shh / 2, smy), Math.max(smy, H - smy - shh));
      return { ...box, shape: true, sw, sh: shh, w: sw, h: shh, x0: sx0, y0: sy0, cx: sx0 + sw / 2, tx0: sx0 + sw / 2 - w / 2, ty0: sy0 + shh / 2 - h / 2 };
    }
  }
  return box;
}

const hexA = (hex, a) => {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export function drawLayer(ctx, W, H, L) {
  if (!L.shape && !String(L.text).trim()) return null;
  const b = layout(ctx, W, H, L);
  ctx.save();
  if (L.op != null && L.op < 1) ctx.globalAlpha *= Math.max(0, L.op);
  ctx.font = fontOf(L, b.px);
  ctx.textBaseline = 'middle';
  const pad = b.px * 0.3;
  if (b.shape) {
    // The shape itself is the body (the round-rect box below is skipped): Box colour = its fill.
    ctx.save();
    if (L.shadow) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = b.px * 0.18; ctx.shadowOffsetY = b.px * 0.05; }
    ctx.fillStyle = hexA(L.bg, (L.bgOp == null ? 100 : L.bgOp) / 100);
    paintShape(ctx, b.x0, b.y0, b.sw, b.sh, L.shape);
    ctx.restore();
    if (L.strokeW > 0) {
      ctx.save();
      ctx.strokeStyle = L.stroke; ctx.lineWidth = 1.5 + L.strokeW * 20; ctx.lineJoin = 'round';
      paintShape(ctx, b.x0, b.y0, b.sw, b.sh, L.shape, 'stroke');
      ctx.restore();
    }
  } else if (L.bgOp > 0) {
    ctx.fillStyle = hexA(L.bg, L.bgOp / 100);
    const r = Math.min(b.px * 0.35, (b.h + pad * 2) / 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(b.x0 - pad, b.y0 - pad * 0.6, b.w + pad * 2, b.h + pad * 1.2, r);
    else ctx.rect(b.x0 - pad, b.y0 - pad * 0.6, b.w + pad * 2, b.h + pad * 1.2);
    ctx.fill();
  }
  const align = b.shape ? 'center' : L.align; // text on a shape always sits in its middle
  ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
  const x = align === 'left' ? b.x0 : align === 'right' ? b.x0 + b.w : b.cx;
  const wc = L.wordColors || {};
  const coloured = Object.keys(wc).length > 0;
  let wi = 0; // word index across lines
  b.lines.forEach((s, i) => {
    const y = (b.shape ? b.ty0 : b.y0) + b.lineH * (i + 0.5);
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
