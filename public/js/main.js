// Wrrr Ummm — sterowanie grą: renderer, kamera izometryczna, pętla gry, UI, multiplayer.
import * as THREE from 'three';
import { Track, TRACK_DEFS, TRACK_IDS, ROAD_HALF, BARRIER } from './track.js';
import { CarState, CAR_DEFS, carVsCar } from './physics.js';
import { buildCar } from './car.js';
import { buildWorld } from './world.js';
import { createPost } from './post.js';
import { Particles, SkidMarks } from './fx.js';
import { Items } from './items.js';
import { initAudio, audioReady, CarAudio, sfx, isMuted, setMuted } from './audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const store = {
  get: (k, d = null) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* brak storage */ } },
};
const fmt = (t) => (t == null || !isFinite(t) ? '—' : `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`);

// ======================= Renderer / scena =======================
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
let pr = Math.min(window.devicePixelRatio || 1, 2);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 1, 4000);
const post = createPost(renderer, scene, camera);

const particles = new Particles(scene);
const skids = new SkidMarks(scene);
const items = new Items(scene, particles);
items._thud = () => sfx.land();

// ======================= Tory (każdy budowany raz, potem tylko przełączany) =======================
const worlds = {};
let track = null, world = null, trackId = null;
function useTrack(id) {
  if (!TRACK_DEFS[id]) id = TRACK_IDS[0];
  if (trackId === id && world) return;
  if (world) world.root.visible = false;
  if (!worlds[id]) { const t = new Track(id); worlds[id] = { track: t, world: buildWorld(scene, renderer, t) }; }
  ({ track, world } = worlds[id]);
  trackId = id;
  world.root.visible = true;
  scene.background = world.sky;
  scene.fog = new THREE.Fog(world.sky, 300, 1500);
  items.clear(); particles.clear(); skids.clear();
  cam.first = true;
}

// ======================= Kamera =======================
const RACE_FOV = 24;
const cam = { pos: new THREE.Vector3(0, 40, 40), look: new THREE.Vector3(), fov: 38, shift: 0.16, tilt: 0.45, first: true, half: 32, focus: new THREE.Vector3() };
const CAM_DIR = (() => { const az = THREE.MathUtils.degToRad(16), el = THREE.MathUtils.degToRad(53); return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)); })();

function resize() {
  const W = window.innerWidth, H = window.innerHeight;
  renderer.setPixelRatio(pr);
  renderer.setSize(W, H, false);
  post.setSize(W, H, pr);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ======================= Stan gry =======================
const S = {
  nick: store.get('tc_nick', ''),
  carId: CAR_DEFS[store.get('tc_car')] ? store.get('tc_car') : 'aurora',
  trackId: TRACK_DEFS[store.get('tc_track')] ? store.get('tc_track') : 'dolina',
  laps: 0, lapsNow: 4, pickups: ['off', 'rare', 'normal', 'often'].includes(store.get('tc_pickups')) ? store.get('tc_pickups') : 'normal',
  mode: 'menu', // menu | lobby | countdown | racing | finished
  solo: false, room: null, you: null, joinCode: null,
  raceStart: 0, results: null, resultSounded: false,
};
const me = { items: { nitro: false, oil: false, ammoT: 0 }, nitroT: 0, tireCd: 0, st: null, vis: null, audio: null, lapIdx: 0, maxP: 0, lapStart: 0, best: Infinity, lapTimes: [], finished: false, finishTime: 0, smokeAcc: 0, hitCd: 0 };
const opp = { st: null, vis: null, audio: null, present: false, nick: '', carId: null, snaps: [], prevVf: 0, smokeAcc: 0 };
const visCache = new Map();
const input = { throttle: 0, brake: 0, steer: 0, hand: false };
const keys = new Set();
let socket = null;
let timers = [];

const gridPos = (slot) => (slot === 0 ? [-6, -3.6] : [-13, 3.6]);
function getVis(carId, slot) {
  const k = `${carId}:${slot}`;
  if (!visCache.has(k)) visCache.set(k, buildCar(carId, slot === 0 ? 7 : 11));
  return visCache.get(k);
}
function setCar(who, carId, slot) {
  if (who.vis) scene.remove(who.vis.group);
  if (!carId) { who.vis = null; who.st = null; return; }
  who.vis = getVis(carId, slot);
  who.st = new CarState(CAR_DEFS[carId]);
  const [p, lat] = gridPos(slot);
  who.st.place(track, p, lat);
  scene.add(who.vis.group);
  who.vis.sync(who.st, 0);
}
function mySlot() { const p = S.room?.players.find((x) => x.id === S.you); return p ? p.slot : 0; }

function resetRace() {
  const slot = S.solo ? 0 : mySlot();
  setCar(me, S.carId, slot);
  if (!S.solo && S.room) {
    const o = S.room.players.find((x) => x.id !== S.you);
    if (o) { opp.present = true; opp.nick = o.nick; opp.carId = o.car; setCar(opp, o.car, 1 - slot); }
  } else { opp.present = false; setCar(opp, null); }
  opp.snaps = [];
  me.lapIdx = 0; me.maxP = me.st.progress; me.best = Infinity; me.lapTimes = []; me.finished = false; me.finishTime = 0;
  S.results = null; S.resultSounded = false;
  particles.clear(); skids.clear(); resetItems();
  $('hud-best').textContent = '';
  $('hud-time').textContent = '0:00.00';
  $('hud-lap').textContent = `1/${S.lapsNow}`;
  $('chip-pos').classList.toggle('hidden', !opp.present);
}

// ======================= Ekrany =======================
const SCREENS = ['nick', 'menu', 'lobby', 'results'];
function showScreen(name) {
  for (const s of SCREENS) $(`scr-${s}`).classList.toggle('hidden', s !== name);
  const inRace = name === null;
  $('hud').classList.toggle('hidden', !(inRace || name === 'results'));
}
function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms);
}
function setMode(m) { S.mode = m; }

