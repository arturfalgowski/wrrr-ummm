// Tor jako zamknięta pętla 3D (okrążenia): trasa z krzywej, delikatne wzniesienia, przechylone zakręty, bandy po obu stronach.
// Fizyka jazdy liczy się w współrzędnych toru (s — postęp wzdłuż trasy, d — odległość od osi, dodatnia po prawej).
import * as THREE from 'three';

export const HW = 8;        // połowa szerokości jezdni
export const DS = 1;        // odstęp próbek [m]
const wrapAng = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const smoothArr = (a, w) => { const n = a.length, o = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = -w; j <= w; j++) s += a[(i + j + n) % n]; o[i] = s / (2 * w + 1); } return o; };

export class Track3D {
  constructor(def) {
    this.def = def; this.id = def.id; this.closed = true;
    const SC = def.scale ?? 1;
    const curve = new THREE.CatmullRomCurve3(def.points.map(([x, z]) => new THREE.Vector3(x * SC, 0, z * SC)), true, 'centripetal');
    curve.arcLengthDivisions = 6000;
    const L0 = curve.getLength(), n = Math.round(L0 / DS);
    const raw = curve.getSpacedPoints(n).slice(0, n);
    // krzywizna w planie → wybór miejsca startu na najdłuższej prostej
    const psi = raw.map((p, i) => { const a = raw[(i + n - 1) % n], b = raw[(i + 1) % n]; return Math.atan2(b.z - a.z, b.x - a.x); });
    const k0 = new Float32Array(n); for (let i = 0; i < n; i++) k0[i] = wrapAng(psi[(i + 3) % n] - psi[(i - 3 + n) % n]) / (6 * DS);
    let start = 0, best = -1;
    for (let i = 0; i < n; i += 4) { let run = 0; for (let k = -40; k <= 160; k += 8) if (Math.abs(k0[(i + k + n) % n]) < 0.004) run++; if (run > best) { best = run; start = i; } }
    const P = (i) => raw[(i + start) % n];
    // wzniesienia: okresowe, więc tor zamyka się płynnie
    const hills = def.hills ?? [[0, 1, 0]];
    const yAt = (i) => { let y = def.y0 ?? 0; for (const [A, k, ph] of hills) y += A * Math.sin((2 * Math.PI * k * i) / n + ph); return y; };
    const N = n + 1;
    const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
    for (let i = 0; i < N; i++) { const p = P(i % n); px[i] = p.x; py[i] = yAt(i % n); pz[i] = p.z; }
    const tx = new Float32Array(N), ty = new Float32Array(N), tz = new Float32Array(N);
    for (let i = 0; i < N; i++) { const a = (i + n - 1) % n, b = (i + 1) % n; let dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a]; if (i === 0 || i === n) { dx = px[1] - px[n - 1]; dy = py[1] - py[n - 1]; dz = pz[1] - pz[n - 1]; } const l = Math.hypot(dx, dy, dz) || 1; tx[i] = dx / l; ty[i] = dy / l; tz[i] = dz / l; }
    // krzywizna pozioma (+ w prawo) i przechył
    const psi2 = new Float32Array(N); for (let i = 0; i < N; i++) psi2[i] = Math.atan2(tz[i], tx[i]);
    const kp = new Float32Array(n); for (let i = 0; i < n; i++) kp[i] = wrapAng(psi2[(i + 6) % n] - psi2[(i - 6 + n) % n]) / (12 * DS);
    const kps = smoothArr(kp, 10);
    const maxBank = (def.maxBank ?? 15) * Math.PI / 180, bankGain = def.bankGain ?? 9;
    const bank = new Float32Array(N); for (let i = 0; i < N; i++) bank[i] = Math.max(-maxBank, Math.min(maxBank, kps[i % n] * bankGain));
    const ux = new Float32Array(N), uy = new Float32Array(N), uz = new Float32Array(N), rx = new Float32Array(N), ry = new Float32Array(N), rz = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // prawa strona (bez przechyłu) = T × (0,1,0), normalna bazowa = R × T
      let bx = -tz[i], by = 0, bz = tx[i]; const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
      let nx = by * tz[i] - bz * ty[i], ny = bz * tx[i] - bx * tz[i], nz = bx * ty[i] - by * tx[i]; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const c = Math.cos(bank[i]), s = Math.sin(bank[i]);
      const Ux = nx * c + bx * s, Uy = ny * c + by * s, Uz = nz * c + bz * s;
      ux[i] = Ux; uy[i] = Uy; uz[i] = Uz;
      // R = T × U
      rx[i] = ty[i] * Uz - tz[i] * Uy; ry[i] = tz[i] * Ux - tx[i] * Uz; rz[i] = tx[i] * Uy - ty[i] * Ux;
    }
    Object.assign(this, { N, length: n * DS, px, py, pz, tx, ty, tz, ux, uy, uz, rx, ry, rz, bank, wall: new Uint8Array(N).fill(1), surf: new Uint8Array(N).fill(1) });
    this.x = px; this.z = pz; // zgodność z minimapą
    // krzywizny: kg — w poprzek jezdni (w prawo), ku — w stronę normalnej
    const kg = new Float32Array(N), ku = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i + n - 2) % n, b = (i + 2) % n, dd = 4 * DS;
      const dx = (tx[b] - tx[a]) / dd, dy = (ty[b] - ty[a]) / dd, dz = (tz[b] - tz[a]) / dd;
      kg[i] = dx * rx[i] + dy * ry[i] + dz * rz[i]; ku[i] = dx * ux[i] + dy * uy[i] + dz * uz[i];
    }
    this.kg = smoothArr(kg.subarray(0, n), 4).slice(); this.kg = Float32Array.from([...this.kg, this.kg[0]]);
    this.ku = ku;
    this.startS = 0; this.finishS = this.length;
    // pady nitro na prostych (pasy na przemian) i punkty powrotu (respawn)
    const straightAt = (i, half = 30, tol = 0.006) => { for (let k = -half; k <= half; k += 6) if (Math.abs(this.kg[((i + k) % n + n) % n]) > tol || Math.abs(this.ty[((i + k) % n + n) % n]) > 0.1) return false; return true; };
    this.pads = []; let lane = 1;
    for (let i = 90; i < n - 60; i += 12) { const last = this.pads[this.pads.length - 1]; if ((!last || i - last.s0 > 280) && straightAt(i + 12, 24)) { this.pads.push({ s0: i, len: 16, lane, lat: lane * 3.9 }); lane = -lane; } }
    this.checkpoints = [];
    for (let i = 60; i < n - 30; i += 8) { const last = this.checkpoints[this.checkpoints.length - 1]; if ((last == null || i - last > 220) && straightAt(i, 36, 0.008)) this.checkpoints.push(i); }
    const b = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9, minY: 1e9, maxY: -1e9 };
    for (let i = 0; i < n; i++) { b.minX = Math.min(b.minX, px[i]); b.maxX = Math.max(b.maxX, px[i]); b.minZ = Math.min(b.minZ, pz[i]); b.maxZ = Math.max(b.maxZ, pz[i]); b.minY = Math.min(b.minY, py[i]); b.maxY = Math.max(b.maxY, py[i]); }
    this.bounds = b;
    // strefy nawierzchni i obiektów: kostka, piasek, most, tunel (ułamki długości okrążenia)
    const zone = new Uint8Array(N), bridge = new Float32Array(N), tunnel = new Float32Array(N), grip = new Float32Array(N).fill(1);
    this.bridges = []; this.tunnels = [];
    const GRIP = { cobble: 0.9, sand: 0.8 };
    for (const z of def.zones || []) {
      const i0 = Math.round(z.a * n), i1 = Math.round(z.b * n);
      if (z.type === 'cobble' || z.type === 'sand') for (let i = i0; i <= i1; i++) { zone[i] = z.type === 'cobble' ? 1 : 2; grip[i] = GRIP[z.type]; }
      else if (z.type === 'bridge') { this.bridges.push({ i0, i1 }); for (let i = i0; i <= i1; i++) bridge[i] = 1; }
      else if (z.type === 'tunnel') { this.tunnels.push({ i0, i1 }); for (let i = i0 - 7; i <= i1 + 7; i++) tunnel[i] = Math.min(1, (i - (i0 - 7)) / 14, ((i1 + 7) - i) / 14); }
    }
    const blur = (a, w, passes) => { for (let p = 0; p < passes; p++) { const o = new Float32Array(N); for (let i = 0; i < N; i++) { let t = 0; for (let j = -w; j <= w; j++) t += a[(i + j + n) % n]; o[i] = t / (2 * w + 1); } o[n] = o[0]; a.set(o); } };
    blur(bridge, 36, 2);
    Object.assign(this, { zone, bridgeK: bridge, tunnelK: tunnel, gripArr: grip });
  }

  /** czy pad p obejmuje punkt s (okrąża modulo długość okrążenia) */
  inPad(p, s) { const L = this.length; return ((s - p.s0) % L + L) % L < p.len; }
  /** odległość naprzód (modulo okrążenie) do początku pada */
  padAhead(p, s) { const L = this.length; return ((p.s0 - s) % L + L) % L; }
  /** ostatni checkpoint przed s (do respawnu); przed linią startu — tuż za nią */
  lastCp(s) {
    const L = this.length, base = Math.floor(s / L) * L, rel = s - base;
    let c = null; for (const k of this.checkpoints) if (k <= rel - 8) c = base + k;
    if (c == null) { if (base > 0 && this.checkpoints.length) return base - L + this.checkpoints[this.checkpoints.length - 1]; return Math.min(s, 0) - 12; }
    return c;
  }
  /** miejsce na paczkę: płasko; zwraca s */
  pickS(s) {
    const L = this.length;
    for (let d = 0; d < 200; d += 2) for (const sg of [-1, 1]) { const i = (((Math.round(s) + sg * d) % L) + L) % L; if (Math.abs(this.ty[i]) < 0.2 && Math.abs(this.kg[i]) < 0.03) return i; }
    return ((Math.round(s) % L) + L) % L;
  }
  /** rama toru w punkcie s (interpolacja, cyklicznie): wypełnia `o` pozycją, T, U, R, kg, ku */
  at(s, o = {}) {
    const L = this.length;
    let f = (((s % L) + L) % L) / DS; const i = Math.min(this.N - 2, Math.floor(f)), t = f - i, j = i + 1, l = (a, b) => a + (b - a) * t;
    o.px = l(this.px[i], this.px[j]); o.py = l(this.py[i], this.py[j]); o.pz = l(this.pz[i], this.pz[j]);
    o.tx = l(this.tx[i], this.tx[j]); o.ty = l(this.ty[i], this.ty[j]); o.tz = l(this.tz[i], this.tz[j]);
    o.ux = l(this.ux[i], this.ux[j]); o.uy = l(this.uy[i], this.uy[j]); o.uz = l(this.uz[i], this.uz[j]);
    o.rx = l(this.rx[i], this.rx[j]); o.ry = l(this.ry[i], this.ry[j]); o.rz = l(this.rz[i], this.rz[j]);
    let k = Math.hypot(o.tx, o.ty, o.tz) || 1; o.tx /= k; o.ty /= k; o.tz /= k;
    k = Math.hypot(o.ux, o.uy, o.uz) || 1; o.ux /= k; o.uy /= k; o.uz /= k;
    k = Math.hypot(o.rx, o.ry, o.rz) || 1; o.rx /= k; o.ry /= k; o.rz /= k;
    o.kg = l(this.kg[i], this.kg[j]); o.ku = l(this.ku[i], this.ku[j]); o.wall = 1; o.surf = 1; o.grip = this.gripArr[i];
    return o;
  }
  /** pozycja świata punktu (s, d) na powierzchni (+ wysokość h nad nią) */
  pos(s, d, h = 0, o = {}) {
    const f = this.at(s, this._tmp || (this._tmp = {}));
    o.x = f.px + f.rx * d + f.ux * h; o.y = f.py + f.ry * d + f.uy * h; o.z = f.pz + f.rz * d + f.uz * h; return o;
  }
  /** najbliższy punkt jezdni w oknie [s0 - back, s0 + fwd] → { s (ciągłe), d, h, along, dist, surf } */
  nearest(x, y, z, s0, back = 40, fwd = 110) {
    const n = this.N - 1, a = Math.floor((s0 - back) / DS), b = Math.ceil((s0 + fwd) / DS);
    let best = 1e18, bk = a;
    for (let k = a; k <= b; k++) { const i = ((k % n) + n) % n, dx = x - this.px[i], dy = y - this.py[i], dz = z - this.pz[i], dd = dx * dx + dy * dy + dz * dz; if (dd < best) { best = dd; bk = k; } }
    const i = ((bk % n) + n) % n, dx = x - this.px[i], dy = y - this.py[i], dz = z - this.pz[i];
    const along = dx * this.tx[i] + dy * this.ty[i] + dz * this.tz[i];
    const s = bk * DS + along;
    const f = this.at(s, this._tmp2 || (this._tmp2 = {}));
    const ex = x - f.px, ey = y - f.py, ez = z - f.pz;
    return { s, d: ex * f.rx + ey * f.ry + ez * f.rz, h: ex * f.ux + ey * f.uy + ez * f.uz, along, dist: Math.sqrt(best), surf: Math.abs(along) < 2.5 };
  }
}
