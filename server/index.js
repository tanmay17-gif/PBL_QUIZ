import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import cors from 'cors';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { attachGame, getBooks, getPublicRounds } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',') : '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, game: 'BOOK26' }));
app.get('/api/books', (req, res) => res.json(getBooks()));
// NOTE: only the public rounds (no correct answers) are ever exposed.
app.get('/api/rounds', (req, res) => res.json(getPublicRounds()));

// Serve frontend build (fixes "Cannot GET /" on :3001).
// Run `npm --prefix client run build` once, then open http://localhost:3001/
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.json({
    ok: true,
    message: 'Frontend not built. Run: npm --prefix client run build. Dev client: http://localhost:5173/',
    routes: ['/ (main screen)', '/play', '/admin'],
  }));
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',') : '*' },
});
attachGame(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`[library-game] server on :${PORT}`));
