// Proceduralny świat: asfalt, krawężniki, bariery, trybuny, drzewa, skały, billboardy — wszystko z kodu.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ROAD_HALF, KERB_W, BARRIER } from './track.js';
import { TireField } from './tires.js';

// deterministyczny generator losowy — ten sam świat u obu graczy
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function canvasTex(w, h, draw, { repeat = null, aniso = 8 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

/** Pasy czworokątów wzdłuż toru między przesunięciami bocznymi offA..offB. */
function strip(track, offA, offB, y, { pred = () => true, vScale = 8, color = null, from = 0, to = track.N } = {}) {
  const pos = [], uv = [], col = [], idx = [];
  const N = track.N;
  let vcount = 0;
  const c = new THREE.Color();
  for (let i = from; i < to; i++) {
    if (!pred(i)) continue;
    const j = (i + 1) % N;
    const v0 = i * track.ds / vScale, v1 = (i + 1) * track.ds / vScale;
    const quad = [[i, offA, 0, v0], [i, offB, 1, v0], [j, offB, 1, v1], [j, offA, 0, v1]];
    for (const [k, off, u, v] of quad) {
      const nx = -track.tz[k], nz = track.tx[k];
      pos.push(track.x[k] + nx * off, typeof y === 'function' ? y(k) : y, track.z[k] + nz * off);
      uv.push(u, v);
      if (color) { color(i, c); col.push(c.r, c.g, c.b); }
    }
    idx.push(vcount, vcount + 1, vcount + 2, vcount, vcount + 2, vcount + 3);
    vcount += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Pionowa ściana wzdłuż toru na stałym przesunięciu bocznym. */
function wall(track, off, y0, y1, { pred = () => true, uScale = 4 } = {}) {
  const pos = [], uv = [], idx = [];
  let n = 0;
  for (let i = 0; i < track.N; i++) {
    if (!pred(i)) continue;
    const j = (i + 1) % track.N;
    for (const [k, y, u, v] of [[i, y0, i * track.ds / uScale, 0], [i, y1, i * track.ds / uScale, 1], [j, y1, (i + 1) * track.ds / uScale, 1], [j, y0, (i + 1) * track.ds / uScale, 0]]) {
      pos.push(track.x[k] - track.tz[k] * off, y, track.z[k] + track.tx[k] * off); uv.push(u, v);
    }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}


export const THEMES = {
  lato: { sky: 0xb9c5e4, hemi: [0xcfdcff, 0x7a6a8a, 0.85], sun: [0xffdfb8, 3.1], grass: [95, 156, 73], light: [135, 195, 85], dark: [35, 90, 50], flowers: true,
    gravel: '#a1694a', gravel2: '#b87a55', gravelA: 'rgba(235,180,130,0.28)', gravelB: 'rgba(80,45,30,0.3)', asphalt: '#58536f',
    foliage: ['#6b4a33', '#2f7d4a', '#38905a', '#43a468'], trees: 240, rock: 0xa7a5b4, rocks: 70, bush: [0.27, 0.5, 0.3], bushes: 150 },
  pustynia: { sky: 0xf0d3a8, hemi: [0xffe6c0, 0x9a7a5a, 0.9], sun: [0xffc487, 3.5], grass: [217, 184, 120], light: [236, 206, 150], dark: [190, 150, 90], flowers: false,
    gravel: '#a9764f', gravel2: '#c28f62', gravelA: 'rgba(255,215,160,0.3)', gravelB: 'rgba(90,55,30,0.3)', asphalt: '#625b6b',
    foliage: ['#7a5a3a', '#8f8a3e', '#a39a4a', '#b6ab58'], trees: 90, rock: 0xc09270, rocks: 140, bush: [0.12, 0.45, 0.4], bushes: 90 },
  zima: { sky: 0xcfdcf0, hemi: [0xe2eeff, 0x8f9db8, 1.0], sun: [0xe8f0ff, 2.7], grass: [232, 238, 246], light: [250, 252, 255], dark: [170, 186, 210], flowers: false,
    gravel: '#8d96a6', gravel2: '#a6aebb', gravelA: 'rgba(255,255,255,0.35)', gravelB: 'rgba(60,70,90,0.28)', asphalt: '#4c4b5e',
    foliage: ['#5b4331', '#2a6b50', '#3b8062', '#eef5f8'], trees: 260, rock: 0x9aa2b2, rocks: 80, bush: [0.45, 0.2, 0.55], bushes: 70 },
};
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function asphaltTexture(base = '#58536f') {
  const rnd = rng(11);
  return canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = base; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { // plamy
      const px = rnd() * w, py = rnd() * h, r = 30 + rnd() * 90;
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      const d = rnd() > 0.5;
      g.addColorStop(0, d ? 'rgba(30,26,48,0.16)' : 'rgba(120,112,150,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
    }
    // ślady kół (stałe wzdłuż v → bezszwowe)
    for (const [u, wd] of [[0.3, 0.1], [0.7, 0.1], [0.5, 0.2]]) {
      const g = x.createLinearGradient((u - wd) * w, 0, (u + wd) * w, 0);
      g.addColorStop(0, 'rgba(20,16,34,0)'); g.addColorStop(0.5, 'rgba(20,16,34,0.2)'); g.addColorStop(1, 'rgba(20,16,34,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    }
    for (let i = 0; i < 22000; i++) {
      const l = rnd();
      x.fillStyle = l > 0.5 ? `rgba(190,185,215,${0.05 + rnd() * 0.1})` : `rgba(15,12,28,${0.08 + rnd() * 0.12})`;
      x.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 1.6, 1 + rnd() * 1.6);
    }
  });
}

function grassTile(T) {
  const rnd = rng(5);
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = rgb(T.grass); x.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      x.fillStyle = rnd() > 0.5 ? rgb(T.light, 0.1 + rnd() * 0.14) : rgb(T.dark, 0.1 + rnd() * 0.16);
      const s = 1 + rnd() * 2.5; x.fillRect(rnd() * w, rnd() * h, s, s * (1 + rnd() * 2));
    }
  }, { repeat: [150, 150] });
}

function checkerTex(cols, rows) {
  return canvasTex(64 * cols, 64 * rows, (x, w, h) => {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { x.fillStyle = (r + c) % 2 ? '#101018' : '#f4f4f8'; x.fillRect(c * 64, r * 64, 64, 64); }
  }, { aniso: 8 });
}

function fenceTex() {
  return canvasTex(128, 128, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.strokeStyle = 'rgba(205,210,220,0.95)'; x.lineWidth = 3;
    for (let i = -h; i < w + h; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + h, h); x.stroke(); x.beginPath(); x.moveTo(i + h, 0); x.lineTo(i, h); x.stroke(); }
  }, { aniso: 4 });
}

