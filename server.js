// Wrrr Ummm — serwer: statyczne pliki, pokoje (Socket.IO), boty, obserwatorzy i rankingi (SQLite). Wyścigi A → B w stylu TrackMania.
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const TRACKS = ['stadion', 'tokyo', 'alpy', 'egipt', 'tropiki'];
const TRACK_PHASE = { stadion: 0.2, tokyo: 0.62, alpy: 0.15, egipt: 0.36, tropiki: 0.44 }; // domyślna pora dnia na starcie (faza 0–1)
// paleta kolorów aut — zgodna z CAR_COLORS w public/js/physics3d.js
const COLORS = ['#e53935', '#ff7a1a', '#ffc21a', '#2fbf71', '#19b6c9', '#3b6cff', '#8a5cf0', '#e0457b', '#f2f2f5', '#2b2b33'];
const PATTERNS = ['none', 'stripes', 'flames', 'checker'];
const RIMS = ['star', 'mesh', 'solid', 'turbine'];
const RIM_COLORS = ['#d9dde6', ...COLORS];
const REACTIONS = ['GG!', 'Dobra jazda!', 'Uważaj!', 'Haha', 'Nie ze mną!', 'Pomocy!', 'Rewanż?', 'Ale numer!', 'Do mety!'];
const PICKUP_MODES = { off: 0, rare: 1.8, normal: 1, often: 0.5 };
const ITEMS = ['nitro', 'nitro', 'ammo', 'ammo', 'oil', 'bomb', 'bomb'];
const pick = (a) => a[Math.random() * a.length | 0];
const BOT_NAMES = ['Rzeźnik', 'Wściekły Mirek', 'Młot', 'Piła'];
const MAX_CARS = 4;

// ---------- Baza (rankingi i profile) ----------
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'ranking.db'));
db.exec(`CREATE TABLE IF NOT EXISTS players (
  nick TEXT PRIMARY KEY COLLATE NOCASE, wins INTEGER NOT NULL DEFAULT 0, races INTEGER NOT NULL DEFAULT 0, best_time REAL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS stats (
  nick TEXT NOT NULL COLLATE NOCASE, mode TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0, second INTEGER NOT NULL DEFAULT 0, races INTEGER NOT NULL DEFAULT 0,
  best_time REAL, last_played INTEGER, PRIMARY KEY (nick, mode)
)`);
// jednorazowa migracja starego rankingu (tylko wyścigi)
if (db.prepare('SELECT COUNT(*) AS c FROM stats').get().c === 0) {
  db.exec("INSERT OR IGNORE INTO stats (nick, mode, wins, second, races, best_time, last_played) SELECT nick, 'race', wins, 0, races, best_time, NULL FROM players");
}
const qRec = db.prepare(`
  INSERT INTO stats (nick, mode, wins, second, races, best_time, last_played) VALUES (?, ?, ?, 0, 1, ?, ?)
  ON CONFLICT(nick, mode) DO UPDATE SET
    wins = wins + excluded.wins, races = races + 1, last_played = excluded.last_played,
    best_time = CASE WHEN excluded.best_time IS NULL THEN best_time
      WHEN best_time IS NULL OR excluded.best_time < best_time THEN excluded.best_time ELSE best_time END`);
const qSecond = db.prepare('UPDATE stats SET second = second + 1 WHERE nick = ? AND mode = ?');
const qTop = db.prepare('SELECT nick, wins, second, races, best_time AS best FROM stats WHERE mode = ? ORDER BY wins DESC, second DESC, races ASC, nick LIMIT 10');
const qProfile = db.prepare('SELECT mode, wins, second, races, best_time AS best, last_played AS last FROM stats WHERE nick = ?');
const ranking = () => ({ race: qTop.all('race') });
const profile = (nick) => {
  const out = { nick, race: null };
  for (const row of qProfile.all(nick)) out[row.mode] = row;
  return out;
};

// ---------- HTTP ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ['websocket', 'polling'] });

