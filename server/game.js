import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const books = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'books.json'), 'utf8'));
const rawRounds = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'rounds.json'), 'utf8'));

export const SECTIONS = [
  { index: 0, title: 'Remember the Shelf', tagline: 'Look once. Trust your memory.', rounds: [0, 1] },
  { index: 1, title: 'Book Spotter', tagline: 'Read the shelf. Find the odd one.', rounds: [2, 3] },
  { index: 2, title: 'Mystery Book', tagline: "Can you guess what's behind the cover?", rounds: [4, 5] },
  { index: 3, title: 'Quick Eyes', tagline: 'A glance is all you get.', rounds: [6, 7] },
  { index: 4, title: 'The Final Shelf', tagline: 'Memory. Eyes. Logic. Everything.', rounds: [8, 9] },
];

const booksById = Object.fromEntries(books.map((b) => [b.id, b]));
const rounds = rawRounds.map((r, i) => ({
  ...r,
  sectionIndex: SECTIONS.findIndex((s) => s.rounds.includes(i)),
  discovery: booksById[r.discoveryId] || null,
}));

export function getBooks() { return books; }
export function getRounds() { return rounds; }
export function getPublicRounds() {
  return rounds.map((r) => {
    const { correctAnswer, ...rest } = r;
    return rest;
  });
}

// Timing (seconds)
export const TIMING = {
  sectionIntro: 5,
  roundIntro: 5,
  reveal: 6,
  discovery: 7,
  leaderboard: 7,
};

function sectionOf(roundIdx) {
  return SECTIONS.find((s) => s.rounds.includes(roundIdx)) || SECTIONS[0];
}

