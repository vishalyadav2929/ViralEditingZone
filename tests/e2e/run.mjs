// End-to-end test of the real editor in Chromium: upload → captions → edit → template → style → export.
// Verifies the exported file with ffprobe/ffmpeg (duration, audio track, caption pixels).
// Usage: npm run test:e2e   (needs Playwright + Chromium and ffmpeg on PATH)
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = join(REPO, 'site');
const OUT = join(REPO, 'tests', 'e2e', 'out');
const FIX = join(REPO, 'tests', 'fixtures');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webm': 'video/webm', '.srt': 'text/plain', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall back to a global install */ }
  const g = execFileSync('npm', ['root', '-g']).toString().trim();
  return import(join(g, 'playwright', 'index.mjs'));
}

const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const body = await readFile(join(ROOT, p === '/' ? 'index.html' : p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const BASE = `http://localhost:${server.address().port}`;

const results = [];
// ONLY=<text> runs just the steps whose name contains it (handy for steps with their own browser context).
const step = async (name, fn) => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name, e.message]); console.log('FAIL', name, '\n  ', e.message); }
};

const { chromium } = await loadPlaywright();
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const vcz = fn => page.evaluate(fn);
// Caption styles live in the Styles tab on computers (under the video on phones).
async function pickTpl(pg, name) {
  if (await pg.isVisible('#ltabTpl')) await pg.click('#ltabTpl');
  await pg.locator('#grid .tpl', { hasText: name }).first().click();
}


await step('start screen loads with upload card and disabled button', async () => {
  await page.goto(`${BASE}/app.html`);
  await page.waitForSelector('#startDrop');
  assert.equal(await page.textContent('#startGoText'), 'Upload Video First');
  assert.equal(await page.isDisabled('#startGo'), true);
});

await step('rejects a non-video file with a clear message', async () => {
  await page.setInputFiles('#startFile', join(FIX, 'sample.srt'));
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('isn’t a video'));
});

await step('upload shows preview and real metadata', async () => {
  await page.setInputFiles('#startFile', join(FIX, 'portrait.webm'));
  await page.waitForSelector('#startPreview:not([hidden])');
  const meta = await page.textContent('#startMeta');
  assert.match(meta, /portrait\.webm · 540×960 · 0:06/);
});

await step('upload without saved languages asks for them', async () => {
  assert.match(await page.textContent('#startMsg'), /Choose the spoken language/);
  assert.equal(await page.isVisible('#editor'), false);
});

await step('choosing languages starts captions automatically and opens the editor', async () => {
  await page.click('#spokenCombo .combo-btn');
  await page.fill('#spokenCombo input', 'hindi');
  await page.keyboard.press('Enter');
  await page.click('#captionCombo .combo-btn');
  const opts = await page.$$eval('#captionCombo [role=option]', els => els.map(e => e.textContent));
  assert.deepEqual(opts, ['Hindi', 'Hinglish (Roman Hindi)', 'English']);
  await page.click('#captionCombo [role=option]:has-text("Hinglish")');
  await page.waitForSelector('#editor:not([hidden])');
  // Offline sandbox: the model can't download, so it must fail with a clear message and no fake captions.
  await page.waitForFunction(() => /Couldn’t generate captions/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
  console.log('   message shown:', await page.textContent('#status'));
  assert.equal(await vcz(() => window.__vcz.S.segments.length), 0, 'no fake captions');
  assert.equal(await vcz(() => window.__vczAudioLength), 6 * 16000, 'decoded 6 s of 16 kHz audio');
  const saved = await page.evaluate(() => localStorage.getItem('vcz-langs'));
  assert.match(saved, /hinglish/);
});

await step('sample caption shows the template on the video before captions exist', async () => {
  await pickTpl(page, 'Classic');
  await page.waitForTimeout(300);
  const a = await page.locator('#stage').screenshot();
  await pickTpl(page, 'Pop-up Chat');
  await page.waitForTimeout(300);
  const b = await page.locator('#stage').screenshot();
  assert.notDeepEqual(a, b);
  await writeFile(join(OUT, 'sample-caption.png'), b);
});

await step('real-time audio fallback (used when a browser can’t decode the file) reads the full track', async () => {
  await page.click('#tabCaptions');
  await page.evaluate(() => { window.__vczForceRealtime = true; window.__vczAudioLength = 0; window.__vczKeepAudio = true; });
  await page.evaluate(() => { document.getElementById('moreOpts').open = true; });
  await page.click('#genBtn');
  await page.waitForFunction(() => /Couldn’t generate captions/.test(document.getElementById('status').textContent) && window.__vczAudioLength > 0, null, { timeout: 60000 });
  const len = await vcz(() => window.__vczAudioLength);
  assert.ok(Math.abs(len / 16000 - 6) < 0.6, `captured ${len / 16000}s`);
  // Captured faster than real time, but the 440 Hz test tone must come back at 440 Hz (no chipmunk voice).
  const hz = await page.evaluate(() => {
    const a = window.__vczAudio; let z = 0;
    const from = 16000, to = Math.min(a.length, 16000 * 4);
    for (let i = from + 1; i < to; i++) if (a[i - 1] <= 0 && a[i] > 0) z++;
    return z / ((to - from) / 16000);
  });
  assert.ok(Math.abs(hz - 440) < 15, `pitch ${hz.toFixed(1)} Hz`);
  console.log('   fast capture pitch', hz.toFixed(1), 'Hz');
  await page.evaluate(() => { window.__vczForceRealtime = false; window.__vczKeepAudio = false; });
});

await step('editor shows an empty-state message', async () => {
  assert.match(await page.textContent('#segs'), /No captions yet/);
});

await step('SRT import creates timed captions', async () => {
  await page.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  await page.waitForFunction(() => window.__vcz.S.segments.length > 0);
  const segs = await vcz(() => window.__vcz.S.segments.map(s => [s.start, s.end, s.words.map(w => w.text).join(' ')]));
  assert.equal(segs.length, 3);
  assert.deepEqual(segs[0], [0.3, 2, 'this is how your']);
});

await step('edit text, split, merge, add, delete, undo, redo', async () => {
  await page.click('#tabCaptions');
  const ta = page.locator('#segs .seg textarea').first();
  await ta.fill('this is exactly how your');
  await ta.blur();
  let t = await vcz(() => window.__vcz.S.segments[0].words.map(w => w.text).join(' '));
  assert.equal(t, 'this is exactly how your');
  await page.locator('#segs .seg').first().locator('button[title="Split at cursor"]').click();
  assert.equal(await vcz(() => window.__vcz.S.segments.length), 4);
  await page.locator('#segs .seg').first().locator('button[title="Merge with next"]').click();
  assert.equal(await vcz(() => window.__vcz.S.segments.length), 3);
  await page.locator('#segs .seg').nth(2).locator('button[title="Add caption after"]').click();
  assert.equal(await vcz(() => window.__vcz.S.segments.length), 4);
  await page.locator('#segs .seg').nth(3).locator('button[title="Delete caption"]').click();
  assert.equal(await vcz(() => window.__vcz.S.segments.length), 3);
  await page.click('#undoBtn');
  assert.equal(await vcz(() => window.__vcz.S.segments.length), 4);
  await page.click('#redoBtn');
  assert.equal(await vcz(() => window.__vcz.S.segments.length), 3);
});

await step('editing a time moves the caption', async () => {
  await page.click('#tabCaptions');
  const inp = page.locator('#segs .seg').nth(1).locator('.t-in').first();
  await inp.fill('0:02.50');
  await inp.press('Enter');
  await inp.blur();
  const s = await vcz(() => window.__vcz.S.segments[1].start);
  assert.equal(s, 2.5);
});

async function captionPixels() {
  // Count bright, saturated-white pixels in the canvas centre band (captions), at 1.0 s.
  return vcz(async () => {
    const v = document.querySelector('canvas#stage');
    await new Promise(r => setTimeout(r, 120));
    const d = v.getContext('2d').getImageData(0, 0, v.width, v.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) n++;
    return n;
  });
}

await step('template change updates the real preview', async () => {
  await vcz(() => { const v = document.querySelector('video'); });
  await page.evaluate(() => { window.__vcz.S.o.pos = 0.5; });
  await page.locator('#seek').evaluate(el => { el.value = 170; el.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(300);
  await pickTpl(page, 'Classic');
  const before = await page.locator('#stage').screenshot();
  await pickTpl(page, 'Pop-up Chat');
  await page.waitForTimeout(400);
  const after = await page.locator('#stage').screenshot();
  assert.notDeepEqual(before, after);
  assert.equal(await vcz(() => window.__vcz.tpl().id), 'popup-chat');
  await writeFile(join(OUT, 'preview-popup-chat.png'), after);
});

await step('style controls change the template used for preview and export', async () => {
  await page.click('#tabCaptions');
  await page.evaluate(() => { const d = document.getElementById('advStyle'); if (d) d.open = true; });
  await page.locator('#strokeW').fill('20');
  await page.locator('#strokeW').dispatchEvent('change');
  await page.locator('#bgOp').fill('70');
  await page.locator('#bgOp').dispatchEvent('change');
  await page.click('#alignCtl button[data-v="left"]');
  const t = await vcz(() => window.__vcz.tpl());
  assert.equal(t.stroke.w, 0.2);
  assert.match(t.bg.c, /rgba\(0,0,0,0\.7\)/);
  assert.equal(t.align, 'left');
  await page.click('#resetStyle');
  const r = await vcz(() => window.__vcz.tpl());
  assert.equal(r.align, undefined);
  await page.click('#tabCaptions');
});

async function doExport(kind, res = 0) {
  const dl = page.waitForEvent('download', { timeout: 90000 });
  await page.click('#exportBtn');
  await page.waitForSelector('#xDlg[open]');
  await page.check(`input[name=xKind][value=${kind}]`);
  await page.selectOption('#xRes', String(res));
  await page.click('#xGo');
  const d = await dl;
  const file = join(OUT, d.suggestedFilename());
  await d.saveAs(file);
  await page.waitForSelector('#exportOv', { state: 'hidden' });
  const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:stream_tags=alpha_mode', '-of', 'csv=p=0', file]).toString();
  const dec = execFileSync('sh', ['-c', `ffmpeg -i "${file}" -f null - 2>&1 | grep -o 'time=[0-9:.]*' | tail -1`]).toString();
  const [, h, m, sec] = dec.match(/time=(\d+):(\d+):([\d.]+)/);
  return { file, streams, dur: +h * 3600 + +m * 60 + +sec };
}

await step('export: video with burned-in captions at original resolution with original audio', async () => {
  await pickTpl(page, 'High Contrast');
  await page.waitForTimeout(200);
  const { file, streams, dur } = await doExport('video', 0);
  assert.match(streams, /video/); assert.match(streams, /audio/);
  assert.match(streams, /540,960/, 'original resolution kept');
  if (file.endsWith('.mp4')) assert.match(streams, /h264/, 'MP4 must contain H.264 video');
  assert.ok(dur > 5 && dur < 7.5, `duration ${dur}`);
  const fmtDur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
  assert.ok(+fmtDur > 5, `container duration header: ${fmtDur}`);
  const vol = execFileSync('sh', ['-c', `ffmpeg -i "${file}" -vn -af volumedetect -f null - 2>&1 | grep -o 'mean_volume: [-0-9.]*'`]).toString();
  assert.ok(+vol.split(':')[1] > -35, `exported audio too quiet: ${vol}`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1.2', '-i', file, '-frames:v', '1', join(OUT, 'export-frame.png')]);
  const yellow = execFileSync('sh', ['-c', `ffmpeg -v error -i "${join(OUT, 'export-frame.png')}" -vf "crop=iw:ih*0.25:0:ih*0.68,format=rgb24" -f rawvideo - | od -An -tu1 -v -w3 | awk '$1>200 && $2>200 && $3<90' | wc -l`]).toString();
  assert.ok(+yellow > 200, `caption pixels in exported frame: ${yellow.trim()}`);
  console.log('   video:', file.split('/').pop(), '|', streams.trim().replace(/\n/g, ' / '), '|', dur.toFixed(2), 's | header', fmtDur, '| audio', vol.trim(), '| caption px', yellow.trim());
});

await step('export (WebCodecs path): every frame encoded, original resolution, audio kept, captions burned in', async () => {
  // This Chromium has no H.264 encoder, so let the WebCodecs path use VP9 for the test; on Safari/Chrome it's H.264.
  await page.evaluate(() => { window.__vczExportCodecs = ['vp09.00.40.08']; });
  const { file, streams, dur } = await doExport('video', 0);
  const used = await page.evaluate(() => window.__vczLastExport);
  await page.evaluate(() => { delete window.__vczExportCodecs; });
  assert.equal(used, 'webcodecs');
  assert.ok(file.endsWith('.mp4'), file);
  assert.match(streams, /video/); assert.match(streams, /audio/);
  assert.match(streams, /540,960/, 'original resolution kept');
  assert.ok(dur > 5.5 && dur < 6.6, `duration ${dur}`);
  const srcFrames = +execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', join(FIX, 'portrait.webm')]).toString().trim();
  const outFrames = +execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]).toString().trim();
  assert.ok(outFrames >= srcFrames * 0.9, `frames: ${outFrames} of ${srcFrames}`);
  const vol = execFileSync('sh', ['-c', `ffmpeg -i "${file}" -vn -af volumedetect -f null - 2>&1 | grep -o 'mean_volume: [-0-9.]*'`]).toString();
  assert.ok(+vol.split(':')[1] > -35, `exported audio too quiet: ${vol}`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1.2', '-i', file, '-frames:v', '1', join(OUT, 'export-wc-frame.png')]);
  const yellow = execFileSync('sh', ['-c', `ffmpeg -v error -i "${join(OUT, 'export-wc-frame.png')}" -vf "crop=iw:ih*0.25:0:ih*0.68,format=rgb24" -f rawvideo - | od -An -tu1 -v -w3 | awk '$1>200 && $2>200 && $3<90' | wc -l`]).toString();
  assert.ok(+yellow > 200, `caption pixels in exported frame: ${yellow.trim()}`);
  console.log('   webcodecs:', file.split('/').pop(), '|', streams.trim().replace(/\n/g, ' / '), '| frames', outFrames, 'of', srcFrames, '| audio', vol.trim(), '| caption px', yellow.trim());
});

await step('export: captions only with a transparent background', async () => {
  const { file, streams, dur } = await doExport('alpha', 0);
  assert.match(streams, /540,960/);
  assert.match(streams, /,1\s*$/m, 'alpha_mode=1');
  assert.doesNotMatch(streams, /audio/);
  assert.ok(dur > 5 && dur < 7.5, `duration ${dur}`);
  const codec = /vp8/.test(streams) ? 'libvpx' : 'libvpx-vp9';
  const stats = execFileSync('sh', ['-c', `ffmpeg -v error -c:v ${codec} -ss 1.2 -i "${file}" -frames:v 1 -vf "alphaextract,format=gray" -f rawvideo - | od -An -tu1 -v -w1 | awk '$1<10{t++} $1>245{o++} END{print t, o}'`]).toString().trim().split(' ').map(Number);
  const [transparent, opaque] = stats;
  assert.ok(transparent > 540 * 960 * 0.6, `transparent px ${transparent}`);
  assert.ok(opaque > 1000, `opaque caption px ${opaque}`);
  console.log('   transparent:', file.split('/').pop(), '| transparent px', transparent, '| opaque px', opaque);
});

await step('export: captions only on green screen', async () => {
  const { file, streams } = await doExport('green', 0);
  assert.match(streams, /540,960/);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1.2', '-i', file, '-frames:v', '1', join(OUT, 'green-frame.png')]);
  const green = execFileSync('sh', ['-c', `ffmpeg -v error -i "${join(OUT, 'green-frame.png')}" -vf format=rgb24 -f rawvideo - | od -An -tu1 -v -w3 | awk '$1<60 && $2>200 && $3<60' | wc -l`]).toString();
  assert.ok(+green > 540 * 960 * 0.6, `green px ${green.trim()}`);
  console.log('   green screen:', file.split('/').pop(), '| green px', green.trim());
});

await step('replacing the video asks first when there are captions; landscape sizes the canvas to 16:9', async () => {
  const hadCaptions = await vcz(() => window.__vcz.S.segments.length);
  let asked = '';
  page.once('dialog', d => { asked = d.message(); d.accept(); });
  await page.setInputFiles('#fileIn', join(FIX, 'landscape.webm'));
  await page.waitForFunction(() => document.getElementById('meta').textContent.includes('960×540'));
  await page.waitForTimeout(300);
  const dims = await vcz(() => [document.getElementById('stage').width, document.getElementById('stage').height]);
  assert.deepEqual(dims, [960, 540]);
  // Nothing is lost any more: the previous video stays in Media as its own project, so no question is asked.
  assert.equal(asked, '', 'no confirm needed');
  await page.waitForFunction(() => document.querySelectorAll('#mediaBin .media-item').length >= 2);
  if (hadCaptions) assert.ok(await page.locator('#mediaBin .media-item').count() >= 2, 'the previous video is still in Media');
});

await step('no horizontal overflow on phones, tablets and laptops (incl. editor with a video loaded)', async () => {
  const sizes = [[375, 667, true], [390, 844, true], [412, 915, true], [768, 1024, true], [1024, 768, true], [1280, 720, false], [1440, 900, false]];
  for (const [w, h, mobile] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile && w < 1000, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, serviceWorkers: 'block' });
    const m = await ctx.newPage();
    const over = async label => {
      const r = await m.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth, innerWidth]);
      assert.ok(r[0] <= r[1] + 1 && r[2] <= r[1] + 1, `${w}px ${label}: page is ${r[0]}px wide (viewport ${r[1]}, innerWidth ${r[2]})`);
    };
    for (const p of ['about.html', 'templates.html', 'privacy.html', 'app.html']) { await m.goto(`${BASE}/${p}`); await m.waitForTimeout(300); await over(p); }
    await m.click('#startSkip');
    await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
    await m.waitForTimeout(400);
    await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
    await m.waitForTimeout(300);
    await over('editor with video');
    if (w === 390) await m.screenshot({ path: join(OUT, 'mobile-editor.png') });
    await m.click('#exportBtn'); await m.waitForTimeout(150); await over('export dialog');
    await ctx.close();
  }
});