app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/ranking', (req, res) => { const r = ranking(); res.json(req.query.mode === 'all' ? r : r.race); });
app.get('/api/profile', (req, res) => res.json(profile(String(req.query.nick ?? '').slice(0, 14))));
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
const cleanSettings = (s) => ({
  bots: Number.isInteger(s?.bots) && s.bots >= 0 && s.bots <= 3 ? s.bots : 0,
  public: s?.public === undefined ? true : !!s.public,
  weather: ['auto', 'sun', 'rain', 'storm'].includes(s?.weather) ? s.weather : 'auto',
  time: ['auto', 'day', 'dusk', 'night'].includes(s?.time) ? s.time : 'auto',
  dyn: s?.dyn === undefined ? true : !!s.dyn,
  pickups: s?.pickups in PICKUP_MODES ? s.pickups : 'normal',
  loadout: s?.loadout === 'full' ? 'full' : 'normal',
});
const cleanCustom = (c, prev = {}) => ({
  num: Number.isInteger(c?.num) && c.num >= 1 && c.num <= 99 ? c.num : (prev.num ?? 1 + (Math.random() * 99 | 0)),
  pattern: PATTERNS.includes(c?.pattern) ? c.pattern : (prev.pattern ?? 'stripes'),
  rim: RIMS.includes(c?.rim) ? c.rim : (prev.rim ?? 'star'),
  rimColor: RIM_COLORS.includes(c?.rimColor) ? c.rimColor : (prev.rimColor ?? '#d9dde6'),
  plate: c?.plate === undefined ? (prev.plate ?? true) : !!c.plate,
});
const freeColor = (r, pref) => (COLORS.includes(pref) && !r.players.some((p) => p.color === pref) ? pref : COLORS.find((c) => !r.players.some((p) => p.color === c)));

/** boty uzupełniają wolne miejsca (maks. 4 auta) */
function activeBots(r) {
  const n = Math.max(0, Math.min(r.settings.bots, MAX_CARS - r.players.length));
  if (r.botsCache?.length === n && r.botsCache.every((b, i) => b.slot === r.players.length + i)) return r.botsCache;
  const used = new Set(r.players.map((p) => p.color));
  const colors = COLORS.filter((c) => !used.has(c));
  r.botsCache = Array.from({ length: n }, (_, i) => ({
    sid: `bot${i}`, nick: BOT_NAMES[i], color: colors[(i * 3) % colors.length] || COLORS[i],
    custom: cleanCustom({ num: 40 + i * 11 }), slot: r.players.length + i, bot: true, progress: 0, finishTime: null,
  }));
  return r.botsCache;
}
const publicPlayer = (p) => ({ id: p.sid, nick: p.nick, color: p.color, custom: p.custom, ready: !!p.ready, slot: p.slot, bot: !!p.bot });
const publicRoom = (r) => ({
  id: r.id, state: r.state, mode: 'race', track: r.track, settings: r.settings, env: r.env || null,
  players: r.players.map(publicPlayer), bots: activeBots(r).map(publicPlayer), spectators: r.spectators.size,
});
const clearTimers = (r) => { r.timers.forEach(clearTimeout); r.timers = []; };
const later = (r, ms, fn) => { const t = setTimeout(fn, ms); r.timers.push(t); return t; };
const isHost = (r, socket) => r.players[0]?.sid === socket.id;
const lockedState = (r) => r.state === 'racing' || r.state === 'countdown';

// ---------- Otoczenie: pora dnia i pogoda (zmieniają się w trakcie wyścigu u klientów) ----------
function resolveEnv(r) {
  const s = r.settings, seed = (Math.random() * 1e9) | 0, x = Math.random();
  const basePhase = { day: 0.2, dusk: 0.5, night: 0.7 }[s.time] ?? TRACK_PHASE[r.track] ?? 0.2;
  const phase0 = s.time === 'auto' ? (basePhase + (Math.random() - 0.5) * 0.12 + 1) % 1 : basePhase;
  let weather = s.weather, rainAt = 1e9, rainK = 0;
  if (s.weather === 'auto') { weather = 'sun'; if (x > 0.5) { const storm = x > 0.85; rainAt = s.dyn ? 6 + Math.random() * 30 : 0; rainK = storm ? 1 : 0.8; } }
  else if (s.weather !== 'sun') { rainAt = 0; rainK = s.weather === 'storm' ? 1 : 0.8; }
  return { weather: s.weather === 'auto' ? 'sun' : weather, phase0, dynamic: s.dyn, rainAt, rainK, seed };
}

