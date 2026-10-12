// Efekty: cząsteczki (dym z opon, kurz, iskry — własny shader GLSL) oraz ślady opon.
import * as THREE from 'three';

const VERT = /* glsl */`
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
  uniform float uScale;
  varying float vA; varying vec3 vC;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, aSize * uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
    vA = aAlpha; vC = aColor;
  }`;
const FRAG = /* glsl */`
  varying float vA; varying vec3 vC;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.12, d) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vC, a);
  }`;

export class Particles {
  constructor(scene, max = 900) {
    this.max = max; this.cursor = 0; this.ground = null;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.age = new Float32Array(max).fill(1e9);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max); this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.uniforms = { uScale: { value: 800 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, s0, s1, color, a0 = 0.5, drag = 1.5, grav = 0) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    if (this.ground) y += this.ground(x, z);
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life; this.age[i] = 0; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0; this.drag[i] = drag; this.grav[i] = grav;
  }

  update(dt, camera, viewH) {
    this.uniforms.uScale.value = viewH * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; continue; }
      this.age[i] += dt;
      const t = Math.min(1, this.age[i] / this.life[i]);
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const gy = (this.ground ? this.ground(this.pos[i * 3], this.pos[i * 3 + 2]) : 0) + 0.05;
      if (this.pos[i * 3 + 1] < gy) { this.pos[i * 3 + 1] = gy; this.vel[i * 3 + 1] = 0; }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.alpha[i] = this.a0[i] * (1 - t) * (1 - t);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = a.aColor.needsUpdate = true;
  }

  clear() { this.age.fill(1e9); this.alpha.fill(0); }
}

export class SkidMarks {
  constructor(scene, max = 3000) {
    this.max = max; this.cursor = 0;
    this.pos = new Float32Array(max * 12);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) { const v = i * 4; idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x0b0a10, transparent: true, opacity: 0.34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.last = new Map();
  }
  /** key: identyfikator koła; null przerywa ślad */
  add(key, x, z, on, width = 0.34) {
    const prev = this.last.get(key);
    if (!on) { this.last.delete(key); return; }
    if (prev) {
      const dx = x - prev.x, dz = z - prev.z, l = Math.hypot(dx, dz);
      if (l < 0.35) return;
      if (l > 6) { this.last.set(key, { x, z }); return; }
      const nx = -dz / l * width, nz = dx / l * width;
      const y = 0.05, i = this.cursor * 12;
      this.pos.set([prev.x + nx, y, prev.z + nz, prev.x - nx, y, prev.z - nz, x - nx, y, z - nz, x + nx, y, z + nz], i);
      this.cursor = (this.cursor + 1) % this.max;
      this.mesh.geometry.attributes.position.needsUpdate = true;
    }
    this.last.set(key, { x, z });
  }
  clear() { this.pos.fill(0); this.mesh.geometry.attributes.position.needsUpdate = true; this.last.clear(); }
}
