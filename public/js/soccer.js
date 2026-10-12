// Piłka samochodowa: geometria boiska, fizyka piłki, kolizje z bramkami i prosty bot.
import { BARRIER } from './track.js';

export const HX = 70, HZ = 44;       // połowa długości i szerokości boiska
export const GW = 11, GD = 9, GH = 5.2; // połowa szerokości bramki, głębokość, wysokość
export const BR = 2.4;               // promień piłki
export const TEAM_COLORS = { red: '#e53935', blue: '#2f6bff' };
export const TEAM_NAMES = { red: 'Czerwoni', blue: 'Niebiescy' };
const POST_R = 0.7;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** miejsce startowe auta: drużyna, numer w drużynie -> [x, z, yaw] (czerwoni po lewej, atakują w prawo) */
export function soccerSpawn(team, idx) {
  const s = team === 'red' ? -1 : 1;
  return [s * (22 + Math.floor(idx / 2) * 14), (idx % 2 ? 9 : -9), team === 'red' ? 0 : Math.PI];
}

/** „tor” dla CarState: prostokątne boisko z bramkami (wnętrze bramki jest przejezdne) */
export const soccerField = {
  N: 1, ds: 1, laps: 0, def: { theme: 'soccer' },
  bounds: { minX: -HX - GD, maxX: HX + GD, minZ: -HZ, maxZ: HZ },
  query(px, pz) {
    const ax = Math.abs(px), az = Math.abs(pz), sx = px < 0 ? -1 : 1, sz = pz < 0 ? -1 : 1;
    const lz = (ax > HX ? GW : HZ) - 1.3, lx = (az > GW ? HX : HX + GD) - 1.3;
    const pz2 = az - lz, px2 = ax - lx;
    let nx = 0, nz = 0, pen = 0;
    if (pz2 > 0 && pz2 >= px2) { nz = sz; pen = pz2; } else if (px2 > 0) { nx = sx; pen = px2; }
    if (!pen) return { idx: 0, d: 0, tx: 0, tz: 1, nx: 0, nz: 1, psi: 0 };
    return { idx: 0, d: BARRIER - 1.25 + pen, tx: -nz, tz: nx, nx, nz, psi: Math.atan2(nz, nx) + Math.PI / 2 };
  },
  at() { return { x: 0, z: 0, yaw: 0, idx: 0 }; },
};

const POSTS = [[HX, GW], [HX, -GW], [-HX, GW], [-HX, -GW]];
/** słupki bramek odpychają auto (jak słupy na arenie) */
function postCollide(car) {
  const cs = Math.cos(car.yaw), sn = Math.sin(car.yaw);
  for (const [ox, oz] of POSTS) {
    for (const off of [1.45, -1.45, 0]) {
      const cx = car.x + cs * off, cz = car.z + sn * off;
      let dx = cx - ox, dz = cz - oz; const d = Math.hypot(dx, dz) || 1e-4, min = POST_R + 1.2;
      if (d < min) {
        dx /= d; dz /= d;
        car.x += dx * (min - d); car.z += dz * (min - d);
        const vn = car.vx * dx + car.vz * dz;
        if (vn < 0) { car.vx -= 1.3 * vn * dx; car.vz -= 1.3 * vn * dz; car.hit = Math.max(car.hit, -vn); }
      }
    }
  }
}
/** krok fizyki auta na boisku (płasko, bez skoków) */
export function soccerStep(car, input, dt) {
  car.y = 0; car.vy = 0; car.vyT = 0; car.air = false; car.landHit = 0;
  car.step(soccerField, input, dt);
  postCollide(car);
}

// ---------------- piłka ----------------
export function makeBall() { return { x: 0, y: BR, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: BR, rz: 0, spin: 0, hitT: 0, lastHit: 0 }; }
export function resetBall(b) { Object.assign(b, { x: 0, y: BR, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: BR, rz: 0, lastHit: 0 }); }

