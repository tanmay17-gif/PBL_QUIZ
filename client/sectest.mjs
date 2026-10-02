import { io } from 'socket.io-client';
const URL = 'http://localhost:3001';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error('FAIL:', m); process.exit(1); };
const full = await fetch(URL + '/api/rounds/full');
console.log('/api/rounds/full →', full.status);
if (full.status !== 404) fail('answer endpoint still live');
const rounds = await fetch(URL + '/api/rounds').then((r) => r.json());
if (JSON.stringify(rounds).includes('correctAnswer')) fail('answers leak via /api/rounds');
console.log('PUBLIC ROUNDS OK — no correctAnswer');
const h = await fetch(URL + '/api/health');
if (h.headers.get('x-powered-by')) fail('x-powered-by leaked');
if (!h.headers.get('x-content-type-options')) fail('helmet headers missing');
console.log('HEADERS OK');
const a1 = io(URL); const a2 = io(URL); await wait(400);
const noCode = await new Promise((r) => a1.emit('admin:claim', {}, r));
const wrongCode = await new Promise((r) => a1.emit('admin:claim', { code: '0000' }, r));
console.log('no-code reason:', noCode.reason, '| wrong-code reason:', wrongCode.reason);
if (noCode.ok || noCode.reason !== 'HOST_AUTH_REQUIRED') fail('code gate bypassed (no code)');
if (wrongCode.ok) fail('code gate bypassed (wrong code)');
const good = await new Promise((r) => a1.emit('admin:claim', { code: 'LIB26' }, r));
if (!good.ok) fail('valid code rejected');
const second = await new Promise((r) => a2.emit('admin:claim', { code: 'LIB26' }, r));
if (second.ok || second.reason !== 'HOST_ALREADY_ACTIVE') fail('single-host broken');
a2.emit('admin:start-game');
await wait(600);
const probe = await new Promise((r) => {
  const s = io(URL); s.on('game:state', (st) => { r(st); s.close(); }); setTimeout(() => r(null), 2000);
});
if (!probe || probe.phase !== 'lobby') fail('denied host affected game!');
console.log('CODE GATE OK — required, enforced, single host intact');
const s1 = io(URL); await wait(200);
await new Promise((r) => s1.emit('player:join', { name: 'LeakCheck', code: 'BOOK26' }, r));
const st2 = await new Promise((r) => {
  const s = io(URL); s.on('game:state', (st) => { r(st); s.close(); }); setTimeout(() => r(null), 2000);
});
if (JSON.stringify(st2.players).includes('token')) fail('session material broadcast');
console.log('TOKENS OK — not in public state');
const main = io(URL); await wait(300);
const phases = [];
main.on('game:state', (s) => {
  const l = phases[phases.length - 1];
  if (!l || l.phase !== s.phase || l.roundIndex !== s.roundIndex) phases.push({ phase: s.phase, round: s.roundIndex });
});
const students = [s1];
for (let i = 0; i < 4; i++) {
  const s = io(URL); await wait(80);
  await new Promise((r) => s.emit('player:join', { name: `R${i + 2}`, code: 'BOOK26' }, r));
  students.push(s);
}
a1.emit('admin:start-game');
const t0 = Date.now();
while (Date.now() - t0 < 45000) { await wait(800); const c = phases[phases.length - 1]; if (c && c.phase === 'question') break; }
if (!phases.some((p) => p.phase === 'question')) fail('no question');
const ans = (s, choice, d) => wait(d).then(() => new Promise((r) => s.emit('player:answer', { choice }, r)));
await Promise.all([ans(students[0], 'The Hobbit', 300), ans(students[1], 'The Hobbit', 2000), ans(students[2], '1984', 200)]);
const t1 = Date.now();
let board = null;
while (Date.now() - t1 < 60000) {
  await wait(1000);
  const c = phases[phases.length - 1];
  if (c && c.phase === 'leaderboard') {
    board = await new Promise((r) => {
      const s = io(URL); s.on('game:state', (st) => { r(st.players); s.close(); }); setTimeout(() => r(null), 2000);
    });
    break;
  }
}
const pts = Object.fromEntries((board || []).map((p) => [p.name, p.score]));
console.log('SCORES:', JSON.stringify(pts));
if (!(pts.LeakCheck > pts.R2)) fail('speed scoring broken');
console.log('FLOW OK:', phases.map((p) => p.phase).join(' > '));
console.log('ALL TESTS PASSED');
[a1, a2, main, ...students].forEach((s) => s.close());
process.exit(0);
