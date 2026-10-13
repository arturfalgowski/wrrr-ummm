// Motywy otoczenia torów („kraje”): kolory, dekoracje i dynamiczna pora dnia.
import * as THREE from 'three';

const lerpC = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);
const KEYS = [ // faza dnia: 0 świt, 0,25 południe, 0,5 zachód, 0,75 noc
  { p: 0.0, top: 0x3a5fa8, hor: 0xf6b98a, sunCol: 0xffb070, sunI: 1.7, elev: 0.1, hemiSky: 0xffd8b8, hemiGround: 0x6a5a6a, hemiI: 0.7, stars: 0.2, night: 0.15, exposure: 1.08, envI: 0.34, cloud: 0xffd9bd },
  { p: 0.12, top: 0x4a82e0, hor: 0xd8e4f5, sunCol: 0xffe2b8, sunI: 2.8, elev: 0.6, hemiSky: 0xcfdcff, hemiGround: 0x7a6a8a, hemiI: 0.9, stars: 0, night: 0, exposure: 1.05, envI: 0.42, cloud: 0xffffff },
  { p: 0.25, top: 0x3d78e0, hor: 0xbcd8f8, sunCol: 0xfff4dc, sunI: 3.2, elev: 1.15, hemiSky: 0xd8e8ff, hemiGround: 0x7a7a8a, hemiI: 0.95, stars: 0, night: 0, exposure: 1.05, envI: 0.42, cloud: 0xffffff },
  { p: 0.4, top: 0x4a82d8, hor: 0xe6dcc8, sunCol: 0xffe0a8, sunI: 3.0, elev: 0.7, hemiSky: 0xffe6c8, hemiGround: 0x8a7a6a, hemiI: 0.9, stars: 0, night: 0, exposure: 1.06, envI: 0.4, cloud: 0xfff0dc },
  { p: 0.5, top: 0x2d3f86, hor: 0xff9a5c, sunCol: 0xff8a4a, sunI: 1.8, elev: 0.12, hemiSky: 0xffb48a, hemiGround: 0x5a4a5a, hemiI: 0.7, stars: 0.1, night: 0.2, exposure: 1.1, envI: 0.3, cloud: 0xffb890 },
  { p: 0.58, top: 0x1a1f4d, hor: 0x8a4a6a, sunCol: 0xff6a50, sunI: 0.7, elev: 0.04, hemiSky: 0x8a6a9a, hemiGround: 0x3a2a4a, hemiI: 0.45, stars: 0.5, night: 0.6, exposure: 1.2, envI: 0.2, cloud: 0x8a6a8a },
  { p: 0.68, top: 0x070b1e, hor: 0x1a2244, sunCol: 0x8a9cff, sunI: 0.6, elev: 0.55, hemiSky: 0x3a4a8a, hemiGround: 0x141824, hemiI: 0.32, stars: 1, night: 1, exposure: 1.32, envI: 0.14, cloud: 0x2a3050 },
  { p: 0.9, top: 0x0d1230, hor: 0x3a3560, sunCol: 0x8a9cff, sunI: 0.55, elev: 0.45, hemiSky: 0x3a4a8a, hemiGround: 0x1a1c2a, hemiI: 0.34, stars: 0.7, night: 0.8, exposure: 1.28, envI: 0.16, cloud: 0x3a3a60 },
  { p: 1.0, top: 0x3a5fa8, hor: 0xf6b98a, sunCol: 0xffb070, sunI: 1.7, elev: 0.1, hemiSky: 0xffd8b8, hemiGround: 0x6a5a6a, hemiI: 0.7, stars: 0.2, night: 0.15, exposure: 1.08, envI: 0.34, cloud: 0xffd9bd },
];
const NUMK = ['sunI', 'elev', 'hemiI', 'stars', 'night', 'exposure', 'envI'], COLK = ['top', 'hor', 'sunCol', 'hemiSky', 'hemiGround', 'cloud'];
/** stan nieba dla fazy p (cyklicznie) */
export function skyAt(p) {
  p = ((p % 1) + 1) % 1;
  let i = 0; while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = Math.min(1, Math.max(0, (p - a.p) / (b.p - a.p))), o = { az: 2.1 + p * 2.2 };
  for (const k of NUMK) o[k] = a[k] + (b[k] - a[k]) * t;
  for (const k of COLK) o[k] = '#' + lerpC(a[k], b[k], t).getHexString();
  return o;
}

