// Przedmioty na torze 3D: paczki (nitro, karabin, olej, mina), miny, plamy oleju i pociski — wszystko w współrzędnych toru (s, d).
import * as THREE from 'three';

export const ITEM_TYPES = {
  nitro: { color: '#27c7ff', name: 'Nitro' },
  ammo: { color: '#ffb02e', name: 'Karabin' },
  oil: { color: '#a46bff', name: 'Olej' },
  bomb: { color: '#ff4a3a', name: 'Mina' },
};
const crateGeo = new THREE.BoxGeometry(1.7, 1.7, 1.7);
const ringGeo = new THREE.TorusGeometry(1.35, 0.07, 6, 28);
const mineGeo = new THREE.SphereGeometry(0.85, 14, 10);
const shotGeo = new THREE.BoxGeometry(1.5, 0.28, 0.28);
const oilGeo = new THREE.CircleGeometry(3.3, 28).rotateX(-Math.PI / 2);
const oilMat = new THREE.MeshStandardMaterial({ color: 0x07060b, roughness: 0.04, metalness: 0.9, transparent: true, opacity: 0.88, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false });
const shotMat = new THREE.MeshBasicMaterial({ color: 0xffe28a });
const _m = new THREE.Matrix4(), _p = {}, _t = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();

export class Items3D {
  constructor(scene, particles) {
    this.scene = scene; this.particles = particles; this.track = null;
    this.root = new THREE.Group(); scene.add(this.root);
    this.crates = new Map(); this.mines = []; this.oils = []; this.shots = [];
    this._thud = null;
  }
  setTrack(track) { this.clear(); this.track = track; }
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
    const box = new THREE.Mesh(crateGeo, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.3 })); box.castShadow = true;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8 })); ring.rotation.x = Math.PI / 2;
    g.add(box, ring); this.root.add(g);
    const f = this.track.at(s, {}), c = { id, type, s, d, g, box, ring, age: 0, landed: false, dying: 0,
      base: new THREE.Vector3(f.px + f.rx * d + f.ux * 1.5, f.py + f.ry * d + f.uy * 1.5, f.pz + f.rz * d + f.uz * 1.5), up: new THREE.Vector3(f.ux, f.uy, f.uz) };
    g.position.copy(c.base).addScaledVector(c.up, 26); this.crates.set(id, c);
  }
  remove(id, burst = true) {
    const c = this.crates.get(id); if (!c) return;
    if (burst) { const col = new THREE.Color(ITEM_TYPES[c.type].color); for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, sp = 3 + Math.random() * 9; this.particles.emit(c.g.position.x, c.g.position.y, c.g.position.z, Math.cos(a) * sp, 2 + Math.random() * 6, Math.sin(a) * sp, 0.5, 0.9, 0.1, col, 0.9, 1.5, 6); } }
    c.dying = 1; this.root.remove(c.g); this.crates.delete(id);
  }
  /** paczka w zasięgu (ds po torze, dd w poprzek) */
  crateNear(s, d, rs = 3.4, rd = 3.4) { for (const c of this.crates.values()) if (c.landed && Math.abs(c.s - s) < rs && Math.abs(c.d - d) < rd) return c; return null; }
  // ---- miny ----
  dropMine(id, s, d, owner) {
    const m = new THREE.Mesh(mineGeo, new THREE.MeshStandardMaterial({ color: 0x20202a, emissive: 0xff2a1a, emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.6 })); m.castShadow = true;
    this._frame(s, d, 0.55); m.position.setFromMatrixPosition(_m); this.root.add(m);
    const mine = { id, s, d, owner, mesh: m, age: 0, dead: false }; this.mines.push(mine); return mine;
  }
  removeMine(id) { const i = this.mines.findIndex((m) => m.id === id); if (i >= 0) { this.root.remove(this.mines[i].mesh); this.mines.splice(i, 1); } }
  mineNear(s, d, rs = 2.8, rd = 2.8) { for (const m of this.mines) if (m.age > 0.8 && Math.abs(m.s - s) < rs && Math.abs(m.d - d) < rd) return m; return null; }
  // ---- olej ----
  dropOil(s, d, owner) {
    const m = new THREE.Mesh(oilGeo, oilMat); this._frame(s, d, 0.07); m.matrixAutoUpdate = false; m.matrix.copy(_m); this.root.add(m);
    this.oils.push({ s, d, owner, mesh: m, age: 0 });
  }
  oilAt(s, d) { for (const o of this.oils) if (Math.abs(o.s - s) < 3.3 && Math.abs(o.d - d) < 3.3 && Math.hypot(o.s - s, o.d - d) < 3.4) return true; return false; }
  // ---- pociski ----
  shoot(s, d, vs, owner) {
    const m = new THREE.Mesh(shotGeo, shotMat); this.root.add(m);
    const sh = { s, d, vs, owner, mesh: m, age: 0, life: 1.5 }; this.shots.push(sh); return sh;
  }
  killShot(sh) { sh.life = 0; }
  update(dt, T) {
    for (const c of this.crates.values()) {
      c.age += dt;
      const k = Math.min(1, c.age / 1.0);
      if (!c.landed) { c.g.position.copy(c.base).addScaledVector(c.up, 26 * (1 - k) * (1 - k)); if (k >= 1) { c.landed = true; this._thud?.(); } }
      else c.g.position.copy(c.base).addScaledVector(c.up, Math.sin(T * 2 + c.s) * 0.18);
      c.box.rotation.y += dt * 1.6; c.box.rotation.x += dt * 0.7; c.ring.rotation.z += dt * 2;
    }
    for (const m of this.mines) { m.age += dt; m.mesh.material.emissiveIntensity = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(T * 8 + m.s)); }
    for (let i = this.oils.length - 1; i >= 0; i--) { const o = this.oils[i]; o.age += dt; if (o.age > 18) { this.root.remove(o.mesh); this.oils.splice(i, 1); } }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const sh = this.shots[i]; sh.age += dt; sh.s += sh.vs * dt;
      if (sh.age > sh.life || sh.s > this.track.length || sh.s < 0) { this.root.remove(sh.mesh); this.shots.splice(i, 1); continue; }
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
  }
}
const _c = new THREE.Color(1, 0.75, 0.25);
function tmpEmit(p, pos) { p.emit(pos.x, pos.y, pos.z, 0, 0.3, 0, 0.18, 0.7, 0.1, _c, 0.7, 2); }
