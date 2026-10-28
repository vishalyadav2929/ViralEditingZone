# BrandBaazi

A free, browser-based caption editor for Reels, Shorts and Pins. Upload a video, generate captions from its audio, fix the text and timing, pick one of 90 animated caption styles, and download the video with the captions burned in.

There's no account or payment. Everything runs in the visitor's browser, except the optional **Fast mode** (below), which the site owner can switch on for instant, more accurate captions.

## What works

| Step | How |
|---|---|
| Upload | Drag-and-drop or click. Shows a preview with name, resolution, duration and size. Rejects non-media files and files over 2 GB with a message. Unplayable formats (e.g. HEVC `.mov` in Chrome) get a conversion hint. |
| Speech to text | OpenAI **Whisper** running **on the device** through **transformers.js** (WebGPU, falling back to WebAssembly). Supports Hindi, English and ~30 more languages, auto-detect, Hinglish (Roman Hindi) output, and translation to English. Long audio is cut at pauses into ≤29 s parts, which gives real progress, a working **Cancel**, and skips silent parts. |
| Timing | Uses Whisper's word-level timestamps. If a model build only gives sentence timing, captions are marked **est.** in the editor and word highlights are spread across each sentence. |
| Caption editing | Edit text, set start/end times, split at the cursor, merge, add, delete, jump to a caption, **undo/redo** (Ctrl+Z / Ctrl+Shift+Z). SRT/VTT import and SRT export. |
| Templates | 90 styles: 58 matching the reference set (Classic, Crazy, Discipline, Red Wipe … Estate 4), 26 more, High Contrast, and 5 trending looks (Green Box, Emoji Pop with auto emoji, Gradient Pop, Beast Bold, One Line Sub) under a 🔥 Trending filter. Any single word can get its own colour; captions can be forced onto one line. Selecting one updates the live video preview. Previews work in English and 10 Indian scripts. |
| Style | Size, weight, case, text colour, spoken-word colour, outline colour and thickness, shadow, background colour and opacity, alignment, vertical position, max line width, line spacing. **Reset to template** is included. |
| Preview | Canvas preview with play/pause, seek, time, full screen, portrait and landscape. Preview and export use the same renderer, and captions are kept inside the frame. |
| Export | Captions are drawn into the video pixels, original audio is kept, there's a progress bar and Cancel, and the file is downloaded directly. **MP4 (H.264)** when the browser can record it, otherwise **WebM** (VP9/Opus) with a corrected duration header. |
| Translation | Hindi ↔ Hinglish on the device. Other languages (Hindi → Bangla, English → Hindi, …) use Chrome's on-device translator when present, otherwise the free MyMemory service (caption text only, no key, about 5,000 characters per day per visitor). The caption language is detected from the text's script. |
| Live mode | Camera + browser speech recognition, with captions drawn live and recordable. |

## Studio (app.html)

| Area | What works |
|---|---|
| Home | Create project (drop video/photo), quick starts, **Projects** saved on this device (IndexedDB: media stored once, edit autosaved), reopen, delete. Tools not built yet are marked **Soon** and do nothing. |
| Editor layout | Left tools (Media, Clips, Captions, Text, Audio, Styles, Filters, Adjust), preview in the middle, right details (Caption style, Text, Details), timeline across the bottom. Preview left/middle/right and panel sizes are saved. |
| Timeline | Word, caption, text and sound rows, waveform, playhead, zoom, click to seek, double-click to edit a word, **Split** (caption at playhead), **Delete** (selected word/caption/text/sound), drag/resize text blocks. |
| Text | Hand-typed text shown whole (not word by word): 27 fonts, size, bold/italic, alignment, colour, outline, box, shadow, drag on the video, timing. |
| Photos | Open JPG/PNG, add text, download at full size. |
| **Long video → Shorts** | Clips tab: from the captions, finds whole-sentence moments with a strong first line, lively speech, hook words and no dead air (`js/clips.js`, explainable "Why" for each). Pick length and count; each clip has editable hook text plus alternative hooks taken from what is said; preview, edit start/end, 9:16 / 1:1 / 16:9, frame position, hook on/off; export only that part. Scores are estimates, never a promise of views. |
| AI hooks (optional) | With `GROQ_API_KEY` set, `netlify/functions/clips.mjs` re-ranks the clips and writes hooks with Llama 3.3 70B (caption text only). Without it, the on-device rules are used. |
| Export | 1) **Fast** (Mediabunny): decode → draw captions/text/crop/colour → encode H.264 + AAC, no real-time playback, trims audio. Used when the browser can encode H.264 and there are no sound effects in range. 2) **WebCodecs real time** (H.264, AAC copied or encoded). 3) **MediaRecorder** fallback. Cancel works in all three. |

## Third-party code

