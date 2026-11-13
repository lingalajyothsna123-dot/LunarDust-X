'use strict';
if (typeof THREE === 'undefined') { document.getElementById('lt').textContent = 'Error: Three.js could not be loaded. Check your internet connection (CDN) or put three.min.js in frontend/vendor/.'; document.getElementById('load').classList.add('err'); throw new Error('THREE missing'); }
// LunarDust-X 3D: Three.js world + rover + mission logic. Dust level comes ONLY from the FastAPI /predict endpoint.
const $ = id => document.getElementById(id), clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const API = location.port === '8000' ? location.origin : 'http://127.0.0.1:8000';
const LV = ['Low', 'Medium', 'High'], LK = ['Low Dust', 'Medium Dust', 'High Dust'], MUL = [.35, 1, 2.2];
const TINT = [0xaab8d8, 0xd6c7a1, 0xf0a08f], SC = .75, PLAY = 175;   // SC = world units/s per km/h
const nf = () => new Promise(r => requestAnimationFrame(r));
const step = async (p, t) => { $('lt').textContent = t; $('lb').style.width = p + '%'; await nf(); };
function rng(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
function vn(x, y) { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return hash(i, j) * (1 - u) * (1 - v) + hash(i + 1, j) * u * (1 - v) + hash(i, j + 1) * (1 - u) * v + hash(i + 1, j + 1) * u * v; }
function fbm(x, y) { let a = 1, s = 0, f = 1; for (let i = 0; i < 4; i++) { s += a * vn(x * f, y * f); a *= .5; f *= 2; } return s / 1.9; }

// ---------- terrain height (shared by mesh, rover, particles) ----------
const R = rng(7), CR = [], BIG = [];
for (let i = 0; i < 80; i++) { const r = 3 + R() ** 2 * 28, x = (R() - .5) * 420, z = (R() - .5) * 420; if (Math.hypot(x, z) > r + 12) CR.push({ x, z, r }); }
function H(x, z) {
  const q = Math.hypot(x, z);
  let h = ((fbm(x * .011, z * .011) - .5) * 18 + (fbm(x * .06, z * .06) - .5) * 2) * clamp((q - 6) / 40, .12, 1);
  for (const c of CR) { const d = Math.hypot(x - c.x, z - c.z) / c.r; if (d < 1.7) { if (d < 1) h -= c.r * .22 * (1 - d * d); h += c.r * .07 * Math.exp(-(d - 1) * (d - 1) * 14); } }
  const e = Math.max(0, q - 185) / 60; return h + Math.min(e * e * 45 * (.7 + fbm(x * .03, z * .03)), 130);
}

// ---------- state ----------
const S = { st: 'standby', prev: '', kmh: 0, sv: 0, h: 0, x: 0, z: 8, y: 0, dist: 0, slope: 0, pd: 0, cd: 0, clean: 0, wp: 0, legD: 1, t: 0, lt: [0, 0, 0], ai: null };
const keys = {}, WP = [[0, -55], [70, -110], [-60, -140], [-110, -40], [90, 20]];
const GC = 24, CS = 2 * PLAY / GC, seen = new Set(); let tot = 0;
for (let i = 0; i < GC; i++) for (let j = 0; j < GC; j++) if (Math.hypot((i + .5) * CS - PLAY, (j + .5) * CS - PLAY) < PLAY) tot++;
let scene, camera, renderer, sun, sky, rover, head, led, dustMat, beacon, pmat, pgeo, camYaw = 0, camD = 9, idleT = 0, drag = false, T = 0, hudT = 0, lastB = -9;
const W = [], tv = new THREE.Vector3(), nv = new THREE.Vector3(), fv = new THREE.Vector3(), rv = new THREE.Vector3(), bv = new THREE.Vector3(), mx = new THREE.Matrix4(), qt = new THREE.Quaternion();
const SUN = new THREE.Vector3(.7, .26, .65).normalize();

// ---------- scene ----------
function setup() {
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x02030a);
  camera = new THREE.PerspectiveCamera(55, 1, .3, 3000);
  sun = new THREE.DirectionalLight(0xfff1dc, 1.9); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera; c.left = c.bottom = -45; c.right = c.top = 45; c.near = 1; c.far = 300; sun.shadow.bias = -.0008;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0x7d8cff, 0x1b0f3a, .55));
  const el = new THREE.DirectionalLight(0x5aa8ff, .35); el.position.set(-.4, .35, -.85); scene.add(el);   // blue Earthshine
  const pl = new THREE.DirectionalLight(0x8b5cf6, .25); pl.position.set(-.7, .2, .5); scene.add(pl);       // purple rim
  addEventListener('resize', resize); resize();
}
function resize() {
  renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (pmat) pmat.uniforms.uK.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
}
function buildTerrain() {
  const g = new THREE.PlaneGeometry(640, 640, 256, 256); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), h = H(x, z); p.setY(i, h);
    const s = .3 + .3 * fbm(x * .15, z * .15) + .07 * (hash(x, z) - .5) + clamp(h * .01, -.08, .1);
    c[i * 3] = s; c[i * 3 + 1] = s * .98; c[i * 3 + 2] = s * 1.04;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })); m.receiveShadow = true; scene.add(m);
}
function buildRocks() {
  const n = 1100, m = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x8a8794, roughness: 1, flatShading: true }), n), d = new THREE.Object3D(), col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    let x, z; do { x = (R() - .5) * 380; z = (R() - .5) * 380; } while (Math.hypot(x, z) < 7 || Math.hypot(x, z) > PLAY + 15);
    const s = .15 + R() ** 3 * 2.4; d.position.set(x, H(x, z) + s * .15, z); d.rotation.set(R() * 6, R() * 6, R() * 6);
    d.scale.set(s, s * (.5 + R() * .4), s * (.7 + R() * .5)); d.updateMatrix(); m.setMatrixAt(i, d.matrix); m.setColorAt(i, col.setScalar(.45 + R() * .5));
    if (s > .9) BIG.push({ x, z, r: s * .9 });
  }
  m.castShadow = m.receiveShadow = true; scene.add(m);
}
function buildSky() {
  sky = new THREE.Group(); const n = 3500, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = R() * 2 - 1, a = R() * 6.283, s = Math.sqrt(1 - u * u), k = .5 + R() * .5, t = R() < .3;
    p.set([s * Math.cos(a) * 800, u * 800, s * Math.sin(a) * 800], i * 3); c.set([k * (t ? .7 : 1), k * (t ? .8 : .95), k], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  sky.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false })));
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256; const x = cv.getContext('2d');   // procedural Earth texture
  x.fillStyle = '#1d4ed8'; x.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 60; i++) { x.fillStyle = R() < .5 ? '#2f8f4e' : '#9a8b5a'; x.beginPath(); x.ellipse(R() * 512, 40 + R() * 176, 10 + R() * 40, 6 + R() * 22, R() * 3, 0, 7); x.fill(); }
  for (let i = 0; i < 70; i++) { x.fillStyle = 'rgba(255,255,255,.55)'; x.beginPath(); x.ellipse(R() * 512, R() * 256, 20 + R() * 50, 3 + R() * 7, R() * .6, 0, 7); x.fill(); }
  x.fillStyle = '#eef'; x.fillRect(0, 0, 512, 12); x.fillRect(0, 244, 512, 12);
  const tx = new THREE.CanvasTexture(cv); tx.encoding = THREE.sRGBEncoding;
  const earth = new THREE.Mesh(new THREE.SphereGeometry(45, 48, 32), new THREE.MeshStandardMaterial({ map: tx, roughness: 1, emissive: 0x0b1d44, fog: false }));
  earth.position.set(-300, 260, -640); earth.rotation.set(.4, 2, .2);
  const atm = new THREE.Mesh(new THREE.SphereGeometry(48.5, 48, 32), new THREE.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: .22, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  atm.position.copy(earth.position); sky.add(earth, atm); scene.add(sky);
}
const M = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: .5, metalness: .4 }, o));
function bx(p, w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); p.add(m); return m; }
function buildRover() {
  rover = new THREE.Group(); const wh = M(0xe6e9f5), dk = M(0x23263a), ac = M(0x3b82f6, { emissive: 0x2563eb, emissiveIntensity: 1.2 });
  bx(rover, 2.1, .45, 3.3, dk, 0, .95, 0); bx(rover, 1.8, .6, 2.3, wh, 0, 1.4, .2); bx(rover, 1.5, .18, .15, ac, 0, 1.05, -1.68);
  bx(rover, .14, .14, 2.9, dk, 1.15, .8, 0); bx(rover, .14, .14, 2.9, dk, -1.15, .8, 0);
  bx(rover, .12, .12, .9, dk, .5, 1.0, -2.0); bx(rover, .12, .12, .6, wh, .5, 1.0, -2.55);   // sampling arm
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d');
  x.fillStyle = '#16327a'; x.fillRect(0, 0, 128, 128); x.strokeStyle = '#5b8cff'; x.lineWidth = 2;
  for (let i = 0; i <= 128; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.moveTo(0, i); x.lineTo(128, i); x.stroke(); }
  const pt = new THREE.CanvasTexture(cv); pt.encoding = THREE.sRGBEncoding;
  const pan = new THREE.Group(); pan.position.set(0, 1.85, .95); pan.rotation.x = -.14; rover.add(pan);
  bx(pan, 2.4, .06, 1.6, M(0xffffff, { map: pt, metalness: .7, roughness: .25 }), 0, 0, 0);
  dustMat = new THREE.MeshBasicMaterial({ color: 0xa39b8c, transparent: true, opacity: 0, depthWrite: false }); bx(pan, 2.4, .01, 1.6, dustMat, 0, .04, 0);   // dust layer on panel
  bx(rover, .1, .8, .1, dk, 0, 2.1, -.8); head = new THREE.Group(); head.position.set(0, 2.55, -.8); rover.add(head);
  bx(head, .55, .26, .3, wh, 0, 0, 0); bx(head, .16, .16, .1, ac, -.14, 0, -.17); bx(head, .16, .16, .1, ac, .14, 0, -.17);
  bx(rover, .06, .6, .06, dk, .7, 2.1, .2);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(.42, 16, 8, 0, 6.283, 0, 1.4), M(0xffffff, { side: THREE.DoubleSide })); dish.position.set(.7, 2.45, .2); dish.rotation.x = -1.1; rover.add(dish);
  led = bx(rover, .1, .1, .1, new THREE.MeshBasicMaterial({ color: 0xff3366 }), .7, 2.55, .2);
  for (const sz of [-1.35, 0, 1.35]) for (const sx of [-1.4, 1.4]) {
    const mount = new THREE.Group(), steer = new THREE.Group(), spin = new THREE.Group(); mount.position.set(sx, .5, sz); mount.add(steer); steer.add(spin);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, .46, 24), dk); tire.rotation.z = Math.PI / 2; spin.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, .5, 16), ac); rim.rotation.z = Math.PI / 2; spin.add(rim);
    for (let i = 0; i < 10; i++) { const a = i / 10 * 6.283, g = bx(spin, .48, .1, .14, dk, 0, Math.cos(a) * .52, Math.sin(a) * .52); g.rotation.x = a; }
    rover.add(mount); W.push({ mount, steer, spin, front: sz < 0 ? 1 : sz > 0 ? -1 : 0, sx, sz, c: 0 });
  }
  const ug = new THREE.PointLight(0x7c5cff, 1.3, 10); ug.position.set(0, .3, 0); rover.add(ug);
  for (const sx of [-.6, .6]) { const sl = new THREE.SpotLight(0xdbeafe, 2, 45, .5, .6, 1); sl.position.set(sx, 1.1, -1.7); sl.target.position.set(sx, -.5, -14); rover.add(sl, sl.target); }
  rover.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(rover);
  beacon = new THREE.Group();
  beacon.add(new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 40, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x58a6ff, transparent: true, opacity: .3, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5, .18, 8, 40), new THREE.MeshBasicMaterial({ color: 0x9b6bff })); ring.rotation.x = Math.PI / 2; ring.position.y = -19; beacon.add(ring);
  beacon.visible = false; scene.add(beacon);
}