await step('iPhone-style audio lock: shows “Tap to start captions”, and a tap reads the audio', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    localStorage.setItem('vcz-langs', JSON.stringify({ spoken: 'Hindi — हिन्दी', caption: 'hinglish', quality: 'balanced' }));
    window.__vczForceRealtime = true; // the path iPhone takes when it can't decode a .mov directly
    let tapped = false;
    addEventListener('pointerdown', () => { tapped = true; }, true);
    addEventListener('touchstart', () => { tapped = true; }, true);
    const AC = window.AudioContext, resume = AC.prototype.resume, play = HTMLMediaElement.prototype.play;
    Object.defineProperty(AC.prototype, 'state', { get() { return this.__running ? 'running' : 'suspended'; } });
    AC.prototype.resume = function () { if (tapped) { this.__running = true; return resume.call(this); } return new Promise(() => {}); };
    HTMLMediaElement.prototype.play = function () { return tapped ? play.call(this) : Promise.reject(new DOMException('blocked', 'NotAllowedError')); };
  });
  const m = await ctx.newPage();
  await m.goto(`${BASE}/app.html`);
  await m.setInputFiles('#startFile', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#editor:not([hidden])');
  await m.waitForSelector('#genOvTap:not([hidden])', { timeout: 15000 });
  await m.screenshot({ path: join(OUT, 'mobile-tap-to-start.png') });
  await m.tap('#genOvTap');
  await m.waitForFunction(() => window.__vczAudioLength > 0, null, { timeout: 30000 });
  const len = await m.evaluate(() => window.__vczAudioLength);
  assert.ok(Math.abs(len / 16000 - 6) < 0.6, `read ${len / 16000}s of audio after the tap`);
  await ctx.close();
});

await step('drag the captions up/down on the video; A−/A+ change size', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForTimeout(400);
  await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  const box = await m.locator('#stage').boundingBox();
  const before = await m.evaluate(() => window.__vcz.tpl().pos ?? 0.72);
  await m.mouse.move(box.x + box.width / 2, box.y + box.height * 0.5);
  await m.mouse.down();
  await m.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3, { steps: 6 });
  await m.mouse.up();
  const after = await m.evaluate(() => window.__vcz.S.o.pos);
  assert.ok(after < before - 0.15, `position moved up: ${before} → ${after}`);
  assert.equal(await m.evaluate(() => document.querySelector('video').paused), true, 'dragging must not start playback');
  // A−/A+ sit on the preview in the middle layout (the full-height layouts show only the video).
  await m.click('#layBtn'); await m.click('[data-lay="center"]');
  await m.click('#szUp'); await m.click('#szUp');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.scale), 1.2);
  await m.click('#szDown');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.scale), 1.1);
  await ctx.close();
});

await step('translate captions with the browser translator (mocked) keeps the timing', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    self.Translator = {
      availability: async () => 'available',
      create: async ({ sourceLanguage, targetLanguage }) => ({ translate: async t => `[${sourceLanguage}>${targetLanguage}] ` + t.toUpperCase() }),
    };
  });
  const m = await ctx.newPage();
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForTimeout(300);
  await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  await m.evaluate(() => { document.getElementById('lang').value = '3'; }); // English (US) as caption language
  const before = await m.evaluate(() => window.__vcz.S.segments.map(s => [s.start, s.end]));
  await m.selectOption('#trTarget', { label: 'Spanish — Español' });
    await m.waitForFunction(() => /Translated to/.test(document.getElementById('status').textContent));
  const text = await m.evaluate(() => window.__vcz.S.segments.map(s => s.words.map(w => w.text).join(' ')).join(' | '));
  assert.match(text, /\[en>es\]/);
  assert.match(text.replace(/ \| /g, ' '), /THIS IS HOW YOUR/);
  const span = await m.evaluate(() => [window.__vcz.S.segments[0].start, window.__vcz.S.segments.at(-1).end]);
  assert.deepEqual(span, [before[0][0], before.at(-1)[1]], 'overall timing kept');
  await m.click('#undoBtn');
  assert.doesNotMatch(await m.evaluate(() => window.__vcz.S.segments.map(s => s.words.map(w => w.text).join(' ')).join(' ')), /\[en>es\]/);
  await ctx.close();
});

await step('without a browser translator: English captions → Hinglish → Hindi → Bangla (online service mocked)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const asked = [];
  const HI = { 'this is how your reels go viral': 'ऐसे तुम्हारी रील्स वायरल होती हैं', 'my friend': 'मेरा दोस्त' };
  await ctx.route('https://api.mymemory.translated.net/**', route => {
    const u = new URL(route.request().url());
    const q = u.searchParams.get('q'), pair = u.searchParams.get('langpair');
    asked.push(pair);
    const out = pair === 'en|hi' ? (HI[q.replace(/[.!?]$/, '')] || q) : `[${pair}] ${q}`;
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ responseData: { translatedText: out }, responseStatus: 200 }) });
  });
  await ctx.addInitScript(() => { delete self.Translator; }); // like iPhone Safari
  const m = await ctx.newPage();
  await m.goto(`${BASE}/app.html`);
  assert.equal(await m.evaluate(() => 'Translator' in self), false);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForTimeout(300);
  const srt = '1\n00:00:00,300 --> 00:00:02,000\nthis is how your\n\n2\n00:00:02,000 --> 00:00:04,000\nreels go viral.\n\n3\n00:00:05,000 --> 00:00:06,500\nmy friend\n';
  await m.setInputFiles('#srtIn', { name: 'en.srt', mimeType: 'text/plain', buffer: Buffer.from(srt) });
  await m.evaluate(() => { document.getElementById('lang').value = '0'; }); // Hindi picked, but the text is English
  const shown = () => m.evaluate(() => window.__vcz.S.segments.map(s => s.words.map(w => w.text).join(' ')).join(' '));
  await m.selectOption('#trTarget', { label: 'Hinglish (Hindi → Roman)' });
    await m.waitForFunction(() => /Translated to/.test(document.getElementById('status').textContent));
  assert.deepEqual(asked, ['en|hi', 'en|hi'], 'English text is detected and sent as en → hi');
  assert.match(await shown(), /वायरल/);
  assert.equal(await m.evaluate(() => window.__vcz.S.hinglish), true, 'Hinglish turns on, so it shows in Roman letters');
  // Hinglish → Hindi script needs no network.
  await m.selectOption('#trTarget', { label: 'Hindi — हिन्दी' });
    assert.equal(await m.evaluate(() => window.__vcz.S.hinglish), false);
  assert.equal(asked.length, 2);
  // Hindi → Bangla.
  await m.evaluate(() => { document.getElementById('status').textContent = ''; });
  await m.selectOption('#trTarget', { label: 'Bengali — বাংলা' });
    await m.waitForFunction(() => /Translated to/.test(document.getElementById('status').textContent));
  assert.equal(asked.at(-1), 'hi|bn');
  assert.match(await shown(), /\[hi\|bn\]/);
  await ctx.close();
});

await step('phone: full screen works without the Fullscreen API (iPhone), typing un-pins the preview, home shows 12 templates', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false }); });
  const m = await ctx.newPage();
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForTimeout(300);
  await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  await m.click('#fsBtn');
  const box = await m.locator('#box').boundingBox();
  assert.ok(box.width >= 389 && box.height >= 840, `fills the screen: ${box.width}x${box.height}`);
  assert.equal(await m.isVisible('#fsExit'), true);
  await m.click('#fsPlay');
  await m.waitForTimeout(200);
  assert.equal(await m.evaluate(() => !window.__vczVideo.paused), true, 'play from full screen');
  await m.click('#fsExit');
  assert.ok((await m.locator('#box').boundingBox()).height < 600, 'back to normal');
  await m.locator('.seg textarea').first().focus();
  assert.equal(await m.evaluate(() => getComputedStyle(document.querySelector('.stage')).position), 'static', 'un-pinned while typing');
  await m.locator('.seg textarea').first().blur();
  await m.waitForTimeout(100);
  assert.equal(await m.evaluate(() => getComputedStyle(document.querySelector('.stage')).position), 'sticky', 'pinned again');
  await m.goto(`${BASE}/about.html`);
  await m.waitForSelector('#grid .tpl');
  const visible = () => m.$$eval('#grid .tpl', els => els.filter(e => e.offsetParent).length);
  assert.equal(await visible(), 12);
  await m.click('#moreTpl');
  assert.ok(await visible() > 50);
  await ctx.close();
});

