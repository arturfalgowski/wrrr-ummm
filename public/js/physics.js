// Arkadowa fizyka auta: przyspieszanie, hamowanie, drift (poślizg boczny), bariery i zderzenia aut.
import { ROAD_HALF, KERB_W, BARRIER } from './track.js';

export const CAR_DEFS = {
  aurora: { name: 'Pantera', tag: 'Uniwersalny roadster', color: '#e0457b', stripe: '#fff4e6',
    maxSpeed: 44, accel: 22, brake: 46, grip: 7.6, turn: 2.35, stats: [0.62, 0.62, 0.72] },
  vortex: { name: 'Tornado', tag: 'Szybkie GT, trudne w ślizgu', color: '#19b6c9', stripe: '#0c2a44',
    maxSpeed: 50, accel: 19, brake: 44, grip: 6.4, turn: 2.05, stats: [0.9, 0.5, 0.52] },
  blaze: { name: 'Szerszeń', tag: 'Zwinny i dynamiczny', color: '#ff7a1a', stripe: '#1a1a24',
    maxSpeed: 41, accel: 27, brake: 48, grip: 9.0, turn: 2.7, stats: [0.42, 0.88, 0.9] },
};

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class CarState {
  constructor(def) {
    this.def = def;
    this.x = 0; this.z = 0; this.yaw = 0; this.vx = 0; this.vz = 0;
    this.steer = 0; this.vf = 0; this.vl = 0;
    this.slip = 0; this.onGrass = false; this.onKerb = false;
    this.idx = 0; this.progress = 0; this.lastIdx = 0; this.d = 0;
    this.brakeLit = false; this.throttle = 0; this.accelNow = 0;
    this.hit = 0;           // siła ostatniego uderzenia (do dźwięku/iskier)
    this.wallContact = false;
    this.nitro = false; this.slowT = 0; this.inOil = false; this.t = 0;
  }

  place(track, p, lateral) {
    const q = track.at(p, lateral);
    this.x = q.x; this.z = q.z; this.yaw = q.yaw; this.vx = this.vz = 0; this.vf = this.vl = 0; this.steer = 0;
    this.progress = p;
    this.lastIdx = q.idx;
    this.idx = q.idx;
    this.slip = 0;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }

  /** input: {throttle, brake, steer, hand} */
  step(track, input, dt) {
    const def = this.def;
    const n = Math.max(1, Math.ceil(dt / 0.01));
    const h = dt / n;
    this.hit = 0;
    const vfStart = this.vf;
    for (let k = 0; k < n; k++) this._sub(track, input, h);
    this.accelNow += ((this.vf - vfStart) / dt - this.accelNow) * Math.min(1, dt * 8);
  }

  _sub(track, input, h) {
    const def = this.def;
    const q = track.query(this.x, this.z, this.lastIdx);
    const ad = Math.abs(q.d);
    this.onKerb = ad > ROAD_HALF && ad <= ROAD_HALF + KERB_W;
    this.onGrass = ad > ROAD_HALF + KERB_W;
    const surfGrip = this.onGrass ? 0.5 : 1;
    this.t += h;
    if (this.slowT > 0) this.slowT -= h;
    const vmax = def.maxSpeed * (this.onGrass ? 0.55 : 1) * (this.nitro ? 1.32 : 1) * (this.slowT > 0 ? 0.62 : 1);

    // sterowanie — płynne wychylanie kierownicy
    const target = input.steer;
    const rate = target === 0 || Math.sign(target) !== Math.sign(this.steer) ? 11 : 6.5;
    this.steer += clamp(target - this.steer, -rate * h, rate * h);

    let c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    let vf = this.vx * c + this.vz * s;
    let vl = -this.vx * s + this.vz * c;

    // obrót auta: zależny od prędkości (mało przy postoju, spada przy bardzo dużej)
    const sp = Math.abs(vf);
    const lowSpeed = clamp(sp / 9, 0, 1);
    const highDamp = 1 / (1 + (sp / (def.maxSpeed * 1.25)) ** 2 * 1.8);
    let yawRate = this.steer * def.turn * lowSpeed * highDamp * (vf >= 0 ? 1 : -1);
    if (input.hand) yawRate *= 1.25;
    if (this.inOil) yawRate = yawRate * 0.55 + Math.sin(this.t * 9 + this.x * 0.3) * 1.5 * lowSpeed;
    // samoograniczający się drift: im większy kąt poślizgu, tym mniej skręt go dalej powiększa
    const slipAng = Math.atan2(vl, Math.max(2, Math.abs(vf)));
    if (this.steer * vl < 0) {
      const t = clamp((Math.abs(slipAng) - 0.7) / 0.7, 0, 1);
      yawRate *= 1 - 0.8 * t * t * (3 - 2 * t);
    }
    this.yaw += yawRate * h;
    c = Math.cos(this.yaw); s = Math.sin(this.yaw);
    vf = this.vx * c + this.vz * s;
    vl = -this.vx * s + this.vz * c;

    // napęd / hamowanie
    const thr = Math.max(input.throttle, this.nitro && !input.brake ? 1 : 0);
    this.throttle = thr;
    this.brakeLit = false;
    if (thr > 0) {
      if (vf < -0.5) { vf += def.brake * h; this.brakeLit = true; }
      else vf += def.accel * (this.nitro ? 2.4 : 1) * thr * Math.max(0, 1 - (Math.max(0, vf) / vmax) ** 2) * h * (this.onGrass ? 0.7 : 1);
    }
    if (input.brake > 0) {
      if (vf > 0.4) { vf = Math.max(0, vf - def.brake * h); this.brakeLit = true; }
      else vf = Math.max(-def.maxSpeed * 0.3, vf - def.accel * 0.55 * h);
    }
    // opory
    const drag = this.onGrass ? 0.85 : 0.025;
    vf -= vf * drag * h;
    if (Math.abs(vf) > 0.05) vf -= Math.sign(vf) * (this.onGrass ? 3.2 : 0.5) * h; else vf = 0;
    if (vf > vmax) vf -= (vf - vmax) * Math.min(1, 3 * h);
    if (input.hand) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 2.2 * h * (1 + Math.abs(vl) * 0.1));
    if (this.onKerb) vf -= vf * 0.25 * h;

    // przyczepność boczna — spada przy dużym poślizgu (utrzymuje drift) i hamulcu ręcznym
    let grip = def.grip * surfGrip;
    grip *= 1 - 0.4 * clamp((Math.abs(vl) - 6) / 10, 0, 1);
    if (input.hand) grip = Math.min(grip, 2.4);
    if (this.inOil) grip = Math.min(grip, 0.7);
    const speedBefore = Math.hypot(vf, vl);
    vl -= vl * (1 - Math.exp(-grip * h));
    // przekierowanie pędu: boczny poślizg zamienia się w ruch do przodu zamiast po prostu znikać
    const keep = this.onGrass ? 0.5 : input.hand ? 0.7 : 0.9;
    const vfTarget = Math.sign(vf || 1) * Math.sqrt(Math.max(0, speedBefore * speedBefore - vl * vl));
    vf += (vfTarget - vf) * keep;

    this.vf = vf; this.vl = vl;
    this.slip += (Math.abs(vl) - this.slip) * Math.min(1, 14 * h);
    this.vx = vf * c - vl * s;
    this.vz = vf * s + vl * c;
    this.x += this.vx * h;
    this.z += this.vz * h;

    // bariery po obu stronach toru
    const q2 = track.query(this.x, this.z, q.idx);
    this.d = q2.d;
    const lim = BARRIER - 1.25;
    this.wallContact = false;
    if (Math.abs(q2.d) > lim) {
      const side = Math.sign(q2.d);
      const over = Math.abs(q2.d) - lim;
      this.x -= q2.nx * side * over; this.z -= q2.nz * side * over;
      const vn = (this.vx * q2.nx + this.vz * q2.nz) * side; // składowa na zewnątrz
      if (vn > 0) {
        const e = 0.22;
        this.vx -= (1 + e) * vn * q2.nx * side;
        this.vz -= (1 + e) * vn * q2.nz * side;
        // tarcie o bandę i wyrównanie do kierunku toru
        const fr = 1 - 1.4 * h; this.vx *= fr; this.vz *= fr;
        this.hit = Math.max(this.hit, vn);
      }
      this.wallContact = true;
      let aim = q2.psi;
      const car = wrap(this.yaw - aim);
      if (Math.abs(car) > Math.PI / 2) aim += Math.PI;
      this.yaw += wrap(aim - this.yaw) * Math.min(1, 5 * h);
    }

    // postęp wzdłuż toru (rozwinięty, odporny na przekraczanie linii w obie strony)
    let di = q2.idx - this.lastIdx;
    if (di < -track.N / 2) di += track.N; else if (di > track.N / 2) di -= track.N;
    this.progress += di;
    this.lastIdx = q2.idx;
    this.idx = q2.idx;
  }
}

/** Kolizja dwóch aut modelowanych jako dwa okręgi. Zmienia tylko `me` (przeciwnik robi to samo u siebie). */
export function carVsCar(me, opp) {
  const R = 1.35, off = 1.45;
  const pts = (c) => {
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    return [[c.x + cs * off, c.z + sn * off], [c.x - cs * off, c.z - sn * off]];
  };
  const a = pts(me), b = pts(opp);
  let hit = 0;
  for (const [ax, az] of a) {
    for (const [bx, bz] of b) {
      let dx = ax - bx, dz = az - bz;
      const dist = Math.hypot(dx, dz);
      if (dist < 2 * R && dist > 1e-4) {
        dx /= dist; dz /= dist;
        const pen = 2 * R - dist;
        me.x += dx * pen * 0.6; me.z += dz * pen * 0.6;
        const rel = (me.vx - opp.vx) * dx + (me.vz - opp.vz) * dz;
        if (rel < 0) {
          const j = -(1 + 0.35) * rel * 0.5;
          me.vx += dx * j; me.vz += dz * j;
          hit = Math.max(hit, -rel);
        }
      }
    }
  }
  return hit;
}
