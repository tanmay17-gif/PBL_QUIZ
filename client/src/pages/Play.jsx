import React, { useEffect, useMemo, useState } from 'react';
import { socket } from '../socket.js';
import books from '../data/books.json';
import { Tile, PCard, OptionStrip, Slots, DiscoveryFlip } from '../components/ui.jsx';
import { preloadRound } from '../preload.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const byId = Object.fromEntries(books.map((b) => [b.id, b]));
const LS_KEY = 'lib-me-v2';

export default function Play() {
  const [name, setName] = useState('');
  // me is set ONLY after the server confirms the session — never from stale storage.
  const [me, setMe] = useState(null);
  const [checking, setChecking] = useState(true);
  const [state, setState] = useState(null);
  const [pending, setPending] = useState(null);
  const [risk, setRisk] = useState('SAFE');
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    const onState = (s) => setState(s);
    const onTimer = (t) => setState((p) => (p ? { ...p, timer: t } : p));
    const onResult = (r) => setResult(r);
    socket.on('game:state', onState);
    socket.on('game:timer', onTimer);
    socket.on('player:result', onResult);
    const saved = (() => { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; } })();
    if (saved?.token) {
      socket.emit('player:sync', { token: saved.token }, (res) => {
        if (res?.ok) {
          setMe({ name: res.player.name, token: res.player.token });
          localStorage.setItem(LS_KEY, JSON.stringify({ name: res.player.name, token: res.player.token }));
          if (res.state) setState(res.state);
        } else {
          // stale session (server restarted / game reset) — back to the name form
          try { localStorage.removeItem(LS_KEY); } catch {}
          if (saved?.name) setName(saved.name);
        }
        setChecking(false);
      });
    } else {
      if (saved?.name) setName(saved.name);
      setChecking(false);
    }
    return () => {
      socket.off('game:state', onState);
      socket.off('game:timer', onTimer);
      socket.off('player:result', onResult);
    };
  }, []);

  useEffect(() => {
    setPending(null);
    setErr('');
    if (state && ['section-intro', 'round-intro'].includes(state.phase)) setResult(null);
  }, [state?.roundIndex, state?.phase]);

  // Same cover preloading as the main screen: current round now, next in background.
  useEffect(() => {
    if (!state) return;
    if (state.phase === 'lobby') preloadRound(0, { large: false });
    else if (state.roundIndex >= 0) {
      preloadRound(state.roundIndex);
      preloadRound(state.roundIndex + 1, { large: false });
    }
  }, [state?.roundIndex, state?.phase]);

  const join = () => {
    setErr('');
    const saved = (() => { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; } })();
    socket.emit('player:join', { name: name || saved?.name || '', code: 'BOOK26', token: saved?.token }, (res) => {
      if (!res?.ok) {
        setErr(res?.error || 'Could not join');
        return;
      }
      const m = { name: res.player.name, token: res.player.token };
      setMe(m);
      localStorage.setItem(LS_KEY, JSON.stringify(m));
    });
  };

  const submit = () => {
    if (!pending) return;
    setErr('');
    socket.emit('player:answer', { choice: pending, risk: state?.round?.id === 6 ? risk : undefined }, (res) => {
      if (!res?.ok) setErr(res?.error || 'Not accepted');
    });
  };

  const myRank = useMemo(() => {
    if (!state || !me) return null;
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    const i = sorted.findIndex((p) => p.name === me.name);
    return i < 0 ? null : { pos: i + 1, score: sorted[i].score, lastPoints: sorted[i].lastPoints || 0 };
  }, [state, me]);

  const lockedChoice = result?.choice || null;

  const leave = () => {
    socket.emit('player:leave');
    try { localStorage.removeItem(LS_KEY); } catch {}
    setMe(null);
    setResult(null);
    setPending(null);
    setErr('');
  };

  if (checking) return <div className="phone"><div className="lbl">Opening the library…</div></div>;

  if (!me) {
    return (
      <div className="phone">
        <div className="mast">
          <span className="lbl">PBL Week 2026</span>
          <span className="lbl lbl--blood">BOOK26</span>
        </div>
        <div className="p-title">Interactive<br />Library Game</div>
        <div className="lbl">Read · Play · Discover</div>
        <hr className="rule-double" />
        <div className="lbl" style={{ marginTop: 6 }}>Your name</div>
        <input className="name" style={{ marginTop: 8 }} placeholder="e.g. Riya Sharma" value={name} onChange={(e) => setName(e.target.value)} maxLength={18} />
        {err && <div style={{ color: 'var(--bad)', marginTop: 8, fontSize: 14 }}>{err}</div>}
        <button className="btn btn-blood btn-block" style={{ marginTop: 12 }} onClick={join}>Join the game</button>
        <div className="small" style={{ marginTop: 8 }}>You land here straight from the main-screen QR.</div>
      </div>
    );
  }

  if (!state) return <div className="phone"><div className="lbl">Connecting…</div></div>;
  const r = state.round;

  return (
    <div className="phone">
      <div className="mast">
        <span className="lbl">BOOK26 · {(me.name || '').toUpperCase()}</span>
        {myRank && <span className="lbl lbl--blood mono-num">#{myRank.pos} · {myRank.score}</span>}
      </div>

      {state.phase === 'lobby' && (
        <div style={{ textAlign: 'center', marginTop: 26 }}>
          <div className="serif" style={{ fontWeight: 800, fontSize: 46 }}>You're in.</div>
          <p className="small">Waiting for the game to begin…</p>
          <hr className="rule-double" />
          <div className="lbl">Playing as {me.name}</div>
          <div className="lbl">In the library</div>
          <div className="serif" style={{ fontSize: 40 }}>{state.playerCount}</div>
          <button className="btn btn-quiet" style={{ marginTop: 10, padding: '10px 18px', fontSize: 13 }} onClick={leave}>
            Not you? Switch name
          </button>
        </div>
      )}

      {(state.phase === 'section-intro' || state.phase === 'round-intro') && (
        <div style={{ textAlign: 'center', marginTop: 22 }}>
          <div className="lbl lbl--blood">{state.phase === 'section-intro' ? `Section ${state.section ? String(state.section.index + 1).padStart(2, '0') : ''}` : r?.chapter}</div>
          <div className="serif" style={{ fontWeight: 800, fontSize: 38, lineHeight: 1.02 }}>
            {state.phase === 'section-intro' ? state.section?.title : r?.title}
          </div>
          {state.phase === 'section-intro'
            ? <div className="serif" style={{ fontStyle: 'italic', color: 'var(--ink-soft)' }}>{state.section?.tagline}</div>
            : <div className="lbl">{r?.points} pts · question next</div>}
          <div className="serif" style={{ fontWeight: 800, fontSize: 72 }}>{state.timer.remaining}</div>
        </div>
      )}

      {state.phase === 'memorize' && r && (
        <div style={{ marginTop: 12 }}>
          <div className="lbl lbl--blood">Look · {state.timer.remaining}s</div>
          <div className="timer-track" style={{ margin: '8px 0 12px' }}>
            <div style={{ width: `${state.timer.total ? (state.timer.remaining / state.timer.total) * 100 : 0}%` }} />
          </div>
          <div className="tiles tiles--auto" style={{ marginTop: 4 }}>
            {(r.memorizeIds || r.flashIds || []).map((id) => <Tile key={id} book={byId[id]} />)}
          </div>
          <p className="small">Memorize now — the question comes automatically.</p>
        </div>
      )}

      {state.phase === 'question' && r && (
        <div style={{ marginTop: 12 }}>
          <div className="lbl lbl--blood">Round {String(r.id).padStart(2, '0')} · {r.title}</div>
          <div className="p-ask">{r.question}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="serif mono-num" style={{ fontWeight: 800, fontSize: 52, color: state.timer.remaining <= 5 ? 'var(--oxblood)' : 'var(--ink)' }}>
              {state.timer.remaining}
            </span>
            <span className="lbl">seconds left</span>
          </div>
          {r.clues && <div className="lbl lbl--olive" style={{ marginTop: 6 }}>Clues · {r.clues.join(' — ')}</div>}
          {r.id === 6 && !lockedChoice && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '10px 0' }}>
              {['SAFE', 'RISK'].map((k) => (
                <button key={k} className={`pick ${risk === k ? 'sel' : ''}`} style={{ justifyContent: 'center' }} onClick={() => setRisk(k)}>
                  {k}{k === 'RISK' ? ' · bigger ±' : ' · safe'}
                </button>
              ))}
            </div>
          )}
          {r.puzzle && (
            <div style={{ marginTop: 10 }}>
              <div className="lbl lbl--olive">Clues · {r.puzzle.rules.join(' — ')}</div>
              <div className="puzzle-cards">
                {(r.puzzle.cards || []).map((c) => <PCard key={c.code} book={byId[c.id]} code={c.code} />)}
              </div>
              <Slots size={4} />
            </div>
          )}
          {!lockedChoice ? (
            <>
              {r.puzzle ? (
                <div className="strips">
                  {(r.options || []).map((o, i) => (
                    <button key={o} disabled={!state.timer.running} className={`strip ${pending === o ? 'sel' : ''}`} onClick={() => setPending(o)}>
                      <span className="n">{LETTERS[i] || (i + 1)}</span>
                      <OptionStrip option={o} cards={r.puzzle.cards} library={byId} />
                    </button>
                  ))}
                </div>
              ) : (
              <div className="picks">
                {(r.options || []).map((o, i) => (
                  <button key={o} disabled={!state.timer.running} className={`pick ${pending === o ? 'sel' : ''}`} onClick={() => setPending(o)}>
                    <span className="pk-n">{LETTERS[i] || (i + 1)}</span><span>{o}</span>
                  </button>
                ))}
              </div>
              )}
              <button className="btn btn-blood btn-block" style={{ marginTop: 12 }} disabled={!pending || !state.timer.running} onClick={submit}>
                Submit answer
              </button>
              <div className="small" style={{ marginTop: 6 }}>Faster correct earns more. Choose, then submit.</div>
            </>
          ) : (
            <div className="lockbox">
              <div className="lbl" style={{ color: '#EEDFAE' }}>Answer locked</div>
              <div className="t">{lockedChoice}</div>
              <div className="small" style={{ color: '#EEDFAE' }}>You answered in {result?.timeSec ?? '—'}s · waiting for reveal…</div>
            </div>
          )}
          {err && <div className="small" style={{ color: 'var(--bad)', marginTop: 6 }}>{err}</div>}
        </div>
      )}

      {state.phase === 'reveal' && r && (
        <div style={{ marginTop: 12 }}>
          <div className="lbl lbl--olive">Reveal</div>
          <div className="serif" style={{ fontWeight: 800, fontSize: 30 }}>Correct: {state.stats?.correctAnswer}</div>
          {r.puzzle && (
            <div className="strips">
              {(r.options || []).map((o, i) => {
                const hit = o === state.stats?.correctAnswer;
                const miss = !hit && lockedChoice === o;
                return (
                  <div key={o} className={`strip ${hit ? 'hit' : ''} ${miss ? 'miss' : ''}`}>
                    <span className="n">{LETTERS[i] || (i + 1)}</span>
                    <OptionStrip option={o} cards={r.puzzle.cards} library={byId} />
                  </div>
                );
              })}
            </div>
          )}
          <div className="small">You · {lockedChoice || 'no answer'} · {state.stats ? `${state.stats.correct}/${state.stats.total} correct` : ''}</div>
          {myRank && myRank.lastPoints > 0 && (
            <div className="serif bump" style={{ fontWeight: 800, fontSize: 46, color: 'var(--oxblood)' }}>+{myRank.lastPoints}</div>
          )}
          {myRank && <div className="small">Score {myRank.score} · #{myRank.pos}</div>}
          <hr className="rule-double" />
          <div className="lbl lbl--blood">Book discovery</div>
          <DiscoveryFlip book={byId[r.discoveryId]} />
        </div>
      )}

      {state.phase === 'discovery' && r && (
        <div style={{ marginTop: 12 }}>
          <div className="lbl lbl--blood">Book discovery</div>
          <DiscoveryFlip book={byId[r.discoveryId]} defaultOpen />
          {myRank && <div className="small" style={{ marginTop: 8 }}>Your score · <b>{myRank.score}</b> · <b>#{myRank.pos}</b></div>}
        </div>
      )}

      {state.phase === 'leaderboard' && (
        <div style={{ marginTop: 12 }}>
          <div className="lbl lbl--olive">Library rankings</div>
          <div className="card" style={{ border: '1px solid var(--line-dark)', background: 'var(--card)', padding: 12, margin: '10px 0', textAlign: 'center', borderRadius: 2 }}>
            YOUR SCORE · <b className="mono-num">{myRank?.score ?? 0}</b> · <b className="mono-num">#{myRank?.pos ?? '—'}</b>
          </div>
          {[...(state.players || [])].sort((a, b) => b.score - a.score).slice(0, 5).map((p, i) => (
            <div key={p.name} style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '9px 2px', borderBottom: '1px solid var(--line)' }}>
              <span className="serif" style={{ fontStyle: 'italic', color: i === 0 ? 'var(--oxblood)' : 'var(--ink-soft)', fontSize: 22 }}>{String(i + 1).padStart(2, '0')}</span>
              <span style={{ fontWeight: 700 }}>{p.name}</span>
              <span className="serif mono-num" style={{ marginLeft: 'auto', fontWeight: 800, fontSize: 20 }}>{p.score}</span>
            </div>
          ))}
        </div>
      )}

      {state.phase === 'finished' && (
        <div style={{ textAlign: 'center', marginTop: 22 }}>
          <div className="lbl lbl--blood">Closing page</div>
          <div className="serif" style={{ fontWeight: 800, fontSize: 40 }}>Library Champions</div>
          {(state.players || []).slice(0, 3).map((p, i) => (
            <div key={p.name} style={{ padding: 4 }}>{['1st', '2nd', '3rd'][i]} · <b>{p.name}</b> — <b className="mono-num">{p.score}</b></div>
          ))}
          <div className="small" style={{ marginTop: 8 }}>Thanks for playing — keep reading.</div>
        </div>
      )}
    </div>
  );
}
