// Wrrr Ummm — wyścigi w stylu TrackMania: tory 3D z pętlami, skokami i przechyłami, bolid F1, multiplayer.
import * as THREE from 'three';
import { TRACK_DEFS, TRACK_IDS, buildTrack } from './tracks3d.js';
import { CarState, CAR_DEFS, CAR_COLORS, stripeFor, carVsCar, botInput } from './physics3d.js';
import { buildCar } from './car.js';
import { buildWorld3D } from './world3d.js';
import { Items3D, ITEM_TYPES } from './items3d.js';
import { THEMES3D } from './themes3d.js';
import { createPost } from './post.js';
import { Particles, SkidMarks } from './fx.js';
import { Minimap } from './minimap.js';
import { Music } from './music.js';
import { startFireworks, stopFireworks } from './podium.js';
import { initAudio, audioReady, CarAudio, sfx, isMuted, setMuted, setRain, getSfxVolume, setSfxVolume } from './audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const store = {
  get: (k, d = null) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* brak storage */ } },
};
const fmt = (t) => (t == null || !isFinite(t) ? '—' : `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`);
const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const CAR_ID = 'formula';
const BOT_NAMES = ['Rzeźnik', 'Wściekły Mirek', 'Młot', 'Piła'];

// ======================= Renderer / scena =======================
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
let pr = Math.min(window.devicePixelRatio || 1, 2);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 7000);
const post = createPost(renderer, scene, camera);
const particles = new Particles(scene, 1600);
const skids = new SkidMarks(scene);
const music = new Music();
const musicReady = music.load();
const musicStart = () => musicReady.then(() => music.playRandom());
const minimap = new Minimap(document.getElementById('minimap'));
const items = new Items3D(scene, particles);
items._thud = () => sfx.land(0.4);
const tmpC = new THREE.Color();
const pv = new THREE.Vector3();

// ======================= Tory (każdy budowany raz, potem tylko przełączany) =======================
const worlds = {};
let track = null, world = null, trackId = null;
function useTrack(id) {
  if (!TRACK_DEFS[id]) id = TRACK_IDS[0];
  if (trackId === id && world) return;
  if (world) world.root.visible = false;
  if (!worlds[id]) { const t = buildTrack(id); worlds[id] = { track: t, world: buildWorld3D(scene, renderer, t, TRACK_DEFS[id].theme) }; }
  ({ track, world } = worlds[id]);
  trackId = id;
  world.root.visible = true;
  particles.ground = null; particles.yOff = 0;
  minimap.setTrack(track); items.setTrack(track);
  particles.clear(); skids.clear(); clearDebris(); $('elim').classList.add('hidden');
  envSetStatic(previewEnv(id));
}

// ======================= Otoczenie: pora dnia i pogoda zmieniają się w trakcie wyścigu =======================
const DAY_CYCLE = 300; // pełna doba w sekundach wyścigu
const PHASE_OF = { day: 0.2, dusk: 0.5, night: 0.7 };
let env = { weather: 'sun', phase0: 0.2, dynamic: false, rainAt: 1e9, rainK: 0, seed: 1 };
let wet = 0, envT = 0, flash = 0, nextFlash = 8, thunderAt = 0;
const phaseFor = (time, id) => (PHASE_OF[time] ?? THEMES3D[TRACK_DEFS[id]?.theme]?.startPhase ?? 0.2);
function previewEnv(id) {
  const src = S.mode === 'lobby' && S.room ? S.room.settings : S;
  return { weather: src.weather === 'rain' || src.weather === 'storm' ? src.weather : 'sun', phase0: phaseFor(src.time, id), dynamic: false, rainAt: 1e9, rainK: 0, seed: 1 };
}
/** środowisko dla nowego wyścigu (solo): losowe, jeśli ustawienia są „losowo” */
function resolveEnvLocal(id) {
  const seed = (Math.random() * 1e9) | 0, r = Math.random();
  let weather = S.weather, rainAt = 1e9, rainK = 0;
  if (S.weather === 'auto') { weather = 'sun'; if (r > 0.5) { weather = r > 0.85 ? 'storm' : 'rain'; rainAt = 6 + Math.random() * 30; rainK = weather === 'storm' ? 1 : 0.8; if (!S.dynEnv) { rainAt = 0; } } }
  const ph = phaseFor(S.time, id) + (S.time === 'auto' ? (Math.random() - 0.5) * 0.12 : 0);
  return { weather: S.weather === 'auto' ? 'sun' : weather, phase0: ph, dynamic: S.dynEnv, rainAt: S.weather === 'auto' ? rainAt : (weather === 'sun' ? 1e9 : 0), rainK: S.weather === 'auto' ? rainK : (weather === 'storm' ? 1 : weather === 'rain' ? 0.8 : 0), seed };
}
function envSetStatic(e) { env = e; envT = 0; wet = e.weather === 'rain' ? 0.8 : e.weather === 'storm' ? 1 : 0; envApply(0, true); }
function envApply(dt, force = false) {
  if (!world) return;
  const rainTarget = env.rainAt <= envT ? env.rainK : (env.weather === 'rain' ? 0.8 : env.weather === 'storm' ? 1 : 0);
  wet += (rainTarget - wet) * (force ? 1 : Math.min(1, dt * 0.35));
  const phase = env.phase0 + (env.dynamic ? envT / DAY_CYCLE : 0);
  world.setPhase(phase, wet);
  scene.background = world.sky;
  scene.fog = scene.fog || new THREE.Fog(world.sky, 400, 2400);
  scene.fog.color.copy(world.sky); scene.fog.near = 380 * (1 - wet * 0.55); scene.fog.far = 2600 * (1 - wet * 0.5);
  renderer.toneMappingExposure = world.exposure; scene.environmentIntensity = world.envI + wet * 0.3;
  rain.visible = wet > 0.06; rain.material.uniforms.uAmt.value = clamp(wet * 0.75, 0.05, 1); rain.material.uniforms.uWind.value = 0.9 + wet * 1.4;
  for (const m of world.roadMats || []) { m.roughness = 0.88 - wet * 0.56; m.metalness = wet * 0.25; m.color.setScalar(1 - wet * 0.3); }
  if (track) track.gripMul = 1 - wet * 0.14;
  const nk = world.nightK ?? 0; for (const v of visCache.values()) v.setNight(nk);
  setRainAudio();
}
function updateEnvFx(dt) {
  // reflektory aut w nocy i błyski burzy
  const night = (world?.nightK ?? 0) > 0.25; // reflektory tylko o zmierzchu i w nocy
  const cars = [me, ...oppList()].filter((c) => c.st && c.vis && c.vis.group.visible);
  const L = track.length;
  headlights.forEach((l, i) => {
    const c = cars[i >> 1], st = c?.st; if (!st) { l.intensity = 0; return; }
    if (!night) { l.intensity = 0; return; }
    const side = (i & 1 ? 1 : -1) * 0.62; _hr.set(0, 0, 1).applyQuaternion(st.quat);
    const y = st.y + 0.55;
    l.position.set(st.x + st.fx * 2.3 + _hr.x * side, y + st.fy * 2.3 + _hr.y * side, st.z + st.fz * 2.3 + _hr.z * side);
    l.target.position.set(st.x + st.fx * 26 + _hr.x * side * 0.9, y + st.fy * 26 - 0.6 + _hr.y * side * 0.9, st.z + st.fz * 26 + _hr.z * side * 0.9); l.target.updateMatrixWorld();
    l.intensity = 1700;
  });
  if (wet > 0.9 && (S.mode === 'racing' || S.mode === 'countdown')) { nextFlash -= dt; if (nextFlash <= 0) { flash = 1; nextFlash = 6 + Math.random() * 9; thunderAt = performance.now() + 350 + Math.random() * 1400; } }
  if (thunderAt && performance.now() > thunderAt) { thunderAt = 0; sfx.thunder(); }
  if (flash > 0) { flash = Math.max(0, flash - dt * 2.8); const f = flash > 0.55 ? flash : flash > 0.35 ? 0.15 : flash; world.sun.intensity += f * 7; $('flash').style.opacity = String(f * 0.42); }
  else if ($('flash').style.opacity !== '0') $('flash').style.opacity = '0';
}
const _hr = new THREE.Vector3();
// dwa reflektory na auto (lewy, prawy), do 3 aut
const headlights = Array.from({ length: 6 }, () => { const l = new THREE.SpotLight(0xfff0d0, 0, 110, 0.4, 0.7, 1.1); scene.add(l, l.target); return l; });

