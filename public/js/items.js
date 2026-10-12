// Paczki spadające na tor (nitro / naboje / olej), pociski i plamy oleju — wizualizacja i stan lokalny.
import * as THREE from 'three';
import { BARRIER } from './track.js';

export const ITEM_TYPES = {
  nitro: { name: 'Nitro', color: '#27c7ff', dark: '#0b4fa8' },
  ammo: { name: 'Naboje', color: '#ffb02e', dark: '#c4440a' },
  oil: { name: 'Olej', color: '#a46bff', dark: '#2a1458' },
  repair: { name: 'Naprawa', color: '#3ddc84', dark: '#0b6b3a' },
  bomb: { name: 'Bomba', color: '#ff4a3a', dark: '#5c0e08' },
  rocket: { name: 'Rakieta', color: '#ff5fa2', dark: '#7a1250' },
  shield: { name: 'Tarcza', color: '#cfd8ff', dark: '#3b3f9c' },
};

const texCache = {};
function crateTexture(type) {
  if (texCache[type]) return texCache[type];
  const t = ITEM_TYPES[type];
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 256, 256); g.addColorStop(0, t.color); g.addColorStop(1, t.dark);
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = 12; x.strokeRect(14, 14, 228, 228);
  x.fillStyle = '#fff'; x.shadowColor = 'rgba(0,0,0,0.35)'; x.shadowBlur = 10;
  if (type === 'nitro') {
    x.beginPath(); x.moveTo(150, 36); x.lineTo(78, 140); x.lineTo(120, 140); x.lineTo(98, 222); x.lineTo(184, 106); x.lineTo(138, 106); x.closePath(); x.fill();
  } else if (type === 'ammo') {
    for (const dx of [-52, 0, 52]) {
      x.save(); x.translate(128 + dx, 138); x.beginPath();
      x.moveTo(-17, 62); x.lineTo(-17, -20); x.quadraticCurveTo(-17, -62, 0, -76); x.quadraticCurveTo(17, -62, 17, -20); x.lineTo(17, 62); x.closePath(); x.fill(); x.restore();
    }
  } else if (type === 'repair') {
    x.fillRect(100, 48, 56, 160); x.fillRect(48, 100, 160, 56);
  } else if (type === 'bomb') {
    x.beginPath(); x.arc(128, 148, 66, 0, 6.3); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = 12; x.beginPath(); x.moveTo(150, 92); x.quadraticCurveTo(176, 56, 204, 66); x.stroke();
    x.fillStyle = '#ffd23a'; x.beginPath(); x.arc(208, 64, 14, 0, 6.3); x.fill();
  } else if (type === 'rocket') {
    x.save(); x.translate(128, 128); x.rotate(-Math.PI / 4); x.beginPath();
    x.moveTo(0, -92); x.quadraticCurveTo(34, -52, 30, 40); x.lineTo(54, 78); x.lineTo(14, 60); x.lineTo(0, 86); x.lineTo(-14, 60); x.lineTo(-54, 78); x.lineTo(-30, 40); x.quadraticCurveTo(-34, -52, 0, -92); x.fill(); x.restore();
  } else if (type === 'shield') {
    x.beginPath(); x.moveTo(128, 34); x.lineTo(206, 62); x.quadraticCurveTo(206, 168, 128, 224); x.quadraticCurveTo(50, 168, 50, 62); x.closePath(); x.fill();
    x.fillStyle = 'rgba(60,70,170,.55)'; x.beginPath(); x.moveTo(128, 70); x.lineTo(128, 190); x.quadraticCurveTo(82, 150, 82, 84); x.closePath(); x.fill();
  } else {
    x.beginPath(); x.moveTo(128, 34); x.bezierCurveTo(128, 34, 52, 118, 52, 160); x.bezierCurveTo(52, 204, 86, 226, 128, 226); x.bezierCurveTo(170, 226, 204, 204, 204, 160); x.bezierCurveTo(204, 118, 128, 34, 128, 34); x.fill();
    x.fillStyle = 'rgba(80,40,160,0.6)'; x.beginPath(); x.ellipse(104, 168, 16, 28, 0.4, 0, 6.3); x.fill();
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return (texCache[type] = tex);
}

