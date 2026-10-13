// Fizyka auta na torze 3D (styl TrackMania): jazda po powierzchni w współrzędnych toru (s, d), lot balistyczny po skoku,
// grawitacja na zboczach i pętlach, ściany po bokach, zderzenia aut.
import * as THREE from 'three';
import { HW } from './track3d.js';

const G = 24, GSLOPE = 0.6;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** jedno auto: bolid Formuły 1 (zmienia się tylko kolor i personalizacja) */
export const CAR_DEFS = {
  formula: { name: 'Bolid F1', tag: 'Lekki bolid: ogromna prędkość, szybkie skręty', color: '#e0457b', stripe: '#fff4e6',
    maxSpeed: 68, accel: 40, brake: 66, grip: 10.5, turn: 3.3, stats: [1.0, 0.85, 0.85] },
};
export const CAR_COLORS = ['#e53935', '#ff7a1a', '#ffc21a', '#2fbf71', '#19b6c9', '#3b6cff', '#8a5cf0', '#e0457b', '#f2f2f5', '#2b2b33'];
export function stripeFor(hex) {
  const c = hex.replace('#', ''), r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#14141c' : '#fff4e6';
}

const _m = new THREE.Matrix4(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

export class CarState {
  constructor(def) {
    this.def = def;
    // pozycja na torze
    this.s = 0; this.d = 0; this.phi = 0; this.vf = 0; this.vl = 0;
    // świat
    this.x = 0; this.y = 0; this.z = 0; this.yaw = 0; this.vx = 0; this.vy = 0; this.vz = 0;
    this.quat = new THREE.Quaternion();
    this.fx = 1; this.fy = 0; this.fz = 0; // wektor „do przodu” auta w świecie
    this.steer = 0; this.slip = 0; this.onGrass = false; this.onKerb = false;
    this.progress = 0; this.idx = 0; this.lastIdx = 0;
    this.brakeLit = false; this.throttle = 0; this.accelNow = 0; this.hit = 0; this.wallContact = false;
    this.air = false; this.landHit = 0; this.fell = false; this.airT = 0;
    this.damage = 0; this.pull = 1; this.hp = 100; this.hand = false; this.nitro = false; this.slowT = 0; this.inOil = false; this.t = 0; this.surf = null;
    this.tiltX = 0; this.tiltZ = 0; this.spin = 0;
    this._f = {}; this._P = new THREE.Vector3(); this._V = new THREE.Vector3();
  }
  get speed() { return this.air ? this._V.length() : Math.hypot(this.vf, this.vl); }

  /** ustaw auto na torze: s, d (poprzeczne), kurs wzdłuż toru */
  place(track, s, d = 0) {
    this.s = s; this.d = d; this.phi = 0; this.vf = this.vl = 0; this.steer = 0; this.air = false; this.fell = false;
    this.progress = s; this.idx = s; this.slip = 0; this.landHit = 0;
    this._pose(track);
  }

  step(track, input, dt) {
    const n = Math.max(1, Math.ceil(dt / 0.01)), h = dt / n;
    this.hit = 0; this.landHit = 0;
    const vfStart = this.vf;
    for (let k = 0; k < n; k++) { if (this.air) this._air(track, h); else this._surf(track, input, h); }
    this.accelNow += ((this.vf - vfStart) / dt - this.accelNow) * Math.min(1, dt * 8);
    this.progress = this.s; this.idx = this.s;
    this._pose(track);
  }

  _surf(track, input, h) {
    const def = this.def, f = track.at(this.s, this._f);
    if (!f.surf) { this._detach(track, f); return; }
    this.t += h;
    if (this.slowT > 0) this.slowT -= h;
    const vmax = def.maxSpeed * (this.nitro ? 1.3 : 1) * (this.slowT > 0 ? 0.62 : 1) * (1 - 0.3 * this.damage);

    // kierownica
    const target = input.steer;
    const rate = target === 0 || Math.sign(target) !== Math.sign(this.steer) ? 11 : 6.5;
    this.steer += clamp(target - this.steer, -rate * h, rate * h);

    let c = Math.cos(this.phi), sn = Math.sin(this.phi);
    let vf = this.vf, vl = this.vl;
    const sp = Math.abs(vf), lowSpeed = clamp(sp / 9, 0, 1);
    const highDamp = 1 / (1 + (sp / (def.maxSpeed * 1.25)) ** 2 * 1.8);
    let yawRate = this.steer * def.turn * lowSpeed * highDamp * (vf >= 0 ? 1 : -1);
    this.hand = !!input.hand && Math.abs(vf) > 3;
    yawRate += this.pull * this.damage * 0.3 * lowSpeed;
    if (input.hand) yawRate *= 1.45;
    const slipAng = Math.atan2(vl, Math.max(2, Math.abs(vf)));
    if (this.steer * vl < 0) { const t = clamp((Math.abs(slipAng) - 0.7) / 0.7, 0, 1); yawRate *= 1 - 0.8 * t * t * (3 - 2 * t); }
    this.phi += yawRate * h;
    c = Math.cos(this.phi); sn = Math.sin(this.phi);

    // napęd i hamowanie
    const thr = Math.max(input.throttle, this.nitro && !input.brake ? 1 : 0);
    this.throttle = thr; this.brakeLit = false;
    if (thr > 0) {
      if (vf < -0.5) { vf += def.brake * h; this.brakeLit = true; }
      else vf += def.accel * (1 - 0.35 * this.damage) * (this.nitro ? 2.8 : 1) * thr * Math.max(0, 1 - (Math.max(0, vf) / vmax) ** 2) * h;
    }
    if (input.hand && vf > 3) this.brakeLit = true;
    if (input.brake > 0) {
      if (vf > 0.4) { vf = Math.max(0, vf - def.brake * h); this.brakeLit = true; }
      else vf = Math.max(-def.maxSpeed * 0.3, vf - def.accel * 0.55 * h);
    }
    // opory
    vf -= vf * 0.025 * h;
    if (Math.abs(vf) > 0.05) vf -= Math.sign(vf) * 0.5 * h; else vf = 0;
    if (vf > vmax) vf -= (vf - vmax) * Math.min(1, 3 * h);
    if (input.hand) vf -= Math.sign(vf) * Math.min(Math.abs(vf), (8 + Math.abs(vl) * 0.12) * h);

    // grawitacja wzdłuż powierzchni (zjazdy przyspieszają, podjazdy hamują; przechył zsuwa w dół)
    const hy = c * f.ty + sn * f.ry, zy = c * f.ry - sn * f.ty;
    vf -= G * GSLOPE * hy * h;
    vl -= G * GSLOPE * zy * h;

    // przyczepność boczna
    let grip = def.grip * (track.gripMul ?? 1);
    grip *= 1 - 0.4 * clamp((Math.abs(vl) - 6) / 10, 0, 1);
    if (input.hand) grip = Math.min(grip, 2.4);
    const speedBefore = Math.hypot(vf, vl);
    vl -= vl * (1 - Math.exp(-grip * h));
    const keep = input.hand ? 0.7 : 0.9;
    const vfTarget = Math.sign(vf || 1) * Math.sqrt(Math.max(0, speedBefore * speedBefore - vl * vl));
    vf += (vfTarget - vf) * keep;
    this.vf = vf; this.vl = vl;
    this.slip += (Math.abs(vl) - this.slip) * Math.min(1, 14 * h);

    // ruch w układzie toru
    let vt = vf * c - vl * sn, vr = vf * sn + vl * c;
    const ds = vt * h / Math.max(0.35, 1 - f.kg * this.d);
    this.s += ds; this.d += vr * h; this.phi -= f.kg * ds;
    const L = track.length - 1;
    if (this.s > L) { this.s = L; this.vf *= 0.5; }
    if (this.s < 0) { this.s = 0; this.vf *= 0.5; }

    // ściany po bokach (tam, gdzie są) albo zejście z jezdni
    const f2 = track.at(this.s, this._f);
    this.wallContact = false;
    if (f2.wall) {
      const lim = HW - 1.0;
      if (Math.abs(this.d) > lim) {
        const side = Math.sign(this.d); this.d = side * lim;
        vt = this.vf * Math.cos(this.phi) - this.vl * Math.sin(this.phi); vr = this.vf * Math.sin(this.phi) + this.vl * Math.cos(this.phi);
        const out = vr * side;
        if (out > 0) {
          vr -= (1 + 0.22) * out * side; vt *= 1 - 1.4 * h * 2; this.hit = Math.max(this.hit, out);
          const c2 = Math.cos(this.phi), s2 = Math.sin(this.phi);
          this.vf = vt * c2 + vr * s2; this.vl = -vt * s2 + vr * c2;
        }
        this.wallContact = true;
        this.phi += wrap(0 - this.phi) * Math.min(1, 5 * h); // kierowanie wzdłuż ściany
      }
    } else if (Math.abs(this.d) > HW + 0.4) { this._detach(track, f2); return; }
    // oderwanie od powierzchni (kulminacja wzgórza, rampa) — warunek siły nacisku
    const sp2 = Math.hypot(this.vf, this.vl);
    if (sp2 > 9 && sp2 * sp2 * f2.ku + G * f2.uy < -1.5) this._detach(track, f2);
  }

  _detach(track, f) {
    const c = Math.cos(this.phi), sn = Math.sin(this.phi);
    const vt = this.vf * c - this.vl * sn, vr = this.vf * sn + this.vl * c;
    this._V.set(vt * f.tx + vr * f.rx, vt * f.ty + vr * f.ry, vt * f.tz + vr * f.rz);
    this._P.set(f.px + f.rx * this.d, f.py + f.ry * this.d, f.pz + f.rz * this.d);
    this.air = true; this.airT = 0; this.fell = false;
  }

  _air(track, h) {
    const V = this._V, P = this._P;
    this.airT += h;
    V.y -= G * h; V.multiplyScalar(1 - 0.01 * h);
    P.addScaledVector(V, h);
    this._orientAir(h);
    // lądowanie: najbliższy punkt toru
    const nr = track.nearest(P.x, P.y, P.z, this.s, 25, 160);
    const f = track.at(nr.s, this._f);
    const vn = V.x * f.ux + V.y * f.uy + V.z * f.uz;
    if (this.airT > 0.12 && nr.surf && Math.abs(nr.d) < HW + 0.6 && nr.h <= 0.2 && nr.h > -3.5 && vn < -0.5) {
      // dotyk: wyznacz kurs względem toru z orientacji auta
      _v1.set(1, 0, 0).applyQuaternion(this.quat);
      const fT = _v1.x * f.tx + _v1.y * f.ty + _v1.z * f.tz, fR = _v1.x * f.rx + _v1.y * f.ry + _v1.z * f.rz;
      this.phi = Math.atan2(fR, fT);
      const c = Math.cos(this.phi), sn = Math.sin(this.phi);
      const vt = V.x * f.tx + V.y * f.ty + V.z * f.tz, vr = V.x * f.rx + V.y * f.ry + V.z * f.rz;
      this.vf = vt * c + vr * sn; this.vl = -vt * sn + vr * c;
      this.s = nr.s; this.d = clamp(nr.d, -HW, HW); this.air = false;
      this.landHit = Math.max(0, -vn - 7) * 1.1;
      this.hit = Math.max(this.hit, Math.max(0, -vn - 5));
      return;
    }
    if (nr.dist > 70 || P.y < track.bounds.minY - 40) { this.fell = true; this.air = false; this.vf = this.vl = 0; this._P.set(P.x, P.y, P.z); }
  }

  /** orientacja w locie: nos w stronę lotu, „dół” ku ziemi (wolna samoprostująca) */
  _orientAir(h) {
    const V = this._V; if (V.length() <= 4) return;
    _v1.copy(V).normalize(); _v2.set(0, 1, 0).addScaledVector(_v1, -_v1.y).normalize();
    if (_v2.lengthSq() < 0.01) _v2.set(0, 1, 0);
    _v3.crossVectors(_v1, _v2);
    _m.makeBasis(_v1, _v2, _v3); _q2.setFromRotationMatrix(_m);
    this.quat.slerp(_q2, Math.min(1, 2.2 * h));
  }
  /** zdalny gracz w locie: pozycja i prędkość z pakietu sieciowego */
  remoteAir(track, x, y, z, vx, vy, vz, s, dt) {
    this.air = true; this.fell = false; this._P.set(x, y, z); this._V.set(vx, vy, vz); this.s = s; this.progress = s;
    this._orientAir(Math.max(dt, 0.016) * 3); this._pose(track);
  }
  /** wzór pozycji i orientacji w świecie (dla modelu 3D, kamery, sieci) */
  _pose(track) {
    if (this.air && !this.fell) {
      const P = this._P, V = this._V;
      this.x = P.x; this.y = P.y; this.z = P.z; this.vx = V.x; this.vy = V.y; this.vz = V.z;
      _v1.set(1, 0, 0).applyQuaternion(this.quat); this.fx = _v1.x; this.fy = _v1.y; this.fz = _v1.z;
      this.yaw = Math.atan2(_v1.z, _v1.x); return;
    }
    if (this.fell) return;
    const f = track.at(this.s, this._f), c = Math.cos(this.phi), sn = Math.sin(this.phi);
    const hx = c * f.tx + sn * f.rx, hy = c * f.ty + sn * f.ry, hz = c * f.tz + sn * f.rz;
    const zx = hy * f.uz - hz * f.uy, zy = hz * f.ux - hx * f.uz, zz = hx * f.uy - hy * f.ux; // H × U = prawa strona auta
    _v1.set(hx, hy, hz); _v2.set(f.ux, f.uy, f.uz); _v3.set(zx, zy, zz);
    _m.makeBasis(_v1, _v2, _v3); this.quat.setFromRotationMatrix(_m);
    this.x = f.px + f.rx * this.d; this.y = f.py + f.ry * this.d; this.z = f.pz + f.rz * this.d;
    const vt = this.vf * c - this.vl * sn, vr = this.vf * sn + this.vl * c;
    this.vx = vt * f.tx + vr * f.rx; this.vy = vt * f.ty + vr * f.ry; this.vz = vt * f.tz + vr * f.rz;
    this.fx = hx; this.fy = hy; this.fz = hz; this.yaw = Math.atan2(hz, hx);
    this.tiltX = 0; this.tiltZ = 0;
  }

  /** po upadku: wróć na checkpoint (s) z zerową prędkością */
  respawnAt(track, s) {
    this.air = false; this.fell = false; this.s = s; this.d = 0; this.phi = 0; this.vf = this.vl = 0; this.steer = 0; this.nitro = false;
    this.progress = s; this.idx = s; this._pose(track);
  }
}

/** kolizja dwóch aut (dwa okręgi po 1,35 m w 3D); zmienia tylko `me` w torze (s, d, prędkości) */
export function carVsCar(me, opp, track) {
  if (me.air || opp.air) return 0;
  const R = 1.35, off = 1.45;
  const dx0 = opp.x - me.x, dy0 = opp.y - me.y, dz0 = opp.z - me.z;
  if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > 42) return 0;
  const f = track.at(me.s, me._f);
  let hit = 0;
  for (const sa of [off, -off]) for (const sb of [off, -off]) {
    const ax = me.x + me.fx * sa, ay = me.y + me.fy * sa, az = me.z + me.fz * sa;
    const bx = opp.x + opp.fx * sb, by = opp.y + opp.fy * sb, bz = opp.z + opp.fz * sb;
    let dx = ax - bx, dy = ay - by, dz = az - bz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 2 * R && dist > 1e-4) {
      dx /= dist; dy /= dist; dz /= dist;
      const pen = 2 * R - dist;
      const pt = pen * 0.6 * (dx * f.tx + dy * f.ty + dz * f.tz), pr = pen * 0.6 * (dx * f.rx + dy * f.ry + dz * f.rz);
      me.s += pt; me.d = clamp(me.d + pr, -HW + 1, HW - 1);
      const rel = (me.vx - opp.vx) * dx + (me.vy - opp.vy) * dy + (me.vz - opp.vz) * dz;
      if (rel < 0) {
        const j = -(1 + 0.35) * rel * 0.5;
        const dvt = j * (dx * f.tx + dy * f.ty + dz * f.tz), dvr = j * (dx * f.rx + dy * f.ry + dz * f.rz);
        const c = Math.cos(me.phi), sn = Math.sin(me.phi);
        me.vf += dvt * c + dvr * sn; me.vl += -dvt * sn + dvr * c;
        hit = Math.max(hit, -rel);
      }
    }
  }
  return hit;
}