// ---------- dust particles (ballistic, lunar gravity 1.62) ----------
const NP = 1400, PP = new Float32Array(NP * 3), PV = new Float32Array(NP * 3), PA = new Float32Array(NP), PS = new Float32Array(NP), PL = new Float32Array(NP), PM = new Float32Array(NP), PG = new Float32Array(NP), PB = new Float32Array(NP), PQ = new Float32Array(NP); let pc = 0;
function buildDust() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.5, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  pgeo = new THREE.BufferGeometry(); pgeo.setAttribute('position', new THREE.BufferAttribute(PP, 3)); pgeo.setAttribute('aA', new THREE.BufferAttribute(PA, 1)); pgeo.setAttribute('aS', new THREE.BufferAttribute(PS, 1));
  pmat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { map: { value: new THREE.CanvasTexture(cv) }, col: { value: new THREE.Color(0xd6c7a1) }, uK: { value: 800 } },
    vertexShader: 'attribute float aA;attribute float aS;uniform float uK;varying float vA;void main(){vA=aA;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=aS*uK/-mv.z;gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'uniform sampler2D map;uniform vec3 col;varying float vA;void main(){gl_FragColor=vec4(col,texture2D(map,gl_PointCoord).a*vA);}' });
  const pts = new THREE.Points(pgeo, pmat); pts.frustumCulled = false; scene.add(pts); resize();
}
function spawn(w, mul, fx, fz) {
  const i = pc++ % NP, a = i * 3; rover.localToWorld(tv.set(w.sx * 1.1, w.mount.position.y - .3, w.sz));
  PP[a] = tv.x; PP[a + 1] = tv.y; PP[a + 2] = tv.z; PG[i] = H(tv.x, tv.z);
  const sp = S.kmh * SC, r = Math.random;
  PV[a] = -fx * sp * .15 + (r() - .5) * 2.4 * mul; PV[a + 1] = (.8 + r() * 2) * Math.sqrt(mul); PV[a + 2] = -fz * sp * .15 + (r() - .5) * 2.4 * mul;
  PM[i] = PL[i] = 1.6 + r() * 1.6; PB[i] = .5 + r() * .7; PQ[i] = .2 + .1 * mul;
}
function dust(dt) {
  for (let i = 0; i < NP; i++) {
    if (PL[i] <= 0) { PA[i] = 0; continue; }
    const a = i * 3; PL[i] -= dt; PV[a + 1] -= 1.62 * dt; PP[a] += PV[a] * dt; PP[a + 1] += PV[a + 1] * dt; PP[a + 2] += PV[a + 2] * dt;
    if (PP[a + 1] < PG[i]) { PP[a + 1] = PG[i]; PV[a] *= .5; PV[a + 2] *= .5; PV[a + 1] = 0; }
    const k = Math.max(0, PL[i]) / PM[i]; PA[i] = Math.min(1, k * 2) * PQ[i]; PS[i] = PB[i] * (1.7 - k * .7);
  }
  const A = pgeo.attributes; A.position.needsUpdate = A.aA.needsUpdate = A.aS.needsUpdate = true;
}