function renderRanking(list) {
  for (const id of ['rank-menu', 'rank-results']) {
    const ol = $(id); ol.textContent = '';
    if (!list || !list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Brak wyników — wygraj pierwszy wyścig!'; ol.append(li); continue; }
    for (const r of list) {
      const li = document.createElement('li');
      if (S.nick && r.nick.toLowerCase() === S.nick.toLowerCase()) li.className = 'me';
      const n = document.createElement('span'); n.textContent = r.nick;
      const w = document.createElement('span'); w.className = 'w'; w.append(`${r.wins}`);
      const sm = document.createElement('small'); sm.textContent = ` / ${r.races}`; w.append(sm);
      li.append(n, w); ol.append(li);
    }
  }
}
async function loadRanking() {
  try { renderRanking(await (await fetch('api/ranking')).json()); } catch { /* serwer niedostępny */ }
}

function buildCarList() {
  const wrap = $('car-list'); wrap.textContent = '';
  for (const [id, d] of Object.entries(CAR_DEFS)) {
    const b = document.createElement('button'); b.className = 'car'; b.dataset.id = id;
    b.innerHTML = `<span class="dot" style="background:${d.color}"></span><span><b>${d.name}</b><small>${d.tag}</small></span><span class="stat">${d.stats.map((v) => `<div><i style="width:${Math.round(v * 100)}%"></i></div>`).join('')}</span>`;
    b.addEventListener('click', () => { S.carId = id; store.set('tc_car', id); markCar(); if (S.mode === 'menu') setCar(me, id, 0); });
    wrap.append(b);
  }
  const lg = document.createElement('div'); lg.className = 'muted'; lg.style.cssText = 'font-size:11px;text-align:right;letter-spacing:.06em';
  lg.textContent = 'paski: prędkość · przyspieszenie · przyczepność'; wrap.append(lg);
  markCar();
}
const previewCache = {};
function trackPreview(id) {
  if (previewCache[id]) return previewCache[id];
  const t = new Track(id), W = 120, H = 66, pad = 8;
  const b = t.bounds, sc = Math.min((W - 2 * pad) / (b.maxX - b.minX), (H - 2 * pad) / (b.maxZ - b.minZ));
  const ox = (W - (b.maxX - b.minX) * sc) / 2, oz = (H - (b.maxZ - b.minZ) * sc) / 2;
  const P = (i) => [ox + (t.x[i % t.N] - b.minX) * sc, oz + (t.z[i % t.N] - b.minZ) * sc];
  let d = '';
  for (let i = 0; i < t.N; i += 4) { const [x, y] = P(i); d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }
  d += 'Z';
  const [sx, sy] = P(0), nx = -t.tz[0], nz = t.tx[0];
  const line = `M${(sx - nx * 4.5).toFixed(1)} ${(sy - nz * 4.5).toFixed(1)}L${(sx + nx * 4.5).toFixed(1)} ${(sy + nz * 4.5).toFixed(1)}`;
  return (previewCache[id] = `<svg class="prev" viewBox="0 0 ${W} ${H}"><path d="${d}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="7.5" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#d9d4f5" stroke-width="4.6" stroke-linejoin="round"/><path d="${line}" stroke="#ff4f8b" stroke-width="2.6" stroke-linecap="round"/></svg>`);
}
function buildSettings(wrapId, vals, canEdit, onChange) {
  const w = $(wrapId); w.textContent = '';
  const row = (label) => { const r = document.createElement('div'); r.className = 'set'; const l = document.createElement('span'); l.textContent = label; r.append(l); w.append(r); return r; };
  const r1 = row('Okrążenia');
  const st = document.createElement('div'); st.className = 'step';
  const mk = (txt, delta) => { const b = document.createElement('button'); b.textContent = txt; b.disabled = !canEdit || (delta < 0 ? vals.laps <= 1 : vals.laps >= 10); b.addEventListener('click', () => onChange({ laps: vals.laps + delta })); return b; };
  const n = document.createElement('b'); n.textContent = vals.laps;
  st.append(mk('−', -1), n, mk('+', 1)); r1.append(st);
  const r2 = row('Paczki');
  const sg = document.createElement('div'); sg.className = 'seg';
  for (const [v, t] of [['off', 'Brak'], ['rare', 'Rzadko'], ['normal', 'Normalnie'], ['often', 'Często']]) {
    const b = document.createElement('button'); b.textContent = t; b.disabled = !canEdit; b.classList.toggle('sel', vals.pickups === v);
    b.addEventListener('click', () => onChange({ pickups: v })); sg.append(b);
  }
  r2.append(sg);
}
function renderMenuSettings() {
  buildSettings('menu-settings', { laps: S.laps, pickups: S.pickups }, true, (c) => {
    if (c.laps != null) S.laps = c.laps;
    if (c.pickups) { S.pickups = c.pickups; store.set('tc_pickups', c.pickups); }
    renderMenuSettings();
  });
}
const THEME_SW = { lato: ['#5f9c49', '#a1694a'], pustynia: ['#d9b878', '#a9764f'], zima: ['#e8eef6', '#8d96a6'] };
function buildTrackList(wrapId, selected, onPick, canPick) {
  const wrap = $(wrapId); wrap.textContent = '';
  for (const id of TRACK_IDS) {
    const d = TRACK_DEFS[id]; const b = document.createElement('button'); b.className = 'track' + (id === selected ? ' sel' : '');
    const sw = THEME_SW[d.theme];
    b.disabled = !canPick;
    b.innerHTML = `<div class="pv" style="background:${sw[0]}">${trackPreview(id)}</div><b></b><small></small>`;
    b.querySelector('b').textContent = d.name; b.querySelector('small').textContent = d.tag;
    b.addEventListener('click', () => onPick(id));
    wrap.append(b);
  }
}
function pickMenuTrack(id) {
  S.trackId = id; store.set('tc_track', id); S.laps = TRACK_DEFS[id].laps; renderMenuSettings();
  buildTrackList('track-list', id, pickMenuTrack, true);
  if (S.mode === 'menu') { toast('Ładowanie toru…', 800); setTimeout(() => { useTrack(id); setCar(me, S.carId, 0); }, 30); }
}
function markCar() { document.querySelectorAll('.car').forEach((b) => b.classList.toggle('sel', b.dataset.id === S.carId)); }

function goMenu() {
  clearTimers();
  if (socket && S.room) socket.emit('room:leave');
  S.room = null; S.solo = false; S.you = null;
  setMode('menu');
  $('menu-nick').textContent = S.nick;
  $('menu-err').textContent = '';
  useTrack(S.trackId);
  if (!S.laps) S.laps = TRACK_DEFS[S.trackId].laps;
  renderMenuSettings();
  buildTrackList('track-list', S.trackId, pickMenuTrack, true);
  opp.present = false; setCar(opp, null); setCar(me, S.carId, 0);
  me.finished = false; resetItems();
  particles.clear(); skids.clear();
  showScreen('menu');
  loadRanking();
}

function renderLobby() {
  const r = S.room; if (!r) return;
  $('lobby-code').textContent = r.id;
  $('lobby-link').value = `${location.origin}${location.pathname}?room=${r.id}`;
  const two = r.players.length === 2;
  $('copyrow').classList.toggle('hidden', two);
  $('lobby-hint').textContent = two ? 'Obaj gracze są w pokoju. Gdy oboje klikniecie „Gotowy”, ruszy odliczanie.' : 'Wyślij ten link drugiemu graczowi:';
  const box = $('lobby-players'); box.textContent = '';
  for (let s = 0; s < 2; s++) {
    const p = r.players.find((x) => x.slot === s);
    const row = document.createElement('div'); row.className = 'player' + (p ? '' : ' empty');
    if (p) {
      const d = CAR_DEFS[p.car];
      row.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="st"></span>';
      row.querySelector('.dot').style.background = d.color;
      const nm = row.querySelector('.nm'); nm.append(p.nick + (p.id === S.you ? ' (Ty)' : ''));
      const sm = document.createElement('small'); sm.textContent = d.name; nm.append(sm);
      const st = row.querySelector('.st'); st.textContent = p.ready ? 'Gotowy' : 'Czeka'; st.classList.toggle('ok', p.ready);
    } else {
      row.innerHTML = '<span class="dot"></span><span class="nm">Czekam na drugiego gracza…</span>';
    }
    box.append(row);
  }
  const mine = r.players.find((x) => x.id === S.you);
  const isHost = mine?.slot === 0;
  buildTrackList('lobby-tracks', r.track, (id) => socket?.emit('room:track', id), isHost);
  buildSettings('lobby-settings', r.settings, isHost, (c) => socket?.emit('room:settings', c));
  $('track-note').textContent = isHost ? '— wybierasz jako gospodarz' : '— wybiera gospodarz';
  if (r.track !== trackId) { useTrack(r.track); me.carIdShown = null; opp.carId = null; opp.slotShown = null; }
  const btn = $('btn-ready');
  btn.disabled = !two;
  btn.classList.toggle('on', !!mine?.ready);
  btn.textContent = mine?.ready ? 'Gotowy ✓' : 'Gotowy';
  // auta w tle (showroom)
  const slot = mySlot();
  if (!me.vis || me.carIdShown !== mine?.car || me.slotShown !== slot) { setCar(me, mine?.car || S.carId, slot); me.carIdShown = mine?.car; me.slotShown = slot; }
  const o = r.players.find((x) => x.id !== S.you);
  if (o) { if (opp.carId !== o.car || !opp.vis || opp.slotShown !== 1 - slot) { opp.present = true; opp.nick = o.nick; opp.carId = o.car; opp.slotShown = 1 - slot; setCar(opp, o.car, 1 - slot); } }
  else { opp.present = false; opp.carId = null; setCar(opp, null); }
}

// ======================= Multiplayer =======================
function connect() {
  if (socket) return socket;
  if (typeof io === 'undefined') { $('menu-err').textContent = 'Brak połączenia z serwerem gry (uruchom: npm start).'; return null; }
  socket = io({ path: location.pathname.replace(/[^/]*$/, '') + 'socket.io' });
  socket.on('connect_error', () => { $('menu-err').textContent = 'Nie można połączyć się z serwerem.'; });
  socket.on('disconnect', () => { if (S.room) { toast('Utracono połączenie z serwerem', 3500); goMenu(); } });
  socket.on('room:update', (room) => {
    const had = S.room?.players.length || 0;
    S.room = room;
    if (S.mode === 'lobby') renderLobby();
    if (room.players.length > had && had) sfx.join();
    if (S.mode === 'finished' && S.results) updateResultsButtons();
  });
  socket.on('room:left', ({ nick }) => { toast(`${nick} opuścił wyścig`, 3000); });
  socket.on('race:prepare', (room) => {
    S.room = room; S.solo = false;
    startPrepare();
  });
  socket.on('race:count', (n) => countTick(String(n)));
  socket.on('race:go', () => goRace());
  socket.on('race:opp', (a) => { if (Array.isArray(a) && a.length >= 13) opp.snaps.push({ t: performance.now(), a }); if (opp.snaps.length > 40) opp.snaps.shift(); });
  socket.on('race:end', (data) => { S.results = data; if (S.mode === 'racing' || S.mode === 'finished' || S.mode === 'countdown') { setMode('finished'); showResultsMP(); } });
  socket.on('ranking', (list) => renderRanking(list));
  socket.on('pickup:spawn', (p) => { if (S.mode === 'racing' || S.mode === 'countdown') spawnCrate(p.id, p.type, p.u, p.l); });
  socket.on('pickup:remove', ({ id }) => items.remove(id, false));
  socket.on('pickup:taken', ({ id, by, type }) => { items.remove(id); if (by === S.you) applyPickup(type); });
  socket.on('game:event', (e) => onGameEvent(e));
  return socket;
}
const emitAck = (ev, data) => new Promise((res) => socket.timeout(5000).emit(ev, data, (err, r) => res(err ? { ok: false, error: 'Serwer nie odpowiada.' } : r)));

async function createRoom() {
  if (!connect()) return;
  const r = await emitAck('room:create', { nick: S.nick, car: S.carId, track: S.trackId, settings: { laps: S.laps, pickups: S.pickups } });
  if (!r.ok) { $('menu-err').textContent = r.error; return; }
  S.room = r.room; S.you = r.you; S.solo = false;
  enterLobby();
}
async function joinRoom() {
  if (!connect()) return;
  const r = await emitAck('room:join', { id: S.joinCode, nick: S.nick, car: S.carId });
  if (!r.ok) { $('menu-err').textContent = r.error; return; }
  history.replaceState(null, '', location.pathname);
  S.joinCode = null; $('join-banner').classList.add('hidden'); $('btn-join').classList.add('hidden'); $('btn-create').classList.remove('hidden');
  S.room = r.room; S.you = r.you; S.solo = false;
  enterLobby();
}
function enterLobby() {
  setMode('lobby');
  me.carIdShown = null; opp.carId = null;
  renderLobby();
  showScreen('lobby');
  $('lobby-err').textContent = '';
  sfx.join();
}

// ======================= Przebieg wyścigu =======================
function clearTimers() { timers.forEach(clearTimeout); timers = []; }
function startPrepare() {
  clearTimers();
  useTrack(S.solo ? S.trackId : S.room.track);
  S.lapsNow = S.solo ? S.laps : S.room.settings.laps;
  resetRace();
  setMode('countdown');
  showScreen(null);
  $('hud-help').classList.remove('fade');
  timers.push(setTimeout(() => $('hud-help').classList.add('fade'), 9000));
  $('countdown').textContent = '';
}
function startSolo() {
  S.solo = true; S.room = null;
  startPrepare();
  [[800, '3'], [1800, '2'], [2800, '1']].forEach(([ms, n]) => timers.push(setTimeout(() => countTick(n), ms)));
  timers.push(setTimeout(goRace, 3800));
}
function countTick(n) {
  const c = $('countdown'); c.className = ''; c.textContent = n; void c.offsetWidth; c.className = 'pop';
  sfx.beep(false);
}
function goRace() {
  const c = $('countdown'); c.className = ''; c.textContent = 'START!'; void c.offsetWidth; c.className = 'pop go';
  sfx.beep(true);
  setMode('racing');
  S.raceStart = performance.now();
  me.lapStart = S.raceStart;
}
function elapsed() { return (performance.now() - S.raceStart) / 1000; }

function onLapProgress() {
  const N = track.N;
  me.maxP = Math.max(me.maxP, me.st.progress);
  const lapIdx = Math.floor(me.maxP / N);
  if (lapIdx > me.lapIdx) {
    me.lapIdx = lapIdx;
    const now = performance.now();
    const lt = (now - me.lapStart) / 1000; me.lapStart = now;
    me.lapTimes.push(lt);
    const isBest = lt < me.best; me.best = Math.min(me.best, lt);
    if (lapIdx >= S.lapsNow) finishLocal();
    else { sfx.lap(); toast(`Okrążenie ${lapIdx}: ${fmt(lt)}${isBest ? '  · najlepsze' : ''}`, 2400); }
    $('hud-best').textContent = `Najlepsze: ${fmt(me.best)}`;
    $('hud-lap').textContent = `${Math.min(S.lapsNow, lapIdx + 1)}/${S.lapsNow}`;
  }
}
function finishLocal() {
  me.finished = true; me.finishTime = elapsed();
  toast('Meta!', 1800);
  if (S.solo) { setMode('finished'); showResultsSolo(); }
  else {
    sfx.lap(); socket?.emit('race:finish', { time: me.finishTime });
    if (S.results) { S.results.times[S.you] = me.finishTime; showResultsMP(); }
  }
}

function showResultsSolo() {
  $('res-title').className = 'res-title'; $('res-title').textContent = 'Meta!';
  $('res-sub').textContent = `Czas całkowity: ${fmt(me.finishTime)}`;
  const t = $('res-table'); t.textContent = '';
  const head = document.createElement('tr'); head.innerHTML = '<th>Okrążenie</th><th>Czas</th>'; t.append(head);
  me.lapTimes.forEach((lt, i) => {
    const tr = document.createElement('tr'); if (lt === me.best) tr.className = 'win';
    const a = document.createElement('td'); a.textContent = `Okrążenie ${i + 1}${lt === me.best ? ' · najlepsze' : ''}`;
    const b = document.createElement('td'); b.textContent = fmt(lt); tr.append(a, b); t.append(tr);
  });
  $('btn-rematch').textContent = 'Jeszcze raz'; $('btn-rematch').disabled = false; $('btn-rematch').classList.remove('on');
  $('rank-results').parentElement.querySelectorAll('h4, #rank-results').forEach((e) => e.classList.add('hidden'));
  sfx.win();
  showScreen('results');
  loadRanking();
}
function showResultsMP() {
  const d = S.results; if (!d) return;
  $('rank-results').parentElement.querySelectorAll('h4, #rank-results').forEach((e) => e.classList.remove('hidden'));
  const won = d.winner === S.you;
  $('res-title').className = 'res-title' + (won ? '' : ' lose');
  $('res-title').textContent = won ? 'Wygrana!' : 'Porażka';
  const w = d.players.find((p) => p.id === d.winner);
  $('res-sub').textContent = d.reason === 'left' ? 'Przeciwnik opuścił wyścig.' : `${w ? w.nick : 'Gracz'} wygrywa wyścig.`;
  const t = $('res-table'); t.textContent = '';
  const head = document.createElement('tr'); head.innerHTML = '<th>Kierowca</th><th>Czas</th>'; t.append(head);
  const order = [...d.players].sort((a, b) => (a.id === d.winner ? -1 : b.id === d.winner ? 1 : 0));
  for (const p of order) {
    const tr = document.createElement('tr'); if (p.id === d.winner) tr.className = 'win';
    const a = document.createElement('td'); a.textContent = `${p.id === d.winner ? '1. ' : '2. '}${p.nick}${p.id === S.you ? ' (Ty)' : ''}`;
    const b = document.createElement('td');
    const tm = d.times[p.id];
    b.textContent = tm != null ? fmt(tm) : (p.id === S.you && !me.finished ? 'jedziesz…' : d.reason === 'left' ? '—' : 'w trasie…');
    tr.append(a, b); t.append(tr);
  }
  if (d.ranking) renderRanking(d.ranking);
  if (!S.resultSounded) { S.resultSounded = true; (won ? sfx.win : sfx.lose)(); $('btn-rematch').textContent = 'Rewanż'; $('btn-rematch').classList.remove('on'); }
  updateResultsButtons();
  showScreen('results');
}
function updateResultsButtons() {
  const b = $('btn-rematch');
  const two = S.room && S.room.players.length === 2;
  const mine = S.room?.players.find((p) => p.id === S.you);
  b.disabled = !two || !!mine?.ready;
  if (!two) b.textContent = 'Przeciwnik wyszedł';
  else if (mine?.ready) b.textContent = 'Czekam na przeciwnika…';
  else b.textContent = 'Rewanż';
}

// ======================= Opiekun przeciwnika (interpolacja) =======================
function sampleOpp(now, dt) {
  const sn = opp.snaps; const st = opp.st;
  if (!sn.length || !st) return false;
  const rt = now - 110;
  let a, b, f = 0;
  if (rt <= sn[0].t) { a = b = sn[0].a; }
  else if (rt >= sn[sn.length - 1].t) {
    a = b = sn[sn.length - 1].a;
    const ex = Math.min(0.15, (rt - sn[sn.length - 1].t) / 1000);
    st.x = a[0] + a[3] * ex; st.z = a[1] + a[4] * ex; st.yaw = a[2];
    return applyOpp(a, a, 0, true, ex);
  } else {
    for (let i = sn.length - 2; i >= 0; i--) if (sn[i].t <= rt) { a = sn[i].a; b = sn[i + 1].a; f = (rt - sn[i].t) / Math.max(1, sn[i + 1].t - sn[i].t); break; }
  }
  return applyOpp(a, b, f, false, 0);
}
function applyOpp(a, b, f, ex, exT) {
  const st = opp.st; const L = (i) => a[i] + (b[i] - a[i]) * f;
  if (!ex) {
    st.x = L(0); st.z = L(1);
    let dy = b[2] - a[2]; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    st.yaw = a[2] + dy * f;
  }
  st.vx = L(3); st.vz = L(4); st.steer = L(5); st.vf = L(6); st.vl = L(7); st.progress = L(8);
  st.throttle = a[9]; st.brakeLit = !!a[10]; st.onGrass = !!a[11]; st.slip = Math.abs(st.vl);
  opp.finished = !!a[12]; st.nitro = !!a[13];
  return true;
}

// ======================= Efekty aut =======================
const tmpC = new THREE.Color();
const wheelWorld = (st, lx, lz) => {
  const c = Math.cos(st.yaw), s = Math.sin(st.yaw);
  return [st.x + c * lx - s * lz, st.z + s * lx + c * lz];
};
function carFx(c, key, dt) {
  const st = c.st; if (!st || !c.vis) return;
  const sp = Math.abs(st.vf);
  const M = c.vis.model;
  const sliding = st.slip > 5.5 && sp > 7 && !st.onGrass;
  const braking = st.brakeLit && sp > 24;
  const [lx, lz] = wheelWorld(st, -M.wheelX, M.wheelZ);
  const [rx, rz] = wheelWorld(st, -M.wheelX, -M.wheelZ);
  const on = (sliding || braking) && S.mode !== 'menu' && S.mode !== 'lobby';
  skids.add(key + 'L', lx, lz, on); skids.add(key + 'R', rx, rz, on);
  if (S.mode === 'menu' || S.mode === 'lobby') return;
  if (st.nitro) {
    const [ex, ez] = wheelWorld(st, -M.L / 2 - 0.2, 0);
    for (let i = 0; i < 3; i++) { tmpC.setRGB(0.3 + Math.random() * 0.4, 0.6 + Math.random() * 0.3, 1); particles.emit(ex, 0.55, ez, -Math.cos(st.yaw) * (10 + Math.random() * 8) + (Math.random() - 0.5) * 2, Math.random() * 1.5, -Math.sin(st.yaw) * (10 + Math.random() * 8) + (Math.random() - 0.5) * 2, 0.28, 1.1, 0.2, tmpC, 0.9, 2); }
    tmpC.setRGB(1, 0.55, 0.15); particles.emit(ex, 0.55, ez, -Math.cos(st.yaw) * 6, 0.3, -Math.sin(st.yaw) * 6, 0.18, 0.9, 0.1, tmpC, 0.9, 2);
  }
  if (sliding) {
    c.smokeAcc += dt * 50 * clamp((st.slip - 4.5) / 8, 0.25, 1);
    while (c.smokeAcc >= 1) {
      c.smokeAcc -= 1;
      const side = Math.random() > 0.5;
      tmpC.setRGB(0.88, 0.88, 0.92);
      particles.emit(side ? lx : rx, 0.25, side ? lz : rz, st.vx * 0.12 + (Math.random() - 0.5) * 1.5, 0.8 + Math.random() * 0.8, st.vz * 0.12 + (Math.random() - 0.5) * 1.5, 0.9, 1.1, 3.4, tmpC, 0.4, 1.3);
    }
  } else if (st.onGrass && sp > 7) {
    c.smokeAcc += dt * 40 * clamp(sp / 30, 0.2, 1);
    while (c.smokeAcc >= 1) {
      c.smokeAcc -= 1;
      const side = Math.random() > 0.5;
      tmpC.setRGB(0.28 + Math.random() * 0.12, 0.38 + Math.random() * 0.1, 0.14);
      particles.emit(side ? lx : rx, 0.3, side ? lz : rz, st.vx * 0.1 + (Math.random() - 0.5) * 2.5, 1.2 + Math.random() * 1.5, st.vz * 0.1 + (Math.random() - 0.5) * 2.5, 0.7, 0.5, 1.6, tmpC, 0.4, 1.5, 4);
    }
  }
}
function sparks(x, z, power) {
  const n = Math.round(6 + power * 0.8);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * (6 + power * 0.4);
    tmpC.setRGB(1, 0.65 + Math.random() * 0.3, 0.2);
    particles.emit(x, 0.8, z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, 0.35 + Math.random() * 0.25, 0.45, 0.1, tmpC, 1, 0.8, 18);
  }
}