/** sterowanie bota: jedzie środkiem/wybranym pasem, hamuje przed ostrymi łukami, trzyma prędkość w pętlach */
export function botInput(st, track, bot, dt) {
  const def = st.def, s = st.s, f = {};
  let latT = bot.lat ?? 0;
  for (const p of track.pads || []) { const ahead = p.s0 - s; if (ahead > -p.len && ahead < 70) latT = p.lat; }
  const la = 7 + st.speed * 0.3;
  const ang = Math.atan2(latT - st.d, la);
  const steerCmd = clamp(wrap(clamp(ang, -0.55, 0.55) - st.phi) * 2.8, -1, 1);
  let kmax = 0, loopMin = 0, ramp = false;
  for (let j = 0; j < 80; j += 5) {
    track.at(s + j, f);
    kmax = Math.max(kmax, Math.abs(f.kg));
    if (f.ku > 0.02 && f.uy < 0.9) loopMin = Math.max(loopMin, Math.sqrt(G / f.ku) * 1.35);
    if (!f.surf) ramp = true;
  }
  const vlim = Math.min(def.maxSpeed * (bot.skill ?? 0.93) * (st.nitro ? 1.3 : 1), Math.sqrt(58 / Math.max(kmax, 0.003)));
  const target = Math.max(vlim, loopMin);
  // przed skokiem: jedź prosto środkiem (w locie nie da się już sterować)
  let gapAhead = 1e9; for (let j = 0; j < 100; j += 4) { track.at(s + j, f); if (!f.surf) { gapAhead = j; break; } }
  let steerFinal = steerCmd;
  if (gapAhead < 100) steerFinal = clamp(-st.phi * 4 - st.d * 0.09, -1, 1);
  const inp = { throttle: st.speed < target ? 1 : 0, brake: st.speed > target * 1.12 && !loopMin ? 1 : 0, steer: steerFinal, hand: false };
  if (ramp) { inp.throttle = 1; inp.brake = 0; }
  if (st.air) { inp.throttle = 1; inp.brake = 0; inp.steer = 0; }
  const ai = bot.ai || (bot.ai = { stuck: 0, rev: 0, revSteer: 1 });
  if (st.speed < 2.5 && !st.air) ai.stuck += dt; else ai.stuck = 0;
  if (ai.stuck > 1.3) { ai.rev = 0.9; ai.stuck = 0; ai.revSteer = Math.random() < 0.5 ? -1 : 1; }
  if (ai.rev > 0) { ai.rev -= dt; inp.throttle = 0; inp.brake = 1; inp.steer = ai.revSteer; }
  return inp;
}