function publicPlayers(state) {
  // NOTE: session tokens are never broadcast — they would allow session hijack.
  return [...state.playersByToken.values()]
    .map((p) => ({ name: p.name, score: p.score, connected: p.connected, lastPoints: p.lastPoints || 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function publicRound(state, isHost) {
  if (state.roundIndex < 0 || state.roundIndex >= rounds.length) return null;
  const full = rounds[state.roundIndex];
  const showAnswer = isHost || ['reveal', 'discovery', 'leaderboard', 'finished'].includes(state.phase);
  const pub = { ...full };
  if (!showAnswer) delete pub.correctAnswer;
  // Never leak full discovery facts on projector during challenge.
  // Projector only needs title for reveal; student gets full card via discovery lookup.
  if (!isHost && ['memorize', 'question', 'round-intro', 'section-intro'].includes(state.phase)) {
    delete pub.discovery;
    delete pub.hostNote;
  }
  return pub;
}

export function publicState(state, isHost = false) {
  return {
    code: state.code,
    phase: state.phase,
    paused: state.paused,
    roundIndex: state.roundIndex,
    totalRounds: rounds.length,
    section: state.roundIndex >= 0 ? sectionOf(state.roundIndex) : null,
    round: publicRound(state, isHost),
    timer: { ...state.timer },
    answersReceived: state.answersReceived,
    playerCount: state.playersByToken.size,
    players: publicPlayers(state),
    stats: state.stats,
    lockAnswers: state.lockAnswers,
    hostActive: !!state.hostSocketId,
  };
}

function uniqueName(state, base) {
  const clean = (base || '').trim().slice(0, 18) || 'Reader';
  const taken = new Set([...state.playersByToken.values()].map((p) => p.name.toLowerCase()));
  if (!taken.has(clean.toLowerCase())) return clean;
  let i = 2;
  while (taken.has(`${clean} ${i}`.toLowerCase())) i += 1;
  return `${clean} ${i}`;
}

// ---------- ONE ACTIVE HOST (server-enforced, not ports) ----------
const HOST_GRACE_MS = 45000;
function newHostToken() {
  const r = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  return `host_${r}`;
}

export function attachGame(io) {
  // Host passcode for public deployments. Unset = open claim (local dev only).
  const ADMIN_CODE = process.env.ADMIN_CODE || '';
  const state = {
    code: 'BOOK26',
    phase: 'lobby',
    paused: false,
    pausedFrom: null,
    roundIndex: -1,
    timer: { remaining: 0, total: 0, running: false },
    answersReceived: 0,
    stats: null,
    playersByToken: new Map(), // token -> player
    socketToToken: new Map(), // socketId -> token
    questionStartedAt: 0,
    questionDurationMs: 0,
    correctCount: 0,
    // single active host session
    hostToken: null,
    hostSocketId: null,
    hostLastSeen: 0,
    // engine handles
    phaseTimeout: null,
    tickInterval: null,
    phaseEndsAt: 0,
    resumeFn: null,
    resumeRemainingMs: 0,
  };

  const emit = (name, payload) => io.emit(name, payload);

  function syncAll() {
    io.emit('game:state', publicState(state, false));
    io.to('hosts').emit('game:host', { ...publicState(state, true), answers: answerDump() });
  }

  function answerDump() {
    const out = [];
    for (const p of state.playersByToken.values()) {
      const a = p.answers[state.roundIndex];
      if (a) out.push({ name: p.name, choice: a.choice, correct: a.correct, points: a.points, timeSec: a.timeSec, risk: a.risk || null });
    }
    return out.sort((a, b) => b.points - a.points);
  }

  function clearEngine() {
    if (state.phaseTimeout) { clearTimeout(state.phaseTimeout); state.phaseTimeout = null; }
    if (state.tickInterval) { clearInterval(state.tickInterval); state.tickInterval = null; }
  }

  function setTimer(totalSec) {
    state.timer = { remaining: totalSec, total: totalSec, running: true };
  }

  function startTick() {
    if (state.tickInterval) clearInterval(state.tickInterval);
    state.tickInterval = setInterval(() => {
      const msLeft = Math.max(0, state.phaseEndsAt - Date.now());
      state.timer.remaining = Math.ceil(msLeft / 1000);
      io.emit('game:timer', { ...state.timer });
      if (msLeft <= 0 && state.tickInterval) {
        clearInterval(state.tickInterval);
        state.tickInterval = null;
      }
    }, 250);
  }

  function after(ms, fn) {
    clearEngine();
    state.phaseEndsAt = Date.now() + ms;
    startTick();
    state.resumeFn = fn;
    state.phaseTimeout = setTimeout(() => {
      state.phaseTimeout = null;
      if (state.tickInterval) { clearInterval(state.tickInterval); state.tickInterval = null; }
      fn();
    }, ms);
    state.resumeRemainingMs = ms;
  }

  // ---------- scoring: correct + faster = more ----------
  function scoreFor(round, remainingMs, durationMs, risk) {
    const correctRank = state.correctCount; // 0-based before increment
    const ratio = durationMs > 0 ? Math.max(0, Math.min(1, remainingMs / durationMs)) : 0;
    let base = round.points;
    if (round.id === 6) base = risk === 'RISK' ? (round.riskPoints ?? 400) : round.points;
    const speedPoints = Math.round(base * (0.5 + 0.5 * ratio));
    const rankBonus = correctRank === 0 ? 25 : correctRank === 1 ? 15 : correctRank === 2 ? 10 : 0;
    return speedPoints + rankBonus;
  }

  // ---------- automatic flow ----------
  function runSectionIntro(roundIdx) {
    if (state.paused) return;
    state.roundIndex = roundIdx;
    state.phase = 'section-intro';
    state.section = sectionOf(roundIdx);
    state.stats = null;
    state.answersReceived = 0;
    state.lockAnswers = true;
    setTimer(TIMING.sectionIntro);
    emit('SECTION_INTRO', { roundIndex: roundIdx, section: sectionOf(roundIdx) });
    emit('SECTION_STARTED', { roundIndex: roundIdx, section: sectionOf(roundIdx) });
    emit('NEXT_ROUND', { roundIndex: roundIdx });
    syncAll();
    after(TIMING.sectionIntro * 1000, () => runRoundIntro(roundIdx));
  }

  function runRoundIntro(roundIdx) {
    if (state.paused) return;
    state.roundIndex = roundIdx;
    state.phase = 'round-intro';
    state.stats = null;
    state.answersReceived = 0;
    state.lockAnswers = true;
    setTimer(TIMING.roundIntro);
    emit('ROUND_STARTED', { roundIndex: roundIdx, roundId: rounds[roundIdx].id });
    emit('NEXT_ROUND', { roundIndex: roundIdx, roundId: rounds[roundIdx].id });
    syncAll();
    after(TIMING.roundIntro * 1000, () => {
      const round = rounds[roundIdx];
      if (round.memorizeIds || round.flashIds) runMemorize(roundIdx);
      else runQuestion(roundIdx);
    });
  }

  function runMemorize(roundIdx) {
    if (state.paused) return;
    const round = rounds[roundIdx];
    state.phase = 'memorize';
    state.lockAnswers = true;
    const secs = round.memorizeTime || round.flashTime || 8;
    setTimer(secs);
    emit('TIMER_STARTED', { phase: 'memorize', seconds: secs, roundIndex: roundIdx });
    syncAll();
    after(secs * 1000, () => runQuestion(roundIdx));
  }

  function runQuestion(roundIdx) {
    if (state.paused) return;
    const round = rounds[roundIdx];
    // reset answers for this round
    for (const p of state.playersByToken.values()) {
      delete p.answers[roundIdx];
      p.lastPoints = 0;
    }
    state.correctCount = 0;
    state.phase = 'question';
    state.lockAnswers = false;
    state.answersReceived = 0;
    state.questionStartedAt = Date.now();
    state.questionDurationMs = (round.timeLimit || 20) * 1000;
    setTimer(round.timeLimit || 20);
    emit('TIMER_STARTED', { phase: 'question', seconds: round.timeLimit || 20, roundIndex: roundIdx });
    emit('QUESTION_STARTED', { seconds: round.timeLimit || 20, roundIndex: roundIdx });
    syncAll();
    after(state.questionDurationMs, () => lockAndReveal());
  }

  function lockAndReveal() {
    if (state.paused) return;
    const round = rounds[state.roundIndex];
    state.phase = 'reveal';
    state.lockAnswers = true;
    state.timer.running = false;
    state.timer.remaining = 0;
    const counts = {};
    for (const o of round.options) counts[o] = 0;
    let correct = 0;
    for (const p of state.playersByToken.values()) {
      const a = p.answers[state.roundIndex];
      if (a) {
        counts[a.choice] = (counts[a.choice] || 0) + 1;
        if (a.correct) correct += 1;
      }
    }
    state.stats = { counts, correct, total: state.playersByToken.size, correctAnswer: round.correctAnswer };
    emit('ROUND_LOCKED', { roundIndex: state.roundIndex, answersReceived: state.answersReceived });
    emit('ANSWER_REVEALED', { roundIndex: state.roundIndex, correctAnswer: round.correctAnswer, stats: state.stats });
    emit('SCORES_UPDATED', { players: publicPlayers(state) });
    setTimer(TIMING.reveal);
    syncAll();
    after(TIMING.reveal * 1000, () => runDiscovery());
  }

  function runDiscovery() {
    if (state.paused) return;
    state.phase = 'discovery';
    setTimer(TIMING.discovery);
    emit('DISCOVERY_STARTED', { roundIndex: state.roundIndex, discoveryId: rounds[state.roundIndex].discoveryId });
    syncAll();
    after(TIMING.discovery * 1000, () => runLeaderboard());
  }

  function runLeaderboard() {
    if (state.paused) return;
    state.phase = 'leaderboard';
    setTimer(TIMING.leaderboard);
    emit('LEADERBOARD_UPDATED', { players: publicPlayers(state), roundIndex: state.roundIndex });
    syncAll();
    after(TIMING.leaderboard * 1000, () => {
      if (state.roundIndex + 1 >= rounds.length) {
        state.phase = 'finished';
        state.timer = { remaining: 0, total: 0, running: false };
        emit('GAME_COMPLETED', { players: publicPlayers(state) });
        syncAll();
        return;
      }
      const next = state.roundIndex + 1;
      const newSection = sectionOf(next).index !== sectionOf(state.roundIndex).index;
      if (newSection) runSectionIntro(next);
      else runRoundIntro(next);
    });
  }

  // Join flood protection: max 8 new joins per IP per minute.
  const joinAttempts = new Map();
  function joinAllowed(ip) {
    const now = Date.now();
    const arr = (joinAttempts.get(ip) || []).filter((t) => now - t < 60000);
    if (arr.length >= 8) {
      joinAttempts.set(ip, arr);
      return false;
    }
    arr.push(now);
    if (joinAttempts.size > 5000) joinAttempts.clear();
    joinAttempts.set(ip, arr);
    return true;
  }

  io.on('connection', (socket) => {
    socket.emit('catalog', { books, rounds: getPublicRounds(), sections: SECTIONS, timing: TIMING });
    socket.emit('game:state', publicState(state, false));

    socket.on('host:join', () => {
      socket.join('hosts');
      socket.emit('game:host', { ...publicState(state, true), answers: answerDump() });
    });

    socket.on('player:join', ({ name, code, token }, cb) => {
      if ((code || '').toUpperCase() !== state.code) {
        cb?.({ ok: false, error: 'Wrong game code. Use BOOK26.' });
        return;
      }
      if (state.phase === 'finished') {
        cb?.({ ok: false, error: 'Game has ended.' });
        return;
      }
      // 1) token reconnect — never duplicate
      if (token && state.playersByToken.has(token)) {
        const p = state.playersByToken.get(token);
        if (p.socketId) state.socketToToken.delete(p.socketId);
        p.socketId = socket.id;
        p.connected = true;
        state.socketToToken.set(socket.id, token);
        if (name && name.trim() && name.trim() !== p.name) {
          // keep original name to avoid confusion on refresh
        }
        cb?.({ ok: true, player: { name: p.name, score: p.score, token: p.token }, reconnected: true });
        emit('PLAYER_JOINED', { name: p.name, playerCount: state.playersByToken.size, reconnected: true });
        syncAll();
        return;
      }
      const clean = (name || '').trim();
      if (!clean) {
        cb?.({ ok: false, error: 'Enter your name.' });
        return;
      }
      // 2) stale-socket reconnect by name (refresh race): if same name exists but disconnected, adopt it
      const byName = [...state.playersByToken.values()].find((p) => p.name.toLowerCase() === clean.toLowerCase());
      if (byName && byName.connected === false) {
        if (byName.socketId) state.socketToToken.delete(byName.socketId);
        byName.socketId = socket.id;
        byName.connected = true;
        state.socketToToken.set(socket.id, byName.token);
        cb?.({ ok: true, player: { name: byName.name, score: byName.score, token: byName.token }, reconnected: true });
        emit('PLAYER_JOINED', { name: byName.name, playerCount: state.playersByToken.size, reconnected: true });
        syncAll();
        return;
      }
      // 3) new player (duplicate active name gets suffix)
      if (state.playersByToken.size >= 500) {
        cb?.({ ok: false, error: 'Lobby is full.' });
        return;
      }
      if (!joinAllowed(socket.handshake.address || 'unknown')) {
        cb?.({ ok: false, error: 'Too many join attempts. Wait a moment and retry.' });
        return;
      }
      const finalName = uniqueName(state, clean);
      const newToken = crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
      // same socket joining as someone new (name switch): retire the old identity
      const prevToken = state.socketToToken.get(socket.id);
      if (prevToken && prevToken !== newToken) {
        const prevP = state.playersByToken.get(prevToken);
        if (prevP) prevP.connected = false;
      }
      const player = {
        token: newToken, name: finalName, score: 0, socketId: socket.id,
        connected: true, answers: {}, lastPoints: 0, box: null,
      };
      state.playersByToken.set(newToken, player);
      state.socketToToken.set(socket.id, newToken);
      cb?.({ ok: true, player: { name: finalName, score: 0, token: newToken } });
      emit('GAME_CREATED', { code: state.code });
      emit('PLAYER_JOINED', { name: finalName, playerCount: state.playersByToken.size });
      syncAll();
    });

    socket.on('player:leave', () => {
      const t = state.socketToToken.get(socket.id);
      if (t) {
        const p = state.playersByToken.get(t);
        if (p && p.socketId === socket.id) p.connected = false;
        state.socketToToken.delete(socket.id);
        syncAll();
      }
    });

    socket.on('player:sync', ({ token }, cb) => {
      const p = token && state.playersByToken.get(token);
      if (!p) {
        cb?.({ ok: false });
        return;
      }
      // rebind socket on refresh
      if (p.socketId) state.socketToToken.delete(p.socketId);
      p.socketId = socket.id;
      p.connected = true;
      state.socketToToken.set(socket.id, token);
      cb?.({
        ok: true,
        player: { name: p.name, score: p.score, token: p.token },
        answers: p.answers,
        state: publicState(state, false),
      });
      syncAll();
    });

    socket.on('player:answer', ({ choice, risk }, cb) => {
      const token = state.socketToToken.get(socket.id);
      const p = token && state.playersByToken.get(token);
      if (!p) {
        cb?.({ ok: false, error: 'Not joined.' });
        return;
      }
      if (state.phase !== 'question') {
        cb?.({ ok: false, error: state.phase === 'memorize' ? 'Wait for the question.' : 'Not accepting answers now.' });
        return;
      }
      if (state.lockAnswers || !state.timer.running) {
        cb?.({ ok: false, error: 'Time is up.' });
        return;
      }
      if (p.answers[state.roundIndex]) {
        cb?.({ ok: false, error: 'Already locked.' });
        return;
      }
      const round = rounds[state.roundIndex];
      if (!round || !round.options.includes(choice)) {
        cb?.({ ok: false, error: 'Invalid choice.' });
        return;
      }
      const now = Date.now();
      const elapsedMs = now - state.questionStartedAt;
      const remainingMs = Math.max(0, state.questionDurationMs - elapsedMs);
      const timeSec = Math.round((elapsedMs / 100) / 10) / 10 + 0; // 0.1s precision
      const correct = choice === round.correctAnswer;
      let points = 0;
      if (correct) {
        points = scoreFor(round, remainingMs, state.questionDurationMs, risk);
        state.correctCount += 1;
      } else if (round.id === 6 && risk === 'RISK') {
        points = round.riskPenalty ?? -100;
      }
      p.answers[state.roundIndex] = { choice, correct, points, timeSec: Math.round(elapsedMs / 100) / 10, risk: risk || null, at: now };
      p.score = Math.max(0, p.score + points);
      p.lastPoints = points;
      state.answersReceived += 1;
      socket.emit('player:result', { choice, correct, points, timeSec: p.answers[state.roundIndex].timeSec });
      emit('ANSWER_SUBMITTED', { name: p.name, answersReceived: state.answersReceived });
      cb?.({ ok: true, locked: choice, timeSec: p.answers[state.roundIndex].timeSec, pointsPreview: correct ? undefined : 0 });
      syncAll();
    });

    socket.on('player:box', ({ box }) => {
      const token = state.socketToToken.get(socket.id);
      const p = token && state.playersByToken.get(token);
      if (p) {
        p.box = box;
        syncAll();
      }
    });

    // ---------- ADMIN: one-button + minimal secondary (also aliased as admin:*) ----------
    // Single active host: first claim (or first control) wins; others are denied.
    function grantHost(keepToken) {
      state.hostToken = keepToken || newHostToken();
      state.hostSocketId = socket.id;
      state.hostLastSeen = Date.now();
      socket.data.isHost = true;
      return state.hostToken;
    }
    function hostSessionExpired() {
      return !!state.hostToken && !state.hostSocketId && (Date.now() - state.hostLastSeen > HOST_GRACE_MS);
    }
    function requireHost(cb) {
      if (state.hostToken && socket.data.isHost && socket.id === state.hostSocketId) {
        state.hostLastSeen = Date.now();
        return true;
      }
      if (!state.hostToken || hostSessionExpired()) {
        if (ADMIN_CODE) {
          socket.emit('admin:denied', { reason: 'HOST_AUTH_REQUIRED' });
          cb?.({ ok: false, error: 'HOST_AUTH_REQUIRED' });
          return false;
        }
        grantHost(); // first-come becomes host (no code configured)
        return true;
      }
      socket.emit('admin:denied', { reason: 'HOST_ALREADY_ACTIVE' });
      cb?.({ ok: false, error: 'HOST_ALREADY_ACTIVE' });
      return false;
    }

    socket.on('admin:claim', ({ token, code }, cb) => {
      if (ADMIN_CODE && code !== ADMIN_CODE && token !== state.hostToken) {
        cb?.({ ok: false, reason: 'HOST_AUTH_REQUIRED', error: 'Enter the host code to take control.' });
        return;
      }
      if (state.hostToken && token && token === state.hostToken) {
        grantHost(token); // recovery with the same token
        cb?.({ ok: true, hostToken: state.hostToken, recovered: true });
        syncAll();
        return;
      }
      if (!state.hostToken || hostSessionExpired()) {
        const t = grantHost();
        emit('HOST_CHANGED', { hostActive: true });
        cb?.({ ok: true, hostToken: t });
        syncAll();
        return;
      }
      cb?.({ ok: false, reason: 'HOST_ALREADY_ACTIVE', error: 'This game is currently being controlled by another host.' });
    });

    socket.on('admin:heartbeat', ({ token }, cb) => {
      if (token && token === state.hostToken && socket.id === state.hostSocketId) {
        state.hostLastSeen = Date.now();
        cb?.({ ok: true });
        return;
      }
      cb?.({ ok: false });
    });

    function doStartGame() {
      if (state.phase !== 'lobby') return;
      clearEngine();
      state.paused = false;
      emit('GAME_STARTED', { playerCount: state.playersByToken.size });
      runSectionIntro(0);
    }

    function doPause() {
      if (state.paused || state.phase === 'lobby' || state.phase === 'finished') return;
      state.paused = true;
      state.pausedFrom = state.phase;
      const msLeft = Math.max(0, state.phaseEndsAt - Date.now());
      state.resumeRemainingMs = msLeft;
      clearEngine();
      state.timer.running = false;
      syncAll();
    }

    function doResume() {
      if (!state.paused) return;
      state.paused = false;
      const fn = state.resumeFn;
      state.timer.running = true;
      if (!fn) {
        syncAll();
        return;
      }
      const ms = Math.max(500, state.resumeRemainingMs);
      after(ms, fn);
      syncAll();
    }

    function doEndGame() {
      clearEngine();
      state.paused = false;
      state.phase = 'finished';
      state.timer = { remaining: 0, total: 0, running: false };
      emit('GAME_COMPLETED', { players: publicPlayers(state) });
      syncAll();
    }

    function doReset() {
      clearEngine();
      state.phase = 'lobby';
      state.paused = false;
      state.roundIndex = -1;
      state.timer = { remaining: 0, total: 0, running: false };
      state.answersReceived = 0;
      state.stats = null;
      state.playersByToken = new Map();
      state.socketToToken = new Map();
      state.lockAnswers = true;
      emit('GAME_CREATED', { code: state.code });
      syncAll();
    }

    const guarded = (fn) => (payload, cb) => { if (requireHost(cb)) fn(); };
    socket.on('host:start-game', guarded(doStartGame));
    socket.on('admin:start-game', guarded(doStartGame));
    socket.on('host:pause', guarded(doPause));
    socket.on('admin:pause', guarded(doPause));
    socket.on('host:resume', guarded(doResume));
    socket.on('admin:resume', guarded(doResume));
    socket.on('host:reset', guarded(doReset));
    socket.on('admin:reset', guarded(doReset));
    socket.on('host:end-game', guarded(doEndGame));
    socket.on('admin:end-game', guarded(doEndGame));

    // legacy no-op guards (old dashboard buttons) — map to auto engine safely
    socket.on('host:create', () => socket.emit('host:reset'));
    socket.on('host:start-round', () => {});
    socket.on('host:start-challenge', () => {});
    socket.on('host:reveal', () => {});
    socket.on('host:discovery', () => {});
    socket.on('host:leaderboard', () => {});
    socket.on('host:next-round', () => {});

    socket.on('disconnect', () => {
      if (socket.id === state.hostSocketId) {
        // keep the token: the same host may recover within the grace period
        state.hostSocketId = null;
        state.hostLastSeen = Date.now();
      }
      const token = state.socketToToken.get(socket.id);
      if (token) {
        const p = state.playersByToken.get(token);
        if (p && p.socketId === socket.id) p.connected = false;
        state.socketToToken.delete(socket.id);
        syncAll();
      }
    });
  });

  return state;
}