// ======================= Wejście =======================
const typing = () => document.activeElement && document.activeElement.tagName === 'INPUT';
window.addEventListener('keydown', (e) => {
  if (typing()) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyM' && !e.repeat) toggleMute();
  if (!e.repeat) {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') useNitro();
    else if (e.code === 'KeyF') fire();
    else if (e.code === 'KeyE') dropOil();
  }
  if (!audioReady()) initAudio();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
function readInput() {
  const k = (...c) => c.some((x) => keys.has(x));
  input.throttle = k('KeyW', 'ArrowUp') ? 1 : 0;
  input.brake = k('KeyS', 'ArrowDown') ? 1 : 0;
  input.steer = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
  input.hand = keys.has('Space');
}
function toggleMute() { setMuted(!isMuted()); refreshMute(); }
function refreshMute() { $('ico-on').classList.toggle('hidden', isMuted()); $('ico-off').classList.toggle('hidden', !isMuted()); }

// ======================= Przedmioty, broń, nitro =======================
const soloSpawn = { t: 5, id: 1 };
function resetItems() {
  items.clear();
  me.items = { nitro: false, oil: false, ammoT: 0 }; me.nitroT = 0; me.tireCd = 0;
  if (me.st) { me.st.nitro = false; me.st.slowT = 0; me.st.inOil = false; }
  soloSpawn.t = 5;
  world?.tires.reset();
  updateSlots();
}
const crateSpot = (u, l) => track.at(Math.floor(u * track.N), l * ROAD_HALF * 0.8);
function spawnCrate(id, type, u, l) { const q = crateSpot(u, l); items.spawn(id, type, q.x, q.z); }
function applyPickup(type) {
  sfx.pickup();
  if (type === 'nitro') { me.items.nitro = true; toast('Nitro — Shift'); }
  else if (type === 'ammo') { me.items.ammoT = 2; toast('Naboje — F (masz 2 s)'); }
  else { me.items.oil = true; toast('Olej — E'); }
  updateSlots();
}
const racingNow = () => S.mode === 'racing' && !me.finished;
function useNitro() {
  if (!racingNow() || !me.items.nitro || me.nitroT > 0) return;
  me.items.nitro = false; me.nitroT = 2.5; sfx.nitro(); updateSlots();
}
function fire() {
  if (!racingNow()) return;
  if (me.items.ammoT <= 0) { if (me.items.nitro || me.items.oil || true) sfx.empty(); return; }
  const s = me.st;
  items.shoot(s.x, s.z, s.yaw, s.vx, s.vz, 'me');
  me.items.ammoT = 0; sfx.shoot(); updateSlots();
  if (!S.solo) socket?.emit('game:event', { t: 'shoot', x: s.x, z: s.z, yaw: s.yaw, vx: s.vx, vz: s.vz });
}
function dropOil() {
  if (!racingNow() || !me.items.oil) return;
  const s = me.st, x = s.x - Math.cos(s.yaw) * 3.4, z = s.z - Math.sin(s.yaw) * 3.4;
  items.dropOil(x, z, 'me'); me.items.oil = false; sfx.oil(); updateSlots();
  if (!S.solo) socket?.emit('game:event', { t: 'oil', x, z });
}
function onGameEvent(e) {
  if (e.t === 'shoot') items.shoot(e.x, e.z, e.yaw, e.vx, e.vz, 'opp');
  else if (e.t === 'oil') items.dropOil(e.x, e.z, 'opp');
  else if (e.t === 'hit' && me.st) {
    me.st.vx *= 0.4; me.st.vz *= 0.4; me.st.slowT = 2.2;
    sparks(me.st.x, me.st.z, 14); sfx.hit(); toast('Trafiony!', 1400);
    items.shots.filter((x) => x.owner === 'opp').forEach((x) => items.killShot(x));
  }
}
function updateSlots() {
  $('slot-nitro').classList.toggle('has', me.items.nitro || me.nitroT > 0);
  $('slot-nitro').classList.toggle('active', me.nitroT > 0);
  $('slot-ammo').classList.toggle('has', me.items.ammoT > 0);
  $('slot-oil').classList.toggle('has', me.items.oil);
  $('ammo-bar').style.width = `${clamp(me.items.ammoT / 2, 0, 1) * 100}%`;
}
const puff = (x, z, n = 3) => { for (let i = 0; i < n; i++) { tmpC.setRGB(0.2, 0.2, 0.22); particles.emit(x, 0.5, z, (Math.random() - 0.5) * 4, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 4, 0.6, 0.8, 2.2, tmpC, 0.5, 1.5); } };

function updateGameplay(dt, active) {
  // tory: opony
  world.tires.update(dt);
  if (!me.st) return;
  items.update(dt, track);
  if (!active) return;
  me.tireCd -= dt;
  const nb = world.tires.collide(me.st, 1.3, (x, z) => puff(x, z));
  if (nb && me.tireCd <= 0) { me.st.vx *= 0.85; me.st.vz *= 0.85; me.tireCd = 0.35; sfx.tire(Math.min(1, me.st.speed / 40)); }
  if (opp.present && opp.st) world.tires.collide(opp.st, 1.3, (x, z) => puff(x, z, 2));
  // olej i nitro
  me.st.inOil = items.inOil(me.st.x, me.st.z);
  if (me.nitroT > 0) { me.nitroT -= dt; me.st.nitro = me.nitroT > 0; if (me.nitroT <= 0) updateSlots(); } else me.st.nitro = false;
  if (me.items.ammoT > 0) { me.items.ammoT -= dt; if (me.items.ammoT <= 0) { me.items.ammoT = 0; updateSlots(); } else $('ammo-bar').style.width = `${me.items.ammoT / 2 * 100}%`; }
  // paczki: solo spawnuje lokalnie, w multiplayerze robi to serwer
  if (S.solo && S.mode === 'racing') {
    soloSpawn.t -= dt;
    if (soloSpawn.t <= 0) {
      soloSpawn.t = (8 + Math.random() * 5) * ({ off: 1, rare: 1.8, normal: 1, often: 0.5 }[S.pickups]);
      if (S.pickups !== 'off' && items.crates.size < 3) spawnCrate(soloSpawn.id++, ['nitro', 'nitro', 'ammo', 'ammo', 'oil'][Math.random() * 5 | 0], Math.random(), (Math.random() - 0.5) * 1.3);
    }
    for (const c of items.crates.values()) if (c.landed && !c.dying && c.age > 30) items.remove(c.id, false);
  }
  if (racingNow()) {
    const c = items.touch(me.st.x, me.st.z, 3) || items.touch(me.st.x + Math.cos(me.st.yaw) * 1.6, me.st.z + Math.sin(me.st.yaw) * 1.6, 2.6);
    if (c && !c.requested) {
      c.requested = true;
      if (S.solo) { applyPickup(c.type); items.remove(c.id); } else socket?.emit('pickup:take', { id: c.id });
    }
  }
  // trafienia własnych pocisków w przeciwnika (rozstrzyga strzelający)
  if (opp.present && opp.st) {
    for (const sh of items.shots) {
      if (sh.owner !== 'me' || sh.life <= 0) continue;
      const cs = Math.cos(opp.st.yaw), sn = Math.sin(opp.st.yaw);
      if ([0, 1.5, -1.5].some((o) => Math.hypot(sh.x - (opp.st.x + cs * o), sh.z - (opp.st.z + sn * o)) < 2.1)) {
        items.killShot(sh); sparks(opp.st.x, opp.st.z, 14); sfx.hit();
        if (!S.solo) socket?.emit('game:event', { t: 'hit' });
      }
    }
  }
}

// ======================= Pętla gry =======================
let last = performance.now(), T = 0, sendAcc = 0, fpsAvg = 16, slowFrames = 0;
const tagEls = {};
function tagFor(key, nick, color) {
  if (!tagEls[key]) { const d = document.createElement('div'); d.className = 'tag'; d.innerHTML = '<i></i><span></span>'; $('tags').append(d); tagEls[key] = d; }
  const d = tagEls[key];
  if (d._nick !== nick) { d.lastChild.textContent = nick; d._nick = nick; }
  d.firstChild.style.background = color;
  return d;
}
const pv = new THREE.Vector3();
function updateTags() {
  const racing = S.mode === 'countdown' || S.mode === 'racing' || S.mode === 'finished';
  const W = innerWidth, H = innerHeight;
  const place = (key, c, nick) => {
    const d = tagFor(key, nick, c?.vis ? c.vis.def.color : '#fff');
    if (!racing || !c?.st || !c.vis || !nick) { d.style.display = 'none'; return; }
    pv.set(c.st.x, 3.4, c.st.z).project(camera);
    d.style.display = 'flex';
    d.style.transform = `translate(${((pv.x + 1) / 2) * W}px, ${((1 - pv.y) / 2) * H}px) translate(-50%, -100%)`;
  };
  place('me', me, S.solo ? S.nick : (S.room?.players.find((p) => p.id === S.you)?.nick ?? S.nick));
  place('opp', opp.present ? opp : null, opp.nick);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - last) / 1000, 0.001, 0.05); last = now; T += dt;
  // adaptacyjna rozdzielczość
  fpsAvg += (dt * 1000 - fpsAvg) * 0.05;
  if (fpsAvg > 30 && pr > 1) { if (++slowFrames > 90) { pr = Math.max(1, pr - 0.5); slowFrames = 0; resize(); } } else slowFrames = 0;

  readInput();
  const active = S.mode === 'racing' || S.mode === 'finished';
  const racing = active || S.mode === 'countdown';

  if (me.st && active) {
    const inp = me.finished ? { throttle: 0, brake: 0.3, steer: 0, hand: false } : input;
    me.st.step(track, inp, dt);
    if (opp.present && opp.st) {
      if (sampleOpp(performance.now(), dt)) {
        const h = carVsCar(me.st, opp.st);
        if (h > 1.5 && me.hitCd <= 0) { sfx.crash(h / 14, 0); sparks((me.st.x + opp.st.x) / 2, (me.st.z + opp.st.z) / 2, h); me.hitCd = 0.15; }
      }
    }
    me.hitCd -= dt;
    if (me.st.hit > 3 && me.hitCd <= 0) { sfx.crash(me.st.hit / 18, 0); sparks(me.st.x, me.st.z, me.st.hit); me.hitCd = 0.2; }
    if (S.mode === 'racing' || (S.mode === 'finished' && !me.finished && !S.solo)) onLapProgress();
  } else if (opp.present && opp.st && racing) sampleOpp(performance.now(), dt);

  if (me.st) updateGameplay(dt, active); else if (world) world.tires.update(dt);

  // wysyłanie stanu
  if (!S.solo && S.room && racing && socket && me.st) {
    sendAcc += dt;
    if (sendAcc >= 0.033) {
      sendAcc = 0;
      const s = me.st, r = (v) => Math.round(v * 100) / 100;
      socket.volatile.emit('race:state', [r(s.x), r(s.z), r(s.yaw), r(s.vx), r(s.vz), r(s.steer), r(s.vf), r(s.vl), r(s.progress), input.throttle, s.brakeLit ? 1 : 0, s.onGrass ? 1 : 0, me.finished ? 1 : 0, s.nitro ? 1 : 0]);
    }
  }

  // wizualizacja
  if (me.vis && me.st) me.vis.sync(me.st, dt);
  if (opp.vis && opp.st && opp.present) {
    opp.st.accelNow += (((opp.st.vf - opp.prevVf) / dt) - opp.st.accelNow) * Math.min(1, dt * 6); opp.prevVf = opp.st.vf;
    opp.vis.sync(opp.st, dt);
  }
  if (racing) { carFx(me, 'me', dt); if (opp.present) carFx(opp, 'op', dt); }
  particles.update(dt, camera, renderer.domElement.height);
  world.update(T);

  // dźwięk
  if (audioReady()) {
    if (!me.audio) me.audio = new CarAudio(0.85, 0);
    if (!opp.audio) opp.audio = new CarAudio(0.45, 0);
    const maxS = (me.st?.def.maxSpeed || 45);
    me.audio.update({ speed: me.st ? me.st.vf / maxS : 0, throttle: racing && !me.finished ? input.throttle : 0, slip: me.st ? clamp((me.st.slip - 4.5) / 8, 0, 1) * (active ? 1 : 0) : 0, rough: me.st && (me.st.onGrass || me.st.onKerb) && active ? 1 : 0, active: racing }, dt);
    if (opp.present && opp.st) {
      pv.set(opp.st.x, 0, opp.st.z).project(camera); opp.audio.panner.pan.value = clamp(pv.x, -1, 1) * 0.6;
      opp.audio.update({ speed: opp.st.vf / opp.st.def.maxSpeed, throttle: opp.st.throttle || 0, slip: clamp((opp.st.slip - 4.5) / 8, 0, 1), rough: opp.st.onGrass ? 1 : 0, active: racing }, dt);
    } else opp.audio.update({ speed: 0, throttle: 0, slip: 0, rough: 0, active: false }, dt);
  }

  updateCamera(dt);
  updateHud();
  updateTags();
  post.composer.render(dt);
}

