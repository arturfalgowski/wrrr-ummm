// Tory w stylu TrackMania: trasa 3D budowana „żółwiem” z elementów (proste, łuki, rampy, pętle, przerwy, przechyły).
// Zwraca próbki co 1 m z pełną ramą (T, U, R) — fizyka jazdy po powierzchni liczy się w współrzędnych toru (s, d).
import * as THREE from 'three';

export const HW = 8;        // połowa szerokości jezdni
export const DS = 1;        // odstęp próbek [m]
const DEG = Math.PI / 180;

// ---- elementy toru (pomocnicze konstruktory) ----
export const S = (len, o = {}) => ({ t: 's', len, ...o });                       // prosta
export const C = (deg, r, o = {}) => ({ t: 'c', a: deg, r, ...o });              // łuk w poziomie, + = w prawo
export const P = (deg, r, o = {}) => ({ t: 'p', a: deg, r, ...o });              // łuk w pionie, + = pod górę
export const LOOP = (r, yawDeg = 32, o = {}) => ({ t: 'loop', r, yaw: yawDeg, ...o }); // pętla 360° (przesunięcie boczne dzięki odchyleniu)
export const GAP = (len, o = {}) => ({ t: 'gap', len, ...o });                  // przerwa w jezdni (skok)
/** skok: rampa w górę, łuk bez jezdni (balistyczny), lądowanie z wyrównaniem; r ≈ zasięg lotu */
export const JUMP = (up = 20, r = 140, o = {}) => [P(up, 35, o), S(8, { ...o, walls: false }), P(-2 * up, r, { ...o, gap: true, walls: false }), P(up, 35, { ...o, walls: false })];
/** podjazd i zjazd: wznosi się o deg stopni na łuku r, prosta flat, wraca */
export const HILL = (deg, r, flat = 20, o = {}) => [P(deg, r, o), S(flat, o), P(-deg, r, o)];