function startCountdown(r) {
  if (r.recorded && !r.finalized) finalizeRace(r);
  clearTimers(r);
  r.state = 'countdown';
  r.winner = null; r.times = {}; r.recorded = false; r.finalized = false; r.afterRace = false;
  for (const p of r.players) p.progress = 0;
  for (const b of activeBots(r)) { b.progress = 0; b.finishTime = null; }
  r.env = resolveEnv(r); r.pickups = new Map();
  io.to(r.id).emit('race:prepare', publicRoom(r));
  later(r, 800, () => io.to(r.id).emit('race:count', 3));
  later(r, 1800, () => io.to(r.id).emit('race:count', 2));
  later(r, 2800, () => io.to(r.id).emit('race:count', 1));
  later(r, 3800, () => { r.state = 'racing'; io.to(r.id).emit('race:go'); schedulePickups(r); });
}

/** paczki losowane na torze (u — położenie 0..1 wzdłuż trasy, l — przesunięcie boczne); klient dopasowuje je do jezdni */
function schedulePickups(r) {
  const mul = PICKUP_MODES[r.settings.pickups];
  if (!mul) return;
  const tick = () => {
    if (r.state !== 'racing') return;
    if (r.pickups.size < 5) {
      const id = ++r.pid, type = pick(ITEMS);
      r.pickups.set(id, type);
      io.to(r.id).emit('pickup:spawn', { id, type, u: 0.06 + Math.random() * 0.88, l: (Math.random() - 0.5) * 1.3 });
      later(r, 32000, () => { if (r.pickups.delete(id)) io.to(r.id).emit('pickup:remove', { id }); });
    }
    later(r, (7000 + Math.random() * 5000) * mul, tick);
  };
  later(r, 5000, tick);
}

/** kolejność końcowa: ukończone wg czasu, reszta wg postępu */
function finalOrder(r) {
  const all = [
    ...r.players.map((p) => ({ id: p.sid, nick: p.nick, t: r.times[p.sid] ?? null, prog: p.progress || 0, bot: false })),
    ...activeBots(r).map((b) => ({ id: b.sid, nick: b.nick, t: b.finishTime, prog: b.progress || 0, bot: true })),
  ];
  return all.sort((a, b) => (a.t != null && b.t != null ? a.t - b.t : a.t != null ? -1 : b.t != null ? 1 : b.prog - a.prog));
}

function endRace(r, winner, reason) {
  if (r.recorded) return;
  r.recorded = true; r.afterRace = true; r.state = 'finished';
  clearTimers(r);
  r.winner = winner.sid;
  const t = r.times[winner.sid] ?? null, now = Date.now();
  for (const p of r.players) { p.ready = false; qRec.run(p.nick, 'race', p.sid === winner.sid ? 1 : 0, p.sid === winner.sid ? t : null, now); }
  io.to(r.id).emit('room:update', publicRoom(r));
  broadcastResult(r, reason);
  io.emit('ranking', ranking());
  if (r.players.every((p) => r.times[p.sid] != null)) finalizeRace(r);
  else later(r, 30000, () => finalizeRace(r)); // ostatni dojeżdżający mają 30 s, potem liczy się postęp
}

/** koniec wyścigu: ostateczna kolejność i drugie miejsca w statystykach */
function finalizeRace(r) {
  if (r.finalized) return;
  r.finalized = true;
  const order = finalOrder(r), humans = order.filter((o) => !o.bot);
  if (humans[1] && order.length >= 3) qSecond.run(r.players.find((p) => p.sid === humans[1].id)?.nick ?? '', 'race');
  io.to(r.id).emit('race:final', { order: order.map((o) => ({ id: o.id, nick: o.nick, time: o.t, bot: o.bot })) });
  io.emit('ranking', ranking());
}