// ---------- AI prediction: real FastAPI call, no fake values ----------
let busy = false, lastKey = '', lastT = 0;
function ok(v) { const c = $('cn'); c.className = 'chip ' + (v ? 'ok' : 'bad'); c.textContent = v ? '\u25CF AI ONLINE' + (S.ai ? ' \u00B7 ' + S.ai.lat + ' ms' : '') : '\u25CF BACKEND OFFLINE'; $('warn').classList.toggle('show', !v); }
async function poll() {
  if (busy || document.hidden) return;
  const s = Math.round(clamp(Math.abs(S.kmh), 0, 15) * 10) / 10, l = Math.round(clamp(S.slope, 0, 30) * 10) / 10, key = s + '|' + l, now = performance.now();
  if (key === lastKey && S.ai && now - lastT < 1500) return;
  busy = true; lastKey = key;
  try {
    const r = await fetch(`${API}/predict?speed=${s}&slope=${l}`); if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json(), i = LK.indexOf(d.predicted_dust_level); if (i < 0) throw new Error('bad level');
    S.ai = { i, d, s, l, lat: Math.round(performance.now() - now) }; pmat.uniforms.col.value.setHex(TINT[i]); ok(true);
  } catch (e) { S.ai = null; ok(false); }
  busy = false; lastT = performance.now();
}
async function modelInfo() {
  try { const m = await (await fetch(`${API}/model-info`)).json(); $('mi').textContent = `Model: ${m.model} \u00B7 ${(m.accuracy * 100).toFixed(0)}% test accuracy (simulated data)`; } catch (e) { }
}