await step('home: Auto-run toggle exists, is off by default, and controls S.autoRun', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  assert.equal(await m.locator('#autoRun').count(), 1, 'the on/off toggle is on the dashboard');
  assert.equal(await m.isChecked('#autoRun'), false, 'off by default — nothing auto-edits itself');
  assert.equal(await m.evaluate(() => window.__vcz.S.autoRun), false, 'S.autoRun starts false');
  // Picking Auto Mode only remembers the intent; it must not edit anything by itself.
  await m.click('#modeGrid [data-mode="auto"]');
  assert.equal(await m.evaluate(() => window.__vcz.S.editMode), 'auto');
  assert.equal(await m.evaluate(() => window.__vcz.S.autoRun), false, 'still off after choosing a mode');
  await m.check('#autoRun');
  assert.equal(await m.evaluate(() => window.__vcz.S.autoRun), true, 'turning it on flips the flag');
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('beats: detect a beat, then "Snap cuts to beats" appears and toggles S.o.snapBeats', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.click('#ltabSnd');                                 // open the Audio panel (holds music + beats)
  await m.setInputFiles('#musicIn', join(FIX, 'beat.mp3'));
  await m.waitForFunction(() => window.__vcz.S.o.music, null, { timeout: 15000 });
  await m.waitForSelector('#beatsBtn:visible');
  // Snap option is hidden until there are beats.
  assert.equal(await m.isVisible('#snapBeatsWrap'), false, 'no snap option before detecting beats');
  await m.click('#beatsBtn');
  await m.waitForFunction(() => (window.__vcz.S.o.beats || []).length > 0, null, { timeout: 15000 });
  assert.equal(await m.isVisible('#snapBeatsWrap'), true, 'snap option shows once beats exist');
  assert.equal(await m.evaluate(() => !!window.__vcz.S.o.snapBeats), false, 'off by default');
  await m.check('#snapBeats');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.snapBeats), true, 'turning it on sets the flag');
  // Clearing the grid also clears snapping and hides the option.
  await m.click('#beatsClear');
  assert.equal(await m.isVisible('#snapBeatsWrap'), false, 'cleared → option hidden');
  assert.equal(await m.evaluate(() => !!window.__vcz.S.o.snapBeats), false, 'cleared → snap off');
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('home: example videos show live captions on real clips (from examples/manifest.json)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  await m.goto(`${BASE}/about.html`);
  assert.equal(await m.isVisible('#showcase'), false, 'hidden while the manifest is empty');
  await m.route('**/examples/manifest.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [{ video: 'demo.webm', captions: 'demo.srt', templates: ['classic', 'crazy', 'nope'] }] }) }));
  await m.route('**/examples/demo.webm', async r => r.fulfill({ contentType: 'video/webm', body: await readFile(join(FIX, 'portrait.webm')) }));
  await m.route('**/examples/demo.srt', async r => r.fulfill({ contentType: 'text/plain', body: await readFile(join(FIX, 'sample.srt')) }));
  await m.reload();
  await m.waitForSelector('#showcase:not([hidden]) .ex');
  assert.equal(await m.locator('#exGrid .ex').count(), 2, 'unknown template ids are skipped');
  assert.match(await m.getAttribute('#exGrid .ex >> nth=0', 'href'), /app\.html\?t=classic/);
  await m.locator('#exGrid .ex').first().scrollIntoViewIfNeeded();
  await m.waitForTimeout(1500);
  const lit = await m.evaluate(() => {
    const c = document.querySelector('#exGrid canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 60) n++;
    return n;
  });
  assert.ok(lit > 1000, `video frame drawn (${lit} lit px)`);
  await ctx.close();
});

await step('fast mode (server): captions in one go when the owner has set it up; busy server falls back to the device', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  let posts = 0, cdn = 0, busy = false;
  await ctx.route('**/api/transcribe**', async r => {
    if (r.request().method() === 'GET') return r.fulfill({ contentType: 'application/json', body: '{"enabled":true}' });
    posts++;
    if (busy) return r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"busy"}' });
    assert.equal(new URL(r.request().url()).searchParams.get('lang'), 'hi');
    const wav = r.request().postDataBuffer();
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ level: 'word', words: [{ text: 'नमस्ते', start: 0.3, end: 0.9 }, { text: 'दोस्तों', start: 0.9, end: 1.6 }, { text: 'आज', start: 2.0, end: 2.4 }] }) });
  });
  await ctx.route('https://cdn.jsdelivr.net/**', r => { cdn++; r.abort(); });
  const m = await ctx.newPage();
  await m.goto(`${BASE}/app.html`);
  await m.setInputFiles('#startFile', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#startPreview:not([hidden])');
  await m.click('#spokenCombo .combo-btn'); await m.fill('#spokenCombo input', 'hindi'); await m.keyboard.press('Enter');
  await m.click('#captionCombo .combo-btn'); await m.click('#captionCombo [role=option]:has-text("Hinglish")');
  await m.waitForFunction(() => /Fast mode/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  assert.equal(posts, 1, 'one 6 s clip sent');
  assert.equal(cdn, 0, 'no on-device model download in fast mode');
  const words = await m.evaluate(() => window.__vcz.S.segments.flatMap(s => s.words.map(w => w.text)));
  assert.deepEqual(words, ['नमस्ते', 'दोस्तों', 'आज']);
  assert.equal(await m.isVisible('#cloudRow'), false, 'option lives under More options');
  await m.evaluate(() => { document.getElementById('moreOpts').open = true; });
  assert.equal(await m.isVisible('#cloudRow'), true);
  // Busy server: falls back to on-device captions (which can't download here, so it ends with a clear message).
  busy = true;
  m.once('dialog', d => d.accept()); // "replace the current captions?"
  await m.click('#genBtn');
  await m.waitForFunction(() => /Couldn’t generate captions/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
  assert.equal(posts, 2);
  assert.ok(cdn > 0, 'fell back to the on-device model');
  await ctx.close();
});

await step('installable app: manifest, icons, service worker, opens offline', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const m = await ctx.newPage();
  await m.goto(`${BASE}/about.html`);
  const man = await m.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  assert.equal(man.display, 'standalone');
  for (const ic of man.icons) assert.equal((await m.request.get(`${BASE}/${ic.src}`)).status(), 200, ic.src);
  await m.evaluate(() => navigator.serviceWorker.ready);
  await m.goto(`${BASE}/app.html`); // cached by the worker
  await m.waitForTimeout(500);
  await ctx.setOffline(true);
  await m.reload();
  assert.equal(await m.isVisible('#startDrop'), true, 'editor opens offline');
  await ctx.setOffline(false);
  await ctx.close();
});

await step('home: live demo plays the manifest clip and switches caption style on tap', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  await m.route('**/examples/manifest.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [], demo: { video: 'demo.webm', captions: 'demo.srt' } }) }));
  await m.route('**/examples/demo.webm', async r => r.fulfill({ contentType: 'video/webm', body: await readFile(join(FIX, 'portrait.webm')) }));
  await m.route('**/examples/demo.srt', async r => r.fulfill({ contentType: 'text/plain', body: await readFile(join(FIX, 'sample.srt')) }));
  await m.goto(`${BASE}/about.html`);
  await m.locator('#demo').scrollIntoViewIfNeeded();
  await m.waitForSelector('.demo-style');
  assert.ok(await m.locator('.demo-style').count() >= 8);
  assert.equal(await m.isVisible('#demoPlay'), true, 'play/mute shown when a clip exists');
  await m.waitForTimeout(1500);
  const shot = () => m.locator('#demoCap').screenshot();
  const a = await shot();
  await m.locator('.demo-style').nth(1).click();
  assert.match(await m.getAttribute('.demo-style >> nth=1', 'class'), /\bon\b/);
  await m.waitForTimeout(300);
  assert.notDeepEqual(a, await shot(), 'captioned side changes');
  await ctx.close();
});