| Package | Licence | Where | Why |
|---|---|---|---|
| [Mediabunny](https://github.com/Vanilagy/mediabunny) 1.61.1 | MPL-2.0 | `site/js/vendor/mediabunny.js` (unmodified minified bundle; licence in `mediabunny-LICENSE.txt`) | Fast export: demux MP4/MOV/WebM, WebCodecs decode/encode, trimming, MP4 mux. Loaded only when exporting. MPL-2.0 is file-level: our own files stay ours; changes to that file would have to be shared. |
| mp4-muxer 5.2.2 | MIT | `site/js/vendor/mp4-muxer.js` | Real-time WebCodecs export path. |
| fix-webm-duration | MIT | `site/js/vendor/fix-webm-duration.js` | Duration header for MediaRecorder WebM files. |
| @huggingface/transformers 3.8.1 | Apache-2.0 | jsDelivr, on demand | On-device Whisper. |

Reviewed and **not** merged: OpenReel (MIT; a React/TypeScript/WASM monorepo, so merging means a rewrite of this no-build site; used as a design reference), OpenShorts (MIT core, but its `cloud/` directory is under a separate commercial licence; its pipeline idea of a shortlist followed by an LLM pass is reimplemented here from scratch), ffmpeg.wasm (MIT wrapper; ~30 MB download and slower than WebCodecs; kept as a possible future fallback), faster-whisper (MIT; Python, needs a server/GPU worker, which Netlify Functions can't host).

## Technology choices

- **Static HTML/CSS/vanilla JS, no build step.** It loads quickly and needs nothing on Netlify.
- **Speech:** `@huggingface/transformers@3.8.1` (Apache-2.0) loaded from jsDelivr **only when captions are generated**, plus Whisper ONNX models (MIT) from the Hugging Face hub, cached by the browser after the first download. Model choice by quality:
  - Fast: `whisper-tiny`, ~40 MB
  - Balanced: `whisper-base`, ~80 MB (default)
  - Best for Hindi: `whisper-small`, ~250 MB

  Each tries the `onnx-community/*_timestamped` build (exported for word timestamps) first, then `Xenova/*`. The browser's Web Speech API is used only for Live mode, never for uploaded videos.
- **Export:** WebCodecs first (Safari 16.4+, Chrome, Edge): every frame is encoded with the browser's H.264 encoder at ≥ 1.5× the source bitrate and the original AAC audio is copied into the MP4 unchanged, muxed with [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT, vendored). If the device misses frames, playback slows down so none are lost. Fallback: Canvas + `MediaRecorder` + Web Audio (real time). WebM duration is patched with [fix-webm-duration](https://github.com/yusitnikov/fix-webm-duration) (MIT, vendored in `site/js/vendor/`).
- **Fonts:** Google Fonts (open licences), with Noto fallbacks for Devanagari, Bengali, Gujarati, Gurmukhi, Tamil, Telugu, Kannada, Malayalam, Odia and Arabic.

## Formats

- **Input:** anything the browser can play, typically MP4 (H.264/AAC), WebM, MOV (H.264), MKV, plus audio-only M4A/MP3/WAV/OGG (which produces a captioned video on a plain background). Max 2 GB.
- **Output:** MP4 (H.264) in Chrome 126+, Edge and Safari; WebM in Firefox and in browsers without an H.264 encoder. Captions: SRT.

## Browser support and limits

- Fast export needs WebCodecs with an H.264 encoder (Chrome/Edge 94+, Safari 16.4+). Elsewhere the real-time paths are used.
- Shorts reframing is a manual frame-position slider; automatic face/speaker tracking is not built yet.
- Clip finding needs captions first; a 30–60 minute video takes a long time to transcribe on-device (Fast mode is far quicker).
- YouTube links are not supported: downloading YouTube videos breaks YouTube's terms. Upload your own file.

- Desktop Chrome or Edge is the best experience (WebGPU makes transcription fast). Firefox and Safari work using the slower WebAssembly path.
- Phones work, but `whisper-small` can run out of memory. Use Fast or Balanced there.
- Export is real time and the tab must stay visible. Background tabs are throttled, and the export screen warns if that happened.
- Very long videos (10+ minutes) use a lot of memory, because the whole audio track is decoded at once.
- Live captions need Chrome, Edge or Safari, and their timing is approximate.

## Live demo on the home page

The "See it in action" section shows one clip twice (original, and with captions that restyle when a visitor taps a style). Add a short clip of your own to `site/examples/` with its captions and set `"demo"` in `manifest.json`:

```json
{ "demo": { "video": "demo.mp4", "captions": "demo.srt" }, "items": [] }
```

Until then it shows a soft animated backdrop with a sample line. Tip: make the SRT in the editor (Download SRT), then upload both files.

## Example videos on the home page

The "Made with our captions" section stays hidden until `site/examples/manifest.json` lists clips. Put your own videos (or free stock clips you have the right to use, e.g. from Pexels) in `site/examples/` with their captions as `.srt`, then list them:

```json
{ "items": [ { "video": "clip1.mp4", "captions": "clip1.srt", "templates": ["classic", "crazy", "discipline"] } ] }
```

One clip can appear in several templates; the captions are drawn live on top, exactly as the editor would. Keep clips short (5–10 s, under ~3 MB) so the page stays fast.

## Run locally

```sh
npm start              # serves ./site on http://localhost:8080
npm test               # unit tests (Node 20+)
npm run test:e2e       # browser test: needs Playwright + Chromium and ffmpeg
npm run test:asr       # real Whisper on a speech clip: accuracy, timing, progressive captions
```

## Deploy to Netlify (free)

1. Push this repo to GitHub.
2. In Netlify: **Add new project → Import an existing project → GitHub** → choose this repository.
3. Netlify reads `netlify.toml`: publish directory **`site`**, no real build. Leave the defaults and click **Deploy**.
4. The site is live at `https://<name>.netlify.app`. Every push to the production branch redeploys.
5. Make it public: **Project configuration → Access & security → Visitor access**. Turn off password or team login if it's on.

**Custom domain (later):** **Domain management → Add a domain**, enter it, then either point your registrar's nameservers to Netlify DNS or add the CNAME/A records Netlify shows. HTTPS is issued automatically.

No environment variables or API keys are needed for the site to work. `GROQ_API_KEY` (optional) switches on Fast mode captions **and** AI hooks for Shorts. `GROQ_API_KEY` or `ANTHROPIC_API_KEY` (optional) switches on AI edit.

### Optional: Fast mode (instant, more accurate captions)

On-device captions take ~20–40 s on a phone and small models struggle with Hindi. Fast mode sends the **audio only** (never the video), in ≤ 30 s clips, to Groq's Whisper large-v3 through the site's own Netlify Function (`netlify/functions/transcribe.mjs`), so the key is never in the browser. Captions come back in a second or two.

1. Create a free account at **console.groq.com** → **API Keys** → **Create API key**.
2. Netlify → your project → **Project configuration → Environment variables → Add a variable**: key `GROQ_API_KEY`, value = the key. Scope: Functions.
3. **Deploys → Trigger deploy**.

Visitors then see "⚡ Fast mode" ticked under *More options* (they can untick it to stay fully on-device). If the free quota runs out or the server is unreachable, the site falls back to on-device captions automatically. The function only answers requests from the site's own pages. Remove the variable to switch it off again.

### Optional: AI edit

With a key set, a **🤖 AI edit** button appears on the timeline. `netlify/functions/ai-edit.mjs` sends the timed caption text (never audio or video) to an AI, which plans the edit: bad takes, repeats and rambling to cut, a hook, key words to colour, up to 5 Shorts, and a YouTube title and description. The editor applies the plan with its own tools, so everything stays editable and one Ctrl+Z undoes it. Without a key the button stays hidden.

Two engines — whichever key you set (Claude is used when both are present):

- **Free: `GROQ_API_KEY`** — the same free-tier key as Fast mode (console.groq.com). Nothing extra to pay; good edits.
- **Best: `ANTHROPIC_API_KEY`** — Claude (console.anthropic.com → API Keys → Create key). Pay-per-use, so under **Billing → Limits** set a monthly spend limit — that is the real protection on a public site.

Then: Netlify → **Project configuration → Environment variables** → add the key, scope Functions, and **Deploys → Trigger deploy**. Optional: `AI_EDIT_PER_USER` (edits per visitor per day, default 5) and `AI_EDIT_PER_DAY` (site total per day, default 200).

Limits built in: only the site's own pages may call it, daily caps counted in Netlify Blobs, and transcripts up to 400 caption lines.

### Install as an app

The site is a Progressive Web App: on Android Chrome use **Add to Home screen / Install app**; on iPhone Safari use **Share → Add to Home Screen**. It opens full screen with its own icon and works offline once loaded (generating captions on-device needs the model downloaded once).

## Project layout

```
site/            ← what Netlify publishes
  index.html     forwards to the studio (on Netlify "/" serves app.html directly, see netlify.toml)
  about.html     landing page (features, demo, pricing, FAQ)
  templates.html all templates, live previews, 11 preview languages
  app.html       the studio, and the home page: projects dashboard + editor
  privacy.html   every outside request the site makes
  css/styles.css
  js/app.js            editor
  js/captions.js       caption data model (split/merge/retime/SRT), pure + tested
  js/asr-core.js       long-audio planning for Whisper, pure + tested
  js/whisper-worker.js on-device speech recognition (Web Worker)
  js/renderer.js       canvas caption renderer (preview and export)
  js/templates.js      caption styles
  js/gallery.js        template previews
  js/languages.js      languages + Hindi → Hinglish
  js/translate.js      caption language detection + online translation fallback
tests/unit       node --test
tests/e2e        Playwright end-to-end test incl. export verified with ffprobe
tests/fixtures   small test videos
```
