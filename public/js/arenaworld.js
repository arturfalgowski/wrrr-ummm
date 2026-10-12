// Wizualizacja areny: teren z wysokościami (rampy, górki, doły), bariera, słupy, oświetlenie.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ARENA_R, heightAt, rampMask, OBSTACLES, SPAWNS, PLATFORM, field } from './arena.js';

const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function noiseTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) { g.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${0.05 + Math.random() * 0.1})` : `rgba(0,0,0,${0.05 + Math.random() * 0.12})`; const s = 1 + Math.random() * 2.5; g.fillRect(Math.random() * 256, Math.random() * 256, s, s * (1 + Math.random() * 2)); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 60); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function stripeTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = '#e9e2d6'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#f2b61e'; g.fillRect(0, 0, 256, 18);
  g.fillStyle = '#17171d';
  for (let x = -64; x < 300; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 16, 0); g.lineTo(x + 16 - 18, 18); g.lineTo(x - 18, 18); g.closePath(); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(36, 1); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export function buildArenaWorld(scene, renderer) {
  const root = new THREE.Group(); scene.add(root);
  const world = { time: { value: 0 }, root, field, isArena: true };
  if (!scene.environment) {
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.42;
  }
  world.sky = new THREE.Color(0xf0b68a);
  root.add(new THREE.HemisphereLight(0xffe2c4, 0x7a5a48, 0.95));
  const sun = new THREE.DirectionalLight(0xffc58a, 3.4);
  sun.position.set(-90, 95, 85); sun.target.position.set(0, 0, 0);
  sun.castShadow = true; const sm = Math.min(4096, renderer.capabilities.maxTextureSize); sun.shadow.mapSize.set(sm, sm);
  Object.assign(sun.shadow.camera, { left: -118, right: 118, top: 118, bottom: -118, near: 20, far: 380 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
  root.add(sun, sun.target);

  // ---- daleka płaszczyzna ----
  const far = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0xb98d5f, roughness: 1 }));
  far.rotation.x = -Math.PI / 2; far.position.y = -0.4; far.receiveShadow = true; root.add(far);

  // ---- teren ----
  const SIZE = (ARENA_R + 22) * 2, SEG = 190;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  const sand = new THREE.Color('#c79a63'), dirt = new THREE.Color('#8f6038'), pit = new THREE.Color('#e0bc86'), pitDeep = new THREE.Color('#9b7448'), ramp = new THREE.Color('#f0ac22'), plat = new THREE.Color('#a8a29a');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = heightAt(x, z);
    pos.setY(i, h);
    const dx = heightAt(x + 0.6, z) - heightAt(x - 0.6, z), dz = heightAt(x, z + 0.6) - heightAt(x, z - 0.6), slope = Math.hypot(dx, dz) / 1.2;
    c.copy(sand).lerp(dirt, smooth(0.15, 0.7, slope));
    if (h < -0.4) c.lerp(pit, smooth(-0.4, -2, h)).lerp(pitDeep, smooth(-3, -5.2, h));
    const r = Math.hypot(x, z);
    if (r < PLATFORM.r + 1.5 && h > PLATFORM.H * 0.75) c.lerp(plat, 0.9);
    if (rampMask(x, z)) c.lerp(ramp, 0.92);
    const n = hash(Math.round(x * 3), Math.round(z * 3)); c.multiplyScalar(0.9 + n * 0.2);
    if (r > ARENA_R) c.multiplyScalar(0.8);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: noiseTex(), roughness: 0.96 }));
  terrain.receiveShadow = true; terrain.castShadow = true; root.add(terrain);

  // ---- bariera ----
  const stripes = stripeTex();
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_R + 1.3, ARENA_R + 1.3, 4.2, 128, 1, true), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.8, side: THREE.DoubleSide }));
  wall.position.y = 2.1; wall.castShadow = true; wall.receiveShadow = true; root.add(wall);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(ARENA_R + 1.3, 0.45, 8, 160), new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 0.5, roughness: 0.5 }));
  rim.rotation.x = Math.PI / 2; rim.position.y = 4.3; root.add(rim);

  // ---- słupy-osłony ----
  const pm = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.75 });
  const pillarGeo = new THREE.CylinderGeometry(1, 1, 4.6, 20);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xcbc3b8, roughness: 0.8 });
  for (const [x, z, r] of OBSTACLES) {
    const p = new THREE.Mesh(pillarGeo, pillarMat); p.scale.set(r, 1, r); p.position.set(x, heightAt(x, z) + 2.3, z); p.castShadow = true; p.receiveShadow = true; root.add(p);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.04, r + 0.04, 1, 20, 1, true), pm); band.position.set(x, heightAt(x, z) + 3.6, z); band.material.map.repeat.set(8, 1); root.add(band);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r, 0.5, 16), new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 0.6 })); top.position.set(x, heightAt(x, z) + 4.85, z); root.add(top);
  }

  // ---- znaczniki pól startowych ----
  for (const [x, z, yaw] of SPAWNS) {
    const m = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.9, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, heightAt(x, z) + 0.05, z); root.add(m);
  }

  // ---- reflektory poza areną i skały ----
  for (const deg of [45, 135, 225, 315]) {
    const a = (deg * Math.PI) / 180, px = Math.cos(a) * (ARENA_R + 8), pz = Math.sin(a) * (ARENA_R + 8);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 20, 8), new THREE.MeshStandardMaterial({ color: 0x8b8f99, metalness: 0.5, roughness: 0.5 }));
    pole.position.set(px, 10, pz); pole.castShadow = true; root.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(5, 1.4, 2.2), new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffe0a0, emissiveIntensity: 2.2 }));
    head.position.set(px, 20.4, pz); head.lookAt(0, 8, 0); root.add(head);
  }
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xa57d58, flatShading: true, roughness: 0.95 }), 70);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, r = ARENA_R + 14 + Math.random() * 70, s = 1.5 + Math.random() * 5;
    q.setFromEuler(e.set(Math.random(), Math.random() * 6, Math.random()));
    rocks.setMatrixAt(i, m4.compose(v3.set(Math.cos(a) * r, s * 0.4, Math.sin(a) * r), q, s3.set(s * 1.2, s * 0.8, s)));
  }
  rocks.castShadow = true; rocks.receiveShadow = true; root.add(rocks);

  world.tires = { update() {}, collide() { return 0; }, reset() {} };
  world.update = (t) => { world.time.value = t; };
  return world;
}