const GRAV = 24, MAXV = 56;
/**
 * Krok piłki. `cars` — stany aut, z którymi piłka ma się zderzać (u hosta wszystkie, u reszty pusta lista).
 * Zwraca { goal: 'red'|'blue'|null, hit: siła ostatniego uderzenia auta, wall: siła odbicia od bandy }.
 */
export function stepBall(b, dt, cars) {
  const out = { goal: null, hit: 0, wall: 0, ground: 0 };
  const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
  for (let k = 0; k < n; k++) {
    b.vy -= GRAV * h;
    b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
    // ziemia
    if (b.y < BR) {
      b.y = BR;
      if (b.vy < -2.5) { out.ground = Math.max(out.ground, -b.vy); b.vy = -b.vy * 0.58; } else b.vy = 0;
    }
    const onGround = b.y <= BR + 0.05;
    const inNet = Math.abs(b.x) > HX + BR * 0.4; // siatka mocno hamuje piłkę
    const drag = Math.exp(-(inNet ? 2.6 : onGround ? 0.42 : 0.06) * h); b.vx *= drag; b.vz *= drag;
    // słupki
    if (b.y < GH + 0.3) for (const [px, pz] of POSTS) {
      let dx = b.x - px, dz = b.z - pz; const d = Math.hypot(dx, dz), min = BR + POST_R;
      if (d < min && d > 1e-4) { dx /= d; dz /= d; b.x = px + dx * min; b.z = pz + dz * min; const vn = b.vx * dx + b.vz * dz; if (vn < 0) { b.vx -= 1.7 * vn * dx; b.vz -= 1.7 * vn * dz; out.wall = Math.max(out.wall, -vn); } }
    }
    // bandy: boczne, końcowe (z otworem bramki) i wnętrze bramki
    const ax = Math.abs(b.x), az = Math.abs(b.z), sx = b.x < 0 ? -1 : 1, sz = b.z < 0 ? -1 : 1;
    const inMouth = az < GW - BR * 0.35 && b.y < GH - BR * 0.4; // piłka mieści się w bramce
    const zLim = (ax > HX + BR * 0.5 ? GW : HZ) - BR;
    if (az > zLim) { b.z = sz * zLim; if (b.vz * sz > 0) { out.wall = Math.max(out.wall, Math.abs(b.vz)); b.vz *= -0.7; } }
    if (ax > HX - BR && !inMouth && ax < HX + 1) { b.x = sx * (HX - BR); if (b.vx * sx > 0) { out.wall = Math.max(out.wall, Math.abs(b.vx)); b.vx *= -0.7; } }
    if (ax > HX + GD - BR) { b.x = sx * (HX + GD - BR); if (b.vx * sx > 0) { out.wall = Math.max(out.wall, Math.abs(b.vx)); b.vx *= -0.35; } }
    if (ax > HX && b.y > GH - BR) { b.y = GH - BR; if (b.vy > 0) b.vy *= -0.4; } // sufit bramki
    // gol: cała piłka za linią bramkowej
    if (!out.goal && ax > HX + BR && inMouth) out.goal = b.x > 0 ? 'red' : 'blue';
    // auta
    for (const c of cars) {
      if (b.y > BR + 2.8) continue;
      const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
      for (const off of [1.5, 0, -1.5]) {
        const cx = c.x + cs * off, cz = c.z + sn * off;
        let dx = b.x - cx, dz = b.z - cz; const d = Math.hypot(dx, dz), min = BR + 1.35;
        if (d < min && d > 1e-4) {
          dx /= d; dz /= d;
          b.x = cx + dx * min; b.z = cz + dz * min;
          const rel = (b.vx - c.vx) * dx + (b.vz - c.vz) * dz;
          if (rel < 0) {
            const j = -(1 + 0.45) * rel;
            b.vx += dx * j; b.vz += dz * j;
            b.vy += clamp(-rel * 0.16, 0, 9) * (b.y < BR + 0.6 ? 1 : 0.3);
            out.hit = Math.max(out.hit, -rel);
            b.lastHit = c.sid ?? 0;
          }
        }
      }
    }
    const sp = Math.hypot(b.vx, b.vz); if (sp > MAXV) { b.vx *= MAXV / sp; b.vz *= MAXV / sp; }
  }
  b.spin += Math.hypot(b.vx, b.vz) * dt / BR;
  return out;
}