// ---------- physics / pose ----------
function pose(dt) {
  const gx = (H(S.x + 1.2, S.z) - H(S.x - 1.2, S.z)) / 2.4, gz = (H(S.x, S.z + 1.2) - H(S.x, S.z - 1.2)) / 2.4;
  S.slope += (Math.atan(Math.hypot(gx, gz)) * 57.2958 - S.slope) * Math.min(1, 5 * dt); S.y = H(S.x, S.z);
  nv.set(-gx, 1, -gz).normalize(); fv.set(-Math.sin(S.h), 0, -Math.cos(S.h)); fv.addScaledVector(nv, -fv.dot(nv)).normalize();
  bv.copy(fv).negate(); rv.crossVectors(nv, bv).normalize(); bv.crossVectors(rv, nv);
  mx.makeBasis(rv, nv, bv); qt.setFromRotationMatrix(mx); rover.quaternion.slerp(qt, Math.min(1, 8 * dt));
  rover.position.x = S.x; rover.position.z = S.z; rover.position.y += (S.y - rover.position.y) * Math.min(1, 12 * dt); rover.updateMatrixWorld(true);
  for (const w of W) {   // suspension: each wheel follows the terrain under it
    rover.localToWorld(tv.set(w.sx, 0, w.sz)); tv.y = H(tv.x, tv.z); rover.worldToLocal(tv);
    w.mount.position.y += (clamp(tv.y + .5, .22, .85) - w.mount.position.y) * Math.min(1, 10 * dt); w.steer.rotation.y = S.sv * .45 * w.front;
  }
}
function sim(dt) {
  const f = (keys.f ? 1 : 0) - (keys.b ? 1 : 0), st = (keys.l ? 1 : 0) - (keys.r ? 1 : 0), fx = -Math.sin(S.h), fz = -Math.cos(S.h);
  const rise = fx * (H(S.x + 1.2, S.z) - H(S.x - 1.2, S.z)) / 2.4 + fz * (H(S.x, S.z + 1.2) - H(S.x, S.z - 1.2)) / 2.4, up = Math.atan(Math.max(0, rise)) * 57.3;
  let lim = (keys.boost ? 15 : 10) * clamp(1 - up / 50, .45, 1); if (S.pd >= 100) lim = Math.min(lim, 6);
  let tg = f > 0 ? lim : f < 0 ? -5 : 0, rate = f ? (Math.abs(tg) > Math.abs(S.kmh) && tg * S.kmh >= 0 ? 4 : 9) : 2.5;
  if (keys.brake) { tg = 0; rate = 14; }
  S.kmh += clamp(tg - S.kmh, -rate * dt, rate * dt);
  S.sv += (st - S.sv) * Math.min(1, 6 * dt); S.h += S.sv * (1.4 - .7 * Math.min(1, Math.abs(S.kmh) / 15)) * dt * (S.kmh < -.3 ? -1 : 1);
  const v = S.kmh * SC * dt; S.x += -Math.sin(S.h) * v; S.z += -Math.cos(S.h) * v; S.dist += Math.abs(v);
  for (const k of BIG) { const dx = S.x - k.x, dz = S.z - k.z, d = Math.hypot(dx, dz), m = k.r + 1.5; if (d < m && d > 0) { S.x = k.x + dx / d * m; S.z = k.z + dz / d * m; S.kmh *= .5; } }
  const q = Math.hypot(S.x, S.z); if (q > PLAY) { S.x *= PLAY / q; S.z *= PLAY / q; S.kmh *= .6; if (T - lastB > 3) { toast('Mission boundary reached'); lastB = T; } }
  pose(dt);
  for (const w of W) w.spin.rotation.x -= v / .5;
  const mul = S.ai ? MUL[S.ai.i] : .6, rt = Math.pow(Math.abs(S.kmh) / 15, 1.2) * 170 * mul;   // visual dust only; the LEVEL shown is from the API
  if (Math.abs(S.kmh) > .4) for (const w of W) if (w.sz > 0) { w.c += rt * dt * .5; while (w.c >= 1) { w.c--; spawn(w, mul, fx, fz); } }
  if (S.ai) { S.lt[S.ai.i] += dt; if (Math.abs(S.kmh) > .5) S.pd = Math.min(100, S.pd + [.03, .4, 1.1][S.ai.i] * Math.abs(S.kmh) / 10 * dt); }
  if (S.clean > 0) { S.clean -= dt; S.pd *= Math.pow(.02, dt); } S.cd = Math.max(0, S.cd - dt);
  S.t += dt; seen.add(Math.floor((S.x + PLAY) / CS) * 100 + Math.floor((S.z + PLAY) / CS));
  if (S.st === 'mission') {
    const d = Math.hypot(S.x - WP[S.wp][0], S.z - WP[S.wp][1]);
    if (d < 6) { S.wp++; if (S.wp >= WP.length) return finish(); toast(`Checkpoint ${S.wp}/${WP.length} reached`); setWP(); }
  }
}
function anim(dt) {
  const t = T; head.rotation.y = Math.sin(t * .6) * .6; led.material.color.setHex((t * 2 | 0) % 2 ? 0xff3366 : 0x330011);
  dustMat.opacity = S.pd / 100 * .85;
  sun.position.set(S.x + SUN.x * 120, S.y + SUN.y * 120, S.z + SUN.z * 120); sun.target.position.set(S.x, S.y, S.z);
  if (beacon.visible) { beacon.children[1].scale.setScalar(1 + .12 * Math.sin(t * 3)); beacon.children[0].rotation.y = t; }
}
function cam(dt) {
  idleT += dt; if (!drag && idleT > 2.5) camYaw *= Math.exp(-2 * dt);
  const orbit = S.st === 'standby' || S.st === 'complete', yaw = orbit ? T * .2 : S.h + camYaw, D = orbit ? 12 : camD;
  tv.set(S.x + Math.sin(yaw) * D, S.y + D * .38 + 1.6, S.z + Math.cos(yaw) * D);
  camera.position.lerp(tv, 1 - Math.exp(-5 * dt)); camera.position.y = Math.max(camera.position.y, H(camera.position.x, camera.position.z) + 1.8);
  camera.lookAt(S.x - (orbit ? 0 : Math.sin(S.h) * 3), S.y + 1.4, S.z - (orbit ? 0 : Math.cos(S.h) * 3)); sky.position.copy(camera.position);
}

