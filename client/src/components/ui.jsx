import React, { useEffect, useRef, useState } from 'react';

/* Map legacy coverColor tokens onto the new oxblood/olive/brass/ink/paper schemes
   (used only for the editorial fallback when a real cover cannot load). */
const SCHEME = {
  terracotta: 'blood', mustard: 'brass', sage: 'olive', ink: 'ink',
  teal: 'blood', paper: 'parch', forest: 'olive',
};

function schemeOf(book) {
  return SCHEME[book.coverColor] || SCHEME[book.spine] || 'blood';
}

function variantOf(book) {
  let h = 0;
  for (const c of book.id) h = (h * 31 + c.charCodeAt(0)) % 997;
  return h % 3; // 0 circle, 1 square, 2 frame-only
}

function GraphicFallback({ book, index, unavailable }) {
  const s = schemeOf(book);
  const v = variantOf(book);
  return (
    <div className={`cover cv-${s}`}>
      <div className="cv-k">{unavailable ? 'BOOK COVER UNAVAILABLE' : book.genre || 'LIBRARY'}</div>
      <div>
        <div className="cv-t">{book.title}</div>
        <div className="cv-a">{book.author}</div>
      </div>
      <div className="cv-k">{book.year} · № {(index ?? 0) + 1}</div>
      {v < 2 && <div className={`cv-m ${v === 1 ? 'sq' : ''}`} style={{ background: 'currentColor' }} />}
      <div className="cv-frame" />
    </div>
  );
}

/** Real published cover as the hero visual. Never generated, never stretched.
 *  One silent retry, then a clean editorial fallback (title + author).
 *  size "M" (default, cards) or "L" (large hero spots like discovery). */
export function Cover({ book, index, size }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setFailed(false); setAttempt(0); }, [book?.id]);
  if (!book) return null;
  const base = size === 'L' ? (book.largeCoverUrl || book.coverUrl) : (book.mediumCoverUrl || book.coverUrl);
  if (base && !failed) {
    const src = attempt === 0 ? base : `${base}?retry=${attempt}`;
    return (
      <div className="photo-wrap">
        <img
          className="photo"
          src={src}
          alt={`${book.title} — real book cover`}
          loading="lazy"
          draggable={false}
          onError={() => {
            if (attempt < 1) setAttempt((a) => a + 1);
            else setFailed(true);
          }}
        />
        <div className="photo-spine" aria-hidden="true" />
        <div className="photo-edge" aria-hidden="true" />
      </div>
    );
  }
  return <GraphicFallback book={book} index={index} unavailable={!!base} />;
}

export function ShelfBook({ book, index }) {
  if (!book) return null;
  return (
    <div className="bookcell" style={{ animationDelay: `${(index || 0) * 70}ms` }}>
      <Cover book={book} index={index} />
      <div className="t">{book.title}</div>
    </div>
  );
}

/** Uniform shelf tile: identical cell, fixed image area, aligned type.
 *  Real cover when available, monogram fallback otherwise. */
export function Tile({ book, showYear, delay, dense }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setFailed(false); setAttempt(0); }, [book?.id]);
  if (!book) return null;
  const base = book.mediumCoverUrl || book.coverUrl;
  const src = base && !failed
    ? (attempt === 0 ? base : `${base}?retry=${attempt}`)
    : null;
  return (
    <div className={`tile${dense ? ' tile--dense' : ''}`} style={delay ? { animationDelay: `${delay}ms` } : undefined}>
      <div className="tile-art">
        {src ? (
          <img
            src={src} alt={`${book.title} cover`} loading="lazy" draggable={false}
            onError={() => { if (attempt < 1) setAttempt((a) => a + 1); else setFailed(true); }}
          />
        ) : (
          <div className={`tile-mono cv-${schemeOf(book)}`}>{book.title[0]}</div>
        )}
      </div>
      <div className="tile-tx">
        <div className="tile-tt">{book.title}</div>
        <div className="tile-meta">{book.author}{showYear ? ` · ${book.year}` : ''}</div>
      </div>
    </div>
  );
}

function Mini({ book, code }) {
  const [bad, setBad] = useState(false);
  if (!book) return null;
  return (
    <span className="mini" title={book.title}>
      {book.smallCoverUrl && !bad
        ? <img src={book.smallCoverUrl} alt={book.title} loading="lazy" draggable={false} onError={() => setBad(true)} />
        : <span className="mini-mono">{code || book.title[0]}</span>}
      <span className="mini-code">{code}</span>
    </span>
  );
}

