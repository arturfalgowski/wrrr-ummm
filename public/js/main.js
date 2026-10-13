// Wrrr Ummm — sterowanie grą: renderer, kamera izometryczna, pętla gry, UI, multiplayer.
import * as THREE from 'three';
import { Track, TRACK_DEFS, TRACK_IDS, ROAD_HALF, BARRIER } from './track.js';
import { CarState, CAR_DEFS, CAR_COLORS, stripeFor, carVsCar, trackHeightStep } from './physics.js';
import { buildCar } from './car.js';
import { buildWorld } from './world.js';
import { createPost } from './post.js';
import { Particles, SkidMarks } from './fx.js';
import { Items } from './items.js';
import { Minimap } from './minimap.js';
import { ARENA_R, SPAWNS, OBSTACLES, field as arenaField, heightAt, arenaStep, tiltAt, setFlat } from './arena.js';
import { buildArenaWorld } from './arenaworld.js';
import { HX, HZ, GW, GD, BR, TEAM_COLORS, TEAM_NAMES, soccerField, soccerSpawn, soccerStep, makeBall, resetBall, stepBall, smoothBall, soccerBotInput } from './soccer.js';
import { buildSoccerWorld } from './soccerworld.js';
import { Music } from './music.js';
import { initAudio, audioReady, CarAudio, sfx, isMuted, setMuted, setRain, getSfxVolume, setSfxVolume } from './audio.js';

const CAR_IDS = Object.keys(CAR_DEFS);
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
const music = new Music();
const musicReady = music.load();
const musicStart = () => musicReady.then(() => music.playRandom());
const items = new Items(scene, particles);
const minimap = new Minimap(document.getElementById('minimap'));
items._thud = () => sfx.land();

// ======================= Tory (każdy budowany raz, potem tylko przełączany) =======================
const worlds = {};
let track = null, world = null, trackId = null;
const isSoccer = () => trackId === 'soccer';
/** „pole walki” bez toru: arena i boisko piłkarskie (wspólna fizyka płaska/hp/bronie) */
const isArena = () => trackId === 'arena' || trackId === 'soccer';
const fieldOf = (mode) => (mode === 'arena' ? 'arena' : mode === 'soccer' ? 'soccer' : null);
/** podgląd pogody/pory dnia wybranych w ustawieniach (menu: moje, lobby: pokoju); „losowa” = domyślna dla toru */
function previewEnv(id) {
  const src = S.mode === 'lobby' && S.room ? S.room.settings : S;
  return { weather: src.weather && src.weather !== 'auto' ? src.weather : (TRACK_DEFS[id]?.rain ? 'rain' : 'sun'), time: src.time && src.time !== 'auto' ? src.time : 'day' };
}
function useTrack(id) {
  if (id !== 'arena' && id !== 'soccer' && !TRACK_DEFS[id]) id = TRACK_IDS[0];
  if (trackId === id && world) return;
  if (world) world.root.visible = false;
  if (!worlds[id]) worlds[id] = id === 'arena' ? { track: arenaField, world: buildArenaWorld(scene, renderer) } : id === 'soccer' ? { track: soccerField, world: buildSoccerWorld(scene, renderer) } : (() => { const t = new Track(id); return { track: t, world: buildWorld(scene, renderer, t) }; })();
  ({ track, world } = worlds[id]);
  trackId = id;
  setFlat(id === 'soccer');
  items.ground = id === 'arena' || id === 'soccer' ? heightAt : null; particles.ground = items.ground;
  applyEnvironment(previewEnv(id));
  if (id === 'soccer') minimap.setSoccer(HX, HZ, GW, GD); else if (id === 'arena') minimap.setArena(ARENA_R, OBSTACLES); else minimap.setTrack(track);
  world.root.visible = true;
  scene.background = world.sky;
  scene.fog = new THREE.Fog(world.sky, 300, 1500);
  items.clear(); particles.clear(); skids.clear();
  cam.first = true;
}

// ======================= Pogoda i pora dnia =======================
let envNow = { weather: 'sun', time: 'day' };
const envLights = { sunI: 3, hemiI: 1 };
let flash = 0, nextFlash = 8, thunderAt = 0;
const headlights = Array.from({ length: 4 }, () => { const l = new THREE.SpotLight(0xfff0d0, 0, 100, 0.5, 0.7, 1.1); scene.add(l, l.target); return l; });
function resolveEnvLocal(trackId) {
  const weather = S.weather !== 'auto' ? S.weather : TRACK_DEFS[trackId]?.rain ? 'rain' : (() => { const x = Math.random(); return x < 0.6 ? 'sun' : x < 0.88 ? 'rain' : 'storm'; })();
  const time = S.time !== 'auto' ? S.time : (() => { const x = Math.random(); return x < 0.55 ? 'day' : x < 0.8 ? 'dusk' : 'night'; })();
  return { weather, time };
}
function applyEnvironment(env) {
  envNow = TRACK_DEFS[trackId]?.forceTime ? { ...env, time: TRACK_DEFS[trackId].forceTime } : env;
  const e = world?.env; if (!e) return;
  const { weather: wx } = env;
  const t = TRACK_DEFS[trackId]?.forceTime || env.time; // np. Neon Sektor zawsze nocą
  const sky = e.baseSky.clone(), sunC = e.sunBase.color.clone(), hS = e.hemiBase.sky.clone(), hG = e.hemiBase.ground.clone();
  let sunI = e.sunBase.intensity, hemiI = e.hemiBase.intensity, expo = 1.05, envI = 0.42;
  if (t === 'dusk') { sky.lerp(new THREE.Color(0xe0875a), 0.6); sunC.set(0xff8a4a); sunI *= 0.7; hemiI *= 0.8; hS.lerp(new THREE.Color(0xffb48a), 0.4); expo = 1.1; }
  if (t === 'night') { sky.set(world.nightSky ?? 0x0a1226); sunC.set(0x7d93ff); sunI = 0.6; hemiI = 0.32; hS.set(0x3a4a8a); hG.set(0x141824); expo = 1.3; envI = 0.12; }
  if (wx === 'rain') { sky.lerp(new THREE.Color(t === 'night' ? 0x0d141f : 0x7d8791), 0.55); sunI *= 0.45; envI = Math.max(envI, 0.8); }
  if (wx === 'storm') { sky.lerp(new THREE.Color(t === 'night' ? 0x070b12 : 0x454d58), 0.75); sunI *= 0.22; hemiI *= 0.85; envI = Math.max(envI, 0.7); }
  if (t === 'night') envI = 0.14; else if (t === 'dusk') envI *= 0.7;
  e.sun.color.copy(sunC); e.sun.intensity = sunI; e.hemi.color.copy(hS); e.hemi.groundColor.copy(hG); e.hemi.intensity = hemiI;
  envLights.sunI = sunI; envLights.hemiI = hemiI;
  scene.background = sky; scene.fog = new THREE.Fog(sky, 300, 1500);
  renderer.toneMappingExposure = expo; scene.environmentIntensity = envI;
  if (e.nightMesh) e.nightMesh.visible = t === 'night';
  world.setTime?.(t);
  rain.visible = wx !== 'sun';
  rain.material.uniforms.uAmt.value = wx === 'storm' ? 1 : 0.55; rain.material.uniforms.uWind.value = wx === 'storm' ? 2.2 : 0.9;
  if (world.asphaltMat) { const wet = wx !== 'sun'; world.asphaltMat.roughness = wet ? 0.32 : 0.88; world.asphaltMat.metalness = wet ? 0.25 : 0; world.asphaltMat.color.set(wet ? 0xa9abb8 : 0xffffff); }
  if (track && 'gripMul' in track) track.gripMul = wx === 'rain' ? 0.85 : wx === 'storm' ? 0.78 : 1;
  const k = t === 'night' ? 1 : t === 'dusk' ? 0.25 : 0;
  for (const v of visCache.values()) v.setNight(k);
  setRainAudio();
}
/** reflektory aut (4 światła reflektorowe zawsze w scenie — stała liczba, bez rekompilacji shaderów) i błyski burzy */
function updateEnvFx(dt) {
  const night = envNow.time === 'night', dusk = envNow.time === 'dusk';
  const cars = [me, ...oppList()].filter((c) => c.st && c.vis && !c.dead && c.vis.group.visible);
  headlights.forEach((l, i) => {
    const c = cars[i];
    if (!c || !(night || dusk)) { l.intensity = 0; return; }
    const s = c.st, cs = Math.cos(s.yaw), sn = Math.sin(s.yaw), y = (s.y || 0) + 0.9;
    l.position.set(s.x + cs * 2.4, y, s.z + sn * 2.4); l.target.position.set(s.x + cs * 22, y - 0.6, s.z + sn * 22); l.target.updateMatrixWorld();
    l.intensity = night ? 2600 : 700;
  });
  if (envNow.weather === 'storm' && (S.mode === 'racing' || S.mode === 'countdown')) {
    nextFlash -= dt;
    if (nextFlash <= 0) { flash = 1; nextFlash = 6 + Math.random() * 9; thunderAt = performance.now() + 350 + Math.random() * 1400; }
  }
  if (thunderAt && performance.now() > thunderAt) { thunderAt = 0; sfx.thunder(); }
  if (flash > 0) {
    flash = Math.max(0, flash - dt * 2.8);
    const f = flash > 0.55 ? flash : flash > 0.35 ? 0.15 : flash; // podwójny błysk
    world.env.sun.intensity = envLights.sunI + f * 7; world.env.hemi.intensity = envLights.hemiI + f * 2.2;
    $('flash').style.opacity = String(f * 0.42);
  } else if ($('flash').style.opacity !== '0') { $('flash').style.opacity = '0'; world.env.sun.intensity = envLights.sunI; world.env.hemi.intensity = envLights.hemiI; }
}