// ---------- mission control ----------
let tT; function toast(m) { const e = $('toast'); e.textContent = m; e.classList.add('on'); clearTimeout(tT); tT = setTimeout(() => e.classList.remove('on'), 2200); }
const LBL = { standby: 'STANDBY', mission: 'MISSION ACTIVE', explore: 'EXPLORING', paused: 'PAUSED', complete: 'MISSION COMPLETE' };
function setState(s) { S.st = s; $('stc').textContent = LBL[s]; $('bPause').textContent = s === 'paused' ? '\u25B6 Resume' : '\u23F8 Pause'; $('menu').classList.toggle('off', !(s === 'standby' || s === 'complete')); }
function setWP() { const [x, z] = WP[S.wp]; beacon.position.set(x, H(x, z) + 19, z); beacon.visible = true; S.legD = Math.max(1, Math.hypot(S.x - x, S.z - z)); }
function startMission() { resetRover(); S.wp = 0; setWP(); setState('mission'); toast(`Mission started: reach ${WP.length} beacons`); }
function explore() { resetRover(); beacon.visible = false; setState('explore'); toast('Free exploration: drive anywhere'); }
function finish() {
  beacon.visible = false; const tl = S.lt[0] + S.lt[1] + S.lt[2] || 1, p = i => Math.round(S.lt[i] / tl * 100);
  $('mtitle').textContent = 'Mission Complete'; $('msub').textContent = `Distance ${S.dist.toFixed(0)} m in ${fmt(S.t)}. AI-predicted dust exposure: Low ${p(0)}%, Medium ${p(1)}%, High ${p(2)}%. Panel dust ${S.pd.toFixed(0)}%.`;
  $('mStart').textContent = '\u21BB Play Again'; setState('complete');
}
function resetRover() {
  Object.assign(S, { kmh: 0, sv: 0, h: 0, x: 0, z: 8, dist: 0, pd: 0, cd: 0, clean: 0, wp: 0, t: 0, slope: 0, lt: [0, 0, 0] }); seen.clear();
  rover.position.set(0, H(0, 8), 8); pose(1); if (S.st === 'mission') setWP();
}
const fmt = t => String(t / 60 | 0).padStart(2, '0') + ':' + String(t % 60 | 0).padStart(2, '0');
function togglePause() { if (S.st === 'paused') setState(S.prev); else if (S.st === 'mission' || S.st === 'explore') { S.prev = S.st; setState('paused'); } }
function hud() {
  const a = Math.abs(S.kmh); $('v').textContent = a.toFixed(1); $('vb').style.width = a / 15 * 100 + '%';
  $('sl').textContent = S.slope.toFixed(1); $('slb').style.width = Math.min(S.slope, 30) / 30 * 100 + '%';
  $('xy').textContent = S.x.toFixed(0) + ' / ' + S.z.toFixed(0); $('hd').textContent = Math.round(((-S.h * 57.2958) % 360 + 360) % 360) + '\u00B0';
  $('ds').textContent = S.dist.toFixed(0) + ' m'; $('met').textContent = fmt(S.t);
  const ai = S.ai, l = $('lvl'); l.className = ai ? 'L' + ai.i : ''; l.textContent = ai ? LV[ai.i].toUpperCase() : 'NO DATA';
  $('risk').textContent = ai ? ai.d.risk_category : 'Waiting for backend'; $('exp').textContent = ai ? ai.d.explanation : '';
  for (let i = 0; i < 3; i++) { const p = ai ? (ai.d.probabilities[LK[i]] || 0) * 100 : 0; $('p' + i).style.width = p + '%'; $('q' + i).textContent = p.toFixed(0) + '%'; }
  $('io').textContent = ai ? `API: /predict?speed=${ai.s}&slope=${ai.l}` : 'API: no response';
  $('pdv').textContent = S.pd.toFixed(0) + '%' + (S.cd > 0 ? '' : ' \u00B7 X: shield ready'); $('pdb').style.width = S.pd + '%';
  let pr = 0, tx = 'Awaiting launch';
  if (S.st === 'mission' || (S.st === 'paused' && S.prev === 'mission')) { const d = Math.hypot(S.x - WP[S.wp][0], S.z - WP[S.wp][1]); pr = (S.wp + clamp(1 - d / S.legD, 0, 1)) / WP.length * 100; tx = `Beacon ${S.wp + 1}/${WP.length} \u00B7 ${d.toFixed(0)} m away`; }
  else if (S.st === 'explore' || S.st === 'paused') { pr = seen.size / tot * 100; tx = 'Exploration coverage'; }
  else if (S.st === 'complete') { pr = 100; tx = 'All beacons reached'; }
  $('mp').style.width = pr + '%'; $('mpv').textContent = pr.toFixed(0) + '%'; $('mt').textContent = tx;
}

