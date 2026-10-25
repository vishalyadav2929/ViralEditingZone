// Cuts: parts of the video taken out (silences, mistakes). The video file never changes; preview skips
// the cut parts and the export joins what is kept. Pure functions (tested in Node).

/** Cuts sorted, clamped to [0, dur], overlapping or touching ones merged, tiny ones dropped. */
export function mergeCuts(cuts, dur = Infinity) {
  const list = (cuts || []).map(c => ({ start: Math.max(0, +c.start), end: Math.min(dur, +c.end) })).filter(c => c.end - c.start >= 0.05).sort((a, b) => a.start - b.start);
  const out = [];
  for (const c of list) {
    const last = out[out.length - 1];
    if (last && c.start <= last.end + 0.02) last.end = Math.max(last.end, c.end);
    else out.push({ ...c });
  }
  return out.map(c => ({ start: +c.start.toFixed(3), end: +c.end.toFixed(3) }));
}

/** The parts kept between `start` and `end` once the cuts are taken out. */
export function keepRanges(cuts, start, end) {
  const out = [];
  let t = start;
  for (const c of mergeCuts(cuts)) {
    if (c.end <= start || c.start >= end) continue;
    if (c.start > t) out.push({ start: t, end: c.start });
    t = Math.max(t, c.end);
  }
  if (end > t + 0.01) out.push({ start: t, end });
  return out;
}

/** The cut containing time t, or null. */
export const cutAt = (cuts, t) => (cuts || []).find(c => t >= c.start && t < c.end) || null;

/** Length of the edit (what is kept) between start and end. */
export const keptLength = (cuts, start, end) => keepRanges(cuts, start, end).reduce((s, r) => s + r.end - r.start, 0);

/**
 * Silences long enough to cut, from loudness peaks (0..1, one every `step` seconds).
 * `pad` seconds of each silence are kept on both sides so speech doesn't sound clipped.
 */
export function findSilences(peaks, step, { thresh = 0.06, minGap = 0.6, pad = 0.15 } = {}) {
  const out = [];
  if (!peaks || !peaks.length) return out;
  // Adapt to the recording: quiet is relative to how loud speech usually is.
  const sorted = Array.from(peaks).sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.9)] || 1;
  const th = Math.max(thresh, loud * 0.12);
  let s = -1;
  for (let i = 0; i <= peaks.length; i++) {
    const quiet = i < peaks.length && peaks[i] < th;
    if (quiet && s < 0) s = i;
    if (!quiet && s >= 0) {
      const a = s * step, b = i * step;
      if (b - a >= minGap + 2 * pad) out.push({ start: +(a + pad).toFixed(3), end: +(b - pad).toFixed(3) });
      s = -1;
    }
  }
  return out;
}

/** Long pauses between spoken words (from caption timing), as cuts. */
export function wordGaps(segments, { minGap = 0.6, pad = 0.15 } = {}) {
  const words = (segments || []).flatMap(s => s.words || []).sort((a, b) => a.start - b.start);
  const out = [];
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1].end, b = words[i].start;
    if (b - a >= minGap + 2 * pad) out.push({ start: +(a + pad).toFixed(3), end: +(b - pad).toFixed(3) });
  }
  return out;
}
