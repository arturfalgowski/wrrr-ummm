// Wrrr Ummm — serwer: statyczne pliki, pokoje wyścigów (Socket.IO) i ranking (SQLite).
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const LAPS = 4;

// ---------- Baza (ranking) ----------
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'ranking.db'));
db.exec(`CREATE TABLE IF NOT EXISTS players (
  nick TEXT PRIMARY KEY COLLATE NOCASE,
  wins INTEGER NOT NULL DEFAULT 0,
  races INTEGER NOT NULL DEFAULT 0,
  best_time REAL
)`);
const qRecord = db.prepare(`
  INSERT INTO players (nick, wins, races, best_time) VALUES (?, ?, 1, ?)
  ON CONFLICT(nick) DO UPDATE SET
    wins = wins + excluded.wins,
    races = races + 1,
    best_time = CASE
      WHEN excluded.best_time IS NULL THEN best_time
      WHEN best_time IS NULL OR excluded.best_time < best_time THEN excluded.best_time
      ELSE best_time END`);
const qTop = db.prepare('SELECT nick, wins, races, best_time AS best FROM players ORDER BY wins DESC, races ASC, nick LIMIT 10');
const ranking = () => qTop.all();

// ---------- HTTP ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ['websocket', 'polling'] });

app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/ranking', (_req, res) => res.json(ranking()));

