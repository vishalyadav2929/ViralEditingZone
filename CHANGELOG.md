# Changelog — Viral Editing Zone

This file is the version history people see on GitHub first: what the old
version was, and what the new update changes. Nothing in v1 is removed in v2.

## v1 — Current version (before this update)
**Repo state: main at `7adf8c46e52fdd752f1e4032be30f09d26ec9481` (25 Oct 2026)**
**Live site: https://viralcaptionwala.netlify.app/app.html**

A free, browser-based caption editor for Reels, Shorts and Pins. No account,
no payment, no watermark. Video never leaves the device, except optional
audio clips / caption text for Fast / AI features.

What v1 already does:
- Upload video / photo / audio (up to 2 GB), projects saved on the device (IndexedDB)
- Auto captions with on-device Whisper (Hindi, Hinglish, English + 30 languages,
  word-level timestamps) and optional Groq Fast mode
- 90 animated caption styles, word-by-word highlight, per-word colour,
  SRT/VTT import and SRT export, undo/redo
- Text layers: 27 fonts, colour / outline / box / shadow, motion keyframes,
  opacity, glow, shadow strength
- Long video → Shorts: hook-based clip finder, 9:16 / 1:1 / 16:9, series parts
- Colour grading: WebGL2 LUT looks + any `.cube` file, exposure / contrast /
  saturation / temperature / tint / vignette
- 14 synthesised sound effects (Web Audio, copyright-free), thumbnail / design studio,
  live captions, YouTube growth planner
- Export: WebCodecs + Mediabunny fast export, MP4 (H.264) or WebM, original audio kept
- PWA: installable, offline shell, `manifest.webmanifest` + `sw.js`

Known v1 limits (kept honestly, not hidden):
- Single main video model — no multi-track timeline yet
- No transitions, no per-clip speed curve, no music import yet
- No auto face-tracking reframe (manual frame-position slider only)
- No background removal on video (only a green-screen captions-only export)
- Branding on the live site still says "ViralCaptionZone" while the repo is
  "ViralEditingZone" — the rename is a separate pending change, not part of v2

## v2 — CapCut-style Editor UI update (staged, 25 Oct 2026)
**Rule for v2: SAB KUCHH RAKHO. Nothing from v1 is deleted.**

What changes — UI shell only:
- Top bar: CapCut-style compact bar, Export button prominent on the top-right
  (same `#exportBtn`, only its position / look changes)
- Desktop: the 9 existing tool tabs become a left icon rail —
  Media, Clips, Captions, Text, Thumbnail, Audio, Styles, Filters, Adjust
- Mobile (≤760px): the same tabs become a CapCut-style bottom toolbar, and
  opening a tool shows its existing panel as a bottom sheet
- Centre preview (`#stage`) and right properties (Caption style / Text / Details)
  stay in place, only cleaned up
- Tools that do not exist yet (Speed, Transitions, Music import) stay visible
  only as disabled "Soon" buttons — they are never faked as working

What does NOT change in v2:
- Typography: `site/js/templates.js` (90 styles) is untouched — Montserrat base,
  Anton, Archivo Black, Playfair Display italic, Great Vibes / Dancing Script
- Auto-caption system: `whisper-worker.js`, `asr-core.js`, `cloud-asr.js`,
  `captions.js`, `renderer.js` are untouched
- Every existing element ID, every panel, every feature listed under v1 above
- No new paid feature, no login, no watermark added in v2

New files added in v2 (additions only, no existing file edited to stage them):
- `site/css/capcut-ui.css` — layout / look overrides, loaded after `styles.css`
- `site/js/capcut-shell.js` — moves the existing tab buttons on mobile
  (same DOM nodes, so existing click handlers keep working)

Activation (next step, after review):
- Add only these 2 lines to `site/app.html`:
  ```html
  <link rel="stylesheet" href="css/capcut-ui.css">
  <script type="module" src="js/capcut-shell.js"></script>
  ```
- Rollback in 1 minute: remove those 2 lines and the old editor returns,
  because `styles.css` and `app.js` were never edited for v2.

## Next after v2 (not in this update)
- Phase 0: multi-track project model (`tracks[]`)
- Phase 1: multi-track timeline, Phase 2: transitions / speed / effects,
  Phase 3: audio (music import, beat sync), Phase 4: phone-first UI polish,
  Phase 5: own AI features (AI voiceover, Nano Banana, Veo/Flow, script-to-video,
  Auto Reel, full video templates) — see `CapCut-Like-Plan.md` in the workspace.