await step('editor upload: captions start by themselves (saved languages) or a "Make captions" button shows', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#makeCaptions');
  assert.match(await m.textContent('.make-lang'), /Spoken language/);
  await m.click('#makeCaptions');
  await m.waitForFunction(() => /Couldn’t generate captions/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
  // With languages saved from an earlier visit, a new video starts captions straight away.
  await m.evaluate(() => localStorage.setItem('vcz-langs', JSON.stringify({ spoken: 'Hindi — हिन्दी', caption: 'hinglish', quality: 'balanced' })));
  await m.setInputFiles('#fileIn', join(FIX, 'landscape.webm'));
  await m.waitForFunction(() => !document.getElementById('genOv').hidden || /Couldn’t generate/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  await ctx.close();
});

await step('colour grading: looks change the preview, .cube import, undo, and the export carries the grade', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  m.on('dialog', d => d.accept()); // "export without captions?"
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForTimeout(500);
  await m.evaluate(() => { const v = window.__vczVideo; v.currentTime = 2; });
  await m.waitForTimeout(400);
  const mean = () => m.evaluate(() => { const c = document.getElementById('stage'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 64) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } return [r / n, g / n, b / n].map(Math.round); });
  const before = await mean();
  await m.click('#tabColor');
  assert.ok(await m.locator('.look').count() >= 9, 'built-in looks listed');
  await m.click('.look[data-look="bw"]');
  await m.waitForTimeout(300);
  const bw = await mean();
  assert.ok(Math.abs(bw[0] - bw[1]) <= 2 && Math.abs(bw[1] - bw[2]) <= 2, `B&W preview is grey: ${bw}`);
  assert.notDeepEqual(bw, before);
  await m.click('#undoBtn');
  await m.waitForTimeout(300);
  const undone = await mean();
  assert.ok(undone.every((v, i) => Math.abs(v - before[i]) <= 3), `undo removes the look: ${before} vs ${undone}`);
  // A .cube file that swaps red and blue.
  const rows = []; for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${b} ${g} ${r}`);
  await m.setInputFiles('#cubeIn', { name: 'swap.cube', mimeType: 'text/plain', buffer: Buffer.from(`TITLE "Swap"\nLUT_3D_SIZE 2\n${rows.join('\n')}\n`) });
  await m.waitForSelector('.look[data-look="custom"].on');
  await m.waitForTimeout(300);
  const sw = await mean();
  assert.ok(Math.abs(sw[0] - before[2]) <= 4 && Math.abs(sw[2] - before[0]) <= 4, `red/blue swapped: ${before} -> ${sw}`);
  // Export (WebCodecs path) carries the grade.
  await m.evaluate(() => { window.__vczExportCodecs = ['vp09.00.40.08']; });
  const dl = m.waitForEvent('download', { timeout: 90000 });
  await m.click('#exportBtn'); await m.waitForSelector('#xDlg[open]');
  await m.check('input[name=xKind][value=video]'); await m.click('#xGo');
  const d0 = await dl.catch(async e => { throw new Error(e.message + ' | status: ' + await m.textContent('#status') + ' | errs: ' + errs.join(';')); });
  const file = join(OUT, 'graded-' + d0.suggestedFilename()); await d0.saveAs(file);
  const px = execFileSync('sh', ['-c', `ffmpeg -v error -ss 2 -i "${file}" -frames:v 1 -vf scale=54:96,format=rgb24 -f rawvideo - | od -An -tu1 -v -w3 | awk '{r+=$1;g+=$2;b+=$3;n++} END {printf "%d %d %d", r/n, g/n, b/n}'`]).toString().split(' ').map(Number);
  assert.ok(Math.abs(px[0] - before[2]) <= 25 && Math.abs(px[2] - before[0]) <= 25, `exported frame graded: ${px} (preview before ${before})`);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('caption style lives under the Captions tab — no separate right panel', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  await m.waitForSelector('.seg textarea');
  // The old right properties panel is gone; its controls now live under the Captions tab.
  assert.equal(await m.locator('.panel.props').count(), 0, 'no separate right properties panel');
  await m.click('#tabCaptions');
  assert.equal(await m.isVisible('#capStyle'), true, 'the caption style card is under Captions');
  // The fine-tune fold holds the detailed controls (font, outline, position…) in the same tab.
  assert.equal(await m.locator('#paneCaptions #advStyle #fontSel').count(), 1, 'detailed controls folded under Captions');
  await m.evaluate(() => { document.getElementById('advStyle').open = true; });
  await m.waitForSelector('#fontSel:visible');
  assert.equal(await m.isVisible('#fontSel'), true, 'opening the fine-tune fold shows the detailed controls');
  // Text overlay props and project details are folded into the left tabs too.
  assert.equal(await m.locator('#paneText #paneTxtProps').count(), 1, 'text overlay props under the Text tab');
  assert.equal(await m.locator('#paneCaptions #projDetails #paneInfo').count(), 1, 'project details folded under Captions');
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('timeline: words, captions and waveform; click jumps, double-click edits, Delete removes, vertical-position slider moves captions', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  await m.waitForTimeout(400);
  const words = await m.locator('.tw').count();
  assert.equal(words, await m.evaluate(() => window.__vcz.S.segments.reduce((n, s) => n + s.words.length, 0)));
  assert.equal(await m.locator('.tc').count(), 3);
  const lit = await m.evaluate(() => { const c = document.querySelector('.tl-wave'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  assert.ok(lit > 100, 'waveform drawn');
  // Click the 5th word: the video jumps to it.
  const w5 = await m.evaluate(() => window.__vcz.S.segments.flatMap(s => s.words)[4].start);
  await m.locator('.tw').nth(4).click();
  await m.waitForTimeout(200);
  assert.ok(Math.abs(await m.evaluate(() => window.__vczVideo.currentTime) - w5) < 0.1);
  // Double-click the first word and retype it.
  await m.locator('.tw').first().dblclick();
  await m.keyboard.type('THAT');
  await m.keyboard.press('Enter');
  assert.equal(await m.evaluate(() => window.__vcz.S.segments[0].words[0].text), 'THAT');
  // Select a word and delete it.
  await m.locator('.tw').nth(1).click();
  await m.keyboard.press('Delete');
  assert.equal(await m.locator('.tw').count(), words - 1);
  await m.click('#undoBtn');
  assert.equal(await m.locator('.tw').count(), words, 'undo brings the word back');
  // Caption vertical position: the "Vertical position" slider in Styles → Details (there is no
  // permanent Top/Middle/Bottom toggle in the timeline toolbar any more).
  assert.equal(await m.locator('.tl-pos').count(), 0, 'no caption-position toggle parked in the timeline bar');
  await m.evaluate(() => { const el = document.getElementById('pos'); el.value = 20; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await m.evaluate(() => +window.__vcz.S.o.pos.toFixed(2)), 0.2);
  await m.evaluate(() => { const el = document.getElementById('pos'); el.value = 78; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await m.evaluate(() => +window.__vcz.S.o.pos.toFixed(2)), 0.78);
  // Click empty timeline: jump.
  const box = await m.locator('.tl-inner').boundingBox();
  await m.mouse.click(box.x + 20, box.y + 10); // on the ruler (the video track starts with its trim handle)
  assert.ok(await m.evaluate(() => window.__vczVideo.currentTime) < 0.5);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('sound effects: add from the menu, auto pop on captions, delete, and the export contains them', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  await m.click('.tl-add');
  assert.ok(await m.locator('.tl-snd').count() >= 12, 'sound list');
  await m.evaluate(() => { window.__vczVideo.currentTime = 2.5; });
  await m.waitForTimeout(200);
  await m.locator('.tl-snd .add', { hasText: 'Boom' }).click();
  assert.equal(await m.locator('.tsfx:not(.auto)').count(), 1);
  assert.equal(await m.evaluate(() => window.__vcz.S.o.sfx[0].id), 'boom');
  await m.selectOption('.tl-auto-sel', 'pop');
  assert.equal(await m.locator('.tsfx.auto').count(), 3, 'one pop per caption');
  // Select and delete the boom, then undo it back.
  await m.locator('.tsfx:not(.auto)').click();
  await m.keyboard.press('Delete');
  assert.equal(await m.locator('.tsfx:not(.auto)').count(), 0);
  await m.click('#undoBtn');
  assert.equal(await m.locator('.tsfx:not(.auto)').count(), 1);
  // Export: the boom at 2.5 s must be louder there than the original audio.
  await m.evaluate(() => { window.__vczExportCodecs = ['vp09.00.40.08']; });
  const dl = m.waitForEvent('download', { timeout: 90000 });
  await m.click('#exportBtn'); await m.waitForSelector('#xDlg[open]');
  await m.check('input[name=xKind][value=video]'); await m.click('#xGo');
  const d = await dl; const file = join(OUT, 'sfx-' + d.suggestedFilename()); await d.saveAs(file);
  const rms = (f, ss) => +execFileSync('sh', ['-c', `ffmpeg -v error -ss ${ss} -t 0.25 -i "${f}" -vn -af "lowpass=f=150,astats=metadata=1:reset=0" -f null - 2>&1; ffmpeg -ss ${ss} -t 0.25 -i "${f}" -vn -af "lowpass=f=150,volumedetect" -f null - 2>&1 | grep -o 'mean_volume: [-0-9.]*' | grep -o '[-0-9.]*$'`]).toString().trim().split('\n').pop();
  const orig = rms(join(FIX, 'portrait.webm'), 2.55), out = rms(file, 2.55);
  assert.ok(out > orig + 10, `boom audible in export: low-band ${orig} dB -> ${out} dB`);
  console.log('   sfx export: low band at 2.55 s', orig, 'dB ->', out, 'dB');
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('phones: timeline sits below the pinned preview and its buttons can be tapped (iPhone SE, Android, iPad)', async () => {
  for (const [w, h] of [[375, 667], [360, 740], [412, 915], [820, 1180]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const m = await ctx.newPage();
    await m.goto(`${BASE}/app.html`);
    await m.click('#startSkip');
    await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
    await m.waitForSelector('#timeline:not([hidden])');
    assert.equal(await m.evaluate(() => !!document.getElementById('timeline').closest('.stage')), false, `${w}x${h}: timeline not inside the pinned preview`);
    await m.locator('.tl-add').scrollIntoViewIfNeeded();
    await m.click('.tl-add');
    assert.equal(await m.isVisible('.tl-menu'), true, `${w}x${h}: sound menu opens`);
    const pinned = await m.evaluate(() => document.querySelector('.stage').getBoundingClientRect().height / innerHeight);
    assert.ok(pinned < 0.68, `${w}x${h}: pinned preview takes ${(pinned * 100).toFixed(0)}% of the screen`);
    assert.equal(await m.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `${w}x${h}: no sideways scroll`);
    await ctx.close();
  }
});

const redPx = (file, ss, crop = '') => +execFileSync('sh', ['-c', `ffmpeg -v error ${ss != null ? `-ss ${ss}` : ''} -i "${file}" -frames:v 1 -vf "${crop ? crop + ',' : ''}format=rgb24" -f rawvideo - | od -An -tu1 -v -w3 | awk '$1>200 && $2<80 && $3<80' | wc -l`]).toString();

await step('manual text: typed by hand, shown all at once, drag to move, on the timeline, burned into the export', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.click('#ltabText');
  await m.click('#txtAdd');
  await m.fill('#txtText', 'SALE 50% OFF\nAaj hi kharido');
  await m.locator('#txtText').blur();
  await m.fill('#txtColor', '#ff0000');
  await m.locator('#txtColor').dispatchEvent('change');
  const L = await m.evaluate(() => window.__vcz.S.o.texts[0]);
  assert.equal(L.text, 'SALE 50% OFF\nAaj hi kharido', 'text kept exactly as typed');
  assert.equal(L.color, '#ff0000');
  assert.equal(await m.locator('.ttx').count(), 1, 'text block on the timeline');
  // One block with both lines, drawn together.
  const b = await m.evaluate(() => window.__vcz.S.textBoxes[0]);
  assert.equal(b.lines.length, 2);
  // Drag it down on the video.
  const r = await m.locator('#stage').boundingBox();
  const cw = await m.evaluate(() => document.getElementById('stage').width);
  const k = r.width / cw;
  const sx = r.x + (b.x0 + b.w / 2) * k, sy = r.y + (b.y0 + b.h / 2) * k;
  await m.mouse.move(sx, sy); await m.mouse.down(); await m.mouse.move(sx, sy + 40, { steps: 5 }); await m.mouse.up();
  const y2 = await m.evaluate(() => window.__vcz.S.o.texts[0].y);
  assert.ok(y2 > L.y + 0.05, `text moved down: ${L.y} -> ${y2}`);
  await m.click('#undoBtn');
  assert.ok(Math.abs(await m.evaluate(() => window.__vcz.S.o.texts[0].y) - L.y) < 0.001, 'undo moves it back');
  // With the text selected, a template goes on the text (captions keep theirs).
  const capTpl = await m.evaluate(() => window.__vcz.S.tplId);
  await pickTpl(m, 'Crazy');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts[0].tpl), 'crazy', 'template applied to the selected text');
  assert.equal(await m.evaluate(() => window.__vcz.S.tplId), capTpl, 'captions keep their template');
  await m.click('#ltabText');   // text props live under the Text tab; picking a style opened the Styles tab
  await m.click('#txtTplClear');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts[0].tpl), null, 'template removed from text');
  // Escape deselects; then a template change styles the captions and keeps the text.
  await m.keyboard.press('Escape');
  assert.equal(await m.evaluate(() => window.__vcz.S.textSel), null, 'deselected');
  await pickTpl(m, 'Classic');
  assert.equal(await m.evaluate(() => window.__vcz.S.tplId), 'classic');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts.length), 1, 'template change keeps text');
  // Put the template back on the text: the export must still show it.
  await m.locator('.ttx').first().click();
  await pickTpl(m, 'Crazy');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts[0].tpl), 'crazy');
  // Export: red text in the frame at 1 s.
  await m.evaluate(() => { window.__vczExportCodecs = ['vp09.00.40.08']; });
  const dl = m.waitForEvent('download', { timeout: 90000 });
  await m.click('#exportBtn'); await m.waitForSelector('#xDlg[open]');
  await m.check('input[name=xKind][value=video]'); await m.click('#xGo');
  const d = await dl; const file = join(OUT, 'text-' + d.suggestedFilename()); await d.saveAs(file);
  // Pixels in the top half that differ strongly from the source video at the same moment = the text.
  const diffPx = ss => +execFileSync('bash', ['-c', `paste -d' ' <(ffmpeg -v error -ss ${ss} -i "${file}" -frames:v 1 -vf "crop=iw:ih*0.5:0:0,format=rgb24" -f rawvideo - | od -An -tu1 -v -w3) <(ffmpeg -v error -ss ${ss} -i "${join(FIX, 'portrait.webm')}" -frames:v 1 -vf "crop=iw:ih*0.5:0:0,format=rgb24" -f rawvideo - | od -An -tu1 -v -w3) | awk '{d=($1-$4)^2+($2-$5)^2+($3-$6)^2; if (d>20000) n++} END {print n+0}'`]).toString();
  const at1 = diffPx(1), at5 = diffPx(5);
  assert.ok(at1 > 300, `text in export at 1 s: ${at1} changed px`);
  assert.ok(at5 < at1 / 10, `text gone after its end time: ${at5} changed px at 5 s`);
  console.log('   text export: changed px at 1 s', at1, '| at 5 s', at5);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('photo: open a JPG, type on it, download it at full size with the text', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.setInputFiles('#startFile', join(FIX, 'photo.jpg'));
  await m.waitForSelector('#editor:not([hidden])');
  assert.equal(await m.evaluate(() => document.body.classList.contains('photo')), true);
  assert.equal(await m.isHidden('#timeline'), true, 'no timeline for a photo');
  assert.equal(await m.isVisible('#txtText'), true, 'text editor opens straight away');
  await m.fill('#txtText', 'Hello India');
  await m.fill('#txtColor', '#ff0000');
  await m.locator('#txtColor').dispatchEvent('change');
  const dl = m.waitForEvent('download', { timeout: 30000 });
  await m.click('#exportBtn');
  const d = await dl; const file = join(OUT, d.suggestedFilename()); await d.saveAs(file);
  assert.match(file, /\.jpg$/);
  const dims = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim();
  assert.equal(dims, '1080,1350', 'full size kept');
  const red = redPx(file, null);
  assert.ok(red > 500, `text on the photo: ${red} red px`);
  console.log('   photo:', file.split('/').pop(), dims, '| red px', red);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('export can be cancelled: Cancel is on screen even on a short laptop window', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 560 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  let downloads = 0; m.on('download', () => downloads++);
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  await m.evaluate(() => { window.__vczExportCodecs = ['vp09.00.40.08']; });
  await m.click('#exportBtn'); await m.waitForSelector('#xDlg[open]');
  await m.click('#xGo');
  await m.waitForSelector('#exportOv:not([hidden])');
  await m.waitForTimeout(800);
  const c = await m.locator('#exportCancel').boundingBox();
  assert.ok(c && c.y >= 0 && c.y + c.height <= 560 && c.x >= 0 && c.x + c.width <= 1280, `Cancel button on screen: ${JSON.stringify(c)}`);
  await m.click('#exportCancel');
  await m.waitForSelector('#exportOv', { state: 'hidden', timeout: 10000 });
  assert.match(await m.textContent('#status'), /cancelled/i);
  await m.waitForTimeout(500);
  assert.equal(downloads, 0, 'nothing downloaded');
  assert.equal(await m.isEnabled('#exportBtn'), true, 'can export again');
  await ctx.close();
});

await step('layout: preview left/middle/right and panel sizes are saved across reloads', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  const x = async sel => (await m.locator(sel).boundingBox()).x;
  // Two-column editor (properties folded into the left tabs): tools | preview, timeline underneath.
  assert.equal(await m.locator('.panel.props').count(), 0, 'no separate right properties panel');
  assert.ok(await x('.panel.tools') < await x('.stage'), 'tools on the left, preview on the right');
  let tl = await m.locator('#timeline').boundingBox(), st = await m.locator('.stage').boundingBox();
  assert.ok(tl.y >= st.y + st.height - 2 && tl.width > 1200, 'timeline runs full width under the preview');
  // Middle layout: timeline across the whole width under the preview.
  await m.click('#layBtn'); await m.click('[data-lay="center"]');
  tl = await m.locator('#timeline').boundingBox(); st = await m.locator('.stage').boundingBox();
  assert.ok(tl.y >= st.y + st.height - 1 && tl.width > 1200, 'timeline runs full width under the preview');
  await m.click('#layBtn'); await m.click('[data-lay="left"]');
  assert.ok(await x('.stage') < await x('.panel.tools'), 'preview moved to the left');
  const h0 = (await m.locator('#timeline').boundingBox()).height;
  const s = await m.locator('#splitT').boundingBox();
  await m.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await m.mouse.down();
  await m.mouse.move(s.x + s.width / 2, s.y - 80, { steps: 5 }); await m.mouse.up();
  const h1 = (await m.locator('#timeline').boundingBox()).height;
  assert.ok(h1 > h0 + 50, `timeline taller: ${h0} -> ${h1}`);
  await m.reload();
  await m.click('#startSkip');
  assert.equal(await m.getAttribute('#editor', 'data-lay'), 'left', 'layout remembered');
  assert.match(await m.evaluate(() => document.getElementById('editor').style.getPropertyValue('--th')), /^\d+px$/);
  assert.notEqual(await m.evaluate(() => document.getElementById('editor').style.getPropertyValue('--th')), '200px', 'timeline size remembered');
  await ctx.close();
});

await step('home dashboard: a project is saved on the device and reopens with its captions, text and style', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  // The URL opens straight on the dashboard — no intro splash to click through.
  assert.equal(await m.isVisible('#startDrop'), true, 'Create project banner shows directly');
  assert.equal(await m.evaluate(() => document.getElementById('intro').hidden), true, 'no CLICK HERE intro gate');
  assert.equal(await m.locator('.proj').count(), 0);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  await m.click('#ltabText'); await m.click('#txtAdd'); await m.fill('#txtText', 'Saved text'); await m.locator('#txtText').blur();
  // Split the first caption at 0.5 s with the timeline button.
  const before = await m.evaluate(() => window.__vcz.S.segments.length);
  await m.evaluate(() => { window.__vczVideo.currentTime = 0.5; });
  await m.waitForTimeout(200);
  await m.click('.tl-acts button[data-act="split"]');
  assert.equal(await m.evaluate(() => window.__vcz.S.segments.length), before + 1, 'Split adds a caption');
  await m.waitForTimeout(1500); // autosave
  await m.click('#homeBtn');
  await m.waitForSelector('.proj');
  assert.equal(await m.locator('.proj').count(), 1);
  assert.match(await m.textContent('.proj-open b'), /portrait/);
  // Reload the page: still there, and it reopens with the edit.
  await m.reload();
  await m.waitForSelector('.proj');
  await m.click('.proj-open');
  await m.waitForSelector('#editor:not([hidden])');
  await m.waitForFunction(() => window.__vcz.S.segments.length > 0);
  assert.equal(await m.evaluate(() => window.__vcz.S.segments.length), before + 1, 'captions restored');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts[0].text), 'Saved text', 'text restored');
  // Delete it.
  await m.click('#homeBtn');
  m.once('dialog', d => d.accept());
  await m.click('.proj-del');
  await m.waitForFunction(() => !document.querySelector('.proj'));
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('long video → shorts: finds the hook moment, crops 9:16, exports only that part (both export paths)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'long16x9.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.setInputFiles('#srtIn', join(FIX, 'long16x9.srt'));
  await m.click('#ltabClips');
  await m.selectOption('#clipLen', '15-30');
  await m.click('#clipFind');
  await m.waitForSelector('.clip-card');
  const best = await m.evaluate(() => window.__vcz.S.o.found[0]);
  assert.equal(best.start, 20, 'best short starts on the hook sentence');
  assert.ok(best.end - best.start >= 15 && best.end - best.start <= 30, `length ${best.end - best.start}`);
  assert.match(best.title, /^Why do 90%/);
  await m.locator('.clip-card').first().locator('button:has-text("Use this short")').click();
  await m.waitForTimeout(400);
  const [cw, ch] = await m.evaluate(() => [document.getElementById('stage').width, document.getElementById('stage').height]);
  assert.ok(Math.abs(cw / ch - 9 / 16) < 0.02, `preview is 9:16: ${cw}x${ch}`);
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts.filter(t => t.hook).length), 1, 'hook title added');
  assert.ok(await m.locator('.clip-card').first().locator('.chip').count() >= 1, 'other hook options offered');
  // Square, then back to 9:16.
  await m.selectOption('#clipAspect', '1:1'); await m.waitForTimeout(300);
  const [sw, sh] = await m.evaluate(() => [document.getElementById('stage').width, document.getElementById('stage').height]);
  assert.equal(sw, sh, 'square preview');
  await m.selectOption('#clipAspect', '9:16');
  // Hook off and on.
  await m.uncheck('#clipHook');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts.filter(t => t.hook).length), 0, 'hook can be turned off');
  await m.check('#clipHook');
  // Move the start a little; undo puts it back.
  await m.fill('#clipStart', '0:20.50'); await m.locator('#clipStart').press('Enter');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.clip.start), 20.5);
  await m.fill('#clipStart', '0:20.00'); await m.locator('#clipStart').press('Enter');
  const exportShort = async label => {
    const dl = m.waitForEvent('download', { timeout: 120000 });
    await m.click('#clipExport'); await m.waitForSelector('#xDlg[open]');
    assert.match(await m.evaluate(() => document.getElementById('xRes').selectedOptions[0].textContent), /1080×1920/);
    await m.click('#xGo');
    const d = await dl; const file = join(OUT, `${label}-${d.suggestedFilename()}`); await d.saveAs(file);
    await m.waitForSelector('#exportOv', { state: 'hidden' });
    const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim();
    const dec = execFileSync('sh', ['-c', `ffmpeg -i "${file}" -f null - 2>&1 | grep -o 'time=[0-9:.]*' | tail -1`]).toString();
    const [, h, mm, sec] = dec.match(/time=(\d+):(\d+):([\d.]+)/);
    const dur = +h * 3600 + +mm * 60 + +sec;
    const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]).toString();
    console.log(`   ${label}:`, file.split('/').pop(), dims, dur.toFixed(2), 's', streams.trim().replace(/\n/g, '+'));
    return { dims, dur, streams };
  };
  await m.evaluate(() => { window.__vczExportCodecs = ['vp09.00.40.08']; });
  const a = await exportShort('wc');
  assert.equal(a.dims, '1080,1920');
  assert.ok(Math.abs(a.dur - (best.end - best.start)) < 1, `WebCodecs short is ${a.dur}s`);
  assert.match(a.streams, /audio/);
  await m.evaluate(() => { delete window.__vczExportCodecs; window.__vczNoWebCodecs = true; });
  const b = await exportShort('mr');
  assert.ok(Math.abs(b.dur - (best.end - best.start)) < 1.5, `MediaRecorder short is ${b.dur}s`);
  await m.evaluate(() => { delete window.__vczNoWebCodecs; });
  // Back to the full video.
  await m.click('#clipExit');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.clip), null);
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts.filter(t => t.hook).length), 0, 'hook removed');
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('fast export (decode → draw → encode, no real-time playback): every frame, sound kept, short trimmed, cancel works', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.addInitScript(() => { window.__vczFastCodecs = ['vp9']; }); // this Chromium has no H.264 encoder
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  const dl = m.waitForEvent('download', { timeout: 120000 });
  await m.click('#exportBtn'); await m.waitForSelector('#xDlg[open]');
  await m.check('input[name=xKind][value=video]'); await m.selectOption('#xRes', '0'); await m.click('#xGo');
  const d = await dl; const file = join(OUT, 'fast-' + d.suggestedFilename()); await d.saveAs(file);
  assert.equal(await m.evaluate(() => window.__vczLastExport), 'fast');
  const frames = +execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]).toString().trim();
  const src = +execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', join(FIX, 'portrait.webm')]).toString().trim();
  assert.ok(frames >= src - 2, `every frame: ${frames} of ${src}`);
  const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', file]).toString();
  assert.match(streams, /video,540,960/); assert.match(streams, /audio/);
  const vol = execFileSync('sh', ['-c', `ffmpeg -i "${file}" -vn -af volumedetect -f null - 2>&1 | grep -o 'mean_volume: [-0-9.]*'`]).toString();
  assert.ok(+vol.split(':')[1] > -35, `sound kept: ${vol}`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1.2', '-i', file, '-frames:v', '1', join(OUT, 'fast-frame.png')]);
  console.log('   fast export:', frames, 'of', src, 'frames |', streams.trim().replace(/\n/g, ' / '), '|', vol.trim(), '|', await m.textContent('#status'));
  // Cancel in the middle.
  await m.click('#exportBtn'); await m.waitForSelector('#xDlg[open]'); await m.click('#xGo');
  await m.waitForSelector('#exportOv:not([hidden])');
  await m.waitForTimeout(700);
  await m.click('#exportCancel');
  await m.waitForSelector('#exportOv', { state: 'hidden', timeout: 15000 });
  assert.match(await m.textContent('#status'), /cancelled/i);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('one word in its own colour (captions and typed text), one-line captions, trending styles, big preview', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  // Trending filter.
  await m.click('#ltabTpl');
  await m.locator('#tabs .tab', { hasText: 'Trending' }).click();
  const shown = await m.$$eval('#grid .tpl', els => els.filter(e => e.style.display !== 'none').map(e => e.title));
  assert.ok(shown.includes('Emoji Pop') && shown.includes('Green Box') && shown.length >= 8, `trending: ${shown}`);
  // Caption word colour.
  await m.locator('.tw').nth(1).click();
  assert.equal(await m.isVisible('#wordGroup'), true);
  await m.fill('#wordColor', '#ff0000'); await m.locator('#wordColor').dispatchEvent('change');
  assert.equal(await m.evaluate(() => window.__vcz.S.segments[0].words[1].color), '#ff0000');
  await m.click('#undoBtn');
  assert.equal(await m.evaluate(() => window.__vcz.S.segments[0].words[1].color), undefined, 'undo');
  await m.click('#redoBtn');
  // One line.
  await m.click('#linesCtl button[data-v="one"]');
  assert.equal(await m.evaluate(() => window.__vcz.tpl().oneLine), true);
  // Typed text: colour one word.
  await m.click('#ltabText'); await m.click('#txtAdd'); await m.fill('#txtText', 'SALE 50% OFF today'); await m.locator('#txtText').blur();
  await m.locator('#txtChips .chip', { hasText: 'OFF' }).click();
  await m.fill('#txtWordColor', '#00ff00'); await m.locator('#txtWordColor').dispatchEvent('change');
  assert.deepEqual(await m.evaluate(() => window.__vcz.S.o.texts[0].wordColors), { 2: '#00ff00' });
  // Big preview hides the side panels and makes the preview larger; remembered.
  const before = (await m.locator('#box').boundingBox()).width;
  await m.click('#bigBtn');
  await m.waitForTimeout(200);
  assert.equal(await m.isVisible('.panel.tools'), false);
  assert.ok((await m.locator('#box').boundingBox()).width > before + 300, 'preview wider');
  await m.reload(); await m.click('#startSkip');
  assert.equal(await m.evaluate(() => document.getElementById('editor').classList.contains('big')), true, 'big view remembered');
  await m.click('#bigBtn');
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('pick a style first, then type: photo text and video text take the chosen style', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.setInputFiles('#startFile', join(FIX, 'photo.jpg'));
  await m.waitForSelector('#editor:not([hidden])');
  // The photo opens with one text. Deselect it, then pick a style: it still goes on the text.
  await m.keyboard.press('Escape');
  await pickTpl(m, 'Crazy');
  assert.deepEqual(await m.evaluate(() => window.__vcz.S.o.texts.map(t => t.tpl)), ['crazy'], 'style goes on the photo text');
  // Remove all text, pick a style first: a new text appears in that style, ready to type.
  await m.evaluate(() => { window.__vcz.S.o.texts = []; });
  await pickTpl(m, 'Discipline');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts.length), 1, 'a text was added');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts[0].tpl), 'discipline');
  assert.equal(await m.evaluate(() => document.activeElement.id), 'txtText', 'ready to type');
  await m.keyboard.type('hello gugs we are going home');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts[0].text), 'hello gugs we are going home');
  // A video without captions: from the Text tool, the style is for text; otherwise for captions.
  await m.click('#logoLink');
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await pickTpl(m, 'Green Box');
  assert.equal(await m.evaluate(() => window.__vcz.S.tplId), 'green-box', 'no text yet: style is for captions');
  await m.click('#ltabText');
  await pickTpl(m, 'Beast Bold');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts.length), 1);
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts[0].tpl), 'beast-bold', 'from the Text tool: style is for text');
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('media library: import several files at once, click one to open it, each keeps its own edits', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', [join(FIX, 'portrait.webm'), join(FIX, 'landscape.webm'), join(FIX, 'photo.jpg')]);
  await m.waitForFunction(() => document.querySelectorAll('#mediaBin .media-item').length === 3, null, { timeout: 20000 });
  assert.match(await m.evaluate(() => window.__vcz.S.file.name), /portrait/);
  await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  await m.waitForTimeout(1500);
  // Open the landscape one: the preview switches, and it has no captions of its own.
  await m.click('#ltabMedia');
  await m.locator('#mediaBin .media-item', { hasText: 'landscape' }).click();
  await m.waitForFunction(() => window.__vcz.S.file && /landscape/.test(window.__vcz.S.file.name));
  assert.equal(await m.evaluate(() => window.__vcz.S.segments.length), 0);
  assert.deepEqual(await m.evaluate(() => [document.getElementById('stage').width, document.getElementById('stage').height]), [960, 540]);
  // Back to the portrait one: its captions are still there.
  await m.click('#ltabMedia');
  await m.locator('#mediaBin .media-item', { hasText: 'portrait' }).click();
  await m.waitForFunction(() => window.__vcz.S.file && /portrait/.test(window.__vcz.S.file.name) && window.__vcz.S.segments.length > 0, null, { timeout: 10000 });
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('thumbnail maker: photo → layout → editable text → download at the chosen size; frame from a video', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  // A frame of the video becomes the thumbnail photo.
  await m.click('#ltabThumb');
  await m.click('#thumbFromFrame');
  await m.waitForFunction(() => window.__vcz.S.image && window.__vcz.S.o.frame, null, { timeout: 10000 });
  await m.selectOption('#thumbSize', 'yt');
  assert.deepEqual(await m.evaluate(() => [document.getElementById('stage').width, document.getElementById('stage').height]), [1280, 720]);
  await m.locator('#thumbGrid .thumb-tile', { hasText: 'Big Bold' }).click();
  assert.equal(await m.evaluate(() => window.__vcz.S.o.overlay.type), 'shade-bottom');
  assert.match(await m.evaluate(() => window.__vcz.S.o.texts[0].text), /BELIEVE/);
  // Its text is a normal text: edit it, one line.
  await m.fill('#txtText', 'MY OWN TITLE');
  await m.click('#txtOneLine');
  assert.deepEqual(await m.evaluate(() => [window.__vcz.S.o.texts[0].text, window.__vcz.S.o.texts[0].oneLine]), ['MY OWN TITLE', true]);
  await m.click('#ltabThumb');
  const dl = m.waitForEvent('download', { timeout: 30000 });
  await m.click('#thumbExport');
  const d = await dl; const file = join(OUT, `thumb-${d.suggestedFilename()}`); await d.saveAs(file);
  assert.match(d.suggestedFilename(), /thumbnail\.jpg$/);
  const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim();
  assert.equal(dims, '1280,720');
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('templates break apart into separate texts, each with its own animation; captions and text side by side', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'landscape.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  // Text tool offers auto captions too.
  await m.click('#ltabText');
  assert.equal(await m.isVisible('#txtMakeCaps'), true, 'auto captions offered in Text');
  await m.click('#txtAdd');
  await m.fill('#txtText', 'hello dada kem chhooo');
  await pickTpl(m, 'Red Wipe');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts[0].tpl), 'red-wipe');
  // The switch sends the next style to the captions instead.
  await m.click('#styleFor button[data-v="cap"]');
  await pickTpl(m, 'Spark');
  assert.equal(await m.evaluate(() => window.__vcz.S.tplId), 'spark', 'style went to captions');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts[0].tpl), 'red-wipe', 'text kept its style');
  await m.click('#styleFor button[data-v="text"]');
  // Break apart: two plain texts, one per line.
  await m.click('#ltabText');
  await m.locator('#txtList .txt-item').first().click();
  await m.click('#txtBreak');
  const parts = await m.evaluate(() => window.__vcz.S.o.texts.map(t => [t.text, t.tpl, t.bgOp]));
  assert.deepEqual(parts, [['Hello Dada', null, 0], ['kem chhooo', null, 100]]);
  // Give the second its own animation; the first keeps another.
  await m.locator('#txtList .txt-item').nth(1).click();
  await m.selectOption('#txtAnim', 'type');
  const anims = await m.evaluate(() => window.__vcz.S.o.texts.map(t => t.anim));
  assert.equal(anims[1], 'type'); assert.notEqual(anims[0], 'type');
  // Typewriter shows part of the text early on, all of it later (drawn without errors either way).
  await m.evaluate(async () => { const v = window.__vcz.video; v.currentTime = 0.2; await new Promise(r => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 3000); }); });
  await m.waitForTimeout(200);
  await m.evaluate(async () => { const v = window.__vcz.video; v.currentTime = 2.5; await new Promise(r => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 3000); }); });
  await m.waitForTimeout(200);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('long video → ~30 s shorts: Export all saves every short', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  await m.addInitScript(() => { window.__vczFastCodecs = ['vp9']; });
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  m.on('dialog', d => d.accept());
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'long16x9.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.setInputFiles('#srtIn', join(FIX, 'long16x9.srt'));
  await m.click('#ltabClips');
  await m.selectOption('#clipLen', '15-30');
  await m.selectOption('#clipCount', '3');
  await m.click('#clipFind');
  await m.waitForSelector('.clip-card');
  const n = await m.evaluate(() => window.__vcz.S.o.found.length);
  assert.ok(n >= 2, `found ${n} shorts`);
  assert.equal(await m.isVisible('#clipAll'), true);
  const names = [];
  m.on('download', d => names.push(d.suggestedFilename()));
  await m.click('#clipAll');
  await m.waitForFunction(k => !window.__vcz.S.exporting && /Exported \d+ shorts/.test(document.getElementById('status').textContent), n, { timeout: 240000 });
  await m.waitForTimeout(500);
  assert.equal(names.length, n, `downloads: ${names.join(', ')}`);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('design studio: separate home, template opens a sized design, stickers, replace photo keeps the text', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/design.html`);
  assert.equal(await m.locator('.ds-tpl').count(), 10);
  await m.waitForFunction(() => document.querySelectorAll('#pro a').length === 2, null, { timeout: 10000 });
  assert.match(await m.textContent('#pro'), /PhotoCraft.*MIT/);
  await m.click('#tabs button:has-text("Pinterest pin")');
  await m.locator('.ds-tpl', { hasText: 'Money' }).click();
  await m.waitForFunction(() => window.__vcz && window.__vcz.S.image && window.__vcz.S.o.texts.length === 2, null, { timeout: 15000 });
  assert.equal(await m.evaluate(() => window.__vcz.S.o.frame.id), 'pin');
  const [pw, ph] = await m.evaluate(() => [document.getElementById('stage').width, document.getElementById('stage').height]);
  assert.ok(Math.abs(pw / ph - 1000 / 1500) < 0.01, `preview is 2:3: ${pw}x${ph}`);
  assert.equal(await m.isVisible('#tabCaptions'), false, 'video-only tools hidden in a design');
  assert.equal(await m.textContent('#exportBtn'), 'Download design');
  await m.click('#ltabThumb');
  await m.locator('.st-btn', { hasText: '🔥' }).click();
  await m.locator('.el-btn', { hasText: 'Badge' }).click();
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts.length), 4);
  await m.click('#ltabThumb');
  await m.setInputFiles('#thumbReplaceIn', join(FIX, 'photo.jpg'));
  await m.waitForFunction(() => /photo/.test(window.__vcz.S.file.name));
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts.length), 4, 'texts kept after replacing the photo');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.frame.id), 'pin');
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('captions panel has the caption style: style strip, font, size, colours', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  await m.click('#tabCaptions');
  assert.equal(await m.isVisible('#capStyle'), true);
  await m.locator('.cap-tpl', { hasText: 'Spark' }).click();
  await m.selectOption('#capFont', 'Bangers');
  await m.selectOption('#capCase', 'upper');
  assert.deepEqual(await m.evaluate(() => [window.__vcz.S.tplId, window.__vcz.S.o.font, window.__vcz.S.o.case, window.__vcz.tpl().font]), ['spark', 'Bangers', 'upper', 'Bangers']);
  assert.equal(await m.inputValue('#fontSel'), 'Bangers', 'the Caption style tab shows the same font');
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('caption animation: pick another entry, or turn all animation off (captions show fully at their first frame)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  await m.click('#tabCaptions');
  await m.locator('.cap-tpl', { hasText: 'Spark' }).click();
  // Ink drawn at the very first moment of a caption, with the current style.
  const ink = () => m.evaluate(async () => {
    const { drawCaption, buildChunks, spreadWords } = await import('./js/renderer.js');
    const c = document.createElement('canvas'); c.width = 540; c.height = 960;
    const x = c.getContext('2d');
    const chunk = buildChunks(spreadWords('this is how your reels go viral', 1, 3), 3, 32)[0];
    drawCaption(x, 540, 960, chunk, chunk.start, window.__vcz.tpl());
    const d = x.getImageData(0, 0, 540, 960).data; let n = 0;
    for (let i = 3; i < d.length; i += 4) n += d[i] > 128;
    return n;
  });
  assert.equal(await ink(), 0, 'Spark pops in: nothing at its first frame');
  await m.selectOption('#capAnim', 'slide-right');
  assert.equal(await m.evaluate(() => window.__vcz.tpl().anim), 'slide-right');
  await m.evaluate(() => { const d = document.getElementById('advStyle'); if (d) d.open = true; });
  await m.click('#animOff');
  assert.deepEqual(await m.evaluate(() => { const t = window.__vcz.tpl(); return [t.anim, t.reveal, t.hi]; }), ['none', 'none', 'none']);
  assert.ok(await ink() > 200, 'no animation: the caption is fully there at once');
  assert.equal(await m.inputValue('#capAnim'), 'none', 'the Captions panel shows it too');
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('YouTube growth planner: link check, 30 ideas, script, calendar, thumbnail opens a design with the text', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.route('**/api/yt?*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'dQw4w9WgXcQ', title: 'MY VLOG #vlog', channel: 'Test', thumbnail: '' }) }));
  await m.route('https://i.ytimg.com/**', r => r.fulfill({ status: 404, body: '' }));
  await m.goto(`${BASE}/grow.html`);
  await m.fill('#url', 'https://youtu.be/dQw4w9WgXcQ');
  await m.selectOption('#niche', 'finance');
  await m.fill('#topic', 'SIP for students');
  await m.click('#go');
  await m.waitForSelector('#out:not([hidden])');
  assert.match(await m.textContent('section[data-id="link"]'), /Hashtags in the title/);
  await m.click('#tabs button[data-id="ideas"]');
  assert.equal(await m.locator('section[data-id="ideas"] .gr-card').count(), 30);
  assert.match(await m.textContent('section[data-id="ideas"] .gr-card >> nth=0'), /SIP for students/i);
  await m.locator('[data-script="2"]').click();
  assert.match(await m.inputValue('#desc'), /Chapters\n0:00 Cold open/);
  await m.click('#tabs button[data-id="calendar"]');
  assert.equal(await m.locator('.gr-day').count(), 30);
  await m.click('#tabs button[data-id="money"]');
  assert.match(await m.textContent('section[data-id="money"]'), /No one can promise monetization in 10 days/);
  await m.click('#tabs button[data-id="ideas"]');
  await m.locator('section[data-id="ideas"] a:has-text("Thumbnail")').first().click();
  await m.waitForFunction(() => window.__vcz && window.__vcz.S.image && window.__vcz.S.o.texts.length, null, { timeout: 15000 });
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts[0].text), '30 DAYS LATER');
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('series: PART labels in story order, numbered downloads, a caption for every part', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  await m.addInitScript(() => { window.__vczFastCodecs = ['vp9']; });
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  m.on('dialog', d => d.accept());
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'long16x9.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.setInputFiles('#srtIn', join(FIX, 'long16x9.srt'));
  await m.click('#ltabClips');
  await m.selectOption('#clipLen', '15-30');
  await m.selectOption('#clipCount', '3');
  await m.click('#clipFind');
  await m.waitForSelector('.clip-card');
  const n = await m.evaluate(() => window.__vcz.S.o.found.length);
  await m.check('#seriesOn');
  await m.fill('#seriesName', 'Money Tips'); await m.locator('#seriesName').press('Tab');
  await m.locator('.clip-card').first().locator('button:has-text("Use this short")').click();
  const label = await m.evaluate(() => window.__vcz.S.o.texts.find(t => t.part).text);
  assert.match(label, new RegExp(`^MONEY TIPS · PART \\d/${n}$`));
  await m.click('#seriesCaps');
  const caps = await m.inputValue('#seriesOut');
  assert.equal((caps.match(/— Part \d —/g) || []).length, n);
  assert.match(caps, /Part 2 is next/);
  const names = [];
  m.on('download', d => names.push(d.suggestedFilename()));
  await m.click('#clipAll');
  await m.waitForFunction(() => !window.__vcz.S.exporting && /Exported \d+ shorts/.test(document.getElementById('status').textContent), null, { timeout: 240000 });
  await m.waitForTimeout(500);
  assert.deepEqual(names.map(x => x.match(/part-(\d+)/)[1]), Array.from({ length: n }, (_, k) => String(k + 1)), names.join(', '));
  const starts = await m.evaluate(() => window.__vcz.S.o.found.map(f => f.start));
  assert.ok(starts.length === n);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('Long video → Shorts offers upload or a YouTube link (details, how to get the file, growth plan)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.route('**/api/yt?*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'dQw4w9WgXcQ', title: 'my goa vlog #vlog', channel: 'Me', thumbnail: '' }) }));
  await m.route('https://i.ytimg.com/**', r => r.fulfill({ status: 404, body: '' }));
  await m.goto(`${BASE}/app.html`);
  await m.click('#cardClips');
  await m.waitForSelector('#lsDlg[open]');
  assert.equal(await m.isVisible('.ls-up'), true, 'upload option');
  await m.fill('#lsUrl', 'https://youtu.be/dQw4w9WgXcQ');
  await m.click('#lsCheck');
  await m.waitForSelector('.ls-card');
  assert.match(await m.textContent('#lsOut'), /my goa vlog/);
  assert.match(await m.textContent('#lsOut'), /YouTube Studio/);
  assert.equal(await m.getAttribute('.ls-studio', 'href'), 'https://studio.youtube.com/video/dQw4w9WgXcQ/edit');
  assert.match(await m.getAttribute('#lsOut a[href^="grow"]', 'href'), /grow\.html\?url=/);
  await m.locator('#lsOut label.btn').click({ trial: true });
  await m.evaluate(() => document.getElementById('lsDlg').close());
  await m.setInputFiles('#startFile', join(FIX, 'long16x9.webm'));
  await m.waitForFunction(() => window.__vcz.S.file && /long16x9/.test(window.__vcz.S.file.name), null, { timeout: 15000 });
  assert.equal(await m.evaluate(() => window.__vcz.S.wantClips), true, 'opens Clips once captions are made');
  await m.goto(`${BASE}/grow.html?url=${encodeURIComponent('https://youtu.be/dQw4w9WgXcQ')}`);
  await m.waitForSelector('#out:not([hidden])');
  assert.match(await m.textContent('section[data-id="link"]'), /my goa vlog/);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('reels from ALL videos in Media: every video’s best moments exported, numbered per video', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  await m.addInitScript(() => { window.__vczFastCodecs = ['vp9']; });
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  m.on('dialog', d => d.accept());
  const vid = await readFile(join(FIX, 'long16x9.webm'));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', [{ name: 'vlog-a.webm', mimeType: 'video/webm', buffer: vid }, { name: 'vlog-b.webm', mimeType: 'video/webm', buffer: vid }]);
  await m.waitForFunction(() => document.querySelectorAll('#mediaBin .media-item').length === 2, null, { timeout: 20000 });
  // Captions for both (as if made earlier): the queue reuses them.
  for (const name of ['vlog-a', 'vlog-b']) {
    if (!(await m.evaluate(n => window.__vcz.S.file.name.startsWith(n), name))) {
      await m.click('#ltabMedia'); await m.locator('#mediaBin .media-item', { hasText: name }).click();
      await m.waitForFunction(n => window.__vcz.S.file.name.startsWith(n), name);
    }
    await m.setInputFiles('#srtIn', join(FIX, 'long16x9.srt'));
    await m.waitForFunction(() => window.__vcz.S.segments.length > 0);
    await m.waitForTimeout(800);
  }
  await m.click('#ltabClips');
  await m.selectOption('#clipLen', '15-30');
  await m.selectOption('#clipCount', '3');
  const names = [];
  m.on('download', d => names.push(d.suggestedFilename()));
  await m.click('#clipAllVideos');
  await m.waitForFunction(() => /^Done: \d+ reels/.test(document.getElementById('clipNote').textContent), null, { timeout: 480000 });
  const note = await m.textContent('#clipNote');
  const n = +note.match(/Done: (\d+)/)[1];
  await m.waitForTimeout(500);
  assert.ok(n >= 4, note);
  assert.equal(names.length, n, names.join(', '));
  assert.ok(names.some(x => /^vlog-a-part-1/.test(x)) && names.some(x => /^vlog-b-part-1/.test(x)), names.join(', '));
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('text templates: after styling captions from the Captions panel, a style picked with a text selected goes on the text', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  await m.click('#tabCaptions'); await m.locator('.cap-tpl', { hasText: 'Spark' }).click();
  await m.click('#ltabText'); await m.click('#txtAdd'); await m.fill('#txtText', 'hello dada');
  await pickTpl(m, 'Red Wipe');
  assert.deepEqual(await m.evaluate(() => [window.__vcz.S.o.texts[0].tpl, window.__vcz.S.tplId]), ['red-wipe', 'spark']);
  // The switch still sends styles to the captions on purpose.
  await m.click('#styleFor button[data-v="cap"]');
  await pickTpl(m, 'Crazy');
  assert.deepEqual(await m.evaluate(() => [window.__vcz.S.o.texts[0].tpl, window.__vcz.S.tplId]), ['red-wipe', 'crazy']);
  // Selecting the text again: styles go on it.
  await m.click('#ltabText'); await m.locator('#txtList .txt-item').first().click();
  await pickTpl(m, 'Discipline');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts[0].tpl), 'discipline');
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('template text stays editable: font, colour, bold, outline and box change the drawn text (like CapCut)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.setInputFiles('#startFile', join(FIX, 'photo.jpg'));
  await m.waitForSelector('#editor:not([hidden])');
  await m.fill('#txtText', 'hello dada');
  await pickTpl(m, 'Red Wipe');
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts[0].tpl), 'red-wipe');
  assert.equal(await m.isEnabled('#txtFont'), true);
  assert.equal(await m.inputValue('#txtFont'), 'Montserrat', 'controls show the template font');
  // Count bright-green pixels on the preview: none before, many after colouring the text green.
  const green = () => m.evaluate(() => { const c = document.getElementById('stage'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 60 && d[i + 1] > 200 && d[i + 2] < 60) n++; return n; });
  const before = await green();
  await m.click('#ltabText'); await m.locator('#txtList .txt-item').first().click();
  await m.evaluate(() => { const el = document.getElementById('txtColor'); el.value = '#00ff00'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await m.selectOption('#txtFont', 'Bangers');
  await m.waitForTimeout(400);
  const after = await green();
  assert.ok(after > before + 300, `green pixels ${before} → ${after}`);
  assert.deepEqual(await m.evaluate(() => window.__vcz.S.o.texts[0].ov), { color: true, font: true });
  assert.equal(await m.evaluate(() => window.__vcz.S.o.texts[0].tpl), 'red-wipe', 'still the template');
  // Picking another template starts from its look again.
  await pickTpl(m, 'Crazy');
  assert.deepEqual(await m.evaluate(() => window.__vcz.S.o.texts[0].ov), {});
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('CapCut-style timeline: text lanes, video filmstrip, trim the video and the export follows', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  await m.addInitScript(() => { window.__vczFastCodecs = ['vp9']; });
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  assert.equal(await m.isVisible('.ttx-add'), true, 'empty text track offers + Add text');
  await m.click('#ltabText'); await m.click('#txtAdd'); await m.fill('#txtText', 'one');
  await m.click('#txtAdd'); await m.fill('#txtText', 'two');
  const tops = await m.evaluate(() => [...document.querySelectorAll('.ttx')].map(b => b.style.top));
  assert.equal(new Set(tops).size, 2, `overlapping texts on separate lanes: ${tops}`);
  await m.waitForFunction(() => { const c = document.querySelector('.tl-film'); if (!c || c.width < 2) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 40) if (d[i] + d[i + 1] + d[i + 2] > 200) n++; return n > 50; }, null, { timeout: 15000 });
  // Trim from the right handle: drag it left by a third of the track.
  const film = await m.locator('.tl-film').boundingBox();
  const hr = await m.locator('.tv-h.r').boundingBox();
  await m.mouse.move(hr.x + 5, hr.y + 10); await m.mouse.down();
  await m.mouse.move(hr.x + 5 - film.width / 3, hr.y + 10, { steps: 5 }); await m.mouse.up();
  const trim = await m.evaluate(() => window.__vcz.S.o.trim);
  assert.ok(trim && trim.start === 0 && trim.end > 3 && trim.end < 4.6, JSON.stringify(trim));
  const dl = m.waitForEvent('download', { timeout: 120000 });
  await m.click('#exportBtn'); await m.waitForSelector('#xDlg[open]'); await m.click('#xGo');
  const d = await dl; const file = join(OUT, `trim-${d.suggestedFilename()}`); await d.saveAs(file);
  const dec = execFileSync('sh', ['-c', `ffmpeg -i "${file}" -f null - 2>&1 | grep -o 'time=[0-9:.]*' | tail -1`]).toString();
  const [, , mm, sec] = dec.match(/time=(\d+):(\d+):([\d.]+)/);
  const dur = +mm * 60 + +sec;
  assert.ok(Math.abs(dur - trim.end) < 0.6, `export ${dur}s for trim ${trim.end}s`);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('animation off means nothing moves in any style; empty captions track offers Auto captions; umm/uh removal', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  assert.equal(await m.isVisible('.tc-add'), true, 'Auto captions on the empty captions track');
  await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  await m.waitForFunction(() => window.__vcz.S.segments.length > 0);
  assert.equal(await m.locator('.tc-add').count(), 0);
  assert.ok(await m.locator('.tc').count() > 0, 'captions on the timeline');
  await m.click('#tabStyle'); await m.click('#animOff');
  const moving = await m.evaluate(async () => {
    const { drawCaption, buildChunks, spreadWords } = await import('./js/renderer.js');
    const { TEMPLATES } = await import('./js/templates.js');
    const S = window.__vcz.S, out = [];
    for (const t0 of TEMPLATES) {
      if (t0.none) continue;
      S.tplId = t0.id;
      const tp = window.__vcz.tpl();
      const snap = t => { const c = document.createElement('canvas'); c.width = 270; c.height = 480; const x = c.getContext('2d'); const ch = buildChunks(spreadWords('this is how your reels go viral today', 1, 4), tp.words || 3, 40)[0]; drawCaption(x, 270, 480, ch, ch.start + t, tp); return x.getImageData(0, 0, 270, 480).data; };
      const a = snap(0);
      for (const t of [0.15, 0.4, 0.9, 1.6]) { const d = snap(t); let n = 0; for (let i = 3; i < d.length; i += 4) if (Math.abs(d[i] - a[i]) > 60) n++; if (n > 30) { out.push(`${t0.id}@${t}:${n}`); break; } }
    }
    return out;
  });
  assert.deepEqual(moving, [], 'styles still moving with animation off');
  // Picking an animation turns it back on.
  await m.selectOption('#animSel', 'pop');
  assert.equal(await m.evaluate(() => !!window.__vcz.tpl().still), false);
  // Filler words.
  await m.evaluate(() => { const S = window.__vcz.S; window.__vcz.setSegments([{ start: 0, end: 2, words: [{ text: 'umm', start: 0, end: 0.3 }, { text: 'hello', start: 0.4, end: 0.8 }, { text: 'uh', start: 0.9, end: 1.1 }, { text: 'friends', start: 1.2, end: 1.8 }] }]); });
  await m.click('#tabCaptions'); await m.click('#cleanFillers');
  assert.deepEqual(await m.evaluate(() => window.__vcz.S.segments[0].words.map(w => w.text)), ['hello', 'friends']);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('paused on a caption’s first frame: the caption shows fully and style changes show at once; whole video fits the timeline', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'long16x9.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.setInputFiles('#srtIn', join(FIX, 'long16x9.srt'));
  await m.waitForFunction(() => window.__vcz.S.segments.length > 0);
  await m.waitForTimeout(400);
  const visible = await m.evaluate(() => { const s = document.querySelector('.tl-scroll').getBoundingClientRect(); return [...document.querySelectorAll('.tc')].every(e => { const r = e.getBoundingClientRect(); return r.left >= s.left - 1 && r.right <= s.right + 1; }); });
  assert.equal(visible, true, 'every caption is in view without scrolling');
  // Jump exactly to a caption's start (what clicking a caption does), paused.
  await m.evaluate(async () => { const { S, video } = window.__vcz; video.currentTime = S.segments[3].start; await new Promise(r => video.addEventListener('seeked', r, { once: true })); });
  await m.waitForTimeout(300);
  const white = () => m.evaluate(() => { const c = document.getElementById('stage'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) n++; return n; });
  const a = await white();
  assert.ok(a > 500, `caption visible while paused at its start: ${a}`);
  await m.click('#tabCaptions');
  await m.evaluate(() => { const d = document.getElementById('advStyle'); if (d) d.open = true; const el = document.getElementById('size'); el.value = 170; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await m.waitForTimeout(300);
  const b = await white();
  assert.ok(b > a * 1.5, `bigger size shows at once: ${a} → ${b}`);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('cut silences: pauses found from the sound, skipped in preview, left out of the export; Auto edit', async () => {
  // 6 s video: tone 0–2 s, silence 2–4 s, tone 4–6 s.
  const src = join(OUT, 'pause.webm');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30', '-f', 'lavfi', '-i', "aevalsrc='if(between(t,2,4),0,0.5*sin(2*PI*440*t))':s=48000:d=6", '-t', '6', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', src]);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  await m.addInitScript(() => { window.__vczFastCodecs = ['vp9']; });
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  m.on('dialog', d => d.accept());
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', src);
  await m.waitForSelector('#timeline:not([hidden])');
  await m.waitForFunction(() => window.__vcz.S.wave, null, { timeout: 20000 });
  await m.click('.tl-acts [data-act="silence"]');
  const cuts = await m.evaluate(() => window.__vcz.S.o.cuts);
  assert.equal(cuts.length, 1, JSON.stringify(cuts));
  assert.ok(Math.abs(cuts[0].start - 2.15) < 0.1 && Math.abs(cuts[0].end - 3.85) < 0.1, JSON.stringify(cuts));
  assert.equal(await m.locator('.tv-cut').count(), 1, 'cut shown on the video track');
  // Preview: playing into the cut jumps over it.
  await m.evaluate(async () => { const v = window.__vcz.video; v.currentTime = 1.8; await new Promise(r => v.addEventListener('seeked', r, { once: true })); v.muted = true; await v.play(); });
  await m.waitForTimeout(900);
  const t = await m.evaluate(() => { const v = window.__vcz.video; v.pause(); return v.currentTime; });
  assert.ok(t > 3.85, `preview skipped the pause: at ${t}`);
  // Export: 6 s − 1.7 s.
  const dl = m.waitForEvent('download', { timeout: 120000 });
  await m.click('#exportBtn'); await m.waitForSelector('#xDlg[open]'); await m.click('#xGo');
  const d = await dl; const file = join(OUT, `cut-${d.suggestedFilename()}`); await d.saveAs(file);
  assert.equal(await m.evaluate(() => window.__vczLastExport), 'cuts');
  const dur = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString();
  assert.ok(Math.abs(dur - 4.3) < 0.25, `exported ${dur}s`);
  const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]).toString();
  assert.match(streams, /audio/);
  const vol = execFileSync('sh', ['-c', `ffmpeg -i "${file}" -af volumedetect -vn -f null - 2>&1 | grep -o 'mean_volume: [-0-9.]*'`]).toString();
  assert.ok(+vol.split(':')[1] > -20, `the silence is gone, so the sound is loud throughout: ${vol}`);
  console.log('   cut export:', dur.toFixed(2), 's,', vol.trim());
  // Click the cut: the pause is back. Auto edit cuts it again.
  await m.locator('.tv-cut').click();
  assert.equal(await m.evaluate(() => (window.__vcz.S.o.cuts || []).length), 0);
  await m.click('.tl-acts [data-act="auto"]');
  assert.equal(await m.evaluate(() => (window.__vcz.S.o.cuts || []).length), 1);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('AI edit (Claude): button only when switched on; the plan cuts, hooks, highlights and picks Shorts', async () => {
  const src = join(OUT, 'pause.webm'); // made by the cut-silences step
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  let sent = null;
  await m.route('**/api/ai-edit', async r => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { enabled: true, engine: 'groq' } });
    sent = r.request().postDataJSON();
    return r.fulfill({ json: { cuts: [{ start: 2, end: 4, reason: 'bad take' }], hook: 'Ye galti mat karna', highlights: ['paisa'], shorts: [{ start: 0, end: 6, title: 'Paisa bachao' }], title: 'Paisa kaise bachaye', description: 'Simple tips.' } });
  });
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', src);
  await m.waitForSelector('#timeline:not([hidden])');
  await m.waitForSelector('.tl-acts [data-act="claude"]:not([hidden])');
  await m.click('.tl-acts [data-act="claude"]');
  assert.equal(sent, null, 'no captions yet, so nothing is sent');
  await m.evaluate(() => window.__vcz.setSegments([
    { start: 0, end: 1.8, words: [{ text: 'Paisa', start: 0, end: 0.5 }, { text: 'bachana', start: 0.6, end: 1.2 }, { text: 'hai', start: 1.3, end: 1.8 }] },
    { start: 2, end: 3.8, words: [{ text: 'galat', start: 2, end: 2.6 }, { text: 'take', start: 2.7, end: 3.8 }] },
    { start: 4, end: 5.8, words: [{ text: 'paisa,', start: 4, end: 4.6 }, { text: 'bachao', start: 4.7, end: 5.8 }] },
  ]));
  await m.click('.tl-acts [data-act="claude"]');
  await m.waitForFunction(() => (window.__vcz.S.o.cuts || []).length === 1);
  assert.equal(sent.lines.length, 3);
  assert.equal(sent.lines[1].text, 'galat take');
  const st = await m.evaluate(() => { const S = window.__vcz.S; return { cuts: S.o.cuts, hook: (S.o.texts || []).filter(l => l.hook).map(l => l.text), colored: S.segments.flatMap(s => s.words).filter(w => w.color).map(w => w.text), found: (S.o.found || []).map(c => c.title) }; });
  assert.deepEqual(st.cuts, [{ start: 2, end: 4 }]);
  assert.deepEqual(st.hook, ['Ye galti mat karna']);
  assert.deepEqual(st.colored, ['Paisa', 'paisa,']);
  assert.deepEqual(st.found, ['Paisa bachao']);
  assert.match(await m.textContent('#clipNote'), /Paisa kaise bachaye/);
  // One undo takes the whole AI edit back.
  await m.keyboard.press('Control+z');
  assert.equal(await m.evaluate(() => (window.__vcz.S.o.cuts || []).length), 0);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('text: opacity, glow, and motion keyframes make the text glide across the frame', async () => {
  const src = join(OUT, 'pause.webm'); // 6 s, from the cut-silences step
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', src);
  await m.waitForSelector('#timeline:not([hidden])');
  await m.click('#ltabText');
  await m.click('#txtAdd');
  await m.waitForSelector('#txtEdit:not([hidden])');
  // Opacity + glow are stored on the layer.
  await m.fill('#txtText', 'MOVE ME');
  await m.locator('#txtText').blur();
  await m.click('#txtWhole');
  await m.$eval('#txtOpacity', el => { el.value = 50; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await m.click('#txtGlow');
  let L = await m.evaluate(() => window.__vcz.S.o.texts[0]);
  assert.ok(Math.abs(L.op - 0.5) < 1e-6, `op ${L.op}`);
  assert.equal(L.glow, true);
  // Keyframe at t=0, then move the playhead and drag the text to a new spot.
  await m.evaluate(() => { window.__vcz.video.currentTime = 0; });
  await m.click('#txtKfAdd');
  assert.equal((await m.evaluate(() => window.__vcz.S.o.texts[0].kf)).length, 1);
  await m.evaluate(() => { window.__vcz.video.currentTime = 2; });
  // Drag the text from where it sits now to the top-left of the frame.
  const box = await m.evaluate(() => {
    const b = window.__vcz.S.textBoxes[0], c = document.getElementById('stage') || document.querySelector('canvas');
    const r = c.getBoundingClientRect(), kx = r.width / c.width, ky = r.height / c.height;
    return { fx: r.left + (b.x0 + b.w / 2) * kx, fy: r.top + (b.y0 + b.h / 2) * ky, tx: r.left + r.width * 0.2, ty: r.top + r.height * 0.2 };
  });
  await m.mouse.move(box.fx, box.fy); await m.mouse.down();
  await m.mouse.move(box.fx - 20, box.fy - 20); await m.mouse.move(box.tx, box.ty, { steps: 6 }); await m.mouse.up();
  const kf = await m.evaluate(() => window.__vcz.S.o.texts[0].kf);
  assert.equal(kf.length, 2, JSON.stringify(kf));
  // Between the two keyframes the position is strictly between them (it is moving).
  const a = kf[0], b = kf[kf.length - 1];
  assert.ok(Math.abs(b.x - a.x) > 0.05 || Math.abs(b.y - a.y) > 0.05, `moved: ${JSON.stringify(kf)}`);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('captions: horizontal position slider moves the caption left and right', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForTimeout(400);
  await m.setInputFiles('#srtIn', join(FIX, 'sample.srt'));
  await m.waitForFunction(() => window.__vcz.S.segments.length > 0, null, { timeout: 15000 });
  // Put the playhead on a caption and pause so the full caption is drawn.
  await m.evaluate(() => { const v = window.__vcz.video; v.pause(); v.currentTime = window.__vcz.S.segments[0].start + 0.1; });
  await m.waitForTimeout(200);
  // Horizontal centre of the brightest (text) pixels on the preview canvas.
  const centroidX = () => m.evaluate(() => {
    const c = document.getElementById('stage'), x = c.getContext('2d');
    const d = x.getImageData(0, 0, c.width, c.height).data; let sx = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] > 210 && d[i + 1] > 210 && d[i + 2] > 210) { sx += ((i / 4) % c.width); n++; } }
    return n ? sx / n / c.width : null;
  });
  const setX = async v => { await m.$eval('#posX', (el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v); await m.waitForTimeout(150); };
  await setX(20); const leftC = await centroidX();
  await setX(80); const rightC = await centroidX();
  assert.ok(leftC != null && rightC != null, `found text pixels: ${leftC}, ${rightC}`);
  assert.ok(rightC - leftC > 0.1, `caption moved right: ${leftC.toFixed(2)} → ${rightC.toFixed(2)}`);
  assert.equal(await m.evaluate(() => window.__vcz.S.o.posX), 0.8);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('per-clip context toolbar: tap the clip for Replace/Trim; unbuilt actions show "Soon"', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message));
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.waitForTimeout(300);
  // Tapping the video clip selects it and opens the context toolbar (dispatch to avoid canvas hit-test flakiness).
  const r = await m.evaluate(() => {
    const fire = el => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fire(document.querySelector('.tl-film'));
    const ctx = document.querySelector('.tl-ctx'), app = document.querySelector('.app');
    const out = {
      ctxVisible: !ctx.hidden,
      videoSel: document.querySelector('.tl-video').classList.contains('sel'),
      clipSel: app.classList.contains('clip-sel'),
      soonDisabled: [...ctx.querySelectorAll('.capcut-soon')].every(x => x.disabled),
      real: [...ctx.querySelectorAll('button[data-cact]')].filter(x => !x.disabled).map(x => x.dataset.cact),
      barHidden: getComputedStyle(document.querySelector('#editor .panel.tools .tool-tabs')).display === 'none',
    };
    let rep = false; document.getElementById('fileIn').addEventListener('click', e => { e.preventDefault(); rep = true; }, { once: true });
    fire(ctx.querySelector('[data-cact="replace"]')); out.replaceFired = rep;
    fire(ctx.querySelector('[data-cact="close"]')); out.closed = ctx.hidden && !app.classList.contains('clip-sel');
    return out;
  });
  assert.equal(r.ctxVisible, true, 'context toolbar opens on clip tap');
  assert.equal(r.videoSel, true);
  assert.deepEqual(r.real.sort(), ['close', 'replace', 'speed', 'trim', 'volume']);
  assert.equal(r.soonDisabled, true, 'Duplicate stays disabled (Soon), not faked');
  assert.equal(r.barHidden, true, 'phone bottom tool bar is replaced by the context toolbar');
  assert.equal(r.replaceFired, true, 'Replace triggers the file picker');
  assert.equal(r.closed, true, 'closing returns to the normal editor');
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('music import: plays with the video, routes export to include the audio, Soon-free and on-device', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message)); m.on('dialog', d => d.accept());
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.waitForTimeout(300);
  await m.click('#ltabSnd');
  await m.setInputFiles('#musicIn', join(FIX, 'music.mp3'));
  await m.waitForSelector('#musicCard:not([hidden])');
  await m.waitForTimeout(200);
  const st = await m.evaluate(() => ({ name: window.__vcz.S.o.music.name, vol: window.__vcz.S.o.music.volume, hasMusic: window.__vcz.hasMusic(), elem: !!window.__vcz.music() }));
  assert.equal(st.name, 'music.mp3');
  assert.equal(st.vol, 80);
  assert.equal(st.hasMusic, true);
  assert.equal(st.elem, true, 'a music audio element is created');
  // Volume + start controls update the plan.
  await m.$eval('#musicVol', el => { el.value = 50; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await m.evaluate(() => { window.__vcz.video.currentTime = 2; });
  await m.click('#musicHere');
  const st2 = await m.evaluate(() => ({ vol: window.__vcz.S.o.music.volume, start: window.__vcz.S.o.music.start }));
  assert.equal(st2.vol, 50); assert.equal(st2.start, 2);
  // Export: with music, it must go through the real-time recorder so the music is baked in, and the file has audio.
  await m.click('#musicStart0');
  const dl = m.waitForEvent('download', { timeout: 120000 });
  await m.click('#exportBtn'); await m.waitForSelector('#xDlg[open]'); await m.click('#xGo');
  const d = await dl; const file = join(OUT, `music-${d.suggestedFilename()}`); await d.saveAs(file);
  assert.equal(await m.evaluate(() => window.__vczLastExport), 'mediarecorder', 'music forces the recorder path that bakes in the audio');
  const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]).toString();
  assert.match(streams, /audio/, 'exported file has an audio track');
  const vol = execFileSync('sh', ['-c', `ffmpeg -i "${file}" -af volumedetect -vn -f null - 2>&1 | grep -o 'mean_volume: [-0-9.]*'`]).toString();
  assert.ok(+vol.split(':')[1] > -40, `audio is present and not silent: ${vol.trim()}`);
  // Remove puts it back to no music.
  await m.click('#musicDel');
  assert.equal(await m.evaluate(() => window.__vcz.hasMusic()), false);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('per-clip speed + volume: set from the context toolbar, applied to preview and export', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message)); m.on('dialog', d => d.accept());
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.waitForTimeout(400);
  const r = await m.evaluate(() => {
    const fire = el => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fire(document.querySelector('.tl-film'));                       // select clip
    fire(document.querySelector('.tl-ctx [data-cact="speed"]'));    // open speed popover
    const pop = document.querySelector('.tl-ctx-pop');
    const hasPresets = !pop.hidden && !!pop.querySelector('[data-spd="2"]');
    fire(pop.querySelector('[data-spd="2"]'));                      // 2x
    const sp = { speed: window.__vcz.S.o.speed, rate: window.__vcz.video.playbackRate };
    fire(document.querySelector('.tl-ctx [data-cact="volume"]'));   // open volume popover
    const vol = document.querySelector('#ctxVol');
    vol.value = 150; vol.dispatchEvent(new Event('input', { bubbles: true })); vol.dispatchEvent(new Event('change', { bubbles: true }));
    return { hasPresets, sp, vol: window.__vcz.S.o.vol };
  });
  assert.equal(r.hasPresets, true, 'speed presets show in the popover');
  assert.equal(r.sp.speed, 2); assert.equal(r.sp.rate, 2, 'preview plays at 2x');
  assert.equal(r.vol, 150, 'clip volume set to 150%');
  // Export at 2x: the recorder path is used and the output is about half as long.
  const dl = m.waitForEvent('download', { timeout: 120000 });
  await m.click('#exportBtn'); await m.waitForSelector('#xDlg[open]'); await m.click('#xGo');
  const d = await dl; const file = join(OUT, `sv-${d.suggestedFilename()}`); await d.saveAs(file);
  assert.equal(await m.evaluate(() => window.__vczLastExport), 'mediarecorder');
  const dur = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
  assert.ok(dur > 2.3 && dur < 3.9, `2x export is about half of ~6s: ${dur}s`);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('auto beats: detect the music tempo and show a 4/8/16 beat grid on the timeline', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, serviceWorkers: 'block' });
  const m = await ctx.newPage();
  const errs = []; m.on('pageerror', e => errs.push(e.message)); m.on('dialog', d => d.accept());
  await m.goto(`${BASE}/app.html`);
  await m.click('#startSkip');
  await m.setInputFiles('#fileIn', join(FIX, 'portrait.webm'));
  await m.waitForSelector('#timeline:not([hidden])');
  await m.waitForTimeout(300);
  await m.click('#ltabSnd');
  await m.setInputFiles('#musicIn', join(FIX, 'beat.mp3'));
  await m.waitForSelector('#musicCard:not([hidden])');
  await m.click('#beatsBtn');
  await m.waitForFunction(() => (window.__vcz.S.o.beats || []).length > 0, null, { timeout: 15000 });
  const r = await m.evaluate(() => ({ beats: window.__vcz.S.o.beats.length, bpm: window.__vcz.S.o.bpm, markers: document.querySelectorAll('#timeline .tl-beats i').length, strong4: document.querySelectorAll('#timeline .tl-beats i.strong').length }));
  assert.ok(Math.abs(r.bpm - 120) <= 4, `~120 BPM, got ${r.bpm}`);          // beat.mp3 is a kick every 0.5s
  assert.ok(r.beats >= 14 && r.beats <= 20, `~17 beats, got ${r.beats}`);
  assert.equal(r.markers, r.beats, 'a marker per beat on the timeline');
  // 8-count regroups which markers are strong.
  await m.selectOption('#beatsGroup', '8');
  await m.waitForTimeout(150);
  const strong8 = await m.evaluate(() => document.querySelectorAll('#timeline .tl-beats i.strong').length);
  assert.ok(strong8 < r.strong4, `8-count has fewer strong lines than 4-count (${strong8} < ${r.strong4})`);
  // Clear removes the grid.
  await m.click('#beatsClear');
  assert.equal(await m.evaluate(() => (window.__vcz.S.o.beats || []).length), 0);
  assert.deepEqual(errs, []);
  await ctx.close();
});

await step('no uncaught page errors', async () => { assert.deepEqual(errors, []); });

await browser.close();
server.close();
const failed = results.filter(r => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