// ---------- Pokoje ----------
const rooms = new Map();
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genId = () => {
  let s;
  do { s = Array.from({ length: 5 }, () => ID_CHARS[Math.random() * ID_CHARS.length | 0]).join(''); } while (rooms.has(s));
  return s;
};
const cleanNick = (n) => String(n ?? '').replace(/[<>&"'`]/g, '').trim().slice(0, 14);
const cleanCar = (c) => (['aurora', 'vortex', 'blaze'].includes(c) ? c : 'aurora');
const publicRoom = (r) => ({
  id: r.id, state: r.state, laps: LAPS,
  players: r.players.map((p) => ({ id: p.sid, nick: p.nick, car: p.car, ready: p.ready, slot: p.slot })),
});
const clearTimers = (r) => { r.timers.forEach(clearTimeout); r.timers = []; };
const later = (r, ms, fn) => r.timers.push(setTimeout(fn, ms));

function startCountdown(r) {
  clearTimers(r);
  r.state = 'countdown';
  r.winner = null;
  r.times = {};
  r.recorded = false;
  io.to(r.id).emit('race:prepare', publicRoom(r));
  later(r, 800, () => io.to(r.id).emit('race:count', 3));
  later(r, 1800, () => io.to(r.id).emit('race:count', 2));
  later(r, 2800, () => io.to(r.id).emit('race:count', 1));
  later(r, 3800, () => { r.state = 'racing'; io.to(r.id).emit('race:go'); });
}

function endRace(r, winner, reason) {
  if (r.recorded) return;
  r.recorded = true;
  r.state = 'finished';
  r.winner = winner.sid;
  const t = r.times[winner.sid] ?? null;
  for (const p of r.players) {
    p.ready = false;
    if (p.sid === winner.sid) qRecord.run(p.nick, 1, t);
    else qRecord.run(p.nick, 0, null);
  }
  io.to(r.id).emit('room:update', publicRoom(r));
  broadcastResult(r, reason);
  io.emit('ranking', ranking());
}
function broadcastResult(r, reason = 'finish') {
  io.to(r.id).emit('race:end', {
    reason,
    winner: r.winner,
    times: r.times,
    players: publicRoom(r).players,
    ranking: ranking(),
  });
}

function leaveRoom(socket) {
  const id = socket.data.roomId;
  if (!id) return;
  socket.data.roomId = null;
  socket.leave(id);
  const r = rooms.get(id);
  if (!r) return;
  const idx = r.players.findIndex((p) => p.sid === socket.id);
  if (idx < 0) return;
  const [gone] = r.players.splice(idx, 1);
  if (!r.players.length) { clearTimers(r); rooms.delete(id); return; }
  const left = r.players[0];
  left.slot = 0;
  if (r.state === 'racing' && !r.recorded) {
    r.times[left.sid] = r.times[left.sid] ?? null;
    endRace(r, left, 'left');
  }
  clearTimers(r);
  if (r.state !== 'finished') r.state = 'lobby';
  left.ready = false;
  io.to(id).emit('room:left', { nick: gone.nick });
  io.to(id).emit('room:update', publicRoom(r));
}

io.on('connection', (socket) => {
  socket.on('ranking:get', (cb) => typeof cb === 'function' && cb(ranking()));

  socket.on('room:create', ({ nick, car } = {}, cb) => {
    if (typeof cb !== 'function') return;
    leaveRoom(socket);
    nick = cleanNick(nick);
    if (nick.length < 2) return cb({ ok: false, error: 'Nick jest za krótki.' });
    const r = { id: genId(), state: 'lobby', players: [], timers: [], times: {}, winner: null, recorded: false };
    r.players.push({ sid: socket.id, nick, car: cleanCar(car), ready: false, slot: 0 });
    rooms.set(r.id, r);
    socket.join(r.id);
    socket.data.roomId = r.id;
    cb({ ok: true, room: publicRoom(r), you: socket.id });
  });

  socket.on('room:join', ({ id, nick, car } = {}, cb) => {
    if (typeof cb !== 'function') return;
    leaveRoom(socket);
    const r = rooms.get(String(id ?? '').toUpperCase());
    nick = cleanNick(nick);
    if (nick.length < 2) return cb({ ok: false, error: 'Nick jest za krótki.' });
    if (!r) return cb({ ok: false, error: 'Nie znaleziono takiego wyścigu. Link mógł wygasnąć.' });
    if (r.players.length >= 2) return cb({ ok: false, error: 'Ten wyścig ma już dwóch graczy.' });
    if (r.state === 'racing' || r.state === 'countdown') return cb({ ok: false, error: 'Wyścig już trwa.' });
    if (r.players[0].nick.toLowerCase() === nick.toLowerCase()) nick = `${nick.slice(0, 11)} (2)`;
    r.players.push({ sid: socket.id, nick, car: cleanCar(car), ready: false, slot: 1 });
    socket.join(r.id);
    socket.data.roomId = r.id;
    cb({ ok: true, room: publicRoom(r), you: socket.id });
    socket.to(r.id).emit('room:update', publicRoom(r));
  });

  socket.on('room:leave', () => leaveRoom(socket));

  socket.on('player:car', (car) => {
    const r = rooms.get(socket.data.roomId);
    const p = r?.players.find((x) => x.sid === socket.id);
    if (!p || r.state === 'racing' || r.state === 'countdown') return;
    p.car = cleanCar(car);
    io.to(r.id).emit('room:update', publicRoom(r));
  });

  socket.on('player:ready', (ready) => {
    const r = rooms.get(socket.data.roomId);
    const p = r?.players.find((x) => x.sid === socket.id);
    if (!p || r.state === 'racing' || r.state === 'countdown') return;
    p.ready = !!ready;
    if (r.state === 'finished' && p.ready) { r.state = 'lobby'; }
    io.to(r.id).emit('room:update', publicRoom(r));
    if (r.players.length === 2 && r.players.every((x) => x.ready)) startCountdown(r);
  });

  // Stan samochodu — relay do przeciwnika (nieautorytatywny, bez walidacji fizyki).
  socket.on('race:state', (s) => {
    const r = rooms.get(socket.data.roomId);
    if (!r || (r.state !== 'racing' && r.state !== 'finished' && r.state !== 'countdown')) return;
    socket.to(r.id).volatile.emit('race:opp', s);
  });

  socket.on('race:finish', ({ time } = {}) => {
    const r = rooms.get(socket.data.roomId);
    const p = r?.players.find((x) => x.sid === socket.id);
    if (!p || typeof time !== 'number' || !(time > 5) || time > 3600) return;
    if (r.times[p.sid] != null) return;
    if (r.state === 'racing' && !r.recorded) {
      r.times[p.sid] = time;
      endRace(r, p, 'finish');
    } else if (r.state === 'finished') {
      r.times[p.sid] = time;
      broadcastResult(r);
    }
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Wrrr Ummm działa: http://localhost:${PORT}`);
});
