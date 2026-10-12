// Wizualizacja boiska: zielona murawa z pasami, linie, bandy, bramki z siatką, trybuny, piłka.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HX, HZ, GW, GD, GH, BR, TEAM_COLORS } from './soccer.js';

function pitchTex() {
  const PPM = 12, W = (HX * 2) * PPM, H = (HZ * 2) * PPM;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const bands = 14, bw = W / bands;
  for (let i = 0; i < bands; i++) { g.fillStyle = i % 2 ? '#3f9a45' : '#48a64e'; g.fillRect(i * bw, 0, bw + 1, H); }
  for (let i = 0; i < 2600; i++) { g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,40,0,0.04)'; g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 6, 1 + Math.random() * 3); }
  const X = (x) => (x + HX) * PPM, Z = (z) => (z + HZ) * PPM;
  g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 0.38 * PPM; g.lineJoin = 'round';
  g.strokeRect(X(-HX) + g.lineWidth / 2, Z(-HZ) + g.lineWidth / 2, HX * 2 * PPM - g.lineWidth, HZ * 2 * PPM - g.lineWidth);
  g.beginPath(); g.moveTo(X(0), Z(-HZ)); g.lineTo(X(0), Z(HZ)); g.stroke();
  g.beginPath(); g.arc(X(0), Z(0), 9 * PPM, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(X(0), Z(0), 0.7 * PPM, 0, Math.PI * 2); g.fill();
  for (const s of [-1, 1]) {
    const bx = (d) => X(s * (HX - d));
    // pole karne i bramkowe
    for (const [depth, half] of [[16, 22], [6, 13]]) {
      g.beginPath(); g.moveTo(bx(0), Z(-half)); g.lineTo(bx(depth), Z(-half)); g.lineTo(bx(depth), Z(half)); g.lineTo(bx(0), Z(half)); g.stroke();
    }
    g.beginPath(); g.arc(bx(11), Z(0), 0.6 * PPM, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(bx(11), Z(0), 9 * PPM, s > 0 ? Math.PI - 0.93 : -0.93, s > 0 ? Math.PI + 0.93 : 0.93); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function netTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 4;
  for (let i = 0; i <= 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function ballTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = '#f5f5f7'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#16161c';
  const pts = [[32, 32], [96, 90], [160, 30], [224, 92], [128, 64], [20, 110], [236, 20]];
  for (const [x, y] of pts) { g.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * 15, y + Math.sin(a) * 15); } g.closePath(); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function buildSoccerWorld(scene, renderer) {
  const root = new THREE.Group(); scene.add(root);
  const world = { time: { value: 0 }, root, isSoccer: true };
  if (!scene.environment) {
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.42;
  }
  world.sky = new THREE.Color(0x8fc5f0);
  const hemi = new THREE.HemisphereLight(0xd8ecff, 0x4a6a3a, 1.05); root.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 3.1);
  sun.position.set(-70, 120, 80); sun.target.position.set(0, 0, 0);
  sun.castShadow = true; const sm = Math.min(2048, renderer.capabilities.maxTextureSize); sun.shadow.mapSize.set(sm, sm);
  Object.assign(sun.shadow.camera, { left: -105, right: 105, top: 75, bottom: -75, near: 20, far: 380 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
  root.add(sun, sun.target);
  world.env = { sun, hemi, baseSky: new THREE.Color(0x8fc5f0), sunBase: { color: new THREE.Color(0xfff0d0), intensity: 3.1 }, hemiBase: { sky: new THREE.Color(0xd8ecff), ground: new THREE.Color(0x4a6a3a), intensity: 1.05 } };

  // ---- podłoże ----
  const far = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x2f5e34, roughness: 1 }));
  far.rotation.x = -Math.PI / 2; far.position.y = -0.3; far.receiveShadow = true; root.add(far);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry((HX + GD + 26) * 2, (HZ + 26) * 2), new THREE.MeshStandardMaterial({ color: 0x3a7a40, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.04; apron.receiveShadow = true; root.add(apron);
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), new THREE.MeshStandardMaterial({ map: pitchTex(), roughness: 0.95 }));
  pitch.rotation.x = -Math.PI / 2; pitch.position.y = 0.0; pitch.receiveShadow = true; root.add(pitch);
  for (const s of [-1, 1]) { // podłoga bramki
    const gf = new THREE.Mesh(new THREE.PlaneGeometry(GD, GW * 2), new THREE.MeshStandardMaterial({ color: 0x2d7a36, roughness: 1 }));
    gf.rotation.x = -Math.PI / 2; gf.position.set(s * (HX + GD / 2), 0.01, 0); gf.receiveShadow = true; root.add(gf);
  }

  // ---- bandy ----
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b3140, roughness: 0.7 });
  const lipMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f5, roughness: 0.6 });
  const box = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; root.add(m); return m; };
  for (const s of [-1, 1]) {
    box(HX * 2 + 2, 1.7, 0.9, 0, 0.85, s * (HZ + 0.45), wallMat); box(HX * 2 + 2, 0.18, 1.0, 0, 1.78, s * (HZ + 0.45), lipMat);
    const segLen = HZ - GW; // końcowe bandy po obu stronach bramki
    for (const t of [-1, 1]) {
      box(0.9, 1.7, segLen, s * (HX + 0.45), 0.85, t * (GW + segLen / 2), wallMat); box(1.0, 0.18, segLen, s * (HX + 0.45), 1.78, t * (GW + segLen / 2), lipMat);
    }
  }

  // ---- bramki ----
  const netT = netTex();
  for (const s of [-1, 1]) {
    const col = s > 0 ? TEAM_COLORS.blue : TEAM_COLORS.red; // kolor broniącej drużyny
    const frame = new THREE.MeshStandardMaterial({ color: 0xf4f4f7, roughness: 0.4, metalness: 0.2 });
    const glow = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9, roughness: 0.5 });
    for (const t of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, GH, 12), frame); p.position.set(s * HX, GH / 2, t * GW); p.castShadow = true; root.add(p);
      const p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, GH, 12), frame); p2.position.set(s * (HX + GD), GH / 2, t * GW); root.add(p2);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, GD, 10), frame); rail.rotation.z = Math.PI / 2; rail.position.set(s * (HX + GD / 2), GH, t * GW); root.add(rail);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, GW * 2, 12), frame); bar.rotation.x = Math.PI / 2; bar.position.set(s * HX, GH, 0); bar.castShadow = true; root.add(bar);
    const bar2 = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, GW * 2, 12), frame); bar2.rotation.x = Math.PI / 2; bar2.position.set(s * (HX + GD), GH, 0); root.add(bar2);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, GW * 2), glow); strip.position.set(s * (HX + GD + 0.3), GH + 0.5, 0); root.add(strip);
    const netMat = () => new THREE.MeshBasicMaterial({ map: netT.clone(), transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.05 });
    const mk = (w, h, setup) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), netMat()); m.material.map.needsUpdate = true; m.material.map.repeat.set(w / 2.2, h / 2.2); setup(m); root.add(m); };
    mk(GW * 2, GH, (m) => { m.rotation.y = Math.PI / 2; m.position.set(s * (HX + GD), GH / 2, 0); });             // tył
    mk(GD, GH, (m) => { m.position.set(s * (HX + GD / 2), GH / 2, GW); }); mk(GD, GH, (m) => { m.position.set(s * (HX + GD / 2), GH / 2, -GW); }); // boki
    mk(GD, GW * 2, (m) => { m.rotation.x = Math.PI / 2; m.rotation.z = Math.PI / 2; m.position.set(s * (HX + GD / 2), GH, 0); }); // dach
  }

  // ---- trybuny ----
  const rows = 5, standMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4d, roughness: 0.9 });
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1.3, 0.9), new THREE.MeshStandardMaterial({ roughness: 0.9 }), 900);
  const m4 = new THREE.Matrix4(), col = new THREE.Color(); let ci = 0;
  const palette = ['#e53935', '#2f6bff', '#f2f2f5', '#ffc21a', '#2fbf71', '#ff7a1a', '#8a5cf0'];
  for (const sd of [-1, 1]) {
    for (let r = 0; r < rows; r++) {
      const z = sd * (HZ + 5 + r * 2.2), y = 1.2 + r * 1.2;
      const step = new THREE.Mesh(new THREE.BoxGeometry(HX * 2 + 6, 1.2 + r * 1.2, 2.2), standMat); step.position.set(0, (1.2 + r * 1.2) / 2 - 0.05, z); step.receiveShadow = true; step.castShadow = true; root.add(step);
      for (let x = -HX; x <= HX && ci < 900; x += 2.1) {
        if (Math.random() < 0.18) continue;
        m4.makeTranslation(x + Math.random() * 0.5, y + 0.65, z); crowd.setMatrixAt(ci, m4);
        crowd.setColorAt(ci, col.set(palette[Math.random() * palette.length | 0])); ci++;
      }
    }
  }
  crowd.count = ci; crowd.instanceColor.needsUpdate = true; root.add(crowd);

  // ---- reflektory ----
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const px = sx * (HX + 14), pz = sz * (HZ + 20);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 24, 8), new THREE.MeshStandardMaterial({ color: 0x8b8f99, metalness: 0.5, roughness: 0.5 }));
    pole.position.set(px, 12, pz); pole.castShadow = true; root.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(5, 1.4, 2.2), new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffe0a0, emissiveIntensity: 2.2 }));
    head.position.set(px, 24.4, pz); head.lookAt(0, 8, 0); root.add(head);
  }

  // ---- piłka ----
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BR, 32, 20), new THREE.MeshStandardMaterial({ map: ballTex(), roughness: 0.45, metalness: 0.05 }));
  ball.castShadow = true; ball.receiveShadow = false; root.add(ball);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(BR * 1.1, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.06; root.add(blob);
  world.ball = ball;
  world.setBall = (b) => {
    ball.position.set(b.rx, b.ry, b.rz);
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0.3) { ball.rotation.y = Math.atan2(-b.vz, b.vx); ball.rotation.z = -b.spin; }
    blob.position.set(b.rx, 0.06, b.rz); const k = Math.max(0.45, 1 - (b.ry - BR) / 16); blob.scale.setScalar(k); blob.material.opacity = 0.3 * k;
  };

  world.tires = { update() {}, collide() { return 0; }, reset() {} };
  world.update = (t) => { world.time.value = t; };
  return world;
}
