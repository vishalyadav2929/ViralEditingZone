// In-browser speech-to-text with OpenAI Whisper (MIT) via transformers.js (Apache-2.0).
// Nothing is uploaded: the model is downloaded once from the Hugging Face hub, cached by the
// browser, and run on this device (WebGPU when available, otherwise WebAssembly).
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
import { transcribeLong, preprocess, cleanWords, snapToSpeech } from './asr-core.js';

env.allowLocalModels = false;
env.useBrowserCache = true;

// For each quality level: a build exported for word-level timestamps first, then the standard build.
const MODELS = {
  fast: ['onnx-community/whisper-tiny_timestamped', 'Xenova/whisper-tiny'],
  balanced: ['onnx-community/whisper-base_timestamped', 'Xenova/whisper-base'],
  best: ['onnx-community/whisper-small_timestamped', 'Xenova/whisper-small'],
};

let asr = null, loadedKey = null, loadedDevice = null, loadedName = null, wordLevelBroken = false, forceCpu = false, wordError = null;
// Model builds whose word-by-word timing failed on this device: skip them so another build can try.
const noWordTiming = new Set();
const post = msg => self.postMessage(msg);

// One load at a time: a preload and a real run share the same promise.
let pending = null;
function load(quality) {
  if (pending && pending.key === quality && pending.cpu === forceCpu) return pending.p;
  const p = loadNow(quality);
  pending = { key: quality, cpu: forceCpu, p };
  p.catch(() => { if (pending && pending.p === p) pending = null; });
  return p;
}
async function loadNow(quality) {
  if (asr && loadedKey === quality && !(forceCpu && loadedDevice === 'webgpu')) return asr;
  const files = {};
  const progress_callback = p => {
    if (p.status === 'progress' && p.total) {
      files[p.file] = [p.loaded, p.total];
      const v = Object.values(files);
      const loaded = v.reduce((a, [l]) => a + l, 0), total = v.reduce((a, [, t]) => a + t, 0);
      post({ type: 'download', loaded, total });
    }
  };
  // Phones: compressed 8-bit model on the CPU (≈ a quarter of the download, much less memory).
  // Computers with WebGPU: full-precision encoder + 4-bit decoder (smaller than full fp32), then fp32.
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
  const plans = [];
  if (!forceCpu && !mobile && 'gpu' in navigator) {
    plans.push({ device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } });
    plans.push({ device: 'webgpu', dtype: 'fp32' });
  }
  plans.push({ device: 'wasm', dtype: 'q8' });
  let lastErr;
  const all = MODELS[quality] || MODELS.balanced;
  const names = all.filter(n => !noWordTiming.has(n));
  for (const name of names.length ? names : all) {
    for (const plan of plans) {
      try {
        post({ type: 'status', text: `Loading speech model (${plan.device === 'webgpu' ? 'GPU' : 'CPU'})…` });
        asr = await pipeline('automatic-speech-recognition', name, { ...plan, progress_callback });
        const device = plan.device;
        loadedKey = quality; loadedDevice = device; loadedName = name; wordLevelBroken = names.length === 0;
        post({ type: 'model', name, device });
        return asr;
      } catch (err) { lastErr = err; }
    }
  }
  throw lastErr || new Error('Could not load a speech model.');
}

async function transcribe({ audio, quality, language, task, debugFailWord }) {
  {
    await load(quality);
    const base = { task: task || 'transcribe' };
    if (language) base.language = language;
    const runWindow = async sub => {
      // Heartbeat while a window is being transcribed: a single window can take minutes on a
      // slow phone, and the app kills a worker that stays silent too long — which used to cut
      // captions off partway through long videos. (If the inference thread is fully busy the
      // pings simply arrive late; the app's silence limit has room for that too.)
      const ping = setInterval(() => { try { post({ type: 'ping' }); } catch { /* worker closing */ } }, 15000);
      try {
      while (!wordLevelBroken) {
        try {
          if (debugFailWord && debugFailWord.includes(loadedName)) throw new Error('test: no word timing'); // tests only
          const out = await asr(sub, { ...base, return_timestamps: 'word' });
          return { chunks: out.chunks, level: 'word' };
        } catch (err) {
          // This build can't give word times here. Try the other build of the same model before
          // settling for sentence times (which makes captions drift).
          wordError = String((err && err.message) || err).slice(0, 160);
          console.warn('word timing failed with', loadedName, err);
          const others = (MODELS[quality] || MODELS.balanced).filter(n => n !== loadedName && !noWordTiming.has(n));
          noWordTiming.add(loadedName);
          post({ type: 'noWordTiming', name: loadedName });
          if (!others.length) { wordLevelBroken = true; break; }
          // Load the other build in a fresh worker: WebAssembly memory never shrinks, and loading a
          // second model here can run a phone out of memory (the worker then dies without a word).
          throw Object.assign(new Error('switch-build'), { switchBuild: true });
        }
      }
      const out = await asr(sub, { ...base, return_timestamps: true });
      return { chunks: out.chunks, level: 'segment' };
      } finally { clearInterval(ping); }
    };
    post({ type: 'status', text: 'Cleaning up background noise…' });
    const clean = preprocess(audio);
    post({ type: 'status', text: 'Listening to your video…' });
    const res = await transcribeLong(runWindow, clean, {
      firstMax: 12, // first captions show sooner on long videos
      onProgress: (done, total) => post({ type: 'transcribe', done, total }),
      // Show each part's captions as soon as it's done.
      onWords: (words, i, total) => { if (total > 1) post({ type: 'partial', words: snapToSpeech(cleanWords(words), clean) }); },
    });
    res.words = snapToSpeech(cleanWords(res.words), clean);
    if (res.level === 'segment' && wordError) res.wordError = wordError;
    post({ type: 'done', ...res });
  }
}

self.onmessage = async ({ data }) => {
  // Start downloading/loading the model while the user is still choosing languages.
  for (const n of data.noWordTiming || []) noWordTiming.add(n); // remembered from earlier visits
  if (data.cpuOnly) forceCpu = true; // this computer's graphics chip stalled before
  if (data.type === 'preload') { load(data.quality).catch(() => {}); return; }
  if (data.type !== 'transcribe') return;
  try {
    await transcribe(data);
  } catch (err) {
    // A GPU can load the model but still fail mid-run (out of memory, driver issues). Retry once on the CPU.
    if (loadedDevice === 'webgpu' && !forceCpu) {
      forceCpu = true;
      post({ type: 'status', text: 'GPU failed, retrying on CPU (slower)…' });
      try { await transcribe(data); return; } catch (e2) { err = e2; }
    }
    post({ type: 'error', text: String((err && err.message) || err), switchBuild: !!(err && err.switchBuild) });
  }
};
