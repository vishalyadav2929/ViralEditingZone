// Timeline under the preview: time ruler, one block per word, one per caption, the audio waveform and
// a playhead. Click to jump, double-click a word to fix it, Delete to remove it, zoom in/out.
// All edits go back through `api`, so undo/redo and the caption list stay in step.

const ZOOMS = [4, 8, 15, 30, 60, 100, 160, 240, 360]; // pixels per second

/**
 * api: { segments(), duration(), time(), playing(), seek(t), editWord(si, wi, text), deleteWord(si, wi),
 *        selectSeg(i), wave(), show(text), pos(), setPos(p) }
 */
export function mountTimeline(root, api) {
  root.innerHTML = `
    <div class="tl-bar">
      <span class="tl-title">Timeline</span>
      <span class="tl-acts"><button type="button" data-act="claude" class="tl-ai tl-claude" hidden title="Claude reads what is said and cuts bad takes, repeats and rambling, adds a hook, highlights key words and picks Shorts">🤖 AI edit</button><button type="button" data-act="auto" class="tl-ai" title="Cut pauses, remove umm/uh, style the captions and add a hook">✨ Auto edit</button><button type="button" data-act="silence" title="Cut the silent parts out of the video">🔇 Cut silences</button><button type="button" data-act="split" title="Split the caption at the playhead">✂ Split</button><button type="button" data-act="del" title="Delete the selected word, caption, text or sound">🗑 Delete</button></span>
      <div class="tl-pos" role="group" aria-label="Caption position">
        <button type="button" data-pos="0.2">Top</button><button type="button" data-pos="0.5">Middle</button><button type="button" data-pos="0.78">Bottom</button>
      </div>
      <button type="button" class="tl-addtxt">+ Text</button>
      <button type="button" class="tl-add" aria-haspopup="true">+ Sound</button>
      <span class="tl-zoom"><button type="button" data-z="-1" aria-label="Zoom out">−</button><button type="button" data-z="1" aria-label="Zoom in">+</button></span>
    </div>
    <div class="tl-scroll" tabindex="0" aria-label="Timeline: click to jump, double-click a word to edit it, Delete removes the selected word">
      <div class="tl-inner">
        <div class="tl-ruler"></div>
        <div class="tl-row tl-words"></div>
        <div class="tl-row tl-caps"></div>
        <div class="tl-row tl-txt"></div>
        <div class="tl-row tl-sfx"></div>
        <div class="tl-row tl-video"><canvas class="tl-film" height="44"></canvas><span class="tv-name"></span><i class="tv-dim l"></i><i class="tv-dim r"></i><i class="tv-h l" title="Drag to trim the start"></i><i class="tv-h r" title="Drag to trim the end"></i></div>
        <canvas class="tl-wave" height="40"></canvas>
        <div class="tl-clip" hidden></div>
        <div class="tl-head"></div>
      </div>
    </div>
    <div class="tl-menu" hidden>
      <div class="tl-menu-h"><b>Sound effects</b><span>Tap ▶ to hear, + to add at the playhead</span></div>
      <div class="tl-sounds"></div>
      <label class="tl-auto">On every caption: <select class="tl-auto-sel"><option value="">Off</option></select></label>
    </div>
    <p class="tl-hint">Click a word to jump · double-click to fix it · Delete removes the selected word or sound</p>`;
  const $ = s => root.querySelector(s);
  const sfxRow = $('.tl-sfx'), txtRow = $('.tl-txt'), menu = $('.tl-menu');
  let sfxSel = null;
  (api.sounds || []).forEach(snd => {
    const row = document.createElement('div'); row.className = 'tl-snd';
    const play = document.createElement('button'); play.type = 'button'; play.textContent = '▶'; play.setAttribute('aria-label', `Play ${snd.name}`);
    play.onclick = () => api.previewSound(snd.id);
    const add = document.createElement('button'); add.type = 'button'; add.className = 'add'; add.textContent = `${snd.icon} ${snd.name} +`;
    add.onclick = () => { api.addSound(snd.id); };
    row.append(play, add); $('.tl-sounds').appendChild(row);
    const o = document.createElement('option'); o.value = snd.id; o.textContent = `${snd.icon} ${snd.name}`; $('.tl-auto-sel').appendChild(o);
  });
  // The sound list lives in a side panel instead of under the timeline.
  if (api.soundsHost) { api.soundsHost.appendChild(menu); menu.hidden = false; }
  $('.tl-add').onclick = () => { menu.querySelector('.tl-auto-sel').value = api.autoSound() || ''; if (api.openSounds) api.openSounds(); else menu.hidden = !menu.hidden; };
  $('.tl-addtxt').onclick = () => api.addText && api.addText();
  menu.querySelector('.tl-auto-sel').onchange = e => api.setAutoSound(e.target.value || null);
  const scroll = $('.tl-scroll'), inner = $('.tl-inner'), ruler = $('.tl-ruler'), wordsRow = $('.tl-words'), capsRow = $('.tl-caps'), wave = $('.tl-wave'), head = $('.tl-head');
  let zi = 5, pps = ZOOMS[zi], fitted = false, sel = null; // sel = [si, wi]

  root.querySelector('.tl-zoom').onclick = e => {
    const d = +(e.target.dataset.z || 0);
    if (!d) return;
    zi = Math.max(0, Math.min(ZOOMS.length - 1, zi + d)); pps = ZOOMS[zi]; fitted = true;
    renderNow();
  };
  root.querySelector('.tl-acts').onclick = e => {
    const act = e.target.closest('button') && e.target.closest('button').dataset.act;
    if (act === 'split') api.splitAt(api.time());
    if (act === 'silence') api.autoCut();
    if (act === 'auto') api.autoEdit();
    if (act === 'claude') api.claudeEdit();
    if (act === 'del') {
      if (sfxSel != null) { const i = sfxSel; sfxSel = null; api.deleteSound(i); }
      else if (sel) { const [si, wi] = sel; sel = null; api.selectWord && api.selectWord(null); api.deleteWord(si, wi); }
      else api.deleteSelected();
    }
  };
  root.querySelector('.tl-pos').onclick = e => { const p = e.target.dataset.pos; if (p) { api.setPos(+p); syncPos(); } };
  function syncPos() {
    const p = api.pos();
    root.querySelectorAll('.tl-pos button').forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.pos - p) < 0.12));
  }

  // Click on empty timeline → jump there.
  inner.addEventListener('click', e => {
    if (e.target.closest('.tw, .tc, .ttx, .tv-h, .tv-cut')) return;
    const x = e.clientX - inner.getBoundingClientRect().left;
    api.seek(Math.max(0, x / pps));
  });
  scroll.addEventListener('keydown', e => {
    if (document.activeElement.isContentEditable) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sfxSel != null) { e.preventDefault(); const i = sfxSel; sfxSel = null; api.deleteSound(i); return; }
    if (!sel) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const [si, wi] = sel; sel = null; api.deleteWord(si, wi); }
  });

  // One edit often asks for several redraws in a row (caption list, undo, sounds): build the DOM once.
  let queued = false;
  function render() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; renderNow(); });
  }
  function renderNow() {
    const dur = api.duration() || 0;
    if (!fitted && dur) {
      // Start with the whole video in view (up to 2 minutes, like CapCut); longer videos get a reading zoom.
      const fit = (scroll.clientWidth - 40) / dur;
      zi = dur <= 120 ? ZOOMS.reduce((best, z, i) => (z <= Math.max(fit, ZOOMS[0]) ? i : best), 0) : 5; pps = ZOOMS[zi];
    }
    const W = Math.max(scroll.clientWidth - 2, Math.ceil(dur * pps) + 24);
    inner.style.width = `${W}px`;
    // Ruler
    ruler.innerHTML = '';
    const stepS = pps >= 160 ? 0.5 : pps >= 60 ? 1 : 2;
    for (let t = 0; t <= dur + 0.001; t += stepS) {
      const tick = document.createElement('span');
      tick.style.left = `${t * pps}px`;
      if (Math.abs(t - Math.round(t)) < 0.01) tick.textContent = `${Math.floor(t / 60)}:${String(Math.round(t) % 60).padStart(2, '0')}`;
      else tick.className = 'minor';
      ruler.appendChild(tick);
    }
    // Words and captions (an empty captions track offers auto captions, like CapCut)
    wordsRow.innerHTML = ''; capsRow.innerHTML = '';
    if (!api.segments().length && api.makeCaptions) {
      const busy = api.captionsBusy && api.captionsBusy();
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tc-add'; b.disabled = !!busy;
      b.textContent = busy ? '⏳ Making captions…' : '✨ Auto captions';
      b.onclick = e => { e.stopPropagation(); api.makeCaptions(); };
      capsRow.appendChild(b);
    }
    api.segments().forEach((seg, si) => {
      const c = document.createElement('button');
      c.type = 'button'; c.className = 'tc';
      c.style.left = `${seg.start * pps}px`; c.style.width = `${Math.max(6, (seg.end - seg.start) * pps - 2)}px`;
      c.textContent = api.show(seg.words.map(w => w.text).join(' '));
      c.title = c.textContent;
      c.onclick = () => { api.seek(seg.start); api.selectSeg(si); };
      capsRow.appendChild(c);
      seg.words.forEach((w, wi) => {
        const b = document.createElement('span');
        b.className = 'tw' + (sel && sel[0] === si && sel[1] === wi ? ' sel' : '');
        b.style.left = `${w.start * pps}px`; b.style.width = `${Math.max(8, (w.end - w.start) * pps - 2)}px`;
        b.textContent = api.show(w.text);
        b.title = `${b.textContent} · ${w.start.toFixed(2)}s`;
        b.onclick = () => { sel = [si, wi]; wordsRow.querySelectorAll('.tw.sel').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); api.seek(w.start); api.selectWord && api.selectWord(si, wi); scroll.focus({ preventScroll: true }); };
        if (w.color) b.style.boxShadow = `inset 0 -3px 0 ${w.color}`;
        b.ondblclick = () => {
          b.contentEditable = 'true'; b.textContent = w.text; b.classList.add('editing');
          const range = document.createRange(); range.selectNodeContents(b);
          const s = getSelection(); s.removeAllRanges(); s.addRange(range);
          const done = save => { b.contentEditable = 'false'; b.classList.remove('editing'); b.onblur = b.onkeydown = null; if (save) api.editWord(si, wi, b.textContent.trim()); else renderNow(); };
          b.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') done(false); e.stopPropagation(); };
          b.onblur = () => done(true);
        };
        wordsRow.appendChild(b);
      });
    });
    sfxRow.innerHTML = '';
    (api.soundList ? api.soundList() : []).forEach((fx, i) => {
      const snd = (api.sounds || []).find(s => s.id === fx.id);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tsfx' + (fx.auto ? ' auto' : '') + (sfxSel === i && !fx.auto ? ' sel' : '');
      b.style.left = `${fx.t * pps}px`;
      b.textContent = snd ? snd.icon : '♪';
      b.title = `${snd ? snd.name : fx.id} at ${fx.t.toFixed(2)}s${fx.auto ? ' (automatic)' : ' · Delete removes it'}`;
      b.onclick = e => { e.stopPropagation(); api.previewSound(fx.id); if (!fx.auto) { sfxSel = fx.index; sel = null; renderNow(); scroll.focus({ preventScroll: true }); } };
      sfxRow.appendChild(b);
    });
    renderTexts(dur);
    renderVideo(dur, W);
    // The part of the video used by the short being edited.
    const clip = api.clip ? api.clip() : null, cb = root.querySelector('.tl-clip');
    cb.hidden = !clip;
    if (clip) { cb.style.left = `${clip.start * pps}px`; cb.style.width = `${(clip.end - clip.start) * pps}px`; }
    drawWave(W);
    layout();
    syncPos();
    tick(api.time());
  }

  // Tracks stacked like CapCut (texts on top, then captions, sounds, the video and its audio), each
  // with an icon at the left that stays in view while scrolling.
  const videoRow = $('.tl-video'), film = $('.tl-film');
  function label(row, icon, title) {
    const l = document.createElement('span'); l.className = 'tl-lab'; l.textContent = icon; l.title = title; row.prepend(l);
  }
  function layout() {
    const segs = api.segments().length > 0, snd = sfxRow.children.length > 0;
    let y = 22;
    const place = (el, h, show = true) => { el.hidden = !show; if (!show) return; el.style.top = `${y}px`; el.style.height = `${h}px`; y += h + 4; };
    place(txtRow, Math.max(1, txtRow._lanes || 1) * 24, true);
    place(wordsRow, 22, segs); place(capsRow, 20, segs || !!capsRow.querySelector('.tc-add'));
    place(sfxRow, 18, snd);
    place(videoRow, 46, !!api.duration());
    wave.style.top = `${y}px`; y += 40;
    inner.style.height = `${y + 4}px`;
    [[txtRow, 'T', 'Text'], [wordsRow, 'Aa', 'Words'], [capsRow, '💬', 'Captions'], [sfxRow, '♪', 'Sounds']].forEach(([r, i, t]) => { if (!r.hidden && !r.querySelector('.tl-lab')) label(r, i, t); });
  }

  // Video track: a strip of frames from the video, with handles to trim its start and end.
  let frames = [], framesFor = null, frameAspect = 9 / 16;
  async function loadFrames(m) {
    framesFor = m.url; frames = [];
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = m.url; v.playsInline = true;
    await new Promise(r => { v.onloadeddata = r; v.onerror = r; setTimeout(r, 8000); });
    if (!v.videoWidth || framesFor !== m.url) return;
    frameAspect = v.videoWidth / v.videoHeight;
    const n = Math.min(60, Math.max(4, Math.ceil(m.dur / 2))), step = m.dur / n;
    for (let i = 0; i < n && framesFor === m.url; i++) {
      const t = Math.min(m.dur - 0.05, i * step + step / 2);
      await new Promise(r => { v.onseeked = r; v.currentTime = t; setTimeout(r, 1500); });
      const c = document.createElement('canvas'); c.height = 44; c.width = Math.round(44 * frameAspect);
      try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); } catch { /* not drawable */ }
      frames.push({ t, c });
      if (i % 6 === 5) drawFilm();
    }
    v.removeAttribute('src'); v.load();
    drawFilm();
  }
  function drawFilm() {
    const dur = api.duration() || 0, W = Math.ceil(dur * pps), w = Math.min(W, 16000);
    film.width = Math.max(1, w); film.style.width = `${W}px`;
    const x = film.getContext('2d');
    x.fillStyle = '#1f2937'; x.fillRect(0, 0, w, 44);
    if (!frames.length || !dur) return;
    const tw = 44 * frameAspect * (w / W);
    for (let px = 0; px < w; px += tw) {
      const t = (px + tw / 2) / w * dur;
      let best = frames[0];
      for (const f of frames) if (Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
      x.drawImage(best.c, px, 0, tw, 44);
    }
  }
  function renderVideo(dur) {
    const m = api.media ? api.media() : null;
    if (!m || !dur) return;
    if (m.url !== framesFor) loadFrames(m);
    drawFilm();
    if (!videoRow.querySelector('.tl-lab')) label(videoRow, '🎬', 'Video');
    videoRow.querySelector('.tv-name').textContent = `${m.name} · ${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, '0')}`;
    // Cut parts: red, skipped when playing and left out of the export; click one to bring it back.
    videoRow.querySelectorAll('.tv-cut').forEach(x => x.remove());
    (api.cuts ? api.cuts() : []).forEach((c, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tv-cut';
      b.style.left = `${c.start * pps}px`; b.style.width = `${Math.max(3, (c.end - c.start) * pps)}px`;
      b.title = `Cut ${c.start.toFixed(1)}–${c.end.toFixed(1)} s · click to bring it back`;
      b.onclick = e => { e.stopPropagation(); api.removeCut(i); };
      videoRow.appendChild(b);
    });
    const tr = (api.trim && api.trim()) || { start: 0, end: dur };
    const [dl, dr, hl, hr] = ['.tv-dim.l', '.tv-dim.r', '.tv-h.l', '.tv-h.r'].map(s => videoRow.querySelector(s));
    dl.style.width = `${tr.start * pps}px`;
    dr.style.left = `${tr.end * pps}px`; dr.style.width = `${Math.max(0, (dur - tr.end) * pps)}px`;
    hl.style.left = `${tr.start * pps}px`; hr.style.left = `${tr.end * pps - 10}px`;
    const drag = (h, which) => {
      h.onpointerdown = e => {
        e.stopPropagation(); h.setPointerCapture(e.pointerId);
        const x0 = e.clientX, s0 = tr.start, e0 = tr.end;
        h.onpointermove = ev => {
          const dt = (ev.clientX - x0) / pps;
          const s = which === 'l' ? Math.max(0, Math.min(e0 - 1, s0 + dt)) : s0, en = which === 'r' ? Math.min(dur, Math.max(s0 + 1, e0 + dt)) : e0;
          api.setTrim(s, en, false); renderVideo(dur); api.seek(which === 'l' ? s : en);
        };
        h.onpointerup = () => { h.onpointermove = h.onpointerup = null; const t = api.trim() || { start: 0, end: dur }; api.setTrim(t.start, t.end, true); };
      };
    };
    drag(hl, 'l'); drag(hr, 'r');
  }

  // Text layers: drag the block to move it in time, drag its right edge to change how long it shows.
  function renderTexts(dur) {
    txtRow.innerHTML = '';
    const list = api.texts ? api.texts() : [];
    txtRow.hidden = false;
    // Texts that overlap in time go on separate lanes, like layers in CapCut.
    const ends = [], laneOf = new Map();
    [...list].sort((a, b) => a.start - b.start).forEach(L => {
      let k = ends.findIndex(e => e <= L.start + 0.01);
      if (k < 0) { k = ends.length; ends.push(0); }
      ends[k] = L.end; laneOf.set(L.id, k);
    });
    txtRow._lanes = Math.max(1, ends.length);
    if (!list.length) {
      const hint = document.createElement('button'); hint.type = 'button'; hint.className = 'ttx-add'; hint.textContent = '+ Add text here';
      hint.onclick = e => { e.stopPropagation(); api.addText && api.addText(); };
      txtRow.appendChild(hint);
    }
    list.forEach(L => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ttx' + (api.selectedText && api.selectedText() === L.id ? ' sel' : '');
      b.style.left = `${L.start * pps}px`; b.style.width = `${Math.max(14, (L.end - L.start) * pps - 2)}px`;
      b.style.top = `${laneOf.get(L.id) * 24}px`; b.style.height = '20px';
      b.textContent = `T ${L.text.replace(/\s+/g, ' ')}`;
      b.title = `${L.text} · ${L.start.toFixed(2)}–${L.end.toFixed(2)}s · drag to move, drag an edge to change when it starts or ends`;
      const grip = document.createElement('i'); grip.className = 'grip'; b.appendChild(grip);
      const gripL = document.createElement('i'); gripL.className = 'grip l'; b.appendChild(gripL);
      b.onpointerdown = e => {
        e.stopPropagation();
        const resize = e.target === grip, resizeL = e.target === gripL, x0 = e.clientX, s0 = L.start, e0 = L.end, len = e0 - s0;
        let moved = false;
        b.setPointerCapture(e.pointerId);
        b.onpointermove = ev => {
          const dt = (ev.clientX - x0) / pps;
          if (!moved && Math.abs(ev.clientX - x0) < 4) return;
          moved = true;
          if (resize) api.timeText(L.id, s0, Math.min(dur || Infinity, Math.max(s0 + 0.2, e0 + dt)), false);
          else if (resizeL) api.timeText(L.id, Math.max(0, Math.min(e0 - 0.2, s0 + dt)), e0, false);
          else { const s = Math.max(0, Math.min((dur || Infinity) - len, s0 + dt)); api.timeText(L.id, s, s + len, false); }
          const now = api.texts().find(x => x.id === L.id);
          if (now) { b.style.left = `${now.start * pps}px`; b.style.width = `${Math.max(14, (now.end - now.start) * pps - 2)}px`; }
        };
        b.onpointerup = () => {
          b.onpointermove = b.onpointerup = null;
          if (moved) { const now = api.texts().find(x => x.id === L.id); api.timeText(L.id, now.start, now.end, true); }
          else { api.selectText(L.id); api.seek(L.start); }
        };
      };
      txtRow.appendChild(b);
    });
  }

  function drawWave(W) {
    const peaks = api.wave(), dur = api.duration() || 0;
    const w = Math.min(W, 16000); // canvas size limit; stretched by CSS if wider
    wave.width = w; wave.style.width = `${W}px`;
    const ctx = wave.getContext('2d');
    ctx.clearRect(0, 0, w, wave.height);
    if (!peaks || !dur) return;
    ctx.fillStyle = 'rgba(109,40,217,.35)';
    const mid = wave.height / 2, perPx = peaks.length / (dur * pps) * (W / w);
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let i = Math.floor(x * perPx), e = Math.floor((x + 1) * perPx); i <= e && i < peaks.length; i++) m = Math.max(m, peaks[i]);
      const h = Math.max(1, m * mid * 0.95);
      ctx.fillRect(x, mid - h, 1, h * 2);
    }
  }

  function tick(t) {
    const x = t * pps;
    head.style.transform = `translateX(${x}px)`;
    // Keep the playhead in view while playing.
    if (api.playing() && (x < scroll.scrollLeft || x > scroll.scrollLeft + scroll.clientWidth - 40)) scroll.scrollLeft = Math.max(0, x - 40);
  }

  return { render, renderNow, tick, menu, scrollTo(t) { scroll.scrollLeft = Math.max(0, t * pps - 40); }, reset() { fitted = false; sel = null; scroll.scrollLeft = 0; } };
}

/** Loudness peaks (0..1) every `step` seconds, for drawing the waveform. */
export function wavePeaks(audio, sr = 16000, step = 0.02) {
  const n = Math.max(1, Math.floor(sr * step)), out = new Float32Array(Math.ceil(audio.length / n));
  let max = 1e-6;
  for (let i = 0; i < out.length; i++) {
    let m = 0;
    for (let j = i * n, e = Math.min(audio.length, j + n); j < e; j++) { const v = audio[j] < 0 ? -audio[j] : audio[j]; if (v > m) m = v; }
    out[i] = m; if (m > max) max = m;
  }
  for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}