function broadcastResult(r, reason = 'finish') {
  io.to(r.id).emit('race:end', {
    reason, winner: r.winner, mode: 'race', order: [], times: r.times,
    players: r.players.map(publicPlayer), bots: activeBots(r).map(publicPlayer),
    final: finalOrder(r).map((o) => ({ id: o.id, nick: o.nick, time: o.t, bot: o.bot })), ranking: ranking(),
  });
}

function leaveRoom(socket) {
  const id = socket.data.roomId;
  if (!id) return;
  socket.data.roomId = null;
  socket.leave(id);
  const r = rooms.get(id);
  if (!r) return;
  if (r.spectators.delete(socket.id)) { io.to(id).emit('room:update', publicRoom(r)); return; }
  const idx = r.players.findIndex((p) => p.sid === socket.id);
  if (idx < 0) return;
  const [gone] = r.players.splice(idx, 1);
  if (!r.players.length) { clearTimers(r); rooms.delete(id); for (const sid of r.spectators) io.to(sid).emit('room:closed'); return; }
  r.players.forEach((p, i) => { p.slot = i; });
  r.botsCache = null;
  if (r.state === 'racing' && !r.recorded) {
    if (r.players.length < 2 && !activeBots(r).length) { r.times[r.players[0].sid] = r.times[r.players[0].sid] ?? null; endRace(r, r.players[0], 'left'); }
  } else {
    clearTimers(r);
    if (r.state !== 'finished') r.state = 'lobby';
    r.players.forEach((p) => { p.ready = false; });
  }
  io.to(id).emit('room:left', { nick: gone.nick });
  io.to(id).emit('room:update', publicRoom(r));
}

const roomsList = () => [...rooms.values()].filter((r) => r.settings.public && r.players.length).map((r) => ({
  id: r.id, host: r.players[0].nick, mode: 'race', track: r.track, state: r.state, players: r.players.length, bots: activeBots(r).length,
  spectators: r.spectators.size, joinable: r.state === 'lobby' || r.state === 'finished' ? r.players.length < MAX_CARS : false,
}));