/** An answer option rendered as a shelf strip: [book]→[book]→[book]→[book]. */
export function OptionStrip({ option, cards, library }) {
  const codes = (option || '').split('→').map((s) => s.trim()).filter(Boolean);
  return (
    <span className="strip-books">
      {codes.map((code, i) => {
        const card = (cards || []).find((c) => c.code === code);
        const book = card && library ? library[card.id] : null;
        return (
          <span key={`${code}-${i}`} className="strip-step">
            {i > 0 && <span className="strip-arrow">→</span>}
            <Mini book={book} code={code} />
          </span>
        );
      })}
    </span>
  );
}

/** Small physical-looking book card for the puzzle shelf. */
export function PCard({ book, code, delay }) {
  const [bad, setBad] = useState(false);
  if (!book) return null;
  return (
    <div className="pcard" style={delay ? { animationDelay: `${delay}ms` } : undefined}>
      <div className="pc-code">{code}</div>
      {book.mediumCoverUrl && !bad ? (
        <img src={book.mediumCoverUrl} alt={`${book.title} cover`} loading="lazy" draggable={false} onError={() => setBad(true)} />
      ) : (
        <div className="pc-mono">{book.title[0]}</div>
      )}
      <div className="pc-t">{book.title}</div>
    </div>
  );
}

/** Empty / filled shelf slots: ┌ ? ┬ ? ┬ ? ┬ ? ┐ */
export function Slots({ filled, size }) {
  const n = size || 4;
  const arr = Array.from({ length: n }, (_, i) => (filled && filled[i]) || null);
  return (
    <div className="slot-row">
      {arr.map((code, i) => (
        <div key={i} className={`slot ${code ? 'full slot-in' : 'empty'}`}>
          <span className="slot-n">{i + 1}</span>
          <span className="slot-v">{code || '?'}</span>
        </div>
      ))}
      <div className="slot-rail" />
    </div>
  );
}
export function TimerLine({ remaining, total }) {
  const low = remaining <= 5;
  const pct = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
  return (
    <div>
      <div className="timerline">
        <div className={`timer-big mono-num ${low ? 'low' : ''}`}>{remaining}</div>
        <div style={{ flex: 1 }}>
          <div className="status-line">seconds · faster correct earns more</div>
          <div className="timer-track" style={{ marginTop: 8 }}><div style={{ width: `${pct}%` }} /></div>
        </div>
      </div>
    </div>
  );
}

export function CountUp({ value }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    const to = value;
    if (from === to) return;
    const t0 = performance.now();
    const dur = 700;
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      setShown(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
      else prev.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  useEffect(() => { prev.current = value; }, [value]);
  return <span className="mono-num">{shown.toLocaleString('en-IN')}</span>;
}

export function RankingWall({ players }) {
  const list = [...(players || [])].slice(0, 5);
  if (list.length === 0) return <div className="small">No readers yet — scan to join.</div>;
  return (
    <div className="wall">
      {list.map((p, i) => (
        <div className={`wall-row ${i === 0 ? 'first' : ''}`} key={p.name} style={{ animationDelay: `${i * 90}ms` }}>
          <div className="rk">{String(i + 1).padStart(2, '0')}</div>
          <div className="nm">{p.name}
            {p.lastPoints > 0 && <span className="plus bump" style={{ marginLeft: 12, fontSize: 20 }}>+{p.lastPoints}</span>}
          </div>
          <div className="sc"><CountUp value={p.score} /></div>
        </div>
      ))}
    </div>
  );
}

/** Student collectible: tap to flip from sealed cover to facts. */
export function DiscoveryFlip({ book, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  useEffect(() => { setOpen(!!defaultOpen); }, [book?.id]);
  if (!book) return null;
  return (
    <div className={`flip ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)}>
      <div className="flip-inner">
        <div className="flip-face">
          <div className="disc">
            <div className="disc-band"><span>★ BOOK DISCOVERY</span><span>SEALED</span></div>
            <div className="disc-body">
              <Cover book={book} index={0} size="L" />
              <div style={{ textAlign: 'center' }}><span className="seal">UNLOCKED — TAP TO OPEN</span></div>
            </div>
          </div>
        </div>
        <div className="flip-face flip-back">
          <div className="disc">
            <div className="disc-band"><span>★ BOOK DISCOVERY</span><span>{book.year}</span></div>
            <div className="disc-body">
              <div className="lbl lbl--blood">{book.genre}</div>
              <div className="serif" style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.02 }}>{book.title}</div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>{book.author} · {book.year}</div>
              <hr className="rule" />
              <div className="lbl">Did you know?</div>
              <p style={{ margin: '6px 0' }}>{book.interestingFact} {book.didYouKnow}</p>
              <div className="lbl">Why it matters</div>
              <p style={{ margin: '6px 0 0' }}>{book.whyInteresting}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
