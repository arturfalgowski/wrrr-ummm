// Proceduralne modele samochodów: wyciągnięty profil boczny (wygładzony) + własny shader farby/pasów.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_DEFS } from './physics.js';

const MODELS = {
  aurora: {
    L: 5.2, W: 1.95, wheelX: 1.62, wheelZ: 1.2, wheelR: 0.54,
    body: [[-2.6, 0.38], [-2.64, 0.82], [-2.25, 1.02], [-1.0, 1.08], [0.35, 1.12], [0.9, 1.04], [1.7, 0.9], [2.4, 0.7], [2.64, 0.5], [2.6, 0.36], [1.3, 0.3], [-1.3, 0.3]],
    cabin: null, open: true, spoiler: false, decalX: 1.5, number: 7,
  },
  vortex: {
    L: 5.5, W: 2.05, wheelX: 1.75, wheelZ: 1.24, wheelR: 0.52,
    body: [[-2.75, 0.38], [-2.78, 0.86], [-2.4, 1.0], [-1.4, 1.04], [0.0, 1.02], [1.2, 0.95], [2.4, 0.72], [2.76, 0.5], [2.72, 0.36], [1.2, 0.3], [-1.2, 0.3]],
    cabin: [[-1.75, 0.98], [-0.95, 1.55], [-0.15, 1.66], [0.55, 1.5], [1.05, 1.0]], open: false, spoiler: true, decalX: -0.2, number: 33,
  },
  blaze: {
    L: 4.7, W: 1.9, wheelX: 1.45, wheelZ: 1.17, wheelR: 0.5,
    body: [[-2.35, 0.4], [-2.35, 1.0], [-1.95, 1.2], [-0.5, 1.2], [0.9, 1.02], [1.95, 0.84], [2.32, 0.6], [2.3, 0.4], [1.0, 0.32], [-1.0, 0.32]],
    cabin: [[-1.8, 1.14], [-1.3, 1.72], [0.0, 1.8], [0.7, 1.46], [1.1, 1.04]], open: false, spoiler: true, decalX: -0.3, number: 23,
  },
};

function chaikin(pts, iter) {
  let p = pts;
  for (let k = 0; k < iter; k++) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = out;
  }
  return p;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function extrudeProfile(profile, width, L, bevel = 0.16, shrinkTop = 0.08) {
  const pts = chaikin(profile, 3);
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const depth = Math.max(0.05, width - 2 * bevel);
  let g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 3, curveSegments: 1, steps: 1 });
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-3);
  g.translate(0, 0, -depth / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const t = Math.abs(x) / (L / 2);
    const front = x > 0 ? 0.3 : 0.16;
    const taper = 1 - front * smooth(0.25, 1, t) ** 1.4 - shrinkTop * Math.max(0, y - 0.3);
    pos.setZ(i, pos.getZ(i) * taper);
  }
  g.computeVertexNormals();
  return g;
}

