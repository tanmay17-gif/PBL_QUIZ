import React, { useEffect, useState } from 'react';
import { socket } from '../socket.js';
import { RankingWall } from '../components/ui.jsx';

const LS_HOST = 'lib-host';

export default function Admin() {
  const [state, setState] = useState(null);
  const [host, setHost] = useState(null); // null = claiming, 'active', 'denied', 'auth'
  const [code, setCode] = useState('');
  const [authErr, setAuthErr] = useState('');

  const doClaim = (hostCode) => {
    const saved = (() => { try { return JSON.parse(sessionStorage.getItem(LS_HOST) || 'null'); } catch { return null; } })();
    socket.emit('admin:claim', { token: saved?.hostToken, code: hostCode ?? saved?.hostCode ?? '' }, (res) => {
      if (res?.ok) {
        setHost('active');
        setAuthErr('');
        try { sessionStorage.setItem(LS_HOST, JSON.stringify({ hostToken: res.hostToken, hostCode: hostCode ?? saved?.hostCode ?? '' })); } catch {}
      } else if (res?.reason === 'HOST_AUTH_REQUIRED') {
        setHost('auth');
        if (hostCode !== undefined) setAuthErr('Wrong host code. Try again.');
      } else {
        setHost('denied');
      }
    });
  };

  useEffect(() => {
    doClaim();
    const onDenied = () => setHost((h) => (h === 'active' ? h : 'denied'));
    socket.on('admin:denied', onDenied);
    const beat = setInterval(() => {
      const s = (() => { try { return JSON.parse(sessionStorage.getItem(LS_HOST) || 'null'); } catch { return null; } })();
      if (!s?.hostToken) return;
      socket.emit('admin:heartbeat', { token: s.hostToken }, (res) => {
        // heartbeat lost (server restarted?) → try to reclaim in the background
        if (!res?.ok) socket.emit('admin:claim', { token: s.hostToken, code: s.hostCode || '' }, (r2) => { if (r2?.ok) setHost('active'); });
      });
    }, 15000);
    const onState = (s) => setState(s);
    socket.on('game:state', onState);
    return () => {
      clearInterval(beat);
      socket.off('admin:denied', onDenied);
      socket.off('game:state', onState);
    };
  }, []);

  if (!state || !host) return <div className="admin"><div className="lbl">Connecting…</div></div>;
  const inLobby = state.phase === 'lobby';
  const done = state.phase === 'finished';
  const live = !inLobby && !done;
  const top = [...state.players].sort((a, b) => b.score - a.score).slice(0, 5);

  return (
    <div className="admin" style={{ maxWidth: 680 }}>
      <div className="lbl lbl--blood">Admin · PBL Week 2026</div>
      <div className="big">Interactive<br />Library Game</div>

      {host === 'auth' && (
        <div className="card" style={{ border: '1px solid var(--line-dark)', background: 'var(--card)', padding: 20, marginTop: 12, borderRadius: 2 }}>
          <div className="lbl lbl--blood">Host code required</div>
          <div className="serif" style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>Enter the host code to control this game.</div>
          <input className="name" style={{ marginTop: 12 }} type="password" inputMode="numeric" placeholder="Host code"
            value={code} onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doClaim(code); }} />
          {authErr && <div style={{ color: 'var(--bad)', marginTop: 8, fontSize: 14 }}>{authErr}</div>}
          <button className="btn btn-blood btn-block" style={{ marginTop: 12 }} onClick={() => doClaim(code)}>Take control</button>
        </div>
      )}
      {host === 'denied' && (
        <div className="card" style={{ border: '1px solid var(--line-dark)', background: 'var(--card)', padding: 20, marginTop: 12, borderRadius: 2 }}>
          <div className="lbl lbl--blood">Host already active</div>
          <div className="serif" style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>This game is currently being controlled by another host.</div>
          <div className="small" style={{ marginTop: 6 }}>You are watching read-only. If the host disconnects, reload this page after ~45 seconds to take over.</div>
          <button className="btn btn-quiet" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>Retry take-over</button>
        </div>
      )}

      {/* live scoreboard — same server state as the main screen, no refresh */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 16, textAlign: 'center' }}>
        <div>
          <div className="lbl">Players</div>
          <div className="serif mono-num" style={{ fontSize: 44, fontWeight: 800 }}>{state.playerCount}</div>
        </div>
        <div>
          <div className="lbl">Current round</div>
          <div className="serif mono-num" style={{ fontSize: 44, fontWeight: 800 }}>
            {inLobby ? '—' : `${String(state.roundIndex + 1).padStart(2, '0')} / 10`}
          </div>
        </div>
        <div>
          <div className="lbl">Answers</div>
          <div className="serif mono-num" style={{ fontSize: 44, fontWeight: 800 }}>
            {state.answersReceived} / {state.playerCount}
          </div>
        </div>
      </div>
      {live && <div className="lbl" style={{ marginTop: 6 }}>{state.round?.title || state.section?.title || ''} · {state.phase.replace('-', ' ')}{state.paused ? ' · paused' : ''}</div>}

      <div style={{ textAlign: 'left', marginTop: 8 }}>
        <div className="lbl lbl--olive">The library rankings · live</div>
        <RankingWall players={state.players} />
      </div>

      {host === 'active' && inLobby && (
        <>
          <button className="btn btn-blood btn-block" style={{ marginTop: 20 }} onClick={() => socket.emit('admin:start-game')}>
            Start game
          </button>
          <div className="small" style={{ marginTop: 8 }}>One click — the main screen runs all 10 rounds itself.</div>
        </>
      )}

      {host === 'active' && live && (
        <div className="row">
          {!state.paused
            ? <button className="btn btn-quiet" onClick={() => socket.emit('admin:pause')}>Pause</button>
            : <button className="btn btn-ink" onClick={() => socket.emit('admin:resume')}>Resume</button>}
          <button className="btn btn-quiet" onClick={() => socket.emit('admin:end-game')}>End game</button>
        </div>
      )}

      {host === 'active' && done && (
        <button className="btn btn-blood btn-block" style={{ marginTop: 18 }} onClick={() => socket.emit('admin:reset')}>
          Back to lobby
        </button>
      )}
    </div>
  );
}
