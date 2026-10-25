import { fontString } from './templates.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeOut = p => 1 - Math.pow(1 - p, 3);
const easeOutBack = p => { const c = 1.9; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
const easeOutBounce = p => {
  if (p < 1 / 2.75) return 7.5625 * p * p;
  if (p < 2 / 2.75) return 7.5625 * (p -= 1.5 / 2.75) * p + 0.75;
  if (p < 2.5 / 2.75) return 7.5625 * (p -= 2.25 / 2.75) * p + 0.9375;
  return 7.5625 * (p -= 2.625 / 2.75) * p + 0.984375;
};
const INDIC = /[ऀ-෿]/;

// Group timed words into on-screen caption groups.
export function buildChunks(words, maxWords = 3, maxChars = 32) {
  const chunks = [];
  let cur = [], chars = 0, from = 0;
  const flush = (to) => {
    if (!cur.length) return;
    chunks.push({ words: cur, from, to, start: cur[0].start, end: cur[cur.length - 1].end });
    cur = []; chars = 0; from = to;
  };
  words.forEach((w, i) => {
    const prev = cur[cur.length - 1];
    if (cur.length && (cur.length >= maxWords || chars + w.text.length > maxChars || (prev && w.start - prev.end > 0.7))) flush(i);
    cur.push(w); chars += w.text.length + 1;
    if (maxWords > 1 && /[.!?।|]$/.test(w.text)) flush(i + 1);
  });
  flush(words.length);
  // Hold each group on screen until the next one starts, unless there's a long pause.
  chunks.forEach((c, i) => {
    const next = chunks[i + 1];
    c.end = next ? Math.max(c.end, Math.min(next.start, c.end + 0.6)) : c.end + 0.6;
  });
  return chunks;
}

export function findChunk(chunks, t) {
  let lo = 0, hi = chunks.length - 1, found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chunks[mid].start <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (found === null) return null;
  const c = chunks[found];
  return t < c.end ? c : null;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, h / 2, w / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- word styles ----------
// A word's look = template base, then its role (by position or key word), then its state
// (pending / active / past), then the template's highlight mode.

function baseStyle(tpl) {
  return {
    font: tpl.font, weight: tpl.weight, italic: !!tpl.italic, size: 1, color: tpl.color,
    stroke: tpl.stroke, shadow: tpl.shadow, glow: tpl.glow ? { c: tpl.glow, b: 0.45 } : null,
    upper: !!tpl.upper, lower: !!tpl.lower, title: !!tpl.title, spacing: tpl.spacing || 0,
  };
}

function keyIndex(words) {
  let k = 0;
  words.forEach((w, i) => { if (w.text.length > words[k].text.length) k = i; });
  return k;
}

function styleFor(tpl, i, n, key, state) {
  const s = baseStyle(tpl);
  const em = tpl.emph;
  if (em) {
    Object.assign(s, i === key
      ? { size: em.scale, weight: em.weight ?? tpl.weight, italic: !!em.italic, gradient: em.gradient, glow: em.glow ? { c: em.glow, b: 0.4 } : s.glow, ...(em.key || {}) }
      : { size: em.small || 1, italic: !!em.otherItalic, ...(em.other || {}) });
  }
  if (tpl.roles) {
    const r = tpl.roles;
    Object.assign(s, r[Math.min(i, r.length - 1)] || {});
  }
  if (state === 'pending' && tpl.pending) Object.assign(s, tpl.pending);
  if (state === 'active' && tpl.active) Object.assign(s, tpl.active);
  if (state === 'past' && tpl.past) Object.assign(s, tpl.past);
  if (tpl.dim && tpl.hi === 'karaoke' && state === 'pending') s.opacity = tpl.dim;
  if (state === 'active') {
    if (tpl.hi === 'color' || tpl.hi === 'scale') { s.color = tpl.hiColor; s.gradient = null; }
    if (tpl.hi === 'box') s.box = { c: tpl.hiColor, text: tpl.boxText || '#fff' };
  }
  if (state === 'past' && tpl.hi === 'karaoke') { s.color = tpl.hiColor; s.gradient = null; }
  return s;
}

function styleFont(s, px) {
  return fontString({ font: s.font, weight: s.weight, italic: s.italic }, px);
}

// Acronyms the speaker meant in capitals (AC, TV, UPI, OK) stay that way in Title and lower-case styles.
const ACRONYM = /^[^\p{L}\p{N}]*[A-Z][A-Z0-9]+[^\p{L}\p{N}]*$/u;
export function textFor(text, s) {
  if (s.upper) return text.toUpperCase();
  if ((s.title || s.lower) && ACRONYM.test(text)) return text;
  if (s.title) return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  if (s.lower) return text.toLowerCase();
  return text;
}

// ---------- ransom-note letters ----------
const RANSOM_BG = ['#E63946', '#F4D35E', '#FFFFFF', '#2A9D8F', '#1D3557', '#F77F00', '#9B5DE5', '#00BBF9', '#111111'];
const RANSOM_FONTS = ['Anton', 'Archivo Black', 'Playfair Display', 'Bangers', 'Space Mono', 'Bebas Neue', 'Luckiest Guy'];
const hash = (a, b) => { const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); };

function ransomLayout(ctx, text, px, seed) {
  const letters = [...text].map((ch, i) => {
    const r = hash(seed + i, ch.charCodeAt(0));
    const font = `${RANSOM_FONTS[Math.floor(r * RANSOM_FONTS.length)]}`;
    const lpx = px * (0.85 + hash(i, seed) * 0.3);
    ctx.font = fontString({ font, weight: 700 }, lpx);
    const w = ch === ' ' ? px * 0.3 : ctx.measureText(ch).width + px * 0.22;
    const bg = RANSOM_BG[Math.floor(hash(seed * 3 + i, 7) * RANSOM_BG.length)];
    return { ch, font, lpx, w, bg, rot: (hash(i, seed + 9) - 0.5) * 0.22 };
  });
  return { letters, width: letters.reduce((a, l) => a + l.w + px * 0.04, 0) };
}

function drawRansom(ctx, lay, px, t, live) {
  let x = -lay.width / 2;
  lay.letters.forEach((l, i) => {
    if (l.ch !== ' ') {
      ctx.save();
      ctx.translate(x + l.w / 2, 0);
      ctx.rotate(l.rot + (live ? Math.sin(t * 6 + i) * 0.06 : 0));
      ctx.fillStyle = l.bg;
      ctx.fillRect(-l.w / 2, -px * 0.62, l.w, px * 1.24);
      ctx.font = fontString({ font: l.font, weight: 700 }, l.lpx);
      ctx.fillStyle = ['#FFFFFF', '#F4D35E', '#00BBF9'].includes(l.bg) ? '#111' : '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(l.ch, 0, px * 0.04);
      ctx.restore();
    }
    x += l.w + px * 0.04;
  });
}

// ---------- drawing one styled word at (0,0) ----------
function drawStyled(ctx, it, s, px, t, tpl) {
  if (it.ransom) return drawRansom(ctx, it.ransom, px, t, tpl.fx === 'ransomLive' && !tpl.still);
  const text = it.text;
  if (s.box) {
    const padX = px * 0.18, padY = px * 0.1, bh = px * (it.indic ? 1.3 : 1.1);
    ctx.fillStyle = s.box.c;
    roundRect(ctx, -it.width / 2 - padX, -bh / 2 - padY, it.width + padX * 2, bh + padY * 2, px * (s.box.r ?? 0.14));
    ctx.fill();
  }
  let fill = s.box ? (s.box.text || s.color) : s.color;
  if (s.gradient) {
    const horiz = s.gradDir === 'x';
    const g = horiz ? ctx.createLinearGradient(-it.width / 2, 0, it.width / 2, 0) : ctx.createLinearGradient(0, -px * 0.45, 0, px * 0.45);
    s.gradient.forEach((c, i) => g.addColorStop(i / (s.gradient.length - 1), c));
    fill = g;
  }
  if (s.extrude) {
    const d = Math.max(2, Math.round(px * s.extrude.d));
    ctx.fillStyle = s.extrude.c;
    for (let k = d; k > 0; k--) ctx.fillText(text, k * 0.7, k);
  }
  if (s.shadow) {
    ctx.shadowColor = s.shadow.c;
    ctx.shadowBlur = s.shadow.b * px;
    ctx.shadowOffsetX = s.shadow.x * px;
    ctx.shadowOffsetY = s.shadow.y * px;
  }
  if (s.stroke2) {
    ctx.strokeStyle = s.stroke2.c;
    ctx.lineWidth = s.stroke2.w * px;
    ctx.strokeText(text, 0, 0);
    ctx.shadowColor = 'transparent';
  }
  if (s.stroke && !s.box) {
    ctx.strokeStyle = s.stroke.c;
    ctx.lineWidth = s.stroke.w * px;
    ctx.strokeText(text, 0, 0);
    ctx.shadowColor = 'transparent';
  }
  if (s.outline) {
    ctx.strokeStyle = fill;
    ctx.lineWidth = px * 0.045;
    ctx.strokeText(text, 0, 0);
    ctx.shadowColor = 'transparent';
    return;
  }
  if (s.glow) {
    ctx.shadowColor = s.glow.c;
    ctx.shadowBlur = px * s.glow.b;
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = fill;
    ctx.fillText(text, 0, 0);
    ctx.shadowBlur = px * s.glow.b * 0.35;
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.shadowColor = 'transparent';
}

// ---------- special whole-caption layouts ----------
function drawNotification(ctx, W, H, chunk, t, px, cy, alpha) {
  const words = chunk.words.filter(w => w.start <= t).map(w => w.text).join(' ') || chunk.words[0].text;
  const fs = px * 0.5;
  ctx.font = fontString({ font: 'Inter', weight: 600 }, fs);
  const tw = Math.max(ctx.measureText(words).width, px * 3);
  const cw = Math.min(W * 0.86, tw + px * 2.2), ch = px * 1.5;
  const x = W / 2 - cw / 2, y = cy - ch / 2;
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = px * 0.4; ctx.shadowOffsetY = px * 0.08;
  ctx.fillStyle = 'rgba(235,235,240,.94)';
  roundRect(ctx, x, y, cw, ch, px * 0.32); ctx.fill();
  ctx.shadowColor = 'transparent';
  const ic = px * 0.8, ix = x + px * 0.32, iy = cy - ic / 2;
  const g = ctx.createLinearGradient(ix, iy + ic, ix + ic, iy);
  ['#FEDA75', '#FA7E1E', '#D62976', '#962FBF', '#4F5BD5'].forEach((c, i) => g.addColorStop(i / 4, c));
  ctx.fillStyle = g; roundRect(ctx, ix, iy, ic, ic, ic * 0.25); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = ic * 0.08;
  roundRect(ctx, ix + ic * 0.22, iy + ic * 0.22, ic * 0.56, ic * 0.56, ic * 0.16); ctx.stroke();
  ctx.beginPath(); ctx.arc(ix + ic / 2, iy + ic / 2, ic * 0.13, 0, Math.PI * 2); ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#555';
  ctx.font = fontString({ font: 'Inter', weight: 600 }, px * 0.3);
  ctx.fillText('Instagram', ix + ic + px * 0.3, cy - px * 0.28);
  ctx.textAlign = 'right';
  ctx.fillText('now', x + cw - px * 0.3, cy - px * 0.28);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#111';
  ctx.font = fontString({ font: 'Inter', weight: 600 }, fs);
  ctx.fillText(words, ix + ic + px * 0.3, cy + px * 0.2, cw - ic - px * 1);
}

// Offscreen canvas for "video inside the letters" styles.
let off = null;

/**
 * Draw one caption group.
 * opts: { scale, pos, fill } — size multiplier, vertical position (0..1), and an
 * image/video/canvas that fills the letters for `fx: 'videoFill'` styles.
 */
export function drawCaption(ctx, W, H, chunk, t, tpl, opts = {}) {
  if (!chunk || !chunk.words.length || tpl.none) return;

  if (tpl.fx === 'videoFill' && opts.fill && !opts._inner) {
    off = off || document.createElement('canvas');
    if (off.width !== W || off.height !== H) { off.width = W; off.height = H; }
    const o = off.getContext('2d');
    o.clearRect(0, 0, W, H);
    drawCaption(o, W, H, chunk, t, tpl, { ...opts, _inner: true });
    o.globalCompositeOperation = 'source-in';
    const src = opts.fill, sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
    if (sw && sh) {
      const k = Math.max(W / sw, H / sh);
      o.filter = 'brightness(1.35) contrast(1.1)';
      o.drawImage(src, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
      o.filter = 'none';
    }
    o.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 12;
    ctx.drawImage(off, 0, 0);
    ctx.restore();
    return;
  }

  const px = tpl.size * Math.min(W, H) * 1.6 * (opts.scale || 1);
  const pos = opts.pos ?? tpl.pos ?? 0.72;
  let cy = clamp(pos, 0.06, 0.95) * H;
  const posX = opts.posX ?? tpl.posX ?? 0.5;
  let cx = clamp(posX, 0.05, 0.95) * W;
  const hasIndic = chunk.words.some(w => INDIC.test(w.text));
  const maxW = W * clamp(tpl.maxWidth ?? 0.88, 0.3, 0.96);

  // Group entry animation.
  // opts.settled (a paused preview): show the caption fully, as it looks once its animations have played.
  const e = opts.settled ? 1 : clamp((t - chunk.start) / (tpl.animDur || 0.22));
  let alpha = 1, gScale = 1, gx = 0, gy = 0, gRot = 0;
  switch (tpl.anim) {
    case 'pop': gScale = 0.7 + 0.3 * easeOutBack(e); alpha = clamp(e * 3); break;
    case 'bounce': gy = (1 - easeOutBounce(e)) * px * 0.6; alpha = clamp(e * 3); break;
    case 'slide': gx = (1 - easeOut(e)) * -px * 0.6; alpha = easeOut(e); break;
    case 'slide-right': gx = (1 - easeOut(e)) * px * 0.6; alpha = easeOut(e); break;
    case 'drop': gy = (1 - easeOutBounce(e)) * -px * 0.8; alpha = clamp(e * 3); break;
    case 'swing': gRot = (1 - easeOutBack(e)) * -0.35; alpha = clamp(e * 3); break;
    case 'rise': gy = (1 - easeOut(e)) * px * 0.5; alpha = easeOut(e); break;
    case 'zoom': gScale = 1.6 - 0.6 * easeOut(e); alpha = easeOut(e); break;
    case 'fade': alpha = easeOut(e); break;
  }

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  if (tpl.fx === 'notification') {
    ctx.translate(W / 2 + gx, cy + gy); ctx.scale(gScale, gScale); ctx.translate(-W / 2, -cy);
    drawNotification(ctx, W, H, chunk, tpl.still || opts.settled ? Math.max(t, chunk.end - 0.01) : t, px, cy, alpha);
    ctx.restore();
    return;
  }

  // Measure every word in its own style.
  let active = -1;
  chunk.words.forEach((w, i) => { if (w.start <= t) active = i; });
  const key = keyIndex(chunk.words);
  const n = chunk.words.length;
  const items = chunk.words.map((w, i) => {
    // "Still" (animation off): every word in its final look, nothing changes while the caption shows.
    const state = tpl.still ? 'past' : i < active ? 'past' : i === active ? 'active' : 'pending';
    const s = styleFor(tpl, i, n, key, state);
    // A colour the editor picked for this one word wins over the template.
    if (w.color) { s.color = w.color; s.gradient = null; }
    let ipx = px * s.size;
    const text = textFor(w.text, s);
    const it = { w, i, text, s, state, indic: INDIC.test(w.text) };
    if (tpl.fx === 'ransom' || tpl.fx === 'ransomLive') {
      it.ransom = ransomLayout(ctx, text, ipx, i * 31 + text.length);
      it.width = it.ransom.width;
    } else {
      ctx.font = styleFont(s, ipx);
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${(s.spacing || 0) * ipx}px`;
      it.width = ctx.measureText(text).width;
      if (it.width > maxW) { ipx *= maxW / it.width; it.width = maxW; }
    }
    it.px = ipx;
    return it;
  });
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.font = fontString(tpl, px);
  let space = Math.max(ctx.measureText(' ').width, px * 0.26) + (tpl.spacing || 0) * px + (tpl.gap || 0) * px;

  // Lines: explicit pattern, one word per line, or wrap to width.
  const lines = [];
  if (tpl.oneLine || opts.oneLine) {
    // Everything on one line: shrink the words together if they don't fit.
    const total = items.reduce((a, it, k) => a + it.width + (k ? space : 0), 0);
    if (total > maxW) {
      const f = maxW / total;
      items.forEach(it => { it.px *= f; it.width *= f; });
      space *= f;
    }
    lines.push({ items });
  } else if (tpl.lines) {
    let k = 0, li = 0;
    while (k < items.length) {
      const cnt = tpl.lines[Math.min(li, tpl.lines.length - 1)];
      lines.push({ items: items.slice(k, k + cnt) }); k += cnt; li++;
    }
  } else if (tpl.layout === 'stack') {
    items.forEach(it => lines.push({ items: [it] }));
  } else {
    let line = [], lw = 0;
    for (const it of items) {
      const add = (line.length ? space : 0) + it.width;
      if (line.length && lw + add > maxW) { lines.push({ items: line }); line = []; lw = 0; }
      lw += add; line.push(it);
    }
    if (line.length) lines.push({ items: line });
  }
  const gapFactor = tpl.lineGap ?? (tpl.layout === 'stack' || tpl.lines ? (hasIndic ? 1.2 : 0.98) : (hasIndic ? 1.42 : 1.16));
  lines.forEach(l => {
    l.width = l.items.reduce((a, it, k) => a + it.width + (k ? space : 0), 0);
    l.h = Math.max(...l.items.map(it => it.px)) * gapFactor;
  });
  const blockW = Math.max(...lines.map(l => l.width));
  const blockH = lines.reduce((a, l) => a + l.h, 0);
  // Keep the whole block inside the frame, whatever the position setting.
  const margin = H * 0.04 + px * 0.2;
  cy = Math.min(Math.max(cy, margin + blockH / 2), H - margin - blockH / 2);
  // Keep the block inside the frame left-to-right too, whatever the horizontal position setting.
  const mx = W * 0.03;
  cx = Math.min(Math.max(cx, mx + blockW / 2), W - mx - blockW / 2);
  let y = cy - blockH / 2;
  const left = cx - blockW / 2;
  lines.forEach((l, li) => {
    const shift = tpl.stagger ? (li % 2 ? 1 : -1) * px * tpl.stagger : 0;
    let x = (tpl.align === 'left' ? left : tpl.align === 'right' ? left + blockW - l.width : cx - l.width / 2) + shift;
    l.y = y + l.h / 2;
    l.items.forEach(it => { it.x = x + it.width / 2; it.y = l.y; x += it.width + space; });
    y += l.h;
  });

  ctx.globalAlpha = alpha;
  ctx.translate(W / 2 + gx, cy + gy);
  ctx.scale(gScale, gScale);
  if (gRot) ctx.rotate(gRot);
  if (tpl.rotate) ctx.rotate(tpl.rotate * Math.PI / 180);
  ctx.translate(-W / 2, -cy);

  const reveal = tpl.reveal === 'none' ? null : tpl.reveal || (tpl.anim === 'type' ? 'type' : null);
  const shown = it => !reveal || it.i <= active;
  const vis = items.filter(shown);
  const bx0 = Math.min(...(vis.length ? vis : items).map(it => it.x - it.width / 2));
  const bx1 = Math.max(...(vis.length ? vis : items).map(it => it.x + it.width / 2));
  const by0 = cy - blockH / 2, by1 = cy + blockH / 2;

  // Plates and decorations behind the words.
  if (tpl.bg) {
    const pad = tpl.bg.pad * px;
    ctx.fillStyle = tpl.bg.c;
    lines.forEach(l => {
      const v = l.items.filter(shown);
      if (!v.length) return;
      const a = v[0].x - v[0].width / 2, b = v[v.length - 1].x + v[v.length - 1].width / 2;
      roundRect(ctx, a - pad, l.y - l.h / 2 - pad * 0.3 + l.h * 0.06, b - a + pad * 2, l.h + pad * 0.6 - l.h * 0.12, tpl.bg.r * px);
      ctx.fill();
    });
  }
  if (tpl.pill) {
    const p = tpl.pill, padX = px * (p.padX ?? 0.6), padY = px * (p.padY ?? 0.35);
    const x = bx0 - padX, w = bx1 - bx0 + padX * 2, yy = by0 - padY, h = by1 - by0 + padY * 2;
    ctx.save();
    if (p.shadow) { ctx.shadowColor = p.shadow; ctx.shadowBlur = px * 0.6; }
    ctx.fillStyle = p.c;
    roundRect(ctx, x, yy, w, h, h / 2 * (p.round ?? 1));
    ctx.fill();
    if (p.tail) {
      const tx = p.tail === 'left' ? x + h * 0.35 : x + w - h * 0.35;
      const dir = p.tail === 'left' ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(tx - dir * h * 0.25, yy + h * 0.7);
      ctx.quadraticCurveTo(tx + dir * h * 0.15, yy + h * 1.05, tx + dir * h * 0.45, yy + h * 1.08);
      ctx.quadraticCurveTo(tx + dir * h * 0.15, yy + h * 0.85, tx + dir * h * 0.15, yy + h * 0.6);
      ctx.fill();
    }
    ctx.restore();
  }
  if (tpl.fx === 'guides') {
    ctx.save();
    ctx.strokeStyle = 'rgba(120,255,90,.55)'; ctx.lineWidth = Math.max(1, px * 0.03);
    const a = bx0 - px * 0.3, b = bx1 + px * 0.3, c0 = by0 - px * 0.15, c1 = by1 + px * 0.15;
    [[a, 0, a, H], [b, 0, b, H], [0, c0, W, c0], [0, c1, W, c1]].forEach(([x1, y1, x2, y2]) => {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    });
    ctx.restore();
  }
  if (tpl.fx === 'slideHL' && vis.length) {
    const last = vis[vis.length - 1];
    const a = bx0 - px * 0.25, b = last.x + last.width / 2 + px * 0.25;
    const yy = by0 - px * 0.12, h = by1 - by0 + px * 0.24;
    ctx.save();
    ctx.fillStyle = 'rgba(214,190,140,.45)';
    ctx.fillRect(a, yy, b - a, h);
    ctx.strokeStyle = 'rgba(255,230,160,.9)'; ctx.lineWidth = Math.max(1, px * 0.04);
    ctx.beginPath(); ctx.moveTo(a, yy); ctx.lineTo(a, yy + h); ctx.moveTo(b, yy); ctx.lineTo(b, yy + h); ctx.stroke();
    ctx.fillStyle = '#F5C451';
    [[a, yy], [b, yy + h]].forEach(([x, yy2]) => { ctx.beginPath(); ctx.arc(x, yy2, px * 0.14, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }

  // Words.
  items.forEach(it => {
    if (!shown(it)) return;
    const s = it.s;
    ctx.save();
    const since = opts.settled ? 9 : t - it.w.start;
    if (reveal === 'type') ctx.globalAlpha = alpha * clamp(since / 0.08);
    if (reveal === 'blur' && 'filter' in ctx) {
      const p = clamp(since / 0.25);
      ctx.globalAlpha = alpha * p;
      ctx.filter = `blur(${((1 - p) * px * 0.35).toFixed(1)}px)`;
    }
    if (s.opacity != null) ctx.globalAlpha *= s.opacity;
    let sc = 1;
    if ((tpl.hi === 'scale' || s.pop) && it.state === 'active') sc = 1 + 0.14 * easeOutBack(clamp(since / 0.15));
    if (reveal === 'slam' && it.state === 'active') sc = 1 + 0.5 * (1 - easeOut(clamp(since / 0.18)));
    ctx.translate(it.x, it.y);
    if (s.rot) ctx.rotate(s.rot * Math.PI / 180);
    ctx.scale(sc, sc);
    ctx.font = styleFont(s, it.px);
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${(s.spacing || 0) * it.px}px`;
    drawStyled(ctx, it, s, it.px, t, tpl);

    if (tpl.hi === 'karaoke' && it.state === 'active' && !it.ransom) {
      const dur = Math.max(0.05, it.w.end - it.w.start);
      const p = clamp(since / dur);
      ctx.beginPath();
      ctx.rect(-it.width / 2 - it.px * 0.3, -it.px, (it.width + it.px * 0.6) * p, it.px * 2);
      ctx.clip();
      ctx.globalAlpha = alpha;
      drawStyled(ctx, it, { ...s, color: tpl.hiColor, gradient: null, opacity: 1 }, it.px, t, tpl);
    }
    ctx.restore();
  });
  // Auto emoji: a matching emoji pops above the word being said.
  if (tpl.emoji) {
    const it = items.find(x => x.state === 'active');
    const em = it && emojiFor(it.w.text);
    if (em) {
      const since = opts.settled ? 9 : t - it.w.start, e2 = easeOutBack(clamp(since / 0.25));
      ctx.save();
      ctx.globalAlpha = alpha * clamp(since / 0.1);
      ctx.font = `${Math.round(it.px * 1.15 * (0.6 + 0.4 * e2))}px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(em, it.x, it.y - it.px * 0.75);
      ctx.restore();
    }
  }
  ctx.restore();
}

// Words that get an emoji in "auto emoji" styles (English, Hinglish, Hindi).
const EMOJI = [
  [/^(money|paisa|paise|paisaa|rupee|rupees|rs|cash|salary|lakh|lakhs|crore|crores|पैसा|पैसे|लाख|करोड़)$/, '💰'],
  [/^(love|pyaar|pyar|dil|heart|प्यार|दिल)$/, '❤️'], [/^(fire|hot|lit|aag|आग)$/, '🔥'],
  [/^(happy|khush|smile|haso|खुश)$/, '😄'], [/^(sad|dukh|cry|rona|दुख)$/, '😢'],
  [/^(time|samay|waqt|time's|समय|वक्त)$/, '⏰'], [/^(idea|soch|tip|tips|trick|hack)$/, '💡'],
  [/^(win|winner|success|jeet|kamyab|जीत)$/, '🏆'], [/^(think|socho|sochna|सोचो)$/, '🤔'],
  [/^(food|khana|eat|khao|खाना)$/, '🍽️'], [/^(gym|workout|fit|strong|power)$/, '💪'],
  [/^(phone|mobile|call)$/, '📱'], [/^(car|gaadi|गाड़ी)$/, '🚗'], [/^(home|ghar|घर)$/, '🏠'],
  [/^(wow|amazing|crazy|insane|kamaal|कमाल)$/, '🤯'], [/^(stop|ruko|mat|no|nahi|नहीं)$/, '🛑'],
  [/^(secret|raaz|राज़|राज)$/, '🤫'], [/^(learn|seekho|sikho|study|padhai)$/, '📚'],
  [/^(world|duniya|दुनिया)$/, '🌍'], [/^(music|song|gaana|गाना)$/, '🎵'], [/^(laugh|funny|lol|haha)$/, '😂'],
];
export function emojiFor(word) {
  const w = String(word).toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  for (const [re, e] of EMOJI) if (re.test(w)) return e;
  return null;
}

// Evenly spread words across a time range — used for previews, manual edits and segment-level transcripts.
export function spreadWords(text, start, end) {
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const step = (end - start) / parts.length;
  return parts.map((p, i) => ({ text: p, start: start + i * step, end: start + (i + 1) * step }));
}