const rotv = (v, ax, a) => { // obrót wektora v wokół osi ax (jednostkowej) o kąt a
  const c = Math.cos(a), s = Math.sin(a), d = ax.x * v.x + ax.y * v.y + ax.z * v.z;
  const cx = ax.y * v.z - ax.z * v.y, cy = ax.z * v.x - ax.x * v.z, cz = ax.x * v.y - ax.y * v.x;
  v.x = v.x * c + cx * s + ax.x * d * (1 - c); v.y = v.y * c + cy * s + ax.y * d * (1 - c); v.z = v.z * c + cz * s + ax.z * d * (1 - c);
};
const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; v.x /= l; v.y /= l; v.z /= l; };
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const sstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class Track3D {
  constructor(def) {
    this.def = def; this.id = def.id;
    const ops = def.ops.flat(Infinity);
    const P0 = { x: 0, y: def.y0 ?? 0, z: 0 };
    const T = { x: 1, y: 0, z: 0 }, U = { x: 0, y: 1, z: 0 };
    const px = [], py = [], pz = [], tx = [], ty = [], tz = [], ux = [], uy = [], uz = [], rx = [], ry = [], rz = [];
    const wallA = [], surfA = [], bankA = [];
    let bank = 0;
    const pads = [];
    const push = (ro, wall, surf) => { // zapisz próbkę z uwzględnieniem przechyłu (rolla) wokół T
      const Rb = cross(T, U); // prawa strona (bez przechyłu)
      const c = Math.cos(ro), s = Math.sin(ro);
      const Ub = { x: U.x * c + Rb.x * s, y: U.y * c + Rb.y * s, z: U.z * c + Rb.z * s };
      const Rr = cross(T, Ub);
      px.push(P0.x); py.push(P0.y); pz.push(P0.z); tx.push(T.x); ty.push(T.y); tz.push(T.z);
      ux.push(Ub.x); uy.push(Ub.y); uz.push(Ub.z); rx.push(Rr.x); ry.push(Rr.y); rz.push(Rr.z);
      wallA.push(wall ? 1 : 0); surfA.push(surf ? 1 : 0); bankA.push(ro);
    };
    const WUP = { x: 0, y: 1, z: 0 };
    const advance = (yawRate, pitchRate, worldYaw = false) => { // jeden krok DS: obrót ramy, potem przesunięcie
      if (yawRate && worldYaw) { rotv(T, WUP, -yawRate * DS); rotv(U, WUP, -yawRate * DS); } // pętla: skręt wokół pionu świata
      else if (yawRate) rotv(T, U, -yawRate * DS);          // + = w prawo (T obraca się w stronę R)
      if (pitchRate) { const R = cross(T, U); norm(R); rotv(T, R, pitchRate * DS); rotv(U, R, pitchRate * DS); } // + = nosem w górę
      norm(T); const R2 = cross(T, U); norm(R2); const U2 = cross(R2, T); norm(U2); U.x = U2.x; U.y = U2.y; U.z = U2.z;
      P0.x += T.x * DS; P0.y += T.y * DS; P0.z += T.z * DS;
    };
    // ruch „do przodu”: yawRate > 0 => w prawo (obrót T w stronę R)
    for (const op of ops) {
      const walls = op.walls ?? true, surf = op.t !== 'gap' && !op.gap;
      let len = op.len ?? 0, yaw = 0, pit = 0;
      if (op.t === 'c') { len = Math.abs(op.a) * DEG * op.r; yaw = Math.sign(op.a) / op.r; }
      else if (op.t === 'p') { len = Math.abs(op.a) * DEG * op.r; pit = Math.sign(op.a) / op.r; }
      else if (op.t === 'loop') { len = 2 * Math.PI * op.r; pit = 1 / op.r; }
      const n = Math.max(1, Math.round(len / DS));
      const bankTo = op.bank ?? null, bank0 = bank;
      const Y = (op.yaw ?? 0) * DEG;
      if (op.pad) pads.push({ s0: px.length + (op.pad.at ?? 8), len: op.pad.len ?? 16, lane: op.pad.lane ?? 1 });
      for (let i = 0; i < n; i++) {
        if (bankTo !== null) bank = bank0 + (bankTo - bank0) * sstep((i + 1) / n);
        let yr = yaw;
        if (op.t === 'loop') { // odchylenie kursu w pierwszej i ostatniej ćwiartce → boczne przesunięcie wyjścia pętli
          const dev = (u) => (u < 0.25 ? Math.sin(Math.PI * (u / 0.25)) : u > 0.75 ? Math.sin(Math.PI * ((u - 0.75) / 0.25)) : 0);
          yr = Y * (dev((i + 1) / n) - dev(i / n)) / DS;
        }
        push(bank * DEG, walls && op.t !== 'loop', surf);
        advance(yr, pit, op.t === 'loop');
      }
      if (op.t === 'loop') { // po pętli wyrównaj ramę do poziomu (usuwa drobny dryf kątowy)
        T.y = 0; norm(T); U.x = 0; U.y = 1; U.z = 0; P0.y = Math.round(P0.y * 1000) / 1000;
      }
    }
    push(bank * DEG, true, true); // ostatnia próbka
    const N = px.length;
    this.N = N; this.length = (N - 1) * DS;
    const f32 = (a) => Float32Array.from(a);
    Object.assign(this, { px: f32(px), py: f32(py), pz: f32(pz), tx: f32(tx), ty: f32(ty), tz: f32(tz), ux: f32(ux), uy: f32(uy), uz: f32(uz), rx: f32(rx), ry: f32(ry), rz: f32(rz), wall: Uint8Array.from(wallA), surf: Uint8Array.from(surfA), bank: f32(bankA) });
    // krzywizny: kg — w poprzek jezdni (w prawo), ku — w stronę normalnej (dolina > 0)
    const kg = new Float32Array(N), ku = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 2), b = Math.min(N - 1, i + 2), dd = (b - a) * DS;
      const dx = (tx[b] - tx[a]) / dd, dy = (ty[b] - ty[a]) / dd, dz = (tz[b] - tz[a]) / dd;
      kg[i] = dx * rx[i] + dy * ry[i] + dz * rz[i];
      ku[i] = dx * ux[i] + dy * uy[i] + dz * uz[i];
    }
    this.kg = kg; this.ku = ku;
    this.x = this.px; this.z = this.pz; // zgodność z minimapą
    this.pads = pads.map((p) => ({ ...p, lat: p.lane * 3.9 }));
    // znaczniki: start (s) i meta, checkpointy co ok. 220 m
    this.startS = def.startS ?? 36;
    this.finishS = this.length - (def.runout ?? 70);
    this.checkpoints = []; for (let s = this.startS + 200; s < this.finishS - 60; s += 220) this.checkpoints.push(s);
    // obwiednia (minimapa, kamera menu)
    const b = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9, minY: 1e9, maxY: -1e9 };
    for (let i = 0; i < N; i++) { b.minX = Math.min(b.minX, px[i]); b.maxX = Math.max(b.maxX, px[i]); b.minZ = Math.min(b.minZ, pz[i]); b.maxZ = Math.max(b.maxZ, pz[i]); b.minY = Math.min(b.minY, py[i]); b.maxY = Math.max(b.maxY, py[i]); }
    this.bounds = b;
  }

  /** rama toru w punkcie s (interpolacja): wypełnia `o` pozycją, T, U, R, kg, ku, ściana, powierzchnia */
  at(s, o = {}) {
    const N = this.N;
    let f = s / DS; if (f < 0) f = 0; if (f > N - 1.001) f = N - 1.001;
    const i = Math.floor(f), t = f - i, j = i + 1, l = (a, b) => a + (b - a) * t;
    o.px = l(this.px[i], this.px[j]); o.py = l(this.py[i], this.py[j]); o.pz = l(this.pz[i], this.pz[j]);
    o.tx = l(this.tx[i], this.tx[j]); o.ty = l(this.ty[i], this.ty[j]); o.tz = l(this.tz[i], this.tz[j]);
    o.ux = l(this.ux[i], this.ux[j]); o.uy = l(this.uy[i], this.uy[j]); o.uz = l(this.uz[i], this.uz[j]);
    o.rx = l(this.rx[i], this.rx[j]); o.ry = l(this.ry[i], this.ry[j]); o.rz = l(this.rz[i], this.rz[j]);
    let k = Math.hypot(o.tx, o.ty, o.tz) || 1; o.tx /= k; o.ty /= k; o.tz /= k;
    k = Math.hypot(o.ux, o.uy, o.uz) || 1; o.ux /= k; o.uy /= k; o.uz /= k;
    k = Math.hypot(o.rx, o.ry, o.rz) || 1; o.rx /= k; o.ry /= k; o.rz /= k;
    o.kg = l(this.kg[i], this.kg[j]); o.ku = l(this.ku[i], this.ku[j]);
    o.wall = this.wall[t < 0.5 ? i : j]; o.surf = this.surf[t < 0.5 ? i : j];
    return o;
  }
  /** pozycja świata punktu (s, d) na powierzchni (+ wysokość h nad nią) */
  pos(s, d, h = 0, o = {}) {
    const f = this.at(s, this._tmp || (this._tmp = {}));
    o.x = f.px + f.rx * d + f.ux * h; o.y = f.py + f.ry * d + f.uy * h; o.z = f.pz + f.rz * d + f.uz * h; return o;
  }
  /** najbliższy punkt jezdni (tylko próbki z nawierzchnią) w oknie [s0 - back, s0 + fwd] → { s, d, h, along, dist, surf } */
  nearest(x, y, z, s0, back = 40, fwd = 110) {
    const N = this.N, a = Math.max(0, Math.floor((s0 - back) / DS)), b = Math.min(N - 1, Math.ceil((s0 + fwd) / DS));
    let best = 1e18, bi = -1;
    for (let i = a; i <= b; i++) { if (!this.surf[i]) continue; const dx = x - this.px[i], dy = y - this.py[i], dz = z - this.pz[i], dd = dx * dx + dy * dy + dz * dz; if (dd < best) { best = dd; bi = i; } }
    if (bi < 0) return { s: s0, d: 0, h: 99, along: 99, dist: 1e9, surf: false };
    const dx = x - this.px[bi], dy = y - this.py[bi], dz = z - this.pz[bi];
    const along = dx * this.tx[bi] + dy * this.ty[bi] + dz * this.tz[bi];
    const s = Math.min((N - 1) * DS, Math.max(0, bi * DS + along));
    const f = this.at(s, this._tmp2 || (this._tmp2 = {}));
    const ex = x - f.px, ey = y - f.py, ez = z - f.pz;
    return { s, d: ex * f.rx + ey * f.ry + ez * f.rz, h: ex * f.ux + ey * f.uy + ez * f.uz, along, dist: Math.sqrt(best), surf: f.surf === 1 && Math.abs(along) < 2.5 };
  }
}