io.on('connection', (socket) => {
  socket.on('ranking:get', (cb) => typeof cb === 'function' && cb(ranking()));
  socket.on('rooms:list', (cb) => typeof cb === 'function' && cb(roomsList()));

  socket.on('room:create', ({ nick, track, settings, color, custom } = {}, cb) => {
    if (typeof cb !== 'function') return;
    leaveRoom(socket);
    nick = cleanNick(nick);
    if (nick.length < 2) return cb({ ok: false, error: 'Nick jest za krótki.' });
    const tr = TRACKS.includes(track) ? track : TRACKS[0];
    const r = {
      id: genId(), state: 'lobby', track: tr, settings: cleanSettings(settings), players: [], spectators: new Set(), timers: [], times: {}, winner: null,
      recorded: false, env: null, afterRace: false, finalized: false, botsCache: null, pickups: new Map(), pid: 0,
    };
    r.players.push({ sid: socket.id, nick, color: freeColor(r, color), custom: cleanCustom(custom), ready: false, slot: 0, progress: 0 });
    rooms.set(r.id, r);
    socket.join(r.id);
    socket.data.roomId = r.id;
    cb({ ok: true, room: publicRoom(r), you: socket.id });
  });

  socket.on('room:join', ({ id, nick, color, custom, spectate } = {}, cb) => {
    if (typeof cb !== 'function') return;
    leaveRoom(socket);
    const r = rooms.get(String(id ?? '').toUpperCase());
    nick = cleanNick(nick);
    if (nick.length < 2) return cb({ ok: false, error: 'Nick jest za krótki.' });
    if (!r) return cb({ ok: false, error: 'Nie znaleziono takiego pokoju. Link mógł wygasnąć.' });
    if (spectate) {
      r.spectators.add(socket.id); socket.join(r.id); socket.data.roomId = r.id; socket.data.nick = nick;
      cb({ ok: true, room: publicRoom(r), you: socket.id, spectator: true });
      io.to(r.id).emit('room:update', publicRoom(r));
      return;
    }
    if (r.players.length >= MAX_CARS) return cb({ ok: false, error: 'Ten pokój ma już czterech graczy. Możesz dołączyć jako obserwator.' });
    if (lockedState(r)) return cb({ ok: false, error: 'Wyścig już trwa. Możesz dołączyć jako obserwator.' });
    for (let n = 2; r.players.some((p) => p.nick.toLowerCase() === nick.toLowerCase()); n++) nick = `${nick.replace(/ \(\d\)$/, '').slice(0, 11)} (${n})`;
    const slot = [0, 1, 2, 3].find((s) => !r.players.some((p) => p.slot === s));
    r.players.push({ sid: socket.id, nick, color: freeColor(r, color), custom: cleanCustom(custom), ready: false, slot, progress: 0 });
    r.botsCache = null;
    socket.join(r.id);
    socket.data.roomId = r.id;
    cb({ ok: true, room: publicRoom(r), you: socket.id });
    socket.to(r.id).emit('room:update', publicRoom(r));
  });

  socket.on('room:leave', () => leaveRoom(socket));

  socket.on('room:track', (track) => {
    const r = rooms.get(socket.data.roomId);
    if (!r || !isHost(r, socket) || lockedState(r) || !TRACKS.includes(track)) return;
    r.track = track;
    io.to(r.id).emit('room:update', publicRoom(r));
  });

  socket.on('room:settings', (st) => {
    const r = rooms.get(socket.data.roomId);
    if (!r || !isHost(r, socket) || lockedState(r)) return;
    r.settings = cleanSettings({ ...r.settings, ...st });
    r.botsCache = null;
    io.to(r.id).emit('room:update', publicRoom(r));
  });

  // gospodarz startuje wyścig w dowolnym momencie (bez czekania na „Gotowy” pozostałych)
  socket.on('room:start', () => {
    const r = rooms.get(socket.data.roomId);
    if (!r || !isHost(r, socket) || lockedState(r)) return;
    if (r.players.length + activeBots(r).length < 2) return io.to(socket.id).emit('chat', { sys: true, text: 'Potrzebny co najmniej jeden rywal (gracz lub bot).' });
    if (r.state === 'finished') r.state = 'lobby';
    startCountdown(r);
  });

  const chatOut = (socket) => {
    const r = rooms.get(socket.data.roomId);
    if (!r) return null;
    const p = r.players.find((x) => x.sid === socket.id);
    const spec = !p && r.spectators.has(socket.id);
    if (!p && !spec) return null;
    const who = p || { nick: `${socket.data.nick || 'Widz'} (widz)`, color: '#b3aed0' };
    const now = Date.now();
    who.chatT = (who.chatT || []).filter((t) => now - t < 4000);
    if (who.chatT.length >= 6) return null; // limit: 6 wiadomości / 4 s
    who.chatT.push(now);
    return { r, p: who };
  };
  socket.on('chat', (text) => {
    const ctx = chatOut(socket); if (!ctx) return;
    const t = String(text ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
    if (!t) return;
    io.to(ctx.r.id).emit('chat', { from: socket.id, nick: ctx.p.nick, color: ctx.p.color, text: t });
  });
  socket.on('react', (i) => {
    const ctx = chatOut(socket); if (!ctx || !Number.isInteger(i) || i < 1 || i > 9) return;
    io.to(ctx.r.id).emit('chat', { from: socket.id, nick: ctx.p.nick, color: ctx.p.color, text: REACTIONS[i - 1], react: true });
  });

  const me = () => { const r = rooms.get(socket.data.roomId); return { r, p: r?.players.find((x) => x.sid === socket.id) }; };

  socket.on('player:color', (color) => {
    const { r, p } = me();
    if (!p || lockedState(r) || !COLORS.includes(color)) return;
    if (r.players.some((x) => x.sid !== socket.id && x.color === color)) return; // kolor zajęty przez innego gracza
    p.color = color; r.botsCache = null;
    io.to(r.id).emit('room:update', publicRoom(r));
  });

  socket.on('player:custom', (c) => {
    const { r, p } = me();
    if (!p || lockedState(r)) return;
    p.custom = cleanCustom(c, p.custom);
    io.to(r.id).emit('room:update', publicRoom(r));
  });

  socket.on('player:ready', (ready) => {
    const { r, p } = me();
    if (!p || lockedState(r)) return;
    p.ready = !!ready;
    if (p.ready) {
      const n = r.players.filter((x) => x.ready).length;
      io.to(r.id).emit('chat', { sys: true, text: `${p.nick} ${r.afterRace ? 'chce rewanż' : 'jest gotowy'} (${n}/${r.players.length})` });
    }
    if (r.state === 'finished' && p.ready) r.state = 'lobby';
    io.to(r.id).emit('room:update', publicRoom(r));
    const cars = r.players.length + activeBots(r).length;
    if (r.afterRace && cars >= 2 && r.players.every((x) => x.ready)) startCountdown(r); // rewanż po wyścigu: start, gdy wszyscy chcą
  });

  // Stan samochodu — relay do pozostałych (nieautorytatywny, bez walidacji fizyki).
  socket.on('race:state', (s) => {
    const { r, p } = me();
    if (!r || (r.state !== 'racing' && r.state !== 'finished' && r.state !== 'countdown')) return;
    if (!Array.isArray(s) || s.length < 22 || s.length > 26 || !s.every((v) => Number.isFinite(v))) return;
    if (p) p.progress = s[8];
    socket.to(r.id).volatile.emit('race:opp', socket.id, s);
  });

  // Boty: symuluje je host, serwer liczy postęp i przekazuje pozostałym.
  socket.on('race:bots', (list) => {
    const { r } = me();
    if (!r || !isHost(r, socket) || !Array.isArray(list) || (r.state !== 'racing' && r.state !== 'finished' && r.state !== 'countdown')) return;
    const bots = activeBots(r);
    for (const [id, s] of list) { const b = bots.find((x) => x.sid === id); if (b && Array.isArray(s) && Number.isFinite(s[8])) b.progress = s[8]; }
    socket.to(r.id).volatile.emit('race:bots', list);
  });
  socket.on('bot:finish', ({ id, time } = {}) => {
    const { r } = me();
    if (!r || !isHost(r, socket) || typeof time !== 'number' || !(time > 5)) return;
    const b = activeBots(r).find((x) => x.sid === id);
    if (b && b.finishTime == null) b.finishTime = time;
  });

  socket.on('race:finish', ({ time } = {}) => {
    const { r, p } = me();
    if (!p || typeof time !== 'number' || !(time > 5) || time > 3600) return;
    if (r.times[p.sid] != null) return;
    if (r.state === 'racing' && !r.recorded) {
      r.times[p.sid] = time;
      endRace(r, p, 'finish');
    } else if (r.state === 'finished') {
      r.times[p.sid] = time;
      broadcastResult(r);
      if (r.players.every((x) => r.times[x.sid] != null)) finalizeRace(r);
    }
  });

  socket.on('pickup:take', ({ id } = {}) => {
    const r = rooms.get(socket.data.roomId);
    if (!r || r.state !== 'racing' || !r.pickups.has(id)) return;
    const type = r.pickups.get(id);
    r.pickups.delete(id);
    io.to(r.id).emit('pickup:taken', { id, by: socket.id, type });
  });

  // zdarzenia gry (strzał, olej, mina, wybuch, trafienie) — współrzędne toru (x = s, z = d) przekazywane pozostałym
  socket.on('game:event', (e) => {
    const r = rooms.get(socket.data.roomId);
    if (!r || (r.state !== 'racing' && r.state !== 'finished') || !e || !['shoot', 'oil', 'hit', 'bomb', 'boom'].includes(e.t)) return;
    const n = (v) => (Number.isFinite(v) ? v : 0);
    socket.to(r.id).emit('game:event', { t: e.t, from: socket.id, to: typeof e.to === 'string' ? e.to : null, id: typeof e.id === 'string' ? e.id.slice(0, 24) : null, x: n(e.x), z: n(e.z), vx: n(e.vx) });
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Wrrr Ummm działa: http://localhost:${PORT}`);
});