// ======================= Deszcz =======================
const rain = (() => {
  const n = 5000, pos = new Float32Array(n * 6), end = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const x = Math.random(), y = Math.random(), z = Math.random(); pos.set([x, y, z, x, y, z], i * 6); end[i * 2] = 0; end[i * 2 + 1] = 1; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uAmt: { value: 0.55 }, uWind: { value: 0.9 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(120, 60, 120) } },
    vertexShader: `attribute float aEnd; uniform float uTime; uniform float uAmt; uniform float uWind; uniform vec3 uCenter; uniform vec3 uBox; varying float vA;
      void main() {
        vec3 p = position;
        float sp = 0.9 + fract(p.x * 91.7 + p.z * 37.3) * 0.5;
        p.y = fract(p.y - uTime * 0.55 * sp);
        vec3 w = uCenter + vec3((p.x - 0.5) * uBox.x, (p.y - 0.4) * uBox.y, (p.z - 0.5) * uBox.z);
        w += aEnd * vec3(-uWind, 3.2, -0.3 * uWind);
        vA = (0.18 + 0.32 * (1.0 - aEnd)) * step(fract(position.x * 173.1 + position.z * 91.7), uAmt);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: `varying float vA; void main() { gl_FragColor = vec4(0.78, 0.84, 0.95, vA); }`,
  });
  const l = new THREE.LineSegments(g, m); l.frustumCulled = false; l.visible = false; l.renderOrder = 6;
  scene.add(l); return l;
})();
const setRainAudio = () => setRain(wet > 0.06 && S.mode !== 'menu');

// ======================= Kamera =======================
const cam = { pos: new THREE.Vector3(0, 40, 40), look: new THREE.Vector3(), fov: 40, tilt: 0.3, first: true, focus: new THREE.Vector3(), half: 30,
  f: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 1, 0), racingT: undefined };
const CAM_DIR = (() => { const az = THREE.MathUtils.degToRad(16), el = THREE.MathUtils.degToRad(53); return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)); })();
function resize() {
  const W = window.innerWidth, H = window.innerHeight;
  if (!W || !H) return;
  renderer.setPixelRatio(pr); renderer.setSize(W, H, false); post.setSize(W, H, pr);
  camera.aspect = W / H; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ======================= Stan gry =======================
const S = {
  nick: store.get('tc_nick', ''),
  custom: (() => { const d = { num: 7, pattern: 'stripes', rim: 'star', rimColor: '#d9dde6', plate: true }; try { return { ...d, ...JSON.parse(store.get('tc_custom') || '{}') }; } catch { return d; } })(),
  weather: ['auto', 'sun', 'rain', 'storm'].includes(store.get('tc_weather')) ? store.get('tc_weather') : 'auto', time: ['auto', 'day', 'dusk', 'night'].includes(store.get('tc_time')) ? store.get('tc_time') : 'auto',
  dynEnv: store.get('tc_dyn') !== '0', raceBots: Math.min(3, Math.max(0, parseInt(store.get('tc_rbots') || '3', 10))),
  cam: store.get('tc_cam') === 'iso' ? 'iso' : 'chase', paused: false, pauseStart: 0,
  color: CAR_COLORS.includes(store.get('tc_color')) ? store.get('tc_color') : '#e0457b',
  trackPick: TRACK_DEFS[store.get('tc_track')] ? store.get('tc_track') : 'random', trackId: TRACK_DEFS[store.get('tc_track')] ? store.get('tc_track') : TRACK_IDS[Math.random() * TRACK_IDS.length | 0],
  ghost: store.get('tc_ghost') !== '0', pickups: ['off', 'rare', 'normal', 'often'].includes(store.get('tc_pickups')) ? store.get('tc_pickups') : 'normal', loadout: store.get('tc_loadout') === 'full' ? 'full' : 'normal',
  laps: Math.min(10, Math.max(1, parseInt(store.get('tc_laps') || '3', 10))),
  mode: 'menu', // menu | lobby | countdown | racing | finished
  solo: false, room: null, you: null, joinCode: null,
  raceStart: 0, results: null, resultSounded: false,
};
const me = { items: { ammo: 0, oil: 0, mine: 0, rocket: 0, repair: 0 }, fireT: 0, fireAcc: 0, st: null, vis: null, audio: null, finished: false, finishTime: 0, nitroT: 0, boost: 100, boosting: false, boostIdle: 0, cp: 0, cpIdx: 0, padCd: 0, driftT: 0, falls: 0, color: S.color, best: Infinity, hp: 100, dead: 0, inv: 0, lapIdx: 0, lapStart: 0, bestLap: Infinity };
const opps = new Map(); // id -> { id, nick, st, vis, audio, snaps, bot?, ... }
const visCache = new Map();
const input = { throttle: 0, brake: 0, steer: 0, hand: false };
const keys = new Set();
let socket = null;
let timers = [];
const oppList = () => [...opps.values()].filter((o) => o.st);
const myRoomPlayer = () => S.room?.players.find((x) => x.id === S.you);
const myNick = () => myRoomPlayer()?.nick ?? S.nick;
const mySlot = () => { const p = myRoomPlayer(); return p ? p.slot : 0; };
const racingNow = () => S.mode === 'racing' && !me.finished;

// ======================= Auto (bolid F1) =======================
function getVis(slot) {
  if (!visCache.has(slot)) visCache.set(slot, buildCar(CAR_ID, [7, 11, 23, 5][slot] ?? 7));
  return visCache.get(slot);
}
function applyCustom(who) {
  if (!who.vis) return;
  const cu = who === me ? (myRoomPlayer()?.custom ?? S.custom) : (who.custom ?? S.custom);
  who.vis.setCustom({ ...cu, nick: who === me ? myNick() : who.nick || '' });
}
const gridPos = (slot) => [[-6, -3.6], [-13, 3.6], [-20, -3.6], [-27, 3.6]][slot] || [-6, -3.6];
function setCar(who, slot, color) {
  if (who.vis) scene.remove(who.vis.group);
  who.vis = getVis(slot);
  applyCustom(who);
  who.color = color || S.color;
  who.vis.group.visible = true; who.vis.setDamage(0); who.vis.partsKey = ''; who.dirt = 0; who.sandK = who.cobK = 0; who.vis.setDirt(0); who.vis.setColor(who.color, stripeFor(who.color));
  who.vis.setNight(world?.nightK ?? 0);
  who.st = new CarState(CAR_DEFS[CAR_ID]);
  const [p, lat] = gridPos(slot); who.st.place(track, track.startS + p, lat);
  scene.add(who.vis.group);
  who.vis.setParts(who.st.parts); who.lostW = null;
  who.vis.sync(who.st, 0);
}
function clearOpps() { for (const [, o] of opps) { if (o.vis) scene.remove(o.vis.group); o.audio?.stop(); } opps.clear(); }
function syncOpps(force = false) {
  const hostMe = S.room?.players[0]?.id === S.you;
  const list = [...(S.room?.players || []).filter((p) => p.id !== S.you), ...(S.room?.bots || [])];
  for (const [id, o] of [...opps]) if (!list.some((p) => p.id === id)) { if (o.vis) scene.remove(o.vis.group); o.audio?.stop(); opps.delete(id); }
  for (const p of list) {
    let o = opps.get(p.id);
    if (!o) { o = { id: p.id, snaps: [], prevVf: 0, smokeAcc: 0, audio: null, vis: null, st: null, finished: false }; opps.set(p.id, o); }
    o.nick = p.nick; o.custom = p.custom;
    if (p.bot) { o.bot = hostMe; o.remoteBot = !hostMe; if (!o.ai) Object.assign(o, { skill: 0.9 + Math.random() * 0.06, lat: (Math.random() - 0.5) * 5, finishT: null, ai: { stuck: 0, rev: 0, revSteer: 1 }, padT: 0, cpS: 0 }); }
    if (force || !o.vis || o.slot !== p.slot) { o.slot = p.slot; setCar(o, p.slot, p.color); }
    else if (o.vis) applyCustom(o);
    if (o.vis && o.color !== p.color) { o.color = p.color; o.vis.setColor(p.color, stripeFor(p.color)); }
    if (force) { o.snaps = []; o.finishT = null; o.finished = false; o.cpS = 0; }
  }
}
function spawnSoloBots(n) {
  const colors = CAR_COLORS.filter((c) => c !== S.color);
  for (let i = 0; i < n; i++) {
    const o = { id: 'bot' + i, bot: true, nick: BOT_NAMES[i], slot: i + 1, snaps: [], prevVf: 0, smokeAcc: 0, audio: null, vis: null, st: null, finished: false, skill: 0.9 + Math.random() * 0.06, lat: (Math.random() - 0.5) * 5, finishT: null, ai: { stuck: 0, rev: 0, revSteer: 1 }, padT: 0, cpS: 0 };
    opps.set(o.id, o); setCar(o, o.slot, colors[(i * 3) % colors.length]);
  }
}
const lapsNow = () => (S.solo ? S.laps : (S.room?.settings?.laps ?? 3));
function setHpBar(v) { const e = $('hud-hp'); if (e) { e.style.width = `${clamp(v, 0, 100)}%`; e.parentElement.classList.toggle('low', v < 35); } }
function resetRace() {
  S.raceLaps = lapsNow();
  const slot = S.solo ? 0 : mySlot();
  const mp = S.solo ? null : myRoomPlayer();
  setCar(me, slot, mp?.color ?? S.color);
  if (!S.solo && S.room) syncOpps(true); else { clearOpps(); if (S.solo && S.raceBots > 0) spawnSoloBots(S.raceBots); }
  items.clear(); soloSpawn.t = 5; soloSlots = null;
  Object.assign(me, { items: S.loadout === 'full' ? { ammo: 1, oil: 1, mine: 1, rocket: 1, repair: 1 } : { ammo: 0, oil: 0, mine: 0, rocket: 0, repair: 0 }, fireT: 0, fireAcc: 0, finished: false, finishTime: 0, nitroT: 0, boost: 100, boosting: false, boostIdle: 0, cp: -12, cpIdx: 0, padCd: 0, driftT: 0, falls: 0, hp: 100, dead: 0, lapIdx: 0, lapStart: 0, bestLap: Infinity });
  S.results = null; S.resultSounded = false;
  particles.clear(); skids.clear();
  $('hud-time').textContent = '0:00.00';
  $('chip-pos').classList.toggle('hidden', !opps.size);
  setText('hud-cp', `1/${S.raceLaps}`); setHpBar(100); updateSlots(true);
  ghostSetup();
  recGhost.length = 0; replay.buf = []; replay.done = false;
}

// ======================= Ekrany =======================
const SCREENS = ['nick', 'menu', 'lobby', 'spec', 'results'];
function showScreen(name) {
  if (name === 'results' && !replay.on && !replay.done && !S.spectator && replay.buf.length >= 25) { replay.done = true; startReplay(true); return; }
  if (name === 'results' && replay.on) return;
  for (const s of SCREENS) $(`scr-${s}`).classList.toggle('hidden', s !== name);
  if (name !== 'results') hidePodium3D();
  clearInterval(resTimer); if (name === 'results') { resKey = ''; paintResults(); resTimer = setInterval(paintResults, 700); } else if (fwOn) { fwOn = false; stopFireworks(); }
  const inRace = name === null;
  $('hud').classList.toggle('hidden', !(inRace || name === 'results'));
  updateChatUi();
}
function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms);
}
function setMode(m) { if (replay.on && m === 'finished') { replay.prevMode = m; return; } S.mode = m; updateChatUi(); setRainAudio(); }

let rankData = { race: [] };
const fmtShort = (t) => (t == null ? '—' : fmt(t));
function renderRanking(data) {
  if (data) rankData = Array.isArray(data) ? { race: data } : data;
  const fill = (id, list) => {
    const ol = $(id); ol.textContent = '';
    if (!list || !list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Brak wyników — wygraj pierwszy wyścig!'; ol.append(li); return; }
    for (const r of list) {
      const li = document.createElement('li');
      if (S.nick && r.nick.toLowerCase() === S.nick.toLowerCase()) li.className = 'me';
      const n = document.createElement('span'); n.textContent = r.nick;
      const w = document.createElement('span'); w.className = 'w'; w.append(`${r.wins}`);
      const sm = document.createElement('small'); sm.textContent = ` / ${r.races}`; w.append(sm);
      li.append(n, w); li.addEventListener('click', () => openProfile(r.nick)); ol.append(li);
    }
  };
  fill('rank-menu', rankData.race); fill('rank-results', rankData.race);
}
async function loadRanking() { try { renderRanking(await (await fetch('api/ranking?mode=all')).json()); } catch { /* serwer niedostępny */ } }
async function openProfile(nick) {
  let p; try { p = await (await fetch(`api/profile?nick=${encodeURIComponent(nick)}`)).json(); } catch { return; }
  const card = $('profile-card'); card.textContent = '';
  const nm = document.createElement('div'); nm.className = 'prof-name'; nm.textContent = p.nick; card.append(nm);
  const st = p.race, g = document.createElement('div'); g.className = 'prof-grid';
  const box = (v, l) => { const d = document.createElement('div'); d.className = 'prof-box'; d.innerHTML = '<b></b><span></span>'; d.firstChild.textContent = v; d.lastChild.textContent = l; g.append(d); };
  if (!st) { const e = document.createElement('div'); e.className = 'muted'; e.textContent = 'Brak rozegranych wyścigów.'; card.append(e); }
  else { box(st.wins, 'Zwycięstwa'); box(st.second, 'Drugie miejsca'); box(st.races, 'Wyścigi'); box(`${st.races ? Math.round((st.wins / st.races) * 100) : 0}%`, 'Skuteczność'); box(fmtShort(st.best), 'Najlepszy czas'); box(st.last ? new Date(st.last).toLocaleDateString('pl-PL') : '—', 'Ostatnio'); card.append(g); }
  const b = document.createElement('button'); b.className = 'btn ghost'; b.style.marginTop = '14px'; b.textContent = 'Zamknij'; b.addEventListener('click', () => $('profile').classList.add('hidden')); card.append(b);
  $('profile').classList.remove('hidden');
}

// ======================= Menu: auto, ustawienia, tory =======================
const STAT_DEFS = [['Prędkość', '#ff5a5f'], ['Przyspieszenie', '#ffb02e'], ['Zwrotność', '#3fa9f5']];
function renderCarDetail(boxId = 'car-detail') {
  const box = $(boxId); if (!box) return;
  const d = CAR_DEFS[CAR_ID];
  box.textContent = '';
  const head = document.createElement('div'); head.className = 'cd-head'; const nm = document.createElement('b'); nm.textContent = d.name; const tg = document.createElement('small'); tg.textContent = d.tag; head.append(nm, tg); box.append(head);
  const spec = document.createElement('div'); spec.className = 'cd-spec';
  const sp = (l, v) => { const e = document.createElement('div'); e.innerHTML = '<span></span><b></b>'; e.firstChild.textContent = l; e.lastChild.textContent = v; spec.append(e); };
  sp('Prędkość maks.', `${Math.round(d.maxSpeed * 3.8)} km/h`); sp('Z nitro', `${Math.round(d.maxSpeed * 1.3 * 3.8)} km/h`); sp('Skręt', `${d.turn.toFixed(1)}`); sp('Hamowanie', `${d.brake}`);
  box.append(spec);
  const bars = document.createElement('div'); bars.className = 'cd-bars';
  STAT_DEFS.forEach(([label, color], i) => {
    const row = document.createElement('div'); row.className = 'cd-bar';
    const l = document.createElement('span'); l.textContent = label;
    const tr = document.createElement('div'); const fill = document.createElement('i'); fill.style.width = `${Math.round(d.stats[i] * 100)}%`; fill.style.background = color; tr.append(fill);
    const v = document.createElement('em'); v.textContent = String(Math.round(d.stats[i] * 10)); v.style.color = color;
    row.append(l, tr, v); bars.append(row);
  });
  box.append(bars);
}
const previewCache = {};
/** zarys toru z góry (SVG) */
function trackPreview(id) {
  if (previewCache[id]) return previewCache[id];
  const t = worlds[id]?.track ?? buildTrack(id), W = 120, H = 66, pad = 8, b = t.bounds;
  const sc = Math.min((W - 2 * pad) / (b.maxX - b.minX || 1), (H - 2 * pad) / (b.maxZ - b.minZ || 1));
  const ox = (W - (b.maxX - b.minX) * sc) / 2, oz = (H - (b.maxZ - b.minZ) * sc) / 2;
  let d = '';
  for (let i = 0; i < t.N; i += 6) { const x = ox + (t.px[i] - b.minX) * sc, y = oz + (t.pz[i] - b.minZ) * sc; d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }
  return (previewCache[id] = `<svg class="prev" viewBox="0 0 ${W} ${H}"><path d="${d}" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`);
}
function trackFacts(id) {
  const t = worlds[id]?.track ?? buildTrack(id);
  return `okrążenie ${(t.length / 1000).toFixed(1)} km · ${S.laps} okr. = ${(t.length * S.laps / 1000).toFixed(1)} km`;
}
function buildSettings(wrapId, vals, canEdit, onChange) {
  const w = $(wrapId); w.textContent = '';
  const row = (label) => { const r = document.createElement('div'); r.className = 'set'; const l = document.createElement('span'); l.textContent = label; r.append(l); w.append(r); return r; };
  const stepper = (label, key, min, max) => {
    const r1 = row(label), st = document.createElement('div'); st.className = 'step';
    const mk = (txt, delta) => { const b = document.createElement('button'); b.textContent = txt; b.disabled = !canEdit || (delta < 0 ? vals[key] <= min : vals[key] >= max); b.addEventListener('click', () => onChange({ [key]: vals[key] + delta })); return b; };
    const n = document.createElement('b'); n.textContent = vals[key]; st.append(mk('−', -1), n, mk('+', 1)); r1.append(st);
  };
  const segRow = (label, key, opts) => { const r = row(label), sg = document.createElement('div'); sg.className = 'seg'; for (const [v, t] of opts) { const b = document.createElement('button'); b.textContent = t; b.disabled = !canEdit; b.classList.toggle('sel', vals[key] === v); b.addEventListener('click', () => onChange({ [key]: v })); sg.append(b); } r.append(sg); };
  if (vals.laps !== undefined) stepper('Liczba okrążeń', 'laps', 1, 10);
  if (vals.raceBots !== undefined) stepper('Boty w wyścigu', 'raceBots', 0, 3);
  if (vals.public !== undefined) segRow('Pokój publiczny (lista pokoi)', 'public', [[true, 'Tak'], [false, 'Nie']]);
  if (vals.pickups !== undefined) segRow('Paczki (nitro, karabin, olej, miny)', 'pickups', [['off', 'Brak'], ['rare', 'Rzadko'], ['normal', 'Normalnie'], ['often', 'Często']]);
  if (vals.loadout !== undefined) segRow('Start z wyposażeniem', 'loadout', [['normal', 'Standardowy'], ['full', 'Pełny']]);
  if (vals.dyn !== undefined) segRow('Dynamiczne otoczenie (pora dnia i pogoda zmieniają się w trakcie)', 'dyn', [[false, 'Wył.'], [true, 'Wł.']]);
  if (vals.weather !== undefined) {
    segRow('Pogoda', 'weather', [['auto', 'Losowo'], ['sun', 'Słońce'], ['rain', 'Deszcz'], ['storm', 'Burza']]);
    segRow('Pora dnia na starcie', 'time', [['auto', 'Z toru'], ['day', 'Dzień'], ['dusk', 'Zmierzch'], ['night', 'Noc']]);
  }
  if (vals.ghost !== undefined) segRow('Duch rekordu (trening solo)', 'ghost', [[false, 'Wył.'], [true, 'Wł.']]);
}
function renderMenuSettings() {
  buildSettings('menu-settings', { laps: S.laps, raceBots: S.raceBots, pickups: S.pickups, loadout: S.loadout, dyn: S.dynEnv, weather: S.weather, time: S.time, ghost: S.ghost }, true, (c) => {
    if (c.laps != null) { S.laps = c.laps; store.set('tc_laps', String(c.laps)); }
    if (c.raceBots != null) { S.raceBots = c.raceBots; store.set('tc_rbots', String(c.raceBots)); }
    if (c.pickups) { S.pickups = c.pickups; store.set('tc_pickups', c.pickups); }
    if (c.loadout) { S.loadout = c.loadout; store.set('tc_loadout', c.loadout); }
    if (c.dyn !== undefined) { S.dynEnv = c.dyn; store.set('tc_dyn', c.dyn ? '1' : '0'); }
    if (c.weather) { S.weather = c.weather; store.set('tc_weather', c.weather); }
    if (c.time) { S.time = c.time; store.set('tc_time', c.time); }
    if (c.ghost != null) { S.ghost = c.ghost; store.set('tc_ghost', c.ghost ? '1' : '0'); }
    if ((c.weather || c.time) && S.mode === 'menu') envSetStatic(previewEnv(trackId));
    renderMenuSettings();
  });
}
const FLAGS = { Polska: 'PL', Kanada: 'CA', 'Alpy (Szwajcaria)': 'CH', Egipt: 'EG', Hawaje: 'HI' };
function buildTrackList(wrapId, selected, onPick, canPick, withRandom = false) {
  const wrap = $(wrapId); wrap.textContent = '';
  if (withRandom) {
    const rb = document.createElement('button'); rb.className = 'track rnd' + (selected === 'random' ? ' sel' : ''); rb.disabled = !canPick;
    rb.innerHTML = '<div class="pv">?</div><b>Losowy tor</b><small>Losowanie przy każdym starcie</small>'; rb.addEventListener('click', () => onPick('random')); wrap.append(rb);
  }
  for (const id of TRACK_IDS) {
    const d = TRACK_DEFS[id], b = document.createElement('button'); b.className = 'track' + (id === selected ? ' sel' : ''); b.disabled = !canPick;
    b.innerHTML = `<div class="pv">${trackPreview(id)}</div><b></b><small></small><small class="facts"></small>`;
    b.querySelector('b').textContent = d.name; b.querySelector('small').textContent = `${THEMES3D[d.theme].name} · ${d.tag}`; b.querySelector('.facts').textContent = trackFacts(id);
    b.addEventListener('click', () => onPick(id)); wrap.append(b);
  }
}
function rollRandoms() { if (S.trackPick === 'random') S.trackId = TRACK_IDS[Math.random() * TRACK_IDS.length | 0]; }
function pickMenuTrack(id) {
  S.trackPick = id; store.set('tc_track', id);
  if (id === 'random') rollRandoms(); else S.trackId = id;
  buildTrackList('track-list', id, pickMenuTrack, true, true);
  if (S.mode === 'menu') { toast('Ładowanie toru…', 800); setTimeout(() => { useTrack(S.trackId); setCar(me, 0, S.color); }, 30); }
}
function swatches(wrapId, selected, taken, onPick) {
  const w = $(wrapId); w.textContent = '';
  for (const c of CAR_COLORS) {
    const b = document.createElement('button'); b.className = 'swatch' + (c === selected ? ' sel' : '') + (taken.has(c) ? ' taken' : '');
    b.style.background = c; b.disabled = taken.has(c); b.title = taken.has(c) ? 'Kolor zajęty przez innego gracza' : ''; b.setAttribute('aria-label', c);
    b.addEventListener('click', () => onPick(c)); w.append(b);
  }
}
const RIM_COLORS = ['#d9dde6', ...CAR_COLORS];
function buildCustomUi(wrapId, cu, onChange) {
  const w = $(wrapId); w.textContent = '';
  const row = (label) => { const r = document.createElement('div'); r.className = 'set'; const l = document.createElement('span'); l.textContent = label; r.append(l); w.append(r); return r; };
  const r1 = row('Numer startowy'); const inp = document.createElement('input'); inp.type = 'number'; inp.min = 1; inp.max = 99; inp.value = cu.num; inp.className = 'numinp';
  inp.addEventListener('change', () => { const v = Math.max(1, Math.min(99, parseInt(inp.value, 10) || 1)); inp.value = v; onChange({ num: v }); }); r1.append(inp);
  const seg = (label, key, opts) => { const r = row(label), sg = document.createElement('div'); sg.className = 'seg'; for (const [v, t] of opts) { const b = document.createElement('button'); b.textContent = t; b.classList.toggle('sel', cu[key] === v); b.addEventListener('click', () => onChange({ [key]: v })); sg.append(b); } r.append(sg); };
  seg('Wzór lakieru', 'pattern', [['none', 'Brak'], ['stripes', 'Pasy'], ['flames', 'Płomienie'], ['checker', 'Szachownica']]);
  seg('Felgi', 'rim', [['star', 'Gwiazda'], ['mesh', 'Siatka'], ['solid', 'Pełne'], ['turbine', 'Turbina']]);
  const rc = document.createElement('div'); rc.className = 'swatches small'; rc.id = wrapId + '-rimc';
  for (const c of RIM_COLORS) { const b = document.createElement('button'); b.className = 'swatch' + (c === cu.rimColor ? ' sel' : ''); b.style.background = c; b.setAttribute('aria-label', c); b.addEventListener('click', () => onChange({ rimColor: c })); rc.append(b); }
  const r4 = row('Kolor felg'); r4.append(rc);
  seg('Tablica z nickiem', 'plate', [[false, 'Wył.'], [true, 'Wł.']]);
}
function buildMenuCustom() {
  buildCustomUi('menu-custom', S.custom, (c) => { S.custom = { ...S.custom, ...c }; store.set('tc_custom', JSON.stringify(S.custom)); if (S.mode === 'menu') applyCustom(me); buildMenuCustom(); });
}
function buildMenuColors() {
  swatches('menu-colors', S.color, new Set(), (c) => { S.color = c; store.set('tc_color', c); buildMenuColors(); if (S.mode === 'menu' && me.vis) { me.color = c; me.vis.setColor(c, stripeFor(c)); } });
}
function buildLobbyPickers(r, mine) {
  renderCarDetail('lobby-cardetail');
  const taken = new Set(r.players.filter((p) => p.id !== S.you).map((p) => p.color));
  swatches('lobby-colors', mine?.color, taken, (c) => { S.color = c; store.set('tc_color', c); socket?.emit('player:color', c); });
  if (mine && !($('lobby-custom').contains(document.activeElement))) buildCustomUi('lobby-custom', mine.custom || S.custom, (c) => { S.custom = { ...S.custom, ...c }; store.set('tc_custom', JSON.stringify(S.custom)); socket?.emit('player:custom', S.custom); });
}
let menuTab = 'car';
function showTab(name) {
  menuTab = name;
  document.querySelectorAll('#menu-tabs button').forEach((b) => b.classList.toggle('sel', b.dataset.tab === name));
  for (const n of ['car', 'track']) $('pane-' + n).classList.toggle('hidden', n !== name);
}
function goMenu() {
  clearTimers(); S.spectator = false; document.body.classList.remove('spectating'); closeReplay(true);
  if (socket && S.room) socket.emit('room:leave');
  S.room = null; S.solo = false; S.you = null;
  setMode('menu');
  $('menu-nick').textContent = S.nick;
  $('menu-err').textContent = '';
  useTrack(S.trackId);
  buildTrackList('track-list', S.trackPick, pickMenuTrack, true, true);
  renderMenuSettings(); renderCarDetail();
  clearOpps(); setCar(me, 0, S.color); ghostClear(); buildMenuColors(); buildMenuCustom();
  me.finished = false;
  particles.clear(); skids.clear();
  envSetStatic(previewEnv(trackId));
  showScreen('menu');
  clearChat();
  loadRanking();
  musicStart();
  if (S.autoJoin && S.joinCode) { S.autoJoin = false; joinRoom(false); }
}

// ======================= Lobby =======================
let lobbyEnvKey = '';
const WX_L = { auto: 'losowa', sun: 'słonecznie', rain: 'deszcz', storm: 'burza' }, TM_L = { auto: 'zależna od toru', day: 'dzień', dusk: 'zmierzch', night: 'noc' };
/** karta „Co jest grane”: tor, kraj i ustawienia pokoju (widoczne dla wszystkich) */
function renderLobbyInfo(r) {
  const box = $('lobby-info'); box.textContent = '';
  const st = r.settings, row = (k, v) => { const e = document.createElement('div'); e.className = 'l2-row'; e.innerHTML = '<span></span><b></b>'; e.firstChild.textContent = k; e.lastChild.textContent = v; box.append(e); };
  const head = document.createElement('div'); head.className = 'l2-desc'; head.textContent = 'Wyścig w stylu TrackMania — pętle, skoki, przechyły i nitro. Wygrywa najszybszy czas do mety.'; box.append(head);
  const d = TRACK_DEFS[r.track];
  row('Gospodarz', r.players[0]?.nick || '—');
  if (d) { row('Tor', d.name); row('Kraj', THEMES3D[d.theme].name); row('O torze', trackFacts(r.track)); row('Opis', d.tag); }
  if (st.bots) row('Boty', String(st.bots));
  row('Okrążenia', String(st.laps ?? 3)); row('Paczki', { off: 'brak', rare: 'rzadko', normal: 'normalnie', often: 'często' }[st.pickups] || st.pickups); row('Start', st.loadout === 'full' ? 'pełne wyposażenie' : 'standardowy');
  row('Dynamiczne otoczenie', st.dyn ? 'tak' : 'nie');
  row('Pogoda', WX_L[st.weather] || st.weather); row('Pora dnia', TM_L[st.time] || st.time);
}
function renderLobby() {
  const r = S.room; if (!r) return;
  $('lobby-code').textContent = r.id;
  $('lobby-title').textContent = 'Wyścig';
  $('lobby-link').value = `${location.origin}${location.pathname}?room=${r.id}`;
  const nb = r.bots?.length || 0, two = r.players.length + nb >= 2, full = r.players.length >= 4;
  $('copyrow').classList.toggle('hidden', full);
  $('lobby-hint').textContent = `${r.players.length}/4${nb ? ` + ${nb} bot.` : ''}`;
  const box = $('lobby-players'); box.textContent = '';
  for (let s = 0; s < 4; s++) {
    const p = r.players.find((x) => x.slot === s), bt = !p && r.bots?.find((x) => x.slot === s);
    const row = document.createElement('div'); row.className = 'player' + (p || bt ? '' : ' empty');
    if (bt) {
      row.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="st"></span>';
      row.querySelector('.dot').style.background = bt.color; const nm = row.querySelector('.nm'); nm.append(bt.nick); const sm = document.createElement('small'); sm.textContent = 'Bot'; nm.append(sm);
      const st = row.querySelector('.st'); st.textContent = 'Bot'; st.classList.add('ok');
    } else if (p) {
      row.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="st"></span>';
      row.querySelector('.dot').style.background = p.color;
      const nm = row.querySelector('.nm'); nm.append(p.nick + (p.id === S.you ? ' (Ty)' : ''));
      const sm = document.createElement('small'); sm.textContent = `Nr ${p.custom?.num ?? '—'}`; nm.append(sm);
      const st = row.querySelector('.st'); st.textContent = p.ready ? 'Gotowy' : 'Czeka'; st.classList.toggle('ok', p.ready);
    } else row.innerHTML = '<span class="dot"></span><span class="nm">Wolne miejsce…</span>';
    box.append(row);
  }
  const mine = r.players.find((x) => x.id === S.you);
  const isHost = mine?.slot === 0;
  buildTrackList('lobby-tracks', r.track, (id) => socket?.emit('room:track', id), isHost);
  { const st = r.settings; buildSettings('lobby-settings', { laps: st.laps, raceBots: st.bots, pickups: st.pickups, loadout: st.loadout, dyn: st.dyn, weather: st.weather, time: st.time, public: st.public }, isHost, (c) => { if (c.raceBots !== undefined) { c.bots = c.raceBots; delete c.raceBots; } socket?.emit('room:settings', c); }); }
  $('track-note').textContent = isHost ? '— możesz zmieniać w każdej chwili' : '— zmienia gospodarz';
  const wantTrack = r.track, trackChanged = wantTrack !== trackId;
  if (trackChanged) { useTrack(wantTrack); me.vis = null; }
  renderLobbyInfo(r);
  { const key = `${r.settings.weather}|${r.settings.time}|${r.track}`; if (S.mode === 'lobby' && lobbyEnvKey !== key) { lobbyEnvKey = key; envSetStatic(previewEnv(r.track)); } }
  const btn = $('btn-ready'), st = $('btn-start');
  st.classList.toggle('hidden', !isHost); btn.classList.toggle('hidden', isHost);
  st.disabled = !two; st.textContent = two ? 'Rozpocznij wyścig' : 'Czekam na rywala…';
  btn.classList.toggle('on', !!mine?.ready); btn.textContent = mine?.ready ? 'Gotowy ✓' : 'Gotowy';
  $('lobby-err').textContent = isHost ? '' : 'Gospodarz rozpocznie grę, gdy będziecie gotowi.';
  const slot = mySlot();
  if (!me.vis || me.slotShown !== slot) { setCar(me, slot, mine?.color); me.slotShown = slot; }
  else if (mine && me.color !== mine.color) { me.color = mine.color; me.vis.setColor(me.color, stripeFor(me.color)); }
  if (me.vis) applyCustom(me);
  buildLobbyPickers(r, mine);
  syncOpps(trackChanged);
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
    if (S.mode === 'lobby' && S.spectator) renderSpec();
    else if (S.mode === 'lobby') renderLobby();
    else if (S.mode !== 'menu') for (const [id, o] of [...opps]) if (!room.players.some((p) => p.id === id) && !room.bots?.some((p) => p.id === id)) { if (o.vis) scene.remove(o.vis.group); o.audio?.stop(); opps.delete(id); }
    if (room.players.length > had && had) sfx.join();
    if (S.mode === 'finished' && S.results) updateResultsButtons();
  });
  socket.on('room:closed', () => { toast('Pokój został zamknięty', 2500); goMenu(); });
  socket.on('room:left', ({ nick }) => { toast(`${nick} opuścił wyścig`, 3000); });
  socket.on('race:prepare', (room) => { S.room = room; S.solo = false; startPrepare(); if (S.spectator) { markSpectator(); updateSpecUi(); } });
  socket.on('race:count', (n) => countTick(String(n)));
  socket.on('race:go', () => goRace());
  const snap = (id, a) => { const o = opps.get(id); if (!o || !Array.isArray(a) || a.length < 22) return; o.snaps.push({ t: performance.now(), a }); if (o.snaps.length > 40) o.snaps.shift(); };
  socket.on('race:opp', snap);
  socket.on('race:bots', (list) => { for (const [id, a] of list) snap(id, a); });
  socket.on('race:end', (data) => { S.results = data; if (S.mode === 'racing' || S.mode === 'finished' || S.mode === 'countdown') { setMode('finished'); showResultsMP(); } });
  socket.on('ranking', (data) => renderRanking(data));
  socket.on('race:final', (f) => { if (!S.results) return; S.results.final = f.order; S.results.finalReady = true; if (S.mode === 'finished') showResultsMP(); });
  socket.on('pickup:spawn', (p) => { if (S.mode === 'racing' || S.mode === 'countdown') spawnCrate(p.id, p.type, p.u, p.l); });
  socket.on('pickup:remove', ({ id }) => items.remove(id, false));
  socket.on('pickup:taken', ({ id, by, type }) => { items.remove(id); if (by === S.you) applyPickup(type); });
  socket.on('game:event', (e) => onGameEvent(e));
  socket.on('chat', (m) => { chatAdd(m); if (m.sys) { if (S.mode === 'finished') toast(m.text, 2200); } else showBubble(m.from, m.text); });
  return socket;
}
const emitAck = (ev, data) => new Promise((res) => socket.timeout(5000).emit(ev, data, (err, r) => res(err ? { ok: false, error: 'Serwer nie odpowiada.' } : r)));
async function createRoom() {
  if (!connect()) return;
  rollRandoms();
  const r = await emitAck('room:create', { nick: S.nick, track: S.trackId, settings: { laps: S.laps, bots: S.raceBots, pickups: S.pickups, loadout: S.loadout, dyn: S.dynEnv, weather: S.weather, time: S.time, public: true }, color: S.color, custom: S.custom, mode: 'race' });
  if (!r.ok) { $('menu-err').textContent = r.error; return; }
  S.room = r.room; S.you = r.you; S.solo = false;
  enterLobby();
}
async function joinRoom(spectate = false) {
  if (!connect()) return;
  const r = await emitAck('room:join', { id: S.joinCode, nick: S.nick, color: S.color, custom: S.custom, spectate: !!spectate });
  if (!r.ok) { $('menu-err').textContent = r.error; closeRooms(); return; }
  history.replaceState(null, '', location.pathname);
  S.joinCode = null; $('join-banner').classList.add('hidden'); $('btn-join').classList.add('hidden'); $('btn-create').classList.remove('hidden');
  S.room = r.room; S.you = r.you; S.solo = false; S.spectator = !!r.spectator;
  if (r.spectator) enterSpectator(); else enterLobby();
}
// ---- pokoje publiczne i szybka gra ----
let roomsTimer = null;
const STATE_LABEL = { lobby: 'lobby', countdown: 'start', racing: 'trwa', finished: 'po wyścigu' };
async function refreshRooms() {
  if (!socket) return;
  const list = await new Promise((res) => socket.timeout(4000).emit('rooms:list', (err, l) => res(err ? [] : l)));
  const box = $('rooms-list'); box.textContent = '';
  if (!list.length) { const e = document.createElement('div'); e.className = 'muted'; e.textContent = 'Brak publicznych pokoi. Stwórz własny — pojawi się tutaj.'; box.append(e); return; }
  for (const r of list) {
    const row = document.createElement('div'); row.className = 'room-row';
    const info = document.createElement('div'); info.className = 'info';
    const bt = document.createElement('b'); bt.textContent = `${r.host} — ${TRACK_DEFS[r.track]?.name ?? r.track}`;
    const sm = document.createElement('small'); sm.textContent = `${r.players}/4${r.bots ? ` + ${r.bots} bot.` : ''} · ${STATE_LABEL[r.state] ?? r.state}${r.spectators ? ` · widzów: ${r.spectators}` : ''}`;
    info.append(bt, sm); row.append(info);
    if (r.joinable) { const j = document.createElement('button'); j.className = 'btn primary'; j.textContent = 'Dołącz'; j.addEventListener('click', () => { S.joinCode = r.id; closeRooms(); joinRoom(false); }); row.append(j); }
    const w = document.createElement('button'); w.className = 'btn ghost'; w.textContent = 'Obserwuj'; w.addEventListener('click', () => { S.joinCode = r.id; closeRooms(); joinRoom(true); }); row.append(w);
    box.append(row);
  }
}
function openRooms() { if (!connect()) return; $('rooms-modal').classList.remove('hidden'); refreshRooms(); clearInterval(roomsTimer); roomsTimer = setInterval(refreshRooms, 3000); }
function closeRooms() { $('rooms-modal').classList.add('hidden'); clearInterval(roomsTimer); }
async function quickPlay() {
  if (!connect()) return;
  const list = await new Promise((res) => socket.timeout(4000).emit('rooms:list', (err, l) => res(err ? [] : l)));
  const room = list.find((r) => r.joinable && r.state === 'lobby');
  if (room) { S.joinCode = room.id; joinRoom(false); } else { toast('Brak wolnych pokoi — tworzę nowy', 1600); createRoom(); }
}
// ---- widz ----
function renderSpec() {
  const r = S.room; if (!r) return;
  $('spec-code').textContent = r.id;
  const box = $('spec-players'); box.textContent = '';
  for (const p of [...r.players, ...(r.bots || [])]) {
    const row = document.createElement('div'); row.className = 'player';
    row.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="st"></span>';
    row.querySelector('.dot').style.background = p.color; row.querySelector('.nm').append(p.nick);
    const st = row.querySelector('.st'); st.textContent = p.bot ? 'Bot' : p.ready ? 'Gotowy' : 'Czeka'; st.classList.toggle('ok', p.bot || p.ready); box.append(row);
  }
  if (r.track !== trackId) useTrack(r.track);
  $('btn-spec-join').classList.toggle('hidden', !(r.state === 'lobby' || r.state === 'finished') || r.players.length >= 4);
  syncOpps(false);
}
function markSpectator() { me.finished = true; if (me.vis) me.vis.group.visible = false; document.body.classList.add('spectating'); }
function enterSpectator() {
  document.body.classList.add('spectating');
  const r = S.room;
  if (r.state === 'racing' || r.state === 'countdown') { startPrepare(); markSpectator(); setMode('racing'); S.raceStart = performance.now(); }
  else { setMode('lobby'); clearOpps(); renderSpec(); showScreen('spec'); }
  updateSpecUi();
}
function updateSpecUi() { $('spec-banner').classList.toggle('hidden', !(S.spectator && S.mode !== 'menu' && S.mode !== 'lobby')); }
function enterLobby() {
  setMode('lobby'); lobbyEnvKey = '';
  me.vis = null; clearOpps();
  renderLobby();
  showScreen('lobby');
  $('lobby-err').textContent = '';
  sfx.join();
}

// ======================= Przebieg wyścigu =======================
function clearTimers() { timers.forEach(clearTimeout); timers = []; }
const soloCount = { t: 0, step: 0 };
function startPrepare() {
  clearTimers();
  musicStart(); closeReplay(true);
  const id = S.solo ? S.trackId : S.room.track;
  useTrack(id);
  env = S.solo ? resolveEnvLocal(id) : { ...(S.room.env || {}), dynamic: !!S.room.env?.dynamic };
  envT = 0; wet = env.rainAt <= 0 ? env.rainK : (env.weather === 'rain' ? 0.8 : env.weather === 'storm' ? 1 : 0); envApply(0, true);
  resetRace();
  setMode('countdown');
  showScreen(null);
  $('hud-help').classList.remove('fade');
  timers.push(setTimeout(() => $('hud-help').classList.add('fade'), 9000));
  $('countdown').textContent = ''; { const sl = $('startlights'); sl.classList.add('hidden'); sl.querySelectorAll('.lamp').forEach((l) => { l.className = 'lamp'; }); }
  cam.first = true; cam.racingT = undefined;
}
function startSolo() {
  S.solo = true; S.room = null; rollRandoms();
  startPrepare();
  soloCount.t = 0; soloCount.step = 0; soloCount.go = 4.6 + Math.random() * 0.9; // odliczanie liczone w pętli klatek (zatrzymuje się z pauzą)
}
/** światła startowe jak w F1: n lamp się zapala (1–3 czerwone, 4–5 pomarańczowe), pikanie; goRace zmienia wszystkie na zielone */
function countTick(n) {
  n = +n; const sl = $('startlights'); sl.classList.remove('hidden', 'fade');
  sl.querySelectorAll('.lamp').forEach((l, i) => { l.className = 'lamp' + (i < n ? (i < 3 ? ' red' : ' amber') : ''); });
  sfx.beep(false, n);
}
function goRace() {
  const sl = $('startlights'); sl.classList.remove('hidden', 'fade'); sl.querySelectorAll('.lamp').forEach((l) => { l.className = 'lamp green'; }); sfx.beep(true);
  timers.push(setTimeout(() => sl.classList.add('fade'), 1300), setTimeout(() => sl.classList.add('hidden'), 2000));
  setMode('racing'); S.raceStart = performance.now();
}
const elapsed = () => (performance.now() - S.raceStart) / 1000;
function finishLocal() {
  me.finished = true; me.finishTime = elapsed();
  toast('Meta!', 1800); sfx.lap();
  if (S.solo) { saveGhost(); setMode('finished'); showResultsSolo(); }
  else { socket?.emit('race:finish', { time: me.finishTime }); if (S.results) { S.results.times[S.you] = me.finishTime; showResultsMP(); } }
}
/** klasyfikacja końcowa w trybie solo z botami */
function soloOrder() {
  const rows = [{ id: 'me', nick: S.nick, t: me.finishTime || null, prog: me.st?.s ?? 0, me: true }, ...oppList().filter((o) => o.bot).map((o) => ({ id: o.id, nick: o.nick, t: o.finishT, prog: o.st.s, bot: true }))];
  return rows.sort((a, b) => (a.t != null && b.t != null ? a.t - b.t : a.t != null ? -1 : b.t != null ? 1 : b.prog - a.prog));
}
// ---- ekran wyników: podium, zwycięzca, fajerwerki; tabela czasów gdy startowało więcej niż 3 aut ----
let resRowsFn = null, resTimer = 0, resKey = '', resWinner = '';
function paintResults() {
  if (!resRowsFn) return;
  const rows = resRowsFn(), key = rows.map((r) => `${r.id}:${r.time ?? '-'}`).join('|');
  if (key === resKey) return; resKey = key;
  const w = rows[0]; showPodium3D(rows);
  $('res-winner').textContent = w ? `${w.nick} · ${w.time != null ? fmt(w.time) : 'w trasie…'}` : '';
  const t = $('res-table'); t.textContent = '';
  t.classList.toggle('hidden', rows.length <= 3);
  if (rows.length > 3) {
    const head = document.createElement('tr'); head.innerHTML = '<th>Kierowca</th><th>Czas</th>'; t.append(head);
    rows.forEach((o, i) => {
      const tr = document.createElement('tr'); if (i === 0) tr.className = 'win'; if (o.me) tr.classList.add('me');
      const a = document.createElement('td'); a.textContent = `${i + 1}. ${o.nick}${o.me ? ' (Ty)' : o.bot ? ' (bot)' : ''}`;
      const b = document.createElement('td'); b.textContent = o.time != null ? fmt(o.time) : 'w trasie…';
      tr.append(a, b); t.append(tr);
    });
  }
  if (!fwOn) { fwOn = true; startFireworks($('fw-canvas'), w?.color || '#ffd24a', () => sfx.firework()); }
}
let fwOn = false;

// ======================= Podium 3D: prawdziwe modele bolidów na stopniach tuż za linią mety =======================
const podium = { on: false, group: null, cars: [], labels: [], key: '' };
const POD_X = [0, -5.1, 5.1], POD_H = [1.8, 1.25, 0.8], POD_COL = [0xffd24a, 0xcfd6e2, 0xd98b52], POD_S = 55; // miejsca 1., 2., 3.
const onPodium = (c) => podium.on && podium.cars.some((p) => p.c === c);
const carForRow = (r) => (r.me ? (S.spectator ? null : me) : oppList().find((o) => o.id === r.id) || null);
function plaqueTex(n) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = 'rgba(20,16,32,0.9)'; x.font = '900 100px system-ui, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function showPodium3D(rows) {
  const top = rows.slice(0, 3), key = top.map((r) => r.id).join('|');
  if (podium.on && key === podium.key) { podium.labels.forEach((l, i) => { l.querySelector('span').textContent = top[i].time != null ? fmt(top[i].time) : 'w trasie…'; }); return; }
  hidePodium3D();
  podium.on = true; podium.key = key; cam.first = true;
  const f = track.at(POD_S, {}), g = new THREE.Group(); g.matrixAutoUpdate = false;
  g.matrix.makeBasis(new THREE.Vector3(f.rx, f.ry, f.rz), new THREE.Vector3(f.ux, f.uy, f.uz), new THREE.Vector3(-f.tx, -f.ty, -f.tz)).setPosition(f.px, f.py, f.pz); g.matrixWorldNeedsUpdate = true;
  top.forEach((r, i) => {
    const h = POD_H[i], mat = new THREE.MeshStandardMaterial({ color: POD_COL[i], metalness: 0.55, roughness: 0.32 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(4.5, h, 5.8), mat); b.position.set(POD_X[i], h / 2, 0); b.castShadow = b.receiveShadow = true; g.add(b);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), new THREE.MeshBasicMaterial({ map: plaqueTex(i + 1), transparent: true })); pl.position.set(POD_X[i], Math.max(0.5, h * 0.5), 2.91); g.add(pl);
    const car = carForRow(r);
    if (car?.vis) {
      car.vis.setParts(new Float32Array(8)); car.vis.setDamage(0); g.add(car.vis.group); car.vis.group.position.set(POD_X[i], h, 0); car.vis.group.rotation.set(0, -Math.PI / 2 + [0, 0.3, -0.3][i], 0); car.vis.group.visible = true;
      podium.cars.push({ c: car, i });
    }
    const lab = document.createElement('div'); lab.className = `pl p${i + 1}` + (r.me ? ' me' : '');
    lab.innerHTML = '<b></b><span></span>'; lab.querySelector('b').textContent = r.nick + (r.bot ? ' (bot)' : ''); lab.querySelector('span').textContent = r.time != null ? fmt(r.time) : 'w trasie…';
    $('pod-labels').append(lab); podium.labels.push(lab);
  });
  scene.add(g); podium.group = g;
}
function hidePodium3D() {
  if (!podium.on) return;
  for (const { c } of podium.cars) { scene.add(c.vis.group); if (c.st) c.vis.setParts(c.st.parts); }
  if (podium.group) scene.remove(podium.group);
  $('pod-labels').textContent = ''; podium.on = false; podium.group = null; podium.cars = []; podium.labels = []; podium.key = ''; cam.first = true;
}
const _pv = new THREE.Vector3();
function podiumCam() {
  const m = podium.group.matrix, sw = Math.sin(T * 0.25) * 2.2, u = _pv.set(0, 1, 0).transformDirection(m).clone();
  return { pos: new THREE.Vector3(sw, 4.6, 27).applyMatrix4(m), look: new THREE.Vector3(0, -1.6, 0).applyMatrix4(m), fov: 38, up: u };
}
function updatePodiumLabels() {
  if (!podium.on) return;
  podium.labels.forEach((l, i) => {
    _pv.set(POD_X[i], POD_H[i] + 2.9, 0).applyMatrix4(podium.group.matrix).project(camera);
    const vis = _pv.z < 1; l.style.display = vis ? '' : 'none'; l.style.left = `${(_pv.x * 0.5 + 0.5) * innerWidth}px`; l.style.top = `${(-_pv.y * 0.5 + 0.5) * innerHeight}px`;
  });
}
function showResultsSolo() {
  $('res-title').className = 'res-title'; $('res-title').textContent = 'Meta!';
  const order = oppList().some((o) => o.bot) ? soloOrder() : null;
  const place = order ? order.findIndex((o) => o.me) + 1 : 1;
  const beat = me.finishTime < me.best;
  $('res-sub').textContent = (order ? `Miejsce ${place}/${order.length} · ` : '') + `czas ${fmt(me.finishTime)}${beat && me.best < Infinity ? ' · nowy rekord!' : ''}${ghostBestTime() ? ` · rekord ${fmt(ghostBestTime())}` : ''}`;
  resRowsFn = () => (order ? soloOrder() : [{ id: 'me', nick: S.nick, t: me.finishTime, me: true }]).map((o) => ({ id: o.id, nick: o.nick, time: o.t ?? null, me: !!o.me, bot: !!o.bot, color: o.me ? me.color : oppList().find((q) => q.id === o.id)?.color }));
  resWinner = S.nick;
  $('btn-rematch').textContent = 'Jeszcze raz'; $('btn-rematch').disabled = false; $('btn-rematch').classList.remove('on');
  $('rank-results').parentElement.querySelectorAll('h4, #rank-results').forEach((e) => e.classList.add('hidden'));
  $('rematch-box').classList.add('hidden');
  sfx.win(); showScreen('results');
}
function showResultsMP() {
  const d = S.results; if (!d) return;
  $('rank-results').parentElement.querySelectorAll('h4, #rank-results').forEach((e) => e.classList.remove('hidden'));
  const won = d.winner === S.you && !S.spectator;
  $('res-title').className = 'res-title' + (won ? '' : ' lose');
  $('res-title').textContent = S.spectator ? 'Koniec wyścigu' : won ? 'Wygrana!' : 'Meta!';
  $('btn-rematch').classList.toggle('hidden', !!S.spectator);
  const w = d.players.find((p) => p.id === d.winner);
  $('res-sub').textContent = d.reason === 'left' ? 'Pozostali gracze opuścili wyścig.' : `${w ? w.nick : 'Gracz'} wygrywa wyścig.`;
  resRowsFn = () => {
    const rows = d.final?.length ? d.final : [...d.players].sort((a, b) => (a.id === d.winner ? -1 : b.id === d.winner ? 1 : (d.times[a.id] ?? 1e9) - (d.times[b.id] ?? 1e9))).map((p) => ({ id: p.id, nick: p.nick, time: d.times[p.id] ?? null }));
    return rows.map((o) => ({ id: o.id, nick: o.nick, bot: !!o.bot, me: o.id === S.you, time: o.id === S.you && me.finished ? me.finishTime : o.time, color: S.room?.players.find((p) => p.id === o.id)?.color ?? oppList().find((q) => q.id === o.id)?.color ?? o.color }));
  };
  if (d.ranking) renderRanking(d.ranking);
  if (!S.resultSounded) { S.resultSounded = true; (won ? sfx.win : sfx.lose)(); $('btn-rematch').classList.remove('on'); }
  updateResultsButtons(); showScreen('results');
}
function updateResultsButtons() {
  const b = $('btn-rematch');
  const two = S.room && S.room.players.length + (S.room.bots?.length || 0) >= 2;
  const mine = S.room?.players.find((p) => p.id === S.you);
  b.disabled = !two || !!mine?.ready;
  if (!two) b.textContent = 'Brak rywali';
  else if (mine?.ready) { const waiting = S.room.players.filter((p) => !p.ready).map((p) => p.nick); b.textContent = waiting.length ? `Czekam na: ${waiting.join(', ')}` : 'Start za chwilę…'; }
  else b.textContent = 'Rewanż';
  renderRematch();
}
function renderRematch() {
  const box = $('rematch-box'), list = $('rematch-list');
  if (!S.room || S.solo || S.mode !== 'finished') { box.classList.add('hidden'); return; }
  box.classList.remove('hidden'); list.textContent = '';
  for (const p of S.room.players) {
    const row = document.createElement('div'); row.className = 'rm-row' + (p.id === S.you ? ' me' : '');
    row.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="st"></span>';
    row.querySelector('.dot').style.background = p.color; row.querySelector('.nm').textContent = p.nick + (p.id === S.you ? ' (Ty)' : '');
    const st = row.querySelector('.st'); st.textContent = p.ready ? 'Chce rewanż ✓' : 'Czeka…'; st.classList.toggle('ok', p.ready); list.append(row);
  }
}

// ======================= Zdalni gracze (interpolacja pakietów) =======================
function sampleOpp(opp, now) {
  const sn = opp.snaps, st = opp.st;
  if (!sn.length || !st) return false;
  const rt = now - 110;
  let a, b, f = 0;
  if (rt <= sn[0].t) a = b = sn[0].a;
  else if (rt >= sn[sn.length - 1].t) a = b = sn[sn.length - 1].a;
  else for (let i = sn.length - 2; i >= 0; i--) if (sn[i].t <= rt) { a = sn[i].a; b = sn[i + 1].a; f = (rt - sn[i].t) / Math.max(1, sn[i + 1].t - sn[i].t); break; }
  const L = (i) => a[i] + (b[i] - a[i]) * f;
  st.vf = L(6); st.vl = L(7); st.steer = L(5); st.throttle = a[9]; st.brakeLit = !!a[10]; st.nitro = !!a[13]; st.hand = !!a[14]; st.slip = Math.abs(st.vl);
  opp.finished = !!a[12];
  if (a.length > 24) st.unpackParts(a[23] | 0, a[24] | 0);
  st.hp = a[15]; st.damage = 1 - a[15] / 100; if (a[16] && !st.dead) explodeAt(st); st.dead = a[16];
  if (a[21] || b[21]) st.remoteAir(track, L(0), L(17), L(1), L(3), L(22), L(4), L(8), 0.016);
  else {
    st.air = false; st.s = L(8); st.d = L(19); st.phi = a[20] + wrapA(b[20] - a[20]) * f; st.progress = st.s; st.idx = st.s; st._pose(track);
  }
  return true;
}
const packState = (s, c) => {
  const r = (v) => Math.round(v * 100) / 100;
  return [r(s.x), r(s.z), r(s.yaw), r(s.vx), r(s.vz), r(s.steer), r(s.vf), r(s.vl), r(s.s), s.throttle || 0, s.brakeLit ? 1 : 0, 0, c.finished ? 1 : 0, s.nitro ? 1 : 0, s.hand ? 1 : 0, Math.round(s.hp ?? 100), s.dead ? 1 : 0, r(s.y), 0, r(s.d), Math.round(s.phi * 1000) / 1000, s.air ? 1 : 0, r(s.vy), ...s.packParts()];
};
function refreshOpp(o) { return o.bot ? true : sampleOpp(o, performance.now()); }

// ======================= Efekty: dym, iskry, nitro =======================
const _w = new THREE.Vector3();
const wheelAt = (st, M, side) => { _w.set(-M.wheelX, 0.12, side * M.wheelZ).applyQuaternion(st.quat); return [st.x + _w.x, st.y + _w.y, st.z + _w.z]; };
// ======================= Odpadające koła =======================
const debrisGeo = new THREE.CylinderGeometry(0.56, 0.56, 0.7, 18).rotateX(Math.PI / 2), debrisMat = new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.85 });
const debris = [], _dq = new THREE.Quaternion(), _dv = new THREE.Vector3();
function spawnWheelDebris(c, i) {
  const st = c.st, M = c.vis.model; if (!st || S.mode === 'menu') return;
  const sx = i < 2 ? M.wheelX : -M.wheelX, sz = i % 2 === 0 ? M.wheelZ : -M.wheelZ;
  _dv.set(sx, M.wheelR, sz).applyQuaternion(st.quat);
  const m = new THREE.Mesh(debrisGeo, debrisMat); m.castShadow = true; m.position.set(st.x + _dv.x, st.y + _dv.y, st.z + _dv.z); m.quaternion.copy(st.quat); scene.add(m);
  const side = Math.sign(sz), kick = 4 + Math.random() * 5;
  _dv.set(0, 0, side).applyQuaternion(st.quat);
  debris.push({ s: st.s, m, v: new THREE.Vector3(st.vx + _dv.x * kick, st.vy + 4 + Math.random() * 5, st.vz + _dv.z * kick), life: 7, axle: new THREE.Vector3(0, 0, 1) });
  sparks(m.position.x, m.position.y, m.position.z, 16); sfx.tire(0.7);
}
function updateDebris(dt) {
  for (let k = debris.length - 1; k >= 0; k--) {
    const d = debris[k], p = d.m.position; d.life -= dt; d.v.y -= 24 * dt; p.addScaledVector(d.v, dt);
    const nr = track.nearest(p.x, p.y, p.z, d.s, 60, 80); d.s = nr.s; const f = track.at(nr.s, {}), sy = f.py + f.ry * clamp(nr.d, -f.hw, f.hw);
    if (p.y < sy + 0.56 && Math.abs(nr.d) < f.hw + 1) { if (d.v.y < -2) sfx.bounce(Math.min(1, -d.v.y / 14)); p.y = sy + 0.56; d.v.y = Math.abs(d.v.y) > 2 ? -d.v.y * 0.42 : 0; d.v.x *= 0.985; d.v.z *= 0.985; }
    _dq.setFromAxisAngle(_dv.set(-d.v.z, 0, d.v.x).normalize(), Math.hypot(d.v.x, d.v.z) * dt / 0.56); d.m.quaternion.premultiply(_dq);
    if (d.life <= 0 || p.y < sy - 60) { scene.remove(d.m); debris.splice(k, 1); }
  }
}
const clearDebris = () => { for (const d of debris) scene.remove(d.m); debris.length = 0; };
/** strefy uszkodzeń → wygląd auta; odpadnięcie koła uruchamia efekt lecącego koła */
function syncParts(c) {
  const st = c.st, v = c.vis; if (!st || !v) return;
  v.setParts(st.parts);
  const now = [st.parts[0] >= 1, st.parts[1] >= 1, st.parts[2] >= 1, st.parts[3] >= 1];
  if (c.lostW) for (let i = 0; i < 4; i++) if (now[i] && !c.lostW[i]) spawnWheelDebris(c, i);
  c.lostW = now;
}
const _sf = {};
/** nawierzchnia pod autem (piasek/kostka, płynnie), brud na oponach i drżenie na kostce */
function updateSurf(c, dt) {
  const st = c.st, v = c.vis; if (!st || !v || !track) return;
  track.surfAt(st.s, st.d, _sf);
  const sand = st.air ? 0 : _sf.sand, cob = st.air ? 0 : _sf.cob, k = Math.min(1, dt * 10);
  c.sandK = (c.sandK || 0) + (sand - (c.sandK || 0)) * k; c.cobK = (c.cobK || 0) + (cob - (c.cobK || 0)) * k;
  const moving = Math.min(1, Math.abs(st.vf) / 8);
  c.dirt = clamp((c.dirt || 0) + dt * (c.sandK * 1.2 * moving + c.cobK * 0.3 * moving - 0.1 * (1 - Math.max(c.sandK, c.cobK))), 0, 1);
  v.dirtCol.setHex(c.sandK >= c.cobK ? 0xb59557 : 0x7d786f); v.setDirt(c.dirt); v.rough = c.cobK;
}
function carFx(c, key, dt) {
  const st = c.st; if (!st || !c.vis) return;
  const sp = Math.abs(st.vf), M = c.vis.model;
  const sliding = !st.air && (st.slip > 5.5 || st.hand) && sp > 7;
  const braking = !st.air && st.brakeLit && sp > 24;
  const [lx, ly, lz] = wheelAt(st, M, -1), [rx, ry, rz] = wheelAt(st, M, 1);
  const on = (sliding || braking) && S.mode !== 'menu' && S.mode !== 'lobby' && (c.sandK || 0) < 0.35 && (c.cobK || 0) < 0.5;
  skids.add(key + 'L', lx, ly, lz, on, st.hand ? 0.42 : 0.34); skids.add(key + 'R', rx, ry, rz, on, st.hand ? 0.42 : 0.34);
  if (S.mode === 'menu' || S.mode === 'lobby') return;
  if (!st.air && sp > 5) { // piasek: chmura kurzu spod kół; kostka: drobne odpryski
    const sk = c.sandK || 0, ck = c.cobK || 0;
    if (sk > 0.2) { c.dustAcc = (c.dustAcc || 0) + dt * (18 + sp * 1.1) * sk; while (c.dustAcc >= 1) { c.dustAcc -= 1; for (const [wx, wy, wz] of [[lx, ly, lz], [rx, ry, rz]]) { tmpC.setRGB(0.8 + Math.random() * 0.06, 0.66 + Math.random() * 0.06, 0.4); particles.emit(wx, wy, wz, -st.vx * 0.12 + (Math.random() - 0.5) * 3, 1.2 + Math.random() * 2.5, -st.vz * 0.12 + (Math.random() - 0.5) * 3, 0.9 + Math.random() * 0.8, 1.3, 4.5 + sp * 0.04, tmpC, 0.45 * sk, 1.6); } } }
    else if (ck > 0.3 && sp > 18) { c.chipAcc = (c.chipAcc || 0) + dt * 10 * ck; while (c.chipAcc >= 1) { c.chipAcc -= 1; tmpC.setRGB(0.55, 0.53, 0.5); particles.emit(lx, ly, lz, (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.45, 0.5, 1.5, tmpC, 0.22, 2); } }
  }
  if (st.nitro) {
    _w.set(-M.L / 2 - 0.2, 0.55, 0).applyQuaternion(st.quat); const ex = st.x + _w.x, ey = st.y + _w.y, ez = st.z + _w.z;
    for (let i = 0; i < 3; i++) { tmpC.setRGB(0.3 + Math.random() * 0.4, 0.6 + Math.random() * 0.3, 1); particles.emit(ex, ey, ez, -st.fx * (10 + Math.random() * 8) + (Math.random() - 0.5) * 2, -st.fy * 10 + Math.random() * 1.5, -st.fz * (10 + Math.random() * 8) + (Math.random() - 0.5) * 2, 0.3, 1.1, 0.2, tmpC, 0.8, 1.5); }
    tmpC.setRGB(1, 0.55, 0.15); particles.emit(ex, ey, ez, -st.fx * 6, -st.fy * 6, -st.fz * 6, 0.18, 0.9, 0.1, tmpC, 0.9, 2);
  }
  const hp = st.hp ?? 100;
  if (hp < 60 && !st.dead && S.mode !== 'finished') { // dymi i pali się uszkodzone auto
    const k = clamp((60 - hp) / 60, 0, 1);
    c.dmgAcc = (c.dmgAcc || 0) + dt * (14 + 46 * k);
    while (c.dmgAcc >= 1) {
      c.dmgAcc -= 1; const fx = st.x + st.fx * 1.5, fy = st.y + 0.7, fz = st.z + st.fz * 1.5;
      tmpC.setRGB(0.1 + Math.random() * 0.1, 0.1 + Math.random() * 0.1, 0.12); particles.emit(fx, fy, fz, st.vx * 0.3 + (Math.random() - 0.5) * 1.5, 1.6 + Math.random() * 2, st.vz * 0.3 + (Math.random() - 0.5) * 1.5, 1.1, 0.9, 3, tmpC, 0.5, 1.2);
      if (hp < 30 && Math.random() < 0.7) { tmpC.setRGB(1, 0.4 + Math.random() * 0.4, 0.05); particles.emit(fx, fy + 0.2, fz, (Math.random() - 0.5) * 1.5, 2 + Math.random() * 2, (Math.random() - 0.5) * 1.5, 0.35, 1.0, 0.3, tmpC, 0.85, 1.6); }
    }
  }
  if (sliding) {
    c.smokeAcc = (c.smokeAcc || 0) + dt * 50 * clamp((st.slip - 4.5) / 8, st.hand ? 0.7 : 0.25, 1);
    while (c.smokeAcc >= 1) { c.smokeAcc -= 1; const side = Math.random() > 0.5; tmpC.setRGB(0.88, 0.88, 0.92); particles.emit(side ? lx : rx, side ? ly : ry, side ? lz : rz, st.vx * 0.12 + (Math.random() - 0.5) * 1.5, 0.8 + Math.random() * 0.8, st.vz * 0.12 + (Math.random() - 0.5) * 1.5, 0.9, 1.1, 3.4, tmpC, 0.4, 1.3); }
  }
}
function sparks(x, y, z, power) {
  const n = Math.round(6 + power * 0.8);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * (6 + power * 0.4);
    tmpC.setRGB(1, 0.65 + Math.random() * 0.3, 0.2);
    particles.emit(x, y + 0.8, z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, 0.35 + Math.random() * 0.25, 0.45, 0.1, tmpC, 1, 0.8, 18);
  }
}

// ======================= Wejście =======================
const typing = () => document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'range';
window.addEventListener('keydown', (e) => {
  if (typing()) { if (e.code === 'Escape' && e.target.id === 'chat-input') closeChat(); return; }
  if (e.code === 'Escape') { e.preventDefault(); if (!e.repeat) handleEscape(); return; }
  if (pauseOpen()) return;
  if (e.code === 'KeyC' && !e.repeat && S.mode !== 'menu' && $('scr-nick').classList.contains('hidden')) { setCam(S.cam === 'iso' ? 'chase' : 'iso'); return; }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'Enter' && !e.repeat && S.mode !== 'menu' && $('scr-nick').classList.contains('hidden')) { e.preventDefault(); openChat(); return; }
  if (!e.repeat && S.mode !== 'menu' && $('scr-nick').classList.contains('hidden')) { const mm = /^(?:Digit|Numpad)([1-9])$/.exec(e.code); if (mm) { sendReact(+mm[1]); return; } }
  if (e.code === 'KeyM' && !e.repeat) toggleMute();
  if (S.spectator && !e.repeat) { if (e.code === 'KeyA' || e.code === 'ArrowLeft') me.specIdx = (me.specIdx || 0) - 1; if (e.code === 'KeyD' || e.code === 'ArrowRight') me.specIdx = (me.specIdx || 0) + 1; }
  if (e.code === 'KeyR' && !e.repeat && racingNow() && !S.spectator) respawnMe(true);
  if (!e.repeat) { if (e.code === 'KeyA') fireGun(); else if (e.code === 'KeyS') dropOil(); else if (e.code === 'KeyD') useMine(); else if (e.code === 'KeyF') fireRocket(); else if (e.code === 'KeyG') useRepair(); }
  if (!audioReady()) initAudio();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
function readInput() {
  const k = (...c) => c.some((x) => keys.has(x));
  input.throttle = k('ArrowUp') ? 1 : 0; // jazda tylko strzałkami; A S D F = broń
  input.brake = k('ArrowDown') ? 1 : 0;
  input.steer = (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0);
  input.hand = keys.has('Space');
}
function toggleMute() { setMuted(!isMuted()); refreshMute(); music.setMuted(isMuted()); }
function refreshMute() { $('ico-on').classList.toggle('hidden', isMuted()); $('ico-off').classList.toggle('hidden', !isMuted()); }

// ======================= Duch (najlepszy przejazd w trybie solo) =======================
const ghost = { vis: null, data: null, rec: [], recAcc: 0, playing: false };
const recGhost = ghost.rec;
const ghostKey = () => 'tc_ghost4_' + trackId + '_' + S.raceLaps;
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.34, depthWrite: false });
function ghostClear() { if (ghost.vis) scene.remove(ghost.vis.group); Object.assign(ghost, { vis: null, data: null, playing: false }); ghost.rec.length = 0; }
function ghostBuild() {
  if (ghost.vis) scene.remove(ghost.vis.group);
  const v = buildCar(CAR_ID, 1);
  v.group.traverse((o) => { if (o.isMesh) { if (o.geometry.type === 'PlaneGeometry') o.visible = false; else { o.material = ghostMat; o.castShadow = false; o.receiveShadow = false; } } });
  v.group.visible = false; scene.add(v.group); ghost.vis = v;
}
function ghostSetup() {
  ghostClear();
  if (!S.solo) return;
  let g = null; try { g = JSON.parse(store.get(ghostKey())); } catch { /* brak */ }
  if (g && g.f?.length > 70) { ghost.data = g; if (S.ghost) ghostBuild(); }
}
const ghostBestTime = () => ghost.data?.time ?? null;
function saveGhost() {
  if (!S.solo || ghost.rec.length < 30) return;
  const prev = ghost.data?.time ?? Infinity; me.best = prev;
  if (me.finishTime < prev) {
    const f = []; for (const s of ghost.rec) for (const v of s) f.push(Math.round(v * 100) / 100);
    store.set(ghostKey(), JSON.stringify({ time: me.finishTime, f }));
  }
}
function ghostRecord(dt) {
  if (!S.solo || !me.st || me.finished) return;
  ghost.recAcc += dt; if (ghost.recAcc < 0.05) return; ghost.recAcc = 0;
  const q = me.st.quat; ghost.rec.push([me.st.x, me.st.y, me.st.z, q.x, q.y, q.z, q.w]);
}
const _gq = new THREE.Quaternion();
function ghostPlay() {
  const v = ghost.vis; if (!v) return;
  if (!(S.solo && S.ghost && ghost.data && S.mode === 'racing' && !me.finished)) { v.group.visible = false; return; }
  const f = ghost.data.f, n = f.length / 7, t = elapsed() / 0.05, i = Math.floor(t);
  if (i >= n - 1) { v.group.visible = false; return; }
  const k = t - i, g = (j, o) => f[(i + j) * 7 + o] * (j ? k : 1 - k);
  const x = g(0, 0) + g(1, 0), y = g(0, 1) + g(1, 1), z = g(0, 2) + g(1, 2);
  v.group.visible = true; v.group.position.set(x, y, z);
  _gq.set(f[i * 7 + 3], f[i * 7 + 4], f[i * 7 + 5], f[i * 7 + 6]); v.group.quaternion.slerp(_gq, 1);
}
function updateBestText() {
  const g = ghostBestTime(); $('hud-best').textContent = S.solo && g ? `Rekord: ${fmt(g)}` : '';
}

// ======================= Czat i reakcje =======================
let reactCd = 0;
const REACTIONS = ['GG!', 'Dobra jazda!', 'Uważaj!', 'Haha', 'Nie ze mną!', 'Pomocy!', 'Rewanż?', 'Ale numer!', 'Do mety!'];
const bubbles = new Map();
function updateChatUi() {
  const c = $('chat');
  const dock = S.mode === 'lobby' && !!S.room && !S.spectator && !!$('lobby-chatslot');
  if (dock !== c.classList.contains('docked')) {
    if (dock) { $('lobby-chatslot').append(c); c.classList.add('docked'); $('chat-form').classList.remove('hidden'); }
    else { if (c.parentElement !== document.body) document.body.append(c); c.classList.remove('docked'); $('chat-form').classList.add('hidden'); }
  }
  c.classList.toggle('hidden', S.mode === 'menu' || !$('scr-nick').classList.contains('hidden'));
  document.body.classList.toggle('chat-on', !c.classList.contains('hidden'));
}
function chatAdd(m) {
  const log = $('chat-log'), d = document.createElement('div');
  d.className = 'msg' + (m.sys ? ' sys' : '') + (m.react ? ' react' : '') + (m.kill ? ' kill' : '');
  if (!m.sys) { const b = document.createElement('b'); b.textContent = m.nick; b.style.color = m.color || '#fff'; d.append(b); }
  d.append(document.createTextNode(m.text));
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.append(d);
  while (log.children.length > 100) log.firstChild.remove();
  if (m.kill) setTimeout(() => { d.style.transition = 'opacity .6s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 650); }, 6000); // informacje o eliminacji znikają po chwili
  if (atBottom) log.scrollTop = log.scrollHeight;
}
function showBubble(id, text) {
  const old = bubbles.get(id); if (old) old.el.remove();
  const el = document.createElement('div'); el.className = 'bubble'; el.textContent = text;
  $('bubbles').append(el); bubbles.set(id, { el, until: performance.now() + 4200 });
}
function clearChat() { $('chat-log').textContent = ''; for (const b of bubbles.values()) b.el.remove(); bubbles.clear(); }
function sendChat(text) { if (S.room && socket) socket.emit('chat', text); else showBubble('me', text.slice(0, 90)); }
function sendReact(i) {
  if (performance.now() < reactCd) return; reactCd = performance.now() + 700;
  if (S.room && socket) socket.emit('react', i); else showBubble('me', REACTIONS[i - 1]);
}
function openChat() { $('chat-form').classList.remove('hidden'); $('chat').classList.remove('hidden'); keys.clear(); $('chat-input').focus(); }
function closeChat() { if (!$('chat').classList.contains('docked')) $('chat-form').classList.add('hidden'); $('chat-input').value = ''; $('chat-input').blur(); updateChatUi(); }
function updateBubbles() {
  const W = innerWidth, H = innerHeight, now = performance.now();
  for (const [id, b] of [...bubbles]) {
    const ent = id === S.you || id === 'me' ? me : opps.get(id);
    if (now > b.until || !ent?.st || S.mode === 'menu') { b.el.remove(); bubbles.delete(id); continue; }
    pv.set(ent.st.x, ent.st.y + 5, ent.st.z).project(camera);
    if (!Number.isFinite(pv.x) || pv.z > 1) continue;
    b.el.style.transform = `translate(${((pv.x + 1) / 2) * W}px, ${((1 - pv.y) / 2) * H}px) translate(-50%, -100%)`;
  }
}

// ======================= Powtórka (automatycznie po wyścigu) =======================
const replay = { buf: [], on: false, auto: false, done: false, pos: 0, cam: 0, lastRec: 0, prevMode: null, segT: 0 };
function recordReplay(now) {
  if (now - replay.lastRec < 66) return; replay.lastRec = now;
  const cars = [];
  const add = (id, c) => { const q = c.st; if (!q) return; const r = q.quat; cars.push([id, q.x, q.y, q.z, r.x, r.y, r.z, r.w, q.steer || 0, q.vf || 0, q.hand ? 1 : 0, q.nitro ? 1 : 0, q.brakeLit ? 1 : 0, q.s]); };
  if (!S.spectator) add('me', me);
  for (const o of oppList()) add(o.id, o);
  replay.buf.push({ t: now, cars });
  while (replay.buf.length > 240) replay.buf.shift();
}
const replayEnt = (id) => (id === 'me' ? me : opps.get(id));
function startReplay(auto = false) {
  if (replay.buf.length < 25) return;
  replay.on = true; replay.auto = auto; replay.prevMode = S.mode; replay.pos = 0; replay.cam = 0; replay.segT = 0;
  $('replay-cam').textContent = 'Kamera: auto'; $('replay-close').textContent = 'Pomiń powtórkę';
  setMode('replay'); showScreen(null);
  $('hud').classList.add('hidden'); $('replay-ui').classList.remove('hidden');
}
function closeReplay(silent) {
  if (!replay.on) return;
  replay.on = false; $('replay-ui').classList.add('hidden');
  setMode(replay.prevMode || 'finished');
  if (!silent) showScreen('results');
}
function stepReplay(dt) {
  const buf = replay.buf; if (buf.length < 2) return;
  const dur = (buf[buf.length - 1].t - buf[0].t) / 1000;
  replay.pos += dt * 0.7; replay.segT += dt;
  if (replay.pos >= dur) { if (replay.auto) { closeReplay(false); return; } replay.pos = 0; replay.segT = 0; }
  const t = buf[0].t + replay.pos * 1000;
  let i = 0; while (i < buf.length - 2 && buf[i + 1].t < t) i++;
  const A = buf[i], B = buf[i + 1], k = clamp((t - A.t) / Math.max(1, B.t - A.t), 0, 1);
  for (const ca of A.cars) {
    const cb = B.cars.find((c) => c[0] === ca[0]) || ca, ent = replayEnt(ca[0]); if (!ent?.st) continue;
    const q = ent.st, l = (j) => ca[j] + (cb[j] - ca[j]) * k;
    q.x = l(1); q.y = l(2); q.z = l(3); q.quat.set(ca[4], ca[5], ca[6], ca[7]).slerp(_gq.set(cb[4], cb[5], cb[6], cb[7]), k);
    q.steer = l(8); q.vf = l(9); q.hand = !!ca[10]; q.nitro = !!ca[11]; q.brakeLit = !!ca[12]; q.s = l(13); q.air = false; q.accelNow = 0; q.vl = 0;
    _w.set(1, 0, 0).applyQuaternion(q.quat); q.fx = _w.x; q.fy = _w.y; q.fz = _w.z;
  }
}
/** kamera powtórki: pościg za liderem, widok z góry i z boku (auto zmienia co ~3,5 s) */
function replayCamera() {
  let lead = null, best = -1;
  for (const c of replay.buf[0]?.cars ?? []) { const e = replayEnt(c[0]); if (e?.st && e.st.s > best) { best = e.st.s; lead = e; } }
  lead = lead || me; const q = lead.st; if (!q) return null;
  const mode = replay.cam || 1 + (Math.floor(replay.segT / 3.5) % 3);
  const up = _w.set(0, 1, 0).applyQuaternion(q.quat).clone(), fw = new THREE.Vector3(q.fx, q.fy, q.fz), P = new THREE.Vector3(q.x, q.y, q.z);
  if (mode === 1) return { pos: P.clone().addScaledVector(fw, -17).addScaledVector(up, 6.5), look: P.clone().addScaledVector(fw, 10).addScaledVector(up, 1.4), fov: 56 };
  const fwh = new THREE.Vector3(fw.x, 0, fw.z); if (fwh.lengthSq() < 0.05) fwh.set(1, 0, 0); fwh.normalize();
  if (mode === 2) return { pos: P.clone().add(new THREE.Vector3(0, 70, 0)).addScaledVector(fwh, -30), look: P.clone(), fov: 44 };
  const side = new THREE.Vector3().crossVectors(fw, up).normalize();
  return { pos: P.clone().addScaledVector(side, 20).addScaledVector(fw, 8).addScaledVector(up, 4), look: P.clone().addScaledVector(fw, 6), fov: 34 };
}

// ======================= Pauza =======================
const pauseOpen = () => !$('pause').classList.contains('hidden');
function refreshPauseUi() {
  const mv = Math.round(music.vol * 100), sv = Math.round(getSfxVolume() * 100);
  for (const [id, v] of [['sl-music', mv], ['sl-sfx', sv]]) { const el = $(id); el.value = v; el.style.setProperty('--p', v + '%'); $(id + '-v').textContent = v + '%'; }
  document.querySelectorAll('#pause-cam button').forEach((b) => b.classList.toggle('sel', b.dataset.c === S.cam));
}
function openPause() {
  if (pauseOpen()) return;
  const mp = !S.solo;
  keys.clear();
  $('pause-title').textContent = mp ? 'Menu' : 'Pauza';
  $('pause-sub').textContent = mp ? 'Gra w pokoju trwa dalej' : 'Gra jest zatrzymana';
  $('p-restart').classList.toggle('hidden', mp); $('p-exit').textContent = mp ? 'Opuść pokój' : 'Wyjdź do menu';
  refreshPauseUi();
  $('pause').classList.remove('hidden'); sfx.open();
  if (!mp) {
    S.paused = true; S.pauseStart = performance.now();
    if (audioReady()) { me.audio?.update({ speed: 0, throttle: 0, slip: 0, rough: 0, active: false }, 0.016); for (const o of oppList()) o.audio?.update({ speed: 0, throttle: 0, slip: 0, rough: 0, active: false }, 0.016); setRain(false); }
  }
}
function closePause(silent) {
  if (!pauseOpen()) return;
  $('pause').classList.add('hidden'); if (!silent) sfx.close();
  if (S.paused) { S.paused = false; S.raceStart += performance.now() - S.pauseStart; setRainAudio(); }
}
function handleEscape() {
  if (!$('rooms-modal').classList.contains('hidden')) { closeRooms(); return; }
  if (!$('profile').classList.contains('hidden')) { $('profile').classList.add('hidden'); return; }
  if (replay.on) { closeReplay(false); return; }
  if (pauseOpen()) { closePause(); return; }
  if (S.mode === 'countdown' || S.mode === 'racing') openPause();
}
function setCam(c, announce = true) {
  S.cam = c; store.set('tc_cam', c); cam.first = true;
  if (announce) toast(c === 'chase' ? 'Kamera: zza auta' : 'Kamera: izometryczna', 1200);
  if (pauseOpen()) refreshPauseUi();
}
function bindPause() {
  let lastTick = 0;
  const slider = (id, onVal) => {
    const el = $(id);
    el.addEventListener('input', () => { const v = +el.value; el.style.setProperty('--p', v + '%'); $(id + '-v').textContent = v + '%'; onVal(v / 100); const now = performance.now(); if (now - lastTick > 55) { lastTick = now; sfx.tick(v / 100); } });
    el.addEventListener('change', () => { sfx.click(); el.blur(); });
  };
  slider('sl-music', (v) => music.setVolume(v)); slider('sl-sfx', (v) => setSfxVolume(v));
  document.querySelectorAll('#pause-cam button').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.c, false)));
  $('p-resume').addEventListener('click', () => closePause());
  $('p-restart').addEventListener('click', () => { closePause(true); startSolo(); });
  $('p-exit').addEventListener('click', () => { closePause(true); goMenu(); });
}

// ======================= Podpisy nad autami =======================
const tagEls = {};
function tagFor(key, nick, color) {
  if (!tagEls[key]) { const d = document.createElement('div'); d.className = 'tag'; d.innerHTML = '<i></i><span></span>'; $('tags').append(d); tagEls[key] = d; }
  const d = tagEls[key];
  if (d._nick !== nick) { d.querySelector('span').textContent = nick; d._nick = nick; }
  d.firstChild.style.background = color;
  return d;
}
function updateTags() {
  const racing = S.mode === 'countdown' || S.mode === 'racing' || S.mode === 'finished';
  const W = innerWidth, H = innerHeight;
  const place = (key, c, nick) => {
    const d = tagFor(key, nick, c?.color || '#fff');
    if (!racing || !c?.st || !c.vis || !nick || (c === me && S.spectator)) { d.style.display = 'none'; return; }
    pv.set(c.st.x, c.st.y + 3.2, c.st.z).project(camera);
    if (pv.z > 1) { d.style.display = 'none'; return; }
    d.style.display = 'flex';
    d.style.transform = `translate(${((pv.x + 1) / 2) * W}px, ${((1 - pv.y) / 2) * H}px) translate(-50%, -100%)`;
  };
  place('me', me, S.solo ? S.nick : (myRoomPlayer()?.nick ?? S.nick));
  const seen = new Set(['me']);
  for (const o of opps.values()) { place('o' + o.id, o, o.nick); seen.add('o' + o.id); }
  for (const k of Object.keys(tagEls)) if (!seen.has(k)) tagEls[k].style.display = 'none';
}


// ======================= Przedmioty i broń =======================
const soloSpawn = { t: 5, id: 1 };
const PICK_ORDER = ['ammo', 'oil', 'bomb', 'rocket', 'repair', 'nitro'];
let soloSlots = null, soloCycle = 0;
let idSeq = 0;
const nextId = () => `${(S.you || 'me').slice(0, 5)}${++idSeq}`;
function spawnCrate(id, type, u, l) {
  const s = track.pickS(clamp(u, 0, 1) * track.length);
  items.spawn(id, type, s, clamp(l, -0.8, 0.8) * track.hwAt(s) * 0.7);
}
function applyPickup(type) {
  sfx.pickup(type);
  if (type === 'nitro') { me.boost = 100; toast('Nitro — pełny zbiornik'); }
  else if (type === 'repair') { me.items.repair = Math.min(2, me.items.repair + 1); toast(`Naprawa${me.items.repair > 1 ? ' ×' + me.items.repair : ''} — G`); }
  else {
    const k = type === 'ammo' ? 'ammo' : type === 'oil' ? 'oil' : type === 'rocket' ? 'rocket' : 'mine';
    me.items[k] = Math.min(2, me.items[k] + 1);
    toast(`${ITEM_TYPES[type].name}${me.items[k] > 1 ? ' ×' + me.items[k] : ''} — ${{ ammo: 'A (seria 4 s)', oil: 'S', mine: 'D', rocket: 'F (naprowadzana)' }[k]}`);
  }
  updateSlots();
}
const slotPrev = {};
/** sloty ekwipunku: licznik w kółku po prawej; gdy przybywa przedmiot — ikona i liczba pulsują (quiet = bez efektu, np. na starcie) */
function updateSlots(quiet = false) {
  const set = (id, label, n) => {
    const el = $(id); if (!el) return;
    el.querySelector('span').textContent = label;
    const cnt = el.querySelector('.cnt'); cnt.textContent = n; cnt.style.display = n > 0 ? 'grid' : 'none';
    el.classList.toggle('has', n > 0);
    if (!quiet && n > (slotPrev[id] ?? 0)) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); clearTimeout(el._pt); el._pt = setTimeout(() => el.classList.remove('pulse'), 1250); }
    slotPrev[id] = n;
  };
  set('slot-ammo', 'Karabin', me.items.ammo); set('slot-oil', 'Olej', me.items.oil); set('slot-mine', 'Mina', me.items.mine); set('slot-rocket', 'Rakieta', me.items.rocket); set('slot-repair', 'Naprawa', me.items.repair);
  $('slot-ammo')?.classList.toggle('active', me.fireT > 0);
}
const emitEvent = (e) => { if (!S.solo) socket?.emit('game:event', e); };
function fireGun() {
  if (!racingNow() || S.spectator) return;
  if (me.items.ammo <= 0 || me.fireT > 0) { sfx.empty(); return; }
  me.items.ammo--; me.fireT = 4; me.fireAcc = 0; updateSlots();
}
function shootOne() { const st = me.st, s = st.s + 3, vs = Math.max(st.vf, 20) + 75; items.shoot(s, st.d, vs, 'me'); sfx.shoot(); emitEvent({ t: 'shoot', x: s, z: st.d, vx: vs }); }
/** rakieta: leci szybciej od auta i naprowadza się na najbliższego rywala z przodu (do 350 m) */
const ZONES_ROCKET = { 5: 0.8, 2: 0.6, 3: 0.6, 6: 0.5, 7: 0.5, 0: 0.3, 1: 0.3 };
function fireRocket() {
  if (!racingNow() || S.spectator) return;
  if (me.items.rocket <= 0) { sfx.empty(); return; }
  me.items.rocket--; updateSlots();
  const st = me.st; let tgt = null, best = 350;
  for (const o of oppList()) { if (o.st.dead || o.finished) continue; const ds = items.ds(o.st.s, st.s); if (ds > 4 && ds < best) { best = ds; tgt = o; } }
  const s = st.s + 3.5, vs = Math.max(st.vf, 25) + 95;
  items.rocket(s, st.d, vs, 'me', tgt?.st ?? null); sfx.rocket(); emitEvent({ t: 'rocket', x: s, z: st.d, vx: vs, to: tgt && !tgt.bot ? tgt.id : null });
}
/** trafienie rakietą: duży wybuch, podrzut auta i uszkodzenia stref */
function rocketBoom(st) {
  explodeAt(st); sparks(st.x, st.y, st.z, 24);
}
/** leczenie z ekwipunku: +40 stanu auta i naprawa stref (nie marnuje paczki przy pełnym stanie) */
function useRepair() {
  if (!racingNow() || S.spectator || me.dead > 0) return;
  if (me.items.repair <= 0) { sfx.empty(); return; }
  if (me.hp >= 100 && !me.st.parts.some((v) => v > 0.02)) { toast('Auto jest w pełni sprawne', 1200); return; }
  me.items.repair--; setHp(me.hp + 40); me.st.repairParts(0.45); sfx.pickup('repair'); toast('Naprawa +40', 1200); updateSlots();
}
function dropOil() {
  if (!racingNow() || S.spectator) return;
  if (me.items.oil <= 0) { sfx.empty(); return; }
  me.items.oil--; const s = me.st.s - 3.4; items.dropOil(s, me.st.d, 'me'); emitEvent({ t: 'oil', x: s, z: me.st.d }); sfx.oil(); updateSlots();
}
function useMine() {
  if (!racingNow() || S.spectator) return;
  if (me.items.mine <= 0) { sfx.empty(); return; }
  me.items.mine--; const id = nextId(), s = me.st.s - 3.2; items.dropMine(id, s, me.st.d, 'me'); emitEvent({ t: 'bomb', id, x: s, z: me.st.d }); sfx.oil(); updateSlots();
}
// ---- strefy uszkodzeń: 0 koło p.-prawe, 1 p.-lewe, 2 t.-prawe, 3 t.-lewe, 4 dziób, 5 tył, 6 bok prawy, 7 bok lewy (prawa = +d) ----
const PART_K = 0.02; // siła obrażeń (hp) → uszkodzenie stref (0..1)
const ZONES_SHOT = { 5: 1, 2: 0.6, 3: 0.6, 6: 0.25, 7: 0.25 };
const ZONES_MINE = { 0: 0.8, 1: 0.8, 2: 0.8, 3: 0.8, 6: 0.4, 7: 0.4, 4: 0.3, 5: 0.3 };
const zonesWall = (st) => (st.d > 0 ? { 6: 1, 0: 0.8, 2: 0.45, 4: 0.3 } : { 7: 1, 1: 0.8, 3: 0.45, 4: 0.3 });
const _zr = new THREE.Vector3();
/** strefy zależne od kierunku zderzenia z innym autem (przód/tył/bok) */
function zonesCar(st, o) {
  const dx = o.x - st.x, dy = o.y - st.y, dz = o.z - st.z, len = Math.hypot(dx, dy, dz) || 1;
  _zr.set(0, 0, 1).applyQuaternion(st.quat);
  const f = (dx * st.fx + dy * st.fy + dz * st.fz) / len, r = (dx * _zr.x + dy * _zr.y + dz * _zr.z) / len, w = {};
  if (f > 0) w[4] = f; else w[5] = -f;
  w[r > 0 ? 6 : 7] = Math.abs(r) * 0.9 + 0.1;
  const fr = f > 0 ? 0 : 2; w[fr + (r > 0 ? 0 : 1)] = 0.8; w[fr + (r > 0 ? 1 : 0)] = 0.3;
  return w;
}
function lostWheelMsg(lost) { if (lost.length) { toast(lost.length > 1 ? 'Odpadły koła!' : 'Odpadło koło!', 1600); sfx.tire(0.8); } }
function hitMe(from) { me.st.slowT = 1.3; me.st.vf *= 0.93; sparks(me.st.x, me.st.y, me.st.z, 14); sfx.hit(); damageMe(7, ZONES_SHOT, from); }
function damageBot(o, dmg, zones, by = null) {
  if (o.deadT > 0 || o.inv > 0) return;
  if (by) o.lastBy = { id: by, t: performance.now() };
  o.hp = clamp((o.hp ?? 100) - dmg, 0, 100); o.st.hp = o.hp; o.st.damage = 1 - o.hp / 100;
  if (zones) o.st.hurt(zones, dmg * PART_K);
  if (o.hp <= 0) { o.deadT = DEAD_T; o.deathS = o.st.s; o.deathD = o.st.d; o.st.dead = 1; explodeAt(o.st);
    if (S.solo || S.room?.players[0]?.id === S.you) { const kid = o.lastBy && performance.now() - o.lastBy.t < 6000 ? o.lastBy.id : null; announceKill(o.nick, nameOfId(kid), false, kid === 'me'); if (!S.solo) emitEvent({ t: 'kill', id: o.id, to: kid === 'me' ? S.you : kid }); } }
}
/** wybuch miny: efekt, podrzut aut w promieniu 9 m (u mnie i u botów; zdalni gracze liczą go u siebie) */
function blast(s, d, id, fromNet = false) {
  const own = ownerId(items.mines.find((m) => m.id === id)?.owner);
  items.removeMine(id);
  const p = track.pos(s, d, 1, {}); sfx.explode();
  for (let i = 0; i < 60; i++) { const a = Math.random() * 6.28, sp = 3 + Math.random() * 13; tmpC.setRGB(1, 0.35 + Math.random() * 0.45, 0.05); particles.emit(p.x, p.y, p.z, Math.cos(a) * sp, 2 + Math.random() * 9, Math.sin(a) * sp, 0.7 + Math.random() * 0.5, 1.5, 6, tmpC, 0.9, 1.4, 4); }
  const near = (st) => Math.abs(items.ds(st.s, s)) < 9 && Math.abs(st.d - d) < 9;
  const pw = (st) => 1 - Math.hypot(items.ds(st.s, s), st.d - d) / 12;
  if (me.st && !S.spectator && near(me.st)) { me.st.knock(track); sparks(me.st.x, me.st.y, me.st.z, 18); damageMe(14 + 26 * clamp(pw(me.st), 0, 1), ZONES_MINE, own); }
  for (const o of oppList()) if (o.bot && near(o.st)) { o.st.knock(track); damageBot(o, 14 + 26 * clamp(pw(o.st), 0, 1), ZONES_MINE, own); }
  if (!fromNet) emitEvent({ t: 'boom', id, x: s, z: d });
}
function onGameEvent(e) {
  if (e.t === 'shoot') items.shoot(e.x, e.z, e.vx, 'opp:' + e.from);
  else if (e.t === 'rocket') { items.rocket(e.x, e.z, e.vx, 'opp:' + e.from, e.to === S.you ? me.st : null); sfx.rocket(); }
  else if (e.t === 'kill') { const v = nameOfId(e.id || e.from), k = nameOfId(e.to); if (v) announceKill(v, k, false, e.to === S.you); }
  else if (e.t === 'oil') items.dropOil(e.x, e.z, 'opp');
  else if (e.t === 'bomb') items.dropMine(e.id, e.x, e.z, 'opp:' + e.from);
  else if (e.t === 'boom') blast(e.x, e.z, e.id, true);
  else if (e.t === 'hit') {
    if (e.k === 'rocket') { if (e.to === S.you && me.st) { rocketBoom(me.st); me.st.knock(track, 8, 4); damageMe(30, ZONES_ROCKET, e.from); } items.rockets.filter((x) => x.owner === 'opp:' + e.from).forEach((x) => items.killRocket(x)); return; }
    if (e.to === S.you && me.st) hitMe(e.from); items.shots.filter((x) => x.owner === 'opp:' + e.from).forEach((x) => items.killShot(x));
  }
}
/** olej, miny, trafienia pocisków, losowanie paczek w solo — co klatkę */
function updateItems(dt) {
  items.update(dt, T);
  if (me.st) me.st.inOil = items.oilAt(me.st.s, me.st.d);
  for (const o of oppList()) if (o.bot && o.st) o.st.inOil = items.oilAt(o.st.s, o.st.d);
  if (S.mode !== 'racing') return;
  if (me.st && !S.spectator && !me.finished) { const mn = items.mineNear(me.st.s, me.st.d); if (mn) blast(mn.s, mn.d, mn.id); }
  for (const o of oppList()) if (o.bot) { const mn = items.mineNear(o.st.s, o.st.d); if (mn) blast(mn.s, mn.d, mn.id); }
  for (const sh of items.shots) { // moje pociski trafiają rywali (zdalni dostają zdarzenie „hit”)
    if (sh.life <= 0 || sh.owner !== 'me') continue;
    for (const o of oppList()) {
      if (Math.abs(items.ds(sh.s, o.st.s)) < 3.2 && Math.abs(sh.d - o.st.d) < 1.9) {
        items.killShot(sh); sparks(o.st.x, o.st.y, o.st.z, 10); sfx.hit();
        if (o.bot) { o.st.slowT = 0.9; o.st.vf *= 0.95; damageBot(o, 7, ZONES_SHOT, 'me'); } else emitEvent({ t: 'hit', to: o.id });
        break;
      }
    }
  }
  for (const r of items.rockets) { // moje rakiety trafiają rywali (zdalni dostają zdarzenie „hit”)
    if (r.life <= 0 || r.owner !== 'me') continue;
    for (const o of oppList()) {
      if (o.st.dead || Math.abs(items.ds(r.s, o.st.s)) > 3.8 || Math.abs(r.d - o.st.d) > 2.7) continue;
      items.killRocket(r); rocketBoom(o.st);
      if (o.bot) { o.st.knock(track, 8, 4); damageBot(o, 30, ZONES_ROCKET, 'me'); } else emitEvent({ t: 'hit', to: o.id, k: 'rocket' });
      break;
    }
  }
  if (S.solo && S.pickups !== 'off') { // paczki w solo: stałe rzędy po 3, typy po kolei, zebrana wraca po 14 s
    if (!soloSlots) {
      const rows = { rare: 4, normal: 8, often: 14 }[S.pickups] ?? 8; soloSlots = []; soloCycle = Math.random() * 6 | 0;
      for (let k = 0; k < rows; k++) for (const l of [-0.55, 0, 0.55]) soloSlots.push({ u: 0.04 + 0.92 * (k + 0.5) / rows, l, id: null, t: 0.5 });
    }
    for (const sl of soloSlots) {
      if (sl.id != null) { if (!items.crates.has(sl.id)) { sl.id = null; sl.t = 14; } continue; }
      sl.t -= dt;
      if (sl.t <= 0) { sl.id = soloSpawn.id++; spawnCrate(sl.id, PICK_ORDER[soloCycle++ % PICK_ORDER.length], sl.u, sl.l); }
    }
  }

}
// ======================= Rozgrywka =======================
const cpFor = (s) => track.lastCp(s);
const setHp = (v) => { me.hp = clamp(v, 0, 100); me.st.hp = me.hp; me.st.damage = 1 - me.hp / 100; setHpBar(me.hp); };
const DEAD_T = 1.0;  // czas od wybuchu do powrotu auta [s]
const INV_T = 1.8;   // nietykalność po powrocie [s]
function respawnMe(manual = false, afterDeath = false) {
  const st = me.st; if (!st) return;
  if (afterDeath) { // wraca dokładnie tam, gdzie wybuchło (z niewielką prędkością, na środku jezdni)
    st.respawnAt(track, me.deathS ?? st.s, 9, clamp(me.deathD ?? 0, -4.5, 4.5));
    st.parts.fill(0); st.refreshParts(); me.inv = INV_T;
  } else { me.cp = track.lastCp(st.s); st.respawnAt(track, me.cp, 24); me.falls++; }
  me.nitroT = 0; me.boosting = false; me.driftT = 0;
  if (afterDeath) { me.dead = 0; st.dead = 0; setHp(100); if (me.vis) me.vis.group.visible = true; }
  cam.first = true; sfx.empty?.(); toast(afterDeath ? 'Auto wróciło na tor' : manual ? 'Powrót na ostatni punkt' : 'Wypadek — powrót na tor', 1400);
}
function explodeAt(st) {
  sfx.explode();
  for (let i = 0; i < 70; i++) { const a = Math.random() * 6.28, sp = 3 + Math.random() * 14; tmpC.setRGB(1, 0.3 + Math.random() * 0.5, 0.05); particles.emit(st.x, st.y + 0.8, st.z, Math.cos(a) * sp, 3 + Math.random() * 10, Math.sin(a) * sp, 0.8 + Math.random() * 0.6, 1.5, 6, tmpC, 0.9, 1.4, 4); }
  for (let i = 0; i < 24; i++) { const a = Math.random() * 6.28; tmpC.setRGB(0.12, 0.12, 0.14); particles.emit(st.x, st.y + 1, st.z, Math.cos(a) * 3, 2 + Math.random() * 4, Math.sin(a) * 3, 1.6, 1.3, 4, tmpC, 0.6, 1.2); }
}
// ---- eliminacje: wpis w czacie dla wszystkich, duży komunikat dla wyeliminowanego ----
const nameOfId = (id) => (!id ? null : id === 'me' || id === S.you ? S.nick : opps.get(id)?.nick ?? S.room?.players.find((p) => p.id === id)?.nick ?? null);
const ownerId = (owner) => (owner === 'me' ? 'me' : typeof owner === 'string' && owner.startsWith('opp:') ? owner.slice(4) : null);
const killerOf = (c) => (c.lastBy && performance.now() - c.lastBy.t < 6000 && c.lastBy.id !== 'me' && c.lastBy.id !== c.id ? c.lastBy.id : null);
let elimTimer = 0;
function announceKill(victim, killer, victimIsMe, killerIsMe) {
  chatAdd({ sys: true, kill: true, text: killer ? `${killer} wyeliminował ${victim}` : `${victim} rozbił się` });
  if (victimIsMe) { const e = $('elim'); e.querySelector('small').textContent = killer ? 'Wyeliminowany' : 'Rozbity'; e.querySelector('b').textContent = killer ? `${killer} cię wyeliminował` : 'Rozbiłeś się'; e.classList.remove('hidden'); e.style.animation = 'none'; void e.offsetWidth; e.style.animation = ''; clearTimeout(elimTimer); elimTimer = setTimeout(() => e.classList.add('hidden'), 2600); }
  else if (killerIsMe) toast(`Wyeliminowałeś ${victim}`, 1800);
}
/** obrażenia mojego auta; po wyzerowaniu hp auto wybucha i wraca na tor po chwili */
function damageMe(dmg, zones, by = null) {
  if (!racingNow() || me.dead > 0 || me.inv > 0 || S.spectator || dmg <= 0) return;
  if (by && by !== 'me') me.lastBy = { id: by, t: performance.now() };
  setHp(me.hp - dmg);
  if (zones) lostWheelMsg(me.st.hurt(zones, dmg * PART_K));
  if (me.hp <= 0) { me.dead = DEAD_T; me.deathS = me.st.s; me.deathD = me.st.d; me.st.dead = 1; me.st.vf *= 0.3; me.st.vl = 0; explodeAt(me.st); if (me.vis) me.vis.group.visible = false;
    const kid = killerOf(me); announceKill(S.nick, nameOfId(kid), true, false); emitEvent({ t: 'kill', to: kid }); me.lastBy = null; }
}
function stepMe(dt) {
  const st = me.st;
  // nitro: zbiornik ładuje się sam (Shift), pady i mini-turbo dodają nitro
  const wantBoost = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && racingNow();
  if (wantBoost && me.boost > 0) { me.boost = Math.max(0, me.boost - 38 * dt); me.boosting = true; me.boostIdle = 0.9; }
  else { me.boosting = false; me.boostIdle -= dt; if (me.boostIdle <= 0) me.boost = Math.min(100, me.boost + 16 * dt); }
  if (me.nitroT > 0) me.nitroT -= dt;
  st.nitro = me.nitroT > 0 || me.boosting;
  if (me.inv > 0) me.inv -= dt;
  const inp = me.finished || me.dead > 0 ? { throttle: 0, brake: me.dead > 0 ? 0.8 : 0.4, steer: 0, hand: false } : (me.auto ? botInput(st, track, me, dt) : input); // me.auto — tylko do testów
  const wasAir = st.air;
  st.step(track, inp, dt);
  if (me.dead > 0) { me.dead -= dt; if (me.dead <= 0) respawnMe(false, true); return; }
  if (st.fell) { respawnMe(false); return; }
  if (wasAir && !st.air) { sfx.land(0.4 + Math.min(0.6, st.landHit / 12)); sparks(st.x, st.y, st.z, 8 + st.landHit * 2); }
  me.hitCd = (me.hitCd || 0) - dt;
  if (st.hit > 3 && me.hitCd <= 0) { sfx.wall(st.hit / 18); sparks(st.x, st.y, st.z, st.hit); me.hitCd = 0.2; damageMe((st.hit - 5) * 0.9, zonesWall(st)); }
  for (const o of oppList()) if (o.st && !o.st.air) { const h = carVsCar(st, o.st, track); if (h > 1.5 && me.hitCd <= 0) { sfx.carHit(h / 14); sparks((st.x + o.st.x) / 2, st.y, (st.z + o.st.z) / 2, h); me.hitCd = 0.15; damageMe((h - 4) * 0.7, zonesCar(st, o.st), o.id); } }
  if (!racingNow()) return;
  if (!S.spectator) {
    const c = items.crateNear(st.s, st.d);
    if (c && !c.requested) { c.requested = true; if (S.solo) { applyPickup(c.type); items.remove(c.id); } else socket?.emit('pickup:take', { id: c.id }); }
  }
  if (me.fireT > 0) { me.fireT -= dt; me.fireAcc -= dt; if (me.fireAcc <= 0 && me.fireT > 0) { shootOne(); me.fireAcc = 0.12; } if (me.fireT <= 0) { me.fireT = 0; updateSlots(); } }
  // pady przyspieszające (jeden pas) i mini-turbo po dryfcie
  me.padCd -= dt;
  for (const p of track.pads) if (track.inPad(p, st.s) && !st.air && Math.abs(st.d - p.lat) < 2.5 && me.padCd <= 0) { me.padCd = 1.2; me.nitroT = Math.max(me.nitroT, 1.7); sfx.nitro(); sparks(st.x, st.y, st.z, 18); toast('Nitro!', 700); }
  const drifting = st.hand && st.speed > 16 && Math.abs(st.vl) > 3.5 && !st.air;
  if (drifting) me.driftT += dt; else { if (me.driftT > 0.9) { me.nitroT = Math.max(me.nitroT, Math.min(1.9, 0.5 + me.driftT * 0.4)); sfx.nitro(); toast('Mini-turbo!', 800); } me.driftT = 0; }
  // okrążenia i meta
  const L = track.length, lap = Math.max(0, Math.floor(st.s / L));
  if (lap > me.lapIdx && !me.finished) {
    const t = elapsed(), lt = t - me.lapStart; me.lapStart = t; me.lapIdx = lap;
    const best = lt < me.bestLap; me.bestLap = Math.min(me.bestLap, lt);
    if (lap < S.raceLaps) { setText('hud-cp', `${lap + 1}/${S.raceLaps}`); sfx.lap(); toast(`Okrążenie ${lap}/${S.raceLaps} · ${fmt(lt)}${best && lap > 1 ? ' · najlepsze' : ''}${lap + 1 === S.raceLaps ? ' · ostatnie okrążenie!' : ''}`, 2000); }
  }
  if (!me.finished && st.s >= S.raceLaps * L) finishLocal();
}
function botStep(o, dt) {
  const st = o.st; if (!st) return;
  if (o.inv > 0) o.inv -= dt;
  const finished = o.finishT != null;
  if (o.deadT > 0) { o.deadT -= dt; st.step(track, { throttle: 0, brake: 1, steer: 0, hand: false }, dt); if (o.deadT <= 0) { st.respawnAt(track, o.deathS ?? st.s, 9, clamp(o.deathD ?? 0, -4.5, 4.5)); o.hp = st.hp = 100; st.damage = 0; st.dead = 0; o.padT = 0; st.parts.fill(0); st.refreshParts(); o.inv = INV_T; } return; }
  const inp = finished ? { throttle: 0, brake: 0.5, steer: 0, hand: false } : botInput(st, track, o, dt);
  o.padT -= dt; for (const p of track.pads) if (track.inPad(p, st.s) && Math.abs(st.d - p.lat) < 2.5) o.padT = 1.5;
  st.nitro = o.padT > 0 && !finished;
  st.step(track, inp, dt);
  if (st.fell) { st.respawnAt(track, cpFor(st.s), 24); o.padT = 0; }
  if (me.st && !S.spectator) carVsCar(st, me.st, track);
  for (const q of oppList()) if (q !== o && q.st) carVsCar(st, q.st, track);
  if (!finished && st.s >= S.raceLaps * track.length) { o.finishT = elapsed(); o.finished = true; if (!S.solo) socket?.emit('bot:finish', { id: o.id, time: o.finishT }); }
}
function spectateTarget() {
  const l = oppList().sort((a, b) => b.st.s - a.st.s);
  return l.length ? l[((me.specIdx || 0) % l.length + l.length) % l.length] : null;
}

// ======================= Kamera =======================
const _cu = new THREE.Vector3(), _cf = new THREE.Vector3(), _cp = new THREE.Vector3(), _ft = {};
const orbit = { yaw: 0, pitch: 0, zoom: 1, drag: false, idle: 0 }, _co = new THREE.Vector3(), _cr = new THREE.Vector3();
{
  const ok = (e) => (S.mode === 'racing' || S.mode === 'countdown' || S.mode === 'finished') && S.cam === 'chase' && !e.target.closest('button, input, textarea, .card, #chat, .screen:not(.hidden), #pause, .modal');
  addEventListener('pointerdown', (e) => { if (e.button === 0 && ok(e)) { orbit.drag = true; orbit.idle = 0; } });
  addEventListener('pointermove', (e) => { if (!orbit.drag) return; orbit.yaw = clamp(orbit.yaw - e.movementX * 0.006, -Math.PI, Math.PI); orbit.pitch = clamp(orbit.pitch + e.movementY * 0.004, -0.15, 1.05); orbit.idle = 0; });
  const up = () => { if (orbit.drag) { orbit.drag = false; orbit.idle = 0; } };
  addEventListener('pointerup', up); addEventListener('pointercancel', up); addEventListener('blur', up);
  addEventListener('wheel', (e) => { if (ok(e)) orbit.zoom = clamp(orbit.zoom * (e.deltaY > 0 ? 1.08 : 0.92), 0.6, 2.2); }, { passive: true });
}
function updateCamera(dt) {
  const racingView = S.mode === 'countdown' || S.mode === 'racing' || S.mode === 'finished';
  const rc = S.mode === 'replay' ? replayCamera() : null;
  let pos, look, fov = 40, up = null;
  const pc = podium.on ? podiumCam() : null;
  if (pc) { pos = pc.pos; look = pc.look; fov = pc.fov; up = pc.up; cam.racingT = 99; }
  else if (rc) { pos = rc.pos; look = rc.look; fov = rc.fov; cam.racingT = 99; }
  else if (racingView && (me.st || spectateTarget())) {
    const subj = S.spectator ? (spectateTarget() || { st: me.st }) : me;
    const m = subj.st; if (!m) return;
    const speed = m.speed;
    cam.racingT = (cam.racingT ?? 0) + dt;
    if (S.cam === 'chase') {
      _cf.set(m.fx, m.fy, m.fz);
      if (m.air) _cu.set(0, 1, 0); else { const f = track.at(m.s, _ft); _cu.set(f.ux, f.uy, f.uz); }
      if (cam.first) { cam.f.copy(_cf); cam.u.copy(_cu); }
      cam.f.lerp(_cf, 1 - Math.exp(-dt * 5.5)).normalize();
      cam.u.lerp(_cu, 1 - Math.exp(-dt * 2.6)); cam.u.addScaledVector(cam.f, -cam.u.dot(cam.f)).normalize();
      // bliższa kamera za autem; mysz (przeciąganie) obraca widok wokół auta, kółko przybliża; po puszczeniu wraca za auto
      if (!orbit.drag) { orbit.idle += dt; if (orbit.idle > 1.6) { const kk = 1 - Math.exp(-dt * 3); orbit.yaw -= orbit.yaw * kk; orbit.pitch -= orbit.pitch * kk; } }
      const dist = (5.3 + clamp(speed - 20, 0, 50) * 0.04) * orbit.zoom, h = (1.95 + clamp(speed - 20, 0, 50) * 0.01) * orbit.zoom;
      _cp.set(m.x, m.y, m.z);
      _co.set(0, 0, 0).addScaledVector(cam.f, -dist).addScaledVector(cam.u, h);
      if (orbit.yaw || orbit.pitch) { _co.applyAxisAngle(cam.u, orbit.yaw); _cr.crossVectors(cam.f, cam.u).normalize(); _co.applyAxisAngle(_cr, orbit.pitch); }
      pos = _cp.clone().add(_co);
      look = _cp.clone().addScaledVector(cam.f, 5).addScaledVector(cam.u, 0.85);
      fov = 62 + clamp((speed - 25) / 45, 0, 1) * 9 + (m.nitro ? 8 : 0);
      up = cam.u;
    } else {
      let half = 30 + clamp(speed - 15, 0, 55) * 0.2;
      const fx = m.x + m.vx * 0.2, fy = m.y, fz = m.z + m.vz * 0.2;
      if (cam.first || cam.racingT < 0.02) { cam.focus.set(fx, fy, fz); cam.half = half; }
      cam.half += (half - cam.half) * (1 - Math.exp(-dt * 1.8));
      cam.focus.x += (fx - cam.focus.x) * (1 - Math.exp(-dt * 6)); cam.focus.z += (fz - cam.focus.z) * (1 - Math.exp(-dt * 6)); cam.focus.y += (fy - cam.focus.y) * (1 - Math.exp(-dt * 4));
      pos = cam.focus.clone().addScaledVector(CAM_DIR, cam.half * 3.9); look = cam.focus.clone();
      fov = 24 + clamp((speed - 22) / 40, 0, 1) * 4.5 + (m.nitro ? 4.5 : 0);
    }
  } else if (S.mode === 'menu' || S.mode === 'lobby') {
    const overview = S.mode === 'menu' && menuTab === 'track' && track?.bounds;
    if (overview) {
      const b = track.bounds, ex = b.maxX - b.minX, ez = b.maxZ - b.minZ, d = Math.max(ez * 1.9, ex * 1.35) * 1.1;
      look = new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2); pos = look.clone().add(new THREE.Vector3(0, d * 0.88, d * 0.45)); fov = 36;
    } else {
      const base = me.st; const P = new THREE.Vector3(base ? base.x : 0, (base ? base.y : 0) - 1.8, base ? base.z : 0);
      const a = T * 0.2 + 0.5, r = 22;
      pos = new THREE.Vector3(P.x + Math.cos(a) * r, P.y + 11 + Math.sin(T * 0.4) * 0.8, P.z + Math.sin(a) * r); look = P.clone(); fov = 36;
    }
  } else { pos = cam.pos.clone(); look = cam.look.clone(); }
  if (!racingView) cam.racingT = undefined;
  const k = cam.first ? 1 : 1 - Math.exp(-dt * (racingView ? (S.cam === 'chase' ? 16 : 2.6 + Math.min(1, (cam.racingT ?? 0) / 1.4) * 8) : 2.4));
  cam.first = false;
  cam.pos.lerp(pos, k); cam.look.lerp(look, k); cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 6));
  camera.position.copy(cam.pos);
  if (up) camera.up.copy(up); else camera.up.set(0, 1, 0);
  camera.lookAt(cam.look);
  if (racingView && me.st && S.mode === 'racing') { // drżenie kamery przy nitro i dużej prędkości
    const spd = me.st.speed, amp = (me.st.nitro ? 0.28 : 0) + clamp((spd - 52) / 40, 0, 1) * 0.18;
    if (amp > 0.01) camera.position.add(_cp.set((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp * 0.6, (Math.random() - 0.5) * amp));
  }
  camera.fov = cam.fov; camera.near = 0.5; camera.far = 7000;
  camera.updateProjectionMatrix();
  post.tilt.uniforms.uAmount.value = (S.cam === 'chase' && racingView) || podium.on ? 0 : 0.5;
  if (world) world.skyDome.position.copy(camera.position);
  world?.setOverview?.(S.mode === 'menu' && menuTab === 'track');
  rain.material.uniforms.uTime.value = T; rain.material.uniforms.uCenter.value.copy(cam.look);
}

// ======================= HUD =======================
let hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; const e = $(id); if (e) e.textContent = v; } }
let hudDmgKey = '';
const dmgColor = (v) => { const L = (a, b, t) => Math.round(a + (b - a) * t); if (v >= 1) return 'rgb(58,58,66)'; if (v < 0.5) { const t = v / 0.5; return `rgb(${L(62, 255, t)},${L(224, 194, t)},${L(138, 51, t)})`; } const t = (v - 0.5) / 0.5; return `rgb(255,${L(194, 74, t)},${L(51, 58, t)})`; };
function updateHud() {
  if ($('hud').classList.contains('hidden') || !me.st) { $('speedfx').style.opacity = 0; return; }
  const subj = S.spectator ? spectateTarget() : me, st = subj?.st; if (!st) return;
  const sp = Math.abs(st.vf);
  { const sp0 = S.mode === 'racing' ? st.speed : 0; $('speedfx').style.opacity = (clamp((sp0 - 62) / 48, 0, 1) * 0.5 + (st.nitro && sp0 > 20 ? 0.3 : 0)).toFixed(2); }
  setText('hud-speed', String(Math.round(st.speed * 3.8)));
  { // schemat uszkodzeń: kolory stref
    const key = Array.from(st.parts, (v) => Math.round(v * 15).toString(16)).join('') + Math.round(st.hp ?? 100);
    if (key !== hudDmgKey) {
      hudDmgKey = key;
      for (let i = 0; i < 8; i++) { const e = $('dm' + i); if (e) { e.style.fill = dmgColor(st.parts[i]); e.classList.toggle('lost', i < 4 && st.parts[i] >= 1); } }
      const b = $('dm-body'); if (b) b.style.fill = dmgColor(1 - (st.hp ?? 100) / 100);
    }
  }
  $('hud-bar').style.width = `${clamp(sp / (st.def.maxSpeed * 1.2), 0, 1) * 100}%`;
  if (S.mode === 'racing' && (!me.finished || S.spectator)) setText('hud-time', fmt(elapsed()));
  else if (me.finished) setText('hud-time', fmt(me.finishTime));
  $('boost-fill').style.width = `${me.boost}%`; $('boost-wrap').classList.toggle('on', me.boosting);
  if (opps.size) setText('hud-pos', `${1 + oppList().filter((o) => o.st.s > me.st.s).length}/${opps.size + 1}`);
  $('hud-prog').style.width = `${clamp(me.st.s / ((S.raceLaps || 1) * track.length), 0, 1) * 100}%`;
}
function drawMinimap() {
  if (!me.st || $('hud').classList.contains('hidden')) return;
  const dots = [{ x: me.st.x, z: me.st.z, color: me.color, me: true }];
  for (const o of oppList()) dots.push({ x: o.st.x, z: o.st.z, color: o.color, label: (o.nick || '?').trim()[0]?.toUpperCase() });
  minimap.draw(dots, []);
}

// ======================= Pętla gry =======================
let last = performance.now(), T = 0, sendAcc = 0, fpsAvg = 16, slowFrames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (S.paused) { last = now; post.composer.render(0.016); return; }
  const dt = clamp((now - last) / 1000, 0.001, 0.05); last = now; T += dt;
  if (S.solo && S.mode === 'countdown') {
    soloCount.t += dt;
    const th = [0.8, 1.6, 2.4, 3.2, 4.0, soloCount.go];
    if (soloCount.step < 6 && soloCount.t >= th[soloCount.step]) { if (soloCount.step === 5) goRace(); else countTick(soloCount.step + 1); soloCount.step++; }
  }
  fpsAvg += (dt * 1000 - fpsAvg) * 0.05;
  if (fpsAvg > 30 && pr > 1) { if (++slowFrames > 90) { pr = Math.max(1, pr - 0.5); slowFrames = 0; resize(); } } else slowFrames = 0;

  readInput();
  const active = S.mode === 'racing' || S.mode === 'finished';
  const racing = active || S.mode === 'countdown';
  if (replay.on) stepReplay(dt);
  else {
    if (me.st && active && !S.spectator) stepMe(dt);
    if (active) { for (const o of oppList()) { if (o.bot) botStep(o, dt); else refreshOpp(o); } }
    else if (racing) for (const o of oppList()) refreshOpp(o);
    if ((S.mode === 'racing' || S.mode === 'finished') && !S.results && !me.finished) recordReplay(now);
    if (active) ghostRecord(dt);
  }
  updateItems(dt);
  ghostPlay();
  if (S.mode === 'racing' || S.mode === 'finished') envT = elapsed(); else if (S.mode === 'countdown') envT = 0;
  envApply(dt); updateEnvFx(dt);

  // wysyłanie stanu
  if (!S.solo && S.room && racing && socket && me.st && !S.spectator) {
    sendAcc += dt;
    if (sendAcc >= 0.033) {
      sendAcc = 0;
      const hostBots = S.room.players[0]?.id === S.you ? oppList().filter((o) => o.bot) : [];
      if (hostBots.length) socket.volatile.emit('race:bots', hostBots.map((o) => [o.id, packState(o.st, o)]));
      socket.volatile.emit('race:state', packState(me.st, me));
    }
  }

  // wizualizacja
  if (me.vis && me.st && !S.spectator) { me.vis.setDamage(me.st.damage || 0); updateSurf(me, dt); syncParts(me); if (!onPodium(me)) me.vis.sync(me.st, dt); if (me.dead <= 0) me.vis.group.visible = me.inv > 0 ? Math.floor(performance.now() / 90) % 2 === 0 : true; }
  for (const o of oppList()) {
    o.vis.setDamage(o.st.damage || 0); updateSurf(o, dt); syncParts(o); o.vis.group.visible = !o.st.dead && !(o.inv > 0 && Math.floor(performance.now() / 90) % 2);
    o.st.accelNow += (((o.st.vf - o.prevVf) / Math.max(dt, 0.001)) - o.st.accelNow) * Math.min(1, dt * 6); o.prevVf = o.st.vf;
    if (!onPodium(o)) o.vis.sync(o.st, dt);
  }
  if (podium.on) for (const c of [me, ...oppList()]) if (c.vis) c.vis.group.visible = onPodium(c);
  if ((racing || S.mode === 'menu' || S.mode === 'lobby') && !podium.on) { if (me.st) carFx(me, 'me', dt); for (const o of oppList()) carFx(o, 'o' + o.id, dt); }
  particles.update(dt, camera, renderer.domElement.height); updateDebris(dt);
  { const f = S.spectator ? spectateTarget()?.st : me.st; if (f) world.setFocus(f.x, f.y, f.z); }
  world.update(T, dt);

  // dźwięk
  if (audioReady()) {
    if (!me.audio) me.audio = new CarAudio(0.85, 0);
    const maxS = me.st?.def.maxSpeed || 82, cornerSlip = (st) => clamp((Math.abs(st.steer) * Math.abs(st.vf) / st.def.maxSpeed - 0.3) / 0.35, 0, 1) * 0.65;
    me.audio.update({ speed: me.st ? me.st.vf / maxS : 0, throttle: racing && !me.finished ? input.throttle : 0, slip: me.st && !me.st.air ? Math.max(clamp((me.st.slip - 3.5) / 7, 0, 1), cornerSlip(me.st), me.st.hand && me.st.speed > 6 ? 0.95 : 0) * (active ? 1 : 0) : 0, brake: racing && !me.finished ? input.brake : 0, nitro: !!me.st?.nitro, sandK: me.sandK || 0, cobK: me.cobK || 0, rough: 0, active: racing && !S.spectator && !podium.on }, dt);
    for (const o of oppList()) {
      if (!o.audio) o.audio = new CarAudio(0.35, 0);
      pv.set(o.st.x, o.st.y, o.st.z).project(camera); o.audio.panner.pan.value = Number.isFinite(pv.x) ? clamp(pv.x, -1, 1) * 0.6 : 0;
      o.audio.volume = 0.38 * clamp(1 - Math.hypot(o.st.x - (me.st?.x ?? 0), o.st.y - (me.st?.y ?? 0), o.st.z - (me.st?.z ?? 0)) / 220, 0.1, 1);
      o.audio.update({ speed: o.st.vf / o.st.def.maxSpeed, throttle: o.st.throttle || 0, slip: o.st.air ? 0 : Math.max(clamp((o.st.slip - 3.5) / 7, 0, 1), cornerSlip(o.st), o.st.hand && Math.abs(o.st.vf) > 6 ? 0.9 : 0), brake: o.st.brakeLit ? 0.9 : 0, nitro: !!o.st.nitro, sandK: o.sandK || 0, cobK: o.cobK || 0, rough: 0, active: racing && !podium.on }, dt);
    }
  }

  updateCamera(dt);
  if (window.__tc?.free) { camera.position.set(...window.__tc.free.p); camera.lookAt(...window.__tc.free.l); } // tylko do testów
  updateHud(); updatePodiumLabels();
  updateBubbles();
  drawMinimap();
  updateTags();
  post.composer.render(dt);
}

// ======================= Start =======================
function bindUi() {
  document.addEventListener('click', (e) => { if (e.target.closest('button')) { if (!audioReady()) initAudio(); sfx.click(); } });
  document.addEventListener('pointerover', (e) => { const b = e.target.closest?.('.car, .btn'); if (b && b !== bindUi.hv) { bindUi.hv = b; sfx.hover(); } });
  $('chat-form').addEventListener('submit', (e) => { e.preventDefault(); const t = $('chat-input').value.trim(); if (t) sendChat(t); closeChat(); });
  $('chat-input').addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== $('chat-input')) closeChat(); }, 100));
  $('profile').addEventListener('click', (e) => { if (e.target === $('profile')) $('profile').classList.add('hidden'); });
  bindPause();
  $('menu-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { showTab(b.dataset.tab); sfx.tick(0.6); } });
  $('btn-custom').addEventListener('click', () => { const b = $('custom-box'); const open = b.classList.toggle('hidden') === false; $('btn-custom').classList.toggle('open', open); sfx.tick(0.6); });
  $('btn-quick').addEventListener('click', () => { initAudio(); quickPlay(); });
  $('btn-rooms').addEventListener('click', openRooms);
  $('rooms-close').addEventListener('click', closeRooms); $('rooms-refresh').addEventListener('click', refreshRooms);
  $('rooms-modal').addEventListener('click', (e) => { if (e.target === $('rooms-modal')) closeRooms(); });
  $('btn-spec-leave').addEventListener('click', goMenu);
  $('btn-spec-join').addEventListener('click', async () => { const id = S.room?.id; if (!id) return; if (socket) socket.emit('room:leave'); S.room = null; S.spectator = false; document.body.classList.remove('spectating'); S.joinCode = id; await joinRoom(false); if (!S.room) goMenu(); });
  $('replay-close').addEventListener('click', () => closeReplay(false));
  $('replay-cam').addEventListener('click', () => { replay.cam = (replay.cam + 1) % 4; $('replay-cam').textContent = ['Kamera: auto', 'Kamera: pościg', 'Kamera: z góry', 'Kamera: z boku'][replay.cam]; });
  $('btn-mute').addEventListener('click', toggleMute);
  refreshMute(); music.setMuted(isMuted());
  const refreshMusic = () => { $('mus-on').classList.toggle('hidden', !music.enabled); $('mus-off').classList.toggle('hidden', music.enabled); };
  $('btn-music').addEventListener('click', () => { music.toggle(); refreshMusic(); });
  $('music-vol').value = Math.round(music.vol * 100);
  $('music-vol').addEventListener('input', (e) => music.setVolume(e.target.value / 100));
  $('music-vol').addEventListener('change', (e) => e.target.blur());
  refreshMusic();
  $('form-nick').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = $('inp-nick').value.replace(/[<>&"'`]/g, '').trim();
    if (n.length < 2) { $('nick-err').textContent = 'Nick musi mieć co najmniej 2 znaki.'; return; }
    S.nick = n.slice(0, 14); store.set('tc_nick', S.nick);
    initAudio(); goMenu();
  });
  $('btn-change-nick').addEventListener('click', () => { $('inp-nick').value = S.nick; showScreen('nick'); $('inp-nick').focus(); });
  $('btn-create').addEventListener('click', createRoom);
  $('btn-join').addEventListener('click', () => joinRoom(false));
  $('btn-solo').addEventListener('click', () => { initAudio(); startSolo(); });
  $('btn-copy').addEventListener('click', async () => {
    const inp = $('lobby-link');
    try { await navigator.clipboard.writeText(inp.value); } catch { inp.select(); document.execCommand('copy'); }
    $('btn-copy').textContent = 'Skopiowano ✓'; setTimeout(() => ($('btn-copy').textContent = 'Kopiuj'), 1600);
  });
  $('lobby-link').addEventListener('focus', (e) => e.target.select());
  $('btn-ready').addEventListener('click', () => { const mine = S.room?.players.find((p) => p.id === S.you); socket?.emit('player:ready', !mine?.ready); });
  $('btn-leave').addEventListener('click', goMenu);
  $('btn-start').addEventListener('click', () => socket?.emit('room:start'));
  $('btn-lobby-custom').addEventListener('click', () => { const b = $('lobby-custom-box'); const open = b.classList.toggle('hidden') === false; $('btn-lobby-custom').classList.toggle('open', open); sfx.tick(0.6); });
  $('btn-menu').addEventListener('click', goMenu);
  $('btn-rematch').addEventListener('click', () => {
    if (S.solo) { startSolo(); return; }
    socket?.emit('player:ready', true);
    $('btn-rematch').disabled = true; $('btn-rematch').textContent = 'Czekam na pozostałych…';
  });
}

(async function boot() {
  renderCarDetail();
  bindUi();
  const code = new URLSearchParams(location.search).get('room');
  if (code && /^[A-Za-z0-9]{4,8}$/.test(code)) {
    S.joinCode = code.toUpperCase(); S.autoJoin = true; // link z zaproszeniem: po wpisaniu nicku od razu dołączamy
    $('join-code').textContent = S.joinCode;
    $('join-banner').classList.remove('hidden');
    $('btn-join').classList.remove('hidden'); $('btn-create').classList.add('hidden');
  }
  resize();
  useTrack(S.trackId);
  setCar(me, 0, S.color);
  requestAnimationFrame(frame);
  $('loading').classList.add('done');
  setTimeout(() => $('loading').remove(), 700);
  if (S.nick) goMenu(); else { showScreen('nick'); $('inp-nick').focus(); }
  window.__tc = { S, me, opps, items, ghost, music, replay, camera, scene, keys, startSolo, finishLocal, post, get track() { return track; }, get world() { return world; } };
})();
