// Świat 3D dla torów w stylu TrackMania: jezdnia z przechyłami i pętlami, bandy, słupy, bramy, pady nitro,
// niebo z dynamiczną porą dnia, chmury i ruchome elementy tła, otoczenie zależne od „kraju” toru.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HW, DS } from './track3d.js';
import { THEMES3D, skyAt } from './themes3d.js';

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canvasTex(w, h, draw, { repeat = null, aniso = 8 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; if (repeat) t.repeat.set(repeat[0], repeat[1]); return t;
}

/** Pas czworokątów wzdłuż toru między offsetami bocznymi offA..offB na wysokości h nad powierzchnią (po normalnej U). */
function ribbon(track, offA, offB, h, { pred = () => true, vScale = 8, color = null, from = 0, to = track.N - 1 } = {}) {
  const pos = [], uv = [], col = [], idx = []; let n = 0; const c = new THREE.Color();
  const hf = typeof h === 'function' ? h : () => h;
  for (let i = from; i < to; i++) {
    if (!pred(i) || !track.surf[i] || !track.surf[i + 1]) continue;
    const quad = [[i, offA, 0], [i, offB, 1], [i + 1, offB, 1], [i + 1, offA, 0]];
    for (const [k, off, u] of quad) {
      const hh = hf(k);
      pos.push(track.px[k] + track.rx[k] * off + track.ux[k] * hh, track.py[k] + track.ry[k] * off + track.uy[k] * hh, track.pz[k] + track.rz[k] * off + track.uz[k] * hh);
      uv.push(u, k * DS / vScale);
      if (color) { color(i, c); col.push(c.r, c.g, c.b); }
    }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
/** Pionowa ściana wzdłuż toru (po normalnej U) na offsecie bocznym off od h0 do h1. */
function wallStrip(track, off, h0, h1, { pred = () => true, uScale = 4 } = {}) {
  const pos = [], uv = [], idx = []; let n = 0;
  for (let i = 0; i < track.N - 1; i++) {
    if (!pred(i) || !track.surf[i] || !track.surf[i + 1]) continue;
    for (const [k, hh, v] of [[i, h0, 0], [i, h1, 1], [i + 1, h1, 1], [i + 1, h0, 0]]) {
      pos.push(track.px[k] + track.rx[k] * off + track.ux[k] * hh, track.py[k] + track.ry[k] * off + track.uy[k] * hh, track.pz[k] + track.rz[k] * off + track.uz[k] * hh);
      uv.push(k * DS / uScale, v);
    }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}

function asphaltTexture(base, accent) {
  const rnd = rng(11);
  return canvasTex(256, 512, (x, w, h) => {
    x.fillStyle = base; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { const px = rnd() * w, py = rnd() * h, r = 20 + rnd() * 60, g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, rnd() > 0.5 ? 'rgba(20,18,32,0.16)' : 'rgba(140,135,170,0.1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2); }
    for (let i = 0; i < 9000; i++) { x.fillStyle = rnd() > 0.5 ? `rgba(190,185,215,${0.05 + rnd() * 0.1})` : `rgba(12,10,24,${0.08 + rnd() * 0.12})`; x.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 1.4, 1 + rnd() * 1.4); }
    // linie: krawędziowe ciągłe i przerywana oś (w poprzek tekstury x = poprzecznie)
    x.fillStyle = 'rgba(245,243,250,0.92)'; x.fillRect(w * 0.045, 0, 5, h); x.fillRect(w * 0.955 - 5, 0, 5, h);
    x.fillStyle = accent || 'rgba(245,243,250,0.85)'; for (let y = 0; y < h; y += 128) x.fillRect(w / 2 - 3, y, 6, 64);
  });
}
const checkerTex = (cols, rows) => canvasTex(64 * cols, 64 * rows, (x) => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { x.fillStyle = (r + c) % 2 ? '#101018' : '#f4f4f8'; x.fillRect(c * 64, r * 64, 64, 64); } });
function barrierTexture(a, b) { return canvasTex(128, 32, (x, w, h) => { for (let i = 0; i < 4; i++) { x.fillStyle = i % 2 ? b : a; x.fillRect(i * 32, 0, 32, h); } x.fillStyle = 'rgba(0,0,0,0.2)'; x.fillRect(0, h - 5, w, 5); }); }
function textTex(text, bg, fg, w = 512, h = 128) { return canvasTex(w, h, (x) => { x.fillStyle = bg; x.fillRect(0, 0, w, h); x.fillStyle = fg; x.font = `900 ${h * 0.62}px system-ui, Arial`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, h / 2 + 4); }); }

export function buildWorld3D(scene, renderer, track, themeId) {
  const T = THEMES3D[themeId] || THEMES3D.stadion;
  const root = new THREE.Group(); scene.add(root);
  const world = { root, theme: T, time: { value: 0 }, track, flags: [], anim: [] };
  const rnd = rng(2025 + track.N);
  const N = track.N;
  const groundY = Math.floor(track.bounds.minY) - (T.groundDrop ?? 0.3);
  world.groundY = groundY;
  const cx = (track.bounds.minX + track.bounds.maxX) / 2, cz = (track.bounds.minZ + track.bounds.maxZ) / 2;
  world.center = new THREE.Vector3(cx, groundY, cz);

  // ---------- światło ----------
  if (!scene.environment) { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.42; }
  const hemi = new THREE.HemisphereLight(0xcfdcff, 0x7a6a8a, 0.9); root.add(hemi);
  const sun = new THREE.DirectionalLight(0xffdfb8, 3); sun.castShadow = true;
  const sm = Math.min(2048, renderer.capabilities.maxTextureSize); sun.shadow.mapSize.set(sm, sm);
  Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 90, bottom: -90, near: 10, far: 700 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
  root.add(sun, sun.target);
  world.sun = sun; world.hemi = hemi;
  world.sky = new THREE.Color(0x9fc2ff);
  const focus = new THREE.Vector3(cx, groundY, cz), sunDir = new THREE.Vector3(-0.5, 0.8, 0.4).normalize();
  /** kamera światła podąża za autem (cienie tylko w pobliżu gracza) */
  world.setFocus = (x, y, z) => { focus.set(x, y, z); sun.target.position.copy(focus); sun.position.copy(focus).addScaledVector(sunDir, 260); sun.target.updateMatrixWorld(); };

  // ---------- niebo (kopuła) ----------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(0x4a7fe0) }, uHor: { value: new THREE.Color(0xbcd4f5) }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(0xfff2c4) }, uStars: { value: 0 }, uTime: world.time },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vD; uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uSunCol; uniform float uStars; uniform float uTime;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){ float h = clamp(vD.y, -0.2, 1.0); vec3 col = mix(uHor, uTop, pow(max(h,0.0), 0.55));
        float sd = max(dot(normalize(vD), normalize(uSun)), 0.0); col += uSunCol * (pow(sd, 400.0) * 1.6 + pow(sd, 12.0) * 0.28);
        col = mix(col, uHor * 0.85, smoothstep(0.0, -0.18, vD.y));
        if (uStars > 0.01 && vD.y > 0.02) { vec3 g = floor(vD * 420.0); float st = step(0.9965, hash(g)); col += vec3(st) * uStars * (0.6 + 0.4 * sin(uTime * 3.0 + hash(g) * 40.0)); }
        gl_FragColor = vec4(col, 1.0); }`,
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(3500, 32, 18), skyMat); skyDome.renderOrder = -10; skyDome.frustumCulled = false; root.add(skyDome);
  world.skyDome = skyDome;

  // ---------- teren / woda ----------
  let groundMat;
  if (T.water) {
    const nrm = canvasTex(256, 256, (x, w, h) => { const r2 = rng(5); x.fillStyle = '#8080ff'; x.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${100 + r2() * 60},${100 + r2() * 60},255,0.35)`; x.beginPath(); x.arc(r2() * w, r2() * h, 3 + r2() * 12, 0, 6.3); x.fill(); } }, { repeat: [90, 90] });
    nrm.colorSpace = THREE.NoColorSpace;
    groundMat = new THREE.MeshStandardMaterial({ color: T.ground[0], roughness: 0.08, metalness: 0.55, normalMap: nrm, normalScale: new THREE.Vector2(0.5, 0.5), transparent: true, opacity: 0.93 });
    world.anim.push((t) => { nrm.offset.set(t * 0.012, t * 0.008); });
  } else {
    const gt = canvasTex(256, 256, (x, w, h) => { const r2 = rng(6); x.fillStyle = T.ground[0]; x.fillRect(0, 0, w, h); for (let i = 0; i < 4500; i++) { x.fillStyle = r2() > 0.5 ? T.ground[1] : T.ground[2]; x.globalAlpha = 0.12 + r2() * 0.16; x.fillRect(r2() * w, r2() * h, 1 + r2() * 3, 1 + r2() * 4); } x.globalAlpha = 1; }, { repeat: [260, 260] });
    groundMat = new THREE.MeshStandardMaterial({ map: gt, roughness: 1 });
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.set(cx, groundY, cz); ground.receiveShadow = true; root.add(ground);

  // ---------- jezdnia ----------
  const asphalt = new THREE.Mesh(ribbon(track, -HW, HW, 0.02, { vScale: 32 }), new THREE.MeshStandardMaterial({ map: asphaltTexture(T.asphalt, T.centerLine), roughness: 0.86, side: THREE.DoubleSide }));
  asphalt.receiveShadow = true; root.add(asphalt); world.asphaltMat = asphalt.material;
  asphalt.material.map.repeat.set(1, 1);
  // bryła pod jezdnią (grubość) i boki
  const concrete = new THREE.MeshStandardMaterial({ color: T.slab, roughness: 0.9, side: THREE.DoubleSide });
  const under = new THREE.Mesh(ribbon(track, -HW - 0.5, HW + 0.5, -1.5), concrete);
  const sideL = new THREE.Mesh(wallStrip(track, -HW - 0.5, -1.5, 0.02), concrete), sideR = new THREE.Mesh(wallStrip(track, HW + 0.5, -1.5, 0.02), concrete);
  for (const m of [under, sideL, sideR]) { m.castShadow = true; m.receiveShadow = true; root.add(m); }
  // krawężniki (czerwono-białe lub w kolorach motywu) i górne krawędzie
  const kerbCol = (i, c) => c.set(Math.floor(i / 4) % 2 ? T.kerb[0] : T.kerb[1]);
  for (const sd of [-1, 1]) {
    const k = new THREE.Mesh(ribbon(track, sd > 0 ? HW - 0.05 : -HW - 0.55, sd > 0 ? HW + 0.55 : -HW + 0.05, 0.04, { color: kerbCol }), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: T.neon ? 0x222244 : 0x000000 }));
    k.receiveShadow = true; root.add(k);
  }
  // bandy po bokach (tam, gdzie są)
  const bTex = barrierTexture(T.barrier[0], T.barrier[1]);
  const bMat = new THREE.MeshStandardMaterial({ map: bTex, roughness: 0.7, side: THREE.DoubleSide, emissive: T.neon ? T.neonColor : 0x000000, emissiveIntensity: T.neon ? 0.35 : 0 });
  const capMat = new THREE.MeshStandardMaterial({ color: T.barrierCap, roughness: 0.5, side: THREE.DoubleSide, emissive: T.neon ? T.neonColor : 0x000000, emissiveIntensity: T.neon ? 1.6 : 0 });
  for (const sd of [-1, 1]) {
    const wm = new THREE.Mesh(wallStrip(track, sd * (HW + 0.3), 0, 1.15, { pred: (i) => track.wall[i] === 1, uScale: 4 }), bMat); wm.castShadow = true; root.add(wm);
    const cap = new THREE.Mesh(ribbon(track, sd > 0 ? HW + 0.3 : -HW - 0.7, sd > 0 ? HW + 0.7 : -HW - 0.3, 1.15, { pred: (i) => track.wall[i] === 1 }), capMat); root.add(cap);
  }

  // ---------- podgląd toru z góry (menu): szeroka świecąca wstęga, widoczna z dużej odległości ----------
  {
    const ov = new THREE.Group(), lineMat = new THREE.MeshBasicMaterial({ color: T.overview ?? 0xffc233, side: THREE.DoubleSide, fog: false, depthTest: false, transparent: true, opacity: 0.95 });
    const band = new THREE.Mesh(ribbon(track, -22, 22, 2.5), lineMat); band.renderOrder = 20; ov.add(band);
    const mark = (s, color) => { const f = track.at(s, {}); const m = new THREE.Mesh(new THREE.CylinderGeometry(36, 36, 160, 20), new THREE.MeshBasicMaterial({ color, fog: false, depthTest: false, transparent: true, opacity: 0.9 })); m.position.set(f.px, f.py + 80, f.pz); m.renderOrder = 21; ov.add(m); };
    mark(track.startS, 0x37e08a);
    ov.visible = false; root.add(ov); world.overview = ov;
    world.setOverview = (on) => { ov.visible = on; };
  }

  // ---------- pady przyspieszające ----------
  if (track.pads.length) {
    const padTex = canvasTex(128, 128, (x, wd, ht) => {
      x.clearRect(0, 0, wd, ht);
      const chev = (y0, col) => { x.fillStyle = col; x.beginPath(); x.moveTo(8, y0 + 46); x.lineTo(wd / 2, y0 + 6); x.lineTo(wd - 8, y0 + 46); x.lineTo(wd - 8, y0 + 66); x.lineTo(wd / 2, y0 + 28); x.lineTo(8, y0 + 66); x.closePath(); x.fill(); };
      chev(8, '#ffb02e'); chev(-14, 'rgba(255,214,120,0.75)');
    });
    const padMat = new THREE.MeshStandardMaterial({ map: padTex, transparent: true, emissiveMap: padTex, emissive: 0xffa000, emissiveIntensity: 1.7, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false, side: THREE.DoubleSide });
    const base = new THREE.MeshStandardMaterial({ color: 0x1a1308, emissive: 0xff8a00, emissiveIntensity: 0.25, roughness: 0.6, transparent: true, opacity: 0.88, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide });
    for (const p of track.pads) {
      const inPad = (i) => i >= p.s0 && i < p.s0 + p.len;
      root.add(new THREE.Mesh(ribbon(track, p.lat - 2.45, p.lat + 2.45, 0.05, { pred: inPad, vScale: p.len }), base));
      const g1 = new THREE.Mesh(ribbon(track, p.lat - 2.1, p.lat + 2.1, 0.06, { pred: inPad, vScale: p.len / 2 }), padMat); g1.renderOrder = 2; root.add(g1);
    }
    world.anim.push((t) => { padTex.offset.y = -((t * 1.4) % 1); });
  }

  // ---------- bramy: start, meta, checkpointy ----------
  const frame = (s) => { const f = track.at(s, {}); const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(f.tx, f.ty, f.tz), new THREE.Vector3(f.ux, f.uy, f.uz), new THREE.Vector3(f.rx, f.ry, f.rz)); m.setPosition(f.px, f.py, f.pz); return m; };
  const steel = new THREE.MeshStandardMaterial({ color: 0xdfe3ec, metalness: 0.5, roughness: 0.35 });
  const gate = (s, label, bg, fg) => {
    const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(frame(s));
    const w = HW + 2.2;
    for (const z of [-w, w]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1, 9.4, 1), steel); p.position.set(0, 4.7, z); p.castShadow = true; g.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2, 2.6, w * 2 + 1), [steel, steel, steel, steel, new THREE.MeshStandardMaterial({ map: textTex(label, bg, fg, 512, 128), roughness: 0.5, emissive: 0xffffff, emissiveMap: textTex(label, bg, fg, 512, 128), emissiveIntensity: 0.25 }), new THREE.MeshStandardMaterial({ map: textTex(label, bg, fg, 512, 128), roughness: 0.5 })]);
    beam.position.set(0, 9.8, 0); beam.castShadow = true; g.add(beam);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(3, HW * 2), new THREE.MeshStandardMaterial({ map: checkerTex(2, 8), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
    line.rotation.x = -Math.PI / 2; line.rotation.z = Math.PI / 2; line.position.set(0, 0.07, 0); g.add(line);
    root.add(g);
  };
  gate(track.startS, 'START / META', '#12141d', '#ffd84d');
  // ---------- słupy podporowe ----------
  {
    const list = [];
    for (let i = 10; i < N - 2; i += 13) {
      if (!track.surf[i] || track.uy[i] < 0.55) continue;
      const bottom = track.py[i] - 1.5, hgt = bottom - groundY;
      if (hgt < 3) continue;
      list.push([track.px[i], track.pz[i], bottom, hgt]);
    }
    if (list.length) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 1, 1.7), concrete, list.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
      list.forEach(([x, z, b, h], i) => im.setMatrixAt(i, m4.compose(v.set(x, b - h / 2, z), q, sc.set(1, h, 1))));
      im.castShadow = true; im.receiveShadow = true; root.add(im);
    }
  }

  // ---------- siatka odległości do toru (dla dekoracji) ----------
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1), eul = new THREE.Euler();
  const M = 260, gb = { x0: track.bounds.minX - M, x1: track.bounds.maxX + M, z0: track.bounds.minZ - M, z1: track.bounds.maxZ + M };
  const CELL = 6, RAD = 110, gw = Math.ceil((gb.x1 - gb.x0) / CELL), gh = Math.ceil((gb.z1 - gb.z0) / CELL);
  const dist = new Float32Array(gw * gh).fill(1e3);
  for (let i = 0; i < N; i += 3) {
    const ci = Math.floor((track.px[i] - gb.x0) / CELL), cj = Math.floor((track.pz[i] - gb.z0) / CELL), rr = Math.ceil(RAD / CELL);
    for (let a = Math.max(0, cj - rr); a <= Math.min(gh - 1, cj + rr); a++) for (let b = Math.max(0, ci - rr); b <= Math.min(gw - 1, ci + rr); b++) {
      const d = Math.hypot(gb.x0 + (b + 0.5) * CELL - track.px[i], gb.z0 + (a + 0.5) * CELL - track.pz[i]); if (d < dist[a * gw + b]) dist[a * gw + b] = d;
    }
  }
  const distAt = (x, z) => { const b = Math.floor((x - gb.x0) / CELL), a = Math.floor((z - gb.z0) / CELL); return b < 0 || a < 0 || b >= gw || a >= gh ? 1e3 : dist[a * gw + b]; };
  const scatter = (count, minD, maxD, sep, tries = 6000) => {
    const out = [], hash = new Map();
    for (let t = 0; t < tries && out.length < count; t++) {
      const x = gb.x0 + 10 + rnd() * (gb.x1 - gb.x0 - 20), z = gb.z0 + 10 + rnd() * (gb.z1 - gb.z0 - 20), d = distAt(x, z);
      if (d < minD || d > maxD) continue;
      const kx = Math.floor(x / sep), kz = Math.floor(z / sep); let ok = true;
      for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1; b++) { const l = hash.get((kx + a) + ',' + (kz + b)); if (l && l.some(([px, pz]) => Math.hypot(px - x, pz - z) < sep)) { ok = false; break; } }
      if (!ok) continue; const key = kx + ',' + kz; if (!hash.has(key)) hash.set(key, []); hash.get(key).push([x, z]); out.push([x, z]);
    }
    return out;
  };
  world.scatter = scatter;

  // ---------- dekoracje zależne od motywu ----------
  T.decor?.(world, { world, THREE, root, track, scatter, rnd, groundY, canvasTex, rng, mergeGeometries, m4, q4, v3, s3, eul, textTex, T, cx, cz, gb });

  // ---------- chmury i ruchome elementy tła ----------
  {
    const ct = canvasTex(128, 128, (x, w, h) => { const g = x.createRadialGradient(64, 64, 4, 64, 64, 62); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); });
    const cm = new THREE.SpriteMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, opacity: 0.85 });
    const clouds = [];
    for (let i = 0; i < 46; i++) {
      const sp = new THREE.Sprite(cm.clone()); const a = rnd() * Math.PI * 2, r = 400 + rnd() * 2400;
      sp.position.set(cx + Math.cos(a) * r, groundY + 260 + rnd() * 380, cz + Math.sin(a) * r); const s = 240 + rnd() * 420; sp.scale.set(s * 1.8, s * 0.7, 1);
      sp.userData.speed = 4 + rnd() * 6; root.add(sp); clouds.push(sp);
    }
    world.clouds = clouds;
    world.anim.push((t, dt) => { for (const c of clouds) { c.position.x += c.userData.speed * dt; if (c.position.x > cx + 3000) c.position.x -= 6000; } });
    // balony i ptaki
    if (T.balloons) {
      for (let i = 0; i < T.balloons; i++) {
        const g = new THREE.Group(), col = [0xff5a5f, 0xffc233, 0x3fa9f5, 0x7cff6b][i % 4];
        const bal = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 12), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 })); bal.scale.y = 1.2; bal.position.y = 16; g.add(bal);
        const basket = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 3), new THREE.MeshStandardMaterial({ color: 0x6b4a33 })); g.add(basket); root.add(g);
        const a0 = rnd() * 6.28, R = 380 + rnd() * 700, sp = 0.012 + rnd() * 0.01, h0 = groundY + 90 + rnd() * 120;
        world.anim.push((t) => { g.position.set(cx + Math.cos(a0 + t * sp) * R, h0 + Math.sin(t * 0.3 + i) * 4, cz + Math.sin(a0 + t * sp) * R); g.rotation.y = -(a0 + t * sp); });
      }
    }
    if (T.birds) {
      const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -1.2, 0.1, 0.9, 0.2, 0, 0, 0, 0, 0, -1.2, 0.1, -0.9, 0.2, 0, 0], 3));
      const bm = new THREE.MeshBasicMaterial({ color: T.birdColor ?? 0x222233, side: THREE.DoubleSide });
      for (let i = 0; i < T.birds; i++) {
        const b = new THREE.Mesh(bg, bm); b.scale.setScalar(3); root.add(b);
        const a0 = rnd() * 6.28, R = 150 + rnd() * 500, sp = 0.05 + rnd() * 0.05, h0 = groundY + 40 + rnd() * 90;
        world.anim.push((t) => { b.position.set(cx + Math.cos(a0 + t * sp) * R, h0 + Math.sin(t * 0.8 + i) * 3, cz + Math.sin(a0 + t * sp) * R); b.rotation.y = -(a0 + t * sp) - Math.PI / 2; b.rotation.z = Math.sin(t * 9 + i) * 0.5; });
      }
    }
  }

  // ---------- pora dnia ----------
  const col = (h) => new THREE.Color(h);
  world.phase = T.startPhase ?? 0.2; world.nightK = 0;
  /** ustawia światło, niebo, mgłę i ekspozycję dla fazy dnia p ∈ [0,1) (0 świt, 0,25 południe, 0,5 zachód, 0,75 noc) */
  world.setPhase = (p, wet = 0) => {
    world.phase = p; const S = skyAt(p, T.skyBias);
    skyMat.uniforms.uTop.value.set(S.top); skyMat.uniforms.uHor.value.set(S.hor); skyMat.uniforms.uSunCol.value.set(S.sunCol);
    sunDir.set(Math.cos(S.az) * Math.cos(S.elev), Math.max(0.08, Math.sin(S.elev)), Math.sin(S.az) * Math.cos(S.elev)).normalize();
    skyMat.uniforms.uSun.value.copy(sunDir); skyMat.uniforms.uStars.value = S.stars;
    sun.color.set(S.sunCol); sun.intensity = S.sunI * (1 - 0.72 * wet);
    hemi.color.set(S.hemiSky); hemi.groundColor.set(S.hemiGround); hemi.intensity = S.hemiI * (1 + 0.05 * wet);
    world.sky.set(S.hor);
    if (wet > 0) world.sky.lerp(col(S.stars > 0.3 ? 0x0b121c : 0x7d8791), 0.7 * wet);
    skyMat.uniforms.uHor.value.lerp(col(S.stars > 0.3 ? 0x0b121c : 0x7d8791), 0.6 * wet); skyMat.uniforms.uTop.value.lerp(col(S.stars > 0.3 ? 0x080c14 : 0x5a636e), 0.7 * wet);
    world.nightK = S.night; world.exposure = S.exposure; world.envI = S.envI;
    world.sun.position.copy(focus).addScaledVector(sunDir, 260);
    for (const c of world.clouds || []) c.material.color.set(S.cloud).lerp(col(0x5a636e), wet).multiplyScalar(1 - 0.2 * wet);
    T.onPhase?.(world, S);
    world.windowMat && (world.windowMat.emissiveIntensity = 0.1 + S.night * (T.neon ? 1.6 : 1.5));
  };
  world.env = { sun, hemi };
  world.update = (t, dt = 0.016) => { world.time.value = t; for (const f of world.anim) f(t, dt); };
  world.setPhase(world.phase);
  world.setFocus(cx, groundY, cz);
  return world;
}
