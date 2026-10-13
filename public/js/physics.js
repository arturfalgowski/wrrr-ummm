// Arkadowa fizyka auta: przyspieszanie, hamowanie, drift (poślizg boczny), bariery i zderzenia aut.
import { ROAD_HALF, KERB_W, BARRIER } from './track.js';

export const CAR_DEFS = {
  aurora: { name: 'Pantera', tag: 'Uniwersalny roadster', color: '#e0457b', stripe: '#fff4e6',
    maxSpeed: 44, accel: 22, brake: 46, grip: 7.6, turn: 2.35, stats: [0.62, 0.62, 0.72] },
  vortex: { name: 'Tornado', tag: 'Szybkie GT, trudne w ślizgu', color: '#19b6c9', stripe: '#0c2a44',
    maxSpeed: 50, accel: 19, brake: 44, grip: 6.4, turn: 2.05, stats: [0.9, 0.5, 0.52] },
  blaze: { name: 'Szerszeń', tag: 'Zwinny i dynamiczny', color: '#ff7a1a', stripe: '#1a1a24',
    maxSpeed: 41, accel: 27, brake: 48, grip: 9.0, turn: 2.7, stats: [0.42, 0.88, 0.9] },
  tytan: { name: 'Tytan', tag: 'Terenowy pickup: ciężki, stabilny, trudno go wytrącić', color: '#2fbf71', stripe: '#f2f2f5',
    maxSpeed: 38, accel: 21, brake: 42, grip: 9.6, turn: 2.15, stats: [0.3, 0.55, 0.72] },
  kometa: { name: 'Kometa', tag: 'Bolid: rakieta na prostej, wymaga wprawy', color: '#8a5cf0', stripe: '#ffd84d',
    maxSpeed: 54, accel: 25, brake: 50, grip: 5.4, turn: 2.2, stats: [1.0, 0.75, 0.38] },
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
    this.y = undefined; this.vy = 0; this.vyT = 0; this.air = false; this.landHit = 0;
    this.damage = 0; this.pull = 1; this.hp = 100; this.spin = 0; this._oilPrev = false; this.surf = null; this.hand = false; this.nitro = false; this.slowT = 0; this.inOil = false; this.t = 0;
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
    if (this.air) { // lot po hopce/moście: bez trakcji, tylko balistyka poziomu
      this.x += this.vx * h; this.z += this.vz * h;
      this.vf = this.vx * Math.cos(this.yaw) + this.vz * Math.sin(this.yaw); this.vl = -this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
      this._walls(track, q, h);
      return;
    }
    const ad = Math.abs(q.d);
    this.onKerb = ad > ROAD_HALF && ad <= ROAD_HALF + KERB_W;
    this.onGrass = ad > ROAD_HALF + KERB_W;
    const surf = !this.onGrass && track.surfaceAt ? track.surfaceAt(q.idx, q.d) : null;
    this.surf = surf;
    const surfGrip = (this.onGrass ? 0.5 : 1) * (surf === 'ice' ? 0.2 : surf === 'water' ? 0.5 : 1) * (!this.onGrass ? (track.gripMul ?? 1) : 1);
    this.t += h;
    if (this.slowT > 0) this.slowT -= h;
    const vmax = def.maxSpeed * (this.onGrass ? 0.55 : 1) * (this.nitro ? 1.32 : 1) * (this.slowT > 0 ? 0.62 : 1) * (1 - 0.3 * this.damage);

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
    this.hand = !!input.hand && Math.abs(this.vf) > 3;
    yawRate += this.pull * this.damage * 0.3 * lowSpeed; // uszkodzone auto ściąga na bok
    if (input.hand) yawRate *= 1.45;
    if (this.inOil) {
      if (!this._oilPrev) { this.spin = (Math.random() < 0.5 ? -1 : 1) * (2.2 + Math.random() * 1.2); this.vl += Math.sign(this.spin) * 5 * lowSpeed; } // wybicie z toru przy wjeździe w plamę
      yawRate = yawRate * 0.25 + Math.sin(this.t * 7 + this.x * 0.3) * 2.6 * lowSpeed + this.spin;
    }
    this._oilPrev = this.inOil; this.spin *= Math.exp(-1.1 * h);
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
      else vf += def.accel * (1 - 0.35 * this.damage) * (this.nitro ? 2.4 : 1) * thr * Math.max(0, 1 - (Math.max(0, vf) / vmax) ** 2) * h * (this.onGrass ? 0.7 : 1);
    }
    if (input.hand && vf > 3) this.brakeLit = true;
    if (input.brake > 0) {
      if (vf > 0.4) { vf = Math.max(0, vf - def.brake * h); this.brakeLit = true; }
      else vf = Math.max(-def.maxSpeed * 0.3, vf - def.accel * 0.55 * h);
    }
    // opory
    const drag = this.onGrass ? 0.85 : 0.025;
    vf -= vf * drag * h;
    if (Math.abs(vf) > 0.05) vf -= Math.sign(vf) * (this.onGrass ? 3.2 : 0.5) * h; else vf = 0;
    if (vf > vmax) vf -= (vf - vmax) * Math.min(1, 3 * h);
    if (input.hand) vf -= Math.sign(vf) * Math.min(Math.abs(vf), (8 + Math.abs(vl) * 0.12) * h);
    if (this.onKerb) vf -= vf * 0.25 * h;

    // przyczepność boczna — spada przy dużym poślizgu (utrzymuje drift) i hamulcu ręcznym
    let grip = def.grip * surfGrip;
    grip *= 1 - 0.4 * clamp((Math.abs(vl) - 6) / 10, 0, 1);
    if (input.hand) grip = Math.min(grip, 2.4);
    if (this.inOil) grip = Math.min(grip, 0.22);
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

    this._walls(track, q, h);
  }

  /** bariery po obu stronach toru + postęp wzdłuż toru */
  _walls(track, q, h) {
    const q2 = track.query(this.x, this.z, q.idx);
    this.d = q2.d;
    const lim = (track.barrierAt ? track.barrierAt(q2.idx) : BARRIER) - 1.25;
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

/** Wysokość jezdni (mosty, łuki, hopki): jazda po profilu drogi, skoki z uskoków, lądowanie. */
export function trackHeightStep(car, track, dt) {
  if (!track.hy) return;
  const idx = car.idx, lim = track.barrierAt(idx);
  const hn = Math.abs(car.d) <= (lim < 12 ? lim : ROAD_HALF + KERB_W + 0.4) ? track.heightAt(idx) : 0;
  if (car.y === undefined) { car.y = hn; car.vy = 0; car.vyT = 0; car.air = false; }
  car.landHit = 0;
  if (car.air) {
    car.vy -= 30 * dt; car.y += car.vy * dt;
    if (car.y <= hn) {
      const imp = -(car.vy - track.slopeAt(idx) * car.vf);
      car.y = hn; car.air = false; car.vyT = 0; car.vy = 0;
      if (imp > 18) car.landHit = Math.min(25, (imp - 18) * 1.2);
    }
    return;
  }
  const sl = track.slopeAt(idx);
  if (Math.abs(sl) > 0.004) { // grawitacja na pochyłości (podjazd zwalnia, zjazd przyspiesza)
    const i = ((Math.floor(idx) % track.N) + track.N) % track.N;
    car.vx -= track.tx[i] * sl * 16 * dt; car.vz -= track.tz[i] * sl * 16 * dt;
  }
  const ballistic = car.y + car.vyT * dt - 0.5 * 30 * dt * dt;
  if (car.vyT > 2.5 && ballistic > hn + 0.12) { car.air = true; car.vy = Math.min(car.vyT, 12); car.y = Math.max(ballistic, hn); }
  else { car.vyT = clamp((hn - car.y) / dt * 0.6 + car.vyT * 0.4, -15, 15); car.y = hn; }
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

/** Paleta kolorów aut — musi być zgodna z listą w server.js. */
export const CAR_COLORS = ['#e53935', '#ff7a1a', '#ffc21a', '#2fbf71', '#19b6c9', '#3b6cff', '#8a5cf0', '#e0457b', '#f2f2f5', '#2b2b33'];
/** Kolor pasów dobrany do jasności lakieru. */
export function stripeFor(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#1a1a24' : '#fff4e6';
}
