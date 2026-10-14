// Przedmioty na torze 3D: paczki (nitro, karabin, olej, mina), miny, plamy oleju i pociski — wszystko w współrzędnych toru (s, d).
import * as THREE from 'three';

export const ITEM_TYPES = {
  nitro: { color: '#27c7ff', name: 'Nitro' },
  ammo: { color: '#ffb02e', name: 'Karabin' },
  oil: { color: '#a46bff', name: 'Olej' },
  bomb: { color: '#ff4a3a', name: 'Mina' },
  rocket: { color: '#ff6a3d', name: 'Rakieta' },
  repair: { color: '#3ee08a', name: 'Naprawa' },
  shield: { color: '#35d0ff', name: 'Pancerz' },
};
// znaki paczek (ścieżki SVG 32×32, te same co ikony na HUD) — rysowane na teksturach ścianek i latającego znaku nad paczką
const GLYPHS = {
  nitro: ['M18.5 3L7 18.5h8l-2 10.5L25 13h-8z'],
  ammo: ['M16 3.5c3.2 2.8 4.8 6.6 4.8 11V24h-9.6v-9.5c0-4.4 1.6-8.2 4.8-11z', 'M11.2 24h9.6v3.5h-9.6z', 'M16 9v9'],
  oil: ['M16 3.5s8.5 9 8.5 15a8.5 8.5 0 01-17 0c0-6 8.5-15 8.5-15z', 'M11.5 19a4.5 4.5 0 003.5 4.4'],
  bomb: ['M16 9.5a6.5 6.5 0 110 13 6.5 6.5 0 010-13z', 'M16 4v5M16 23v5M4 16h5M23 16h5M7.5 7.5l3.5 3.5M21 21l3.5 3.5M24.5 7.5L21 11M11 21l-3.5 3.5'],
  rocket: ['M16 2.5c3.4 3.2 4.7 7.5 4.5 12.5l-2 6h-5l-2-6c-.2-5 1.1-9.3 4.5-12.5z', 'M11.5 15l-3.8 5.5 3.8-.5M20.5 15l3.8 5.5-3.8-.5M13.3 24.5h5.4M16 24.5v4.5'],
  repair: ['M16 3l11 6.3v13.4L16 29 5 22.7V9.3z', 'M16 10v12M10 16h12'],
  shield: ['M16 2.8l10.5 4v8.2c0 7.2-4.6 11.4-10.5 14.2C10.1 26.4 5.5 22.2 5.5 15V6.8z', 'M11 15.5l3.6 3.6L21.5 12'],
};
const texCache = new Map();
/** tekstura ścianki paczki (panel z neonową ramką i znakiem) lub samego znaku (do sprite'a nad paczką) */
function glyphTex(type, panel) {
  const key = type + (panel ? 'p' : 'g'); if (texCache.has(key)) return texCache.get(key);
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const x = cv.getContext('2d'), col = ITEM_TYPES[type].color;
  if (panel) {
    const g = x.createLinearGradient(0, 0, S, S); g.addColorStop(0, '#10162a'); g.addColorStop(1, '#05070f'); x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.strokeStyle = col; x.lineWidth = 10; x.shadowColor = col; x.shadowBlur = 18; x.strokeRect(14, 14, S - 28, S - 28); x.shadowBlur = 0;
    x.globalAlpha = 0.22; x.fillStyle = col; x.fillRect(22, 22, S - 44, S - 44); x.globalAlpha = 1;
    for (let i = 0; i < 4; i++) { x.fillStyle = col; x.fillRect(i % 2 ? S - 40 : 14, i < 2 ? 14 : S - 40, 26, 26); } // narożniki
  }
  x.save(); const sc = (panel ? 0.66 : 0.84) * S / 32; x.translate(S / 2 - 16 * sc, S / 2 - 16 * sc); x.scale(sc, sc);
  x.lineWidth = 1.9; x.lineCap = x.lineJoin = 'round'; x.strokeStyle = panel ? '#ffffff' : col; x.fillStyle = panel ? col : col;
  x.shadowColor = col; x.shadowBlur = panel ? 6 : 10;
  for (const d of GLYPHS[type]) { const p = new Path2D(d); x.globalAlpha = 0.35; x.fill(p); x.globalAlpha = 1; x.stroke(p); }
  x.restore();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texCache.set(key, t); return t;
}
const beamTex = (() => { const c = document.createElement('canvas'); c.width = 4; c.height = 64; const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0.9)'); x.fillStyle = g; x.fillRect(0, 0, 4, 64); return new THREE.CanvasTexture(c); })();
const crateMats = new Map(), beamGeo = new THREE.CylinderGeometry(0.55, 0.85, 14, 14, 1, true).translate(0, 7, 0), ring2Geo = new THREE.TorusGeometry(1.75, 0.045, 6, 36);
function crateMat(type) {
  if (!crateMats.has(type)) { const t = glyphTex(type, true); crateMats.set(type, new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.4 })); }
  return crateMats.get(type);
}
const crateGeo = new THREE.BoxGeometry(1.7, 1.7, 1.7);
const ringGeo = new THREE.TorusGeometry(1.35, 0.07, 6, 28);
const mineGeo = new THREE.SphereGeometry(0.85, 14, 10);
const shotGeo = new THREE.BoxGeometry(1.5, 0.28, 0.28);
const oilGeo = new THREE.CircleGeometry(3.3, 28).rotateX(-Math.PI / 2);
const oilMat = new THREE.MeshStandardMaterial({ color: 0x07060b, roughness: 0.04, metalness: 0.9, transparent: true, opacity: 0.88, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false });
const shotMat = new THREE.MeshBasicMaterial({ color: 0xffe28a });
const rocketBody = new THREE.CylinderGeometry(0.2, 0.2, 2.0, 10), rocketNose = new THREE.ConeGeometry(0.2, 0.7, 10), rocketFin = new THREE.BoxGeometry(0.5, 0.04, 0.45), rocketFlame = new THREE.ConeGeometry(0.17, 1.2, 8);
const rocketMat = new THREE.MeshStandardMaterial({ color: 0xe9ebf2, metalness: 0.5, roughness: 0.3 }), rocketRed = new THREE.MeshStandardMaterial({ color: 0xd8321f, roughness: 0.45 }), rocketFire = new THREE.MeshBasicMaterial({ color: 0xffa23a });
const _m = new THREE.Matrix4(), _p = {}, _t = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();