export class Items {
  constructor(parent, particles) {
    this.parent = parent; this.particles = particles;
    this.crates = new Map(); this.shots = []; this.oils = [];
    this.t = 0;
    this.ground = null; // (x,z) => wysokość terenu (arena)
    this.bombs = []; this.rockets = [];
    this.boxGeo = new THREE.BoxGeometry(1.9, 1.9, 1.9);
    this.beamGeo = new THREE.CylinderGeometry(0.9, 0.9, 16, 16, 1, true);
    this.ringGeo = new THREE.RingGeometry(1.5, 2.1, 32); this.ringGeo.rotateX(-Math.PI / 2);
    this.shotGeo = new THREE.CapsuleGeometry(0.2, 1.3, 4, 8); this.shotGeo.rotateZ(Math.PI / 2);
    this.shotMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xff9a2a, emissiveIntensity: 4, roughness: 0.3 });
    this.oilGeo = new THREE.CircleGeometry(1, 28); this.oilGeo.rotateX(-Math.PI / 2);
    this.oilMat = new THREE.MeshStandardMaterial({ color: 0x07060c, roughness: 0.04, metalness: 0.85, transparent: true, opacity: 0.94, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  }

  /* ---------- paczki ---------- */
  spawn(id, type, x, z, ghOverride) {
    if (this.crates.has(id)) return;
    const col = new THREE.Color(ITEM_TYPES[type].color);
    const mat = new THREE.MeshStandardMaterial({ map: crateTexture(type), emissiveMap: crateTexture(type), emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.2 });
    const gh = ghOverride !== undefined ? ghOverride : this.ground ? this.ground(x, z) : 0;
    const mesh = new THREE.Mesh(this.boxGeo, mat);
    mesh.castShadow = true; mesh.position.set(x, gh + 34, z);
    const beam = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.set(x, gh + 8, z);
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
    ring.position.set(x, gh + 0.07, z);
    this.parent.add(mesh, beam, ring);
    this.crates.set(id, { id, type, x, z, gh, mesh, beam, ring, y: gh + 34, vy: 0, landed: false, age: 0, dying: 0 });
  }
  remove(id, pop = true) {
    const c = this.crates.get(id); if (!c) return;
    if (pop && this.particles) {
      const col = new THREE.Color(ITEM_TYPES[c.type].color);
      for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28, s = 3 + Math.random() * 6; this.particles.emit(c.x, 1.2, c.z, Math.cos(a) * s, 2 + Math.random() * 5, Math.sin(a) * s, 0.6, 0.6, 0.1, col, 0.9, 1.2, 10); }
    }
    c.dying = 1; c.age = 0;
  }
  _free(c) { this.parent.remove(c.mesh, c.beam, c.ring); c.mesh.material.dispose(); c.beam.material.dispose(); c.ring.material.dispose(); this.crates.delete(c.id); }
  /** zwraca id paczki w zasięgu (tylko wylądowane) */
  touch(x, z, r, y = 0) {
    for (const c of this.crates.values()) if (c.landed && !c.dying && Math.abs(c.gh - y) < 3.5 && Math.hypot(c.x - x, c.z - z) < r) return c;
    return null;
  }

  /* ---------- pociski ---------- */
  shoot(x, z, yaw, vx, vz, owner) {
    const mesh = new THREE.Mesh(this.shotGeo, this.shotMat);
    this.parent.add(mesh);
    const dx = Math.cos(yaw), dz = Math.sin(yaw);
    const s = { x: x + dx * 3.4, z: z + dz * 3.4, vx: dx * 120 + vx * 0.5, vz: dz * 120 + vz * 0.5, yaw, life: 1.15, mesh, owner };
    this.shots.push(s);
    if (this.particles) { const c = new THREE.Color(1, 0.8, 0.35); for (let i = 0; i < 8; i++) this.particles.emit(s.x, 0.9, s.z, dx * (6 + Math.random() * 10) + (Math.random() - 0.5) * 4, Math.random() * 2, dz * (6 + Math.random() * 10) + (Math.random() - 0.5) * 4, 0.25, 0.7, 0.1, c, 1, 2); }
    return s;
  }
  killShot(s) { s.life = -1; }

  /* ---------- olej ---------- */
  dropOil(x, z, owner) {
    const mesh = new THREE.Mesh(this.oilGeo, this.oilMat.clone());
    const rx = 4.8 + Math.random() * 0.8, rz = 4.2 + Math.random() * 0.8;
    mesh.position.set(x, 0.06, z); mesh.rotation.y = Math.random() * 6.28; mesh.scale.set(0.01, 1, 0.01);
    mesh.receiveShadow = true;
    this.parent.add(mesh);
    this.oils.push({ x, z, r: 4.4, rx, rz, mesh, age: 0, life: 14, owner });
  }
  inOil(x, z) {
    for (const o of this.oils) if (o.age > 0.15 && Math.hypot(o.x - x, o.z - z) < o.r) return true;
    return false;
  }

  update(dt, track) {
    this.t += dt;
    for (const c of [...this.crates.values()]) {
      c.age += dt;
      if (c.dying) {
        const k = 1 - c.dying * c.age * 3.5; c.mesh.scale.setScalar(Math.max(0.001, k)); c.beam.material.opacity *= 0.8; c.ring.material.opacity *= 0.7;
        if (k <= 0) this._free(c);
        continue;
      }
      if (!c.landed) {
        c.vy -= 42 * dt; c.y += c.vy * dt;
        const h = clampH(c.y - c.gh);
        c.ring.scale.setScalar(1.6 - 0.6 * (1 - h)); c.ring.material.opacity = 0.35 + 0.5 * (1 - h);
        if (c.y <= c.gh + 1.0) { c.y = c.gh + 1.0; c.landed = true; c.age = 0; c.landT = this.t; this._thud?.(c.x, c.z); if (this.particles) { const dc = new THREE.Color(0.8, 0.78, 0.72); for (let i = 0; i < 10; i++) { const a = Math.random() * 6.28, s = 2 + Math.random() * 4; this.particles.emit(c.x, 0.3, c.z, Math.cos(a) * s, 0.6, Math.sin(a) * s, 0.7, 0.8, 2.4, dc, 0.4, 2); } } }
        c.mesh.position.y = c.y; c.mesh.rotation.y += dt * 2.2;
      } else {
        c.mesh.position.y = c.gh + 1.15 + Math.sin(this.t * 3 + c.x) * 0.18;
        c.mesh.rotation.y += dt * 1.6;
        c.ring.scale.setScalar(1 + Math.sin(this.t * 4) * 0.06); c.ring.material.opacity = 0.7;
        c.beam.material.opacity = 0.2 + Math.sin(this.t * 5) * 0.05;
      }
    }
    for (const s of this.shots) {
      s.life -= dt;
      s.x += s.vx * dt; s.z += s.vz * dt;
      if (track && s.life > 0 && Math.abs(track.query(s.x, s.z, -1).d) > BARRIER) s.life = 0;
      s.mesh.position.set(s.x, (this.ground ? this.ground(s.x, s.z) : 0) + 0.9, s.z); s.mesh.rotation.y = -s.yaw;
      if (this.particles && s.life > 0) { const c = new THREE.Color(1, 0.7 + Math.random() * 0.2, 0.3); this.particles.emit(s.x - s.vx * 0.012, 0.9, s.z - s.vz * 0.012, 0, 0.2, 0, 0.3, 0.8, 0.1, c, 0.8, 3); }
    }
    this._bombsRockets(dt);
    this.shots = this.shots.filter((s) => { if (s.life <= 0) { this.parent.remove(s.mesh); return false; } return true; });
    for (const o of this.oils) {
      o.age += dt;
      o.mesh.position.y = (this.ground ? this.ground(o.x, o.z) : 0) + 0.06;
      const g = Math.min(1, o.age / 0.35); const e = 1 - (1 - g) * (1 - g);
      o.mesh.scale.set(o.rx * e, 1, o.rz * e);
      if (o.age > o.life - 2) o.mesh.material.opacity = 0.94 * Math.max(0, (o.life - o.age) / 2);
    }
    this.oils = this.oils.filter((o) => { if (o.age >= o.life) { this.parent.remove(o.mesh); o.mesh.material.dispose(); return false; } return true; });
  }

  /* ---------- bomby i rakiety (arena) ---------- */
  dropBomb(id, x, z, owner, gh) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), new THREE.MeshStandardMaterial({ color: 0x1d1d22, metalness: 0.6, roughness: 0.35 }));
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 3 }));
    light.position.y = 0.78; g.add(body, light);
    const gy = gh !== undefined ? gh : this.ground ? this.ground(x, z) : 0;
    g.position.set(x, gy + 0.75, z); body.castShadow = true;
    this.parent.add(g);
    const b = { id, x, z, mesh: g, light, age: 0, owner, dead: false, gh };
    this.bombs.push(b); return b;
  }
  removeBomb(id) { const b = this.bombs.find((q) => q.id === id); if (b) b.dead = true; return b; }
  launchRocket(id, x, z, yaw, owner, target) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.5, 4, 10), new THREE.MeshStandardMaterial({ color: 0xe9e9ef, metalness: 0.5, roughness: 0.3 }));
    body.rotation.z = Math.PI / 2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 10), new THREE.MeshStandardMaterial({ color: 0xff3d3d, roughness: 0.4 })); tip.rotation.z = -Math.PI / 2; tip.position.x = 1.35;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.1, 8), new THREE.MeshBasicMaterial({ color: 0xffb02e })); flame.rotation.z = Math.PI / 2; flame.position.x = -1.45;
    g.add(body, tip, flame);
    this.parent.add(g);
    const r = { id, x, z, yaw, owner, target, mesh: g, life: 4, speed: 22, dead: false };
    this.rockets.push(r); return r;
  }
  _bombsRockets(dt) {
    const gr = (x, z) => (this.ground ? this.ground(x, z) : 0);
    for (const b of this.bombs) {
      b.age += dt;
      b.mesh.position.y = (b.gh !== undefined ? b.gh : gr(b.x, b.z)) + 0.75;
      b.light.material.emissiveIntensity = b.age > 0.8 ? (Math.sin(b.age * (6 + b.age * 0.4)) > 0 ? 4 : 0.3) : 1;
    }
    this.bombs = this.bombs.filter((b) => { if (b.dead) { this.parent.remove(b.mesh); return false; } return true; });
    for (const r of this.rockets) {
      r.life -= dt; r.speed = Math.min(66, r.speed + 70 * dt);
      const t = r.target?.();
      if (t) {
        let d = Math.atan2(t.z - r.z, t.x - r.x) - r.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        r.yaw += Math.max(-2.3 * dt, Math.min(2.3 * dt, d));
      }
      r.x += Math.cos(r.yaw) * r.speed * dt; r.z += Math.sin(r.yaw) * r.speed * dt;
      const h = gr(r.x, r.z) + 1.3;
      r.mesh.position.set(r.x, h, r.z); r.mesh.rotation.y = -r.yaw;
      if (this.particles) {
        const c = new THREE.Color(1, 0.55 + Math.random() * 0.3, 0.2); this.particles.emit(r.x - Math.cos(r.yaw) * 1.8, 1.3, r.z - Math.sin(r.yaw) * 1.8, 0, 0.3, 0, 0.45, 1.3, 0.2, c, 0.9, 1);
        const g = new THREE.Color(0.7, 0.7, 0.72); this.particles.emit(r.x - Math.cos(r.yaw) * 2.4, 1.3, r.z - Math.sin(r.yaw) * 2.4, (Math.random() - 0.5) * 0.8, 0.5, (Math.random() - 0.5) * 0.8, 0.9, 0.7, 2.2, g, 0.4, 1);
      }
      if (r.life <= 0) r.dead = true;
    }
    this.rockets = this.rockets.filter((r) => { if (r.dead) { this.parent.remove(r.mesh); return false; } return true; });
  }

  clear() {
    for (const c of [...this.crates.values()]) this._free(c);
    for (const s of this.shots) this.parent.remove(s.mesh);
    for (const o of this.oils) { this.parent.remove(o.mesh); o.mesh.material.dispose(); }
    for (const b of this.bombs) this.parent.remove(b.mesh);
    for (const r of this.rockets) this.parent.remove(r.mesh);
    this.shots = []; this.oils = []; this.bombs = []; this.rockets = [];
  }
}
const clampH = (y) => Math.min(1, Math.max(0, y / 34));
