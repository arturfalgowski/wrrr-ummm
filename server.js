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
const TRACKS = ['dolina', 'owal', 'serpentyna'];
const LAPS = { dolina: 4, owal: 3, serpentyna: 3 };
// paleta kolorów aut — zgodna z CAR_COLORS w public/js/physics.js
const COLORS = ['#e53935', '#ff7a1a', '#ffc21a', '#2fbf71', '#19b6c9', '#3b6cff', '#8a5cf0', '#e0457b', '#f2f2f5', '#2b2b33'];
const freeColor = (r, pref) => (COLORS.includes(pref) && !r.players.some((p) => p.color === pref) ? pref : COLORS.find((c) => !r.players.some((p) => p.color === c)));
const PICKUP_MODES = { off: 0, rare: 1.8, normal: 1, often: 0.5 };
const ITEMS = ['nitro', 'nitro', 'ammo', 'ammo', 'oil', 'repair', 'repair'];
const ARENA_ITEMS = ['bomb', 'bomb', 'rocket', 'rocket', 'ammo', 'ammo', 'shield', 'repair', 'repair', 'nitro', 'oil'];
const ARENA_R = 80;

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
app.get('/api/music', (_req, res) => {
  try { res.json(fs.readdirSync(path.join(__dirname, 'public/music')).filter((f) => !f.startsWith('.') && /\.(mp3|ogg|m4a|wav)$/i.test(f)).sort()); } catch { res.json([]); }
});