/** wygładzanie widocznej pozycji piłki (render) */
export function smoothBall(b, dt) {
  const k = 1 - Math.exp(-dt * 16);
  if (Math.hypot(b.x - b.rx, b.z - b.rz) > 9) { b.rx = b.x; b.ry = b.y; b.rz = b.z; return; }
  b.rx += (b.x - b.rx) * k; b.ry += (b.y - b.ry) * k; b.rz += (b.z - b.rz) * k;
}

/** wejście bota: { throttle, brake, steer, hand } */
export function soccerBotInput(bot, ball, st, dt, role) {
  const dir = bot.team === 'red' ? 1 : -1;       // kierunek ataku po osi X
  const goalX = dir * (HX + GD * 0.4);
  let tx, tz;
  const ownSide = -dir;
  const nearOwn = (ball.x * ownSide) > HX * 0.35;
  if (role === 1 && !nearOwn && (ball.x * dir) < HX * 0.5) { // obrońca: stoi między piłką a własną bramką
    tx = ownSide * HX * 0.5; tz = ball.z * 0.45;
  } else {
    // punkt za piłką na linii piłka → bramka przeciwnika
    const gx = goalX - ball.x, gz = -ball.z * 0.6, gl = Math.hypot(gx, gz) || 1;
    tx = ball.x - (gx / gl) * (BR + 2.6); tz = ball.z - (gz / gl) * (BR + 2.6);
    const behind = (st.x - ball.x) * dir < -1; // jestem „za” piłką względem własnej bramki
    const dBall = Math.hypot(ball.x - st.x, ball.z - st.z);
    if (dBall < 7 && behind) { tx = goalX; tz = 0; tx = ball.x + (goalX - ball.x) * 0.5; tz = ball.z * 0.5; }
    if (!behind && dBall < 22) { // jestem przed piłką: okrąż ją od strony własnej bramki
      tx = ball.x + ownSide * 14; tz = ball.z + (st.z > ball.z ? 12 : -12);
    }
  }
  // piłka utknęła (np. w rogu) — jedź prosto na nią, żeby ją ruszyć
  const ai0 = bot.ai;
  ai0.still = Math.hypot(ball.vx, ball.vz) < 1.5 ? (ai0.still || 0) + dt : 0;
  if (ai0.still > 2.2) { tx = ball.x + (ball.x > 0 ? -1 : 1) * 0.8 * dir * 0; tz = ball.z; if (ai0.still > 5) { tx = ball.x - dir * 4; tz = ball.z + (ball.z > 0 ? -5 : 5); } }
  tx = clamp(tx, -HX + 4, HX - 4); tz = clamp(tz, -HZ + 4, HZ - 4);
  const ang = wrapA(Math.atan2(tz - st.z, tx - st.x) - st.yaw);
  const dClose = Math.hypot(ball.x - st.x, ball.z - st.z);
  const inp = { throttle: dClose < 12 && Math.abs(ang) > 0.5 ? 0.55 : 1, brake: 0, steer: clamp(ang * 2.4, -1, 1), hand: false };
  if (Math.abs(ang) > 2 && st.speed > 9) { inp.throttle = 0; inp.brake = 1; }
  const ai = bot.ai;
  if (st.speed < 2.5) ai.stuck += dt; else ai.stuck = 0;
  if (ai.stuck > 1.0) { ai.rev = 0.8; ai.stuck = 0; ai.revSteer = Math.random() < 0.5 ? -1 : 1; }
  if (ai.rev > 0) { ai.rev -= dt; inp.throttle = 0; inp.brake = 1; inp.steer = ai.revSteer; }
  return inp;
}