// ---------- input ----------
const KM = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', ShiftLeft: 'boost', ShiftRight: 'boost', Space: 'brake' };
addEventListener('keydown', e => {
  if (KM[e.code]) { keys[KM[e.code]] = 1; e.preventDefault(); }
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause(); if (e.code === 'KeyR' && rover) resetRover();
  if (e.code === 'KeyX' && S.cd <= 0 && (S.st === 'mission' || S.st === 'explore')) { S.clean = 1.5; S.cd = 15; toast('Dust shield pulse: panels cleaned'); }
});
addEventListener('keyup', e => { if (KM[e.code]) keys[KM[e.code]] = 0; });
addEventListener('blur', () => { for (const k in keys) keys[k] = 0; });
document.querySelectorAll('[data-k]').forEach(b => { b.onpointerdown = e => { keys[b.dataset.k] = 1; e.preventDefault(); }; b.onpointerup = b.onpointerleave = b.onpointercancel = () => keys[b.dataset.k] = 0; });
if (matchMedia('(pointer:coarse)').matches) document.body.classList.add('tc');
const gl = $('gl'); let lx = 0;
gl.onpointerdown = e => { drag = true; lx = e.clientX; }; addEventListener('pointerup', () => drag = false);
gl.onpointermove = e => { if (drag) { camYaw -= (e.clientX - lx) * .006; lx = e.clientX; idleT = 0; } };
gl.addEventListener('wheel', e => { camD = clamp(camD + e.deltaY * .01, 5, 22); e.preventDefault(); }, { passive: false });
$('bStart').onclick = $('mStart').onclick = startMission; $('bExplore').onclick = $('mExplore').onclick = explore;
$('bPause').onclick = togglePause; $('bReset').onclick = () => rover && resetRover();
$('bFull').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();

// ---------- main ----------
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop); const dt = Math.min(.05, clock.getDelta()); T += dt;
  if (S.st === 'mission' || S.st === 'explore') sim(dt);
  if (S.st !== 'paused') dust(dt);
  anim(dt); cam(dt); hudT += dt; if (hudT > .1) { hudT = 0; hud(); }
  renderer.render(scene, camera);
}
async function init() {
  try {
    if (typeof THREE === 'undefined') throw new Error('Three.js could not be loaded');
    await step(10, 'Creating 3D renderer'); setup();
    await step(30, 'Sculpting lunar terrain and craters'); buildTerrain();
    await step(55, 'Scattering rocks and boulders'); buildRocks();
    await step(70, 'Charting stars and Earth'); buildSky();
    await step(85, 'Assembling lunar rover'); buildRover(); buildDust();
    await step(95, 'Linking AI dust model'); await modelInfo();
    resetRover(); setState('standby'); await step(100, 'Ready for launch');
    setInterval(poll, 250); poll(); setTimeout(() => $('load').classList.add('off'), 600); loop();
  } catch (e) { console.error(e); $('lt').textContent = 'Error: ' + e.message + '. Check your internet (Three.js CDN) or see README.'; $('load').classList.add('err'); }
}
init();