// ---------- Pokoje ----------
const rooms = new Map();
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genId = () => {
  let s;
  do { s = Array.from({ length: 5 }, () => ID_CHARS[Math.random() * ID_CHARS.length | 0]).join(''); } while (rooms.has(s));
  return s;
};
const cleanNick = (n) => String(n ?? '').replace(/[<>&"'`]/g, '').trim().slice(0, 14);
const cleanSettings = (s, track) => ({
  laps: Number.isInteger(s?.laps) && s.laps >= 1 && s.laps <= 10 ? s.laps : LAPS[track],
  pickups: s?.pickups in PICKUP_MODES ? s.pickups : 'normal',
});
const cleanCar = (c) => (['aurora', 'vortex', 'blaze'].includes(c) ? c : 'aurora');
const publicRoom = (r) => ({
  id: r.id, state: r.state, mode: r.mode, track: r.track, settings: r.settings,
  players: r.players.map((p) => ({ id: p.sid, nick: p.nick, car: p.car, color: p.color, ready: p.ready, slot: p.slot })),
});
const clearTimers = (r) => { r.timers.forEach(clearTimeout); r.timers = []; };
const later = (r, ms, fn) => r.timers.push(setTimeout(fn, ms));

function startCountdown(r) {
  clearTimers(r);
  r.state = 'countdown';
  r.winner = null;
  r.times = {};
  r.recorded = false;
  r.pickups = new Map();
  r.alive = new Set(r.players.map((p) => p.sid)); r.elim = []; r.order = [];
  io.to(r.id).emit('race:prepare', publicRoom(r));
  later(r, 800, () => io.to(r.id).emit('race:count', 3));
  later(r, 1800, () => io.to(r.id).emit('race:count', 2));
  later(r, 2800, () => io.to(r.id).emit('race:count', 1));
  later(r, 3800, () => { r.state = 'racing'; io.to(r.id).emit('race:go'); schedulePickups(r); });
}

function schedulePickups(r) {
  const mul = PICKUP_MODES[r.settings.pickups];
  if (!mul) return;
  const arena = r.mode === 'arena';
  const tick = () => {
    if (r.state !== 'racing') return;
    if (r.pickups.size < (arena ? 5 : 3)) {
      const id = ++r.pid, type = (arena ? ARENA_ITEMS : ITEMS)[Math.random() * (arena ? ARENA_ITEMS : ITEMS).length | 0];
      r.pickups.set(id, type);
      if (arena) { const a = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * ARENA_R * 0.82; io.to(r.id).emit('pickup:spawn', { id, type, x: Math.cos(a) * rad, z: Math.sin(a) * rad }); }
      else io.to(r.id).emit('pickup:spawn', { id, type, u: Math.random(), l: (Math.random() - 0.5) * 1.3 });
      later(r, 30000, () => { if (r.pickups.delete(id)) io.to(r.id).emit('pickup:remove', { id }); });
    }
    later(r, (arena ? 5000 + Math.random() * 3000 : 8000 + Math.random() * 6000) * mul, tick);
  };
  later(r, arena ? 4000 : 5500, tick);
}

/** arena: zgłoszenie eliminacji gracza; koniec, gdy zostaje jeden */
function arenaEliminate(r, sid) {
  if (r.mode !== 'arena' || r.state !== 'racing' || r.recorded || !r.alive.has(sid)) return;
  r.alive.delete(sid); r.elim.push(sid);
  io.to(r.id).emit('arena:elim', { id: sid });
  if (r.alive.size <= 1) {
    const wsid = r.alive.size === 1 ? [...r.alive][0] : r.elim[r.elim.length - 1];
    const winner = r.players.find((p) => p.sid === wsid) || r.players[0];
    r.order = [winner.sid, ...[...r.elim].reverse().filter((x) => x !== winner.sid)];
    r.times[winner.sid] = r.times[winner.sid] ?? null;
    endRace(r, winner, 'finish');
  }
}

function endRace(r, winner, reason) {
  if (r.recorded) return;
  r.recorded = true;
  r.state = 'finished';
  clearTimers(r);
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
    mode: r.mode,
    order: r.order,
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
  r.players.forEach((p, i) => { p.slot = i; });
  if (r.mode === 'arena' && r.state === 'racing' && !r.recorded && r.alive.has(gone.sid)) { arenaEliminate(r, gone.sid); }
  if (r.state === 'racing' && !r.recorded) {
    if (r.players.length < 2) { r.times[r.players[0].sid] = r.times[r.players[0].sid] ?? null; endRace(r, r.players[0], 'left'); }
  } else {
    clearTimers(r);
    if (r.state !== 'finished') r.state = 'lobby';
    r.players.forEach((p) => { p.ready = false; });
  }
  io.to(id).emit('room:left', { nick: gone.nick });
  io.to(id).emit('room:update', publicRoom(r));
}

io.on('connection', (socket) => {
  socket.on('ranking:get', (cb) => typeof cb === 'function' && cb(ranking()));

  socket.on('room:create', ({ nick, car, track, settings, color, mode } = {}, cb) => {
    if (typeof cb !== 'function') return;
    leaveRoom(socket);
    nick = cleanNick(nick);
    if (nick.length < 2) return cb({ ok: false, error: 'Nick jest za krótki.' });
    const r = { id: genId(), state: 'lobby', mode: mode === 'arena' ? 'arena' : 'race', alive: new Set(), elim: [], order: [], track: TRACKS.includes(track) ? track : TRACKS[0], settings: cleanSettings(settings, TRACKS.includes(track) ? track : TRACKS[0]), players: [], timers: [], times: {}, winner: null, recorded: false, pickups: new Map(), pid: 0 };
    r.players.push({ sid: socket.id, nick, car: cleanCar(car), color: freeColor(r, color), ready: false, slot: 0 });
    rooms.set(r.id, r);
    socket.join(r.id);
    socket.data.roomId = r.id;
    cb({ ok: true, room: publicRoom(r), you: socket.id });
  });

  socket.on('room:join', ({ id, nick, car, color } = {}, cb) => {
    if (typeof cb !== 'function') return;
    leaveRoom(socket);
    const r = rooms.get(String(id ?? '').toUpperCase());
    nick = cleanNick(nick);
    if (nick.length < 2) return cb({ ok: false, error: 'Nick jest za krótki.' });
    if (!r) return cb({ ok: false, error: 'Nie znaleziono takiego wyścigu. Link mógł wygasnąć.' });
    if (r.players.length >= 4) return cb({ ok: false, error: 'Ten wyścig ma już czterech graczy.' });
    if (r.state === 'racing' || r.state === 'countdown') return cb({ ok: false, error: 'Wyścig już trwa.' });
    for (let n = 2; r.players.some((p) => p.nick.toLowerCase() === nick.toLowerCase()); n++) nick = `${nick.replace(/ \(\d\)$/, '').slice(0, 11)} (${n})`;
    const slot = [0, 1, 2, 3].find((s) => !r.players.some((p) => p.slot === s));
    r.players.push({ sid: socket.id, nick, car: cleanCar(car), color: freeColor(r, color), ready: false, slot });
    socket.join(r.id);
    socket.data.roomId = r.id;
    cb({ ok: true, room: publicRoom(r), you: socket.id });
    socket.to(r.id).emit('room:update', publicRoom(r));
  });

  socket.on('room:leave', () => leaveRoom(socket));

  socket.on('room:track', (track) => {
    const r = rooms.get(socket.data.roomId);
    if (!r || r.players[0]?.sid !== socket.id || r.state === 'racing' || r.state === 'countdown' || !TRACKS.includes(track)) return;
    r.track = track;
    r.settings.laps = LAPS[track];
    io.to(r.id).emit('room:update', publicRoom(r));
  });

  socket.on('room:settings', (st) => {
    const r = rooms.get(socket.data.roomId);
    if (!r || r.players[0]?.sid !== socket.id || r.state === 'racing' || r.state === 'countdown') return;
    r.settings = cleanSettings({ ...r.settings, ...st }, r.track);
    io.to(r.id).emit('room:update', publicRoom(r));
  });

  socket.on('room:mode', (mode) => {
    const r = rooms.get(socket.data.roomId);
    if (!r || r.players[0]?.sid !== socket.id || r.state === 'racing' || r.state === 'countdown' || !['race', 'arena'].includes(mode)) return;
    r.mode = mode;
    io.to(r.id).emit('room:update', publicRoom(r));
  });

  socket.on('arena:dead', () => {
    const r = rooms.get(socket.data.roomId);
    if (r) arenaEliminate(r, socket.id);
  });

  socket.on('pickup:take', ({ id } = {}) => {
    const r = rooms.get(socket.data.roomId);
    if (!r || r.state !== 'racing' || !r.pickups.has(id)) return;
    const type = r.pickups.get(id);
    r.pickups.delete(id);
    io.to(r.id).emit('pickup:taken', { id, by: socket.id, type });
  });

  // zdarzenia gry (strzał, olej, trafienie) — przekazywane przeciwnikowi
  socket.on('game:event', (e) => {
    const r = rooms.get(socket.data.roomId);
    if (!r || (r.state !== 'racing' && r.state !== 'finished') || !e || !['shoot', 'oil', 'hit', 'bomb', 'boom', 'rocket'].includes(e.t)) return;
    const n = (v) => (Number.isFinite(v) ? v : 0);
    socket.to(r.id).emit('game:event', { t: e.t, from: socket.id, to: typeof e.to === 'string' ? e.to : null, id: typeof e.id === 'string' ? e.id.slice(0, 24) : null, r: n(e.r), dmg: n(e.dmg), x: n(e.x), z: n(e.z), yaw: n(e.yaw), vx: n(e.vx), vz: n(e.vz) });
  });

  socket.on('player:car', (car) => {
    const r = rooms.get(socket.data.roomId);
    const p = r?.players.find((x) => x.sid === socket.id);
    if (!p || r.state === 'racing' || r.state === 'countdown') return;
    p.car = cleanCar(car);
    io.to(r.id).emit('room:update', publicRoom(r));
  });

  socket.on('player:color', (color) => {
    const r = rooms.get(socket.data.roomId);
    const p = r?.players.find((x) => x.sid === socket.id);
    if (!p || r.state === 'racing' || r.state === 'countdown' || !COLORS.includes(color)) return;
    if (r.players.some((x) => x.sid !== socket.id && x.color === color)) return; // kolor zajęty przez innego gracza
    p.color = color;
    io.to(r.id).emit('room:update', publicRoom(r));
  });

  socket.on('player:ready', (ready) => {
    const r = rooms.get(socket.data.roomId);
    const p = r?.players.find((x) => x.sid === socket.id);
    if (!p || r.state === 'racing' || r.state === 'countdown') return;
    p.ready = !!ready;
    if (r.state === 'finished' && p.ready) { r.state = 'lobby'; }
    io.to(r.id).emit('room:update', publicRoom(r));
    if (r.players.length >= 2 && r.players.every((x) => x.ready)) startCountdown(r);
  });

  // Stan samochodu — relay do przeciwnika (nieautorytatywny, bez walidacji fizyki).
  socket.on('race:state', (s) => {
    const r = rooms.get(socket.data.roomId);
    if (!r || (r.state !== 'racing' && r.state !== 'finished' && r.state !== 'countdown')) return;
    socket.to(r.id).volatile.emit('race:opp', socket.id, s);
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
