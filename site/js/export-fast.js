// Fast export: decode → draw (captions, text, crop, colour) → encode, as fast as the device can go,
// instead of playing the video in real time. Built on Mediabunny (MPL-2.0, vendored unmodified at
// js/vendor/mediabunny.js, licence in js/vendor/mediabunny-LICENSE.txt), which reads MP4/MOV/WebM/MKV,
// decodes and encodes with the browser's WebCodecs, and trims the audio without re-encoding it.
// Returns null when this browser/file can't take this path; the caller then uses the real-time path.

let lib = null;
const load = () => lib || (lib = import('./vendor/mediabunny.js'));

/**
 * @param {object} o
 *   file        the original File
 *   width/height output size
 *   start/end   part of the video to export (seconds)
 *   draw(src, t, srcW, srcH)  draws one frame (src: CanvasImageSource of the decoded frame) at media time t onto `canvas`
 *   canvas      the export canvas (width × height)
 *   bitrate     video bits/s
 *   job         { cancelled, cancel? }   job.cancel is set so the caller can stop it
 *   onProgress(p, t)
 * @returns {Promise<Blob|'cancelled'|null>}
 */
/** The video's codec and whether it is HDR (iPhones record HEVC + HDR by default), or null. */
export async function videoInfo(file) {
  try {
    const M = await load();
    const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
    try {
      const vt = await input.getPrimaryVideoTrack();
      if (!vt) return null;
      return { codec: await vt.getCodec(), hdr: await vt.hasHighDynamicRange() };
    } finally { try { input.dispose && input.dispose(); } catch { /* closed */ } }
  } catch { return null; }
}

/** A standard frame rate (24, 25, 30, 50, 60) for a measured average one. */
export function standardFps(r) {
  if (r > 25.5 && r < 31) return 30; // a 30 fps phone video with some slow stretches stays 30
  if (r > 50.5 && r < 61) return 60;
  return [24, 25, 30, 50, 60].reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a), 30);
}

export async function exportFast({ file, width, height, start = 0, end, draw, canvas, bitrate, job, onProgress }) {
  if (typeof VideoEncoder !== 'function' || typeof VideoDecoder !== 'function') return null;
  const M = await load();
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt || !(await vt.canDecode())) return null;
    const dur = await input.computeDuration();
    end = Math.min(end ?? dur, dur);
    // H.264 for phones and Instagram; VP9 only when a test asks for it (test browsers have no H.264 encoder).
    const want = ['avc', ...(self.__vczFastCodecs || [])];
    let codec = null;
    for (const c of want) if (await M.canEncodeVideo(c, { width, height, bitrate })) { codec = c; break; }
    if (!codec) return null;

    // Sound: copied when it can be (AAC source), otherwise AAC, or Opus where the browser has no AAC encoder.
    const acodec = (await M.canEncodeAudio('aac')) ? 'aac' : (await M.canEncodeAudio('opus')) ? 'opus' : null;
    const hasAudio = !!(await input.getPrimaryAudioTrack());
    if (hasAudio && !acodec) return null;
    // Phones record at a variable frame rate; players and Instagram stutter on uneven frames. Export at a
    // constant rate (the source's own, rounded to a standard one) with a keyframe every second.
    let fps = 30;
    try { const st = await vt.computePacketStats(120); if (st && st.averagePacketRate > 0) fps = standardFps(st.averagePacketRate); } catch { /* keep 30 */ }
    const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
    let firstTs = null;
    const conversion = await M.Conversion.init({
      input, output,
      trim: { start, end },
      video: {
        codec, bitrate, forceTranscode: true, processedWidth: width, processedHeight: height, frameRate: fps, keyFrameInterval: 1,
        process: sample => {
          // Timestamps may be relative to the trim start: work out the media time either way.
          if (firstTs == null) firstTs = sample.timestamp;
          const rel = start > 0.25 && firstTs < start - 0.2;
          const t = rel ? start + sample.timestamp : sample.timestamp;
          const src = sample.toCanvasImageSource();
          draw(src, t, sample.displayWidth, sample.displayHeight);
          return canvas;
        },
      },
      audio: acodec ? { codec: acodec, bitrate: 192000 } : { discard: true },
    });
    // Never hand back a silent video: if the sound couldn't be kept, use the other export path.
    if (!conversion.isValid || (hasAudio && conversion.discardedTracks.some(d => d.track.type === 'audio'))) return null;
    job.cancel = () => conversion.cancel();
    conversion.onProgress = p => onProgress && onProgress(p, p * (end - start));
    try { await conversion.execute(); } catch (err) {
      if (job.cancelled) return 'cancelled';
      throw err;
    }
    if (job.cancelled) return 'cancelled';
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  } finally {
    try { input.dispose && input.dispose(); } catch { /* already closed */ }
  }
}

/**
 * Export only the kept parts of the video, joined (cuts taken out): frames are drawn at a constant
 * rate and the sound is trimmed to the same parts, with a 30 ms fade at every join so cuts don't click.
 * keep: [{ start, end }] in source seconds. draw(src, t, w, h) as in exportFast.
 */
