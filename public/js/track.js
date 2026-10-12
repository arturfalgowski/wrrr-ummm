// Dane toru: linia środkowa, próbkowanie co ~1 jednostkę, zapytania o położenie auta.
import * as THREE from 'three';

export const ROAD_HALF = 8;      // połowa szerokości asfaltu
export const KERB_W = 1.5;       // szerokość pasa krawężnika
export const BARRIER = 14;       // odległość bariery od osi toru
export const LAPS = 4;

// Punkty kontrolne [x, z] — tor zamknięty, jazda zgodnie z kolejnością (start na dolnej prostej, w prawo).
const CONTROL = [
  [-40, 45], [10, 47], [55, 45], [90, 30], [96, 2], [80, -24], [56, -32],
  [40, -16], [20, -6], [-4, -16], [-18, -42], [-50, -52], [-86, -40],
  [-98, -10], [-82, 18], [-64, 34],
];
const SCALE = 1.2;
const START_REF = [0, 46 * SCALE];

const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export class Track {
  constructor() {
    const curve = new THREE.CatmullRomCurve3(CONTROL.map(([x, z]) => new THREE.Vector3(x * SCALE, 0, z * SCALE)), true, 'centripetal');
    curve.arcLengthDivisions = 4000;
    this.length = curve.getLength();
    const n = Math.round(this.length);
    const raw = curve.getSpacedPoints(n).slice(0, n);
    // obrót tablicy tak, by indeks 0 leżał na linii startu
    let best = 0, bd = 1e9;
    raw.forEach((p, i) => { const d = Math.hypot(p.x - START_REF[0], p.z - START_REF[1]); if (d < bd) { bd = d; best = i; } });
    this.N = n;
    this.ds = this.length / n;
    this.x = new Float32Array(n); this.z = new Float32Array(n);
    for (let i = 0; i < n; i++) { const p = raw[(i + best) % n]; this.x[i] = p.x; this.z[i] = p.z; }
    this.tx = new Float32Array(n); this.tz = new Float32Array(n); this.psi = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n, b = (i + 1) % n;
      const dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz);
      this.tx[i] = dx / l; this.tz[i] = dz / l; this.psi[i] = Math.atan2(dz, dx);
    }
    // krzywizna (dodatnia = zakręt w prawo), wygładzona
    const k = new Float32Array(n);
    const W = 4;
    for (let i = 0; i < n; i++) k[i] = wrapAngle(this.psi[(i + W) % n] - this.psi[(i - W + n) % n]) / (2 * W * this.ds);
    this.kappa = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = -6; j <= 6; j++) s += k[(i + j + n) % n]; this.kappa[i] = s / 13; }
    let minR = 1e9; for (let i = 0; i < n; i++) minR = Math.min(minR, 1 / Math.max(1e-4, Math.abs(this.kappa[i])));
    this.minRadius = minR;
    // siatka odległości do toru (do rozmieszczania dekoracji)
    this.bounds = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 };
    for (let i = 0; i < n; i++) {
      this.bounds.minX = Math.min(this.bounds.minX, this.x[i]); this.bounds.maxX = Math.max(this.bounds.maxX, this.x[i]);
      this.bounds.minZ = Math.min(this.bounds.minZ, this.z[i]); this.bounds.maxZ = Math.max(this.bounds.maxZ, this.z[i]);
    }
  }

  /** Pozycja i kierunek na indeksie (może być ułamkowy/ujemny). */
  at(idx, lateral = 0) {
    const n = this.N;
    const f = ((idx % n) + n) % n;
    const i = Math.floor(f), j = (i + 1) % n, t = f - i;
    const x = this.x[i] + (this.x[j] - this.x[i]) * t;
    const z = this.z[i] + (this.z[j] - this.z[i]) * t;
    const a = this.psi[i];
    return { x: x - Math.sin(a) * lateral, z: z + Math.cos(a) * lateral, yaw: a, idx: f };
  }

  /** Najbliższy punkt toru: indeks (ułamkowy), odległość boczna (+ = prawa strona), tangens. */
  query(px, pz, hint = -1) {
    const n = this.N;
    let lo, hi;
    if (hint < 0) { lo = 0; hi = n; } else { lo = Math.floor(hint) - 40; hi = Math.floor(hint) + 41; }
    let best = null;
    const scan = (from, to) => {
      for (let q = from; q < to; q++) {
        const i = ((q % n) + n) % n, j = (i + 1) % n;
        const sx = this.x[j] - this.x[i], sz = this.z[j] - this.z[i];
        const l2 = sx * sx + sz * sz;
        let t = ((px - this.x[i]) * sx + (pz - this.z[i]) * sz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = this.x[i] + sx * t, cz = this.z[i] + sz * t;
        const d2 = (px - cx) ** 2 + (pz - cz) ** 2;
        if (!best || d2 < best.d2) best = { d2, i, t, cx, cz };
      }
    };
    scan(lo, hi);
    if (hint >= 0 && best.d2 > 35 * 35) scan(0, n);
    const i = best.i;
    const nx = -this.tz[i], nz = this.tx[i];
    const d = (px - best.cx) * nx + (pz - best.cz) * nz;
    return { idx: i + best.t, d, tx: this.tx[i], tz: this.tz[i], nx, nz, psi: this.psi[i] };
  }
}