function billboardTex(text, bg, fg) {
  return canvasTex(512, 160, (x, w, h) => {
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,0.12)'; x.beginPath(); x.moveTo(0, h); x.lineTo(w * 0.35, 0); x.lineTo(w * 0.5, 0); x.lineTo(w * 0.15, h); x.fill();
    x.fillStyle = fg; x.font = 'italic 800 84px system-ui, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, w / 2, h / 2 + 4);
    x.strokeStyle = fg; x.lineWidth = 6; x.strokeRect(8, 8, w - 16, h - 16);
  });
}

export function buildWorld(scene, renderer, track) {
  const T = THEMES[track.def.theme];
  const root = new THREE.Group();
  scene.add(root);
  const world = { time: { value: 0 }, root, theme: T };
  const N = track.N;
  const rnd = rng(2024);

  // ---------- Światło i środowisko ----------
  if (!scene.environment) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.42;
  }
  world.sky = new THREE.Color(T.sky);
  const hemi = new THREE.HemisphereLight(T.hemi[0], T.hemi[1], T.hemi[2]);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(T.sun[0], T.sun[1]);
  const cx = (track.bounds.minX + track.bounds.maxX) / 2, cz = (track.bounds.minZ + track.bounds.maxZ) / 2;
  sun.position.set(cx - 130, 150, cz + 115);
  sun.target.position.set(cx, 0, cz);
  sun.castShadow = true;
  const sm = Math.min(4096, renderer.capabilities.maxTextureSize);
  sun.shadow.mapSize.set(sm, sm);
  const S = 190;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S * 0.78, bottom: -S * 0.78, near: 20, far: 520 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  root.add(sun, sun.target);
  world.sun = sun;

  // ---------- Teren ----------
  const far = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ map: grassTile(T), roughness: 1 }));
  far.rotation.x = -Math.PI / 2; far.position.y = -0.06; far.receiveShadow = true;
  root.add(far);

  const M = 150;
  const gb = { x0: track.bounds.minX - M, x1: track.bounds.maxX + M, z0: track.bounds.minZ - M, z1: track.bounds.maxZ + M };
  const GW = gb.x1 - gb.x0, GH = gb.z1 - gb.z0;
  const PPU = 2560 / Math.max(GW, GH);
  const groundTex = canvasTex(Math.round(GW * PPU), Math.round(GH * PPU), (x, w, h) => {
    const X = (px) => (px - gb.x0) * PPU, Z = (pz) => (pz - gb.z0) * PPU;
    x.fillStyle = rgb(T.grass); x.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) { // duże plamy odcieni trawy
      const px = rnd() * w, py = rnd() * h, r = 40 + rnd() * 160, dark = rnd() > 0.45;
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, dark ? rgb(T.dark, 0.16) : rgb(T.light, 0.15)); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
    }
    for (let i = 0; i < 26000; i++) {
      x.fillStyle = rnd() > 0.5 ? rgb(T.light, 0.1 + rnd() * 0.15) : rgb(T.dark, 0.1 + rnd() * 0.16);
      x.fillRect(rnd() * w, rnd() * h, 1.5 + rnd() * 2, 2 + rnd() * 4);
    }
    for (let i = 0; i < (T.flowers ? 1400 : 0); i++) { // kwiatki
      x.fillStyle = ['#fff6d8', '#ffd84d', '#ff9fc4', '#ffffff'][rnd() * 4 | 0];
      x.globalAlpha = 0.65; x.beginPath(); x.arc(rnd() * w, rnd() * h, 1.4 + rnd() * 1.4, 0, 6.3); x.fill();
    }
    x.globalAlpha = 1;
    // żwir i pas wybiegu wzdłuż toru
    const path = new Path2D();
    for (let i = 0; i < N; i++) { const px = X(track.x[i]), pz = Z(track.z[i]); i ? path.lineTo(px, pz) : path.moveTo(px, pz); }
    path.closePath();
    x.lineJoin = 'round'; x.lineCap = 'round';
    x.strokeStyle = 'rgba(25,40,25,0.35)'; x.lineWidth = 2 * (BARRIER + 1.6) * PPU; x.stroke(path);
    x.strokeStyle = T.gravel; x.lineWidth = 2 * (BARRIER - 0.2) * PPU; x.stroke(path);
    x.strokeStyle = T.gravel2; x.lineWidth = 2 * (ROAD_HALF + KERB_W + 1.4) * PPU; x.stroke(path);
    for (let i = 0; i < 18000; i++) { // ziarenka żwiru
      const k = rnd() * N | 0, off = (ROAD_HALF + 1.5 + rnd() * (BARRIER - ROAD_HALF - 2)) * (rnd() > 0.5 ? 1 : -1);
      const px = X(track.x[k] - track.tz[k] * off), pz = Z(track.z[k] + track.tx[k] * off);
      x.fillStyle = rnd() > 0.5 ? T.gravelA : T.gravelB;
      x.fillRect(px, pz, 1.5, 1.5);
    }
  }, { aniso: 8 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GW, GH), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.96 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set((gb.x0 + gb.x1) / 2, 0, (gb.z0 + gb.z1) / 2);
  ground.receiveShadow = true;
  root.add(ground);

  // ---------- Asfalt, krawężniki, linie ----------
  const asphalt = new THREE.Mesh(strip(track, -ROAD_HALF, ROAD_HALF, 0.02, { vScale: 16 }),
    new THREE.MeshStandardMaterial({ map: asphaltTexture(T.asphalt), roughness: 0.88, metalness: 0.0 }));
  asphalt.receiveShadow = true; root.add(asphalt);

  // kerby na wewnętrznej stronie zakrętów
  const KT = 0.02;
  const hasKerb = new Uint8Array(N);
  for (let i = 0; i < N; i++) hasKerb[i] = Math.abs(track.kappa[i]) > KT ? 1 : 0;
  const dil = new Uint8Array(N);
  for (let i = 0; i < N; i++) { for (let j = -6; j <= 6; j++) if (hasKerb[(i + j + N) % N]) { dil[i] = 1; break; } }
  const kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  const red = new THREE.Color('#d6242c'), white = new THREE.Color('#f5f2ee');
  const kerbCol = (i, c) => c.copy(Math.floor(i / 3) % 2 ? red : white);
  for (const side of [1, -1]) {
    const g = strip(track, side > 0 ? ROAD_HALF : -ROAD_HALF - KERB_W, side > 0 ? ROAD_HALF + KERB_W : -ROAD_HALF, 0.04,
      { pred: (i) => dil[i] && Math.sign(track.kappa[i]) === side, color: kerbCol });
    const m = new THREE.Mesh(g, kerbMat); m.receiveShadow = true; root.add(m);
  }
  // linie krawędziowe i przerywana oś
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf0eef6, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const s of [-1, 1]) {
    const a = s * (ROAD_HALF - 0.75), b = s * (ROAD_HALF - 0.4);
    const m = new THREE.Mesh(strip(track, Math.min(a, b), Math.max(a, b), 0.03, {}), lineMat); m.receiveShadow = true; root.add(m);
  }
  const dash = new THREE.Mesh(strip(track, -0.14, 0.14, 0.03, { pred: (i) => Math.floor(i / 5) % 2 === 0 }), lineMat);
  dash.receiveShadow = true; root.add(dash);
  // linia startu
  const finish = new THREE.Mesh(strip(track, -ROAD_HALF, ROAD_HALF, 0.035, { pred: (i) => i === 0 || i === 1, vScale: 2 }),
    new THREE.MeshStandardMaterial({ map: checkerTex(8, 2), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  finish.receiveShadow = true; root.add(finish);
  // pola startowe
  const slotTex = canvasTex(256, 160, (x, w, h) => {
    x.strokeStyle = 'rgba(245,243,250,0.9)'; x.lineWidth = 7; x.strokeRect(8, 8, w - 16, h - 16);
    x.clearRect(w - 8, 30, 20, h - 60);
  });
  for (const [p, lat] of [[-6, -3.6], [-13, 3.6], [-20, -3.6], [-27, 3.6]]) {
    const q = track.at(p, lat);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 4.4), new THREE.MeshBasicMaterial({ map: slotTex, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = q.yaw; m.position.set(q.x, 0.042, q.z);
    root.add(m);
  }

  // ---------- Bariery ----------
  const railMat = new THREE.MeshStandardMaterial({ color: 0xcdd2dc, metalness: 0.55, roughness: 0.38, side: THREE.DoubleSide });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8b91a0, roughness: 0.6 });
  const postGeo = new THREE.BoxGeometry(0.22, 1.15, 0.22);
  const posts = new THREE.InstancedMesh(postGeo, postMat, Math.ceil(N / 5) * 2 + 4);
  let pc = 0;
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1), eul = new THREE.Euler();
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(wall(track, side * BARRIER, 0.32, 0.98, { uScale: 4 }), railMat);
    rail.castShadow = true; root.add(rail);
    const cap = new THREE.Mesh(wall(track, side * BARRIER, 0.98, 1.04, {}), new THREE.MeshStandardMaterial({ color: 0x9aa0ae, side: THREE.DoubleSide, roughness: 0.5 }));
    root.add(cap);
    for (let i = 0; i < N; i += 5) {
      const off = side * (BARRIER + 0.18);
      v3.set(track.x[i] - track.tz[i] * off, 0.55, track.z[i] + track.tx[i] * off);
      q4.setFromEuler(eul.set(0, -track.psi[i], 0));
      posts.setMatrixAt(pc++, m4.compose(v3, q4, s3));
    }
  }
  posts.count = pc; posts.castShadow = true; root.add(posts);

  // opony w zewnętrznych łukach zakrętów (rozbijane przy uderzeniu)
  const tireCols = ['#1c1b22', '#ececf2', '#d8282e', '#1c1b22'];
  const tireList = [];
  const outerRun = new Uint8Array(N);
  for (let i = 0; i < N; i++) outerRun[i] = Math.abs(track.kappa[i]) > 0.026 ? 1 : 0;
  for (let i = 0; i < N; i += 2) {
    if (!outerRun[i] || tireList.length > 700) continue;
    const side = -Math.sign(track.kappa[i]);
    const off = side * (BARRIER - 0.95);
    const h = 2 + ((i / 2) % 3 === 0 ? 1 : 0);
    for (let k = 0; k < h; k++) {
      tireList.push({ x: track.x[i] - track.tz[i] * off + (rnd() - 0.5) * 0.12, y: 0.26 + k * 0.42, z: track.z[i] + track.tx[i] * off + (rnd() - 0.5) * 0.12, color: tireCols[(Math.floor(i / 6) + k) % tireCols.length] });
    }
  }
  world.tires = new TireField(root, tireList);

  // siatka ochronna na zewnątrz zakrętów
  const fenceTexture = fenceTex();
  const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTexture, transparent: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.5 });
  const fencePosts = [];
  for (const side of [-1, 1]) {
    const pred = (i) => outerRun[i] && -Math.sign(track.kappa[i]) === side;
    const g = wall(track, side * (BARRIER + 2.4), 0.2, 4.8, { pred, uScale: 3.5 });
    if (g.attributes.position.count) { const m = new THREE.Mesh(g, fenceMat); m.castShadow = true; root.add(m); }
    for (let i = 0; i < N; i += 7) if (pred(i)) fencePosts.push([track.x[i] - track.tz[i] * side * (BARRIER + 2.4), track.z[i] + track.tx[i] * side * (BARRIER + 2.4)]);
  }
  if (fencePosts.length) {
    const fp = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.1, 5, 6), postMat, fencePosts.length);
    fencePosts.forEach(([x, z], i) => fp.setMatrixAt(i, m4.compose(v3.set(x, 2.5, z), q4.identity(), s3)));
    fp.castShadow = true; root.add(fp);
  }

  // pachołki (biało-czerwone słupki) na początku i końcu każdego kerbu
  const bolW = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.26, 1.6, 10), new THREE.MeshStandardMaterial({ color: 0xf4f2f2, roughness: 0.5 }), 80);
  const bolR = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.235, 0.265, 0.4, 10), new THREE.MeshStandardMaterial({ color: 0xd6242c, roughness: 0.5 }), 160);
  let bc = 0, br = 0;
  for (let i = 0; i < N; i++) {
    const prev = dil[(i + N - 1) % N], nxt = dil[(i + 1) % N];
    if (dil[i] && (!prev || !nxt) && bc < 78) {
      const side = Math.sign(track.kappa[i]) || 1;
      const off = side * (ROAD_HALF + KERB_W + 1.1);
      const px = track.x[i] - track.tz[i] * off, pz = track.z[i] + track.tx[i] * off;
      bolW.setMatrixAt(bc++, m4.compose(v3.set(px, 0.8, pz), q4.identity(), s3));
      for (const yy of [0.5, 1.2]) bolR.setMatrixAt(br++, m4.compose(v3.set(px, yy, pz), q4.identity(), s3));
    }
  }
  bolW.count = bc; bolR.count = br; bolW.castShadow = bolR.castShadow = true; root.add(bolW, bolR);

  // ---------- Brama startowa ----------
  {
    const q = track.at(0, 0);
    const g = new THREE.Group(); g.position.set(q.x, 0, q.z); g.rotation.y = -q.yaw;
    const steel = new THREE.MeshStandardMaterial({ color: 0xdfe3ec, metalness: 0.5, roughness: 0.35 });
    const w = ROAD_HALF + 2.6;
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.0, 8.4, 1.0), steel); p.position.set(0, 4.2, s * w); p.castShadow = true; g.add(p); }
    const beamTop = checkerTex(24, 2); beamTop.repeat.set(1, 1);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.5, w * 2 + 1.2), [steel, steel, new THREE.MeshStandardMaterial({ map: beamTop, roughness: 0.5 }), steel, steel, steel]);
    beam.position.set(0, 8.6, 0); beam.castShadow = true; g.add(beam);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, w * 1.5), new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0xff2222, emissiveIntensity: 1.4 }));
    bar.position.set(1.0, 8.0, 0); g.add(bar);
    root.add(g);
  }

  // ---------- Trybuny wewnątrz toru (przy starcie) ----------
  const standAnchor = track.at(34, 0);
  const outerStand = track.def.stand === 'outer';
  {
    const g = new THREE.Group(); g.position.set(standAnchor.x, 0, standAnchor.z); g.rotation.y = -standAnchor.yaw + (outerStand ? Math.PI : 0);
    const concrete = new THREE.MeshStandardMaterial({ color: 0xcfc8d8, roughness: 0.9 });
    const rows = 6, rowD = 1.7, len = 54;
    const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.95, 0.5), new THREE.MeshStandardMaterial({ roughness: 0.8 }), rows * 60);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.7 }), rows * 60);
    const shirt = ['#e0457b', '#19b6c9', '#ffb61e', '#ffffff', '#6d5bd0', '#ff7a1a', '#4caf50', '#2d3350'].map((c) => new THREE.Color(c));
    const skin = ['#f2c9a5', '#d9a17c', '#a8704c', '#7a4a32'].map((c) => new THREE.Color(c));
    let ci = 0;
    for (let r = 0; r < rows; r++) {
      const zc = -(BARRIER + 5 + r * rowD), hgt = 0.9 * (r + 1);
      const step = new THREE.Mesh(new THREE.BoxGeometry(len, hgt, rowD), concrete);
      step.position.set(0, hgt / 2, zc); step.castShadow = true; step.receiveShadow = true; g.add(step);
      for (let k = 0; k < 58; k++) {
        if (rnd() < 0.12) continue;
        const x = -len / 2 + 0.8 + k * ((len - 1.6) / 57);
        crowd.setMatrixAt(ci, m4.compose(v3.set(x, hgt + 0.45, zc - 0.1), q4.identity(), s3));
        crowd.setColorAt(ci, shirt[rnd() * shirt.length | 0]);
        heads.setMatrixAt(ci, m4.compose(v3.set(x, hgt + 1.2, zc - 0.1), q4.identity(), s3));
        heads.setColorAt(ci, skin[rnd() * skin.length | 0]); ci++;
      }
    }
    crowd.count = heads.count = ci; crowd.castShadow = heads.castShadow = true;
    g.add(crowd, heads);
    // tylny baner i maszty z flagami
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, 4.5, 0.5), new THREE.MeshStandardMaterial({ map: billboardTex('WRRR UMMM', '#2a2f55', '#ffd84d'), roughness: 0.6 }));
    back.position.set(0, 0.9 * rows + 2.3, -(BARRIER + 5 + rows * rowD + 0.2)); back.castShadow = true; back.rotation.y = Math.PI;
    // PlaneBox: tekst na ściance +Z (skierowanej do toru) — obracamy, by czytelny od strony toru
    back.rotation.y = 0;
    g.add(back);
    for (const x of [-len / 2, len / 2]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 9, 8), steel1());
      pole.position.set(x, 4.5 + 0.9 * rows, -(BARRIER + 5 + rows * rowD)); pole.castShadow = true; g.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4, 8, 1), new THREE.MeshStandardMaterial({ color: x < 0 ? 0xe0457b : 0x19b6c9, side: THREE.DoubleSide, roughness: 0.7 }));
      flag.position.set(x + 1.2, 8.4 + 0.9 * rows, -(BARRIER + 5 + rows * rowD)); flag.castShadow = true; flag.userData.flag = true; g.add(flag);
      (world.flags ||= []).push(flag);
    }
    root.add(g);
  }
  function steel1() { return new THREE.MeshStandardMaterial({ color: 0xdfe3ec, metalness: 0.5, roughness: 0.35 }); }

  // ---------- Billboardy (zwrócone do kamery) ----------
  const boards = [['NITRO', '#d6242c', '#fff4e6'], ['APEX TIRES', '#1b2a4a', '#ffd84d'], ['SPEEDLINE', '#0f8a9c', '#ffffff'], ['TURBO', '#ff7a1a', '#14141c'], ['DRIFT KING', '#6d3bd0', '#fff4e6'], ['PIT STOP', '#2a7a43', '#ffffff']];
  const standMid = track.at(34, outerStand ? 24 : -24);
  const exclusions = [[standMid.x, standMid.z, 40]];
  const placedBoards = [];
  let bi = 0;
  for (let i = 40; i < N && bi < boards.length; i += 23) {
    if (Math.abs(track.kappa[i]) > 0.012) continue;
    for (const side of [-1, 1]) {
      const fx = track.tz[i] * side, fz = -track.tx[i] * side; // wektor w stronę toru
      if (fz < 0.55 || bi >= boards.length) continue;
      const off = side * (BARRIER + 6.5);
      const x = track.x[i] - track.tz[i] * off, z = track.z[i] + track.tx[i] * off;
      if (exclusions.some(([ex, ez, er]) => Math.hypot(x - ex, z - ez) < er)) continue;
      if (placedBoards.some(([px, pz]) => Math.hypot(x - px, z - pz) < 38)) continue;
      const [txt, bg, fg] = boards[bi++];
      const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = Math.atan2(fx, fz);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(11, 3.4, 0.35), new THREE.MeshStandardMaterial({ map: billboardTex(txt, bg, fg), roughness: 0.55 }));
      panel.position.y = 3.5; panel.castShadow = true;
      for (const px of [-4.2, 4.2]) { const pl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.8, 0.3), postMat); pl.position.set(px, 1.9, -0.1); pl.castShadow = true; grp.add(pl); }
      grp.add(panel); root.add(grp);
      placedBoards.push([x, z]); exclusions.push([x, z, 9]);
    }
  }

  // ---------- Siatka odległości do toru (dla dekoracji) ----------
  const CELL = 2.5, R = 40;
  const gw = Math.ceil(GW / CELL), gh = Math.ceil(GH / CELL);
  const dist = new Float32Array(gw * gh).fill(1e3);
  for (let i = 0; i < N; i += 2) {
    const ci = Math.floor((track.x[i] - gb.x0) / CELL), cj = Math.floor((track.z[i] - gb.z0) / CELL);
    const rr = Math.ceil(R / CELL);
    for (let a = Math.max(0, cj - rr); a <= Math.min(gh - 1, cj + rr); a++) {
      for (let b = Math.max(0, ci - rr); b <= Math.min(gw - 1, ci + rr); b++) {
        const d = Math.hypot(gb.x0 + (b + 0.5) * CELL - track.x[i], gb.z0 + (a + 0.5) * CELL - track.z[i]);
        if (d < dist[a * gw + b]) dist[a * gw + b] = d;
      }
    }
  }
  const distAt = (x, z) => {
    const b = Math.floor((x - gb.x0) / CELL), a = Math.floor((z - gb.z0) / CELL);
    return b < 0 || a < 0 || b >= gw || a >= gh ? 1e3 : dist[a * gw + b];
  };
  const blocked = (x, z) => exclusions.some(([ex, ez, er]) => Math.hypot(x - ex, z - ez) < er);

  const scatter = (count, minD, maxD, sep, tries = 4000) => {
    const out = [], hash = new Map();
    for (let t = 0; t < tries && out.length < count; t++) {
      const x = gb.x0 + 10 + rnd() * (GW - 20), z = gb.z0 + 10 + rnd() * (GH - 20);
      const d = distAt(x, z);
      if (d < minD || d > maxD || blocked(x, z)) continue;
      const kx = Math.floor(x / sep), kz = Math.floor(z / sep);
      let ok = true;
      for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1; b++) {
        const l = hash.get((kx + a) + ',' + (kz + b));
        if (l && l.some(([px, pz]) => Math.hypot(px - x, pz - z) < sep)) { ok = false; break; }
      }
      if (!ok) continue;
      const key = kx + ',' + kz; if (!hash.has(key)) hash.set(key, []); hash.get(key).push([x, z]);
      out.push([x, z]);
    }
    return out;
  };

  // ---------- Drzewa (low-poly sosny, kołyszące się w GLSL) ----------
  {
    const parts = [];
    const add = (geo, y, color) => {
      geo.translate(0, y, 0);
      const n = geo.attributes.position.count, col = new Float32Array(n * 3), c = new THREE.Color(color);
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo = geo.toNonIndexed(); geo.deleteAttribute('uv'); parts.push(geo);
    };
    add(new THREE.CylinderGeometry(0.28, 0.4, 1.8, 7), 0.9, T.foliage[0]);
    add(new THREE.ConeGeometry(2.5, 3.4, 8), 3.1, T.foliage[1]);
    add(new THREE.ConeGeometry(1.95, 3.0, 8), 4.7, T.foliage[2]);
    add(new THREE.ConeGeometry(1.4, 2.6, 8), 6.1, T.foliage[3]);
    const geo = mergeGeometries(parts);
    const spots = scatter(T.trees, BARRIER + 7.5, 60, 5.4);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = world.time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float sw = sin(uTime * 1.4 + instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.21);
          float hh = max(0.0, position.y - 1.6);
          transformed.x += sw * 0.045 * hh;
          transformed.z += cos(uTime * 1.1 + instanceMatrix[3].z * 0.3) * 0.03 * hh;`);
    };
    mat.customProgramCacheKey = () => 'tree-sway';
    const trees = new THREE.InstancedMesh(geo, mat, spots.length);
    const tint = new THREE.Color();
    spots.forEach(([x, z], i) => {
      const s = 0.8 + rnd() * 0.75;
      q4.setFromEuler(eul.set(0, rnd() * 6.28, 0));
      trees.setMatrixAt(i, m4.compose(v3.set(x, 0, z), q4, s3.set(s, s * (0.9 + rnd() * 0.35), s)));
      trees.setColorAt(i, tint.setScalar(0.8 + rnd() * 0.35));
    });
    s3.set(1, 1, 1);
    trees.castShadow = true; trees.receiveShadow = true; root.add(trees);
    world.treeSpots = spots;
  }

  // ---------- Skały i krzewy ----------
  {
    const rocks = scatter(T.rocks, BARRIER + 5, 70, 7);
    const rm = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: T.rock, flatShading: true, roughness: 0.9 }), rocks.length);
    rocks.forEach(([x, z], i) => {
      const s = 0.8 + rnd() * 1.8;
      q4.setFromEuler(eul.set(rnd() * 0.5, rnd() * 6.28, rnd() * 0.5));
      rm.setMatrixAt(i, m4.compose(v3.set(x, s * 0.35, z), q4, s3.set(s * 1.2, s * 0.8, s)));
    });
    rm.castShadow = rm.receiveShadow = true; root.add(rm);
    const bushes = scatter(T.bushes, BARRIER + 4.5, 70, 4.2);
    const bm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }), bushes.length);
    const bc2 = new THREE.Color();
    bushes.forEach(([x, z], i) => {
      const s = 0.6 + rnd() * 0.9;
      bm.setMatrixAt(i, m4.compose(v3.set(x, s * 0.45, z), q4.identity(), s3.set(s * 1.2, s * 0.8, s * 1.1)));
      bm.setColorAt(i, bc2.setHSL(T.bush[0] + rnd() * 0.08, T.bush[1], T.bush[2] + rnd() * 0.15));
    });
    s3.set(1, 1, 1);
    bm.castShadow = bm.receiveShadow = true; root.add(bm);
  }

  // ---------- Punkty dopasowania kamery ----------
  const fit = [];
  for (let i = 0; i < N; i += 8) for (const s of [-1, 1]) {
    const off = s * (BARRIER + 11);
    fit.push(new THREE.Vector3(track.x[i] - track.tz[i] * off, 0, track.z[i] + track.tx[i] * off));
    fit.push(new THREE.Vector3(track.x[i] - track.tz[i] * off, 5, track.z[i] + track.tx[i] * off));
  }
  world.fitPoints = fit;
  world.center = new THREE.Vector3(cx, 0, cz);

  world.update = (t) => {
    world.time.value = t;
    for (const f of world.flags || []) {
      const p = f.geometry.attributes.position;
      if (!f.userData.base) f.userData.base = p.array.slice();
      for (let i = 0; i < p.count; i++) {
        const bx = f.userData.base[i * 3], bz = f.userData.base[i * 3 + 2];
        p.setZ(i, bz + Math.sin(t * 5 + bx * 2.2) * 0.12 * (bx + 1.2));
      }
      p.needsUpdate = true;
    }
  };
  return world;
}