export async function exportKeep({ file, width, height, keep, draw, canvas, bitrate, job, onProgress }) {
  if (typeof VideoEncoder !== 'function' || typeof VideoDecoder !== 'function' || typeof AudioBuffer !== 'function') return null;
  const M = await load();
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt || !(await vt.canDecode())) return null;
    const want = ['avc', ...(self.__vczFastCodecs || [])];
    let codec = null;
    for (const c of want) if (await M.canEncodeVideo(c, { width, height, bitrate })) { codec = c; break; }
    if (!codec) return null;
    const at = await input.getPrimaryAudioTrack();
    const acodec = (await M.canEncodeAudio('aac')) ? 'aac' : (await M.canEncodeAudio('opus')) ? 'opus' : null;
    if (at && (!acodec || !(await at.canDecode()))) return null;
    let fps = 30;
    try { const st = await vt.computePacketStats(120); if (st && st.averagePacketRate > 0) fps = standardFps(st.averagePacketRate); } catch { /* keep 30 */ }

    const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
    const vsrc = new M.CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 1 });
    output.addVideoTrack(vsrc, { frameRate: fps });
    const asrc = at ? new M.AudioBufferSource({ codec: acodec, bitrate: 192000 }) : null;
    if (asrc) output.addAudioTrack(asrc);
    await output.start();
    job.cancel = () => { job.cancelled = true; };

    const vsink = new M.VideoSampleSink(vt), asink = at ? new M.AudioBufferSink(at) : null;
    const total = keep.reduce((s, r) => s + r.end - r.start, 0);
    let out = 0;
    for (const r of keep) {
      // Video: one frame every 1/fps of the kept part.
      const n = Math.max(1, Math.round((r.end - r.start) * fps));
      const times = Array.from({ length: n }, (_, k) => r.start + k / fps);
      let k = 0;
      for await (const sample of vsink.samplesAtTimestamps(times)) {
        if (job.cancelled) { sample && sample.close(); return 'cancelled'; }
        if (sample) { draw(sample.toCanvasImageSource(), times[k], sample.displayWidth, sample.displayHeight); sample.close(); }
        await vsrc.add(out + k / fps, 1 / fps);
        k++;
        if (k % 15 === 0 && onProgress) onProgress((out + k / fps) / total, out + k / fps);
      }
      // Sound: the same part, cut exactly at its edges, faded in and out over 30 ms.
      if (asink) {
        const parts = [];
        for await (const b of asink.buffers(r.start, r.end)) parts.push(b);
        const buf = joinAudio(parts, r.start, r.end);
        if (buf) await asrc.add(buf);
      }
      out += n / fps;
    }
    if (job.cancelled) return 'cancelled';
    await output.finalize();
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  } finally {
    try { input.dispose && input.dispose(); } catch { /* already closed */ }
  }
}

/**
 * Captions only (no source video): every frame is drawn and encoded offline at a steady frame rate,
 * not recorded in real time — so no dropped or doubled frames, and no dependence on the tab staying
 * in front. alpha=true → VP9 (or VP8) WebM with a real transparent background (alpha is encoded as its
 * own stream, the layout Premiere, DaVinci Resolve, After Effects and Chrome read); otherwise H.264 MP4
 * for green screen. draw(t) paints the frame for time t (seconds from the start) onto `canvas`.
 * @returns {Promise<Blob|'cancelled'|null>}  null when this browser can't encode it (caller falls back)
 */
export async function exportOverlay({ width, height, dur, fps = 30, draw, canvas, bitrate, job, onProgress, alpha = false }) {
  if (typeof VideoEncoder !== 'function') return null;
  const M = await load();
  const want = alpha ? ['vp9', 'vp8'] : ['avc', ...(self.__vczFastCodecs || [])];
  let codec = null;
  for (const c of want) if (await M.canEncodeVideo(c, { width, height, bitrate })) { codec = c; break; }
  if (!codec) return null;
  const output = new M.Output({
    format: alpha ? new M.WebMOutputFormat() : new M.Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new M.BufferTarget(),
  });
  const vsrc = new M.CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 1, ...(alpha ? { alpha: 'keep' } : {}) });
  output.addVideoTrack(vsrc, { frameRate: fps });
  await output.start();
  job.cancel = () => { job.cancelled = true; };
  const n = Math.max(1, Math.round(dur * fps));
  for (let k = 0; k < n; k++) {
    if (job.cancelled) { try { await output.cancel(); } catch { /* already stopped */ } return 'cancelled'; }
    const t = k / fps;
    draw(t);
    await vsrc.add(t, 1 / fps);
    if (k % 15 === 0 && onProgress) onProgress(k / n, t);
  }
  await output.finalize();
  if (job.cancelled) return 'cancelled';
  return new Blob([output.target.buffer], { type: alpha ? 'video/webm' : 'video/mp4' });
}

/** Audio chunks ({ buffer, timestamp }) → one AudioBuffer covering exactly start..end, with short fades. */
function joinAudio(parts, start, end) {
  if (!parts.length) return null;
  const sr = parts[0].buffer.sampleRate, ch = parts[0].buffer.numberOfChannels;
  const len = Math.max(1, Math.round((end - start) * sr));
  const out = new AudioBuffer({ length: len, numberOfChannels: ch, sampleRate: sr });
  for (let c = 0; c < ch; c++) {
    const dst = out.getChannelData(c);
    for (const p of parts) {
      const src = p.buffer.getChannelData(Math.min(c, p.buffer.numberOfChannels - 1));
      const off = Math.round((p.timestamp - start) * sr);
      for (let i = Math.max(0, -off); i < src.length && off + i < len; i++) dst[off + i] = src[i];
    }
    const f = Math.min(Math.round(sr * 0.03), len >> 1);
    for (let i = 0; i < f; i++) { dst[i] *= i / f; dst[len - 1 - i] *= i / f; }
  }
  return out;
}