function updateCamera(dt) {
  const racingView = S.mode === 'countdown' || S.mode === 'racing' || S.mode === 'finished';
  let pos, look, fov, shift, tilt;
  void racingView;
  if (racingView && me.st) {
    // kamera podąża za moim autem; oddala się, gdy rywal jest daleko
    const m = me.st;
    let fx = m.x + m.vx * 0.28, fz = m.z + m.vz * 0.28;
    let half = 27 + clamp(m.speed - 15, 0, 30) * 0.18;
    if (opp.present && opp.st) {
      const dx = opp.st.x - m.x, dz = opp.st.z - m.z, d = Math.hypot(dx, dz);
      const w = 0.25 * clamp(d / 60, 0, 1);
      fx += dx * w; fz += dz * w;
      half = Math.max(half, 20 + d * 0.5);
    }
    half = Math.min(half, 80);
    if (cam.first || cam.racingT === undefined) { cam.focus.set(fx, 0, fz); cam.half = half; }
    cam.half += (half - cam.half) * (1 - Math.exp(-dt * 1.8));
    cam.focus.x += (fx - cam.focus.x) * (1 - Math.exp(-dt * 6)); cam.focus.z += (fz - cam.focus.z) * (1 - Math.exp(-dt * 6));
    pos = cam.focus.clone().addScaledVector(CAM_DIR, cam.half * 3.9); look = cam.focus.clone();
    fov = RACE_FOV + (m.nitro ? 3.5 : 0); shift = 0; tilt = 0.9;
    cam.racingT = (cam.racingT ?? 0) + dt;
  } else {
    const P = new THREE.Vector3(me.st ? me.st.x : 0, 0.8, me.st ? me.st.z : 0);
    const two = opp.present && opp.st;
    if (two) P.set((me.st.x + opp.st.x) / 2, 0.8, (me.st.z + opp.st.z) / 2);
    const a = T * 0.2 + 0.5, r = two ? 21 : 15.5;
    pos = new THREE.Vector3(P.x + Math.cos(a) * r, 8.2 + Math.sin(T * 0.4) * 0.8, P.z + Math.sin(a) * r);
    look = P.clone(); fov = 36; shift = S.mode === 'menu' || S.mode === 'lobby' ? 0.13 : 0; tilt = 0.35;
  }
  if (!racingView) cam.racingT = undefined;
  const k = cam.first ? 1 : 1 - Math.exp(-dt * (racingView ? 2.6 + Math.min(1, cam.racingT / 1.4) * 8 : 2.4));
  cam.first = false;
  cam.pos.lerp(pos, k); cam.look.lerp(look, k);
  cam.fov += (fov - cam.fov) * k; cam.shift += (shift - cam.shift) * k; cam.tilt += (tilt - cam.tilt) * k;
  camera.position.copy(cam.pos); camera.lookAt(cam.look);
  camera.fov = cam.fov;
  const dist = cam.pos.distanceTo(cam.look);
  camera.near = Math.max(0.5, dist * 0.1); camera.far = dist * 4 + 1800;
  const W = innerWidth, H = innerHeight;
  if (Math.abs(cam.shift) > 0.002) camera.setViewOffset(W, H, -W * cam.shift, 0, W, H); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  post.tilt.uniforms.uAmount.value = cam.tilt;
  scene.fog.near = Math.max(160, dist * 1.5); scene.fog.far = scene.fog.near + Math.max(900, dist * 3);
}

let hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function updateHud() {
  if ($('hud').classList.contains('hidden') || !me.st) return;
  const sp = Math.abs(me.st.vf);
  setText('hud-speed', String(Math.round(sp * 3.8)));
  $('hud-bar').style.width = `${clamp(sp / me.st.def.maxSpeed, 0, 1) * 100}%`;
  if (S.mode === 'racing' && !me.finished) setText('hud-time', fmt(elapsed()));
  else if (me.finished) setText('hud-time', fmt(me.finishTime));
  if (opp.present && opp.st) { const first = me.st.progress >= opp.st.progress; setText('hud-pos', `${first ? 1 : 2}/2`); }
  setText('hud-lap', `${clamp(me.lapIdx + 1, 1, S.lapsNow)}/${S.lapsNow}`);
}

// ======================= Start =======================
function bindUi() {
  document.addEventListener('click', (e) => { if (e.target.closest('button')) { if (!audioReady()) initAudio(); sfx.click(); } });
  document.addEventListener('pointerover', (e) => { const b = e.target.closest?.('.car, .btn'); if (b && b !== bindUi.hv) { bindUi.hv = b; sfx.hover(); } });
  $('btn-mute').addEventListener('click', toggleMute);
  refreshMute();

  $('form-nick').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = $('inp-nick').value.replace(/[<>&"'`]/g, '').trim();
    if (n.length < 2) { $('nick-err').textContent = 'Nick musi mieć co najmniej 2 znaki.'; return; }
    S.nick = n.slice(0, 14); store.set('tc_nick', S.nick);
    initAudio(); goMenu();
  });
  $('btn-change-nick').addEventListener('click', () => { $('inp-nick').value = S.nick; showScreen('nick'); $('inp-nick').focus(); });
  $('btn-create').addEventListener('click', createRoom);
  $('btn-join').addEventListener('click', joinRoom);
  $('btn-solo').addEventListener('click', () => { initAudio(); startSolo(); });
  $('btn-copy').addEventListener('click', async () => {
    const inp = $('lobby-link');
    try { await navigator.clipboard.writeText(inp.value); } catch { inp.select(); document.execCommand('copy'); }
    $('btn-copy').textContent = 'Skopiowano ✓'; setTimeout(() => ($('btn-copy').textContent = 'Kopiuj'), 1600);
  });
  $('lobby-link').addEventListener('focus', (e) => e.target.select());
  $('btn-ready').addEventListener('click', () => {
    const mine = S.room?.players.find((p) => p.id === S.you);
    socket?.emit('player:ready', !mine?.ready);
  });
  $('btn-leave').addEventListener('click', goMenu);
  $('btn-menu').addEventListener('click', goMenu);
  $('btn-rematch').addEventListener('click', () => {
    if (S.solo) { startSolo(); return; }
    socket?.emit('player:ready', true);
    $('btn-rematch').disabled = true; $('btn-rematch').textContent = 'Czekam na przeciwnika…';
  });
}

(async function boot() {
  buildCarList();
  bindUi();
  const code = new URLSearchParams(location.search).get('room');
  if (code && /^[A-Za-z0-9]{4,8}$/.test(code)) {
    S.joinCode = code.toUpperCase();
    $('join-code').textContent = S.joinCode;
    $('join-banner').classList.remove('hidden');
    $('btn-join').classList.remove('hidden'); $('btn-create').classList.add('hidden');
  }
  resize();
  useTrack(S.trackId);
  setCar(me, S.carId, 0);
  requestAnimationFrame(frame);
  $('loading').classList.add('done');
  setTimeout(() => $('loading').remove(), 700);
  if (S.nick) goMenu(); else { showScreen('nick'); $('inp-nick').focus(); }
  window.__tc = { S, me, opp, items, camera, scene, keys, startSolo, post, get track() { return track; }, get world() { return world; } };
})();
