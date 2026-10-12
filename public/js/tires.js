// Stosy opon przy bandzie: po uderzeniu rozlatują się (prosta fizyka odłamków, instancje GPU).
import * as THREE from 'three';

const CELL = 4;
const TIRE_HIT_R = 0.6;

export class TireField {
  constructor(parent, list, maxDebris = 180) {
    this.list = list;
    const geo = new THREE.TorusGeometry(0.5, 0.24, 10, 18); geo.rotateX(Math.PI / 2);
    this.mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    this.base = new THREE.InstancedMesh(geo, this.mat, Math.max(1, list.length));
    this.alive = new Uint8Array(list.length).fill(1);
    this.grid = new Map();
    const m = new THREE.Matrix4(), c = new THREE.Color();
    list.forEach((t, i) => {
      this.base.setMatrixAt(i, m.makeTranslation(t.x, t.y, t.z));
      this.base.setColorAt(i, c.set(t.color));
      const k = this._key(t.x, t.z);
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(i);
    });
    this.base.count = list.length;
    this.base.castShadow = true; this.base.receiveShadow = true;
    parent.add(this.base);

    this.max = maxDebris; this.cursor = 0;
    this.deb = new THREE.InstancedMesh(geo, this.mat, maxDebris);
    this.deb.castShadow = true; this.deb.receiveShadow = true; this.deb.frustumCulled = false;
    this.p = new Float32Array(maxDebris * 3); this.v = new Float32Array(maxDebris * 3);
    this.w = new Float32Array(maxDebris * 3);
    this.q = Array.from({ length: maxDebris }, () => new THREE.Quaternion());
    this.age = new Float32Array(maxDebris).fill(1e9);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < maxDebris; i++) { this.deb.setMatrixAt(i, zero); this.deb.setColorAt(i, c.set('#222')); }
    parent.add(this.deb);
    this._m = new THREE.Matrix4(); this._s = new THREE.Vector3(1, 1, 1); this._pos = new THREE.Vector3(); this._qq = new THREE.Quaternion(); this._e = new THREE.Vector3();
  }

  _key(x, z) { return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; }

  /** Sprawdza kolizje okręgów auta z oponami; zwraca liczbę rozbitych opon. */
  collide(car, carR, onBurst) {
    const cs = Math.cos(car.yaw), sn = Math.sin(car.yaw);
    let n = 0;
    for (const off of [1.45, -1.45]) {
      const cx = car.x + cs * off, cz = car.z + sn * off;
      const x0 = Math.floor((cx - carR - 1) / CELL), x1 = Math.floor((cx + carR + 1) / CELL);
      const z0 = Math.floor((cz - carR - 1) / CELL), z1 = Math.floor((cz + carR + 1) / CELL);
      for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) {
        const cell = this.grid.get(`${a},${b}`); if (!cell) continue;
        for (const i of cell) {
          if (!this.alive[i]) continue;
          const t = this.list[i];
          if (Math.hypot(t.x - cx, t.z - cz) < carR + TIRE_HIT_R) { this._burst(i, car, cx, cz); n++; onBurst?.(t.x, t.z); }
        }
      }
    }
    return n;
  }

  _burst(i, car, cx, cz) {
    this.alive[i] = 0;
    this.base.setMatrixAt(i, this._m.makeScale(0, 0, 0));
    this.base.instanceMatrix.needsUpdate = true;
    const t = this.list[i];
    const d = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    let dx = t.x - cx, dz = t.z - cz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const sp = Math.hypot(car.vx, car.vz);
    this.p.set([t.x, t.y, t.z], d * 3);
    this.v.set([car.vx * 0.75 + dx * (2 + Math.random() * 4) + (Math.random() - 0.5) * 3, 5 + Math.random() * 6 + sp * 0.12, car.vz * 0.75 + dz * (2 + Math.random() * 4) + (Math.random() - 0.5) * 3], d * 3);
    this.w.set([(Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22], d * 3);
    this.q[d].set(0, 0, 0, 1);
    this.age[d] = 0;
    this.deb.setColorAt(d, new THREE.Color(t.color));
    this.deb.instanceColor.needsUpdate = true;
  }

  update(dt) {
    const m = this._m, s = this._s, pos = this._pos, qq = this._qq, e = this._e;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] > 1e8) continue;
      this.age[i] += dt;
      const a = this.age[i];
      if (a > 20) { this.age[i] = 1e9; this.deb.setMatrixAt(i, m.makeScale(0, 0, 0)); continue; }
      const k = i * 3;
      this.v[k + 1] -= 28 * dt;
      this.p[k] += this.v[k] * dt; this.p[k + 1] += this.v[k + 1] * dt; this.p[k + 2] += this.v[k + 2] * dt;
      if (this.p[k + 1] < 0.26) {
        this.p[k + 1] = 0.26;
        if (this.v[k + 1] < -1) this.v[k + 1] *= -0.42; else this.v[k + 1] = 0;
        const f = Math.max(0, 1 - 2.4 * dt); this.v[k] *= f; this.v[k + 2] *= f;
        const wf = Math.max(0, 1 - 3 * dt); this.w[k] *= wf; this.w[k + 1] *= wf; this.w[k + 2] *= wf;
      }
      e.set(this.w[k], this.w[k + 1], this.w[k + 2]);
      const ang = e.length() * dt;
      if (ang > 1e-5) { qq.setFromAxisAngle(e.normalize(), ang); this.q[i].premultiply(qq); }
      const sc = a > 18.5 ? Math.max(0, (20 - a) / 1.5) : 1;
      pos.set(this.p[k], this.p[k + 1], this.p[k + 2]);
      s.set(sc, sc, sc);
      this.deb.setMatrixAt(i, m.compose(pos, this.q[i], s));
    }
    this.deb.instanceMatrix.needsUpdate = true;
  }

  reset() {
    const m = this._m;
    this.alive.fill(1);
    this.list.forEach((t, i) => this.base.setMatrixAt(i, m.makeTranslation(t.x, t.y, t.z)));
    this.base.instanceMatrix.needsUpdate = true;
    this.age.fill(1e9);
    for (let i = 0; i < this.max; i++) this.deb.setMatrixAt(i, m.makeScale(0, 0, 0));
    this.deb.instanceMatrix.needsUpdate = true;
  }
}
