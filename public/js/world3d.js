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
function ribbon(track, offA, offB, h, { pred = () => true, vScale = 8, color = null, from = 0, to = track.N - 1, info = null } = {}) {
  const pos = [], uv = [], col = [], idx = [], inf = []; let n = 0; const c = new THREE.Color();
  const hf = typeof h === 'function' ? h : () => h;
  for (let i = from; i < to; i++) {
    if (!pred(i) || !track.surf[i] || !track.surf[i + 1]) continue;
    const quad = [[i, offA, 0], [i, offB, 1], [i + 1, offB, 1], [i + 1, offA, 0]];
    for (const [k, off, u] of quad) {
      const hh = hf(k);
      pos.push(track.px[k] + track.rx[k] * off + track.ux[k] * hh, track.py[k] + track.ry[k] * off + track.uy[k] * hh, track.pz[k] + track.rz[k] * off + track.uz[k] * hh);
      uv.push(u, k * DS / vScale);
      if (info) inf.push(info(k), off, k * DS); // pokrycie, odległość boczna [m], odległość wzdłuż toru [m]
      if (color) { color(i, c); col.push(c.r, c.g, c.b); }
    }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (info) g.setAttribute('aInfo', new THREE.Float32BufferAttribute(inf, 3));
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
function cobbleTexture(T) {
  const rnd = rng(31);
  return canvasTex(256, 512, (x, w, h) => {
    x.fillStyle = '#4a463f'; x.fillRect(0, 0, w, h);
    const rh = 32, cw = 32;
    for (let r = 0; r < h / rh; r++) for (let c = -1; c < w / cw + 1; c++) {
      const ox = (r % 2) * (cw / 2), g = 95 + rnd() * 70; x.fillStyle = `rgb(${g + 18},${g + 8},${g - 10})`;
      x.beginPath(); x.roundRect(c * cw + ox + 2, r * rh + 2, cw - 4, rh - 4, 6); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.06)'; x.fillRect(c * cw + ox + 4, r * rh + 4, cw - 10, 3);
    }
  });
}
function sandTexture(T) {
  const rnd = rng(41), base = T.sandRoad ?? '#cfa968';
  return canvasTex(256, 512, (x, w, h) => {
    x.fillStyle = base; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { x.fillStyle = rnd() > 0.5 ? `rgba(255,200,140,${0.04 + rnd() * 0.08})` : `rgba(90,60,25,${0.05 + rnd() * 0.12})`; x.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
    for (const cxr of [w * 0.32, w * 0.68]) { const g = x.createLinearGradient(cxr - 18, 0, cxr + 18, 0); g.addColorStop(0, 'rgba(80,55,25,0)'); g.addColorStop(0.5, 'rgba(30,18,8,0.45)'); g.addColorStop(1, 'rgba(80,55,25,0)'); x.fillStyle = g; x.fillRect(cxr - 18, 0, 36, h); }
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
  let meanY = 0; for (let i = 0; i < N; i++) meanY += track.py[i]; meanY /= N;
  const groundY = T.water ? Math.floor(track.bounds.minY) - (T.groundDrop ?? 1.2) : Math.floor(T.groundBelow ? track.bounds.minY - 2 : meanY - 2.5);
  world.groundY = groundY; world.waterY = T.water ? groundY : null;
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
  ground.rotation.x = -Math.PI / 2; ground.position.set(cx, T.water ? groundY : groundY - 0.15, cz); ground.receiveShadow = true; root.add(ground);

  // ---------- teren: pagórki wokół toru, nasypy, doliny pod mostami, wzgórza nad tunelami ----------
  const CELL = 5, RAD = 150, MG = 300, BR_H = 17, TUN_H = 11.5;
  const gb = { x0: track.bounds.minX - MG, x1: track.bounds.maxX + MG, z0: track.bounds.minZ - MG, z1: track.bounds.maxZ + MG };
  const gw = Math.ceil((gb.x1 - gb.x0) / CELL) + 1, gh = Math.ceil((gb.z1 - gb.z0) / CELL) + 1, nS = N - 1;
  const dist = new Float32Array(gw * gh).fill(1e3), near = new Int32Array(gw * gh).fill(-1);
  { const rr = Math.ceil(RAD / CELL);
    for (let i = 0; i < nS; i++) {
      const ci = Math.round((track.px[i] - gb.x0) / CELL), cj = Math.round((track.pz[i] - gb.z0) / CELL);
      for (let a = Math.max(0, cj - rr); a <= Math.min(gh - 1, cj + rr); a++) for (let b = Math.max(0, ci - rr); b <= Math.min(gw - 1, ci + rr); b++) {
        const d = Math.hypot(gb.x0 + b * CELL - track.px[i], gb.z0 + a * CELL - track.pz[i]), k = a * gw + b; if (d < dist[k]) { dist[k] = d; near[k] = i; }
      }
    } }
  const base0 = T.water ? groundY - 6 : groundY, relief = T.relief ?? 0;
  const sstep = (t) => t * t * (3 - 2 * t), clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const baseH = (x, z) => {
    const e = clamp01(Math.min(x - gb.x0, gb.x1 - x, z - gb.z0, gb.z1 - z) / 140);
    return base0 + relief * sstep(e) * (Math.sin(x * 0.0042 + 1) * Math.cos(z * 0.0036) + 0.5 * Math.sin(x * 0.011 + z * 0.0087 + 2) + 1.5) / 3;
  };
  const H = new Float32Array(gw * gh);
  for (let a = 0; a < gh; a++) for (let b = 0; b < gw; b++) {
    const k = a * gw + b, x = gb.x0 + b * CELL, z = gb.z0 + a * CELL, i = near[k], bh = baseH(x, z);
    if (i < 0) { H[k] = bh; continue; }
    const d = dist[k], side = Math.sign((x - track.px[i]) * track.rx[i] + (z - track.pz[i]) * track.rz[i]) || 1;
    const lat = Math.max(-HW - 1, Math.min(HW + 1, side * d));
    const roadY = track.py[i] + track.ry[i] * lat, tk = track.tunnelT[i]; // wzgórze nad tunelem narasta przed portalem, nie wewnątrz rury
    let bed = roadY - 0.8 - track.bridgeK[i] * BR_H;
    bed += tk * (track.py[i] + TUN_H - bed);
    const near0 = Math.min(i, nS - i), flat = near0 < 140 ? 38 : 0;
    const t = clamp01((d - (HW + 3) - flat - tk * 12) / (34 + 1.5 * Math.abs(bed - bh)));
    H[k] = bed + (bh - bed) * sstep(t);
  }
  for (let pass = 0; pass < 2; pass++) { // wygładzenie szwów między sąsiednimi odcinkami toru (nie rusza podłoża jezdni)
    const o = H.slice();
    for (let a = 1; a < gh - 1; a++) for (let b = 1; b < gw - 1; b++) { const k = a * gw + b; if (dist[k] < HW + 7) continue; o[k] = (H[k] * 4 + H[k - 1] + H[k + 1] + H[k - gw] + H[k + gw]) / 8; }
    H.set(o);
  }
  const hAt = (x, z) => {
    const fx = (x - gb.x0) / CELL, fz = (z - gb.z0) / CELL; if (fx < 0 || fz < 0 || fx >= gw - 1 || fz >= gh - 1) return base0;
    const b = Math.floor(fx), a = Math.floor(fz), u = fx - b, v = fz - a, k = a * gw + b;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + gw] * (1 - u) + H[k + gw + 1] * u) * v;
  };
  world.hAt = hAt;
  {
    const pos = new Float32Array(gw * gh * 3), uv = new Float32Array(gw * gh * 2), col = new Float32Array(gw * gh * 3), idx = [], c = new THREE.Color();
    const sand = new THREE.Color(0xe8d6a0), grass = new THREE.Color(0x3fb06a), deep = new THREE.Color(0x2f9fa8);
    for (let a = 0; a < gh; a++) for (let b = 0; b < gw; b++) {
      const k = a * gw + b, x = gb.x0 + b * CELL, z = gb.z0 + a * CELL, h = H[k];
      pos.set([x, h, z], k * 3); uv.set([(x - gb.x0) / 34.6, (z - gb.z0) / 34.6], k * 2);
      if (T.water) { if (h < groundY - 0.2) c.copy(deep).lerp(sand, clamp01((h - groundY + 6) / 6)); else c.copy(sand).lerp(grass, clamp01((h - groundY - 1.2) / 3)); }
      else { const v = dist[k] < HW + 8 ? 0.82 : 1; c.setScalar(v * (0.9 + 0.1 * Math.sin(x * 0.07) * Math.cos(z * 0.06))); }
      col.set([c.r, c.g, c.b], k * 3);
      if (a < gh - 1 && b < gw - 1) idx.push(k, k + gw, k + 1, k + 1, k + gw, k + gw + 1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const tm = new THREE.MeshStandardMaterial(T.water ? { vertexColors: true, roughness: 1 } : { map: groundMat.map, vertexColors: true, roughness: 1 });
    const terr = new THREE.Mesh(g, tm); terr.receiveShadow = true; root.add(terr); world.terrain = terr;
  }
  /** najmniejsza odległość (w planie) od osi toru — dla dużych obiektów w tle */
  const farDist = (x, z) => { let m = 1e9; for (let i = 0; i < nS; i += 6) { const d = Math.hypot(x - track.px[i], z - track.pz[i]); if (d < m) m = d; } return m; };
  world.farDist = farDist;

  // ---------- jezdnia ----------
  // asfalt na całej długości; piasek i kostka to nakładki z nieregularną krawędzią (szum w shaderze): piasek „wysypany” na asfalt
  world.roadMats = [];
  const road = new THREE.Mesh(ribbon(track, -HW, HW, 0.02, { vScale: 32 }), new THREE.MeshStandardMaterial({ map: asphaltTexture(T.asphalt, T.centerLine), roughness: 0.86, side: THREE.DoubleSide }));
  road.receiveShadow = true; root.add(road); world.roadMats.push(road.material); world.asphaltMat = road.material;
  const overlay = (cov, mk, rough, vs, mode) => {
    if (!cov.some((v) => v > 0.004)) return;
    const mat = new THREE.MeshStandardMaterial({ map: mk(), roughness: rough, side: THREE.DoubleSide, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aInfo;\nvarying vec3 vInfo;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvInfo = aInfo;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vInfo;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnz(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
        float fbmz(vec2 p) { return 0.5 * vnz(p) + 0.25 * vnz(p * 2.1) + 0.125 * vnz(p * 4.3) + 0.0625 * vnz(p * 8.9); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        { float cov = vInfo.x; vec2 q = vec2(vInfo.y, vInfo.z);
          float edge = pow(abs(vInfo.y) / ${HW.toFixed(1)}, 2.0) * 0.22 * smoothstep(0.0, 0.18, cov);
          ${mode === 'sand'
            ? 'float n = fbmz(vec2(q.x * 0.22, q.y * 0.075) + 3.7) * 0.75 + vnz(q * 1.9) * 0.25; float v = cov * 1.12 + edge - n * 0.82;'
            : 'vec2 cell = floor(vec2(q.x * 0.9, q.y * 0.9)); float n = h21(cell) * 0.55 + fbmz(vec2(q.x * 0.3, q.y * 0.14) + 9.1) * 0.45; float v = cov * 1.2 + edge - n * 0.9;'}
          float a = smoothstep(0.0, ${mode === 'sand' ? '0.11' : '0.05'}, v) * smoothstep(0.0, 0.03, cov);
          diffuseColor.a *= a; }`);
    };
    mat.customProgramCacheKey = () => 'roadov-' + mode;
    const m = new THREE.Mesh(ribbon(track, -HW, HW, 0.03, { vScale: vs, pred: (i) => cov[i] > 0.004 || cov[i + 1] > 0.004, info: (k) => cov[k] }), mat);
    m.receiveShadow = true; m.renderOrder = 1; root.add(m); world.roadMats.push(mat);
  };
  overlay(track.covCob, () => cobbleTexture(T), 0.8, 16, 'cobble');
  overlay(track.covSand, () => sandTexture(T), 0.95, 32, 'sand');
  // bryła pod jezdnią (grubość) i boki
  const concrete = new THREE.MeshStandardMaterial({ color: T.slab, roughness: 0.9, side: THREE.DoubleSide });
  const under = new THREE.Mesh(ribbon(track, -HW - 0.5, HW + 0.5, -1.5), concrete);
  const sideL = new THREE.Mesh(wallStrip(track, -HW - 0.5, -1.5, 0.02), concrete), sideR = new THREE.Mesh(wallStrip(track, HW + 0.5, -1.5, 0.02), concrete);
  for (const m of [under, sideL, sideR]) { m.castShadow = true; m.receiveShadow = true; root.add(m); }
  // krawężniki (czerwono-białe lub w kolorach motywu) i górne krawędzie
  const kerbCol = (i, c) => c.set(Math.floor(i / 4) % 2 ? T.kerb[0] : T.kerb[1]);
  for (const sd of [-1, 1]) {
    const k = new THREE.Mesh(ribbon(track, sd > 0 ? HW - 0.05 : -HW - 0.55, sd > 0 ? HW + 0.55 : -HW + 0.05, 0.04, { color: kerbCol }), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: T.neon ? 0x222244 : 0x000000, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
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
    line.rotation.x = -Math.PI / 2; line.position.set(0, 0.07, 0); g.add(line); // 3 m wzdłuż toru, szerokość jezdni w poprzek
    root.add(g);
  };
  gate(track.startS, 'START / META', '#12141d', '#ffd84d');
  // ---------- mosty: dźwigary i filary ----------
  if (track.bridges.length) {
    const steel2 = new THREE.MeshStandardMaterial({ color: T.bridge ?? 0x7f8794, roughness: 0.6, metalness: 0.35, side: THREE.DoubleSide });
    const on = (i) => track.bridgeK[i] > 0.06;
    for (const m of [new THREE.Mesh(ribbon(track, -HW - 0.5, HW + 0.5, -3.4, { pred: on }), steel2), new THREE.Mesh(wallStrip(track, -HW - 0.5, -3.4, -1.5, { pred: on }), steel2), new THREE.Mesh(wallStrip(track, HW + 0.5, -3.4, -1.5, { pred: on }), steel2)]) { m.castShadow = true; m.receiveShadow = true; root.add(m); }
    const list = [];
    for (let i = 8; i < nS; i += 16) { if (track.bridgeK[i] < 0.3) continue; for (const lat of [-5, 5]) { const x = track.px[i] + track.rx[i] * lat, z = track.pz[i] + track.rz[i] * lat, top = track.py[i] + track.ry[i] * lat - 3.4, bot = hAt(x, z) - 1; if (top - bot > 2) list.push([x, z, top, top - bot]); } }
    if (list.length) {
      const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.9, 1.15, 1, 10), steel2, list.length), m4b = new THREE.Matrix4(), qb = new THREE.Quaternion(), vb = new THREE.Vector3(), sb = new THREE.Vector3();
      list.forEach(([x, z, top, h], i) => im.setMatrixAt(i, m4b.compose(vb.set(x, top - h / 2, z), qb, sb.set(1, h, 1))));
      im.castShadow = true; im.receiveShadow = true; root.add(im);
    }
  }
  // ---------- tunele: łuk betonowy, światła i portale ----------
  if (track.tunnels.length) {
    const RT = 9.8, SEG = 14, shellMat = new THREE.MeshStandardMaterial({ color: T.tunnel ?? 0x7a7e8a, emissive: T.neon ? 0x2e2870 : 0x2c2f38, emissiveIntensity: 1, roughness: 0.85, side: THREE.DoubleSide });
    const portalMat = new THREE.MeshStandardMaterial({ color: T.portal ?? 0xb9bcc6, roughness: 0.8, side: THREE.DoubleSide });
    const archPt = (i, r, th, out) => { const c = Math.cos(th) * r, u = Math.sin(th) * r; out.push(track.px[i] + track.rx[i] * c + track.ux[i] * u, track.py[i] + track.ry[i] * c + track.uy[i] * u, track.pz[i] + track.rz[i] * c + track.uz[i] * u); };
    const lightList = [];
    for (const { i0, i1 } of track.tunnels) {
      const a = Math.max(0, i0 - 7), bI = Math.min(nS, i1 + 7), pos = [], idx = []; let n0 = 0;
      for (let i = a; i <= bI; i += 2) { for (let k = 0; k <= SEG; k++) archPt(i, RT, (k / SEG) * Math.PI, pos); n0++; }
      for (let r = 0; r < n0 - 1; r++) for (let k = 0; k < SEG; k++) { const p = r * (SEG + 1) + k, q = p + SEG + 1; idx.push(p, q, p + 1, p + 1, q, q + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); root.add(new THREE.Mesh(g, shellMat));
      for (const i of [i0 - 7, i1 + 7]) {
        const pp = [], ii = []; for (let k = 0; k <= SEG; k++) { archPt(Math.max(0, Math.min(nS, i)), RT - 0.1, (k / SEG) * Math.PI, pp); archPt(Math.max(0, Math.min(nS, i)), RT + 3.2, (k / SEG) * Math.PI, pp); }
        for (let k = 0; k < SEG; k++) { const p = k * 2; ii.push(p, p + 1, p + 2, p + 2, p + 1, p + 3); }
        const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3)); pg.setIndex(ii); pg.computeVertexNormals(); root.add(new THREE.Mesh(pg, portalMat));
      }
      for (let i = i0 - 2; i <= i1 + 2; i += 10) lightList.push(i);
    }
    const lm = new THREE.MeshStandardMaterial({ color: T.neon ? 0xbff9ff : 0xfff2cc, emissive: T.neon ? 0x25f4ff : 0xffe9b0, emissiveIntensity: 2.4 });
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.22, 3.2), lm, lightList.length * 2), m4l = new THREE.Matrix4(), bm = new THREE.Matrix4(); let li = 0;
    for (const i of lightList) for (const th of [Math.PI * 0.32, Math.PI * 0.68]) { const o = []; archPt(i, RT - 0.25, th, o); bm.makeBasis(new THREE.Vector3(track.tx[i], track.ty[i], track.tz[i]), new THREE.Vector3(track.ux[i], track.uy[i], track.uz[i]), new THREE.Vector3(track.rx[i], track.ry[i], track.rz[i])); bm.setPosition(o[0], o[1], o[2]); im.setMatrixAt(li++, bm.multiply(m4l.makeRotationX(Math.atan2(-Math.cos(th), -Math.sin(th))))); }
    root.add(im);
  }
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1), eul = new THREE.Euler();
  const distAt = (x, z) => { const b = Math.round((x - gb.x0) / CELL), a = Math.round((z - gb.z0) / CELL); return b < 0 || a < 0 || b >= gw || a >= gh ? 1e3 : dist[a * gw + b]; };
  const scatter = (count, minD, maxD, sep, tries = 6000) => {
    const out = [], hash = new Map();
    for (let t = 0; t < tries && out.length < count; t++) {
      const x = gb.x0 + 10 + rnd() * (gb.x1 - gb.x0 - 20), z = gb.z0 + 10 + rnd() * (gb.z1 - gb.z0 - 20), d = distAt(x, z);
      if (d < minD || d > maxD) continue;
      if (world.waterY != null && hAt(x, z) < world.waterY + 0.5) continue;
      const kx = Math.floor(x / sep), kz = Math.floor(z / sep); let ok = true;
      for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1; b++) { const l = hash.get((kx + a) + ',' + (kz + b)); if (l && l.some(([px, pz]) => Math.hypot(px - x, pz - z) < sep)) { ok = false; break; } }
      if (!ok) continue; const key = kx + ',' + kz; if (!hash.has(key)) hash.set(key, []); hash.get(key).push([x, z]); out.push([x, z]);
    }
    return out;
  };
  world.scatter = scatter;

  // ---------- dekoracje zależne od motywu ----------
  T.decor?.(world, { world, THREE, root, track, scatter, rnd, groundY, hAt, farDist, canvasTex, rng, mergeGeometries, m4, q4, v3, s3, eul, textTex, T, cx, cz, gb });

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