/** Materiał lakieru z własnym GLSL: pasy wyścigowe oraz lakier dachu na szybie. */
function paintMaterial({ paint, stripe, glass = false, roof = false }) {
  const m = new THREE.MeshPhysicalMaterial({
    color: glass ? 0x0d121b : paint, metalness: glass ? 0.8 : 0.45, roughness: glass ? 0.1 : 0.26,
    clearcoat: 1, clearcoatRoughness: 0.06,
  });
  const key = `paint-${glass}-${roof}-${!!stripe}`;
  m.customProgramCacheKey = () => key;
  m.userData.paint = paint; m.userData.stripe = stripe || paint;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPaint = { value: new THREE.Color(m.userData.paint) };
    sh.uniforms.uStripe = { value: new THREE.Color(m.userData.stripe) };
    m.userData.u = sh.uniforms;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP;\nvarying vec3 vON;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;\nvON = normal;');
    const stripeCode = stripe ? `
      float az = abs(vOP.z);
      float band = step(0.0, az) * (1.0 - step(0.30, az)) + step(0.42, az) * (1.0 - step(0.52, az));
      diffuseColor.rgb = mix(diffuseColor.rgb, uStripe, band * ${roof ? 'roofM' : '1.0'});` : '';
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP;\nvarying vec3 vON;\nuniform vec3 uPaint;\nuniform vec3 uStripe;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float roofM = ${roof ? 'smoothstep(0.78, 0.9, normalize(vON).y)' : '1.0'};
        ${roof ? 'diffuseColor.rgb = mix(diffuseColor.rgb, uPaint, roofM);' : ''}
        ${stripeCode}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        ${roof ? 'roughnessFactor = mix(roughnessFactor, 0.26, roofM);' : ''}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        ${roof ? 'metalnessFactor = mix(metalnessFactor, 0.45, roofM);' : ''}`);
  };
  return m;
}

function numberTexture(n, bg = '#ffffff', fg = '#14141c') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.beginPath(); x.arc(64, 64, 58, 0, Math.PI * 2); x.fill();
  x.fillStyle = fg; x.font = '800 74px system-ui, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const tireMat = new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.85 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xd9dde6, metalness: 0.9, roughness: 0.25 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.7 });

function makeWheel(R, w) {
  const pivot = new THREE.Group();
  const roll = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(R, R, w, 28), tireMat);
  tire.rotation.x = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.62, R * 0.62, w * 1.02, 20), rimMat);
  rim.rotation.x = Math.PI / 2;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.2, R * 0.2, w * 1.08, 10), darkMat);
  hub.rotation.x = Math.PI / 2;
  roll.add(tire, rim, hub);
  for (let i = 0; i < 5; i++) { // szprychy w kształcie gwiazdy (widoczne z boku)
    const sp = new THREE.Mesh(new THREE.BoxGeometry(R * 1.1, R * 0.12, w * 1.1), darkMat);
    sp.rotation.z = (i / 5) * Math.PI; roll.add(sp);
  }
  [tire, rim].forEach((m) => { m.castShadow = true; });
  pivot.add(roll);
  return { pivot, roll };
}

export function buildCar(id, number, color = null) {
  const def = CAR_DEFS[id];
  const M = MODELS[id];
  const group = new THREE.Group();
  const body = new THREE.Group(); // pochylane (przechył/przysiad)
  group.add(body);

  const paintMats = [];
  const reg = (mat, kind) => { paintMats.push({ mat, kind }); return mat; };
  const paintMat = reg(paintMaterial({ paint: def.color, stripe: def.stripe }), 'body');
  const bodyGeo = extrudeProfile(M.body, M.W, M.L);
  const bodyMesh = new THREE.Mesh(bodyGeo, paintMat);
  bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
  body.add(bodyMesh);
  const pickables = [bodyMesh];
  const dents = [];
  const regDent = (geo) => dents.push({ geo, orig: Float32Array.from(geo.attributes.position.array), nrm: Float32Array.from(geo.attributes.normal.array) });
  regDent(bodyGeo);

  if (M.cabin) {
    const cabMat = reg(paintMaterial({ paint: def.color, stripe: def.stripe, glass: true, roof: true }), 'cabin');
    const cabGeo = extrudeProfile(M.cabin, M.W * 0.76, M.L, 0.14, 0.12);
    const cab = new THREE.Mesh(cabGeo, cabMat);
    cab.castShadow = true;
    body.add(cab); pickables.push(cab); regDent(cabGeo);
  }
  if (M.open) { // kokpit roadstera: fotel, kierowca w kasku, szyba
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 1.0), new THREE.MeshStandardMaterial({ color: 0x241a1c, roughness: 0.8 }));
    seat.position.set(-0.45, 1.1, 0); seat.castShadow = true;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.35, 4, 10), new THREE.MeshStandardMaterial({ color: 0xf2f2f5, roughness: 0.6 }));
    torso.rotation.z = Math.PI / 2 - 0.2; torso.position.set(-0.5, 1.38, 0); torso.castShadow = true;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.33, 18, 14), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.25, clearcoat: 1 }));
    helmet.position.set(-0.3, 1.62, 0); helmet.castShadow = true;
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.335, 14, 10, -0.5, 1.0, 0.9, 0.6), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.1, metalness: 0.8 }));
    visor.rotation.y = Math.PI / 2; visor.position.copy(helmet.position);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 1.5), new THREE.MeshPhysicalMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1 }));
    glass.position.set(0.28, 1.28, 0); glass.rotation.z = -0.55;
    body.add(seat, torso, helmet, visor, glass);
    // pałąk
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.06, 8, 16, Math.PI), paintMaterial({ paint: 0xcfd3dc }));
    hoop.rotation.y = Math.PI / 2; hoop.position.set(-0.95, 1.1, 0);
    body.add(hoop);
  }
  if (M.spoiler) {
    const sp = new THREE.Group();
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, M.W * 1.05), reg(paintMaterial({ paint: def.stripe || 0x222222 }), 'accent'));
    wing.castShadow = true;
    for (const sz of [-0.7, 0.7]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.1), darkMat); post.position.set(0.1, -0.2, sz); sp.add(post); }
    sp.add(wing);
    sp.position.set(-M.L / 2 + 0.2, M.cabin ? 1.52 : 1.5, 0);
    body.add(sp);
  }
  // światła
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffe9a0, emissiveIntensity: 1.8 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x661111, emissive: 0xff1a1a, emissiveIntensity: 0.9 });
  for (const sz of [-0.62, 0.62]) {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), headMat);
    hl.scale.set(0.8, 0.7, 1); hl.position.set(M.L / 2 - 0.14, 0.7, sz);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.42), tailMat);
    tl.position.set(-M.L / 2 + 0.04, 0.82, sz * 0.95);
    body.add(hl, tl);
  }
  // koła
  const wheels = { fl: null, fr: null, rl: null, rr: null };
  const ww = 0.58;
  const spots = { fl: [M.wheelX, M.wheelZ], fr: [M.wheelX, -M.wheelZ], rl: [-M.wheelX, M.wheelZ], rr: [-M.wheelX, -M.wheelZ] };
  for (const k of Object.keys(spots)) {
    const w = makeWheel(M.wheelR, ww);
    w.pivot.position.set(spots[k][0], M.wheelR, spots[k][1]);
    group.add(w.pivot);
    wheels[k] = w;
  }

  // numer startowy rzutowany promieniem na karoserię
  group.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(new THREE.Vector3(M.decalX, 4, 0), new THREE.Vector3(0, -1, 0), 0, 8);
  const hit = rc.intersectObjects(pickables, false)[0];
  if (hit) {
    const nrm = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), new THREE.MeshBasicMaterial({ map: numberTexture(number ?? M.number), transparent: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    const zAxis = nrm;
    const yAxis = new THREE.Vector3(1, 0, 0).sub(zAxis.clone().multiplyScalar(zAxis.x)).normalize();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
    decal.matrixAutoUpdate = false;
    decal.matrix.makeBasis(xAxis, yAxis, zAxis).setPosition(hit.point.clone().addScaledVector(nrm, 0.012));
    // plane domyślnie patrzy +Z, góra tekstu = +Y → obrót tak, by góra liczby wskazywała przód auta
    body.add(decal);
  }

  group.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
  bodyMesh.receiveShadow = true;

  return {
    group, body, wheels, tailMat, def, model: M,
    pitch: 0, roll: 0, spin: 0, hk: 0, hdir: 0, tx: 0, tz: 0, color: null, stripeC: null, dmg: 0,
    /** zmiana koloru lakieru w locie (bez przebudowy modelu) */
    setColor(paint, stripe) {
      if (this.color === paint && this.stripeC === stripe) return;
      this.color = paint; this.stripeC = stripe; this._paint();
    },
    /** lakier przypalony wraz ze zniszczeniami */
    _paint() {
      const dark = new THREE.Color(0x1b1a1d), burn = this.dmg * 0.62;
      const pc = new THREE.Color(this.color).lerp(dark, burn), sc = new THREE.Color(this.stripeC).lerp(dark, burn);
      for (const { mat, kind } of paintMats) {
        const u = mat.userData.u;
        if (kind === 'accent') { mat.color.copy(sc); mat.userData.paint = mat.userData.stripe = '#' + sc.getHexString(); if (u) { u.uPaint.value.copy(sc); u.uStripe.value.copy(sc); } continue; }
        if (kind === 'body') mat.color.copy(pc);
        mat.userData.paint = '#' + pc.getHexString(); mat.userData.stripe = '#' + sc.getHexString();
        if (u) { u.uPaint.value.copy(pc); u.uStripe.value.copy(sc); }
      }
    },
    /** zniszczenia 0..1: wgniecenia karoserii + przypalony lakier */
    setDamage(d) {
      if (Math.abs(d - this.dmg) < 0.012) return;
      this.dmg = d;
      if (this.color) this._paint();
      for (const t of dents) {
        const pos = t.geo.attributes.position, L = M.L;
        for (let i = 0; i < pos.count; i++) {
          const ox = t.orig[i * 3], oy = t.orig[i * 3 + 1], oz = t.orig[i * 3 + 2];
          const n = Math.sin(ox * 2.3 + oy * 1.7 + 0.6) * Math.cos(oz * 2.9 - ox * 1.1);
          const front = 1 + 0.9 * Math.min(1, Math.max(0, (ox - 0.15 * L) / (0.35 * L)));
          const k = d * 0.2 * (0.3 + 0.7 * Math.max(0, n)) * front;
          pos.setXYZ(i, ox - t.nrm[i * 3] * k, oy - t.nrm[i * 3 + 1] * k - d * 0.05 * Math.max(0, (ox / L)), oz - t.nrm[i * 3 + 2] * k);
        }
        pos.needsUpdate = true; t.geo.computeVertexNormals();
      }
    },
    /** Aktualizacja wizualna na podstawie stanu fizycznego. */
    sync(st, dt) {
      group.rotation.order = 'YZX';
      group.position.set(st.x, st.y || 0, st.z);
      this.tx += ((st.tiltX || 0) - this.tx) * Math.min(1, dt * 12 + (dt ? 0 : 1)); this.tz += ((st.tiltZ || 0) - this.tz) * Math.min(1, dt * 12 + (dt ? 0 : 1));
      group.rotation.x = this.tx; group.rotation.z = this.tz;
      // na ręcznym tył auta wyraźnie „wychodzi” w bok (efekt wizualny ponad fizyką)
      if (Math.abs(st.steer) > 0.1) this.hdir = Math.sign(st.steer);
      this.hk += (((st.hand ? 0.24 : 0) * (this.hdir || 1)) - this.hk) * Math.min(1, dt * 9);
      group.rotation.y = -st.yaw + this.hk;
      const sf = Math.min(1, Math.abs(st.vf) / 14);
      const targetRoll = -st.steer * sf * 0.055 - Math.max(-0.1, Math.min(0.1, st.vl * 0.012));
      const targetPitch = Math.max(-0.04, Math.min(0.045, st.accelNow * 0.0018));
      this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8);
      this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 8);
      body.rotation.x = this.roll;
      body.rotation.z = this.pitch;
      body.position.y = Math.sin(performance.now() * 0.05) * (st.onGrass ? 0.04 : 0.004) * Math.min(1, Math.abs(st.vf) / 10);
      const steerAng = -st.steer * 0.42;
      this.spin -= st.vf * dt / M.wheelR;
      for (const k of ['fl', 'fr']) wheels[k].pivot.rotation.y = steerAng;
      for (const k of ['fl', 'fr', 'rl', 'rr']) wheels[k].roll.rotation.z = this.spin;
      tailMat.emissiveIntensity = st.brakeLit ? 3.2 : 0.9;
    },
  };
}
