// Proceduralne modele samochodów: wyciągnięty profil boczny (wygładzony) + własny shader farby/pasów.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_DEFS } from './physics3d.js';

const MODELS = {
  formula: {
    L: 5.2, W: 1.0, wheelX: 1.6, wheelZ: 1.28, wheelR: 0.56, wheelW: 0.7, lightY: 0.52, tailY: 0.7,
    body: [[-2.55, 0.28], [-2.58, 0.64], [-1.7, 0.82], [-0.7, 0.86], [0.3, 0.72], [1.3, 0.5], [2.62, 0.42], [2.62, 0.3], [1.3, 0.25], [-1.3, 0.25]],
    cabin: null, open: false, spoiler: false, decalX: 0.15, plateX: -1.55, number: 88, extras: 'formula',
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
function paintMaterial({ paint, stripe, glass = false, roof = false, pattern = 0 }) {
  const m = new THREE.MeshPhysicalMaterial({
    color: glass ? 0x0d121b : paint, metalness: glass ? 0.8 : 0.45, roughness: glass ? 0.1 : 0.26,
    clearcoat: 1, clearcoatRoughness: 0.06,
  });
  const key = `paint-${glass}-${roof}`;
  m.customProgramCacheKey = () => key;
  m.userData.paint = paint; m.userData.stripe = stripe || paint; m.userData.pattern = pattern;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPaint = { value: new THREE.Color(m.userData.paint) };
    sh.uniforms.uStripe = { value: new THREE.Color(m.userData.stripe) };
    sh.uniforms.uPattern = { value: m.userData.pattern };
    m.userData.u = sh.uniforms;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP;\nvarying vec3 vON;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;\nvON = normal;');
    // wzory lakieru: 0 brak, 1 pasy, 2 płomienie, 3 szachownica
    const patCode = `
      float az = abs(vOP.z);
      float band = step(0.0, az) * (1.0 - step(0.30, az)) + step(0.42, az) * (1.0 - step(0.52, az));
      float mask = 0.0;
      if (uPattern > 0.5 && uPattern < 1.5) mask = band;
      else if (uPattern > 1.5 && uPattern < 2.5) { float uu = (vOP.x + 2.8) / 5.6; float edge = 0.5 + 0.2 * sin(az * 8.0 + 0.5) + 0.08 * sin(az * 19.0 + 1.0); mask = step(edge, uu); }
      else if (uPattern > 2.5) { mask = mod(floor(vOP.x * 1.7) + floor(vOP.z * 1.7), 2.0) * step(0.55, normalize(vON).y); }
      diffuseColor.rgb = mix(diffuseColor.rgb, uStripe, mask * ${roof ? 'roofM' : '1.0'});`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP;\nvarying vec3 vON;\nuniform vec3 uPaint;\nuniform vec3 uStripe;\nuniform float uPattern;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float roofM = ${roof ? 'smoothstep(0.78, 0.9, normalize(vON).y)' : '1.0'};
        ${roof ? 'diffuseColor.rgb = mix(diffuseColor.rgb, uPaint, roofM);' : ''}
        ${patCode}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        ${roof ? 'roughnessFactor = mix(roughnessFactor, 0.26, roofM);' : ''}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        ${roof ? 'metalnessFactor = mix(metalnessFactor, 0.45, roofM);' : ''}`);
  };
  return m;
}

const PATTERN_IDX = { none: 0, stripes: 1, flames: 2, checker: 3 };

/** tekstura z możliwością przerysowania (numer startowy / tablica z nickiem) */
function drawableTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.redraw = (...args) => { x.clearRect(0, 0, w, h); draw(x, w, h, ...args); t.needsUpdate = true; };
  return t;
}
const numberTexture = (n) => { const t = drawableTexture(128, 128, (x, w, h, num) => {
  x.fillStyle = '#ffffff'; x.beginPath(); x.arc(64, 64, 58, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#14141c'; x.font = `800 ${String(num).length > 1 ? 70 : 84}px system-ui, Arial`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(num), 64, 70);
}); t.redraw(n); return t; };
const plateTexture = (nick) => { const t = drawableTexture(256, 64, (x, w, h, text) => {
  x.fillStyle = '#f4f2ee'; x.beginPath(); x.roundRect(2, 2, w - 4, h - 4, 10); x.fill();
  x.strokeStyle = '#1b1b24'; x.lineWidth = 4; x.stroke();
  x.fillStyle = '#17171f'; x.font = '800 36px system-ui, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  let size = 36; x.font = `800 ${size}px system-ui, Arial`; while (x.measureText(text).width > w - 28 && size > 14) { size -= 2; x.font = `800 ${size}px system-ui, Arial`; }
  x.fillText(text, w / 2, h / 2 + 2);
}); t.redraw((nick || '').toUpperCase().slice(0, 14)); return t; };

const tireMat = new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.85 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.7 });

function addRim(roll, R, w, style, mat) {
  const disc = (r, len) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 24), mat); m.rotation.x = Math.PI / 2; return m; };
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.2, R * 0.2, w * 1.08, 10), darkMat); hub.rotation.x = Math.PI / 2;
  const add = (m) => { m.castShadow = true; roll.add(m); };
  if (style === 'solid') { add(disc(R * 0.66, w * 1.02)); const cap = disc(R * 0.5, w * 1.06); cap.material = mat; add(cap); roll.add(hub); return; }
  if (style === 'mesh') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.6, R * 0.07, 8, 28), mat); ring.position.z = w * 0.5; const ring2 = ring.clone(); ring2.position.z = -w * 0.5; roll.add(ring, ring2);
    add(disc(R * 0.18, w * 1.06));
    for (let i = 0; i < 12; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(R * 1.2, R * 0.045, w * 1.04), mat); sp.rotation.z = (i / 12) * Math.PI; roll.add(sp); }
    roll.add(hub); return;
  }
  if (style === 'turbine') {
    add(disc(R * 0.62, w * 0.96));
    for (let i = 0; i < 8; i++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(R * 0.6, R * 0.16, w * 1.1), darkMat); bl.position.set(Math.cos((i / 8) * 6.283) * R * 0.34, Math.sin((i / 8) * 6.283) * R * 0.34, 0); bl.rotation.z = (i / 8) * 6.283 + 0.7; roll.add(bl); }
    roll.add(hub); return;
  }
  // star (domyślnie): obręcz + 5 szprych
  add(disc(R * 0.62, w * 1.02)); roll.add(hub);
  for (let i = 0; i < 5; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(R * 1.1, R * 0.12, w * 1.1), darkMat); sp.rotation.z = (i / 5) * Math.PI; roll.add(sp); }
}
function makeWheel(R, w, style, rimM) {
  const pivot = new THREE.Group();
  const roll = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(R, R, w, 28), tireMat);
  tire.rotation.x = Math.PI / 2; tire.castShadow = true;
  roll.add(tire);
  addRim(roll, R, w, style, rimM);
  pivot.add(roll);
  return { pivot, roll };
}

export function buildCar(id, number, color = null, custom = null) {
  const def = CAR_DEFS[id];
  const cust = { num: number ?? MODELS[id].number, pattern: 'stripes', rim: 'star', rimColor: '#d9dde6', plate: true, nick: '', ...(custom || {}) };
  const rimM = new THREE.MeshStandardMaterial({ color: cust.rimColor, metalness: 0.9, roughness: 0.25 });
  const M = MODELS[id];
  const group = new THREE.Group();
  const body = new THREE.Group(); // pochylane (przechył/przysiad)
  group.add(body);

  const paintMats = [];
  const reg = (mat, kind) => { paintMats.push({ mat, kind }); return mat; };
  const paintMat = reg(paintMaterial({ paint: def.color, stripe: def.stripe, pattern: PATTERN_IDX[cust.pattern] ?? 1 }), 'body');
  const bodyGeo = extrudeProfile(M.body, M.W, M.L);
  const bodyMesh = new THREE.Mesh(bodyGeo, paintMat);
  bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
  body.add(bodyMesh);
  const pickables = [bodyMesh];
  const dents = [];
  const regDent = (geo) => dents.push({ geo, orig: Float32Array.from(geo.attributes.position.array), nrm: Float32Array.from(geo.attributes.normal.array) });
  regDent(bodyGeo);

  if (M.cabin) {
    const cabMat = reg(paintMaterial({ paint: def.color, stripe: def.stripe, glass: true, roof: true, pattern: PATTERN_IDX[cust.pattern] ?? 1 }), 'cabin');
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
  const nose = { wing: null, plates: [] }, tail = { wing: null, plates: [], posts: [] }, pods = {}; // elementy nadwozia reagujące na uszkodzenia stref
  if (M.extras === 'formula') {
    const acc = reg(paintMaterial({ paint: def.stripe || 0x222222 }), 'accent');
    const bodyPaint = reg(paintMaterial({ paint: def.color, stripe: def.stripe, pattern: PATTERN_IDX[cust.pattern] ?? 1 }), 'body');
    const box = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; body.add(m); return m; };
    nose.wing = box(0.85, 0.07, 2.7, M.L / 2 - 0.15, 0.3, 0, acc);            // przedni spojler
    for (const sz of [-1.35, 1.35]) { const m = box(0.95, 0.3, 0.06, M.L / 2 - 0.15, 0.42, sz, acc); m.userData.side = sz; nose.plates.push(m); }
    tail.wing = box(0.8, 0.08, 2.0, -M.L / 2 + 0.05, 1.32, 0, acc);           // tylny spojler
    for (const sz of [-1.0, 1.0]) { const m = box(0.9, 0.62, 0.06, -M.L / 2 + 0.05, 1.05, sz, acc); m.userData.side = sz; tail.plates.push(m); }
    for (const sz of [-0.3, 0.3]) tail.posts.push(box(0.14, 0.7, 0.1, -M.L / 2 + 0.25, 0.95, sz, darkMat));
    for (const sz of [-0.74, 0.74]) { pods[sz > 0 ? 'r' : 'l'] = box(1.9, 0.34, 0.5, -0.1, 0.52, sz, bodyPaint); box(0.5, 0.24, 0.52, 0.9, 0.46, sz, darkMat); } // boczne wloty
    box(0.7, 0.55, 0.42, -0.95, 1.12, 0, bodyPaint);                            // airbox
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.25, clearcoat: 1 }));
    helmet.position.set(-0.2, 1.08, 0); helmet.castShadow = true; body.add(helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.305, 14, 10, -0.5, 1.0, 0.9, 0.6), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.1, metalness: 0.8 }));
    visor.rotation.y = Math.PI / 2; visor.position.copy(helmet.position); body.add(visor);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 6, 18, Math.PI), darkMat); halo.rotation.y = Math.PI / 2; halo.rotation.x = 0.1; halo.position.set(0.15, 0.95, 0); body.add(halo);
    for (const [sx, sz] of [[M.wheelX, M.wheelZ], [M.wheelX, -M.wheelZ], [-M.wheelX, M.wheelZ], [-M.wheelX, -M.wheelZ]]) { // wahacze
      const len = Math.abs(sz) - 0.45, arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 6), darkMat);
      arm.rotation.x = Math.PI / 2; arm.position.set(sx, 0.5, Math.sign(sz) * (0.45 + len / 2)); body.add(arm);
    }
  }
  // światła
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffe9a0, emissiveIntensity: 1.8 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x661111, emissive: 0xff1a1a, emissiveIntensity: 0.9 });
  for (const sz of [-0.62, 0.62]) {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), headMat);
    hl.scale.set(0.8, 0.7, 1); hl.position.set(M.L / 2 - 0.14, M.lightY ?? 0.7, sz * (M.extras === 'formula' ? 0.45 : 1));
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.42), tailMat);
    tl.position.set(-M.L / 2 + 0.04, M.tailY ?? 0.82, sz * (M.extras === 'formula' ? 0.35 : 0.95));
    body.add(hl, tl);
  }
  // koła
  const wheels = { fl: null, fr: null, rl: null, rr: null };
  const ww = M.wheelW ?? 0.58;
  const spots = { fl: [M.wheelX, M.wheelZ], fr: [M.wheelX, -M.wheelZ], rl: [-M.wheelX, M.wheelZ], rr: [-M.wheelX, -M.wheelZ] };
  const stubs = {};
  for (const k of Object.keys(spots)) {
    const w = makeWheel(M.wheelR, ww, cust.rim, rimM);
    w.tire = w.roll.children[0]; w.tire.material = tireMat.clone(); // własna opona: ciemnieje przy uszkodzeniu
    w.pivot.position.set(spots[k][0], M.wheelR, spots[k][1]); w.pivot.rotation.order = 'YXZ';
    group.add(w.pivot);
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.34, 8), darkMat); stub.rotation.x = Math.PI / 2; stub.position.set(spots[k][0], M.wheelR, spots[k][1]); stub.visible = false; group.add(stub); stubs[k] = stub;
    wheels[k] = w;
  }
  const WK = ['fl', 'fr', 'rl', 'rr']; // indeksy stref 0..3 (fl/rl = prawa strona, +z)

  // numer startowy i tablica z nickiem rzutowane promieniem na karoserię
  group.updateMatrixWorld(true);
  const numTex = numberTexture(cust.num), plateTex = plateTexture(cust.nick);
  const placeDecal = (x, geo, tex) => {
    const rc = new THREE.Raycaster(new THREE.Vector3(x, 4, 0), new THREE.Vector3(0, -1, 0), 0, 8);
    const hit = rc.intersectObjects(pickables, false)[0];
    if (!hit) return null;
    const nrm = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    const yAxis = new THREE.Vector3(1, 0, 0).sub(nrm.clone().multiplyScalar(nrm.x)).normalize();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, nrm);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeBasis(xAxis, yAxis, nrm).setPosition(hit.point.clone().addScaledVector(nrm, 0.012));
    body.add(mesh); return mesh;
  };
  placeDecal(M.decalX, new THREE.PlaneGeometry(0.95, 0.95), numTex);
  const plateMesh = placeDecal(M.plateX ?? -1.9, new THREE.PlaneGeometry(0.46, 1.5), plateTex);
  if (plateMesh) { // tablica leży poprzecznie do osi auta: obróć o 90°, by tekst biegł wzdłuż szerokości
    plateMesh.matrix.multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2)); plateMesh.visible = !!cust.plate;
  }

  group.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
  bodyMesh.receiveShadow = true;

  return {
    group, body, wheels, tailMat, def, model: M, headMat,
    /** noc: mocniej świecące reflektory */
    setNight(k) { headMat.emissiveIntensity = 1.8 + k * 5; },
    pitch: 0, roll: 0, spin: 0, hk: 0, hdir: 0, tx: 0, tz: 0, color: null, stripeC: null, dmg: 0, cust, pz: [0, 0, 0, 0], partsKey: '', wob: 0, dirt: 0, dirtCol: new THREE.Color(0xb59557), rough: 0,
    /** personalizacja: numer, wzór lakieru, felgi, tablica z nickiem */
    setCustom(c = {}) {
      const n = { ...cust, ...c };
      if (n.num !== cust.num) numTex.redraw(n.num);
      if (n.nick !== cust.nick) plateTex.redraw((n.nick || '').toUpperCase().slice(0, 14));
      if (plateMesh) plateMesh.visible = !!n.plate;
      if (n.pattern !== cust.pattern) for (const { mat, kind } of paintMats) if (kind !== 'accent') { mat.userData.pattern = PATTERN_IDX[n.pattern] ?? 1; if (mat.userData.u) mat.userData.u.uPattern.value = mat.userData.pattern; }
      if (n.rimColor !== cust.rimColor) rimM.color.set(n.rimColor);
      if (n.rim !== cust.rim) for (const k of ['fl', 'fr', 'rl', 'rr']) { const roll = wheels[k].roll; while (roll.children.length > 1) roll.remove(roll.children[roll.children.length - 1]); addRim(roll, M.wheelR, ww, n.rim, rimM); }
      Object.assign(cust, n);
    },
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
    setDamage(d, force = false) {
      if (!force && Math.abs(d - this.dmg) < 0.012) return;
      this.dmg = d;
      if (this.color) this._paint();
      for (const t of dents) {
        const pos = t.geo.attributes.position, L = M.L;
        for (let i = 0; i < pos.count; i++) {
          const ox = t.orig[i * 3], oy = t.orig[i * 3 + 1], oz = t.orig[i * 3 + 2];
          const n = Math.sin(ox * 2.3 + oy * 1.7 + 0.6) * Math.cos(oz * 2.9 - ox * 1.1);
          const front = 1 + 0.9 * Math.min(1, Math.max(0, (ox - 0.15 * L) / (0.35 * L)));
          const pz = this.pz, dd = Math.min(1, d * 0.45 + (oz > 0 ? pz[3] : pz[2]) * 0.7 + (ox > 0 ? pz[0] : pz[1]) * 0.5); // lokalne zniszczenie (bok, dziób/tył)
          const k = dd * 0.2 * (0.3 + 0.7 * Math.max(0, n)) * front;
          pos.setXYZ(i, ox - t.nrm[i * 3] * k, oy - t.nrm[i * 3 + 1] * k - dd * 0.05 * Math.max(0, (ox / L)), oz - t.nrm[i * 3 + 2] * k);
        }
        pos.needsUpdate = true; t.geo.computeVertexNormals();
      }
    },
    /** zabrudzenie opon (0..1) kolorem nawierzchni: piasek robi z opon jasnobrązowe, kostka szare */
    setDirt(k, col) {
      if (Math.abs(k - this.dirt) < 0.03 && (k > 0.02 || this.dirt < 0.02)) return;
      this.dirt = k; if (col) this.dirtCol = col;
      for (const n of WK) if (wheels[n].base) this._dirtApply(wheels[n]);
    },
    _dirtApply(w) { w.tire.material.color.copy(w.base).lerp(this.dirtCol, Math.min(0.85, this.dirt * 0.9)); w.tire.material.roughness = 0.85 + this.dirt * 0.1; },
    /** strefy uszkodzeń (8 liczb 0..1): koła odpadają, spojlery się łamią i odpadają, boki się wgniatają, opony ciemnieją */
    setParts(p) {
      let key = ''; for (let i = 0; i < 8; i++) key += Math.round(p[i] * 15).toString(16);
      if (key === this.partsKey) return; this.partsKey = key;
      for (let i = 0; i < 4; i++) {
        const w = wheels[WK[i]], d = p[i], side = i % 2 === 0 ? 1 : -1, lost = d >= 1;
        w.pivot.visible = !lost; stubs[WK[i]].visible = lost;
        w.pivot.rotation.x = side * d * 0.5; w.pivot.position.y = M.wheelR * (1 - d * 0.16);
        w.roll.scale.set(1 - d * 0.2, 1 - d * 0.2, 1); w.base = new THREE.Color(0.08 * (1 - d * 0.75), 0.08 * (1 - d * 0.75), 0.1 * (1 - d * 0.75)); this._dirtApply(w);
        if (lost) stubs[WK[i]].position.y = M.wheelR * 0.55;
      }
      const dn = p[4], dt = p[5];
      if (nose.wing) {
        nose.wing.visible = dn < 1; nose.wing.rotation.z = -dn * 0.45; nose.wing.position.y = 0.3 - dn * 0.12; nose.wing.scale.z = 1 - dn * 0.3;
        for (const m of nose.plates) { m.visible = dn < (m.userData.side > 0 ? 0.55 : 0.8); m.rotation.x = m.userData.side * dn * 0.4; }
      }
      if (tail.wing) {
        tail.wing.visible = dt < 1; tail.wing.rotation.z = dt * 0.5; tail.wing.rotation.x = dt * 0.28; tail.wing.position.y = 1.32 - dt * 0.12;
        for (const m of tail.plates) { m.visible = dt < (m.userData.side > 0 ? 0.6 : 0.85); m.rotation.x = -m.userData.side * dt * 0.35; }
        for (const m of tail.posts) m.visible = dt < 1;
      }
      for (const k of ['r', 'l']) { const m = pods[k]; if (!m) continue; const dd = p[k === 'r' ? 6 : 7], sg = k === 'r' ? 1 : -1; m.rotation.x = sg * dd * 0.28; m.position.z = sg * (0.74 - dd * 0.12); m.scale.y = 1 - dd * 0.4; m.visible = dd < 1; }
      this.pz = [p[4], p[5], p[7], p[6]]; this.setDamage(this.dmg, true);
    },
    /** Aktualizacja wizualna dla toru 3D: pozycja i orientacja z fizyki (pętle, przechyły, lot), ruch kół i zawieszenia. */
    sync(st, dt) {
      group.position.set(st.x, st.y, st.z);
      group.quaternion.copy(st.quat);
      if (Math.abs(st.steer) > 0.1) this.hdir = Math.sign(st.steer);
      const sf = Math.min(1, Math.abs(st.vf) / 14);
      const targetRoll = -st.steer * sf * 0.045 - Math.max(-0.08, Math.min(0.08, st.vl * 0.01));
      const targetPitch = Math.max(-0.04, Math.min(0.045, st.accelNow * 0.0016));
      this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8);
      this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 8);
      body.rotation.x = this.roll; body.rotation.z = this.pitch;
      body.position.y = Math.sin(performance.now() * 0.05) * 0.004 * Math.min(1, Math.abs(st.vf) / 10) + (this.rough > 0.02 ? (Math.random() - 0.5) * 0.05 * this.rough * Math.min(1, Math.abs(st.vf) / 20) : 0); // kostka trzęsie autem
      const steerAng = -st.steer * 0.36;
      this.spin -= st.vf * dt / M.wheelR;
      for (const k of ['fl', 'fr']) wheels[k].pivot.rotation.y = steerAng;
      for (const k of ['fl', 'fr', 'rl', 'rr']) wheels[k].roll.rotation.z = this.spin;
      tailMat.emissiveIntensity = st.brakeLit ? 3.2 : 0.9;
      // uszkodzone koła chwieją się (im mocniej uszkodzone i szybsze auto, tym bardziej)
      if (this.partsKey !== '' && Math.abs(st.vf) > 3) { this.wob += dt * 38 * Math.min(1, Math.abs(st.vf) / 40); for (let i = 0; i < 4; i++) { const d = st.parts[i]; if (d > 0.25 && d < 1) { const w = wheels[WK[i]]; w.roll.rotation.x = Math.sin(this.wob + i * 1.7) * d * 0.09; } } }
    },
  };
}
