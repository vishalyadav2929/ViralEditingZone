// Beat detection for music: estimate tempo and beat times from an onset-strength envelope, so edits
// can be synced to the beat (and shown on the timeline grouped into 4 / 8 / 16 counts). Pure functions
// (tested in Node); the heavy audio decode + envelope live in app.js and feed `detectBeats` an array.

/** Onset-strength envelope from mono samples: RMS per hop, then the positive change (a simple flux). */
export function onsetEnvelope(samples, sampleRate, hop = 512) {
  const n = Math.floor(samples.length / hop);
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < hop; k++) { const v = samples[i * hop + k] || 0; s += v * v; }
    rms[i] = Math.sqrt(s / hop);
  }
  const env = new Float32Array(n);
  for (let i = 1; i < n; i++) env[i] = Math.max(0, rms[i] - rms[i - 1]);
  return { env, step: hop / sampleRate };
}

/**
 * Beat times (seconds) from an onset envelope sampled every `step` seconds.
 * Estimates one steady tempo in [minBpm, maxBpm] by autocorrelation, locks the phase to the loudest
 * alignment, then lays beats across the whole track. Good enough for music with a steady beat.
 */
export function detectBeats(env, step, { minBpm = 70, maxBpm = 180 } = {}) {
  if (!env || env.length < 8 || !(step > 0)) return { beats: [], bpm: 0 };
  const minLag = Math.max(1, Math.round(60 / maxBpm / step));
  const maxLag = Math.min(env.length - 1, Math.round(60 / minBpm / step));
  let bestLag = 0, best = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < env.length; i++) sum += env[i] * env[i - lag];
    if (sum > best) { best = sum; bestLag = lag; }
  }
  if (!bestLag) return { beats: [], bpm: 0 };
  // Phase: the offset (0..bestLag) whose beat grid catches the most onset energy.
  let bestPhase = 0, bestScore = -1;
  for (let p = 0; p < bestLag; p++) {
    let sc = 0;
    for (let i = p; i < env.length; i += bestLag) sc += env[i];
    if (sc > bestScore) { bestScore = sc; bestPhase = p; }
  }
  const beats = [];
  for (let i = bestPhase; i < env.length; i += bestLag) beats.push(+(i * step).toFixed(3));
  return { beats, bpm: Math.round(60 / (bestLag * step)) };
}

/** Tag each beat with whether it starts a group of `n` (4 / 8 / 16 count) — those get a stronger mark. */
export function groupBeats(beats, n = 4) {
  const g = Math.max(1, n | 0);
  return (beats || []).map((t, i) => ({ t, strong: i % g === 0 }));
}

/** Nearest beat time to `t` (for snapping a cut or clip to the beat), or null. */
export function nearestBeat(beats, t) {
  if (!beats || !beats.length) return null;
  let best = beats[0];
  for (const b of beats) if (Math.abs(b - t) < Math.abs(best - t)) best = b;
  return best;
}