// ======================= Deszcz =======================
const rain = (() => {
  const n = 5000, pos = new Float32Array(n * 6), end = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const x = Math.random(), y = Math.random(), z = Math.random(); pos.set([x, y, z, x, y, z], i * 6); end[i * 2] = 0; end[i * 2 + 1] = 1; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uAmt: { value: 0.55 }, uWind: { value: 0.9 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(190, 70, 190) } },
    vertexShader: `attribute float aEnd; uniform float uTime; uniform float uAmt; uniform float uWind; uniform vec3 uCenter; uniform vec3 uBox; varying float vA;
      void main() {
        vec3 p = position;
        float sp = 0.9 + fract(p.x * 91.7 + p.z * 37.3) * 0.5;
        p.y = fract(p.y - uTime * 0.55 * sp);
        vec3 w = uCenter + vec3((p.x - 0.5) * uBox.x, p.y * uBox.y, (p.z - 0.5) * uBox.z);
        w += aEnd * vec3(-uWind, 3.2, -0.3 * uWind);
        vA = (0.18 + 0.32 * (1.0 - aEnd)) * step(fract(position.x * 173.1 + position.z * 91.7), uAmt);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: `varying float vA; void main() { gl_FragColor = vec4(0.78, 0.84, 0.95, vA); }`,
  });
  const l = new THREE.LineSegments(g, m); l.frustumCulled = false; l.visible = false; l.renderOrder = 6;
  scene.add(l); return l;
})();
const setRainAudio = () => setRain(envNow.weather !== 'sun' && S.mode !== 'menu');

// ======================= Kamera =======================
const RACE_FOV = 24;
const cam = { pos: new THREE.Vector3(0, 40, 40), look: new THREE.Vector3(), fov: 38, shift: 0.16, tilt: 0.45, first: true, half: 32, focus: new THREE.Vector3() };
const CAM_DIR = (() => { const az = THREE.MathUtils.degToRad(16), el = THREE.MathUtils.degToRad(53); return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)); })();

function resize() {
  const W = window.innerWidth, H = window.innerHeight;
  if (!W || !H) return; // okno ukryte/zminimalizowane — nie psuj proporcji kamery
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
  carPick: CAR_DEFS[store.get('tc_car')] ? store.get('tc_car') : 'random', carId: CAR_DEFS[store.get('tc_car')] ? store.get('tc_car') : CAR_IDS[Math.random() * CAR_IDS.length | 0],
  custom: (() => { const d = { num: 7, pattern: 'stripes', rim: 'star', rimColor: '#d9dde6', plate: true }; try { return { ...d, ...JSON.parse(store.get('tc_custom') || '{}') }; } catch { return d; } })(),
  weather: ['auto', 'sun', 'rain', 'storm'].includes(store.get('tc_weather')) ? store.get('tc_weather') : 'auto', time: ['auto', 'day', 'dusk', 'night'].includes(store.get('tc_time')) ? store.get('tc_time') : 'auto',
  raceBots: Math.min(3, Math.max(0, parseInt(store.get('tc_rbots') || '0', 10) || 0)), tournament: store.get('tc_tour') === '1',
  cam: store.get('tc_cam') === 'chase' ? 'chase' : 'iso', paused: false, pauseStart: 0,
  game: 'race', bots: 3,
  timeLimit: [0, 90, 180, 300, 600].includes(+store.get('tc_stime')) && store.get('tc_stime') != null ? +store.get('tc_stime') : 180, goalLimit: [0, 3, 5, 7, 10].includes(+store.get('tc_sgoal')) && store.get('tc_sgoal') != null ? +store.get('tc_sgoal') : 5, attacks: store.get('tc_sattack') === '1', loadout: store.get('tc_loadout') === 'full' ? 'full' : 'normal',
  color: CAR_COLORS.includes(store.get('tc_color')) ? store.get('tc_color') : '#e0457b',
  trackPick: TRACK_DEFS[store.get('tc_track')] ? store.get('tc_track') : 'random', trackId: TRACK_DEFS[store.get('tc_track')] ? store.get('tc_track') : TRACK_IDS[Math.random() * TRACK_IDS.length | 0], lapsManual: false,
  ghost: store.get('tc_ghost') !== '0', laps: 0, lapsNow: 4, pickups: ['off', 'rare', 'normal', 'often'].includes(store.get('tc_pickups')) ? store.get('tc_pickups') : 'normal',
  mode: 'menu', // menu | lobby | countdown | racing | finished
  solo: false, room: null, you: null, joinCode: null,
  raceStart: 0, results: null, resultSounded: false,
};
const me = { team: 'red', gunCharge: 1, weapon: null, shieldT: 0, specIdx: 0, deadAt: 0, hp: 100, dead: false, respawnT: 0, inv: 0, dmgCd: 0, items: { nitro: 0, oil: 0, ammo: 0, mine: 0 }, fireT: 0, fireAcc: 0, nitroT: 0, tireCd: 0, st: null, vis: null, audio: null, lapIdx: 0, maxP: 0, lapStart: 0, best: Infinity, lapTimes: [], finished: false, finishTime: 0, smokeAcc: 0, hitCd: 0 };
const opps = new Map(); // id gracza -> { id, nick, carId, slot, st, vis, audio, snaps, prevVf, smokeAcc, finished }
const visCache = new Map();
const input = { throttle: 0, brake: 0, steer: 0, hand: false };
const keys = new Set();
let socket = null;
let timers = [];

const GRID = [[-6, -3.6], [-13, 3.6], [-20, -3.6], [-27, 3.6]];
const gridPos = (slot) => GRID[slot] || GRID[0];
const CAR_NUM = [7, 11, 23, 5];
function getVis(carId, slot) {
  const k = `${carId}:${slot}`;
  if (!visCache.has(k)) visCache.set(k, buildCar(carId, CAR_NUM[slot] ?? 7));
  return visCache.get(k);
}
const myRoomPlayer = () => S.room?.players.find((x) => x.id === S.you);
const myNick = () => myRoomPlayer()?.nick ?? S.nick;
function applyCustom(who) {
  if (!who.vis) return;
  const cu = who === me ? (myRoomPlayer()?.custom ?? S.custom) : (who.custom ?? S.custom);
  who.vis.setCustom({ ...cu, nick: who === me ? myNick() : who.nick || '' });
}
const ringGeo = new THREE.RingGeometry(2.9, 3.7, 40);
/** piłka: kolorowy pierścień pod autem w barwach drużyny */
function setTeamRing(who) {
  const v = who.vis; if (!v) return;
  if (!v.teamRing) {
    v.teamRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    v.teamRing.rotation.x = -Math.PI / 2; v.teamRing.position.y = 0.08; v.group.add(v.teamRing);
  }
  v.teamRing.visible = isSoccer() && !!who.team;
  if (who.team) v.teamRing.material.color.set(TEAM_COLORS[who.team]);
}
function setCar(who, carId, slot, color) {
  if (who.vis) scene.remove(who.vis.group);
  if (!carId) { who.vis = null; who.st = null; return; }
  who.vis = getVis(carId, slot);
  applyCustom(who);
  who.color = isSoccer() && who.team ? TEAM_COLORS[who.team] : (color || S.color); who.dead = false; who.vis.group.visible = true; who.vis.setDamage(0); who.vis.setColor(who.color, stripeFor(who.color)); setTeamRing(who);
  who.st = new CarState(CAR_DEFS[carId]);
  if (isSoccer()) placeAtSpawn(who);
  else if (isArena()) {
    const sp = SPAWNS[slot % 4], st = who.st;
    st.x = sp[0]; st.z = sp[1]; st.yaw = sp[2]; st.y = heightAt(st.x, st.z); st.vx = st.vz = st.vf = st.vl = 0; st.air = false; st.vy = 0; st.vyT = 0;
  } else { const [p, lat] = gridPos(slot); who.st.place(track, p, lat); who.st.y = undefined; }
  scene.add(who.vis.group);
  who.vis.sync(who.st, 0);
}
/** kolejność aut w składach (piłka): klucz 'me' / id gracza / 'botN' */
function soccerRoster() {
  if (!S.solo && S.room) return [...S.room.players, ...(S.room.bots || [])].map((p) => ({ key: p.id === S.you ? 'me' : p.id, team: p.team || 'red' }));
  const cnt = { red: 1, blue: 0 }, out = [{ key: 'me', team: 'red' }];
  for (let i = 0; i < S.bots; i++) { const t = cnt.red <= cnt.blue ? 'red' : 'blue'; cnt[t]++; out.push({ key: 'bot' + i, team: t }); }
  return out;
}
function teamIdxOf(who) {
  const key = who === me ? 'me' : who.id, ro = soccerRoster(), at = ro.findIndex((x) => x.key === key);
  return at < 0 ? 0 : ro.filter((x, i) => i < at && x.team === ro[at].team).length;
}
function placeAtSpawn(who) {
  const [x, z, yaw] = soccerSpawn(who.team || 'red', teamIdxOf(who)), st = who.st;
  Object.assign(st, { x, z, yaw, y: 0, vx: 0, vz: 0, vf: 0, vl: 0, steer: 0, air: false, vy: 0, vyT: 0 });
}
/** arena: uderzenie rywala przodem nie rani, rani dopiero trafienie z boku lub z tyłu */
function frontHit(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1;
  return (dx * Math.cos(a.yaw) + dz * Math.sin(a.yaw)) / d > 0.6;
}
function stepCar(st, inp, dt) { if (isSoccer()) soccerStep(st, inp, dt); else if (isArena()) arenaStep(st, inp, dt); else { st.step(track, inp, dt); trackHeightStep(st, track, dt); } }
/** nachylenie auta względem terenu (tylko arena) */
function updateTilt(st) {
  if (!isArena()) { // tor: nachylenie jezdni (mosty, hopki)
    st.tiltX = 0;
    if (st.air) st.tiltZ = clamp(Math.atan2(st.vy || 0, Math.max(8, Math.hypot(st.vx, st.vz))) * 0.7, -0.6, 0.6);
    else st.tiltZ = track.hy && st.idx !== undefined ? Math.atan(track.slopeAt(st.idx)) : 0;
    return;
  }
  if (st.air) { st.tiltX = 0; st.tiltZ = clamp(Math.atan2(st.vy, Math.max(8, Math.hypot(st.vx, st.vz))) * 0.7, -0.6, 0.6); }
  else { const [rx, pz] = tiltAt(st.x, st.z, st.yaw); st.tiltX = rx; st.tiltZ = pz; }
}
function mySlot() { const p = S.room?.players.find((x) => x.id === S.you); return p ? p.slot : 0; }

function clearOpps() {
  for (const o of opps.values()) { if (o.vis) scene.remove(o.vis.group); o.audio?.stop(); }
  opps.clear();
}
/** Synchronizuje rywali z listą graczy w pokoju; force=true ustawia auta od nowa na polach startowych. */
function syncOpps(force = false) {
  const hostMe = S.room?.players[0]?.id === S.you;
  const list = [...(S.room?.players || []).filter((p) => p.id !== S.you), ...(S.room?.bots || [])];
  for (const [id, o] of [...opps]) if (!list.some((p) => p.id === id)) { if (o.vis) scene.remove(o.vis.group); o.audio?.stop(); opps.delete(id); }
  for (const p of list) {
    let o = opps.get(p.id);
    if (!o) { o = { id: p.id, snaps: [], prevVf: 0, smokeAcc: 0, audio: null, vis: null, st: null, finished: false, nitroOn: false }; opps.set(p.id, o); }
    o.nick = p.nick;
    o.custom = p.custom; o.team = p.team || null;
    if (p.bot) { // boty wyścigowe: symuluje je host, pozostali dostają pozycje z serwera
      o.bot = hostMe; o.raceBot = hostMe; o.remoteBot = !hostMe;
      if (!o.ai) Object.assign(o, { skill: 0.9 + Math.random() * 0.06, lat: (Math.random() - 0.5) * 5, finishT: null, ai: { stuck: 0, rev: 0, revSteer: 1 }, hitCd: 0, hp: 100, shieldT: 0, nitroT: 0, weapon: null, fireT: 0, fireAcc: 0 });
    }
    if (force || !o.vis || o.carId !== p.car || o.slot !== p.slot) { o.carId = p.car; o.slot = p.slot; setCar(o, p.car, p.slot, p.color); if (p.bot) o.st.hp = 100; }
    else if (o.vis) applyCustom(o);
    else { const col = isSoccer() && p.team ? TEAM_COLORS[p.team] : p.color; if (o.color !== col) { o.color = col; o.vis.setColor(col, stripeFor(col)); } }
    if (force) { o.snaps = []; o.finishT = null; o.finished = false; }
  }
}
const oppList = () => [...opps.values()].filter((o) => o.st);
function resetRace() {
  const slot = S.solo ? 0 : mySlot();
  const mp = S.solo ? null : S.room?.players.find((x) => x.id === S.you);
  me.team = mp?.team || 'red';
  setCar(me, mp?.car ?? S.carId, slot, mp?.color ?? S.color);
  if (!S.solo && S.room) syncOpps(true); else { clearOpps(); if (S.solo && isSoccer()) spawnSoccerBots(); else if (S.solo && isArena()) spawnBots(); else if (S.solo && S.raceBots > 0) spawnRaceBots(S.raceBots); }
  me.lapIdx = 0; me.maxP = me.st.progress; me.best = Infinity; me.lapTimes = []; me.finished = false; me.finishTime = 0;
  S.results = null; S.resultSounded = false;
  particles.clear(); skids.clear(); resetItems();
  me.best = Infinity; ghostSetup();
  if (!S.solo) $('hud-best').textContent = '';
  $('hud-time').textContent = '0:00.00';
  $('hud-lap').textContent = `1/${S.lapsNow}`;
  $('chip-pos').classList.toggle('hidden', !opps.size || isSoccer());
  resetSoccer();
  $('hud-lap').parentElement.classList.toggle('hidden', isArena());
  $('hud-help').innerHTML = isSoccer() ? '<kbd>W</kbd><kbd>S</kbd> gaz &nbsp; <kbd>A</kbd><kbd>D</kbd> skręt &nbsp; <kbd>Spacja</kbd> drift &nbsp; wbij piłkę do bramki przeciwnika &nbsp; <kbd>Shift</kbd> nitro (ładuje się samo)' + (attacksOn() ? ' &nbsp; <kbd>F</kbd> broń &nbsp; <kbd>R</kbd> karabin' : '') : isArena() ? '<kbd>W</kbd><kbd>S</kbd> gaz &nbsp; <kbd>A</kbd><kbd>D</kbd> skręt &nbsp; <kbd>Spacja</kbd> drift &nbsp; uderzenie przodem nie rani &nbsp; <kbd>F</kbd> broń &nbsp; <kbd>R</kbd> karabin &nbsp; <kbd>Shift</kbd> nitro &nbsp; (pełny zestaw: <kbd>Q</kbd> mina <kbd>E</kbd> olej <kbd>T</kbd> rakieta <kbd>G</kbd> tarcza)' : '<kbd>W</kbd><kbd>S</kbd> gaz / hamulec &nbsp; <kbd>A</kbd><kbd>D</kbd> skręt &nbsp; <kbd>Spacja</kbd> drift &nbsp; <kbd>Shift</kbd> nitro &nbsp; <kbd>F</kbd> strzał &nbsp; <kbd>E</kbd> olej &nbsp; <kbd>Q</kbd> mina';
  $('chip-pos').querySelector('.lbl').textContent = isArena() ? 'Żywi' : 'Pozycja';
}

// ======================= Ekrany =======================
const SCREENS = ['nick', 'menu', 'lobby', 'spec', 'results'];
function showScreen(name) {
  // powtórka odpala się sama przed tabelą wyników; wyniki pojawiają się po jej końcu lub pominięciu
  if (name === 'results') {
    if (replay.on) return;
    if (!replay.done && !S.spectator && replay.buf.length >= 25) { replay.done = true; startReplay(true); return; }
  }
  for (const s of SCREENS) $(`scr-${s}`).classList.toggle('hidden', s !== name);
  const inRace = name === null;
  $('hud').classList.toggle('hidden', !(inRace || name === 'results'));
  updateChatUi();
}
function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms);
}
function setMode(m) { if (replay.on && m === 'finished') { replay.prevMode = m; return; } S.mode = m; updateChatUi(); if (typeof setRainAudio === 'function') setRainAudio(); }

let rankData = { race: [], arena: [] }, rankTab = 'race';
const fmtShort = (t) => (t == null ? '—' : fmt(t));
function renderRanking(data, resultsMode) {
  if (data) rankData = Array.isArray(data) ? { race: data, arena: rankData.arena } : data;
  const fill = (id, list) => {
    const ol = $(id); ol.textContent = '';
    if (!list || !list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Brak wyników — wygraj pierwszy mecz!'; ol.append(li); return; }
    for (const r of list) {
      const li = document.createElement('li');
      if (S.nick && r.nick.toLowerCase() === S.nick.toLowerCase()) li.className = 'me';
      const n = document.createElement('span'); n.textContent = r.nick;
      const w = document.createElement('span'); w.className = 'w'; w.append(`${r.wins}`);
      const sm = document.createElement('small'); sm.textContent = ` / ${r.races}`; w.append(sm);
      li.append(n, w); li.addEventListener('click', () => openProfile(r.nick)); ol.append(li);
    }
  };
  fill('rank-menu', rankData[rankTab]);
  const rm = resultsMode || S.game;
  $('rank-results-title').textContent = `Ranking — ${({ arena: 'Arena', soccer: 'Piłka' })[rm] || 'Wyścig'}`;
  fill('rank-results', rankData[rm]);
}
async function loadRanking() {
  try { renderRanking(await (await fetch('api/ranking?mode=all')).json()); } catch { /* serwer niedostępny */ }
}
async function openProfile(nick) {
  let p; try { p = await (await fetch(`api/profile?nick=${encodeURIComponent(nick)}`)).json(); } catch { return; }
  const card = $('profile-card'); card.textContent = '';
  const nm = document.createElement('div'); nm.className = 'prof-name'; nm.textContent = p.nick; card.append(nm);
  for (const [mode, label] of [['race', 'Wyścigi']]) {
    const st = p[mode], h = document.createElement('h4'); h.textContent = label; card.append(h);
    const g = document.createElement('div'); g.className = 'prof-grid';
    const box = (v, l) => { const d = document.createElement('div'); d.className = 'prof-box'; d.innerHTML = '<b></b><span></span>'; d.firstChild.textContent = v; d.lastChild.textContent = l; g.append(d); };
    if (!st) { const e = document.createElement('div'); e.className = 'muted'; e.textContent = 'Brak rozegranych meczów.'; card.append(e); continue; }
    box(st.wins, 'Zwycięstwa'); box(st.second, 'Drugie miejsca'); box(st.races, 'Mecze');
    box(`${st.races ? Math.round((st.wins / st.races) * 100) : 0}%`, 'Skuteczność'); box(mode === 'race' ? fmtShort(st.best) : '—', mode === 'race' ? 'Najlepszy czas' : 'Tryb walki');
    box(st.last ? new Date(st.last).toLocaleDateString('pl-PL') : '—', 'Ostatnio'); card.append(g);
  }
  const b = document.createElement('button'); b.className = 'btn ghost'; b.style.marginTop = '14px'; b.textContent = 'Zamknij'; b.addEventListener('click', () => $('profile').classList.add('hidden')); card.append(b);
  $('profile').classList.remove('hidden');
}

/** losowanie auta i toru, jeśli gracz niczego nie wybrał (opcja „Losowy”) */
function rollRandoms() {
  if (S.carPick === 'random') S.carId = CAR_IDS[Math.random() * CAR_IDS.length | 0];
  if (S.trackPick === 'random') { S.trackId = TRACK_IDS[Math.random() * TRACK_IDS.length | 0]; if (!S.lapsManual) S.laps = TRACK_DEFS[S.trackId].laps; }
}
function pickCar(id) {
  S.carPick = id; store.set('tc_car', id);
  if (id === 'random') rollRandoms(); else S.carId = id;
  markCar(); if (S.mode === 'menu') setCar(me, S.carId, 0, S.color);
}
const STAT_DEFS = [['Prędkość', '#ff5a5f'], ['Przyspieszenie', '#ffb02e'], ['Prowadzenie', '#3fa9f5']];
function buildCarList() {
  const wrap = $('car-list'); wrap.textContent = '';
  const entries = [...Object.entries(CAR_DEFS), ['random', { name: 'Losowy', tag: 'Losowe auto przy każdym starcie', stats: null }]];
  for (const [id, d] of entries) {
    const b = document.createElement('button'); b.className = 'car' + (id === 'random' ? ' rnd' : ''); b.dataset.id = id;
    b.innerHTML = '<span class="dot"></span><b></b>'; b.querySelector('b').textContent = d.name;
    b.addEventListener('click', () => pickCar(id));
    wrap.append(b);
  }
  markCar();
}
/** opis wybranego auta: nazwa, krótki opis i trzy opisane paski (każdy w swoim kolorze) */
function renderCarDetail(boxId = 'car-detail', pick = S.carPick) {
  const box = $(boxId); if (!box) return;
  const d = pick === 'random' || !CAR_DEFS[pick] ? { name: 'Losowy', tag: 'Losowe auto przy każdym starcie', stats: null } : CAR_DEFS[pick];
  box.textContent = '';
  const head = document.createElement('div'); head.className = 'cd-head'; const nm = document.createElement('b'); nm.textContent = d.name; const tg = document.createElement('small'); tg.textContent = d.tag; head.append(nm, tg); box.append(head);
  const spec = document.createElement('div'); spec.className = 'cd-spec';
  const sp = (l, v) => { const e = document.createElement('div'); e.innerHTML = '<span></span><b></b>'; e.firstChild.textContent = l; e.lastChild.textContent = v; spec.append(e); };
  if (d.maxSpeed) { sp('Prędkość maks.', `${Math.round(d.maxSpeed * 3.8)} km/h`); sp('Z nitro', `${Math.round(d.maxSpeed * 1.45 * 3.8)} km/h`); sp('Wytrzymałość', '100 pkt'); sp('Hamowanie', `${d.brake}`); }
  else { sp('Prędkość maks.', '—'); sp('Wytrzymałość', '100 pkt'); }
  box.append(spec);
  const bars = document.createElement('div'); bars.className = 'cd-bars';
  STAT_DEFS.forEach(([label, color], i) => {
    const row = document.createElement('div'); row.className = 'cd-bar';
    const l = document.createElement('span'); l.textContent = label;
    const tr = document.createElement('div'); const fill = document.createElement('i'); fill.style.width = d.stats ? `${Math.round(d.stats[i] * 100)}%` : '0%'; fill.style.background = color; tr.append(fill);
    const v = document.createElement('em'); v.textContent = d.stats ? String(Math.round(d.stats[i] * 10)) : '?'; v.style.color = color;
    row.append(l, tr, v); bars.append(row);
  });
  box.append(bars);
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
  return (previewCache[id] = `<svg class="prev" viewBox="0 0 ${W} ${H}"><path d="${d}" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`);
}
function buildSettings(wrapId, vals, canEdit, onChange) {
  const w = $(wrapId); w.textContent = '';
  const row = (label) => { const r = document.createElement('div'); r.className = 'set'; const l = document.createElement('span'); l.textContent = label; r.append(l); w.append(r); return r; };
  const stepper = (label, key, min, max) => {
    const r1 = row(label), st = document.createElement('div'); st.className = 'step';
    const mk = (txt, delta) => { const b = document.createElement('button'); b.textContent = txt; b.disabled = !canEdit || (delta < 0 ? vals[key] <= min : vals[key] >= max); b.addEventListener('click', () => onChange({ [key]: vals[key] + delta })); return b; };
    const n = document.createElement('b'); n.textContent = vals[key]; st.append(mk('−', -1), n, mk('+', 1)); r1.append(st);
  };
  if (vals.laps !== undefined) stepper('Okrążenia', 'laps', 1, 10);
  if (vals.bots !== undefined) stepper(vals.timeLimit !== undefined ? 'Boty w meczu solo (3 = 2 na 2)' : 'Boty przeciwników (solo)', 'bots', 1, 3);
  if (vals.raceBots !== undefined) stepper(vals.timeLimit !== undefined ? 'Boty w drużynach' : 'Boty w wyścigu', 'raceBots', 0, 3);
  const segRow = (label, key, opts) => { const r = row(label), sg = document.createElement('div'); sg.className = 'seg'; for (const [v, t] of opts) { const b = document.createElement('button'); b.textContent = t; b.disabled = !canEdit; b.classList.toggle('sel', vals[key] === v); b.addEventListener('click', () => onChange({ [key]: v })); sg.append(b); } r.append(sg); };
  if (vals.timeLimit !== undefined) segRow('Limit czasu', 'timeLimit', [[0, 'Brak'], [90, '1:30'], [180, '3 min'], [300, '5 min'], [600, '10 min']]);
  if (vals.goalLimit !== undefined) segRow('Limit goli (wygrywa pierwszy)', 'goalLimit', [[0, 'Brak'], [3, '3'], [5, '5'], [7, '7'], [10, '10']]);
  if (vals.attacks !== undefined) segRow('Ataki (strzały, bomby, rakiety, nitro)', 'attacks', [[false, 'Wył.'], [true, 'Wł.']]);
  if (vals.tournament !== undefined) segRow('Turniej (3 wyścigi, punkty 10-6-4-2)', 'tournament', [[false, 'Wył.'], [true, 'Wł.']]);
  if (vals.public !== undefined) segRow('Pokój publiczny (lista pokoi)', 'public', [[true, 'Tak'], [false, 'Nie']]);
  if (vals.weather !== undefined) {
    const mk = (label, key, opts) => { const r = row(label), sg = document.createElement('div'); sg.className = 'seg'; for (const [v, t] of opts) { const b = document.createElement('button'); b.textContent = t; b.disabled = !canEdit; b.classList.toggle('sel', vals[key] === v); b.addEventListener('click', () => onChange({ [key]: v })); sg.append(b); } r.append(sg); };
    mk('Pogoda', 'weather', [['auto', 'Losowo'], ['sun', 'Słońce'], ['rain', 'Deszcz'], ['storm', 'Burza']]);
    mk('Pora dnia', 'time', [['auto', 'Losowo'], ['day', 'Dzień'], ['dusk', 'Zmierzch'], ['night', 'Noc']]);
  }
  if (vals.loadout !== undefined && vals.attacks !== false) {
    const rl = row('Start z wyposażeniem'), sgl = document.createElement('div'); sgl.className = 'seg';
    for (const [v, t] of [['normal', 'Standardowy'], ['full', 'Pełny']]) {
      const b = document.createElement('button'); b.textContent = t; b.disabled = !canEdit; b.classList.toggle('sel', vals.loadout === v); b.addEventListener('click', () => onChange({ loadout: v })); sgl.append(b);
    }
    rl.append(sgl);
  }
  if (vals.attacks !== false) {
  const r2 = row('Paczki');
  const sg = document.createElement('div'); sg.className = 'seg';
  for (const [v, t] of [['off', 'Brak'], ['rare', 'Rzadko'], ['normal', 'Normalnie'], ['often', 'Często']]) {
    const b = document.createElement('button'); b.textContent = t; b.disabled = !canEdit; b.classList.toggle('sel', vals.pickups === v);
    b.addEventListener('click', () => onChange({ pickups: v })); sg.append(b);
  }
  r2.append(sg);
  }
  if (vals.ghost !== undefined) {
    const r3 = row('Duch rekordu (trening solo)');
    const sg3 = document.createElement('div'); sg3.className = 'seg';
    for (const [v, t] of [[false, 'Wył.'], [true, 'Wł.']]) {
      const b = document.createElement('button'); b.textContent = t; b.classList.toggle('sel', vals.ghost === v); b.addEventListener('click', () => onChange({ ghost: v })); sg3.append(b);
    }
    r3.append(sg3);
  }
}
function renderMenuSettings() {
  const arena = S.game === 'arena', soccer = S.game === 'soccer';
  buildSettings('menu-settings', soccer ? { bots: S.bots, timeLimit: S.timeLimit, goalLimit: S.goalLimit, attacks: S.attacks, pickups: S.pickups, loadout: S.loadout, weather: S.weather, time: S.time } : arena ? { bots: S.bots, pickups: S.pickups, loadout: S.loadout, weather: S.weather, time: S.time } : { laps: S.laps, pickups: S.pickups, loadout: S.loadout, weather: S.weather, time: S.time, tournament: S.tournament, raceBots: S.raceBots, ghost: S.ghost }, true, (c) => {
    if (c.raceBots != null) { S.raceBots = c.raceBots; store.set('tc_rbots', String(c.raceBots)); }
    if (c.timeLimit != null) { S.timeLimit = c.timeLimit; store.set('tc_stime', String(c.timeLimit)); }
    if (c.goalLimit != null) { S.goalLimit = c.goalLimit; store.set('tc_sgoal', String(c.goalLimit)); }
    if (c.attacks !== undefined) { S.attacks = c.attacks; store.set('tc_sattack', c.attacks ? '1' : '0'); }
    if (c.tournament !== undefined) { S.tournament = c.tournament; store.set('tc_tour', c.tournament ? '1' : '0'); S.tour = null; }
    if (c.weather) { S.weather = c.weather; store.set('tc_weather', c.weather); }
    if (c.time) { S.time = c.time; store.set('tc_time', c.time); }
    if ((c.weather || c.time) && S.mode === 'menu') applyEnvironment(previewEnv(trackId));
    if (c.loadout) { S.loadout = c.loadout; store.set('tc_loadout', c.loadout); }
    if (c.laps != null) { S.laps = c.laps; S.lapsManual = true; }
    if (c.bots != null) S.bots = c.bots;
    if (c.ghost != null) { S.ghost = c.ghost; store.set('tc_ghost', c.ghost ? '1' : '0'); }
    if (c.pickups) { S.pickups = c.pickups; store.set('tc_pickups', c.pickups); }
    renderMenuSettings();
  });
}
const THEME_SW = { miasto: ['#585b66', '#8c8d98'], cyber: ['#1a142e', '#2b2150'], lato: ['#5f9c49', '#a1694a'], pustynia: ['#d9b878', '#a9764f'], zima: ['#e8eef6', '#8d96a6'], jesien: ['#96723a', '#94704a'], wyspa: ['#4ac07a', '#e4d29a'] };
function buildTrackList(wrapId, selected, onPick, canPick, withRandom = false) {
  const wrap = $(wrapId); wrap.textContent = '';
  if (withRandom) {
    const rb = document.createElement('button'); rb.className = 'track rnd' + (selected === 'random' ? ' sel' : ''); rb.disabled = !canPick;
    rb.innerHTML = '<div class="pv">?</div><b>Losowy tor</b><small>Losowanie przy każdym starcie</small>'; rb.addEventListener('click', () => onPick('random')); wrap.append(rb);
  }
  for (const id of TRACK_IDS) {
    const d = TRACK_DEFS[id]; const b = document.createElement('button'); b.className = 'track' + (id === selected ? ' sel' : '');
    const sw = THEME_SW[d.theme];
    b.disabled = !canPick;
    b.innerHTML = `<div class="pv">${trackPreview(id)}</div><b></b><small></small>`;
    b.querySelector('b').textContent = d.name; b.querySelector('small').textContent = d.tag;
    b.addEventListener('click', () => onPick(id));
    wrap.append(b);
  }
}
function pickMenuTrack(id) {
  S.trackPick = id; store.set('tc_track', id); S.lapsManual = false;
  if (id === 'random') rollRandoms(); else { S.trackId = id; S.laps = TRACK_DEFS[id].laps; }
  renderMenuSettings();
  buildTrackList('track-list', id, pickMenuTrack, true, true);
  if (S.mode === 'menu') { toast('Ładowanie toru…', 800); setTimeout(() => { useTrack(fieldOf(S.game) || S.trackId); setCar(me, S.carId, 0, S.color); }, 30); }
}
function swatches(wrapId, selected, taken, onPick) {
  const w = $(wrapId); w.textContent = '';
  for (const c of CAR_COLORS) {
    const b = document.createElement('button'); b.className = 'swatch' + (c === selected ? ' sel' : '') + (taken.has(c) ? ' taken' : '');
    b.style.background = c; b.disabled = taken.has(c); b.title = taken.has(c) ? 'Kolor zajęty przez innego gracza' : '';
    b.setAttribute('aria-label', c);
    b.addEventListener('click', () => onPick(c)); w.append(b);
  }
}
const RIM_COLORS = ['#d9dde6', ...CAR_COLORS];
function buildCustomUi(wrapId, cu, onChange) {
  const w = $(wrapId); w.textContent = '';
  const row = (label) => { const r = document.createElement('div'); r.className = 'set'; const l = document.createElement('span'); l.textContent = label; r.append(l); w.append(r); return r; };
  const r1 = row('Numer startowy'); const inp = document.createElement('input'); inp.type = 'number'; inp.min = 1; inp.max = 99; inp.value = cu.num; inp.className = 'numinp';
  inp.addEventListener('change', () => { const v = Math.max(1, Math.min(99, parseInt(inp.value, 10) || 1)); inp.value = v; onChange({ num: v }); }); r1.append(inp);
  const seg = (label, key, opts) => {
    const r = row(label), sg = document.createElement('div'); sg.className = 'seg';
    for (const [v, t] of opts) { const b = document.createElement('button'); b.textContent = t; b.classList.toggle('sel', cu[key] === v); b.addEventListener('click', () => onChange({ [key]: v })); sg.append(b); }
    r.append(sg);
  };
  seg('Wzór lakieru', 'pattern', [['none', 'Brak'], ['stripes', 'Pasy'], ['flames', 'Płomienie'], ['checker', 'Szachownica']]);
  seg('Felgi', 'rim', [['star', 'Gwiazda'], ['mesh', 'Siatka'], ['solid', 'Pełne'], ['turbine', 'Turbina']]);
  const rc = document.createElement('div'); rc.className = 'swatches small'; rc.id = wrapId + '-rimc';
  for (const c of RIM_COLORS) { const b = document.createElement('button'); b.className = 'swatch' + (c === cu.rimColor ? ' sel' : ''); b.style.background = c; b.setAttribute('aria-label', c); b.addEventListener('click', () => onChange({ rimColor: c })); rc.append(b); }
  const r4 = row('Kolor felg'); r4.append(rc);
  seg('Tablica z nickiem', 'plate', [[false, 'Wył.'], [true, 'Wł.']]);
}
function buildMenuCustom() {
  buildCustomUi('menu-custom', S.custom, (c) => {
    S.custom = { ...S.custom, ...c }; store.set('tc_custom', JSON.stringify(S.custom));
    if (S.mode === 'menu') applyCustom(me);
    buildMenuCustom();
  });
}
function buildMenuColors() {
  swatches('menu-colors', S.color, new Set(), (c) => {
    S.color = c; store.set('tc_color', c); buildMenuColors(); markCar();
    if (S.mode === 'menu' && me.vis) { me.color = c; me.vis.setColor(c, stripeFor(c)); }
  });
}
function buildTeamPicker(r, mine) {
  $('lobby-team-section').classList.toggle('hidden', r.mode !== 'soccer');
  const w = $('lobby-team'); w.textContent = '';
  if (r.mode !== 'soccer') return;
  for (const t of ['red', 'blue']) {
    const n = r.players.filter((p) => p.team === t).length;
    const b = document.createElement('button'); b.textContent = `${TEAM_NAMES[t]} (${n}/2)`; b.classList.toggle('sel', mine?.team === t);
    b.style.borderBottom = `3px solid ${TEAM_COLORS[t]}`; b.disabled = n >= 2 && mine?.team !== t;
    b.addEventListener('click', () => socket?.emit('player:team', t)); w.append(b);
  }
}
function buildLobbyPickers(r, mine) {
  const w = $('lobby-cars'); w.textContent = '';
  for (const [id, d] of Object.entries(CAR_DEFS)) {
    const b = document.createElement('button'); b.className = 'car' + (mine?.car === id ? ' sel' : ''); b.dataset.id = id;
    b.innerHTML = '<span class="dot"></span><b></b>'; b.querySelector('b').textContent = d.name; b.querySelector('.dot').style.background = mine?.color || S.color;
    b.addEventListener('click', () => { S.carId = id; S.carPick = id; store.set('tc_car', id); socket?.emit('player:car', id); }); w.append(b);
  }
  renderCarDetail('lobby-cardetail', mine?.car);
  const taken = new Set(r.players.filter((p) => p.id !== S.you).map((p) => p.color));
  swatches('lobby-colors', mine?.color, taken, (c) => { S.color = c; store.set('tc_color', c); socket?.emit('player:color', c); });
  if (mine && !($('lobby-custom').contains(document.activeElement))) buildCustomUi('lobby-custom', mine.custom || S.custom, (c) => { S.custom = { ...S.custom, ...c }; store.set('tc_custom', JSON.stringify(S.custom)); socket?.emit('player:custom', S.custom); });
}
const MODE_ICONS = {
  race: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h13l-2.5 4L18 12H5"/></svg>',
  arena: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
  soccer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8l3.5 2.5-1.3 4h-4.4l-1.3-4z"/><path d="M12 8V3M15.5 10.5l4.5-1.5M14.2 14.5l2.8 3.7M9.8 14.5L7 18.2M8.5 10.5L4 9"/></svg>',
};
function modeButtons(wrapId, current, canPick, onPick) {
  const w = $(wrapId); w.textContent = '';
  for (const [id, name, sub] of [['race', 'Wyścig', 'ściganie się na torze'], ['arena', 'Arena', 'walka do ostatniego żywego'], ['soccer', 'Piłka', 'mecz drużynowy autami']]) {
    const b = document.createElement('button'); b.classList.toggle('sel', current === id); b.disabled = !canPick && current !== id;
    const ic = wrapId === 'mode-list' || wrapId === 'lobby-mode';
    b.innerHTML = (ic ? `<span class="ic">${MODE_ICONS[id]}</span>` : '') + '<span class="nm"></span><small></small>'; b.querySelector('.nm').textContent = name; b.querySelector('small').textContent = sub;
    b.addEventListener('click', () => onPick(id)); w.append(b);
  }
}
function applyModeUi() {
  const field = S.game !== 'race';
  $('tab-btn-track').classList.toggle('hidden', field);
  if (field && menuTab === 'track') showTab('car');
  modeButtons('mode-list', S.game, true, pickMenuMode);
  renderMenuSettings();
  $('btn-solo').textContent = S.game === 'arena' ? 'Arena solo z botami' : S.game === 'soccer' ? 'Piłka solo z botami' : 'Trening solo';
  $('btn-create').textContent = S.game === 'arena' ? 'Stwórz arenę' : S.game === 'soccer' ? 'Stwórz mecz' : 'Stwórz wyścig';
}
let menuTab = 'car';
function showTab(name) {
  menuTab = name;
  document.querySelectorAll('#menu-tabs button').forEach((b) => b.classList.toggle('sel', b.dataset.tab === name));
  for (const n of ['car', 'track']) $('pane-' + n).classList.toggle('hidden', n !== name);
}
function pickMenuMode(g) {
  S.game = g; store.set('tc_game', g); applyModeUi();
  if (S.mode === 'menu') { toast('Ładowanie…', 800); setTimeout(() => { useTrack(fieldOf(g) || S.trackId); setCar(me, S.carId, 0, S.color); }, 30); }
}
function markCar() { renderCarDetail(); document.querySelectorAll('.car').forEach((b) => { b.classList.toggle('sel', b.dataset.id === S.carPick); const d = b.querySelector('.dot'); if (d) d.style.background = S.color; }); }

function goMenu() {
  clearTimers(); S.spectator = false; document.body.classList.remove('spectating'); closeReplay(true);
  if (socket && S.room) socket.emit('room:leave');
  S.room = null; S.solo = false; S.you = null;
  setMode('menu');
  $('menu-nick').textContent = S.nick;
  $('menu-err').textContent = '';
  useTrack(fieldOf(S.game) || S.trackId);
  if (!S.laps) S.laps = TRACK_DEFS[S.trackId].laps;
  applyModeUi();
  buildTrackList('track-list', S.trackPick, pickMenuTrack, true, true);
  me.team = 'red'; clearOpps(); setCar(me, S.carId, 0, S.color); ghostClear(); buildMenuColors(); buildMenuCustom();
  me.finished = false; resetItems();
  particles.clear(); skids.clear();
  applyEnvironment(previewEnv(trackId));
  showScreen('menu');
  clearChat();
  loadRanking();
  musicStart();
  if (S.autoJoin && S.joinCode) { S.autoJoin = false; joinRoom(false); }
}

let lobbyEnvKey = '';
const WX_L = { auto: 'losowa', sun: 'słonecznie', rain: 'deszcz', storm: 'burza' }, TM_L = { auto: 'losowa', day: 'dzień', dusk: 'zmierzch', night: 'noc' }, PK_L = { off: 'brak', rare: 'rzadko', normal: 'normalnie', often: 'często' };
/** karta „Co jest grane”: tryb, trasa i ustawienia pokoju (widoczne dla wszystkich) */
function renderLobbyInfo(r, isHost) {
  const box = $('lobby-info'); box.textContent = '';
  const st = r.settings, row = (k, v) => { const e = document.createElement('div'); e.className = 'l2-row'; e.innerHTML = '<span></span><b></b>'; e.firstChild.textContent = k; e.lastChild.textContent = v; box.append(e); };
  const desc = { race: 'Ściganie się na torze — wygrywa pierwszy na mecie.', arena: 'Walka do ostatniego żywego. Uderzenie przodem nie rani.', soccer: 'Mecz drużynowy autami — wbij piłkę do bramki przeciwnika.' }[r.mode];
  const head = document.createElement('div'); head.className = 'l2-desc'; head.textContent = desc; box.append(head);
  row('Tryb', { race: 'Wyścig', arena: 'Arena', soccer: 'Piłka' }[r.mode]);
  row('Gospodarz', r.players[0]?.nick || '—');
  if (r.mode === 'race') {
    const t = TRACK_DEFS[r.track]; row('Tor', t ? `${t.name}` : r.track); if (t) row('O torze', t.tag);
    row('Okrążenia', String(st.laps)); if (st.tournament) row('Turniej', '3 wyścigi, punkty 10-6-4-2');
  }
  if (r.mode === 'soccer') { row('Czas', st.timeLimit ? fmtClock(st.timeLimit) : 'bez limitu'); row('Do goli', st.goalLimit ? String(st.goalLimit) : 'bez limitu'); row('Ataki', st.attacks ? 'włączone' : 'wyłączone'); }
  if (st.bots) row('Boty', String(st.bots));
  if (r.mode !== 'soccer' || st.attacks) { row('Paczki', PK_L[st.pickups] || st.pickups); row('Start', st.loadout === 'full' ? 'pełne wyposażenie' : 'standardowy'); }
  row('Pogoda', WX_L[st.weather] || st.weather); row('Pora dnia', TM_L[st.time] || st.time);
}
function renderLobby() {
  const r = S.room; if (!r) return;
  $('lobby-code').textContent = r.id;
  $('lobby-title').textContent = r.mode === 'arena' ? 'Arena' : r.mode === 'soccer' ? 'Piłka' : 'Wyścig';
  $('lobby-link').value = `${location.origin}${location.pathname}?room=${r.id}`;
  const nb = r.bots?.length || 0, two = r.players.length + nb >= 2, full = r.players.length >= 4;
  $('copyrow').classList.toggle('hidden', full);
  $('lobby-hint').textContent = `${r.players.length}/4${nb ? ` + ${nb} bot.` : ''}`;
  void (two ? `W pokoju: ${r.players.length}/4${nb ? ` + ${nb} bot.` : ''}. Gdy wszyscy klikną „Gotowy”, ruszy odliczanie. ` : 'Potrzebny co najmniej jeden rywal. ');
  const box = $('lobby-players'); box.textContent = '';
  for (let s = 0; s < 4; s++) {
    const p = r.players.find((x) => x.slot === s), bt = !p && r.bots?.find((x) => x.slot === s);
    const row = document.createElement('div'); row.className = 'player' + (p || bt ? '' : ' empty');
    if (bt) {
      row.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="st"></span>';
      row.querySelector('.dot').style.background = r.mode === 'soccer' ? TEAM_COLORS[bt.team] : bt.color; const nm = row.querySelector('.nm'); nm.append(bt.nick); const sm = document.createElement('small'); sm.textContent = 'Bot · ' + CAR_DEFS[bt.car].name; nm.append(sm);
      const st = row.querySelector('.st'); st.textContent = 'Bot'; st.classList.add('ok');
    } else if (p) {
      const d = CAR_DEFS[p.car];
      row.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="st"></span>';
      row.querySelector('.dot').style.background = r.mode === 'soccer' ? TEAM_COLORS[p.team] : p.color;
      const nm = row.querySelector('.nm'); nm.append(p.nick + (p.id === S.you ? ' (Ty)' : ''));
      const sm = document.createElement('small'); sm.textContent = d.name; nm.append(sm);
      const st = row.querySelector('.st'); st.textContent = p.ready ? 'Gotowy' : 'Czeka'; st.classList.toggle('ok', p.ready);
    } else {
      row.innerHTML = '<span class="dot"></span><span class="nm">Wolne miejsce…</span>';
    }
    box.append(row);
  }
  const mine = r.players.find((x) => x.id === S.you);
  const isHost = mine?.slot === 0;
  if (mine) me.team = mine.team || 'red';
  buildTeamPicker(r, mine);
  buildTrackList('lobby-tracks', r.track, (id) => socket?.emit('room:track', id), isHost);
  { const st = r.settings, vals = r.mode === 'soccer' ? { timeLimit: st.timeLimit, goalLimit: st.goalLimit, attacks: st.attacks, pickups: st.pickups, loadout: st.loadout, weather: st.weather, time: st.time, raceBots: st.bots, public: st.public } : r.mode === 'arena' ? { pickups: st.pickups, loadout: st.loadout, weather: st.weather, time: st.time, public: st.public }
      : { laps: st.laps, pickups: st.pickups, loadout: st.loadout, weather: st.weather, time: st.time, tournament: st.tournament, raceBots: st.bots, public: st.public };
    buildSettings('lobby-settings', vals, isHost, (c) => { if (c.raceBots !== undefined) { c.bots = c.raceBots; delete c.raceBots; } socket?.emit('room:settings', c); }); }
  $('track-note').textContent = isHost ? '— możesz zmieniać w każdej chwili' : '— zmienia gospodarz';
  renderLobbyInfo(r, isHost);
  { const key = `${r.settings.weather}|${r.settings.time}|${fieldOf(r.mode) || r.track}`; if (S.mode === 'lobby' && lobbyEnvKey !== key) { lobbyEnvKey = key; applyEnvironment(previewEnv(fieldOf(r.mode) || r.track)); } }
  const wantTrack = fieldOf(r.mode) || r.track;
  const trackChanged = wantTrack !== trackId;
  if (trackChanged) { useTrack(wantTrack); me.carIdShown = null; }
  modeButtons('lobby-mode', r.mode, isHost, (m) => socket?.emit('room:mode', m));
  $('lobby-track-section').classList.toggle('hidden', !!fieldOf(r.mode));
  const btn = $('btn-ready'), st = $('btn-start');
  const goLabel = r.mode === 'arena' ? 'Rozpocznij walkę' : r.mode === 'soccer' ? 'Rozpocznij mecz' : 'Rozpocznij wyścig';
  st.classList.toggle('hidden', !isHost); btn.classList.toggle('hidden', isHost);
  st.disabled = !two; st.textContent = two ? goLabel : 'Czekam na rywala…';
  btn.classList.toggle('on', !!mine?.ready);
  btn.textContent = mine?.ready ? 'Gotowy ✓' : 'Gotowy';
  $('lobby-err').textContent = isHost ? '' : 'Gospodarz rozpocznie grę, gdy będziecie gotowi.';
  // auta w tle (showroom)
  const slot = mySlot();
  if (!me.vis || me.carIdShown !== mine?.car || me.slotShown !== slot) { setCar(me, mine?.car || S.carId, slot, mine?.color); me.carIdShown = mine?.car; me.slotShown = slot; }
  else if (mine && me.color !== (isSoccer() ? TEAM_COLORS[mine.team] : mine.color)) { me.color = isSoccer() ? TEAM_COLORS[mine.team] : mine.color; me.vis.setColor(me.color, stripeFor(me.color)); }
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
    else if (S.mode !== 'menu') for (const [id, o] of [...opps]) if (!room.players.some((p) => p.id === id)) { if (o.vis) scene.remove(o.vis.group); o.audio?.stop(); opps.delete(id); }
    if (room.players.length > had && had) sfx.join();
    if (S.mode === 'finished' && S.results) updateResultsButtons();
  });
  socket.on('room:closed', () => { toast('Pokój został zamknięty', 2500); goMenu(); });
  socket.on('room:left', ({ nick }) => { toast(`${nick} opuścił wyścig`, 3000); });
  socket.on('race:prepare', (room) => {
    S.room = room; S.solo = false;
    startPrepare();
    if (S.spectator) { markSpectator(); updateSpecUi(); }
  });
  socket.on('race:count', (n) => countTick(String(n)));
  socket.on('race:go', () => goRace());
  socket.on('race:opp', (id, a) => { const o = opps.get(id); if (!o || !Array.isArray(a) || a.length < 13) return; o.snaps.push({ t: performance.now(), a }); if (o.snaps.length > 40) o.snaps.shift(); });
  socket.on('race:end', (data) => { S.results = data; if (S.mode === 'racing' || S.mode === 'finished' || S.mode === 'countdown') { setMode('finished'); showResultsMP(); } });
  socket.on('ranking', (data) => renderRanking(data));
  socket.on('race:final', (f) => { if (!S.results) return; S.results.final = f.order; S.results.tournament = f.tournament; S.results.finalReady = true; if (S.mode === 'finished') showResultsMP(); });
  socket.on('race:bots', (list) => { for (const [id, a] of list) { const o = opps.get(id); if (!o || !Array.isArray(a) || a.length < 13) continue; o.snaps.push({ t: performance.now(), a }); if (o.snaps.length > 40) o.snaps.shift(); } });
  socket.on('soccer:ball', (a) => { if (!isSoccer() || !Array.isArray(a) || a.length !== 6) return; [ball.x, ball.y, ball.z, ball.vx, ball.vy, ball.vz] = a; });
  socket.on('soccer:score', (m) => soccerScoreMsg(m));
  socket.on('soccer:time', ({ left }) => { if (Number.isFinite(left)) soc.left = left; });
  socket.on('soccer:kickoff', () => soccerKickoff());
  socket.on('chat', (m) => { chatAdd(m); if (m.sys) { if (S.mode === 'finished') toast(m.text, 2200); } else showBubble(m.from, m.text); });
  socket.on('pickup:spawn', (p) => { if (S.mode === 'racing' || S.mode === 'countdown') spawnCrate(p.id, p.type, p.u, p.l, p.x, p.z); });
  socket.on('pickup:remove', ({ id }) => items.remove(id, false));
  socket.on('pickup:taken', ({ id, by, type }) => { items.remove(id); if (by === S.you) applyPickup(type); });
  socket.on('game:event', (e) => onGameEvent(e));
  return socket;
}
const emitAck = (ev, data) => new Promise((res) => socket.timeout(5000).emit(ev, data, (err, r) => res(err ? { ok: false, error: 'Serwer nie odpowiada.' } : r)));

async function createRoom() {
  if (!connect()) return;
  rollRandoms();
  const r = await emitAck('room:create', { nick: S.nick, car: S.carId, track: S.trackId, settings: { laps: S.laps, pickups: S.pickups, loadout: S.loadout, weather: S.weather, time: S.time, tournament: S.tournament, bots: S.raceBots, public: true, timeLimit: S.timeLimit, goalLimit: S.goalLimit, attacks: S.attacks }, color: S.color, custom: S.custom, mode: S.game });
  if (!r.ok) { $('menu-err').textContent = r.error; return; }
  S.room = r.room; S.you = r.you; S.solo = false;
  enterLobby();
}
async function joinRoom(spectate = false) {
  if (!connect()) return;
  rollRandoms();
  const r = await emitAck('room:join', { id: S.joinCode, nick: S.nick, car: S.carId, color: S.color, custom: S.custom, spectate: !!spectate });
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
    const bt = document.createElement('b'); bt.textContent = `${r.host} — ${r.mode === 'arena' ? 'Arena' : r.mode === 'soccer' ? 'Piłka' : `Wyścig · ${TRACK_DEFS[r.track]?.name ?? r.track}`}`;
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
  const want = S.game;
  const room = list.find((r) => r.joinable && r.mode === want && r.state === 'lobby');
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
    row.querySelector('.dot').style.background = p.color; const nm = row.querySelector('.nm'); nm.append(p.nick); const sm = document.createElement('small'); sm.textContent = CAR_DEFS[p.car]?.name || ''; nm.append(sm);
    const st = row.querySelector('.st'); st.textContent = p.bot ? 'Bot' : p.ready ? 'Gotowy' : 'Czeka'; st.classList.toggle('ok', p.bot || p.ready); box.append(row);
  }
  const wantTrack = fieldOf(r.mode) || r.track;
  if (wantTrack !== trackId) useTrack(wantTrack);
  $('btn-spec-join').classList.toggle('hidden', !(r.state === 'lobby' || r.state === 'finished') || r.players.length >= 4);
  syncOpps(false);
}
function markSpectator() {
  me.dead = true; me.respawnT = Infinity; me.specIdx = 0;
  if (me.vis) me.vis.group.visible = false;
  document.body.classList.add('spectating');
}
function enterSpectator() {
  document.body.classList.add('spectating');
  const r = S.room;
  if (r.state === 'racing' || r.state === 'countdown') {
    startPrepare(); markSpectator(); setMode('racing'); S.raceStart = performance.now(); me.lapStart = S.raceStart;
  } else {
    setMode('lobby'); me.carIdShown = null; clearOpps(); renderSpec(); showScreen('spec');
  }
  updateSpecUi();
}
function updateSpecUi() { $('spec-banner').classList.toggle('hidden', !(S.spectator && S.mode !== 'menu' && S.mode !== 'lobby')); }
function enterLobby() {
  setMode('lobby'); lobbyEnvKey = '';
  me.carIdShown = null; clearOpps();
  renderLobby();
  showScreen('lobby');
  $('lobby-err').textContent = '';
  sfx.join();
}

// ======================= Przebieg wyścigu =======================
function clearTimers() { timers.forEach(clearTimeout); timers = []; }
function startPrepare() {
  clearTimers();
  musicStart(); replay.buf = []; replay.done = false; closeReplay(true);
  const trackIdNow = S.solo ? (fieldOf(S.game) || S.trackId) : (fieldOf(S.room.mode) || S.room.track);
  useTrack(trackIdNow);
  applyEnvironment(S.solo ? resolveEnvLocal(trackIdNow) : (S.room.env || { weather: 'sun', time: 'day' }));
  S.lapsNow = S.solo ? S.laps : S.room.settings.laps;
  resetRace();
  setMode('countdown');
  showScreen(null);
  $('hud-help').classList.remove('fade');
  timers.push(setTimeout(() => $('hud-help').classList.add('fade'), 9000));
  $('countdown').textContent = '';
}
function startSolo() {
  S.solo = true; S.room = null; rollRandoms();
  startPrepare();
  soloCount.t = 0; soloCount.step = 0; // odliczanie liczone w pętli klatek (zatrzymuje się z pauzą)
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
  const fl = Math.floor(me.maxP / N);
  if (fl >= 0 && fl > ghost.floor) ghostCross(fl);
  const lapIdx = fl;
  if (lapIdx > me.lapIdx) {
    me.lapIdx = lapIdx;
    const now = performance.now();
    const lt = (now - me.lapStart) / 1000; me.lapStart = now;
    me.lapTimes.push(lt);
    const isBest = lt < me.best; me.best = Math.min(me.best, lt);
    if (lapIdx >= S.lapsNow) finishLocal();
    else { sfx.lap(); toast(`Okrążenie ${lapIdx}: ${fmt(lt)}${isBest ? '  · najlepsze' : ''}`, 2400); }
    updateBestText();
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

/** klasyfikacja końcowa w trybie solo z botami */
function soloOrder() {
  const rows = [{ id: 'me', nick: S.nick, t: me.finishTime || null, prog: me.st?.progress ?? 0, me: true }, ...oppList().filter((o) => o.raceBot).map((o) => ({ id: o.id, nick: o.nick, t: o.finishT, prog: o.st.progress, bot: true }))];
  return rows.sort((a, b) => (a.t != null && b.t != null ? a.t - b.t : a.t != null ? -1 : b.t != null ? 1 : b.prog - a.prog));
}
const POINTS = [10, 6, 4, 2];
function soloTournamentUpdate(order) {
  if (!S.tournament || isArena()) { S.tour = null; return null; }
  if (!S.tour || S.tour.done) S.tour = { history: [], points: {}, names: {}, last: {}, done: false };
  const t = S.tour;
  order.forEach((o, i) => { t.points[o.id] = (t.points[o.id] ?? 0) + (POINTS[i] ?? 0); t.last[o.id] = i + 1; t.names[o.id] = o.nick; });
  t.history.push({ track: trackId }); if (t.history.length >= 3) t.done = true;
  return { round: t.history.length, total: 3, done: t.done, standings: Object.entries(t.points).map(([id, pts]) => ({ id, nick: t.names[id], points: pts, last: t.last[id] })).sort((a, b) => b.points - a.points), champion: null };
}
/** panel turnieju na ekranie wyników (MP z serwera albo solo lokalnie) */
function renderTournament(t, pendingPoints) {
  const box = $('tour-box');
  if (!t) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const done = t.done;
  $('tour-title').textContent = done ? 'Turniej zakończony — klasyfikacja końcowa' : `Turniej — klasyfikacja po rundzie ${t.round}/${t.total}`;
  const tb = $('tour-table'); tb.textContent = '';
  const head = document.createElement('tr'); head.innerHTML = '<th>Kierowca</th><th>Ost. runda</th><th>Punkty</th>'; tb.append(head);
  t.standings.forEach((r, i) => {
    const tr = document.createElement('tr'); if (r.id === S.you || r.id === 'me') tr.className = 'me';
    const a = document.createElement('td'); a.textContent = `${i + 1}. ${r.nick}${r.id === S.you || r.id === 'me' ? ' (Ty)' : ''}${done && i === 0 ? '  — MISTRZ' : ''}`;
    const b = document.createElement('td'); b.textContent = r.last ? `${r.last}.` : '—';
    const c = document.createElement('td'); c.textContent = r.points; tr.append(a, b, c); tb.append(tr);
  });
  $('tour-note').textContent = pendingPoints ? 'Punkty za tę rundę zostaną dodane, gdy wszyscy dojadą (maks. 25 s).' : done ? 'Rewanż rozpocznie nowy turniej.' : S.solo ? 'Wybierz tor następnej rundy.' : 'Następny tor wybiera gospodarz.';
  const tr = $('tour-tracks');
  if (!done && !S.solo && S.room) buildTrackList('tour-tracks', S.room.track, (id) => socket?.emit('room:track', id), S.room.players[0]?.id === S.you);
  else if (!done && S.solo) buildTrackList('tour-tracks', S.trackId, (id) => { S.trackId = id; store.set('tc_track', id); S.laps = TRACK_DEFS[id].laps; renderTournament(t, false); }, true);
  else tr.textContent = '';
  if (done) { const ch = t.standings[0]; if (ch) $('res-sub').textContent = `Mistrz turnieju: ${ch.nick}`; }
}
function showResultsSolo() {
  $('res-title').className = 'res-title'; $('res-title').textContent = 'Meta!';
  const order = oppList().some((o) => o.raceBot) ? soloOrder() : null;
  const place = order ? order.findIndex((o) => o.me) + 1 : 1;
  $('res-sub').textContent = order ? `Miejsce ${place}/${order.length} · czas ${fmt(me.finishTime)}` : `Czas całkowity: ${fmt(me.finishTime)}`;
  const t = $('res-table'); t.textContent = '';
  if (order) {
    const hd = document.createElement('tr'); hd.innerHTML = '<th>Klasyfikacja</th><th>Czas</th>'; t.append(hd);
    order.forEach((o, i) => { const tr = document.createElement('tr'); if (o.me) tr.className = 'me'; const a = document.createElement('td'); a.textContent = `${i + 1}. ${o.nick}${o.me ? ' (Ty)' : ''}`; const b = document.createElement('td'); b.textContent = o.t != null ? fmt(o.t) : 'nie dojechał'; tr.append(a, b); t.append(tr); });
  }
  const head = document.createElement('tr'); head.innerHTML = '<th>Okrążenie</th><th>Czas</th>'; t.append(head);
  me.lapTimes.forEach((lt, i) => {
    const tr = document.createElement('tr'); if (lt === me.best) tr.className = 'win';
    const a = document.createElement('td'); a.textContent = `Okrążenie ${i + 1}${lt === me.best ? ' · najlepsze' : ''}`;
    const b = document.createElement('td'); b.textContent = fmt(lt); tr.append(a, b); t.append(tr);
  });
  const tour = order ? soloTournamentUpdate(order) : (S.tournament ? soloTournamentUpdate([{ id: 'me', nick: S.nick }]) : null);
  renderTournament(tour, false);
  $('rematch-box').classList.add('hidden');
  $('btn-rematch').textContent = tour ? (tour.done ? 'Nowy turniej' : 'Następna runda') : 'Jeszcze raz'; $('btn-rematch').disabled = false; $('btn-rematch').classList.remove('on');
  $('rank-results').parentElement.querySelectorAll('h4, #rank-results').forEach((e) => e.classList.add('hidden'));
  sfx.win();
  showScreen('results');
  loadRanking();
}
function showResultsMP() {
  const d = S.results; if (!d) return;
  if (d.mode === 'soccer') return showResultsSoccer(d);
  $('rank-results').parentElement.querySelectorAll('h4, #rank-results').forEach((e) => e.classList.remove('hidden'));
  const won = d.winner === S.you && !S.spectator;
  $('res-title').className = 'res-title' + (won ? '' : ' lose');
  $('res-title').textContent = S.spectator ? 'Koniec wyścigu' : won ? 'Wygrana!' : 'Porażka';
  $('btn-rematch').classList.toggle('hidden', !!S.spectator);
  const w = d.players.find((p) => p.id === d.winner);
  $('res-sub').textContent = d.reason === 'left' ? 'Pozostali gracze opuścili wyścig.' : `${w ? w.nick : 'Gracz'} wygrywa wyścig.`;
  const t = $('res-table'); t.textContent = '';
  if (d.mode === 'arena') {
    $('res-title').textContent = won ? 'Wygrywasz arenę!' : 'Wyeliminowany';
    $('res-sub').textContent = d.reason === 'left' ? 'Pozostali gracze opuścili arenę.' : `${w ? w.nick : 'Gracz'} wygrywa arenę.`;
    const head2 = document.createElement('tr'); head2.innerHTML = '<th>Miejsce</th><th>Status</th>'; t.append(head2);
    const ord = d.order?.length ? d.order : [d.winner];
    const all = [...ord, ...d.players.map((p) => p.id).filter((id) => !ord.includes(id))];
    all.forEach((id, i) => { const p = d.players.find((q) => q.id === id); if (!p) return; const tr = document.createElement('tr'); if (i === 0) tr.className = 'win'; const a = document.createElement('td'); a.textContent = `${i + 1}. ${p.nick}${p.id === S.you ? ' (Ty)' : ''}`; const b = document.createElement('td'); b.textContent = i === 0 ? 'ostatni żywy' : 'wyeliminowany'; tr.append(a, b); t.append(tr); });
    if (d.ranking) renderRanking(d.ranking, d.mode === 'arena' ? 'arena' : 'race');
    if (!S.resultSounded) { S.resultSounded = true; (won ? sfx.win : sfx.lose)(); $('btn-rematch').textContent = 'Rewanż'; $('btn-rematch').classList.remove('on'); }
    updateResultsButtons(); showScreen('results'); return;
  }
  renderTournament(d.tournament, d.tournament && !d.finalReady);
  if (d.final?.length) {
    const head = document.createElement('tr'); head.innerHTML = '<th>Kierowca</th><th>Czas</th>'; t.append(head);
    d.final.forEach((o, i) => {
      const tr = document.createElement('tr'); if (o.id === d.winner) tr.className = 'win'; if (o.id === S.you) tr.classList.add('me');
      const a = document.createElement('td'); a.textContent = `${i + 1}. ${o.nick}${o.id === S.you ? ' (Ty)' : ''}${o.bot ? ' (bot)' : ''}`;
      const b = document.createElement('td'); const tm = o.id === S.you && me.finished ? me.finishTime : o.time;
      b.textContent = tm != null ? fmt(tm) : (o.id === S.you && !me.finished ? 'jedziesz…' : d.reason === 'left' ? '—' : 'w trasie…');
      tr.append(a, b); t.append(tr);
    });
    if (d.ranking) renderRanking(d.ranking, 'race');
    if (!S.resultSounded) { S.resultSounded = true; (won ? sfx.win : sfx.lose)(); $('btn-rematch').classList.remove('on'); }
    updateResultsButtons(); showScreen('results'); return;
  }
  const head = document.createElement('tr'); head.innerHTML = '<th>Kierowca</th><th>Czas</th>'; t.append(head);
  const rank = (p) => (p.id === d.winner ? -1 : d.times[p.id] != null ? d.times[p.id] : 1e9);
  const order = [...d.players].sort((a, b) => rank(a) - rank(b));
  for (const [i, p] of order.entries()) {
    const tr = document.createElement('tr'); if (p.id === d.winner) tr.className = 'win';
    const a = document.createElement('td'); a.textContent = `${i + 1}. ${p.nick}${p.id === S.you ? ' (Ty)' : ''}`;
    const b = document.createElement('td');
    const tm = d.times[p.id];
    b.textContent = tm != null ? fmt(tm) : (p.id === S.you && !me.finished ? 'jedziesz…' : d.reason === 'left' ? '—' : 'w trasie…');
    tr.append(a, b); t.append(tr);
  }
  if (d.ranking) renderRanking(d.ranking, d.mode === 'arena' ? 'arena' : 'race');
  if (!S.resultSounded) { S.resultSounded = true; (won ? sfx.win : sfx.lose)(); $('btn-rematch').textContent = 'Rewanż'; $('btn-rematch').classList.remove('on'); }
  updateResultsButtons();
  showScreen('results');
}
function updateResultsButtons() {
  const b = $('btn-rematch');
  const two = S.room && S.room.players.length + (S.room.bots?.length || 0) >= 2;
  const mine = S.room?.players.find((p) => p.id === S.you);
  const tt = S.results?.tournament;
  b.disabled = !two || !!mine?.ready;
  if (!two) b.textContent = 'Brak rywali';
  else if (mine?.ready) {
    const waiting = S.room.players.filter((p) => !p.ready).map((p) => p.nick);
    b.textContent = waiting.length ? `Czekam na: ${waiting.join(', ')}` : 'Start za chwilę…';
  } else b.textContent = tt ? (tt.done ? 'Nowy turniej' : 'Następna runda') : 'Rewanż';
  renderRematch();
}

// ======================= Opiekun przeciwnika (interpolacja) =======================
function sampleOpp(opp, now) {
  const sn = opp.snaps; const st = opp.st;
  if (!sn.length || !st) return false;
  const rt = now - 110;
  let a, b, f = 0;
  if (rt <= sn[0].t) { a = b = sn[0].a; }
  else if (rt >= sn[sn.length - 1].t) {
    a = b = sn[sn.length - 1].a;
    const ex = Math.min(0.15, (rt - sn[sn.length - 1].t) / 1000);
    st.x = a[0] + a[3] * ex; st.z = a[1] + a[4] * ex; st.yaw = a[2];
    return applyOpp(opp, a, a, 0, true, ex);
  } else {
    for (let i = sn.length - 2; i >= 0; i--) if (sn[i].t <= rt) { a = sn[i].a; b = sn[i + 1].a; f = (rt - sn[i].t) / Math.max(1, sn[i + 1].t - sn[i].t); break; }
  }
  return applyOpp(opp, a, b, f, false, 0);
}
function applyOpp(opp, a, b, f, ex, exT) {
  const st = opp.st; const L = (i) => a[i] + (b[i] - a[i]) * f;
  if (!ex) {
    st.x = L(0); st.z = L(1);
    let dy = b[2] - a[2]; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    st.yaw = a[2] + dy * f;
  }
  st.vx = L(3); st.vz = L(4); st.steer = L(5); st.vf = L(6); st.vl = L(7); st.progress = L(8);
  st.throttle = a[9]; st.brakeLit = !!a[10]; st.onGrass = !!a[11]; st.slip = Math.abs(st.vl);
  opp.finished = !!a[12]; st.nitro = !!a[13]; st.hand = !!a[14];
  if (a[15] != null) { st.hp = a[15]; const d = 1 - a[15] / 100; st.damage = d; opp.vis?.setDamage(d); }
  if (a[17] != null) st.y = a[17];
  opp.shield = !!a[18];
  const dead = !!a[16];
  if (dead !== !!opp.dead && opp.vis) {
    opp.dead = dead; opp.vis.group.visible = !dead;
    if (dead) explode(st.x, st.z);
  }
  return true;
}

// ======================= Efekty aut =======================
const tmpC = new THREE.Color();
const wheelWorld = (st, lx, lz) => {
  const c = Math.cos(st.yaw), s = Math.sin(st.yaw);
  return [st.x + c * lx - s * lz, st.z + s * lx + c * lz];
};
function carFx(c, key, dt) {
  const st = c.st; if (!st || !c.vis || c.dead) return;
  if (!isArena()) particles.yOff = st.y || 0;
  const sp = Math.abs(st.vf);
  const M = c.vis.model;
  const sliding = (st.slip > 5.5 || st.hand) && sp > 7 && !st.onGrass;
  const braking = st.brakeLit && sp > 24;
  const [lx, lz] = wheelWorld(st, -M.wheelX, M.wheelZ);
  const [rx, rz] = wheelWorld(st, -M.wheelX, -M.wheelZ);
  const on = !isArena() && !st.air && (st.y || 0) < 0.3 && (sliding || braking) && S.mode !== 'menu' && S.mode !== 'lobby';
  skids.add(key + 'L', lx, lz, on, st.hand ? 0.42 : 0.34); skids.add(key + 'R', rx, rz, on, st.hand ? 0.42 : 0.34);
  if (S.mode === 'menu' || S.mode === 'lobby') return;
  const hp = st.hp ?? 100;
  if (hp < 50) { // dym z maski, przy niskiej wytrzymałości także ogień
    const crit = hp < 22;
    c.dmgAcc = (c.dmgAcc || 0) + dt * (crit ? 38 : 15) * (1.3 - hp / 50);
    while (c.dmgAcc >= 1) {
      c.dmgAcc -= 1;
      const [hx, hz] = wheelWorld(st, M.L * 0.28, (Math.random() - 0.5) * 0.9);
      const g = crit ? 0.16 : 0.55; tmpC.setRGB(g, g, g * 1.05);
      particles.emit(hx, 1.0, hz, st.vx * 0.1 + (Math.random() - 0.5), 2 + Math.random() * 2.5, st.vz * 0.1 + (Math.random() - 0.5), 1.2, 1.3, 4.6, tmpC, crit ? 0.8 : 0.6, 1);
      if (crit && Math.random() < 0.7) { tmpC.setRGB(1, 0.35 + Math.random() * 0.4, 0.08); particles.emit(hx, 0.9, hz, (Math.random() - 0.5) * 1.5, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 1.5, 0.4, 2.2, 0.3, tmpC, 0.95, 2); }
    }
  }
  if (st.surf && sp > 8 && !st.air) { // rozbryzgi z kałuży / lodowe iskry spod kół
    c.smokeAcc += dt * 55 * clamp(sp / 35, 0.3, 1);
    while (c.smokeAcc >= 1) {
      c.smokeAcc -= 1;
      const side = Math.random() > 0.5;
      if (st.surf === 'ice') tmpC.setRGB(0.8, 0.92, 1); else tmpC.setRGB(0.55, 0.66, 0.8);
      particles.emit(side ? lx : rx, 0.2, side ? lz : rz, st.vx * 0.15 + (Math.random() - 0.5) * 3, 2 + Math.random() * 3.5, st.vz * 0.15 + (Math.random() - 0.5) * 3, 0.55, 0.5, 1.5, tmpC, 0.6, 1.2, 9);
    }
  }
  if (st.nitro) {
    const [ex, ez] = wheelWorld(st, -M.L / 2 - 0.2, 0);
    for (let i = 0; i < 3; i++) { tmpC.setRGB(0.3 + Math.random() * 0.4, 0.6 + Math.random() * 0.3, 1); particles.emit(ex, 0.55, ez, -Math.cos(st.yaw) * (10 + Math.random() * 8) + (Math.random() - 0.5) * 2, Math.random() * 1.5, -Math.sin(st.yaw) * (10 + Math.random() * 8) + (Math.random() - 0.5) * 2, 0.28, 1.1, 0.2, tmpC, 0.9, 2); }
    tmpC.setRGB(1, 0.55, 0.15); particles.emit(ex, 0.55, ez, -Math.cos(st.yaw) * 6, 0.3, -Math.sin(st.yaw) * 6, 0.18, 0.9, 0.1, tmpC, 0.9, 2);
  }
  if (sliding) {
    c.smokeAcc += dt * 50 * clamp((st.slip - 4.5) / 8, st.hand ? 0.7 : 0.25, 1);
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
  if (me.dead && (isArena() || S.spectator) && !e.repeat) { if (e.code === 'KeyA' || e.code === 'ArrowLeft') me.specIdx--; if (e.code === 'KeyD' || e.code === 'ArrowRight') me.specIdx++; }
  if (!e.repeat && !(isSoccer() && !attacksOn())) {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') useNitro();
    else if (e.code === 'KeyF') fire();
    else if (e.code === 'KeyR') fireGun();
    else if (e.code === 'KeyE') { if (isArena()) useStock('oil'); else dropOil(); }
    else if (e.code === 'KeyQ') { if (isArena()) useStock('bomb'); else useMine(); }
    else if (e.code === 'KeyT') useStock('rocket');
    else if (e.code === 'KeyG') useStock('shield');
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
function toggleMute() { setMuted(!isMuted()); refreshMute(); music.setMuted(isMuted()); }
function refreshMute() { $('ico-on').classList.toggle('hidden', isMuted()); $('ico-off').classList.toggle('hidden', !isMuted()); }


// ======================= System zniszczeń =======================
function setHp(v) {
  me.hp = clamp(v, 0, 100);
  if (me.st) { me.st.hp = me.hp; me.st.damage = 1 - me.hp / 100; }
  me.vis?.setDamage(1 - me.hp / 100);
}
/** obrażenia własnego auta (liczone lokalnie; rywale dostają stan w pakiecie) */
function damage(amount) {
  if (isSoccer() && !attacksOn()) return;
  if (amount <= 0.2 || me.dead || me.inv > 0 || me.shieldT > 0 || me.finished || S.mode !== 'racing') return;
  const before = me.hp;
  setHp(me.hp - amount);
  if (before > 30 && me.hp <= 30) toast('Auto mocno uszkodzone!', 1600);
  if (me.hp <= 0) die();
}
function explode(x, z) {
  sfx.explode();
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * 6.28, sp = 3 + Math.random() * 14;
    const hot = Math.random() < 0.7;
    tmpC.setRGB(1, hot ? 0.35 + Math.random() * 0.5 : 0.15, hot ? 0.05 : 0.05);
    particles.emit(x, 0.8 + Math.random() * 1.5, z, Math.cos(a) * sp, 2 + Math.random() * 9, Math.sin(a) * sp, 0.7 + Math.random() * 0.6, 1.5, 6.5, tmpC, 0.9, 1.4, 4);
  }
  for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, sp = 1 + Math.random() * 6; tmpC.setRGB(0.1, 0.1, 0.11); particles.emit(x, 1, z, Math.cos(a) * sp, 3 + Math.random() * 6, Math.sin(a) * sp, 1.8 + Math.random() * 1.2, 2, 8, tmpC, 0.75, 0.7, -1); }
  sparks(x, z, 40);
}
function die() {
  if (isSoccer()) { me.dead = true; me.respawnT = 3; me.fireT = 0; explode(me.st.x, me.st.z); me.vis.group.visible = false; me.st.vx = me.st.vz = me.st.vf = me.st.vl = 0; toast('Auto zniszczone! Odrodzenie za 3 s', 2800); updateSlots(); return; }
  if (isArena()) return eliminateMe();
  me.dead = true; me.respawnT = 3; me.fireT = 0;
  explode(me.st.x, me.st.z);
  me.vis.group.visible = false;
  me.st.vx = me.st.vz = 0; me.st.vf = me.st.vl = 0;
  toast('Auto zniszczone! Odrodzenie za 3 s', 2800);
  updateSlots();
}
function respawn() {
  if (isSoccer()) { placeAtSpawn(me); setHp(100); me.dead = false; me.inv = 2; me.vis.group.visible = true; me.st.nitro = false; me.nitroT = 0; updateSlots(); return; }
  const q = track.at(me.st.idx, 0), s = me.st;
  s.x = q.x; s.z = q.z; s.yaw = q.yaw; s.vx = s.vz = s.vf = s.vl = 0; s.steer = 0; s.lastIdx = q.idx;
  setHp(100); me.dead = false; me.inv = 2; me.vis.group.visible = true; s.nitro = false; me.nitroT = 0; updateSlots();
}

// ======================= Duch najlepszego okrążenia (trening solo) =======================
const ghost = { vis: null, data: null, pending: null, best: Infinity, floor: -1, rec: null, recStart: 0, recAcc: 0, t0: 0, playing: false, st: { x: 0, z: 0, yaw: 0, vf: 0, vl: 0, steer: 0, accelNow: 0, onGrass: false, brakeLit: false } };
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.34, depthWrite: false });
const ghostKey = () => 'tc_ghost_' + trackId;
function ghostClear() {
  if (ghost.vis) scene.remove(ghost.vis.group);
  Object.assign(ghost, { vis: null, data: null, pending: null, best: Infinity, floor: -1, rec: null, playing: false });
}
function ghostBuild(carId) {
  if (ghost.vis) scene.remove(ghost.vis.group);
  const v = buildCar(carId, 1);
  v.group.traverse((o) => { if (o.isMesh) { if (o.geometry.type === 'PlaneGeometry') o.visible = false; else { o.material = ghostMat; o.castShadow = false; o.receiveShadow = false; } } });
  v.group.visible = false; scene.add(v.group);
  ghost.vis = v;
}
function ghostSetup() {
  ghostClear();
  if (!S.solo || isArena()) return;
  let g = null;
  try { g = JSON.parse(store.get(ghostKey())); } catch { /* brak */ }
  if (g && g.s?.length > 30 && CAR_DEFS[g.car]) { ghost.data = g; ghost.best = g.time; if (S.ghost) ghostBuild(g.car); }
  updateBestText();
}
function updateBestText() {
  const parts = [];
  if (me.best < Infinity) parts.push(`Najlepsze: ${fmt(me.best)}`);
  if (S.solo && S.ghost && ghost.best < Infinity) parts.push(`Duch: ${fmt(ghost.best)}`);
  $('hud-best').textContent = parts.join('  ·  ');
}
/** wywoływane przy każdym przekroczeniu linii startu/mety (fl = numer przekroczenia, od 0) */
function ghostCross(fl) {
  if (!S.solo) return;
  const now = performance.now();
  if (ghost.floor >= 0 && ghost.rec && ghost.rec.length > 30) {
    const lt = (now - ghost.recStart) / 1000;
    if (lt < ghost.best) {
      ghost.best = lt;
      ghost.pending = { time: lt, car: S.carId, s: ghost.rec };
      store.set(ghostKey(), JSON.stringify(ghost.pending));
    }
  }
  ghost.floor = fl;
  if (ghost.pending) { ghost.data = ghost.pending; ghost.pending = null; if (S.ghost) ghostBuild(ghost.data.car); }
  if (fl < S.lapsNow) { ghost.rec = []; ghost.recStart = now; ghost.recAcc = 0; ghost.t0 = now; ghost.playing = !!ghost.data; }
  else { ghost.rec = null; ghost.playing = false; }
  updateBestText();
}
function ghostRecord(dt) {
  if (!S.solo || !ghost.rec || !me.st) return;
  ghost.recAcc += dt;
  while (ghost.recAcc >= 1 / 30) {
    ghost.recAcc -= 1 / 30;
    const s = me.st, r = (v) => Math.round(v * 100) / 100;
    ghost.rec.push([r(s.x), r(s.z), r(s.yaw), r(s.vf), r(s.steer)]);
  }
}
function ghostPlay(dt) {
  const g = ghost;
  if (!g.vis) return;
  if (!(S.solo && S.ghost && g.playing && g.data)) { g.vis.group.visible = false; return; }
  const arr = g.data.s, f = ((performance.now() - g.t0) / 1000) * 30, i = Math.floor(f);
  if (i >= arr.length - 1) { g.vis.group.visible = false; return; }
  const a = arr[i], b = arr[i + 1], k = f - i, st = g.st;
  st.x = a[0] + (b[0] - a[0]) * k; st.z = a[1] + (b[1] - a[1]) * k;
  let dy = b[2] - a[2]; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
  st.yaw = a[2] + dy * k; st.vf = a[3] + (b[3] - a[3]) * k; st.steer = a[4] + (b[4] - a[4]) * k;
  g.vis.group.visible = true; g.vis.sync(st, dt);
}

// ======================= Minimapa =======================
function drawMinimap() {
  if (!me.st || $('hud').classList.contains('hidden')) return;
  const dots = [{ x: me.st.x, z: me.st.z, color: me.color, me: true }];
  for (const o of oppList()) if (!o.dead) dots.push({ x: o.st.x, z: o.st.z, color: o.color, label: (o.nick || '?').trim()[0]?.toUpperCase() });
  if (isSoccer()) dots.push({ x: ball.rx, z: ball.rz, color: '#ffffff', ball: true });
  if (S.solo && S.ghost && ghost.vis?.group.visible) dots.push({ x: ghost.st.x, z: ghost.st.z, ghost: true });
  minimap.draw(dots, [...items.crates.values()].filter((c) => !c.dying).map((c) => ({ x: c.x, z: c.z, type: c.type })));
}

// ======================= Arena: bronie, wybuchy, boty, eliminacje =======================
const WEAPON_NAMES = { bomb: 'Bomba', rocket: 'Rakieta', ammo: 'Karabin', shield: 'Tarcza', oil: 'Olej' };
const BOT_NAMES = ['Rzeźnik', 'Wściekły Mirek', 'Młot', 'Piła'];
let arenaEnd = false, idSeq = 0;
const nextId = () => `${(S.you || 'me').slice(0, 5)}${++idSeq}`;
const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const entityById = (id) => (id === S.you ? me : opps.get(id) || null);

function hitMe() { me.st.vx *= 0.93; me.st.vz *= 0.93; me.st.slowT = 1.3; damage(2.2); sparks(me.st.x, me.st.z, 14); sfx.hit(); }
function knock(st, x, z, hv, vv) {
  const dx = st.x - x, dz = st.z - z, d = Math.hypot(dx, dz) || 1;
  st.vx += (dx / d) * hv; st.vz += (dz / d) * hv;
  if (isArena() || st.y !== undefined) { st.air = true; st.vy = Math.max(st.vy || 0, vv); if (st.y === undefined) st.y = 0; }
}
function damageBot(o, amount) {
  if (o.dead || o.shieldT > 0 || amount <= 0.2) return;
  if (o.raceBot || isSoccer()) { o.st.slowT = 0.9; o.st.vx *= 0.97; o.st.vz *= 0.97; return; } // w wyścigu boty tylko zwalniają
  o.hp = Math.max(0, o.hp - amount); o.st.hp = o.hp; o.st.damage = 1 - o.hp / 100; o.vis.setDamage(o.st.damage);
  if (o.hp <= 0) { o.dead = true; o.vis.group.visible = false; explode(o.st.x, o.st.z); toast(`${o.nick} wyeliminowany`, 1800); }
}
/** wybuch: obrażenia dla mnie i botów (rywale w multiplayerze liczą go u siebie z eventu) */
function blast(x, z, r, dmg) {
  explode(x, z);
  if (me.st && !me.dead && !me.finished && S.mode === 'racing') {
    const d = Math.hypot(me.st.x - x, me.st.z - z);
    if (d < r) { const k = 1 - d / r; damage(dmg * (0.45 + 0.55 * k)); knock(me.st, x, z, 8 + 14 * k, 4 + 8 * k); }
  }
  for (const o of oppList()) if (o.bot && !o.dead) {
    const d = Math.hypot(o.st.x - x, o.st.z - z);
    if (d < r) { const k = 1 - d / r; damageBot(o, dmg * (0.45 + 0.55 * k)); knock(o.st, x, z, 8 + 14 * k, 4 + 8 * k); }
  }
}
function emitEvent(e) { if (!S.solo) socket?.emit('game:event', e); }
function detonateBomb(b) { const dmg = isArena() ? 45 : 30; b.dead = true; blast(b.x, b.z, 8, dmg); emitEvent({ t: 'boom', id: b.id, x: b.x, z: b.z, r: 8, dmg }); }
function detonateRocket(r) { r.dead = true; blast(r.x, r.z, 6.5, 34); emitEvent({ t: 'boom', id: r.id, x: r.x, z: r.z, r: 6.5, dmg: 34 }); }

function nearestEnemy(st, exceptId) {
  let best = null, bs = 1e9;
  for (const o of oppList()) {
    if (o.dead || o.id === exceptId) continue;
    const d = Math.hypot(o.st.x - st.x, o.st.z - st.z), a = Math.abs(wrapA(Math.atan2(o.st.z - st.z, o.st.x - st.x) - st.yaw));
    const sc = d * (1 + 0.6 * a);
    if (sc < bs) { bs = sc; best = o; }
  }
  return best;
}
/** podstawowy karabin na arenie: zawsze dostępny, ładuje się sam (R, seria 2 s) */
function fireGun() {
  if (!isArena() || !racingNow()) return;
  if (me.gunCharge < 1 || me.fireT > 0) { sfx.empty(); return; }
  me.gunCharge = 0; me.fireT = 2; me.fireAcc = 0; updateSlots();
}
function useWeapon(w) {
  const s = me.st, cs = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  if (w === 'bomb') { const id = nextId(), x = s.x - cs * 3.2, z = s.z - sn * 3.2; items.dropBomb(id, x, z, 'me', isArena() ? undefined : (track.hy ? track.heightAt(s.idx) : 0)); emitEvent({ t: 'bomb', id, x, z }); sfx.oil(); }
  else if (w === 'rocket') {
    const tgt = nearestEnemy(s), id = nextId(), x = s.x + cs * 3.2, z = s.z + sn * 3.2;
    items.launchRocket(id, x, z, s.yaw, 'me', tgt ? () => (tgt.dead ? null : tgt.st) : null); sfx.rocket();
    emitEvent({ t: 'rocket', id, x, z, yaw: s.yaw, to: tgt && !tgt.bot ? tgt.id : null });
  } else if (w === 'ammo') { me.fireT = 4; me.fireAcc = 0; }
  else if (w === 'shield') { me.shieldT = 5; sfx.shield(); }
  else if (w === 'oil') { const x = s.x - cs * 3.4, z = s.z - sn * 3.4; items.dropOil(x, z, 'me'); emitEvent({ t: 'oil', x, z }); sfx.oil(); }
}
function fireArena() {
  if (!racingNow()) return;
  const w = me.weapon;
  if (!w || me.fireT > 0) { sfx.empty(); return; }
  useWeapon(w); me.weapon = null; updateSlots();
}
/** zestaw „Pełny”: osobne zapasy broni na własnych klawiszach (Q mina, E olej, T rakieta, G tarcza) */
function useStock(k) {
  if (!isArena() || !racingNow() || !(me.stock?.[k] > 0) || (k === 'shield' && me.shieldT > 0)) { sfx.empty(); return; }
  me.stock[k]--; useWeapon(k); updateSlots();
}
/** mina w wyścigu (Q) */
function useMine() {
  if (!racingNow() || !me.items.mine) { sfx.empty(); return; }
  me.items.mine--; useWeapon('bomb'); updateSlots();
}
/** trafienia pocisków karabinu: moje w rywali i boty, pociski botów we mnie i inne boty */
function shotHits() {
  for (const sh of items.shots) {
    if (sh.life <= 0) continue;
    const near = (st) => [0, 1.5, -1.5].some((d) => Math.hypot(sh.x - (st.x + Math.cos(st.yaw) * d), sh.z - (st.z + Math.sin(st.yaw) * d)) < 2.1);
    if (sh.owner === 'me') {
      for (const o of oppList()) {
        if (o.dead || !near(o.st)) continue;
        items.killShot(sh); sparks(o.st.x, o.st.z, 14); sfx.hit();
        if (o.bot) { o.st.vx *= 0.95; o.st.vz *= 0.95; damageBot(o, 2.4); } else emitEvent({ t: 'hit', to: o.id });
        break;
      }
    } else if (sh.owner.startsWith('bot:')) {
      const bid = sh.owner.slice(4);
      if (!me.dead && !me.finished && near(me.st)) { items.killShot(sh); hitMe(); continue; }
      for (const o of oppList()) if (o.bot && o.id !== bid && !o.dead && near(o.st)) { items.killShot(sh); sparks(o.st.x, o.st.z, 10); damageBot(o, 2.4); break; }
    }
  }
}
function updateArenaCombat(dt) {
  if (S.mode !== 'racing') return;
  const actors = [];
  if (!me.dead) actors.push(me);
  for (const o of oppList()) if (o.bot && !o.dead) actors.push(o);
  for (const b of items.bombs) {
    if (b.dead || b.age < 0.8) continue;
    const bgh = b.gh !== undefined ? b.gh : heightAt(b.x, b.z);
    for (const a of actors) { if (Math.hypot(a.st.x - b.x, a.st.z - b.z) < 3.6 && Math.abs((a.st.y || 0) - bgh) < 3) { detonateBomb(b); break; } }
  }
  if (!isArena()) return;
  for (const r of items.rockets) {
    if (r.dead || r.owner.startsWith('opp:')) continue;
    const ownerBot = r.owner.startsWith('bot:') ? r.owner.slice(4) : null;
    let hit = r.life <= 0 || (isSoccer() ? Math.abs(r.x) > HX + GD - 1 || Math.abs(r.z) > HZ - 1 : Math.hypot(r.x, r.z) > ARENA_R - 1.5) || OBSTACLES.some(([ox, oz, or]) => Math.hypot(r.x - ox, r.z - oz) < or + 0.7);
    if (!hit) {
      if (r.owner === 'me') hit = oppList().some((o) => !o.dead && Math.hypot(o.st.x - r.x, o.st.z - r.z) < 2.8 && Math.abs((o.st.y || 0) + 1 - (heightAt(r.x, r.z) + 1.3)) < 3.5);
      else hit = (!me.dead && Math.hypot(me.st.x - r.x, me.st.z - r.z) < 2.8) || oppList().some((o) => o.bot && o.id !== ownerBot && !o.dead && Math.hypot(o.st.x - r.x, o.st.z - r.z) < 2.8);
    }
    if (hit) detonateRocket(r);
  }
}
function setShieldFx(vis, on, t) {
  if (!vis) return;
  if (!vis.shieldMesh) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(3.3, 24, 16), new THREE.MeshBasicMaterial({ color: 0x7ad8ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.y = 1.1; vis.group.add(m); vis.shieldMesh = m;
  }
  vis.shieldMesh.visible = on; if (on) vis.shieldMesh.material.opacity = 0.2 + Math.sin(t * 9) * 0.07;
}

// ---- eliminacje i koniec rundy ----
function eliminateMe() {
  me.dead = true; me.respawnT = Infinity; me.fireT = 0; me.deadAt = performance.now();
  explode(me.st.x, me.st.z); me.vis.group.visible = false; me.st.vx = me.st.vz = me.st.vf = me.st.vl = 0;
  toast('Wyeliminowany! Oglądasz resztę walki (A/D — zmiana kamery)', 3500);
  if (!S.solo) socket?.emit('arena:dead');
  updateSlots();
}
function spectateTarget() {
  const alive = oppList().filter((o) => !o.dead);
  return alive.length ? alive[((me.specIdx % alive.length) + alive.length) % alive.length] : null;
}
function checkArenaSoloEnd() {
  if (!S.solo || !isArena() || isSoccer() || arenaEnd || S.mode !== 'racing') return;
  const botsAlive = oppList().filter((o) => !o.dead).length;
  if (!me.dead && botsAlive === 0) { arenaEnd = true; setMode('finished'); showResultsArenaSolo(true); }
  else if (me.dead && performance.now() - me.deadAt > 2800) { arenaEnd = true; setMode('finished'); showResultsArenaSolo(false); }
}
function showResultsArenaSolo(won) {
  $('res-title').className = 'res-title' + (won ? '' : ' lose'); $('res-title').textContent = won ? 'Wygrywasz arenę!' : 'Wyeliminowany';
  $('res-sub').textContent = won ? 'Wszyscy przeciwnicy wyeliminowani.' : `Pokonani przeciwnicy: ${oppList().filter((o) => o.dead).length}/${opps.size}`;
  const t = $('res-table'); t.textContent = '';
  const head = document.createElement('tr'); head.innerHTML = '<th>Kierowca</th><th>Status</th>'; t.append(head);
  const rows = [[S.nick + ' (Ty)', !me.dead], ...oppList().map((o) => [o.nick, !o.dead])];
  for (const [n, alive] of rows) { const tr = document.createElement('tr'); if (alive) tr.className = 'win'; const a = document.createElement('td'); a.textContent = n; const b = document.createElement('td'); b.textContent = alive ? 'żywy' : 'wyeliminowany'; tr.append(a, b); t.append(tr); }
  $('btn-rematch').textContent = 'Jeszcze raz'; $('btn-rematch').disabled = false; $('btn-rematch').classList.remove('on');
  $('rank-results').parentElement.querySelectorAll('h4, #rank-results').forEach((e) => e.classList.add('hidden'));
  (won ? sfx.win : sfx.lose)();
  showScreen('results');
}

// ---- boty (trening solo na arenie) ----
function spawnBots() {
  const colors = CAR_COLORS.filter((c) => c !== S.color);
  for (let i = 0; i < S.bots; i++) {
    const o = { id: 'bot' + i, bot: true, nick: BOT_NAMES[i], carId: CAR_IDS[(i + 1) % CAR_IDS.length], slot: i + 1, snaps: [], prevVf: 0, smokeAcc: 0, audio: null, vis: null, st: null, finished: false, hp: 100, weapon: currentLoadout() === 'full' ? 'rocket' : null, shieldT: 0, fireT: 0, fireAcc: 0, nitroT: 0, hitCd: 0, ai: { t: 0, target: null, stuck: 0, rev: 0, revSteer: 1, cd: 2 + Math.random() * 3 } };
    opps.set(o.id, o); setCar(o, o.carId, o.slot, colors[i % colors.length]); o.st.hp = 100;
  }
}
function botApply(o, type) {
  if (type === 'repair') { o.hp = Math.min(100, o.hp + 40); o.st.hp = o.hp; o.st.damage = 1 - o.hp / 100; o.vis.setDamage(o.st.damage); }
  else if (type === 'nitro') o.nitroT = 2.5;
  else o.weapon = type;
}
function botUpdate(o, dt) {
  if (o.dead) return;
  const st = o.st, ai = o.ai;
  o.hitCd -= dt;
  if (o.shieldT > 0) o.shieldT -= dt;
  if (o.nitroT > 0) o.nitroT -= dt; st.nitro = o.nitroT > 0;
  // cel: najbliższy żywy wróg (ja albo inny bot)
  ai.t -= dt;
  if (ai.t <= 0) {
    ai.t = 0.35 + Math.random() * 0.3;
    let best = null, bd = 1e9;
    const cand = []; if (!me.dead) cand.push(me.st); for (const q of oppList()) if (q !== o && !q.dead) cand.push(q.st);
    for (const c of cand) { const d = Math.hypot(c.x - st.x, c.z - st.z); if (d < bd) { bd = d; best = c; } }
    ai.target = best;
  }
  let tx = ai.target ? ai.target.x : 0, tz = ai.target ? ai.target.z : 0;
  if (!o.weapon || o.hp < 55) { // zbieranie paczek
    let crate = null, cd = 1e9;
    for (const c of items.crates.values()) if (c.landed && !c.dying) { const d = Math.hypot(c.x - st.x, c.z - st.z); if (d < cd) { cd = d; crate = c; } }
    if (crate && cd < 60) { tx = crate.x; tz = crate.z; }
  }
  if (Math.hypot(st.x, st.z) > ARENA_R - 11) { tx = 0; tz = 0; }
  const ang = wrapA(Math.atan2(tz - st.z, tx - st.x) - st.yaw);
  const inp = { throttle: 1, brake: 0, steer: clamp(ang * 2.2, -1, 1), hand: false };
  if (Math.abs(ang) > 2 && st.speed > 10) { inp.throttle = 0; inp.brake = 1; }
  if (st.speed < 2.5 && !st.air) ai.stuck += dt; else ai.stuck = 0;
  if (ai.stuck > 1.1) { ai.rev = 0.9; ai.stuck = 0; ai.revSteer = Math.random() < 0.5 ? -1 : 1; }
  if (ai.rev > 0) { ai.rev -= dt; inp.throttle = 0; inp.brake = 1; inp.steer = ai.revSteer; }
  stepCar(st, inp, dt);
  if (st.landHit > 0) damageBot(o, st.landHit * 0.5);
  if (st.hit > 3 && o.hitCd <= 0) { damageBot(o, (st.hit - 3) * 0.3); o.hitCd = 0.2; if (st.hit > 8) sparks(st.x, st.z, st.hit); }
  if (!me.dead) { const h = carVsCar(st, me.st); if (h > 1.5 && o.hitCd <= 0) { if (!frontHit(st, me.st)) damageBot(o, h * 0.6); o.hitCd = 0.15; } }
  for (const q of oppList()) if (q !== o && !q.dead) { const h = carVsCar(st, q.st); if (h > 1.5 && o.hitCd <= 0) { if (!frontHit(st, q.st)) damageBot(o, h * 0.2); o.hitCd = 0.15; } }
  const c = items.touch(st.x, st.z, 3.2);
  if (c && !c.requested) { c.requested = true; botApply(o, c.type); items.remove(c.id); }
  // broń
  ai.cd -= dt;
  const tg = ai.target;
  if (o.weapon && tg && ai.cd <= 0) {
    const d = Math.hypot(tg.x - st.x, tg.z - st.z), a = wrapA(Math.atan2(tg.z - st.z, tg.x - st.x) - st.yaw), cs = Math.cos(st.yaw), sn = Math.sin(st.yaw);
    ai.cd = 0.5;
    if (o.weapon === 'ammo' && d < 48 && Math.abs(a) < 0.3) { o.fireT = 4; o.fireAcc = 0; o.weapon = null; }
    else if (o.weapon === 'rocket' && d < 90 && Math.abs(a) < 0.9) { items.launchRocket('r' + o.id + (++idSeq), st.x + cs * 3.2, st.z + sn * 3.2, st.yaw, 'bot:' + o.id, () => (tg === me.st ? (me.dead ? null : me.st) : tg)); sfx.rocket(); o.weapon = null; }
    else if (o.weapon === 'bomb' && d < 14) { items.dropBomb('b' + o.id + (++idSeq), st.x - cs * 3.2, st.z - sn * 3.2, 'bot:' + o.id); o.weapon = null; }
    else if (o.weapon === 'shield' && o.hp < 65 && d < 35) { o.shieldT = 5; o.weapon = null; }
    else if (o.weapon === 'oil' && d < 18 && Math.abs(a) > 2.2) { items.dropOil(st.x - cs * 3.4, st.z - sn * 3.4, 'bot:' + o.id); o.weapon = null; }
  }
  if (o.fireT > 0) { o.fireT -= dt; o.fireAcc -= dt; if (o.fireAcc <= 0) { items.shoot(st.x, st.z, st.yaw, st.vx, st.vz, 'bot:' + o.id); o.fireAcc = 0.16; } }
}
function refreshOpp(o) { return o.bot ? true : sampleOpp(o, performance.now()); }

// ======================= Przedmioty, broń, nitro =======================
const soloSpawn = { t: 5, id: 1 };
const attacksOn = () => (S.solo ? S.attacks : !!S.room?.settings?.attacks);
const currentLoadout = () => (S.solo ? S.loadout : S.room?.settings?.loadout) || 'normal';
function resetItems() {
  items.clear();
  me.hp = 100; me.dead = false; me.inv = 0; me.respawnT = 0; me.fullKit = currentLoadout() === 'full' && (!isSoccer() || attacksOn()); me.stock = isArena() && me.fullKit ? { bomb: 1, rocket: 1, shield: 1, oil: 1 } : { bomb: 0, rocket: 0, shield: 0, oil: 0 }; me.weapon = isArena() && (!isSoccer() || attacksOn()) ? (me.fullKit ? 'ammo' : 'rocket') : null; me.gunCharge = 1; me.shieldT = 0; me.specIdx = 0; arenaEnd = false; if (me.vis) { me.vis.group.visible = true; me.vis.setDamage(0); } if (me.st) { me.st.damage = 0; me.st.hp = 100; }
  me.items = me.fullKit ? { nitro: 1, oil: +!isArena(), ammo: +!isArena(), mine: +!isArena() } : { nitro: 0, oil: 0, ammo: 0, mine: 0 }; me.fireT = 0; me.fireAcc = 0; me.nitroT = 0; me.tireCd = 0;
  if (me.st) { me.st.nitro = false; me.st.slowT = 0; me.st.inOil = false; }
  soloSpawn.t = 5;
  world?.tires.reset();
  updateSlots();
}
const crateSpot = (u, l) => track.at(Math.floor(u * track.N), l * ROAD_HALF * 0.8);
function spawnCrate(id, type, u, l, ax, az) {
  if (ax !== undefined) { // arena: odsuń paczkę od słupów
    for (const [ox, oz, or] of OBSTACLES) { const d = Math.hypot(ax - ox, az - oz); if (d < or + 3) { const k = (or + 3.5) / (d || 1); ax = ox + (ax - ox) * k; az = oz + (az - oz) * k; } }
    items.spawn(id, type, ax, az); return;
  }
  const idx = Math.floor(u * track.N), q = track.at(idx, l * ROAD_HALF * 0.8);
  items.spawn(id, type, q.x, q.z, track.hy ? track.heightAt(idx) : 0);
}
/** zebranie tego samego dodatku drugi raz daje ×2 (maks. 2 zapasy) */
function stackItem(k, msg) {
  const had = me.items[k] > 0; me.items[k] = Math.min(2, me.items[k] + 1);
  toast(had ? `${msg.split(' — ')[0]} ×${me.items[k]}` : msg); updateSlots();
}
function applyPickup(type) {
  sfx.pickup(type);
  if (isSoccer() && type === 'nitro') { soc.boost = 100; toast('Nitro — pełny zbiornik'); return; }
  if (isArena() && me.fullKit && ['bomb', 'rocket', 'shield', 'oil'].includes(type)) { me.stock[type] = Math.min(3, me.stock[type] + 1); toast(`${WEAPON_NAMES[type]} ×${me.stock[type]} — ${STOCK_KEYS[type]}`); updateSlots(); return; }
  if (isArena() && ['bomb', 'rocket', 'ammo', 'shield', 'oil'].includes(type)) { me.weapon = type; toast(`${WEAPON_NAMES[type]} — F`); updateSlots(); return; }
  if (!isArena() && type === 'bomb') { stackItem('mine', 'Mina — Q'); return; }
  if (type === 'nitro') { stackItem('nitro', 'Nitro — Shift'); return; }
  else if (type === 'ammo') { stackItem('ammo', 'Naboje — F (4 s ognia)'); return; }
  else if (type === 'repair') { setHp(me.hp + 40); toast('Naprawa +40'); }
  else { stackItem('oil', 'Olej — E'); return; }
  updateSlots();
}
const STOCK_KEYS = { bomb: 'Q', oil: 'E', rocket: 'T', shield: 'G' };
const racingNow = () => S.mode === 'racing' && !me.finished && !me.dead;
function useNitro() {
  if (isSoccer()) return;
  if (!racingNow() || !me.items.nitro || me.nitroT > 0) return;
  me.items.nitro--; me.nitroT = 2.5; sfx.nitro(); updateSlots();
}
/** F: uruchamia 4-sekundową serię (naboje można trzymać do dowolnego momentu) */
function fire() {
  if (isArena()) return fireArena();
  if (!racingNow()) return;
  if (!me.items.ammo || me.fireT > 0) { if (!me.fireT) sfx.empty(); return; }
  me.items.ammo--; me.fireT = 4; me.fireAcc = 0; updateSlots();
}
function shootOne() {
  const s = me.st;
  items.shoot(s.x, s.z, s.yaw, s.vx, s.vz, 'me'); sfx.shoot();
  if (!S.solo) socket?.emit('game:event', { t: 'shoot', x: s.x, z: s.z, yaw: s.yaw, vx: s.vx, vz: s.vz });
}
function dropOil() {
  if (!racingNow() || !me.items.oil) return;
  const s = me.st, x = s.x - Math.cos(s.yaw) * 3.4, z = s.z - Math.sin(s.yaw) * 3.4;
  items.dropOil(x, z, 'me'); me.items.oil--; sfx.oil(); updateSlots();
  if (!S.solo) socket?.emit('game:event', { t: 'oil', x, z });
}
function onGameEvent(e) {
  if (e.t === 'shoot') items.shoot(e.x, e.z, e.yaw, e.vx, e.vz, 'opp:' + e.from);
  else if (e.t === 'oil') items.dropOil(e.x, e.z, 'opp');
  else if (e.t === 'bomb') items.dropBomb(e.id, e.x, e.z, 'opp:' + e.from, isArena() ? undefined : (track.hy ? track.heightAt(track.query(e.x, e.z, -1).idx) : 0));
  else if (e.t === 'rocket') items.launchRocket(e.id, e.x, e.z, e.yaw, 'opp:' + e.from, () => entityById(e.to)?.st || null);
  else if (e.t === 'boom') { items.removeBomb(e.id); items.rockets.filter((r) => r.id === e.id).forEach((r) => { r.dead = true; }); blast(e.x, e.z, e.r, e.dmg); }
  else if (e.t === 'hit' && opps.get(e.to)?.raceBot) { damageBot(opps.get(e.to), 2.4); items.shots.filter((x) => x.owner === 'opp:' + e.from).forEach((x) => items.killShot(x)); }
  else if (e.t === 'hit' && e.to !== S.you) items.shots.filter((x) => x.owner === 'opp:' + e.from).forEach((x) => items.killShot(x));
  else if (e.t === 'hit' && me.st) {
    hitMe(); toast('Trafiony!', 1400);
    items.shots.filter((x) => x.owner === 'opp:' + e.from).forEach((x) => items.killShot(x));
  }
}
function updateBar() { $('ammo-bar').style.width = `${me.fireT > 0 ? clamp(me.fireT / 4, 0, 1) * 100 : clamp(me.shieldT / 5, 0, 1) * 100}%`; }
function updateSlots() {
  const arena = isArena(), full = !!me.fullKit;
  const cnt = (id, label, n) => { const el = $(id); el.querySelector('span').textContent = n > 0 ? `${label} ×${n}` : label; el.classList.toggle('has', n > 0); };
  { const sp = $('slot-nitro').querySelector('span'); if (sp) sp.textContent = me.items.nitro > 1 ? 'Nitro ×' + me.items.nitro : 'Nitro'; }
  $('slot-nitro').classList.toggle('has', me.items.nitro > 0 || me.nitroT > 0); $('slot-nitro').classList.toggle('active', me.nitroT > 0);
  $('slot-mine').classList.toggle('hidden', !(arena ? full : true));
  $('slot-rocket').classList.toggle('hidden', !(arena && full));
  $('slot-shield').classList.toggle('hidden', !(arena && full));
  if (arena) {
    const sh = me.shieldT > 0, gun = me.fireT > 0;
    $('slot-oil').classList.toggle('hidden', !full); $('slot-gun').classList.remove('hidden'); $('slot-gun').classList.toggle('has', me.gunCharge >= 1 && me.fireT <= 0);
    if (full) { cnt('slot-oil', 'Olej', me.stock.oil); cnt('slot-mine', 'Mina', me.stock.bomb); cnt('slot-rocket', 'Rakieta', me.stock.rocket); cnt('slot-shield', 'Tarcza', me.stock.shield); }
    $('slot-ammo').classList.toggle('has', !!me.weapon || sh || gun); $('slot-ammo').classList.toggle('active', sh || gun);
    $('slot-ammo').querySelector('span').textContent = gun ? 'Ogień!' : sh ? 'Tarcza!' : (WEAPON_NAMES[me.weapon] || 'Broń');
    $('ammo-bar').style.width = `${gun ? clamp(me.fireT / 4, 0, 1) * 100 : sh ? clamp(me.shieldT / 5, 0, 1) * 100 : 0}%`;
    return;
  }
  $('slot-oil').classList.remove('hidden'); $('slot-gun').classList.add('hidden'); $('slot-ammo').querySelector('span').textContent = me.items.ammo > 1 ? 'Strzał ×' + me.items.ammo : 'Strzał'; $('slot-oil').querySelector('span').textContent = me.items.oil > 1 ? 'Olej ×' + me.items.oil : 'Olej'; $('slot-mine').querySelector('span').textContent = me.items.mine > 1 ? 'Mina ×' + me.items.mine : 'Mina';
  $('slot-ammo').classList.toggle('has', me.items.ammo || me.fireT > 0);
  $('slot-ammo').classList.toggle('active', me.fireT > 0);
  $('slot-oil').classList.toggle('has', me.items.oil);
  $('slot-mine').classList.toggle('has', !!me.items.mine);
  $('ammo-bar').style.width = `${clamp(me.fireT / 4, 0, 1) * 100}%`;
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
  if (nb && me.tireCd <= 0) { me.st.vx *= 0.85; me.st.vz *= 0.85; me.tireCd = 0.35; sfx.tire(Math.min(1, me.st.speed / 40)); damage(2 + nb * 0.8); }
  for (const o of oppList()) world.tires.collide(o.st, 1.3, (x, z) => puff(x, z, 2));
  // pady przyspieszające i mini-turbo po długim dryfcie
  me.padCd = (me.padCd || 0) - dt;
  if (!isArena() && racingNow() && !me.dead && track.boosts?.length) {
    const N = track.N, idx = me.st.idx ?? 0;
    for (const b of track.boosts) {
      const di = (((idx - b.i0) % N) + N) % N;
      if (di < b.len && Math.abs(me.st.d || 0) < ROAD_HALF * 0.9 && !me.st.air && me.padCd <= 0) { me.padCd = 1.2; me.nitroT = Math.max(me.nitroT, 1.7); sfx.nitro(); sparks(me.st.x, me.st.z, 22); toast('Nitro!', 700); }
    }
  }
  { const sl = me.st, drifting = racingNow() && sl.hand && sl.speed > 16 && Math.abs(sl.vl) > 3.5;
    if (drifting) me.driftT = (me.driftT || 0) + dt;
    else { if ((me.driftT || 0) > 0.9 && racingNow()) { me.nitroT = Math.max(me.nitroT, Math.min(1.9, 0.5 + me.driftT * 0.4)); sfx.nitro(); toast('Mini-turbo!', 800); } me.driftT = 0; } }
  // olej i nitro
  me.st.inOil = items.inOil(me.st.x, me.st.z);
  if (me.nitroT > 0) { me.nitroT -= dt; me.st.nitro = me.nitroT > 0; if (me.nitroT <= 0) updateSlots(); } else me.st.nitro = isSoccer() && soc.boosting;
  if (me.fireT > 0) {
    if (me.finished) me.fireT = 0;
    else {
      me.fireT -= dt; me.fireAcc -= dt;
      if (me.fireAcc <= 0 && me.fireT > 0) { shootOne(); me.fireAcc = 0.12; }
      if (me.fireT <= 0) { me.fireT = 0; updateSlots(); } else updateBar();
    }
  }
  if (isArena()) {
    if (me.fireT <= 0 && me.gunCharge < 1) { me.gunCharge = Math.min(1, me.gunCharge + dt / 6); if (me.gunCharge >= 1) updateSlots(); }
    $('gun-bar').style.width = `${me.gunCharge * 100}%`;
  }
  if (me.shieldT > 0) { me.shieldT -= dt; if (me.shieldT <= 0) { me.shieldT = 0; updateSlots(); } else updateBar(); }
  // paczki: solo spawnuje lokalnie, w multiplayerze robi to serwer
  if (S.solo && S.mode === 'racing') {
    soloSpawn.t -= dt;
    if (soloSpawn.t <= 0) {
      const arena = isArena();
      soloSpawn.t = (arena ? 5 + Math.random() * 3 : 8 + Math.random() * 5) * ({ off: 1, rare: 1.8, normal: 1, often: 0.5 }[S.pickups]);
      if (S.pickups !== 'off' && (!isSoccer() || S.attacks) && items.crates.size < (arena ? 5 : 3)) {
        if (isSoccer()) spawnCrate(soloSpawn.id++, ['bomb', 'bomb', 'rocket', 'rocket', 'ammo', 'ammo', 'shield', 'repair', 'repair', 'nitro', 'oil'][Math.random() * 11 | 0], 0, 0, (Math.random() * 2 - 1) * HX * 0.8, (Math.random() * 2 - 1) * HZ * 0.8);
        else if (arena) { const a = Math.random() * 6.28, rad = Math.sqrt(Math.random()) * ARENA_R * 0.82; spawnCrate(soloSpawn.id++, ['bomb', 'bomb', 'rocket', 'rocket', 'ammo', 'ammo', 'shield', 'repair', 'repair', 'nitro', 'oil'][Math.random() * 11 | 0], 0, 0, Math.cos(a) * rad, Math.sin(a) * rad); }
        else spawnCrate(soloSpawn.id++, ['nitro', 'nitro', 'ammo', 'ammo', 'oil', 'repair', 'repair', 'bomb', 'bomb'][Math.random() * 9 | 0], Math.random(), (Math.random() - 0.5) * 1.3);
      }
    }
    for (const c of items.crates.values()) if (c.landed && !c.dying && c.age > 30) items.remove(c.id, false);
  }
  if (racingNow() && !me.dead) {
    const c = items.touch(me.st.x, me.st.z, 3, me.st.y || 0) || items.touch(me.st.x + Math.cos(me.st.yaw) * 1.6, me.st.z + Math.sin(me.st.yaw) * 1.6, 2.6, me.st.y || 0);
    if (c && !c.requested) {
      c.requested = true;
      if (S.solo) { applyPickup(c.type); items.remove(c.id); } else socket?.emit('pickup:take', { id: c.id });
    }
  }
  shotHits();
  updateArenaCombat(dt);
}

// ======================= Czat i reakcje =======================
const REACTIONS = ['GG!', 'Dobra jazda!', 'Uważaj!', 'Haha', 'Nie ze mną!', 'Pomocy!', 'Rewanż?', 'Ale numer!', 'Do mety!'];
const bubbles = new Map(); // id gracza -> { el, until }
let reactCd = 0;
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
  d.className = 'msg' + (m.sys ? ' sys' : '') + (m.react ? ' react' : '');
  if (!m.sys) { const b = document.createElement('b'); b.textContent = m.nick; b.style.color = m.color || '#fff'; d.append(b); }
  d.append(document.createTextNode(m.text));
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.append(d);
  while (log.children.length > 100) log.firstChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight; // przewinięta historia zostaje na miejscu
}
function showBubble(id, text) {
  const old = bubbles.get(id); if (old) old.el.remove();
  const el = document.createElement('div'); el.className = 'bubble'; el.textContent = text;
  $('bubbles').append(el); bubbles.set(id, { el, until: performance.now() + 4200 });
}
function clearChat() { $('chat-log').textContent = ''; for (const b of bubbles.values()) b.el.remove(); bubbles.clear(); }
function sendChat(text) {
  if (S.room && socket) socket.emit('chat', text); else showBubble('me', text.slice(0, 90));
}
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
    if (now > b.until || !ent?.st || ent.dead || S.mode === 'menu') { b.el.remove(); bubbles.delete(id); continue; }
    pv.set(ent.st.x, (ent.st.y || 0) + 6, ent.st.z).project(camera);
    if (!Number.isFinite(pv.x)) continue;
    b.el.style.transform = `translate(${((pv.x + 1) / 2) * W}px, ${((1 - pv.y) / 2) * H}px) translate(-50%, -100%)`;
  }
}
function renderRematch() {
  const box = $('rematch-box'), list = $('rematch-list');
  if (!S.room || S.solo || S.mode !== 'finished') { box.classList.add('hidden'); return; }
  box.classList.remove('hidden'); list.textContent = '';
  for (const p of S.room.players) {
    const row = document.createElement('div'); row.className = 'rm-row' + (p.id === S.you ? ' me' : '');
    row.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="st"></span>';
    row.querySelector('.dot').style.background = p.color;
    row.querySelector('.nm').textContent = p.nick + (p.id === S.you ? ' (Ty)' : '');
    const st = row.querySelector('.st'); st.textContent = p.ready ? 'Chce rewanż ✓' : 'Czeka…'; st.classList.toggle('ok', p.ready);
    list.append(row);
  }
}

// ---- boty wyścigowe ----
const RBOT_CARS = CAR_IDS.slice(1).concat(CAR_IDS[0]);
function spawnRaceBots(n) {
  const colors = CAR_COLORS.filter((c) => c !== S.color);
  for (let i = 0; i < n; i++) {
    const o = { id: 'bot' + i, nick: BOT_NAMES[i], carId: RBOT_CARS[i % 3], slot: i + 1, snaps: [], prevVf: 0, smokeAcc: 0, audio: null, vis: null, st: null, finished: false,
      bot: true, raceBot: true, skill: 0.9 + Math.random() * 0.06, lat: (Math.random() - 0.5) * 5, finishT: null, ai: { stuck: 0, rev: 0, revSteer: 1 }, hitCd: 0, hp: 100, shieldT: 0, nitroT: 0, weapon: null, fireT: 0, fireAcc: 0,
      custom: { num: 40 + i * 11, pattern: ['flames', 'checker', 'stripes'][i % 3], rim: ['mesh', 'turbine', 'solid'][i % 3], rimColor: '#d9dde6', plate: true } };
    opps.set(o.id, o); setCar(o, o.carId, o.slot, colors[(i * 3) % colors.length]); o.st.hp = 100;
  }
}
function raceBotUpdate(o, dt) {
  const st = o.st, ai = o.ai, N = track.N, i0 = Math.floor(st.idx ?? 0);
  o.hitCd -= dt;
  const finished = o.finishT != null;
  const bend = Math.abs(track.kappa[i0 % N]) > 0.02 ? 0.4 : 1;
  const tg = track.at((st.idx ?? 0) + 8 + st.speed * 0.33, o.lat * bend);
  const d = wrapA(Math.atan2(tg.z - st.z, tg.x - st.x) - st.yaw);
  let kmax = 0; for (let j = 0; j < 42; j += 6) kmax = Math.max(kmax, Math.abs(track.kappa[(i0 + j) % N]));
  const rb = clamp(((me.st?.progress ?? 0) - st.progress) / 700, -0.07, 0.07); // lekka „gumka”
  o.padT = (o.padT || 0) - dt;
  for (const b of track.boosts || []) { const di = (((st.idx ?? 0) - b.i0) % N + N) % N; if (di < b.len) o.padT = 1.4; }
  st.nitro = o.padT > 0;
  const vlim = Math.min(st.def.maxSpeed * (o.skill + rb) * (o.padT > 0 ? 1.3 : 1), Math.sqrt(52 / Math.max(kmax, 0.004)));
  const inp = { throttle: st.speed < vlim ? 1 : 0, brake: st.speed > vlim * 1.1 ? 1 : 0, steer: clamp(d * 2.4, -1, 1), hand: false };
  if (finished) { inp.throttle = 0; inp.brake = 0.5; inp.steer = 0; }
  if (st.speed < 2.5 && !st.air && !finished) ai.stuck += dt; else ai.stuck = 0;
  if (ai.stuck > 1.2) { ai.rev = 0.9; ai.stuck = 0; ai.revSteer = Math.random() < 0.5 ? -1 : 1; }
  if (ai.rev > 0) { ai.rev -= dt; inp.throttle = 0; inp.brake = 1; inp.steer = ai.revSteer; }
  st.inOil = items.inOil(st.x, st.z);
  stepCar(st, inp, dt);
  if (!me.dead) carVsCar(st, me.st);
  for (const q of oppList()) if (q !== o) carVsCar(st, q.st);
  if (!finished && st.progress >= N * S.lapsNow) { o.finishT = elapsed(); o.finished = true; if (!S.solo) socket?.emit('bot:finish', { id: o.id, time: o.finishT }); }
}
const packState = (s, o) => { const r = (v) => Math.round(v * 100) / 100; return [r(s.x), r(s.z), r(s.yaw), r(s.vx), r(s.vz), r(s.steer), r(s.vf), r(s.vl), r(s.progress), s.throttle || 0, s.brakeLit ? 1 : 0, s.onGrass ? 1 : 0, o.finishT != null ? 1 : 0, s.nitro ? 1 : 0, s.hand ? 1 : 0, 100, 0, Math.round((s.y || 0) * 10) / 10, 0]; };

// ======================= Powtórka =======================
const replay = { buf: [], on: false, auto: false, done: false, pos: 0, cam: 0, lastRec: 0, prevMode: null, segT: 0 };
function recordReplay(now) {
  if (now - replay.lastRec < 66) return; replay.lastRec = now;
  const cars = [];
  const add = (id, c) => { const q = c.st; if (!q) return; cars.push([id, q.x, q.z, q.y || 0, q.yaw, q.steer || 0, q.vf || 0, q.vl || 0, q.hand ? 1 : 0, q.nitro ? 1 : 0, q.air ? 1 : 0, c.dead ? 1 : 0, q.progress || 0]); };
  if (!S.spectator) add('me', me);
  for (const o of oppList()) add(o.id, o);
  replay.buf.push({ t: now, cars });
  while (replay.buf.length > 200) replay.buf.shift();
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
const lerpA = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };
function stepReplay(dt) {
  const buf = replay.buf; if (buf.length < 2) return;
  const dur = (buf[buf.length - 1].t - buf[0].t) / 1000;
  replay.pos += dt * 0.6; replay.segT += dt;
  if (replay.pos >= dur) { if (replay.auto) { closeReplay(false); return; } replay.pos = 0; replay.segT = 0; }
  const t = buf[0].t + replay.pos * 1000;
  let i = 0; while (i < buf.length - 2 && buf[i + 1].t < t) i++;
  const A = buf[i], B = buf[i + 1], k = clamp((t - A.t) / Math.max(1, B.t - A.t), 0, 1);
  for (const ca of A.cars) {
    const cb = B.cars.find((c) => c[0] === ca[0]) || ca, ent = replayEnt(ca[0]); if (!ent?.st) continue;
    const q = ent.st, l = (j) => ca[j] + (cb[j] - ca[j]) * k;
    q.x = l(1); q.z = l(2); q.y = l(3); q.yaw = lerpA(ca[4], cb[4], k); q.steer = l(5); q.vf = l(6); q.vl = l(7); q.hand = !!ca[8]; q.nitro = !!ca[9]; q.air = !!ca[10]; q.progress = l(12);
    q.vx = Math.cos(q.yaw) * q.vf; q.vz = Math.sin(q.yaw) * q.vf;
    ent.dead = !!ca[11]; if (ent.vis) ent.vis.group.visible = !ent.dead;
  }
}
/** kamera powtórki: pościg za zwycięzcą, widok z góry i z boku (auto zmienia co ~3,5 s) */
function replayCamera() {
  const last = replay.buf[replay.buf.length - 1]; if (!last) return null;
  const winId = S.results?.winner === S.you ? 'me' : S.results?.winner ?? 'me';
  const ent = replayEnt(replay.buf[0].cars.some((c) => c[0] === winId) ? winId : replay.buf[0].cars[0][0]) || me;
  const s = ent.st; if (!s) return null;
  const mode = replay.cam || 1 + (Math.floor(replay.segT / 3.5) % 3);
  const cs = Math.cos(s.yaw), sn = Math.sin(s.yaw), y = s.y || 0;
  if (mode === 1) return { pos: new THREE.Vector3(s.x - cs * 17, y + 9, s.z - sn * 17), look: new THREE.Vector3(s.x + cs * 9, y + 1, s.z + sn * 9), fov: 48 };
  if (mode === 3) return { pos: new THREE.Vector3(s.x - sn * 24 + cs * 6, y + 6, s.z + cs * 24 + sn * 6), look: new THREE.Vector3(s.x + cs * 3, y + 1, s.z + sn * 3), fov: 44 };
  const cars = [...replay.buf[0].cars].map((c) => replayEnt(c[0])?.st).filter(Boolean);
  const mx = cars.reduce((a, c) => a + c.x, 0) / cars.length, mz = cars.reduce((a, c) => a + c.z, 0) / cars.length;
  const spread = Math.max(40, ...cars.map((c) => Math.hypot(c.x - mx, c.z - mz)));
  const f = new THREE.Vector3(mx, y, mz);
  return { pos: f.clone().addScaledVector(CAM_DIR, spread * 4.2 + 60), look: f, fov: 26 };
}

// ======================= Pauza i menu w grze =======================
const pauseOpen = () => !$('pause').classList.contains('hidden');
const soloCount = { t: 0, step: 0 };
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
  if (S.paused) {
    S.paused = false;
    const d = performance.now() - S.pauseStart; // czas pauzy nie liczy się do wyścigu
    S.raceStart += d; me.lapStart += d; ghost.t0 += d; ghost.recStart += d; me.deadAt += d;
    setRainAudio();
  }
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
    el.addEventListener('input', () => {
      const v = +el.value; el.style.setProperty('--p', v + '%'); $(id + '-v').textContent = v + '%'; onVal(v / 100);
      const now = performance.now(); if (now - lastTick > 55) { lastTick = now; sfx.tick(v / 100); }
    });
    el.addEventListener('change', () => { sfx.click(); el.blur(); });
  };
  slider('sl-music', (v) => music.setVolume(v));
  slider('sl-sfx', (v) => setSfxVolume(v));
  document.querySelectorAll('#pause-cam button').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.c, false)));
  $('p-resume').addEventListener('click', () => closePause());
  $('p-restart').addEventListener('click', () => { closePause(true); startSolo(); });
  $('p-exit').addEventListener('click', () => { closePause(true); goMenu(); });
}

// ======================= Pętla gry =======================
let last = performance.now(), T = 0, sendAcc = 0, fpsAvg = 16, slowFrames = 0;
const tagEls = {};
function tagFor(key, nick, color) {
  if (!tagEls[key]) { const d = document.createElement('div'); d.className = 'tag'; d.innerHTML = '<i></i><span></span><b class="hpb"><u></u></b>'; d._hp = d.querySelector('u'); $('tags').append(d); tagEls[key] = d; }
  const d = tagEls[key];
  if (d._nick !== nick) { d.querySelector('span').textContent = nick; d._nick = nick; }
  d.firstChild.style.background = color;
  return d;
}
const pv = new THREE.Vector3();
function updateTags() {
  const racing = S.mode === 'countdown' || S.mode === 'racing' || S.mode === 'finished';
  const W = innerWidth, H = innerHeight;
  const place = (key, c, nick) => {
    const d = tagFor(key, nick, c?.color || '#fff');
    if (!racing || !c?.st || !c.vis || !nick || c.dead) { d.style.display = 'none'; return; }
    const hpv = c === me ? me.hp : c.st.hp ?? 100; d._hp.style.width = `${clamp(hpv, 0, 100)}%`; d._hp.style.background = hpv > 50 ? '#5be3a1' : hpv > 25 ? '#ffd84d' : '#ff4f6e';
    pv.set(c.st.x, (c.st.y || 0) + 3.4, c.st.z).project(camera);
    d.style.display = 'flex';
    d.style.transform = `translate(${((pv.x + 1) / 2) * W}px, ${((1 - pv.y) / 2) * H}px) translate(-50%, -100%)`;
  };
  place('me', me, S.solo ? S.nick : (S.room?.players.find((p) => p.id === S.you)?.nick ?? S.nick));
  const seen = new Set(['me']);
  for (const o of opps.values()) { place('o' + o.id, o, o.nick); seen.add('o' + o.id); }
  for (const k of Object.keys(tagEls)) if (!seen.has(k)) tagEls[k].style.display = 'none';
}

function frame(now) {
  requestAnimationFrame(frame);
  if (S.paused) { last = now; post.composer.render(0.016); return; }
  const dt = clamp((now - last) / 1000, 0.001, 0.05); last = now; T += dt;
  if (S.solo && S.mode === 'countdown') {
    soloCount.t += dt;
    const th = [0.8, 1.8, 2.8, 3.8];
    if (soloCount.step < 4 && soloCount.t >= th[soloCount.step]) { if (soloCount.step === 3) goRace(); else countTick(String(3 - soloCount.step)); soloCount.step++; }
  }
  // adaptacyjna rozdzielczość
  fpsAvg += (dt * 1000 - fpsAvg) * 0.05;
  if (fpsAvg > 30 && pr > 1) { if (++slowFrames > 90) { pr = Math.max(1, pr - 0.5); slowFrames = 0; resize(); } } else slowFrames = 0;

  readInput();
  const active = S.mode === 'racing' || S.mode === 'finished';
  const racing = active || S.mode === 'countdown';

  if (me.st && active) {
    if (me.dead) {
      me.respawnT -= dt; if (me.respawnT <= 0) respawn();
      for (const o of oppList()) refreshOpp(o);
    } else {
    const inp = me.finished ? { throttle: 0, brake: 0.3, steer: 0, hand: false } : input;
    stepCar(me.st, inp, dt);
    if (me.st.landHit > 0) damage(Math.min(30, me.st.landHit));
    if (me._wasAir && !me.st.air) sfx.land(0.5 + Math.min(0.5, me.st.landHit / 20));
    me._wasAir = !!me.st.air;
    if (me.st.surf === 'water' && me._surf !== 'water' && me.st.speed > 10) sfx.splash();
    me._surf = me.st.surf;
    if (me.inv > 0) { me.inv -= dt; me.vis.group.visible = me.inv <= 0 || Math.floor(me.inv * 10) % 2 === 0; }
    for (const o of oppList()) {
      if (refreshOpp(o) && !o.dead) {
        const h = carVsCar(me.st, o.st);
        if (h > 1.5 && me.hitCd <= 0) { sfx.carHit(h / 14); sparks((me.st.x + o.st.x) / 2, (me.st.z + o.st.z) / 2, h); me.hitCd = 0.15; if (isArena() && frontHit(me.st, o.st)) { if (!me._frontTip || performance.now() - me._frontTip > 6000) { me._frontTip = performance.now(); toast('Uderzenie przodem nie rani — chroń tył i boki', 2200); } } else damage(h * 0.7); }
      }
    }
    me.hitCd -= dt;
    if (me.st.hit > 3 && me.hitCd <= 0) { (isArena() && Math.hypot(me.st.x, me.st.z) < ARENA_R - 4 ? sfx.pillar : sfx.wall)(me.st.hit / 18); sparks(me.st.x, me.st.z, me.st.hit); me.hitCd = 0.2; damage(Math.min(35, (me.st.hit - 3) * (isArena() ? 0.55 : 0.9))); }
    }
    if (!isArena() && !me.dead && (S.mode === 'racing' || (S.mode === 'finished' && !me.finished && !S.solo))) onLapProgress();
  } else if (racing) for (const o of oppList()) refreshOpp(o);

  if (!isArena() && active && S.mode === 'racing') for (const o of oppList()) if (o.raceBot) raceBotUpdate(o, dt);
  if (isSoccer()) { if (active && S.mode === 'racing') soccerFrame(dt); else if (me.st) soccerIdle(dt); }
  else if (isArena() && active && S.mode === 'racing') { for (const o of oppList()) if (o.bot) botUpdate(o, dt); checkArenaSoloEnd(); }
  if (replay.on) stepReplay(dt);
  else if ((S.mode === 'racing' || S.mode === 'finished') && !S.results && !me.finished && !arenaEnd) recordReplay(now);
  if (me.st && active) ghostRecord(dt);
  ghostPlay(dt);
  if (me.st) updateGameplay(dt, active); else if (world) world.tires.update(dt);

  // wysyłanie stanu
  if (!S.solo && S.room && racing && socket && me.st && !S.spectator) {
    sendAcc += dt;
    if (sendAcc >= 0.033) {
      sendAcc = 0;
      const s = me.st, r = (v) => Math.round(v * 100) / 100;
      const hostBots = (!isArena() || isSoccer()) && S.room.players[0]?.id === S.you ? oppList().filter((o) => o.raceBot) : [];
      if (hostBots.length) socket.volatile.emit('race:bots', hostBots.map((o) => [o.id, packState(o.st, o)]));
      socket.volatile.emit('race:state', [r(s.x), r(s.z), r(s.yaw), r(s.vx), r(s.vz), r(s.steer), r(s.vf), r(s.vl), r(s.progress), input.throttle, s.brakeLit ? 1 : 0, s.onGrass ? 1 : 0, me.finished ? 1 : 0, s.nitro ? 1 : 0, s.hand ? 1 : 0, Math.round(me.hp), me.dead ? 1 : 0, Math.round((s.y || 0) * 10) / 10, me.shieldT > 0 ? 1 : 0]);
    }
  }

  // wizualizacja
  if (me.st) updateTilt(me.st);
  setShieldFx(me.vis, me.shieldT > 0 && !me.dead, T);
  for (const o of oppList()) setShieldFx(o.vis, o.bot ? o.shieldT > 0 : o.shield && !o.dead, T);
  if (me.vis && me.st) me.vis.sync(me.st, dt);
  for (const o of oppList()) {
    o.st.accelNow += (((o.st.vf - o.prevVf) / dt) - o.st.accelNow) * Math.min(1, dt * 6); o.prevVf = o.st.vf;
    if (!isArena() && track.hy && o.st.y !== undefined) { o.st.idx = ((o.st.progress % track.N) + track.N) % track.N; const gh = track.heightAt(o.st.idx); o.st.air = o.st.y - gh > 0.6; }
    if (isArena() && !o.bot) { const gh = heightAt(o.st.x, o.st.z); o.st.air = (o.st.y ?? gh) - gh > 0.6; if (o.st.y === undefined) o.st.y = gh; o.st.vy = 0; }
    updateTilt(o.st);
    o.vis.sync(o.st, dt);
  }
  if (racing) { carFx(me, 'me', dt); for (const o of oppList()) carFx(o, 'o' + o.id, dt); particles.yOff = 0; }
  particles.update(dt, camera, renderer.domElement.height);
  world.update(T);

  // dźwięk
  if (audioReady()) {
    if (!me.audio) me.audio = new CarAudio(0.85, 0);
    const maxS = (me.st?.def.maxSpeed || 45);
    me.audio.update({ speed: me.st ? me.st.vf / maxS : 0, throttle: racing && !me.finished ? input.throttle : 0, slip: me.st ? Math.max(clamp((me.st.slip - 4.5) / 8, 0, 1), me.st.hand && me.st.speed > 6 && !me.st.onGrass ? 0.95 : 0) * (active ? 1 : 0) : 0, rough: me.st && (me.st.onGrass || me.st.onKerb) && active ? 1 : 0, active: racing }, dt);
    for (const o of oppList()) {
      if (!o.audio) o.audio = new CarAudio(0.35, 0);
      pv.set(o.st.x, 0, o.st.z).project(camera); o.audio.panner.pan.value = Number.isFinite(pv.x) ? clamp(pv.x, -1, 1) * 0.6 : 0;
      o.audio.volume = 0.38 * clamp(1 - Math.hypot(o.st.x - (me.st?.x ?? 0), o.st.z - (me.st?.z ?? 0)) / 170, 0.12, 1);
      o.audio.update({ speed: o.st.vf / o.st.def.maxSpeed, throttle: o.st.throttle || 0, slip: Math.max(clamp((o.st.slip - 4.5) / 8, 0, 1), o.st.hand && Math.abs(o.st.vf) > 6 ? 0.9 : 0), rough: o.st.onGrass ? 1 : 0, active: racing }, dt);
    }
  }

  updateCamera(dt);
  updateEnvFx(dt);
  updateHud();
  updateBubbles();
  drawMinimap();
  updateTags();
  post.composer.render(dt);
}

// ======================= Piłka samochodowa =======================
const ball = makeBall();
const soc = { red: 0, blue: 0, left: 0, over: false, pause: false, pauseT: 0, ended: false, boost: 100, boosting: false, boostIdle: 0 };
let ballCd = 0;
let ballAcc = 0, bannerTimer = null;
const fmtClock = (t) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
const timeLimitNow = () => (S.solo ? S.timeLimit : S.room?.settings?.timeLimit ?? 0);
const goalLimitNow = () => (S.solo ? S.goalLimit : S.room?.settings?.goalLimit ?? 0);
function showBanner(text, color, ms = 3000) {
  const b = $('goal-banner'); b.textContent = text; b.style.color = color || '#fff'; b.classList.remove('hidden');
  b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  clearTimeout(bannerTimer); if (ms) bannerTimer = setTimeout(() => b.classList.add('hidden'), ms);
}
/** nowy mecz: wynik 0:0, piłka na środku, wskaźniki HUD */
function resetSoccer() {
  const on = isSoccer();
  $('soc-hud').classList.toggle('hidden', !on);
  $('hud').classList.toggle('soccer', on);
  $('goal-banner').classList.add('hidden');
  const noAtk = on && !attacksOn();
  $('hud').querySelector('.hud-items').classList.toggle('hidden', noAtk);
  $('boost-wrap').classList.toggle('hidden', !on);
  $('hud').querySelectorAll('.hplabel, .hpbar').forEach((e) => e.classList.toggle('hidden', noAtk));
  if (!on) return;
  Object.assign(soc, { red: 0, blue: 0, left: timeLimitNow(), over: false, pause: false, pauseT: 0, ended: false, boost: 100, boosting: false, boostIdle: 0 });
  resetBall(ball); ballAcc = 0;
  replay.done = true; // powtórka po meczu nie obejmuje piłki — pomijamy
  soccerHud();
}
function soccerHud() {
  $('boost-fill').style.width = `${soc.boost}%`; $('boost-wrap').classList.toggle('on', soc.boosting);
  setText('soc-red', String(soc.red)); setText('soc-blue', String(soc.blue));
  const lim = timeLimitNow();
  setText('soc-time', soc.over ? 'DOGRYWKA' : lim > 0 ? fmtClock(soc.left) : '∞');
  const g = goalLimitNow();
  setText('soc-info', soc.over ? 'złoty gol' : g > 0 ? `do ${g} goli` : '');
}
function spawnSoccerBots() {
  const ro = soccerRoster();
  for (let i = 0; i < S.bots; i++) {
    const e = ro.find((x) => x.key === 'bot' + i);
    const o = { id: 'bot' + i, bot: true, team: e?.team || 'blue', nick: BOT_NAMES[i], carId: CAR_IDS[(i + 1) % CAR_IDS.length], slot: i + 1, snaps: [], prevVf: 0, smokeAcc: 0, audio: null, vis: null, st: null, finished: false, hp: 100, weapon: null, shieldT: 0, fireT: 0, fireAcc: 0, nitroT: 0, hitCd: 0, ai: { stuck: 0, rev: 0, revSteer: 1 } };
    opps.set(o.id, o); setCar(o, o.carId, o.slot, o.color); o.st.hp = 100;
  }
}
function soccerBotUpdate(o, dt) {
  if (o.dead || !o.st) return;
  const st = o.st;
  const inp = soc.pause || soc.ended ? { throttle: 0, brake: 0.25, steer: 0, hand: false } : soccerBotInput(o, ball, st, dt, teamIdxOf(o));
  const ai = o.ai; ai.boost ??= 100; ai.idle ??= 0;
  if (inp.boost && ai.boost > 0) { ai.boost -= 40 * dt; st.nitro = true; ai.idle = 0.8; } else { st.nitro = false; ai.idle -= dt; if (ai.idle <= 0) ai.boost = Math.min(100, ai.boost + 18 * dt); }
  soccerStep(st, inp, dt);
  if (!me.dead) carVsCar(st, me.st);
  for (const q of oppList()) if (q !== o && !q.dead) carVsCar(st, q.st);
}
/** gol zgłoszony (solo: lokalnie, multiplayer: wiadomość z serwera) */
function soccerScoreMsg(m) {
  if (!isSoccer() || !m) return;
  soc.red = m.red; soc.blue = m.blue; soc.left = m.left; soc.over = !!m.over;
  if (m.scorer) {
    soc.pause = true; soc.pauseT = 3.6;
    showBanner(`GOL! ${TEAM_NAMES[m.scorer]}`, TEAM_COLORS[m.scorer], 3200);
    sfx.goal(); goalFx(m.scorer); world.goalFlash?.();
  } else if (m.over) showBanner('DOGRYWKA — złoty gol!', '#ffd84d', 3200);
  soccerHud();
}
function goalFx(team) {
  const gx = team === 'red' ? HX + 4 : -(HX + 4);
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * 6.28, sp = 4 + Math.random() * 16;
    tmpC.set(i % 3 === 0 ? TEAM_COLORS[team] : i % 3 === 1 ? '#ffffff' : '#ffd84d');
    particles.emit(gx, 3 + Math.random() * 3, (Math.random() - 0.5) * 18, Math.cos(a) * sp * 0.6, 6 + Math.random() * 12, Math.sin(a) * sp * 0.6, 1.4 + Math.random() * 1, 1.2, 3.5, tmpC, 0.9, 1, 4);
  }
}
function soccerKickoff() {
  if (!isSoccer()) return;
  resetBall(ball);
  placeAtSpawn(me); me.st.nitro = false;
  for (const o of oppList()) { placeAtSpawn(o); o.snaps = []; }
  soc.pause = false; soc.pauseT = 0; ballAcc = 0;
  $('goal-banner').classList.add('hidden');
  sfx.whistle();
}
function soccerEndSolo(team, reason) {
  if (soc.ended) return; soc.ended = true;
  setMode('finished');
  showResultsSoccer({ winner: team, score: { red: soc.red, blue: soc.blue }, reason, players: [], bots: [], mode: 'soccer' });
}
function soccerFrame(dt) {
  const host = S.solo || S.room?.players[0]?.id === S.you;
  for (const o of oppList()) if (o.bot && (S.solo || o.raceBot)) soccerBotUpdate(o, dt);
  // zegar i koniec meczu (w multiplayerze rozstrzyga serwer — tu tylko odliczanie wyświetlane)
  const lim = timeLimitNow();
  if (!soc.ended) {
    if (soc.pause) { soc.pauseT -= dt; if (S.solo && soc.pauseT <= 0) soccerKickoff(); }
    else if (lim > 0 && !soc.over) {
      soc.left = Math.max(0, soc.left - dt);
      if (S.solo && soc.left <= 0) {
        if (soc.red === soc.blue) { soc.over = true; showBanner('DOGRYWKA — złoty gol!', '#ffd84d', 3200); } else soccerEndSolo(soc.red > soc.blue ? 'red' : 'blue', 'time');
      }
    }
  }
  const wantBoost = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && !me.dead && S.mode === 'racing' && !soc.pause;
  if (wantBoost && soc.boost > 0) { soc.boost = Math.max(0, soc.boost - 40 * dt); soc.boosting = true; soc.boostIdle = 0.8; }
  else { soc.boosting = false; soc.boostIdle -= dt; if (soc.boostIdle <= 0) soc.boost = Math.min(100, soc.boost + 18 * dt); }
  ballCd -= dt;
  const cars = [];
  if (!soc.pause && !soc.ended) { if (!me.dead) cars.push(me.st); if (host) for (const o of oppList()) if (!o.dead) cars.push(o.st); }
  const out = stepBall(ball, dt, cars);
  if (out.hit > 2.5) {
    sfx.kick(out.hit / 36);
    if (out.hit > 5 && ballCd <= 0) {
      ballCd = 0.2; sparks(ball.x, ball.z, out.hit * 1.2);
      if (!me.dead && Math.hypot(me.st.x - ball.x, me.st.z - ball.z) < BR + 4.5) { me.st.vx *= 0.965; me.st.vz *= 0.965; }
    }
  }
  else if (out.wall > 7 || out.ground > 6) sfx.bounce(Math.max(out.wall, out.ground) / 32);
  if (out.goal && host && !soc.pause && !soc.ended) {
    soc.pause = true; soc.pauseT = 3.6;
    if (S.solo) {
      soc[out.goal]++;
      const g = goalLimitNow(), win = soc.over || (g > 0 && soc[out.goal] >= g);
      soccerScoreMsg({ red: soc.red, blue: soc.blue, left: soc.left, over: soc.over, scorer: out.goal });
      if (win) setTimeout(() => { if (S.solo && isSoccer()) soccerEndSolo(out.goal, soc.over ? 'golden' : 'goals'); }, 1800);
    } else socket?.emit('soccer:goal', { team: out.goal });
  }
  if (host && !S.solo && socket) {
    ballAcc += dt;
    if (ballAcc >= 0.033) { ballAcc = 0; const q = (v) => Math.round(v * 100) / 100; socket.volatile.emit('soccer:ball', [q(ball.x), q(ball.y), q(ball.z), q(ball.vx), q(ball.vy), q(ball.vz)]); }
  }
  soccerIdle(dt);
}
/** wygładzenie i rysowanie piłki (także w menu/lobby) + HUD */
function soccerIdle(dt) {
  smoothBall(ball, dt); world.setBall?.(ball);
  const sp = Math.hypot(ball.vx, ball.vz);
  if (sp > 20 && S.mode === 'racing') { tmpC.set(sp > 38 ? '#ffb347' : '#ffffff'); particles.emit(ball.rx, ball.ry, ball.rz, -ball.vx * 0.04, 0.4, -ball.vz * 0.04, 0.45, 1.3, 0.2, tmpC, 0.55, 1.5, 0); }
  if (S.mode === 'racing' || S.mode === 'finished') soccerHud();
}
function showResultsSoccer(d) {
  const mineTeam = me.team, won = d.winner === mineTeam && !S.spectator;
  $('rank-results').parentElement.querySelectorAll('h4, #rank-results').forEach((e) => e.classList.toggle('hidden', S.solo));
  $('res-title').className = 'res-title' + (won || S.spectator ? '' : ' lose');
  $('res-title').textContent = S.spectator ? `Wygrywa drużyna: ${TEAM_NAMES[d.winner]}` : won ? 'Wygrana!' : 'Porażka';
  $('res-sub').textContent = `${TEAM_NAMES.red} ${d.score.red} : ${d.score.blue} ${TEAM_NAMES.blue}` + (d.reason === 'left' ? ' — przeciwnicy opuścili mecz' : d.reason === 'time' ? ' — koniec czasu' : d.reason === 'golden' ? ' — złoty gol' : '');
  const t = $('res-table'); t.textContent = '';
  const head = document.createElement('tr'); head.innerHTML = '<th>Drużyna</th><th>Skład</th>'; t.append(head);
  const ro = S.solo ? [{ nick: S.nick + ' (Ty)', team: 'red' }, ...oppList().map((o) => ({ nick: o.nick + ' (bot)', team: o.team }))] : [...d.players, ...(d.bots || [])].map((p) => ({ nick: p.nick + (p.id === S.you ? ' (Ty)' : p.bot ? ' (bot)' : ''), team: p.team }));
  for (const tm of ['red', 'blue']) {
    const tr = document.createElement('tr'); if (tm === d.winner) tr.className = 'win';
    const a = document.createElement('td'); a.textContent = `${TEAM_NAMES[tm]} — ${d.score[tm]}`; a.style.color = TEAM_COLORS[tm];
    const b = document.createElement('td'); b.textContent = ro.filter((x) => x.team === tm).map((x) => x.nick).join(', ') || '—';
    tr.append(a, b); t.append(tr);
  }
  if (d.ranking) renderRanking(d.ranking, 'soccer');
  $('btn-rematch').classList.toggle('hidden', !!S.spectator);
  if (!S.resultSounded) { S.resultSounded = true; (won ? sfx.win : sfx.lose)(); $('btn-rematch').classList.remove('on'); if (S.solo) { $('btn-rematch').textContent = 'Jeszcze raz'; $('btn-rematch').disabled = false; } }
  if (!S.solo) updateResultsButtons();
  showScreen('results');
}

function updateCamera(dt) {
  const racingView = S.mode === 'countdown' || S.mode === 'racing' || S.mode === 'finished';
  let pos, look, fov, shift, tilt;
  void racingView;
  const rc = S.mode === 'replay' ? replayCamera() : null;
  if (rc) { pos = rc.pos; look = rc.look; fov = rc.fov; shift = 0; tilt = 0.7; cam.racingT = 99; }
  else if (racingView && me.st) {
    // kamera podąża za moim autem; oddala się, gdy rywal jest daleko
    const subj = me.dead && (isArena() || S.spectator) ? spectateTarget() : null;
    const m = subj ? subj.st : me.st;
    let fx = m.x + m.vx * 0.28, fz = m.z + m.vz * 0.28;
    let half = (isArena() ? 33 : 27) + clamp(m.speed - 15, 0, 48) * 0.2;
    let near = null, nd = 1e9;
    for (const o of oppList()) { if (o.st === m || o.dead) continue; const d = Math.hypot(o.st.x - m.x, o.st.z - m.z); if (d < nd) { nd = d; near = o; } }
    if (isSoccer()) { // kamera obejmuje auto i piłkę
      const dx = ball.rx - m.x, dz = ball.rz - m.z, d = Math.hypot(dx, dz), w = 0.34 * clamp(d / 50, 0, 1);
      fx += dx * w; fz += dz * w; half = Math.max(half, 24 + d * 0.42);
    } else if (near) {
      const dx = near.st.x - m.x, dz = near.st.z - m.z, d = nd;
      const w = 0.25 * clamp(d / 60, 0, 1);
      fx += dx * w; fz += dz * w;
      half = Math.max(half, 20 + d * 0.5);
    }
    half = Math.min(half, 80);
    if (S.cam === 'chase') { // widok zza auta
      cam.yaw = cam.yaw === undefined || cam.first ? m.yaw : lerpA(cam.yaw, m.yaw, 1 - Math.exp(-dt * 4.5));
      const cs2 = Math.cos(cam.yaw), sn2 = Math.sin(cam.yaw), y0 = m.y || 0;
      pos = new THREE.Vector3(m.x - cs2 * 15.5, y0 + 7.4, m.z - sn2 * 15.5); look = new THREE.Vector3(m.x + cs2 * 13, y0 + 1.6, m.z + sn2 * 13);
      fov = 58 + (m.nitro ? 6 : 0) + clamp(m.speed - 25, 0, 25) * 0.18; shift = 0; tilt = 0.18; cam.racingT = (cam.racingT ?? 0) + dt;
    } else {
    const fy = (m.y || 0) * 0.9;
    if (cam.first || cam.racingT === undefined) { cam.focus.set(fx, fy, fz); cam.half = half; }
    cam.focus.y += (fy - cam.focus.y) * (1 - Math.exp(-dt * 5));
    cam.half += (half - cam.half) * (1 - Math.exp(-dt * 1.8));
    cam.focus.x += (fx - cam.focus.x) * (1 - Math.exp(-dt * 6)); cam.focus.z += (fz - cam.focus.z) * (1 - Math.exp(-dt * 6));
    pos = cam.focus.clone().addScaledVector(CAM_DIR, cam.half * 3.9); look = cam.focus.clone();
    fov = RACE_FOV + clamp((m.speed - 22) / 40, 0, 1) * 4.5 + (m.nitro ? 4.5 : 0); shift = 0; tilt = 0.9;
    cam.racingT = (cam.racingT ?? 0) + dt;
    }
  } else {
    const ol = oppList();
    const base = me.st || ol[0]?.st;
    const P = new THREE.Vector3(base ? base.x : 0, S.mode === 'menu' || S.mode === 'lobby' ? -2.3 : 0.8, base ? base.z : 0); // w menu auto wyżej w kadrze (nad garażem)
    const menuView = S.mode === 'menu' || S.mode === 'lobby', a = T * 0.2 + 0.5, r = menuView ? (S.game === 'race' ? 25 : 32) : 15.5 + ol.length * 1.5;
    pos = new THREE.Vector3(P.x + Math.cos(a) * r, (menuView ? r * 0.5 : 8.2) + Math.sin(T * 0.4) * 0.8, P.z + Math.sin(a) * r);
    look = P.clone(); fov = 36;
    if (menuView && menuTab === 'track' && S.game === 'race' && track?.bounds) { // zakładka Tor: widok z góry obejmujący cały tor
      const b = track.bounds, ex = b.maxX - b.minX, ez = b.maxZ - b.minZ, d = Math.max(ez * 2.1, ex * 1.5);
      look = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2); pos = look.clone().add(new THREE.Vector3(0, d * 0.92, d * 0.4));
    } shift = 0; tilt = 0.35;
  }
  if (!racingView) cam.racingT = undefined;
  { const ov = S.mode === 'menu' && menuTab === 'track' && S.game === 'race'; if (world.skyline) for (const o of world.skyline) o.visible = !ov; rain.visible = envNow.weather !== 'sun' && !ov; } // w podglądzie toru chowamy wieżowce
  const k = cam.first ? 1 : 1 - Math.exp(-dt * (racingView ? 2.6 + Math.min(1, cam.racingT / 1.4) * 8 : 2.4));
  cam.first = false;
  cam.pos.lerp(pos, k); cam.look.lerp(look, k);
  cam.fov += (fov - cam.fov) * k; cam.shift += (shift - cam.shift) * k; cam.tilt += (tilt - cam.tilt) * k;
  camera.position.copy(cam.pos); camera.lookAt(cam.look);
  if (racingView && me.st && S.mode === 'racing' && !me.dead) { // drżenie kamery przy nitro i dużej prędkości
    const spd = me.st.speed, amp = (me.st.nitro ? 0.5 : 0) + clamp((spd - 50) / 40, 0, 1) * 0.3;
    if (amp > 0.01) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp * 0.6, (Math.random() - 0.5) * amp));
  }
  if (world.occ) { world.occ.cam.value.copy(camera.position); const sm = me.st; if (sm && racingView) world.occ.car.value.set(sm.x, (sm.y || 0) + 1, sm.z); else world.occ.car.value.copy(cam.look); }
  camera.fov = cam.fov;
  const dist = cam.pos.distanceTo(cam.look);
  camera.near = Math.max(0.5, dist * 0.1); camera.far = dist * 4 + 1800;
  const W = innerWidth, H = innerHeight;
  if (Math.abs(cam.shift) > 0.002) camera.setViewOffset(W, H, -W * cam.shift, 0, W, H); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  post.tilt.uniforms.uAmount.value = cam.tilt;
  if (rain.visible) { rain.material.uniforms.uTime.value = T; rain.material.uniforms.uCenter.value.copy(cam.look).setY(Math.max(0, cam.look.y - 8)); }
  scene.fog.near = Math.max(160, dist * 1.5) * (envNow.weather !== 'sun' ? 0.55 : envNow.time === 'night' ? 0.5 : 1); scene.fog.far = scene.fog.near + Math.max(900, dist * 3);
}

let hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function updateHud() {
  if ($('hud').classList.contains('hidden') || !me.st) { $('speedfx').style.opacity = 0; return; }
  { const sp0 = S.mode === 'racing' && !me.dead ? me.st.speed : 0; $('speedfx').style.opacity = (clamp((sp0 - 44) / 32, 0, 1) * 0.5 + (me.st.nitro && sp0 > 20 ? 0.3 : 0)).toFixed(2); }
  const sp = Math.abs(me.st.vf);
  setText('hud-speed', String(Math.round(sp * 3.8)));
  const hpEl = $('hud-hp'); hpEl.style.width = `${me.hp}%`; hpEl.style.background = me.hp > 50 ? '#5be3a1' : me.hp > 25 ? '#ffd84d' : '#ff4f6e'; hpEl.parentElement.classList.toggle('low', me.hp < 30);
  $('hud-bar').style.width = `${clamp(sp / me.st.def.maxSpeed, 0, 1) * 100}%`;
  if (S.mode === 'racing' && !me.finished) setText('hud-time', fmt(elapsed()));
  else if (me.finished) setText('hud-time', fmt(me.finishTime));
  if (opps.size) {
    if (isArena()) setText('hud-pos', `${(me.dead ? 0 : 1) + oppList().filter((o) => !o.dead).length}/${opps.size + 1}`);
    else setText('hud-pos', `${1 + oppList().filter((o) => o.st.progress > me.st.progress).length}/${opps.size + 1}`);
  }
  setText('hud-lap', `${clamp(me.lapIdx + 1, 1, S.lapsNow)}/${S.lapsNow}`);
}

// ======================= Start =======================
function bindUi() {
  document.addEventListener('click', (e) => { if (e.target.closest('button')) { if (!audioReady()) initAudio(); sfx.click(); } });
  document.addEventListener('pointerover', (e) => { const b = e.target.closest?.('.car, .btn'); if (b && b !== bindUi.hv) { bindUi.hv = b; sfx.hover(); } });
  $('chat-form').addEventListener('submit', (e) => { e.preventDefault(); const t = $('chat-input').value.trim(); if (t) sendChat(t); closeChat(); });
  $('chat-input').addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== $('chat-input')) closeChat(); }, 100));
  $('rank-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; rankTab = b.dataset.m; document.querySelectorAll('#rank-tabs button').forEach((x) => x.classList.toggle('sel', x === b)); renderRanking(); });
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
  $('btn-ready').addEventListener('click', () => {
    const mine = S.room?.players.find((p) => p.id === S.you);
    socket?.emit('player:ready', !mine?.ready);
  });
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
  buildCarList();
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
  setCar(me, S.carId, 0, S.color);
  requestAnimationFrame(frame);
  $('loading').classList.add('done');
  setTimeout(() => $('loading').remove(), 700);
  if (S.nick) goMenu(); else { showScreen('nick'); $('inp-nick').focus(); }
  window.__tc = { S, me, opps, ghost, music, replay, items, camera, scene, keys, startSolo, ball, soc, finishLocal, applyPickup, post, get track() { return track; }, get world() { return world; } };
})();
