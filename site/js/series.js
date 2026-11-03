// Instagram/YouTube series from one long video: the shorts in a fixed order, a "PART n" label for each,
// and a ready-to-paste caption per part that points to the next one. Pure functions (tested in Node).

/** Shorts in series order: 'time' keeps the story's order, 'score' puts the strongest first. */
export function seriesOrder(found, order = 'time') {
  const idx = (found || []).map((f, i) => i);
  return order === 'score' ? idx : idx.sort((a, b) => found[a].start - found[b].start);
}

/** The part number (1-based) of short i, or 0 if it isn't in the list. */
export const partOf = (found, i, order) => seriesOrder(found, order).indexOf(i) + 1;

/** The on-screen label for a part. */
export const partLabel = (n, total, name) => `${name ? `${name.toUpperCase()} · ` : ''}PART ${n}${total ? `/${total}` : ''}`;

/** The on-screen badge in the chosen numbering style: 'part' → "PART 2/5", 'day' → "DAY 2/5". */
export const seriesLabel = (n, total, { name = '', mode = 'part' } = {}) =>
  `${name ? `${name.toUpperCase()} · ` : ''}${mode === 'day' ? 'DAY' : 'PART'} ${n}${total ? `/${total}` : ''}`;

/** The word for a number in the chosen style, as used in captions ("Part 2" / "Day 2"). */
export const seriesWord = mode => (mode === 'day' ? 'Day' : 'Part');

/** Default end-card text for part n of total: a reason to follow, or a closer on the last part. */
export function endCardText(n, total, { name = '', mode = 'part' } = {}) {
  const w = seriesWord(mode);
  return n < total
    ? `${w} ${n + 1} is coming 👀\nFollow so you don't miss it`
    : `That was the last part 🙏\nFollow for the next ${name ? `${name} ` : ''}series`;
}

const tagOf = s => String(s || '').replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 30);

/** One caption per part, in order: hook, part number, a reason to watch the next part, hashtags. */
export function seriesCaptions(found, { name = '', order = 'time', tags = [], mode = 'part' } = {}) {
  const ids = seriesOrder(found, order), n = ids.length, tag = tagOf(name), w = seriesWord(mode);
  return ids.map((i, k) => {
    const f = found[i], part = k + 1;
    const next = part < n ? `${w} ${part + 1} is next: follow so you don't miss it 👉` : 'That was the last part. Which one helped most? Comment 👇';
    const hashtags = [tag && `#${tag}`, `#${w.toLowerCase()}${part}`, '#series', '#reels', ...tags.map(t => `#${tagOf(t)}`)].filter(Boolean).join(' ');
    return { part, i, text: `${name ? `${name} · ` : ''}${w} ${part}/${n} 🔥\n${f.title || ''}\n\n${next}\n\n${hashtags}` };
  });
}
