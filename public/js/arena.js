// Arena: pole walki z górkami, dołami i rampami. Dane terenu, kolizje i fizyka 3D (skoki, zjazdy).
import { BARRIER } from './track.js';

export const ARENA_R = 80;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const gauss = (x, z, cx, cz, s, H) => H * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s));

const HILLS = [[17, 17, 8, 6.5], [-17, 17, 8, 6.5], [-17, -17, 8, 6.5], [17, -17, 8, 6.5]];
const PITS = [[33, 0, 8, -5], [-33, 0, 8, -5], [0, 33, 8, -5], [0, -33, 8, -5]];
// rampy: start (cx,cz), kierunek najazdu `ang`, długość L, szerokość W, wysokość H — na końcu ostry uskok (skok)
export const RAMPS = [
  { cx: -62, cz: -4, ang: 0, L: 16, W: 11, H: 4.6 },
  { cx: 4, cz: -62, ang: Math.PI / 2, L: 16, W: 11, H: 4.6 },
  { cx: 62, cz: 4, ang: Math.PI, L: 16, W: 11, H: 4.6 },
  { cx: -4, cz: 62, ang: -Math.PI / 2, L: 16, W: 11, H: 4.6 },
];
export const OBSTACLES = [[38, 18, 2.2], [-38, 18, 2.2], [38, -18, 2.2], [-38, -18, 2.2], [18, 38, 2.2], [-18, 38, 2.2], [18, -38, 2.2], [-18, -38, 2.2]];
export const PLATFORM = { r: 12, H: 2.6 };
/** pola startowe 4 graczy: [x, z, yaw] */
export const SPAWNS = [45, 135, 225, 315].map((deg) => { const a = (deg * Math.PI) / 180; return [Math.cos(a) * 58, Math.sin(a) * 58, a + Math.PI]; });

function rampH(x, z, r) {
  const dx = x - r.cx, dz = z - r.cz, c = Math.cos(r.ang), s = Math.sin(r.ang);
  const u = dx * c + dz * s, v = -dx * s + dz * c;
  if (u < 0 || u > r.L) return 0;
  return r.H * (u / r.L) * (1 - sstep(r.W / 2 - 1.2, r.W / 2, Math.abs(v)));
}
export function rampMask(x, z) { let m = 0; for (const r of RAMPS) { const dx = x - r.cx, dz = z - r.cz, c = Math.cos(r.ang), s = Math.sin(r.ang); const u = dx * c + dz * s, v = -dx * s + dz * c; if (u > -0.5 && u < r.L + 0.5 && Math.abs(v) < r.W / 2 + 0.3) m = 1; } return m; }

export function heightAt(x, z) {
  let h = 0;
  for (const g of HILLS) h += gauss(x, z, g[0], g[1], g[2], g[3]);
  for (const g of PITS) h += gauss(x, z, g[0], g[1], g[2], g[3]);
  const r = Math.hypot(x, z);
  h += PLATFORM.H * (1 - sstep(PLATFORM.r - 2, PLATFORM.r + 9, r));
  let best = 0; for (const rp of RAMPS) best = Math.max(best, rampH(x, z, rp));
  h += best;
  return h;
}
const E = 0.35;
export function gradAt(x, z) {
  return { x: (heightAt(x + E, z) - heightAt(x - E, z)) / (2 * E), z: (heightAt(x, z + E) - heightAt(x, z - E)) / (2 * E) };
}

/** „tor” dla CarState: okrągła bariera na brzegu areny (ta sama konwencja co Track.query) */
export const field = {
  N: 1, ds: 1, laps: 0, def: { theme: 'arena' },
  bounds: { minX: -ARENA_R, maxX: ARENA_R, minZ: -ARENA_R, maxZ: ARENA_R },
  query(px, pz) {
    const r = Math.hypot(px, pz) || 1e-4, nx = px / r, nz = pz / r, lim = ARENA_R - 1.3;
    return { idx: 0, d: r > lim ? BARRIER - 1.25 + (r - lim) : 0, tx: -nz, tz: nx, nx, nz, psi: Math.atan2(nz, nx) + Math.PI / 2 };
  },
  at(i, lat) { return { x: 0, z: 0, yaw: 0, idx: 0 }; },
};

function obstacleCollide(car) {
  const cs = Math.cos(car.yaw), sn = Math.sin(car.yaw);
  for (const [ox, oz, or] of OBSTACLES) {
    if (car.y - heightAt(ox, oz) > 3.8) continue;
    for (const off of [1.45, -1.45, 0]) {
      const cx = car.x + cs * off, cz = car.z + sn * off;
      let dx = cx - ox, dz = cz - oz; const d = Math.hypot(dx, dz) || 1e-4, min = or + 1.2;
      if (d < min) {
        dx /= d; dz /= d;
        car.x += dx * (min - d); car.z += dz * (min - d);
        const vn = car.vx * dx + car.vz * dz;
        if (vn < 0) { car.vx -= 1.3 * vn * dx; car.vz -= 1.3 * vn * dz; car.vx *= 0.9; car.vz *= 0.9; car.hit = Math.max(car.hit, -vn); }
      }
    }
  }
}

const G_SLOPE = 24, GRAV = 30;
/** Krok fizyki w arenie: jazda po terenie, siły na zboczach, skoki, lądowanie. */
export function arenaStep(car, input, dt) {
  if (car.y === undefined) { car.y = heightAt(car.x, car.z); car.vy = 0; car.vyT = 0; car.air = false; }
  car.landHit = 0;
  if (car.air) {
    const n = Math.max(1, Math.ceil(dt / 0.01)), h = dt / n;
    for (let i = 0; i < n; i++) {
      car.x += car.vx * h; car.z += car.vz * h;
      car.vy -= GRAV * h; car.y += car.vy * h;
      const r = Math.hypot(car.x, car.z), lim = ARENA_R - 1.3;
      if (r > lim) { const nx = car.x / r, nz = car.z / r; car.x = nx * lim; car.z = nz * lim; const vn = car.vx * nx + car.vz * nz; if (vn > 0) { car.vx -= 1.4 * vn * nx; car.vz -= 1.4 * vn * nz; car.hit = Math.max(car.hit, vn); } }
      obstacleCollide(car);
      const gh = heightAt(car.x, car.z);
      if (car.y <= gh) {
        const imp = -car.vy;
        car.y = gh; car.air = false; car.vyT = 0;
        if (imp > 13) car.landHit = (imp - 13) * 2.4;
        car.vy = 0; break;
      }
    }
    car.speedSq = car.vx * car.vx + car.vz * car.vz;
    return;
  }
  car.step(field, input, dt);
  obstacleCollide(car);
  const g = gradAt(car.x, car.z);
  car.vx -= g.x * G_SLOPE * dt; car.vz -= g.z * G_SLOPE * dt;
  const hn = heightAt(car.x, car.z);
  const ballistic = car.y + car.vyT * dt - 0.5 * GRAV * dt * dt;
  if (car.vyT > 2.5 && ballistic > hn + 0.12) { car.air = true; car.vy = Math.min(car.vyT, 12); car.y = Math.max(ballistic, hn); }
  else { car.vyT = Math.max(-15, Math.min(15, (hn - car.y) / dt * 0.6 + car.vyT * 0.4)); car.y = hn; }
}

/** wizualne nachylenie auta: [roll, pitch] względem terenu */
export function tiltAt(x, z, yaw) {
  const g = gradAt(x, z), fx = Math.cos(yaw), fz = Math.sin(yaw);
  return [Math.atan(-(g.x * -fz + g.z * fx)), Math.atan(g.x * fx + g.z * fz)];
}