// ---- wspólne klocki dekoracji ----
const colored = (geo, color, y = 0) => { geo.translate(0, y, 0); const n = geo.attributes.position.count, col = new Float32Array(n * 3), c = new THREE.Color(color); for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo = geo.toNonIndexed(); geo.deleteAttribute('uv'); return geo; };

function instanced(ctx, geo, mat, spots, fn) {
  const { root, m4, q4, v3, s3, eul, rnd } = ctx;
  const im = new THREE.InstancedMesh(geo, mat, spots.length), tint = new THREE.Color();
  spots.forEach(([x, z], i) => { const r = fn(x, z, i, rnd); q4.setFromEuler(eul.set(0, r.yaw ?? rnd() * 6.28, 0)); im.setMatrixAt(i, m4.compose(v3.set(x, r.y ?? ctx.hAt(x, z), z), q4, s3.set(r.sx, r.sy ?? r.sx, r.sz ?? r.sx))); im.setColorAt(i, tint.setScalar(0.8 + rnd() * 0.35)); });
  s3.set(1, 1, 1); im.castShadow = true; im.receiveShadow = true; root.add(im); return im;
}
function pines(ctx, count, { minD = 24, maxD = 100, snow = false } = {}) {
  const parts = [colored(new THREE.CylinderGeometry(0.28, 0.4, 1.8, 7), '#6b4a33', 0.9), colored(new THREE.ConeGeometry(2.5, 3.4, 8), snow ? '#cfe3ee' : '#2f7d4a', 3.1), colored(new THREE.ConeGeometry(1.95, 3, 8), snow ? '#e4f0f6' : '#38905a', 4.7), colored(new THREE.ConeGeometry(1.4, 2.6, 8), snow ? '#ffffff' : '#43a468', 6.1)];
  const geo = ctx.mergeGeometries(parts);
  instanced(ctx, geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 }), ctx.scatter(count, minD, maxD, 6.5, 9000), (x, z, i, rnd) => ({ sx: 1.2 + rnd() * 1.4, sy: 1.3 + rnd() * 1.6 }));
}
function palms(ctx, count, { minD = 22, maxD = 110, y = 0 } = {}) {
  const parts = [colored(new THREE.CylinderGeometry(0.3, 0.55, 8.5, 6), '#8a6a44', 4.25)];
  for (let i = 0; i < 7; i++) { const g = new THREE.ConeGeometry(0.9, 6, 5); g.rotateZ(Math.PI / 2.6); g.translate(2.6, 0, 0); g.rotateY((i / 7) * Math.PI * 2); g.translate(0, 8.6, 0); parts.push(colored(g, i % 2 ? '#2e9e5a' : '#3fba6a')); }
  const geo = ctx.mergeGeometries(parts);
  instanced(ctx, geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 }), ctx.scatter(count, minD, maxD, 7, 9000), (x, z, i, rnd) => ({ sx: 0.9 + rnd() * 0.7, sy: 0.9 + rnd() * 0.8, y: ctx.hAt(x, z) + (y ?? 0) }));
}
function rocks(ctx, count, color, { minD = 20, maxD = 120, scale = [1, 5] } = {}) {
  instanced(ctx, new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.92 }), ctx.scatter(count, minD, maxD, 8, 5000), (x, z, i, rnd) => { const s = scale[0] + rnd() * (scale[1] - scale[0]); return { sx: s * 1.2, sy: s * 0.8, sz: s, y: ctx.hAt(x, z) + s * 0.1 }; });
}
function ringMountains(ctx, count, colorA, colorB, { r0 = 900, r1 = 2000, h = [120, 420] } = {}) {
  const { root, rnd, cx, cz, groundY, farDist } = ctx;
  for (let i = 0; i < count; i++) {
    let x, z, hh, rad, ok = false;
    for (let t = 0; t < 40 && !ok; t++) {
      const a = rnd() * Math.PI * 2, r = r0 + rnd() * (r1 - r0) + t * 40; hh = h[0] + rnd() * (h[1] - h[0]); rad = hh * (0.9 + rnd() * 0.7);
      x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r; ok = farDist(x, z) > rad * 0.85 + 90;
    }
    if (!ok) continue;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(rad, hh, 6 + (rnd() * 3 | 0)), new THREE.MeshStandardMaterial({ color: colorA, flatShading: true, roughness: 1 }));
    cone.position.set(x, groundY + hh / 2 - 6, z); cone.rotation.y = rnd() * 3; root.add(cone);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.38, hh * 0.38, 6), new THREE.MeshStandardMaterial({ color: colorB, flatShading: true, roughness: 0.9 })); cap.position.set(x, groundY + hh * 0.81 - 6, z); root.add(cap);
  }
}
function grandstand(ctx, s, side = -1) {
  const { root, track, rnd, groundY, T } = ctx, f = track.at(s, {});
  const g = new THREE.Group(), rows = 6, rowD = 1.7, len = 56;
  g.position.set(f.px + f.rx * side * 24, ctx.hAt(f.px + f.rx * side * 24, f.pz + f.rz * side * 24), f.pz + f.rz * side * 24);
  g.rotation.y = -Math.atan2(f.tz, f.tx) + (side > 0 ? Math.PI : 0);
  const conc = new THREE.MeshStandardMaterial({ color: 0xcfc8d8, roughness: 0.9 });
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.95, 0.5), new THREE.MeshStandardMaterial({ roughness: 0.8 }), rows * 60), heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.7 }), rows * 60);
  const shirt = ['#e0457b', '#19b6c9', '#ffb61e', '#ffffff', '#6d5bd0', '#ff7a1a', '#4caf50', '#2d3350'].map((c) => new THREE.Color(c)), skin = ['#f2c9a5', '#d9a17c', '#a8704c', '#7a4a32'].map((c) => new THREE.Color(c));
  const m = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1); let ci = 0;
  for (let r = 0; r < rows; r++) {
    const zc = -(r * rowD), hgt = 0.9 * (r + 1);
    const step = new THREE.Mesh(new THREE.BoxGeometry(len, hgt, rowD), conc); step.position.set(0, hgt / 2, zc); step.castShadow = true; step.receiveShadow = true; g.add(step);
    for (let k = 0; k < 58; k++) { if (rnd() < 0.12) continue; const x = -len / 2 + 0.8 + k * ((len - 1.6) / 57); crowd.setMatrixAt(ci, m.compose(v.set(x, hgt + 0.45, zc - 0.1), q, sc)); crowd.setColorAt(ci, shirt[rnd() * shirt.length | 0]); heads.setMatrixAt(ci, m.compose(v.set(x, hgt + 1.2, zc - 0.1), q, sc)); heads.setColorAt(ci, skin[rnd() * skin.length | 0]); ci++; }
  }
  crowd.count = heads.count = ci; crowd.castShadow = heads.castShadow = true; g.add(crowd, heads);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.5, rows * rowD + 3), new THREE.MeshStandardMaterial({ color: T.roof ?? 0x2a2f55, roughness: 0.6 })); roof.position.set(0, 0.9 * rows + 4.5, -(rows * rowD) / 2); roof.castShadow = true; g.add(roof);
  for (const x of [-len / 2, len / 2]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.9 * rows + 4.5, 8), new THREE.MeshStandardMaterial({ color: 0xdfe3ec, metalness: 0.5, roughness: 0.4 })); p.position.set(x, (0.9 * rows + 4.5) / 2, -rows * rowD); g.add(p); }
  root.add(g);
}
function floodlights(ctx, count) {
  const { root, rnd } = ctx;
  for (const [x, z] of ctx.scatter(count, 40, 90, 120)) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 34, 8), new THREE.MeshStandardMaterial({ color: 0x8b8f99, metalness: 0.5, roughness: 0.5 })); p.position.set(x, ctx.hAt(x, z) + 17, z); p.castShadow = true; root.add(p);
    const h = new THREE.Mesh(new THREE.BoxGeometry(7, 2, 3), new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffe0a0, emissiveIntensity: 2.2 })); h.position.set(x, ctx.hAt(x, z) + 35, z); h.lookAt(ctx.cx, ctx.groundY + 10, ctx.cz); root.add(h);
  }
}
/** wieżowce z podświetlonymi oknami (Tokio) */
function skyline(ctx, count, { hmin = 40, hmax = 150, palette, lit = 0.6, wall = ['#2b2740', '#241f38', '#322b4d', '#1e1a30'], minD = 30 }) {
  const { root, rnd, canvasTex, rng, world, groundY } = ctx;
  const mk = (emissive) => canvasTex(256, 256, (x, w, h) => { const rr = rng(91); x.fillStyle = emissive ? '#000' : '#fff'; x.fillRect(0, 0, w, h); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const on = rr() < lit, col = palette[(rr() * palette.length) | 0], px = i * 64 + 12, py = j * 64 + 12; if (emissive) { if (on) { x.fillStyle = col; x.fillRect(px, py, 40, 38); } } else { x.fillStyle = on ? col : '#1a2234'; x.fillRect(px, py, 40, 38); } } });
  const mat = new THREE.MeshStandardMaterial({ map: mk(false), emissiveMap: mk(true), emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.55, metalness: 0.2 });
  world.windowMat = mat;
  const variants = [];
  for (let v = 0; v < 12; v++) {
    const bw = 12 + rnd() * 12, bd = 12 + rnd() * 12, bh = hmin + rnd() * (hmax - hmin), g = new THREE.BoxGeometry(bw, bh, bd), uv = g.attributes.uv;
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; if (f === 2 || f === 3) { uv.setXY(i, 0.02, 0.02); continue; } uv.setXY(i, uv.getX(i) * ((f < 2 ? bd : bw) / 16), uv.getY(i) * (bh / 16)); }
    g.translate(0, bh / 2, 0); variants.push({ g, list: [] });
  }
  const tint = new THREE.Color(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), eul = new THREE.Euler(), s1 = new THREE.Vector3(1, 1, 1);
  for (const [x, z] of ctx.scatter(count, minD, 110, 30, 14000)) variants[(rnd() * variants.length) | 0].list.push([x, z]);
  for (const v of variants) {
    if (!v.list.length) continue; const im = new THREE.InstancedMesh(v.g, mat, v.list.length);
    v.list.forEach(([x, z], i) => { q.setFromEuler(eul.set(0, Math.floor(rnd() * 4) * Math.PI / 2, 0)); im.setMatrixAt(i, m4.compose(v3.set(x, ctx.hAt(x, z) - 3, z), q, s1)); im.setColorAt(i, tint.set(wall[(rnd() * wall.length) | 0]).multiplyScalar(1.35)); });
    im.castShadow = true; im.receiveShadow = true; root.add(im);
  }
}
function neonPillars(ctx, count, colors) {
  const { root, rnd, m4, q4, v3, s3 } = ctx, spots = ctx.scatter(count, 40, 110, 40);
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 1, 1.2), new THREE.MeshBasicMaterial({ color: 0xffffff }), spots.length), c = new THREE.Color();
  spots.forEach(([x, z], i) => { const h = 90 + rnd() * 120; im.setMatrixAt(i, m4.compose(v3.set(x, ctx.hAt(x, z) + h / 2 - 2, z), q4.identity(), s3.set(1, h, 1))); im.setColorAt(i, c.set(colors[(rnd() * colors.length) | 0])); });
  s3.set(1, 1, 1); root.add(im);
}
function pyramids(ctx, count) {
  const { root, rnd, cx, cz, groundY, farDist } = ctx;
  for (let i = 0, placed = 0, t = 0; placed < count && t < 400; t++) {
    const a = rnd() * Math.PI * 2, r = 500 + rnd() * 1400, h = 90 + rnd() * 200, s = h * 1.5, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (farDist(x, z) < s * 1.1 + 90) continue;
    const m = new THREE.Mesh(new THREE.ConeGeometry(s, h, 4), new THREE.MeshStandardMaterial({ color: i++ % 2 ? 0xd9b878 : 0xc9a566, flatShading: true, roughness: 1 }));
    m.rotation.y = Math.PI / 4 + rnd() * 0.3; m.position.set(x, groundY + h / 2 - 2, z); m.castShadow = true; root.add(m); placed++;
  }
}
function dunes(ctx, count) {
  const { root, rnd, groundY } = ctx, mat = new THREE.MeshStandardMaterial({ color: 0xe0c183, roughness: 1, flatShading: true });
  for (const [x, z] of ctx.scatter(count, 90, 140, 90)) { const s = 12 + rnd() * 22; const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), mat); m.scale.set(s * 2.2, s * 0.35, s * 1.4); m.position.set(x, ctx.hAt(x, z) + s * 0.02, z); m.rotation.y = rnd() * 3; root.add(m); }
}
function islands(ctx, count) {
  const { root, rnd, cx, cz, groundY, farDist } = ctx;
  for (let i = 0, placed = 0, t = 0; placed < count && t < 400; t++) {
    const a = rnd() * Math.PI * 2, r = 300 + rnd() * 1300, s = 28 + rnd() * 60, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (farDist(x, z) < s + 120) continue;
    const isl = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.8, s, 5, 16), new THREE.MeshStandardMaterial({ color: 0xe8d6a0, roughness: 1 })); isl.position.set(x, groundY + 0.4, z); root.add(isl);
    const g = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.55, s * 0.7, 3, 16), new THREE.MeshStandardMaterial({ color: 0x3fb06a, roughness: 1 })); g.position.copy(isl.position); g.position.y += 2; root.add(g); placed++;
  }
}

