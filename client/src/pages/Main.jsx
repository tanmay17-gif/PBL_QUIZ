import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import { socket } from '../socket.js';
import books from '../data/books.json';
import { Cover, Tile, PCard, OptionStrip, Slots, TimerLine, RankingWall } from '../components/ui.jsx';
import { preloadRound } from '../preload.js';

const byId = Object.fromEntries(books.map((b) => [b.id, b]));
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function Main() {
  const [state, setState] = useState(null);

  useEffect(() => {
    const onState = (s) => setState(s);
    const onTimer = (t) => setState((p) => (p ? { ...p, timer: t } : p));
    socket.on('game:state', onState);
    socket.on('game:timer', onTimer);
    return () => {
      socket.off('game:state', onState);
      socket.off('game:timer', onTimer);
    };
  }, []);

  // Preload covers: current round immediately, next round in the background.
  useEffect(() => {
    if (!state) return;
    if (state.phase === 'lobby') preloadRound(0, { large: false });
    else if (state.roundIndex >= 0) {
      preloadRound(state.roundIndex);
      preloadRound(state.roundIndex + 1, { large: false });
    }
  }, [state?.roundIndex, state?.phase]);

  const joinUrl = useMemo(() => `${window.location.origin}/play?code=BOOK26`, []);
  if (!state) return <div className="stage"><div className="lbl">Opening the library…</div></div>;
  const r = state.round;

  return (
    <div className="stage">
      <div className="stage-top">
        <span className="lbl">PBL Week 2026 · GNIMS Library</span>
        <span className="lbl lbl--blood">Game code · BOOK26{state.roundIndex >= 0 ? ` · Round ${state.roundIndex + 1}/10` : ''}</span>
      </div>

      {state.paused && (
        <div style={{ marginTop: 12 }} className="lbl">Paused — back shortly</div>
      )}

      {state.phase === 'lobby' && (
        <div className="lobby">
          <div>
            <div className="lbl lbl--blood event-kicker">Project based learning week · 2026</div>
            <h1 className="event-title">Interactive<br /><em>Library</em> Game</h1>
            <div className="event-year">GNIMS Business School — Library Department</div>
            <div className="read-row"><span>READ</span><span>PLAY</span><span>DISCOVER</span></div>
            <hr className="rule-double" />
            <div className="count-line"><b>{state.playerCount}</b> {state.playerCount === 1 ? 'person' : 'people'} in the library</div>
            <div className="small">Open <b>/play</b> on your phone — or scan the code.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginTop: 18, maxWidth: 520 }}>
              {['alchemist', 'hobbit', 'sapiens'].map((id, i) => (
                <div key={id} className="drift" style={{ animationDelay: `${i * 1.1}s` }}>
                  <Cover book={byId[id]} index={i} />
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="lbl">Scan to join</div>
            <div style={{ marginTop: 10 }}><span className="qr"><QRCode value={joinUrl} size={236} /></span></div>
            <div className="lbl" style={{ marginTop: 16 }}>Game code</div>
            <div className="game-code">BOOK26</div>
            <hr className="rule" />
            <div className="lbl lbl--olive">Arriving now</div>
            <div className="slips">
              {state.players.slice(0, 18).map((p, i) => (
                <span key={p.name} className="slip" style={{ animationDelay: `${Math.min(i, 10) * 50}ms` }}>{p.name}</span>
              ))}
            </div>
            {state.playerCount === 0 && <p className="small">Waiting for the first scan…</p>}
          </div>
        </div>
      )}

      {state.phase === 'section-intro' && state.section && (
        <div className="fade" style={{ textAlign: 'center', padding: '7vh 0' }}>
          <div className="lbl lbl--olive">Section {String(state.section.index + 1).padStart(2, '0')} of 05</div>
          <div className="sec-num">0{state.section.index + 1}</div>
          <div className="serif" style={{ fontWeight: 800, fontSize: 'clamp(44px,5.4vw,88px)', lineHeight: 1 }}>{state.section.title}</div>
          <div className="serif" style={{ fontStyle: 'italic', fontSize: 22, color: 'var(--ink-soft)' }}>{state.section.tagline}</div>
          <div className="count">{state.timer.remaining}</div>
        </div>
      )}

      {state.phase === 'round-intro' && r && (
        <div className="fade" style={{ padding: '5vh 0' }}>
          <div className="chap">
            <div className="chap-num">{String(r.id).padStart(2, '0')}</div>
            <div>
              <div className="lbl lbl--blood">{r.chapter}</div>
              <h2>{r.title}</h2>
            </div>
            <div className="chap-sub">{state.section?.title} · {r.points} points</div>
          </div>
          <div className="count" style={{ marginTop: 18 }}>{state.timer.remaining}</div>
        </div>
      )}

      {state.phase === 'memorize' && r && (() => {
        const memIds = r.memorizeIds || r.flashIds || [];
        const memRows = Math.max(1, Math.ceil(memIds.length / 2));
        return (
          <div>
            <div className="lbl lbl--blood">{r.chapter} · Look</div>
            <div className="serif" style={{ fontWeight: 800, fontSize: 'clamp(34px,4vw,64px)' }}>Study the shelf</div>
            {memIds.length <= 1 ? (
              <div style={{ maxWidth: 380, margin: '14px auto' }}>
                <div className="tiles tiles--fit" style={{ height: 320, gridTemplateRows: 'minmax(0,1fr)' }}>
                  <Tile book={byId[memIds[0]]} />
                </div>
              </div>
            ) : (
              <div className="tiles tiles--fit" style={{ height: 'calc(100vh - 480px)', minHeight: 300, marginTop: 14, gridTemplateRows: `repeat(${memRows}, minmax(0,1fr))` }}>
                {memIds.map((id, i) => <Tile key={id} book={byId[id]} delay={i * 60} />)}
              </div>
            )}
            <TimerLine remaining={state.timer.remaining} total={state.timer.total} />
          </div>
        );
      })()}

      {state.phase === 'question' && r && (
        <div>
          <div className="chap">
            <div className="chap-num">{String(r.id).padStart(2, '0')}</div>
            <div>
              <div className="lbl lbl--blood">{r.chapter}</div>
              <h2>{r.title}</h2>
            </div>
            <div className="chap-sub">{state.section?.title} · {r.points} pts · {state.answersReceived} locked</div>
          </div>
          <div className="ask">{r.question}</div>
          {r.clues && <div className="clue-line">Clues · {r.clues.join(' — ')}</div>}
          {r.puzzle && <div className="clue-line" style={{ marginTop: 6 }}>Clues · {r.puzzle.rules.join(' — ')}</div>}
          {r.puzzle && (
            <div>
              <div className="puzzle-cards">
                {r.puzzle.cards.map((c, i) => <PCard key={c.code} book={byId[c.id]} code={c.code} delay={i * 80} />)}
              </div>
              <Slots size={4} />
              <div className="strips">
                {r.options.map((o, i) => (
                  <div key={o} className="strip">
                    <span className="n">{LETTERS[i] || (i + 1)}</span>
                    <OptionStrip option={o} cards={r.puzzle.cards} library={byId} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {!r.puzzle && r.shelfIds && (() => {
            const rows = Math.max(1, Math.ceil(r.shelfIds.length / 2));
            return (
              <div className="tiles tiles--fit" style={{ height: 'calc(100vh - 560px)', minHeight: 420, marginTop: 14, gridTemplateRows: `repeat(${rows}, minmax(0,1fr))` }}>
                {r.shelfIds.map((id, i) => <Tile key={id} book={byId[id]} showYear delay={i * 35} />)}
              </div>
            );
          })()}
          {!r.puzzle && (r.type === 'mystery' || r.type === 'mystery-risk') && (
            <div className="drawers">
              {r.boxes.map((b, i) => <div key={b} className="drawer" style={{ animationDelay: `${i * 60}ms` }}><b>{String(i + 1).padStart(2, '0')}</b>{b}</div>)}
            </div>
          )}
          {!r.puzzle && (
          <div className="choices">
            {r.options.map((o, i) => (
              <div key={o} className="choice"><span className="n">{LETTERS[i] || (i + 1)}</span><span>{o}</span></div>
            ))}
          </div>
          )}
          <TimerLine remaining={state.timer.remaining} total={state.timer.total} />
        </div>
      )}

      {state.phase === 'reveal' && r && (
        <div>
          <div className="lbl lbl--olive">Reveal · {state.stats?.correct}/{state.stats?.total} correct</div>
          <div className="reveal-answer">{state.stats?.correctAnswer}</div>
          {r.puzzle ? (
            <div>
              <Slots filled={(state.stats?.correctAnswer || '').split('→').map((s) => s.trim())} size={4} />
              <div className="strips">
                {r.options.map((o, i) => {
                  const hit = o === state.stats?.correctAnswer;
                  return (
                    <div key={o} className={`strip ${hit ? 'hit' : ''}`}>
                      <span className="n">{LETTERS[i] || (i + 1)}</span>
                      <OptionStrip option={o} cards={r.puzzle.cards} library={byId} />
                      <span className="votes">{state.stats?.counts[o] ?? 0} VOTES</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
          <div className="choices">
            {r.options.map((o, i) => {
              const hit = o === state.stats?.correctAnswer;
              return (
                <div key={o} className={`choice ${hit ? 'hit' : ''}`}>
                  <span className="n">{LETTERS[i] || (i + 1)}</span><span>{o}</span>
                  <span className="votes">{state.stats?.counts[o] ?? 0} VOTES</span>
                </div>
              );
            })}
          </div>
          )}
          <div className="status-line" style={{ marginTop: 12 }}>Speed rewarded · the full discovery card is on student phones</div>
        </div>
      )}

      {state.phase === 'discovery' && r && (
        <div className="fade" style={{ maxWidth: 780, margin: '5vh auto', textAlign: 'center' }}>
          <div className="lbl lbl--brass">Unlocked on student phones</div>
          <div className="serif" style={{ fontWeight: 800, fontSize: 'clamp(40px,5vw,72px)', lineHeight: 1 }}>{byId[r.discoveryId]?.title}</div>
          <div style={{ fontWeight: 700 }}>{byId[r.discoveryId]?.author}</div>
          <div className="small">Readers are opening the full card now</div>
        </div>
      )}

      {state.phase === 'leaderboard' && (
        <div style={{ maxWidth: 820 }}>
          <div className="lbl lbl--olive">After round {state.roundIndex + 1}</div>
          <div className="serif" style={{ fontWeight: 800, fontSize: 'clamp(40px,5vw,72px)', lineHeight: 1 }}>Library rankings</div>
          <RankingWall players={state.players} />
        </div>
      )}

      {state.phase === 'finished' && (
        <div style={{ maxWidth: 880 }}>
          <div className="lbl lbl--blood">Closing page</div>
          <div className="serif" style={{ fontWeight: 800, fontSize: 'clamp(52px,7vw,104px)', lineHeight: .95 }}>Library<br />Champions</div>
          <div className="wall">
            {state.players.slice(0, 3).map((p, i) => (
              <div className={`wall-row ${i === 0 ? 'first' : ''}`} key={p.name}>
                <div className="rk">{String(i + 1).padStart(2, '0')}</div>
                <div className="nm">{p.name}</div>
                <div className="sc">{p.score.toLocaleString('en-IN')}</div>
              </div>
            ))}
          </div>
          <hr className="rule-double" />
          <div className="small">Sharpest eyes · Most curious reader · Best comeback — announced by the host. Thank you for playing.</div>
        </div>
      )}
    </div>
  );
}