export class Items3D {
  constructor(scene, particles) {
    this.scene = scene; this.particles = particles; this.track = null;
    this.root = new THREE.Group(); scene.add(this.root);
    this.crates = new Map(); this.mines = []; this.oils = []; this.shots = []; this.rockets = [];
    this._thud = null;
  }
  setTrack(track) { this.clear(); this.track = track; }
  /** różnica a−b po torze zamkniętym (najkrótsza, ze znakiem) */
  ds(a, b) { const L = this.track.length; return ((a - b + L / 2) % L + L) % L - L / 2; }
  /** macierz bazowa (x = do przodu toru, y = normalna, z = prawo) w punkcie (s, d) */
  _frame(s, d, h = 0) {
    const f = this.track.at(s, _p);
    _t.set(f.tx, f.ty, f.tz); _u.set(f.ux, f.uy, f.uz); _r.set(f.rx, f.ry, f.rz);
    _m.makeBasis(_t, _u, _r).setPosition(f.px + f.rx * d + f.ux * h, f.py + f.ry * d + f.uy * h, f.pz + f.rz * d + f.uz * h);
    return _m;
  }
  // ---- paczki ----
  spawn(id, type, s, d) {
    if (this.crates.has(id)) return;
    const col = new THREE.Color(ITEM_TYPES[type].color);
    const g = new THREE.Group();
    const box = new THREE.Mesh(crateGeo, crateMat(type)); box.castShadow = true;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8 })); ring.rotation.x = Math.PI / 2;
    const ring2 = new THREE.Mesh(ring2Geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55 })); ring2.rotation.x = Math.PI / 2;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTex(type, false), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); sprite.position.y = 2.7; sprite.scale.setScalar(2.4);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: col, map: beamTex, transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); beam.position.y = -1.3;
    g.add(box, ring, ring2, sprite, beam); this.root.add(g);
    const f = this.track.at(s, {}), c = { id, type, s, d, g, box, ring, ring2, sprite, beam, age: 0, landed: false, dying: 0,
      base: new THREE.Vector3(f.px + f.rx * d + f.ux * 1.5, f.py + f.ry * d + f.uy * 1.5, f.pz + f.rz * d + f.uz * 1.5), up: new THREE.Vector3(f.ux, f.uy, f.uz) };
    g.position.copy(c.base).addScaledVector(c.up, 26); this.crates.set(id, c);
  }
  remove(id, burst = true) {
    const c = this.crates.get(id); if (!c) return;
    if (burst) { const col = new THREE.Color(ITEM_TYPES[c.type].color); for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, sp = 3 + Math.random() * 9; this.particles.emit(c.g.position.x, c.g.position.y, c.g.position.z, Math.cos(a) * sp, 2 + Math.random() * 6, Math.sin(a) * sp, 0.5, 0.9, 0.1, col, 0.9, 1.5, 6); } }
    c.dying = 1; this.root.remove(c.g); this.crates.delete(id);
  }
  /** paczka w zasięgu (ds po torze, dd w poprzek) */
  crateNear(s, d, rs = 3.4, rd = 3.4) { for (const c of this.crates.values()) if (c.landed && Math.abs(this.ds(c.s, s)) < rs && Math.abs(c.d - d) < rd) return c; return null; }
  // ---- miny ----
  dropMine(id, s, d, owner) {
    const m = new THREE.Mesh(mineGeo, new THREE.MeshStandardMaterial({ color: 0x20202a, emissive: 0xff2a1a, emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.6 })); m.castShadow = true;
    this._frame(s, d, 0.55); m.position.setFromMatrixPosition(_m); this.root.add(m);
    const mine = { id, s, d, owner, mesh: m, age: 0, dead: false }; this.mines.push(mine); return mine;
  }
  removeMine(id) { const i = this.mines.findIndex((m) => m.id === id); if (i >= 0) { this.root.remove(this.mines[i].mesh); this.mines.splice(i, 1); } }
  mineNear(s, d, rs = 2.8, rd = 2.8) { for (const m of this.mines) if (m.age > 0.8 && Math.abs(this.ds(m.s, s)) < rs && Math.abs(m.d - d) < rd) return m; return null; }
  // ---- olej ----
  dropOil(s, d, owner) {
    const m = new THREE.Mesh(oilGeo, oilMat); this._frame(s, d, 0.07); m.matrixAutoUpdate = false; m.matrix.copy(_m); this.root.add(m);
    this.oils.push({ s, d, owner, mesh: m, age: 0 });
  }
  oilAt(s, d) { for (const o of this.oils) if (Math.abs(this.ds(o.s, s)) < 3.3 && Math.abs(o.d - d) < 3.3 && Math.hypot(this.ds(o.s, s), o.d - d) < 3.4) return true; return false; }
  // ---- pociski ----
  shoot(s, d, vs, owner) {
    const m = new THREE.Mesh(shotGeo, shotMat); this.root.add(m);
    const sh = { s, d, vs, owner, mesh: m, age: 0, life: 1.5 }; this.shots.push(sh); return sh;
  }
  killShot(sh) { sh.life = 0; }
  // ---- rakiety: lecą wzdłuż toru szybciej od auta i naprowadzają się na cel (zmiana pasa do 14 m/s) ----
  rocket(s, d, vs, owner, target = null) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(rocketBody, rocketMat); body.rotation.z = Math.PI / 2;
    const nose = new THREE.Mesh(rocketNose, rocketRed); nose.rotation.z = -Math.PI / 2; nose.position.x = 1.2;
    for (let i = 0; i < 3; i++) { const fin = new THREE.Mesh(rocketFin, rocketRed); fin.position.x = -0.8; fin.rotation.x = (i / 3) * Math.PI * 2; fin.position.y = Math.sin(fin.rotation.x) * 0.25; fin.position.z = -Math.cos(fin.rotation.x) * 0.25; g.add(fin); }
    const flame = new THREE.Mesh(rocketFlame, rocketFire); flame.rotation.z = Math.PI / 2; flame.position.x = -1.3;
    g.add(body, nose, flame); g.castShadow = true; this.root.add(g);
    const r = { s, d, vs, owner, target, mesh: g, flame, age: 0, life: 4, lastD: d }; this.rockets.push(r); return r;
  }
  killRocket(r) { r.life = 0; }
  update(dt, T) {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i]; r.age += dt;
      if (r.age > r.life) { this.root.remove(r.mesh); this.rockets.splice(i, 1); continue; }
      if (r.target) { const tds = this.ds(r.target.s, r.s); if (tds < -5) r.target = null; else { const dd = Math.max(-14 * dt, Math.min(14 * dt, r.target.d - r.d)); r.d += dd; } }
      r.s += r.vs * dt;
      const f = this.track.at(r.s, _p), lim = f.hw - 1.4; r.d = Math.max(-lim, Math.min(lim, r.d));
      const lat = Math.atan2((r.d - r.lastD) / Math.max(dt, 1e-3), r.vs); r.lastD = r.d;
      r.mesh.position.set(f.px + f.rx * r.d + f.ux * 0.9, f.py + f.ry * r.d + f.uy * 0.9, f.pz + f.rz * r.d + f.uz * 0.9);
      _t.set(f.tx, f.ty, f.tz); _u.set(f.ux, f.uy, f.uz); _r.set(f.rx, f.ry, f.rz); _m.makeBasis(_t, _u, _r); r.mesh.quaternion.setFromRotationMatrix(_m); r.mesh.rotateY(-lat);
      r.flame.scale.set(0.8 + Math.random() * 0.6, 1, 1);
      const pp = r.mesh.position;
      _c2.setRGB(1, 0.55 + Math.random() * 0.3, 0.12); this.particles.emit(pp.x - f.tx * 1.5, pp.y - f.ty * 1.5, pp.z - f.tz * 1.5, 0, 0.3, 0, 0.22, 0.9, 0.2, _c2, 0.9, 2);
      _c2.setRGB(0.75, 0.75, 0.78); this.particles.emit(pp.x - f.tx * 2, pp.y - f.ty * 2, pp.z - f.tz * 2, (Math.random() - 0.5) * 0.8, 0.5, (Math.random() - 0.5) * 0.8, 0.9, 0.7, 2.6, _c2, 0.4, 1.4);
    }
    for (const c of this.crates.values()) {
      c.age += dt;
      const k = Math.min(1, c.age / 1.0);
      if (!c.landed) { c.g.position.copy(c.base).addScaledVector(c.up, 26 * (1 - k) * (1 - k)); if (k >= 1) { c.landed = true; this._thud?.(); } }
      else c.g.position.copy(c.base).addScaledVector(c.up, Math.sin(T * 2 + c.s) * 0.18);
      c.box.rotation.y += dt * 1.9; c.box.rotation.x = Math.sin(T * 1.7 + c.s) * 0.18; c.ring.rotation.z += dt * 2.4; c.ring2.rotation.z -= dt * 1.5; c.ring2.rotation.x = Math.PI / 2 + Math.sin(T * 2 + c.s) * 0.3;
      const pu = 1 + 0.5 * (0.5 + 0.5 * Math.sin(T * 5 + c.s * 0.1)); c.ring.scale.setScalar(0.92 + 0.12 * pu); c.sprite.scale.setScalar(2.2 + 0.4 * pu); c.sprite.position.y = 2.7 + Math.sin(T * 2.6 + c.s) * 0.25; c.sprite.material.opacity = 0.75 + 0.25 * Math.sin(T * 6 + c.s);
      c.beam.material.opacity = (c.landed ? 0.26 + 0.14 * Math.sin(T * 3 + c.s) : 0.5) * Math.min(1, c.age * 2);
    }
    for (const m of this.mines) { m.age += dt; m.mesh.material.emissiveIntensity = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(T * 8 + m.s)); }
    for (let i = this.oils.length - 1; i >= 0; i--) { const o = this.oils[i]; o.age += dt; if (o.age > 18) { this.root.remove(o.mesh); this.oils.splice(i, 1); } }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const sh = this.shots[i]; sh.age += dt; sh.s += sh.vs * dt;
      if (sh.age > sh.life) { this.root.remove(sh.mesh); this.shots.splice(i, 1); continue; }
      const f = this.track.at(sh.s, _p);
      sh.mesh.position.set(f.px + f.rx * sh.d + f.ux * 1.0, f.py + f.ry * sh.d + f.uy * 1.0, f.pz + f.rz * sh.d + f.uz * 1.0);
      _t.set(f.tx, f.ty, f.tz); _u.set(f.ux, f.uy, f.uz); _r.set(f.rx, f.ry, f.rz); _m.makeBasis(_t, _u, _r); sh.mesh.quaternion.setFromRotationMatrix(_m);
      tmpEmit(this.particles, sh.mesh.position);
    }
  }
  clear() {
    for (const c of this.crates.values()) this.root.remove(c.g); this.crates.clear();
    for (const m of this.mines) this.root.remove(m.mesh); this.mines.length = 0;
    for (const o of this.oils) this.root.remove(o.mesh); this.oils.length = 0;
    for (const s of this.shots) this.root.remove(s.mesh); this.shots.length = 0;
    for (const r of this.rockets) this.root.remove(r.mesh); this.rockets.length = 0;
  }
}
const _c = new THREE.Color(1, 0.75, 0.25), _c2 = new THREE.Color();
function tmpEmit(p, pos) { p.emit(pos.x, pos.y, pos.z, 0, 0.3, 0, 0.18, 0.7, 0.1, _c, 0.7, 2); }