// ---- motywy ----
export const THEMES3D = {
  stadion: {
    name: 'Polska', ground: ['#4a9a52', '#7ac27a', '#2f7a40'], asphalt: '#4a4658', centerLine: 'rgba(245,243,250,0.85)', slab: 0xb7b2aa, kerb: [0xd6242c, 0xf5f2ee], barrier: ['#e84a4a', '#f4f4f8'], barrierCap: 0x9aa0ae, cpColor: 0x25d4ff,
    startPhase: 0.2, balloons: 3, birds: 14, roof: 0x2a2f55, relief: 5,
    decor(world, ctx) { pines(ctx, 260); rocks(ctx, 50, 0xa7a5b4); grandstand(ctx, world.track.startS + 30, -1); grandstand(ctx, world.track.finishS - 40, 1); floodlights(ctx, 8); ringMountains(ctx, 18, 0x6f8a9a, 0xe8eef6, { r0: 1100, r1: 2200, h: [90, 260] }); },
  },
  tokyo: {
    name: 'Japonia', ground: ['#0d0b1c', '#1c1838', '#08060f'], asphalt: '#1c1830', centerLine: 'rgba(37,244,255,0.85)', slab: 0x2b2650, kerb: [0x25f4ff, 0xff2bd6], barrier: ['#1b1740', '#2b2260'], barrierCap: 0xff2bd6, cpColor: 0xff2bd6, neon: true, neonColor: 0x25f4ff,
    startPhase: 0.62, birds: 0, skyBias: 'night', relief: 0, tunnel: 0x34304f, portal: 0x5a4f8a, bridge: 0x3a3560,
    decor(world, ctx) { skyline(ctx, 520, { hmin: 40, hmax: 160, palette: ['#ff2bd6', '#25f4ff', '#ffd84d', '#7c5cff', '#7cff6b'], lit: 0.62, minD: 34 }); neonPillars(ctx, 40, ['#ff2bd6', '#25f4ff', '#7c5cff']); },
  },
  alpy: {
    name: 'Alpy (Szwajcaria)', ground: ['#e8eef6', '#ffffff', '#c4d0e0'], asphalt: '#3d4150', centerLine: 'rgba(245,243,250,0.85)', slab: 0x9aa2b0, kerb: [0x2a6bd6, 0xf5f2ee], barrier: ['#2f6bd6', '#f5f2ee'], barrierCap: 0xc4d0e0, cpColor: 0x7aa8ff,
    startPhase: 0.15, balloons: 2, birds: 8, relief: 16, tunnel: 0x8a909c,
    decor(world, ctx) { pines(ctx, 300, { snow: true }); rocks(ctx, 90, 0x9aa2b2, { scale: [1, 6] }); ringMountains(ctx, 34, 0x6f7f95, 0xffffff, { r0: 500, r1: 1900, h: [180, 520] }); },
  },
  egipt: {
    name: 'Egipt', ground: ['#d9b878', '#ecd29a', '#b88e52'], asphalt: '#5a5460', centerLine: 'rgba(255,240,200,0.9)', slab: 0xc9a566, kerb: [0xd9a02e, 0xf2e6c4], barrier: ['#c28f62', '#e6d2a8'], barrierCap: 0x8a6a44, cpColor: 0xffd25a,
    startPhase: 0.36, balloons: 5, birds: 6, relief: 7, sandRoad: '#a8703a', tunnel: 0xb99a66, portal: 0xd8c08a, bridge: 0xb8955a,
    decor(world, ctx) { palms(ctx, 150); rocks(ctx, 70, 0xc09270, { scale: [1, 5] }); pyramids(ctx, 10); dunes(ctx, 40); },
  },
  tropiki: {
    name: 'Hawaje', water: true, ground: [0x1fa6c4, 0x1aa0b8, 0x127f9a], asphalt: '#4b4b5a', centerLine: 'rgba(255,255,255,0.9)', slab: 0xe8e0cc, kerb: [0xff7a1a, 0xfff4e6], barrier: ['#ffffff', '#19b6c9'], barrierCap: 0xff7a1a, cpColor: 0xffb02e, groundDrop: 1.2,
    startPhase: 0.44, balloons: 2, birds: 22, relief: 0, sandRoad: '#c99a58', bridge: 0xe8e0cc,
    decor(world, ctx) { islands(ctx, 18); palms(ctx, 90, { minD: 24, maxD: 90 }); ringMountains(ctx, 10, 0x4a6a58, 0x6a8a74, { r0: 1300, r1: 2300, h: [160, 360] }); },
  },
};
export const THEME_IDS = Object.keys(THEMES3D);
