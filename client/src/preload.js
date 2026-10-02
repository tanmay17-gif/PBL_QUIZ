// Cover preloading: current round now, next round in the background.
// Uses the browser cache (each URL requested once) and never blocks the UI.
import books from './data/books.json';
import rounds from './data/rounds.json';

const byId = Object.fromEntries(books.map((b) => [b.id, b]));
const seen = new Set();

function load(url) {
  if (!url || seen.has(url)) return;
  seen.add(url);
  try {
    const im = new Image();
    im.decoding = 'async';
    im.src = url;
  } catch {}
}

function medium(b) { return b.mediumCoverUrl || b.coverUrl; }

export function preloadRound(idx, opts = {}) {
  const r = rounds[idx];
  if (!r) return;
  const ids = [
    ...(r.memorizeIds || []),
    ...(r.flashIds || []),
    ...(r.shelfIds || []),
    ...((r.puzzle?.cards || []).map((c) => c.id)),
  ];
  ids.forEach((id) => { const b = byId[id]; if (b) load(medium(b)); });
  if (r.puzzle?.cards) r.puzzle.cards.forEach((c) => { const b = byId[c.id]; if (b && b.smallCoverUrl) load(b.smallCoverUrl); });
  const d = byId[r.discoveryId];
  if (d) load(opts.large === false ? medium(d) : (d.largeCoverUrl || d.coverUrl));
}
