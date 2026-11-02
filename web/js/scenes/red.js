// Red rooms (fragments 1–3): one small bedroom, lit by a single caged red lamp, hung with chains.
// "The past that keeps rearing its head." Restraint: nothing graphic; intimacy only implied by a fade on candlelight.
// Layout (metres): room x ∈ [-2.25, 2.25], z ∈ [-2.5, 2.5], ceiling 2.6. Door (spawn) at the front (+z).
// Bed: headboard on the back wall, centred x = -0.55. Nightstand to its right, the red lamp above it.
// Window on the right wall. She always lies on the right half of the bed (nearest the player's side).
import * as THREE from 'three';
import { E, player, wait, until, say, choose, tween, go, addInteract, interact, T, currentEpoch, alive } from '../engine.js';
import { model, pbr, setRepeat } from '../assets.js';
import { makeHer } from '../fx/figures.js';
import { wineGlass } from '../fx/world.js';
import { SOFT, SOFT_GLSL } from '../post.js';

const RW = 2.25, RD = 2.5, RH = 2.6; // half width, half depth, height
const BED_X = -0.55, BED_Z = -1.44; // bed origin (headboard on back wall)
const NS = new THREE.Vector3(0.55, 0, -2.25); // nightstand
const NS_TOP = 0.70;
const LAMP = new THREE.Vector3(1.0, 2.18, -2.47); // wall plate of the sconce (back wall)
const BEDSIDE = new THREE.Vector3(0.78, 0, -1.5); // where he stands to talk to her

function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const angWrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------------------------------------------------------- shaders
const NOISE_GLSL = /* glsl */`
float h3(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm3(vec3 p){ return n3(p)*0.55 + n3(p*2.1+3.1)*0.3 + n3(p*4.3+7.7)*0.15; }`;

// Volumetric-looking light cone: additive, brightest along the axis, fading with distance, noisy haze.
// Lives on layer 1 (drawn after DOF) and fades against the opaque depth so it never shows hard intersections.
const CONE_VS = /* glsl */`
varying vec3 vW; varying vec3 vN; varying float vH; varying float vDepth;
void main(){
  vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz;
  vN = normalize(mat3(modelMatrix)*normal);
  vH = clamp(0.5 - position.y, 0.0, 1.0); // geometry is a unit-height cylinder, apex at +0.5
  vec4 mv = viewMatrix*w; vDepth = -mv.z;
  gl_Position = projectionMatrix*mv;
}`;
const CONE_FS = /* glsl */`
uniform vec3 uColor; uniform float uInt; uniform float uTime;
varying vec3 vW; varying vec3 vN; varying float vH; varying float vDepth;
${SOFT_GLSL}
${NOISE_GLSL}
void main(){
  vec3 V = normalize(cameraPosition - vW);
  float face = abs(dot(normalize(vN), V));
  float core = pow(face, 2.2);
  float fall = pow(1.0 - vH, 1.6) * smoothstep(0.0, 0.06, vH);
  float n = fbm3(vW*vec3(2.2,1.3,2.2) + vec3(uTime*0.03, -uTime*0.05, uTime*0.02));
  float a = core * fall * (0.35 + 1.1*n) * uInt;
  a *= softFade(vDepth, 0.45) * smoothstep(0.15, 0.6, vDepth);
  gl_FragColor = vec4(uColor*a, 1.0);
}`;

// Soft glow billboard (halo around the lamp, candle glows). Layer 1, depth-faded.
const GLOW_VS = /* glsl */`
varying vec2 vUv; varying float vDepth;
void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vDepth = -mv.z; gl_Position = projectionMatrix*mv; }`;
const GLOW_FS = /* glsl */`
uniform vec3 uColor; uniform float uInt; uniform float uPow;
varying vec2 vUv; varying float vDepth;
${SOFT_GLSL}
void main(){ float r = length(vUv-0.5)*2.0; float a = pow(max(1.0-r,0.0), uPow) * uInt * softFade(vDepth, 0.25);
  gl_FragColor = vec4(uColor*a, 1.0); }`;

// Candle flame: a flickering teardrop, cylindrical billboard, HDR bright so it blooms (layer 0).
const FLAME_VS = /* glsl */`
uniform float uTime; uniform float uSeed; varying vec2 vUv;
void main(){ vUv = uv;
  vec3 p = position;
  float sway = sin(uTime*7.0+uSeed*10.0)*0.12 + sin(uTime*13.0+uSeed*3.0)*0.06;
  p.x += sway * uv.y*uv.y * 0.012;
  gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.0); }`;
const FLAME_FS = /* glsl */`
uniform float uTime; uniform float uSeed; uniform float uInt; varying vec2 vUv;
void main(){
  vec2 c = vUv - vec2(0.5, 0.28);
  float fl = 0.9 + 0.1*sin(uTime*17.0+uSeed*7.0) + 0.06*sin(uTime*31.0+uSeed);
  c.y /= (1.45*fl); c.x *= (1.0 + max(c.y,0.0)*2.6);
  float d = length(c)*2.6;
  float a = smoothstep(1.0, 0.15, d);
  float coreW = smoothstep(0.55, 0.0, d);
  vec3 col = mix(vec3(1.0,0.38,0.08), vec3(1.0,0.86,0.55), coreW);
  col = mix(col, vec3(0.25,0.35,1.0)*0.6, smoothstep(0.05,-0.12,c.y)*a*0.6); // blue foot
  gl_FragColor = vec4(col*a*uInt*fl, a);
}`;

// Snow behind the window: points falling in a thin box outside.
const SNOW_VS = /* glsl */`
attribute vec4 aSeed; uniform float uTime; uniform vec3 uBox; uniform vec3 uOrigin; uniform float uPix;
varying float vA;
void main(){
  vec3 p = aSeed.xyz*uBox;
  p.y = mod(p.y - uTime*(0.35+0.4*aSeed.w), uBox.y);
  p.x += sin(uTime*0.7 + aSeed.w*30.0)*0.06; p.z += cos(uTime*0.5 + aSeed.x*20.0)*0.08 + uTime*0.05;
  p.z = mod(p.z, uBox.z);
  vec4 mv = modelViewMatrix*vec4(uOrigin + p, 1.0);
  gl_Position = projectionMatrix*mv;
  gl_PointSize = uPix * (0.012 + aSeed.w*0.014) / max(-mv.z, 0.3);
  vA = 0.55 + 0.45*aSeed.w;
}`;
const SNOW_FS = /* glsl */`
uniform vec3 uColor; varying float vA;
void main(){ float r = length(gl_PointCoord-0.5)*2.0; float a = smoothstep(1.0,0.2,r)*vA; if(a<0.01) discard; gl_FragColor = vec4(uColor*a, a); }`;

// Dust motes drifting through the red light.
const DUST_VS = /* glsl */`
attribute vec4 aSeed; uniform float uTime; uniform vec3 uBox; uniform vec3 uOrigin; uniform float uPix;
uniform vec3 uLamp; uniform vec3 uAxis;
varying float vA; varying float vDepth;
void main(){
  vec3 p = aSeed.xyz*uBox;
  p += vec3(sin(uTime*0.11+aSeed.w*40.0), sin(uTime*0.07+aSeed.x*30.0)*0.6 - uTime*0.01, cos(uTime*0.09+aSeed.y*20.0))*0.25;
  p = mod(p, uBox);
  vec3 w = uOrigin + p;
  // brightness: how deep inside the lamp's cone the mote is
  vec3 d = w - uLamp; float along = dot(d, uAxis); float perp = length(d - uAxis*along);
  float inCone = smoothstep(0.9, 0.2, perp/max(along*0.75, 0.05)) * step(0.0, along) * exp(-along*0.35);
  vec4 mv = viewMatrix*vec4(w,1.0); vDepth = -mv.z;
  gl_Position = projectionMatrix*mv;
  gl_PointSize = uPix*(0.006+0.006*aSeed.w)/max(-mv.z,0.2);
  vA = (0.15 + inCone) * (0.5+0.5*sin(uTime*(0.5+aSeed.w)+aSeed.z*50.0));
}`;
const DUST_FS = /* glsl */`
uniform vec3 uColor; varying float vA; varying float vDepth;
${SOFT_GLSL}
void main(){ float r = length(gl_PointCoord-0.5)*2.0; float a = smoothstep(1.0,0.0,r)*vA*softFade(vDepth,0.1); gl_FragColor = vec4(uColor*a,1.0); }`;

// ---------------------------------------------------------------- chains
// One oval chain link (stadium curve swept by a round wire); long axis = local Y.
class Stadium extends THREE.Curve {
  constructor(r, h) { super(); this.r = r; this.h = h; this.P = 4 * h + 2 * Math.PI * r; }
  getPoint(u, t = new THREE.Vector3()) {
    const { r, h, P } = this; let s = u * P;
    if (s < 2 * h) return t.set(r, -h + s, 0); s -= 2 * h;
    if (s < Math.PI * r) { const a = s / r; return t.set(Math.cos(a) * r, h + Math.sin(a) * r, 0); } s -= Math.PI * r;
    if (s < 2 * h) return t.set(-r, h - s, 0); s -= 2 * h;
    const a = Math.PI + s / r; return t.set(Math.cos(a) * r, -h + Math.sin(a) * r, 0);
  }
}
const LINK = { r: 0.024, h: 0.024, t: 0.0085 };
LINK.pitch = 2 * (LINK.h + LINK.r - LINK.t); // centre-to-centre spacing of interlocked links

function buildChains(scene, envMap) {
  const R = mulberry(41);
  const C = RH - 0.02;
  // strands: hanging (to the floor or free) and sagging catenaries between two ceiling hooks. Placed to frame the view
  // from the door like the reference (near strands left/right, depth layers behind), keeping a walkway on the right.
  const strands = [
    { type: 'hang', top: [0.22, C, 1.35], len: 2.95, floorDir: 2.4 },
    { type: 'hang', top: [2.0, C, 1.25], len: 2.85, floorDir: -0.6 },
    { type: 'hang', top: [-1.5, C, 0.75], len: 2.9, floorDir: 1.2 },
    { type: 'hang', top: [-0.55, C, 0.15], len: 1.45 },
    { type: 'hang', top: [1.95, C, 0.35], len: 2.8, floorDir: -2.2 },
    { type: 'hang', top: [-2.0, C, -1.0], len: 2.8, floorDir: 0.4 },
    { type: 'hang', top: [2.0, C, -2.2], len: 2.75, floorDir: 2.9 },
    { type: 'hang', top: [-0.25, C, -0.95], len: 1.05 },
    { type: 'hang', top: [1.25, C, 0.2], len: 0.85 },
    { type: 'hang', top: [-1.25, C, -2.25], len: 2.0 },
    { type: 'hang', top: [0.45, C, -0.25], len: 1.2 },
    { type: 'hang', top: [-1.0, C, 1.9], len: 2.9, floorDir: -1.0 },
    { type: 'hang', top: [1.6, C, -1.3], len: 1.6 },
    { type: 'hang', top: [-1.9, C, 2.1], len: 2.0 },
    { type: 'cat', a: [-1.5, C, 0.75], b: [0.22, C, 1.35], sag: 1.05 },
    { type: 'cat', a: [1.25, C, 0.2], b: [2.0, C, 1.25], sag: 0.75 },
    { type: 'cat', a: [-1.25, C, -2.25], b: [-0.25, C, -0.95], sag: 0.6 },
  ];
  for (const s of strands) {
    s.phase = R() * 6.28; s.freq = 0.35 + R() * 0.25; s.amp = 0.012 + R() * 0.018; s.twist = R() * 3.14;
    if (s.type === 'hang') {
      s.top = new THREE.Vector3(...s.top); s.lv = Math.min(s.len, s.top.y - 0.03); s.floor = s.len > s.lv + 0.01;
      s.fd = new THREE.Vector3(Math.cos(s.floorDir ?? 0), 0, Math.sin(s.floorDir ?? 0));
      s.n = Math.floor(s.len / LINK.pitch);
    } else {
      s.a = new THREE.Vector3(...s.a); s.b = new THREE.Vector3(...s.b);
      s.perp = new THREE.Vector3().subVectors(s.b, s.a).cross(new THREE.Vector3(0, 1, 0)).normalize();
      // arc length of the parabola-ish sag
      let L = 0; const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
      for (let i = 0; i <= 64; i++) { catPoint(s, i / 64, 0, p1); if (i) L += p1.distanceTo(p0); p0.copy(p1); }
      s.len = L; s.n = Math.floor(L / LINK.pitch);
    }
  }
  function catPoint(s, u, t, out) {
    out.lerpVectors(s.a, s.b, u);
    out.y -= s.sag * 4 * u * (1 - u);
    const sw = Math.sin(t * s.freq * 0.8 + s.phase) * s.amp * 1.4 * Math.sin(Math.PI * u);
    return out.addScaledVector(s.perp, sw);
  }
  const total = strands.reduce((a, s) => a + s.n, 0);
  const geo = new THREE.TubeGeometry(new Stadium(LINK.r, LINK.h), 22, LINK.t, 6, true);
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a8a84, metalness: 0.95, roughness: 0.3, envMap, envMapIntensity: 2.2 });
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  // ceiling plates + eye bolts at every hook
  const hooks = [];
  for (const s of strands) for (const p of s.type === 'hang' ? [s.top] : [s.a, s.b]) if (!hooks.some(h => h.distanceTo(p) < 0.05)) hooks.push(p);
  const plate = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.05, 0.018, 16), mat, hooks.length);
  hooks.forEach((p, i) => plate.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, RH - 0.009, p.z)));
  scene.add(plate);

  // per-frame layout
  const N = 56, pts = Array.from({ length: N + 1 }, () => new THREE.Vector3()), cum = new Float32Array(N + 1);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qt = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3(), dir = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const sw = new THREE.Vector3();
  function sample(s, t) {
    if (s.type === 'cat') { for (let j = 0; j <= N; j++) catPoint(s, j / N, t, pts[j]); }
    else {
      sw.set(Math.sin(t * s.freq + s.phase), 0, Math.cos(t * s.freq * 0.77 + s.phase * 1.3) * 0.7).multiplyScalar(s.amp);
      for (let j = 0; j <= N; j++) {
        const d = (j / N) * s.len;
        if (d <= s.lv) {
          const k = d / s.lv;
          const shape = s.floor ? Math.sin(Math.PI * Math.min(k, 1)) : k;
          pts[j].set(s.top.x + sw.x * shape * 2.0, s.top.y - d, s.top.z + sw.z * shape * 2.0);
          // a slow ripple running down the strand
          pts[j].x += Math.sin(t * 1.3 + d * 3.0 + s.phase) * 0.003 * shape;
        } else {
          const e = d - s.lv; // links lying on the floor, curling a little
          const a = (s.floorDir ?? 0) + e * 1.6;
          pts[j].set(s.top.x + Math.cos(a) * e * 0.8, 0.03, s.top.z + Math.sin(a) * e * 0.8);
        }
      }
    }
    cum[0] = 0; for (let j = 1; j <= N; j++) cum[j] = cum[j - 1] + pts[j].distanceTo(pts[j - 1]);
  }
  function at(d, out) {
    d = THREE.MathUtils.clamp(d, 0, cum[N]);
    let j = 1; while (j < N && cum[j] < d) j++;
    const k = (d - cum[j - 1]) / Math.max(cum[j] - cum[j - 1], 1e-6);
    return out.lerpVectors(pts[j - 1], pts[j], k);
  }
  function update(t) {
    let idx = 0;
    for (const s of strands) {
      sample(s, t);
      const scale = cum[N] / Math.max(s.n * LINK.pitch, 1e-6); // keep links on the curve even if it stretches a bit
      for (let i = 0; i < s.n; i++) {
        const d = (i + 0.5) * LINK.pitch * Math.min(scale, 1.0);
        at(d - LINK.pitch * 0.5, pa); at(d + LINK.pitch * 0.5, pb); at(d, pc);
        dir.subVectors(pa, pb); const l = dir.length(); if (l < 1e-6) dir.set(0, 1, 0); else dir.multiplyScalar(1 / l);
        q.setFromUnitVectors(Y, dir);
        const onFloor = pc.y < 0.06;
        qt.setFromAxisAngle(Y, s.twist + (i % 2) * Math.PI / 2);
        if (onFloor) { pc.y = (i % 2) ? LINK.r + LINK.t - 0.004 : LINK.t; qt.setFromAxisAngle(Y, (i % 2) ? Math.PI / 2 : 0); q.multiply(qt); }
        else q.multiply(qt);
        m4.compose(pc, q, one);
        mesh.setMatrixAt(idx++, m4);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  update(0);
  // small colliders where strands reach the floor in walkable space
  const colliders = strands.filter(s => s.type === 'hang' && s.floor).map(s => ({ minX: s.top.x - 0.05, maxX: s.top.x + 0.05, minZ: s.top.z - 0.05, maxZ: s.top.z + 0.05 }));
  return { mesh, update, colliders, tris: total * geo.index.count / 3 };
}

// ---------------------------------------------------------------- small props
function cherryGeo() {
  const g = new THREE.SphereGeometry(0.0125, 14, 10);
  // the little dimple at the stem
  const p = g.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = Math.max(0, v.y / 0.0125 - 0.75) * 4; v.y -= k * 0.004; v.x *= 1.03; v.z *= 1.03; p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals();
  return g;
}
function stemGeo(R) {
  const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.009, 0), new THREE.Vector3(0.003, 0.02, 0.001), new THREE.Vector3(0.006 + R * 0.004, 0.032, 0.003), new THREE.Vector3(0.012 + R * 0.006, 0.04, 0.004)]);
  return new THREE.TubeGeometry(c, 8, 0.0009, 4, false);
}
const cherryMat = () => new THREE.MeshPhysicalMaterial({ color: 0x4a020a, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.5 });
const stemMat = () => new THREE.MeshStandardMaterial({ color: 0x3a3a14, roughness: 0.8 });
function makeCherry(R) {
  const g = new THREE.Group();
  const c = new THREE.Mesh(cherryGeo(), cherryMat()); g.add(c);
  const s = new THREE.Mesh(stemGeo(R()), stemMat()); g.add(s);
  return g;
}
function greenBottle() {
  const prof = [[0, 0], [0.018, 0], [0.0195, 0.003], [0.0195, 0.05], [0.017, 0.056], [0.0085, 0.062], [0.0072, 0.066], [0.0072, 0.078], [0.0085, 0.08], [0.0085, 0.082], [0, 0.082]].map(([a, b]) => new THREE.Vector2(a, b));
  // dark green glass; a faint green self-glow so it still reads as green under the red lamp
  const glass = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), new THREE.MeshStandardMaterial({ color: 0x1a6a30, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.7, envMapIntensity: 2.2, emissive: 0x0e5a22, emissiveIntensity: 0.55, depthWrite: false }));
  glass.renderOrder = 3;
  const liqProf = [[0, 0.004], [0.016, 0.004], [0.0168, 0.04], [0, 0.04]].map(([a, b]) => new THREE.Vector2(a, b));
  const liquid = new THREE.Mesh(new THREE.LatheGeometry(liqProf, 20), new THREE.MeshStandardMaterial({ color: 0x04160a, roughness: 0.1, emissive: 0x021a08, emissiveIntensity: 0.4 }));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.014, 16), new THREE.MeshStandardMaterial({ color: 0x8a8070, metalness: 0.9, roughness: 0.32, envMapIntensity: 1.5 }));
  cap.position.y = 0.084;
  const g = new THREE.Group(); g.add(liquid, glass, cap);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { group: g, liquid, cap, glass };
}
function glassCapsule() {
  const g = new THREE.Group();
  // (writes depth so the DOF pass keeps it sharp when focused on the hand)
  const shell = new THREE.Mesh(new THREE.CapsuleGeometry(0.0058, 0.02, 6, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.45, envMapIntensity: 4, emissive: 0x501414, emissiveIntensity: 0.6 }));
  // a hairline specular glint along the glass
  const glint = new THREE.Mesh(new THREE.CapsuleGeometry(0.0009, 0.018, 2, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.9, 0.85) }));
  glint.position.set(0.0035, 0, 0.0035); g.add(glint);
  const liq = new THREE.Mesh(new THREE.CapsuleGeometry(0.0042, 0.016, 4, 12), new THREE.MeshStandardMaterial({ color: 0x1a4a22, roughness: 0.1, emissive: 0x0a2a10, emissiveIntensity: 0.7, transparent: true, opacity: 0.85 }));
  shell.renderOrder = 4; g.add(liq, shell);
  g.rotation.set(0.25, 0.5, 0.85); g.scale.setScalar(1.5);
  return g;
}
// pale blanket draped over the lower half of the bed, with a ridge over her legs
function blanket(legX, w = 1.62, l = 1.45) {
  const g = new THREE.PlaneGeometry(w, l, 64, 56); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let y = 0.012 * Math.sin(x * 9 + z * 3) + 0.008 * Math.sin(x * 23 - z * 17) + 0.01 * Math.sin(z * 6 + 1.3);
    const lx = x - legX;
    const along = z / l + 0.5; // 0 at the folded top edge (her waist), 1 at the foot
    y += (0.15 - along * 0.07) * Math.exp(-(lx * lx) / (2 * 0.17 * 0.17)) * THREE.MathUtils.smoothstep(along, 0.0, 0.08); // over her legs, thinning to the feet
    const ex = Math.max(Math.abs(x) - (w / 2 - 0.14), 0); y -= ex * 2.4 + ex * ex * 4; // hang over the sides
    const ez = Math.max(z - (l / 2 - 0.06), 0); y -= ez * 1.2; // and over the foot
    const top = Math.max(-(z + l / 2 - 0.12), 0); y += top * 0.4; // folded top edge
    p.setY(i, y);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: 0x564844, roughness: 0.92, sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xffffff), side: THREE.DoubleSide }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function curtain(w, h, seed) {
  const g = new THREE.PlaneGeometry(w, h, 26, 22);
  const base = g.attributes.position.array.slice();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3a0708, roughness: 0.82, side: THREE.DoubleSide }));
  m.castShadow = false; m.receiveShadow = true;
  m.userData.update = (t, wind) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      const hang = (h / 2 - y) / h; // 0 at the rod, 1 at the hem
      let z = Math.sin(x * 34 + seed) * 0.03 + Math.sin(x * 13 + seed * 2) * 0.015;
      z += wind * hang * hang * (0.09 * Math.sin(t * 1.1 + x * 3 + seed) + 0.05 * Math.sin(t * 2.3 + y * 2));
      p.setXYZ(i, x + wind * hang * 0.03 * Math.sin(t * 0.9 + seed), y, z);
    }
    p.needsUpdate = true; g.computeVertexNormals();
  };
  m.userData.update(0, 0);
  return m;
}
// keep only the far-right complete wall sconce from the scanned sheet of variants
function isolateSconce(root) {
  root.updateMatrixWorld(true);
  let mesh = null; root.traverse(o => { if (o.isMesh) mesh = o; });
  const g = mesh.geometry, P = g.attributes.position, idx = g.index;
  const M = mesh.matrixWorld, v = new THREE.Vector3(), keep = [];
  const box = new THREE.Box3();
  for (let i = 0; i < idx.count; i += 3) {
    let cx = 0, cy = 0;
    for (let k = 0; k < 3; k++) { v.fromBufferAttribute(P, idx.getX(i + k)).applyMatrix4(M); cx += v.x / 3; cy += v.y / 3; }
    if (cx > 0.37 && cy < 0.36) { keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)); for (let k = 0; k < 3; k++) box.expandByPoint(v.fromBufferAttribute(P, idx.getX(i + k)).applyMatrix4(M)); }
  }
  const ng = g.clone(); ng.setIndex(keep); mesh.geometry = ng;
  return box;
}

// ---------------------------------------------------------------- scene
export async function redScene(opts = {}) {
  const FRAG = opts.frag || 1;
  const WARM = FRAG === 3;
  const scene = new THREE.Scene();
  scene.userData.soft = true;
  const fogCol = new THREE.Color(WARM ? 0x0a0201 : 0x070001);
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(fogCol, WARM ? 0.06 : 0.08);

  // ---- a small environment map: near-black room with the red lamp in it (gives metal & glass something to reflect)
  {
    const es = new THREE.Scene();
    es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), new THREE.MeshBasicMaterial({ color: WARM ? 0x0d0402 : 0x0a0101, side: THREE.BackSide })));
    const lampBlob = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(WARM ? 0xff3a12 : 0xff1008).multiplyScalar(6) }));
    lampBlob.position.set(LAMP.x * 2, 4, LAMP.z * 2); es.add(lampBlob);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(WARM ? 0x5a1a08 : 0x3a0404), side: THREE.DoubleSide }));
    glow.position.set(0, 2, -6); es.add(glow);
    if (WARM) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(5) })); c.position.set(3, 0.5, -4); es.add(c); }
    const pm = new THREE.PMREMGenerator(E.renderer);
    scene.environment = pm.fromScene(es, 0.03).texture;
    scene.environmentIntensity = 0.35;
    pm.dispose();
  }

  // ---- lights
  const LAMP_COL = new THREE.Color(WARM ? 0xff3412 : 0xff0d06);
  const hemi = new THREE.HemisphereLight(WARM ? 0x5a1a0a : 0x3a0404, 0x050101, WARM ? 0.12 : 0.06);
  scene.add(hemi);
  const lampPos = new THREE.Vector3(LAMP.x, LAMP.y + 0.0, LAMP.z + 0.12); // centre of the glowing cage (set after model loads)
  const spot = new THREE.SpotLight(LAMP_COL, WARM ? 7 : 12, 0, 1.0, 0.9, 1.8);
  spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0006; spot.shadow.normalBias = 0.02; spot.shadow.radius = 4;
  spot.shadow.camera.near = 0.08; spot.shadow.camera.far = 9;
  const spotTarget = new THREE.Vector3(0.5, 0, 0.4);
  scene.add(spot, spot.target);
  const fill = new THREE.PointLight(LAMP_COL, WARM ? 0.6 : 0.9, 5.5, 1.6); scene.add(fill);
  // grazing wash down the back wall under the lamp (no shadows)
  const wash = new THREE.SpotLight(LAMP_COL, WARM ? 1.5 : 3, 4, 0.7, 1, 1.6); scene.add(wash, wash.target);

  // ---- room shell
  const wallMat = pbr('red_plaster_weathered', { repeat: 1 }); setRepeat(wallMat, 1.6, 1.0);
  wallMat.color.set(WARM ? 0x9a7a6a : 0x8a6a62); wallMat.normalScale.set(1.4, 1.4);
  const sideMat = wallMat.clone(); setRepeat(sideMat, 1.8, 1.0);
  const floorMat = pbr('old_wood_floor', { repeat: 1 }); setRepeat(floorMat, 2.2, 2.4); floorMat.color.set(0x8a7a70);
  const ceilMat = pbr('rough_plaster_03', { repeat: 1 }); setRepeat(ceilMat, 2, 2); ceilMat.color.set(0x5a4a44);
  const plane = (w, h, mat, pos, rotY = 0, rotX = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(...pos); m.rotation.set(rotX, rotY, 0, 'YXZ'); m.receiveShadow = true; scene.add(m); return m; };
  plane(RW * 2, RD * 2, floorMat, [0, 0, 0], 0, -Math.PI / 2);
  plane(RW * 2, RD * 2, ceilMat, [0, RH, 0], 0, Math.PI / 2);
  plane(RW * 2, RH, wallMat, [0, RH / 2, -RD], 0);
  plane(RW * 2, RH, wallMat, [0, RH / 2, RD], Math.PI);
  plane(RD * 2, RH, sideMat, [-RW, RH / 2, 0], Math.PI / 2);
  // right wall with a window opening: z ∈ [-1.15, -0.05], y ∈ [0.85, 2.0]
  const WIN = { z0: -1.15, z1: -0.05, y0: 0.85, y1: 2.0 };
  const rw = (z0, z1, y0, y1) => { const m = plane(z1 - z0, y1 - y0, sideMat.clone(), [RW, (y0 + y1) / 2, (z0 + z1) / 2], -Math.PI / 2); setRepeat(m.material, 1.8 * (z1 - z0) / (RD * 2), (y1 - y0) / RH); return m; };
  rw(-RD, WIN.z0, 0, RH); rw(WIN.z1, RD, 0, RH); rw(WIN.z0, WIN.z1, 0, WIN.y0); rw(WIN.z0, WIN.z1, WIN.y1, RH);
  // skirting + a door frame on the front wall (dark wood)
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x1c100c, roughness: 0.55, metalness: 0.0 });
  const boxM = (w, h, d, mat, pos) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(...pos); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };
  boxM(RW * 2, 0.1, 0.02, darkWood, [0, 0.05, -RD + 0.01]); boxM(0.02, 0.1, RD * 2, darkWood, [-RW + 0.01, 0.05, 0]);
  boxM(0.02, 0.1, RD * 2, darkWood, [RW - 0.01, 0.05, 0]);
  boxM(0.95, 2.1, 0.04, new THREE.MeshStandardMaterial({ color: 0x120806, roughness: 0.6 }), [1.0, 1.05, RD - 0.02]);
  // window: frame, two casement leaves (one cracked open in frag 3), sill
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x241612, roughness: 0.6 });
  const wx = RW;
  boxM(0.12, 0.05, WIN.z1 - WIN.z0 + 0.1, frameMat, [wx - 0.02, WIN.y0 - 0.02, (WIN.z0 + WIN.z1) / 2]);
  boxM(0.06, 0.05, WIN.z1 - WIN.z0 + 0.1, frameMat, [wx, WIN.y1 + 0.02, (WIN.z0 + WIN.z1) / 2]);
  boxM(0.06, WIN.y1 - WIN.y0, 0.05, frameMat, [wx, (WIN.y0 + WIN.y1) / 2, WIN.z0 - 0.02]);
  boxM(0.06, WIN.y1 - WIN.y0, 0.05, frameMat, [wx, (WIN.y0 + WIN.y1) / 2, WIN.z1 + 0.02]);
  boxM(0.22, 0.035, WIN.z1 - WIN.z0 + 0.3, darkWood, [wx - 0.1, WIN.y0 - 0.04, (WIN.z0 + WIN.z1) / 2]); // sill
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.14, envMapIntensity: 1.0, depthWrite: false });
  const leaves = [];
  const lw = (WIN.z1 - WIN.z0) / 2;
  for (let i = 0; i < 2; i++) {
    const hinge = new THREE.Group();
    const zH = i === 0 ? WIN.z0 : WIN.z1, sgn = i === 0 ? 1 : -1;
    hinge.position.set(wx - 0.01, 0, zH);
    const leaf = new THREE.Group();
    const fr = (w, h, d, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat); m.position.set(0, y, z); m.castShadow = true; leaf.add(m); };
    const hh = WIN.y1 - WIN.y0;
    fr(0.035, hh, 0.035, WIN.y0 + hh / 2, sgn * 0.0175); fr(0.035, hh, 0.035, WIN.y0 + hh / 2, sgn * (lw - 0.0175));
    fr(0.035, 0.035, lw, WIN.y0 + 0.0175, sgn * lw / 2); fr(0.035, 0.035, lw, WIN.y1 - 0.0175, sgn * lw / 2); fr(0.02, 0.02, lw, WIN.y0 + hh * 0.55, sgn * lw / 2);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(lw, hh), glassMat); pane.rotation.y = Math.PI / 2; pane.position.set(0, WIN.y0 + hh / 2, sgn * lw / 2); pane.renderOrder = 2; leaf.add(pane);
    hinge.add(leaf); scene.add(hinge); leaves.push({ hinge, sgn });
  }
  if (WARM) leaves[1].hinge.rotation.y = 0.55; // cracked open to the snow
  // outside: night backdrop + falling snow
  const back = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.ShaderMaterial({
    uniforms: {}, fog: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec2 vUv; void main(){ vec3 a=vec3(0.010,0.013,0.022), b=vec3(0.05,0.055,0.075); float h=smoothstep(0.15,0.55,vUv.y)*smoothstep(0.95,0.5,vUv.y); gl_FragColor=vec4(mix(a,b,h*0.8),1.0); }',
  }));
  back.position.set(RW + 2.2, 1.4, -0.6); back.rotation.y = -Math.PI / 2; scene.add(back);
  const snowN = 700, snowSeeds = new Float32Array(snowN * 4); { const R = mulberry(7); for (let i = 0; i < snowN * 4; i++) snowSeeds[i] = R(); }
  const snowG = new THREE.BufferGeometry(); snowG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(snowN * 3), 3)); snowG.setAttribute('aSeed', new THREE.BufferAttribute(snowSeeds, 4));
  const snowU = { uTime: { value: 0 }, uBox: { value: new THREE.Vector3(1.9, 3.6, 3.2) }, uOrigin: { value: new THREE.Vector3(RW + 0.15, -0.4, -2.2) }, uPix: { value: 600 }, uColor: { value: new THREE.Color(0.55, 0.58, 0.66) } };
  const snowPts = new THREE.Points(snowG, new THREE.ShaderMaterial({ uniforms: snowU, vertexShader: SNOW_VS, fragmentShader: SNOW_FS, transparent: true, depthWrite: false }));
  snowPts.frustumCulled = false; scene.add(snowPts);
  const coldLight = new THREE.PointLight(0x8090b0, WARM ? 0.5 : 0.25, 3, 2); coldLight.position.set(RW + 0.4, 1.6, -0.6); scene.add(coldLight);
  // curtains either side of the window
  const curtains = [curtain(0.62, 2.35, 1.3), curtain(0.62, 2.35, 4.1)];
  curtains[0].position.set(RW - 0.09, RH - 0.05 - 2.35 / 2, WIN.z0 - 0.22); curtains[1].position.set(RW - 0.09, RH - 0.05 - 2.35 / 2, WIN.z1 + 0.22);
  for (const c of curtains) { c.rotation.y = -Math.PI / 2; scene.add(c); }
  boxM(0.03, 0.03, 2.0, new THREE.MeshStandardMaterial({ color: 0x2a2018, metalness: 0.7, roughness: 0.4 }), [RW - 0.09, RH - 0.06, (WIN.z0 + WIN.z1) / 2]);

  // ---- the lamp: caged industrial sconce, emissive red, on the back wall
  const sconce = await model('industrial_caged_sconce');
  const sb = isolateSconce(sconce);
  const SCALE = 1.7;
  const sconceG = new THREE.Group(); sconce.position.set(-(sb.min.x + sb.max.x) / 2, -sb.min.y, -sb.min.z); sconceG.add(sconce);
  sconceG.scale.setScalar(SCALE); sconceG.position.set(LAMP.x, LAMP.y - (sb.max.y - sb.min.y) * SCALE * 0.5, LAMP.z + 0.005);
  sconce.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive = LAMP_COL.clone(); o.material.emissiveIntensity = WARM ? 7 : 14; o.castShadow = false; } });
  scene.add(sconceG);
  // centre of the cage: upper part of the isolated box, towards its front
  lampPos.set(LAMP.x, sconceG.position.y + (sb.max.y - sb.min.y) * SCALE * 0.66, LAMP.z + (sb.max.z - sb.min.z) * SCALE * 0.62);
  spot.position.copy(lampPos).add(new THREE.Vector3(0, -0.02, 0.1)); spot.target.position.copy(spotTarget);
  fill.position.copy(lampPos).add(new THREE.Vector3(0, -0.05, 0.25));
  wash.position.copy(lampPos).add(new THREE.Vector3(0, 0.05, 0.35)); wash.target.position.set(LAMP.x, 0.3, -RD);
  // light cone + halo
  const coneDir = new THREE.Vector3().subVectors(spotTarget, lampPos).normalize();
  const coneLen = 3.4;
  const coneG = new THREE.CylinderGeometry(0.06, 1.75, 1, 40, 1, true);
  const coneU = { uColor: { value: LAMP_COL.clone().multiplyScalar(WARM ? 0.07 : 0.16) }, uInt: { value: 1 }, uTime: { value: 0 }, ...SOFT };
  const cone = new THREE.Mesh(coneG, new THREE.ShaderMaterial({ uniforms: coneU, vertexShader: CONE_VS, fragmentShader: CONE_FS, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  cone.scale.set(1, coneLen, 1);
  cone.position.copy(lampPos).addScaledVector(coneDir, coneLen / 2);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), coneDir);
  cone.layers.set(1); cone.frustumCulled = false; scene.add(cone);
  const glowMat = (col, int, pw) => new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(col) }, uInt: { value: int }, uPow: { value: pw }, ...SOFT }, vertexShader: GLOW_VS, fragmentShader: GLOW_FS, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat(LAMP_COL, WARM ? 0.12 : 0.22, 2.6));
  halo.scale.setScalar(2.4); halo.position.copy(lampPos).add(new THREE.Vector3(0, 0, 0.25)); halo.layers.set(1); scene.add(halo);
  const haloCore = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat(new THREE.Color(1, 0.35, 0.3), WARM ? 0.6 : 1.1, 3.5));
  haloCore.scale.setScalar(0.55); haloCore.position.copy(lampPos).add(new THREE.Vector3(0, 0, 0.18)); haloCore.layers.set(1); scene.add(haloCore);
  const billboards = [halo, haloCore];
  // dust in the beam
  const dustN = 420, dustSeeds = new Float32Array(dustN * 4); { const R = mulberry(3); for (let i = 0; i < dustN * 4; i++) dustSeeds[i] = R(); }
  const dustG = new THREE.BufferGeometry(); dustG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dustN * 3), 3)); dustG.setAttribute('aSeed', new THREE.BufferAttribute(dustSeeds, 4));
  const dustU = { uTime: { value: 0 }, uBox: { value: new THREE.Vector3(3.6, 2.5, 3.6) }, uOrigin: { value: new THREE.Vector3(-1.6, 0.05, -2.4) }, uPix: { value: 600 }, uLamp: { value: lampPos }, uAxis: { value: coneDir }, uColor: { value: new THREE.Color(1.0, 0.3, 0.22) }, ...SOFT };
  const dust = new THREE.Points(dustG, new THREE.ShaderMaterial({ uniforms: dustU, vertexShader: DUST_VS, fragmentShader: DUST_FS, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  dust.layers.set(1); dust.frustumCulled = false; scene.add(dust);

  // ---- chains
  const chains = buildChains(scene, scene.environment);

  // ---- furniture
  const bed = await model('GothicBed_01');
  bed.position.set(BED_X, 0, BED_Z);
  bed.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color?.multiplyScalar(0.2); } }); // the linen would blow out under the lamp
  scene.add(bed);
  const ns = await model('ClassicNightstand_01');
  ns.position.copy(NS); scene.add(ns);
  const bowl = await model('wooden_bowl_01', { scale: 0.72 });
  bowl.position.set(NS.x + 0.1, NS_TOP, NS.z + 0.04); scene.add(bowl);
  // cherries piled in the bowl
  const R = mulberry(FRAG * 13 + 5);
  const cherries = [];
  const pile = new THREE.Group(); pile.position.copy(bowl.position); scene.add(pile);
  for (let i = 0; i < 15; i++) {
    const c = makeCherry(R);
    const a = R() * 6.28, r = Math.sqrt(R()) * 0.062, layer = i < 10 ? 0 : 1;
    c.position.set(Math.cos(a) * r, 0.03 + layer * 0.02 + (0.062 - r) * 0.25, Math.sin(a) * r);
    c.rotation.set((R() - 0.5) * 0.9, R() * 6.28, (R() - 0.5) * 0.9);
    c.traverse(o => { if (o.isMesh) o.castShadow = true; });
    pile.add(c); cherries.push(c);
  }
  // the small green bottle, right next to the cherries
  const bottle = greenBottle();
  bottle.group.position.set(NS.x - 0.14, NS_TOP, NS.z + 0.1); scene.add(bottle.group);

  // fragment 3: candles, wine, two glasses
  const candles = [];
  let wineBottle = null, glassHis = null, glassHers = null;
  if (WARM) {
    const mkCandle = async (pos, scale = 1, wax = 0.11) => {
      const g = new THREE.Group();
      const stick = await model('wooden_candlestick', { scale, shadows: false });
      g.add(stick);
      const top = 0.2196 * scale;
      const waxM = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.012, wax, 16), new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.55, emissive: 0xff7a30, emissiveIntensity: 0.05 }));
      waxM.position.y = top + wax / 2 - 0.01; g.add(waxM);
      const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.01, 4), new THREE.MeshBasicMaterial({ color: 0x110805 })); wick.position.y = top + wax - 0.005; g.add(wick);
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.05), new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uSeed: { value: R() }, uInt: { value: 6 } }, vertexShader: FLAME_VS, fragmentShader: FLAME_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      fl.position.y = top + wax + 0.016; g.add(fl);
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat(0xff8a3a, 0.22, 3.0)); halo.scale.setScalar(0.4); halo.layers.set(1); halo.position.y = top + wax + 0.02; g.add(halo); billboards.push(halo);
      const L = new THREE.PointLight(0xff7a2a, 0.55, 3.5, 2); L.position.y = top + wax + 0.05; g.add(L);
      g.position.copy(pos); scene.add(g);
      const c = { g, fl, L, halo, base: 0.55, seed: R() * 10 };
      candles.push(c); return c;
    };
    await mkCandle(new THREE.Vector3(NS.x + 0.2, NS_TOP, NS.z - 0.13));
    await mkCandle(new THREE.Vector3(RW - 0.1, WIN.y0 - 0.022, WIN.z1 + 0.06), 1.0, 0.07);
    const wb = await model('wine_bottles_01');
    const bord = wb.getObjectByName('wine_bottles_01_bordeaux');
    if (bord) { bord.removeFromParent(); bord.position.x = 0; bord.position.z = 0; wineBottle = new THREE.Group(); wineBottle.add(bord); }
    else { wineBottle = wb; }
    wineBottle.position.set(NS.x + 0.42, 0, NS.z + 0.12); wineBottle.rotation.y = 0.4; scene.add(wineBottle);
    glassHers = wineGlass({ wine: 0.3 }); glassHers.position.set(NS.x + 0.02, NS_TOP, NS.z - 0.1); scene.add(glassHers);
    glassHis = wineGlass({ wine: 0.45 });
  }

  // ---- her: a figure of light, under a pale blanket
  const herCol = WARM ? 0xffd9b8 : 0xffcfc4;
  const herX = BED_X + 0.42; // right half of the bed
  // (Michelle's arm bones: +X swings the arm down to the side)
  const LIE_POSE = { LeftUpLeg: [0, 0, 2], RightUpLeg: [0, 0, -2], LeftArm: [80, 0, 0], RightArm: [62, 0, 0], RightForeArm: [0, 0, 40], Spine: [-2, 0, 0], Neck: [0, 10, 0], Head: [-4, 24, 0] };
  const SIT_POSE = { LeftUpLeg: [-72, 0, 3], RightUpLeg: [-72, 0, -3], LeftLeg: [6, 0, 0], RightLeg: [6, 0, 0], Spine: [6, 0, 0], Spine1: [4, 0, 0], LeftArm: [74, 0, 0], RightArm: [70, 0, 0], LeftForeArm: [0, 0, -40], RightForeArm: [0, 0, 40], Neck: [4, 14, 0], Head: [8, 22, 0] };
  const herA = await makeHer({ pose: WARM ? SIT_POSE : LIE_POSE, color: herCol, points: 6000, size: 0.02, shellOpacity: 0.3, opacity: 0.8 });
  const herB = WARM ? await makeHer({ pose: { ...LIE_POSE, Neck: [0, -12, 0], Head: [-4, -30, 0], LeftArm: [60, 0, 0], LeftForeArm: [0, 0, -60] }, color: herCol, points: 6000, size: 0.02, shellOpacity: 0.3, opacity: 0.8 }) : null;
  for (const h of [herA, herB]) if (h) { h.light.color.set(herCol); h.light.distance = 2.2; h.lightScale = 0.6; }
  // lying: feet at the group origin, head toward the headboard (-z), face up, rolled a little toward the player
  function layDown(h, x, roll) {
    h.group.rotation.order = 'XYZ';
    h.group.rotation.set(-Math.PI / 2, roll, 0);
    h.group.position.set(x, 0.6, -2.36 + 1.66);
  }
  function sitUp(h, x) {
    h.group.rotation.set(-0.36, 0, 0);
    const hip = new THREE.Vector3(0, h.hipY, 0).applyEuler(h.group.rotation);
    h.group.position.set(x, 0.56, -1.92).sub(hip);
  }
  let her = herA;
  if (WARM) { sitUp(herA, herX); layDown(herB, herX - 0.05, -0.55); herB.group.visible = false; scene.add(herB.group); }
  else layDown(herA, herX, 0.32);
  scene.add(herA.group);
  const herHead = WARM ? new THREE.Vector3(herX, 1.12, -2.22) : new THREE.Vector3(herX + 0.03, 0.66, -2.22);
  const cover = blanket(herX - BED_X, 1.6, 1.42); cover.position.set(BED_X + 0.03, 0.61, -1.2); scene.add(cover);

  // ---- held objects (children of the camera)
  const held = new THREE.Group(); // positioned low in front of the camera
  const capsule = glassCapsule(); capsule.visible = false; held.add(capsule);
  let heldCherry = null;

  // ---- state
  const S = { t0: 0, lamp: 1, cone: 1, poi: null, focusOverride: null, shakeBase: 0, tremble: 0, hb: null, wind: WARM ? 1 : 0.15, cam: null, flash: 0, raysBase: WARM ? 0.25 : 0.42 };
  const _v = new THREE.Vector3(), _p = new THREE.Vector3();
  if (E.manual) globalThis.__red = { S, her: () => her, herA, herB, chains, cherries, bottle, capsule, lampPos, scene, candles, interact };

  // pick the nearest point of interest in the view for the shallow focus
  const POIS = [herHead, new THREE.Vector3(NS.x, NS_TOP + 0.05, NS.z), lampPos, new THREE.Vector3(RW, 1.4, -0.6)];
  function updateFocus() {
    let d;
    if (S.focusOverride != null) d = typeof S.focusOverride === 'number' ? S.focusOverride : E.camera.position.distanceTo(S.focusOverride);
    else {
      E.camera.getWorldDirection(_v); let best = 1e9; d = 3;
      for (const p of POIS) { _p.subVectors(p, E.camera.position); const dist = _p.length(); const ang = Math.acos(THREE.MathUtils.clamp(_p.dot(_v) / dist, -1, 1)); const sc = ang + dist * 0.04; if (sc < best && ang < 0.6) { best = sc; d = dist; } }
    }
    E.post.target.focus = d;
  }
  // god rays from the lamp when it is on screen
  function updateRays() {
    _v.copy(lampPos).project(E.camera);
    const on = _v.z < 1 && Math.abs(_v.x) < 1.25 && Math.abs(_v.y) < 1.25 ? 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(_v.x), Math.abs(_v.y)), 0.85, 1.25) : 0;
    const L = E.post.look, T = E.post.target;
    L.raysLight[0] = T.raysLight[0] = (_v.x + 1) / 2; L.raysLight[1] = T.raysLight[1] = (_v.y + 1) / 2;
    T.rays = S.raysBase * on * S.lamp;
  }

  const LOOK = WARM ? {
    exposure: 0.85, bloom: 0.13, halation: 0.22, lift: [0.02, 0.004, 0.0], gamma: [1, 1, 1], gain: [1.0, 0.92, 0.88], sat: 1.0, contrast: 1.15, tint: [1.12, 0.72, 0.6],
    vignette: 0.62, grain: 0.07, ca: 0.5, dof: 0.55, dofNear: 0.25, focus: 2, focusRange: 0.4,
    rays: 0.2, raysTint: [1.0, 0.45, 0.25], raysThreshold: 0.55, raysDecay: 0.95, raysLen: 0.85, raysSky: 0, raysLight: [0.6, 0.8],
  } : {
    exposure: 0.85, bloom: 0.12, halation: 0.2, lift: [0.02, 0, 0], gamma: [1.0, 1.0, 1.0], gain: [1.0, 0.92, 0.95], sat: 1.0, contrast: 1.18, tint: [1.12, 0.62, 0.68],
    vignette: 0.65, grain: 0.07, ca: 0.55, dof: 0.55, dofNear: 0.12, focus: 3, focusRange: 0.5,
    rays: 0.4, raysTint: [1.0, 0.22, 0.25], raysThreshold: 0.6, raysDecay: 0.95, raysLen: 0.85, raysSky: 0, raysLight: [0.6, 0.8],
  };

  // ---------------------------------------------------------------- scene object
  const obj = {
    scene,
    enter() {
      player.pos.set(1.0, 0, 1.95); player.yaw = 0.22; player.pitch = 0.12;
      player.speed = 1.3; player.runSpeed = 1.9;
      player.radius = 0.25;
      player.bounds = (p) => { p.x = THREE.MathUtils.clamp(p.x, -RW + 0.3, RW - 0.3); p.z = THREE.MathUtils.clamp(p.z, -RD + 0.3, RD - 0.3); };
      player.colliders = [
        { minX: BED_X - 0.73, maxX: BED_X + 0.78, minZ: -RD, maxZ: BED_Z + 0.98 },
        { minX: NS.x - 0.28, maxX: NS.x + 0.28, minZ: NS.z - 0.21, maxZ: NS.z + 0.21 },
        ...chains.colliders,
      ];
      player.onStep = (spd) => E.audio?.step('wood', spd, { gain: 0.42, send: 0.12 });
      E.post.snapLook(LOOK);
      E.post.lookSpeed = 2.2;
      E.post.fx.letterbox = 0;
      E.ui.crosshair(true);
      if (!E.camera.parent || E.camera.parent !== scene) scene.add(E.camera);
      E.camera.add(held); held.position.set(0, 0, 0);
      // audio
      E.audio?.stopAllAmb(0.6);
      E.audio?.setWow(6, 1.5);
      if (WARM) { E.audio?.playMusic('waltz'); E.audio?.amb('fire', 0.35, 2); E.audio?.amb('wind', 0.12, 3); E.audio?.amb('room', 0.2, 2); }
      else { E.audio?.playMusic('red'); E.audio?.amb('drone', 0.32, 3); E.audio?.amb('room', 0.35, 2); }
      S.t0 = E.time;
      ({ 1: frag1, 2: frag2, 3: frag3 })[FRAG]();
    },
    update(dt, t) {
      chains.update(t);
      coneU.uTime.value = t; snowU.uTime.value = t; dustU.uTime.value = t;
      snowU.uPix.value = dustU.uPix.value = innerHeight * 0.9;
      // the lamp breathes (a tired filament), dims when told to
      const flick = 1 + 0.035 * Math.sin(t * 2.1) * Math.sin(t * 0.7) + (Math.random() < 0.004 ? -0.25 : 0);
      spot.intensity = (WARM ? 7 : 12) * S.lamp * flick; wash.intensity = (WARM ? 1.5 : 3) * S.lamp * flick; fill.intensity = (WARM ? 0.6 : 0.9) * S.lamp * flick;
      coneU.uInt.value = S.cone * S.lamp * flick;
      sconce.traverse(o => { if (o.isMesh) o.material.emissiveIntensity = (WARM ? 7 : 14) * S.lamp * flick; });
      halo.material.uniforms.uInt.value = (WARM ? 0.12 : 0.22) * S.lamp; haloCore.material.uniforms.uInt.value = (WARM ? 0.4 : 0.8) * S.lamp;
      for (const b of billboards) { b.quaternion.copy(E.camera.quaternion); }
      // candles
      for (const c of candles) {
        const f = 0.85 + 0.1 * Math.sin(t * 9 + c.seed) + 0.06 * Math.sin(t * 23 + c.seed * 2) + 0.05 * (Math.random() - 0.5);
        c.L.intensity = c.base * f; c.fl.material.uniforms.uTime.value = t;
        _v.copy(E.camera.position); c.fl.parent.worldToLocal(_v); c.fl.rotation.y = Math.atan2(_v.x - c.fl.position.x, _v.z - c.fl.position.z);
      }
      // curtains stir at the cracked window
      if (WARM || (E.frame % 3 === 0)) for (const c of curtains) c.userData.update(t, S.wind);
      herA.update(dt, t); herB?.update(dt, t);
      // held objects tremble with him
      if (capsule.visible) {
        const tr = S.tremble;
        capsule.position.set(0.055 + (Math.random() - 0.5) * tr * 0.006 + Math.sin(t * 1.3) * 0.002, -0.085 + (Math.random() - 0.5) * tr * 0.006 + Math.sin(t * 0.9) * 0.002, -0.24);
      }
      player.shake = S.shakeBase + S.tremble * 0.006;
      // custom camera (lying / holding her)
      if (S.cam) {
        const c = S.cam;
        E.camera.position.copy(c.pos);
        const yawOff = player.yawLimit ? angWrap(player.yaw - player.yawLimit.center) : 0;
        E.camera.rotation.order = 'YXZ';
        E.camera.rotation.set(c.pitch + (player.pitch - (c.pitch0 ?? 0)) * 0.5 + Math.sin(t * 0.9) * 0.004 + (Math.random() - 0.5) * player.shake, c.yaw + yawOff * 0.5, c.roll);
      }
      // her heartbeat (frag 3), slowing
      if (S.hb && E.audio?.ready) { S.hb.t -= dt; if (S.hb.t <= 0) { E.audio.heartbeat(undefined, S.hb.gain); S.hb.t = S.hb.int; } }
      // blink-white flash after the throw
      if (S.flash > 0) { S.flash = Math.max(0, S.flash - dt * 1.4); }
      updateFocus(); updateRays();
      if (E.audio?.ready) { const f = new THREE.Vector3(); E.camera.getWorldDirection(f); E.audio.setListener(E.camera.position, f, E.camera.up); }
    },
    exit() {
      E.camera.remove(held);
      if (E.camera.parent === scene) scene.remove(E.camera);
      E.camera.rotation.order = 'YXZ';
      E.audio?.setWow(6, 1.5);
      E.audio?.amb('heart', 0, 0.3); E.audio?.amb('fire', 0, 1);
      // go() does not reset these; leave the player as other scenes expect
      player.radius = 0.3; player.shake = 0; player.pitchMin = -1.3; player.pitchMax = 1.3; player.speed = 2.0; player.runSpeed = 3.8;
      delete globalThis.__red;
    },
    dispose() { scene.traverse((o) => { o.geometry?.dispose?.(); }); scene.environment?.dispose?.(); },
  };
  Object.defineProperty(obj, 'customCamera', { get: () => !!S.cam });

  // ---------------------------------------------------------------- helpers for scripts
  // ease the first-person view toward a point
  async function lookAtPoint(p, dur = 1.4) {
    const eye = new THREE.Vector3(player.pos.x, player.pos.y + player.eye, player.pos.z);
    const d = new THREE.Vector3().subVectors(p, eye);
    const yaw1 = Math.atan2(-d.x, -d.z), pitch1 = Math.atan2(d.y, Math.hypot(d.x, d.z));
    const y0 = player.yaw, p0 = player.pitch, dy = angWrap(yaw1 - y0);
    const cl = player.canLook; player.canLook = false;
    await tween(dur, (k) => { player.yaw = y0 + dy * k; player.pitch = p0 + (pitch1 - p0) * k; });
    player.canLook = cl;
    return yaw1;
  }
  // a camera pose for cutscene framing: position + look-at target (+roll)
  function camPose(pos, target, roll = 0) {
    const d = new THREE.Vector3().subVectors(target, pos);
    return { pos: pos.clone(), yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), roll };
  }
  async function moveCam(to, dur) {
    const from = { pos: S.cam.pos.clone(), yaw: S.cam.yaw, pitch: S.cam.pitch, roll: S.cam.roll };
    const dy = angWrap(to.yaw - from.yaw);
    await tween(dur, (k) => { S.cam.pos.lerpVectors(from.pos, to.pos, k); S.cam.yaw = from.yaw + dy * k; S.cam.pitch = from.pitch + (to.pitch - from.pitch) * k; S.cam.roll = from.roll + (to.roll - from.roll) * k; });
  }
  function camFromPlayer() {
    return { pos: E.camera.position.clone(), yaw: player.yaw, pitch: player.pitch, roll: 0, pitch0: player.pitch };
  }
  async function walkToBed() {
    let hinted = false;
    await until(() => {
      if (!hinted && E.time - S.t0 > 9 && player.moved < 0.4) { hinted = true; E.ui.hint(T('p.walk')); }
      // anywhere along her side of the bed, past the foot
      return Math.hypot(player.pos.x - BEDSIDE.x, player.pos.z - BEDSIDE.z) < 1.0 || (player.pos.z < -0.35 && player.pos.x > -0.1);
    });
    E.ui.hint(null);
    player.canMove = false;
    const yaw = await lookAtPoint(herHead, 1.6);
    player.yawLimit = { center: yaw, range: 0.75 };
  }
  async function hardCut() {
    // ABRUPT: tape stop, a burst of glitch, black.
    E.audio?.tapeStop(0.9);
    E.audio?.amb('heart', 0, 0.1);
    S.hb = null;
    E.post.fx.glitch = 1.0;
    await wait(0.4);
    E.post.fx.glitch = 0;
    E.post.fx.fadeColor.set(0x000000); E.post.fx.fade = 1;
    capsule.visible = false;
    await wait(1.4);
    E.flags['r' + FRAG] = true;
    E.post.fx.fade = 1;
    go('library', { spawn: 'door' + FRAG, fadeOut: 0 });
  }
  function showCapsule() {
    capsule.visible = true; capsule.position.set(0.055, -0.2, -0.24);
    return tween(1.2, (k) => { capsule.position.y = -0.2 + 0.115 * k; });
  }

  // ---------------------------------------------------------------- fragment 1: the request
  async function frag1() {
    await wait(1.6);
    await say('red.narr_1');
    await say('red.narr_2');
    await walkToBed();
    await wait(0.6);
    await say('red.her_1');
    await say('red.him_1');
    await say('red.her_2');
    await say('red.him_2');
    await say('red.her_3');
    S.focusOverride = 0.25; E.post.setLook({ dof: 0.7, focusRange: 0.05 }, 1.5);
    showCapsule();
    await say('red.narr_3');
    S.tremble = 0.4;
    await say('red.her_4');
    const c = await choose(['red.c_no', 'red.c_silent']);
    if (c === 1) await wait(1.8);
    S.focusOverride = null; E.post.setLook({ dof: LOOK.dof, focusRange: LOOK.focusRange }, 1.5);
    await say('red.him_3');
    await wait(0.6);
    await say('red.her_5', { dur: 2.2 });
    await wait(1.4);
    await hardCut();
  }

  // ---------------------------------------------------------------- fragment 2: the capsule
  async function frag2() {
    // he is already standing by the bed; she sleeps
    player.pos.set(BEDSIDE.x, 0, BEDSIDE.z);
    player.canMove = false;
    { const d = new THREE.Vector3().subVectors(herHead, new THREE.Vector3(player.pos.x, 1.62, player.pos.z)); player.yaw = Math.atan2(-d.x, -d.z); player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); player.yawLimit = { center: player.yaw, range: 0.7 }; }
    herA.lightScale = 0.5;
    capsule.visible = true; capsule.position.set(0.055, -0.085, -0.24);
    S.tremble = 0.5; S.focusOverride = 0.25; E.post.setLook({ dof: 0.85, focusRange: 0.05 }, 3);
    E.audio?.amb('heart', 0.18, 2);
    await wait(1.4);
    await say('red2.narr_1');
    await say('red2.narr_2');
    S.focusOverride = null; E.post.setLook({ dof: LOOK.dof, focusRange: LOOK.focusRange }, 1);
    await say('red2.narr_3');
    await say('red2.narr_4');
    S.focusOverride = 0.25; E.post.setLook({ dof: 0.85, focusRange: 0.05 }, 1);
    await say('red2.narr_5');
    S.focusOverride = null; E.post.setLook({ dof: LOOK.dof, focusRange: LOOK.focusRange }, 1);
    // hold to... (the prompt is only an ellipsis). At ~70% his hands fail.
    let failed = false;
    const it = addInteract({ pos: herHead, radius: 0.35, dist: 2.6, label: 'p.capsule', hold: 3, onUse: () => { failed = true; } });
    await until(() => {
      const k = interact.focus === it ? interact.holdT / 3 : 0;
      S.tremble = 0.5 + k * 3.2;
      E.audio?.amb('heart', 0.18 + k * 1.1, 0.3);
      E.post.target.vignette = LOOK.vignette + k * 0.25;
      if (k >= 0.7) { it.enabled = false; failed = true; }
      return failed;
    });
    E.ui.setPrompt(null);
    E.audio?.holdTone?.(0);
    await say('red2.him_1', { dur: 2.0, gap: 0.1 });
    await throwCapsule();
    S.tremble = 0; E.audio?.amb('heart', 0.25, 3);
    E.post.target.vignette = LOOK.vignette;
    // he holds her: the view sinks down beside her
    S.cam = camFromPlayer();
    player.yawLimit = { center: player.yaw, range: 0.25 }; player.pitchMin = player.pitch - 0.2; player.pitchMax = player.pitch + 0.2;
    const close = camPose(new THREE.Vector3(herX + 0.42, 0.86, -2.0), new THREE.Vector3(herX - 0.02, 0.64, -2.26), 0.12);
    moveCam(close, 4.5);
    await tween(4.5, (k) => { herA.lightScale = 0.5 + k * 0.4; herA.opacity = 0.8 + k * 0.2; });
    await say('red2.narr_6');
    await wait(0.8);
    await say('red2.narr_7');
    await wait(1.2);
    player.pitchMin = -1.3; player.pitchMax = 1.3;
    await hardCut();
  }
  async function throwCapsule() {
    // detach from the hand into the room, fling it at the far wall, shatter
    const wp = new THREE.Vector3(); capsule.getWorldPosition(wp);
    const wq = new THREE.Quaternion(); capsule.getWorldQuaternion(wq);
    held.remove(capsule); scene.add(capsule); capsule.position.copy(wp); capsule.quaternion.copy(wq);
    const end = new THREE.Vector3(1.6, 1.1, 0.9); // the wall past the window, by the chains
    const start = wp.clone(), spin = new THREE.Vector3(9, 4, 13);
    E.audio?.whoosh(0.4);
    await tween(0.42, (k) => {
      capsule.position.lerpVectors(start, end, k); capsule.position.y += Math.sin(k * Math.PI) * 0.25;
      capsule.rotation.x += spin.x * E.dt; capsule.rotation.y += spin.y * E.dt; capsule.rotation.z += spin.z * E.dt;
    }, (x) => x);
    // shatter against the right wall
    capsule.visible = false;
    E.audio?.glass();
    shards(new THREE.Vector3(RW - 0.02, end.y, end.z));
    E.post.fx.fadeColor.set(0xffffff);
    E.post.fx.desat = 0.6;
    E.post.setLook({ dof: 1.0, focus: 0.1, focusRange: 0.0 }, 8);
    await tween(0.12, (k) => { E.post.fx.fade = k * 0.85; }, (x) => x);
    await tween(1.1, (k) => { E.post.fx.fade = 0.85 * (1 - k); E.post.fx.desat = 0.6 * (1 - k); });
    E.post.fx.fade = 0; E.post.fx.desat = 0; E.post.fx.fadeColor.set(0x000000);
    E.post.setLook({ dof: LOOK.dof, focusRange: LOOK.focusRange }, 1.2);
  }
  function shards(at) {
    const n = 28, g = new THREE.BufferGeometry(), P = new Float32Array(n * 3); g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffd0c8, size: 0.012, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false; scene.add(pts);
    const vel = []; for (let i = 0; i < n; i++) { P.set([at.x, at.y, at.z], i * 3); vel.push(new THREE.Vector3(-0.6 - Math.random() * 1.6, Math.random() * 1.4 - 0.2, (Math.random() - 0.5) * 2.2)); }
    tween(1.6, (k) => {
      for (let i = 0; i < n; i++) { const v = vel[i]; v.y -= 9.8 * E.dt; for (let a = 0; a < 3; a++) P[i * 3 + a] += [v.x, v.y, v.z][a] * E.dt; if (P[i * 3 + 1] < 0.01) { P[i * 3 + 1] = 0.01; v.set(v.x * 0.3, 0, v.z * 0.3); } }
      g.attributes.position.needsUpdate = true; pts.material.opacity = 1 - k * 0.6;
    }, (x) => x);
  }

  // ---------------------------------------------------------------- fragment 3: the perfect day
  async function frag3() {
    const ep = currentEpoch();
    // the waltz slowly loses its footing
    (async () => { let k = 0; while (alive(ep)) { k = Math.min(1, (E.time - S.t0) / 150); E.audio?.setWow(6 + k * k * 55, 1.5 + k * 5); await wait(0.5); } })();
    // he stands by the bed with a glass; she sits up against the headboard
    player.pos.set(BEDSIDE.x, 0, BEDSIDE.z + 0.15);
    { const d = new THREE.Vector3().subVectors(herHead, new THREE.Vector3(player.pos.x, 1.62, player.pos.z)); player.yaw = Math.atan2(-d.x, -d.z); player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) - 0.05; }
    player.canMove = false;
    held.add(glassHis); glassHis.position.set(0.09, -0.24, -0.34); glassHis.rotation.set(0.1, 0, -0.05); glassHis.scale.setScalar(1);
    await wait(1.4);
    await say('red3.narr_1', { dur: 2.4 });
    await say('red3.narr_2');
    // toast
    await tween(0.9, (k) => { glassHis.position.set(0.09 - k * 0.07, -0.24 + k * 0.1, -0.34 - k * 0.08); });
    E.audio?.note?.('C7', { vel: 0.1, dur: 1.6, rel: 1.6, dest: E.audio.sfxBus });
    await say('red3.him_1');
    await say('red3.her_1');
    await tween(0.8, (k) => { glassHis.position.set(0.02 + k * 0.07, -0.14 - k * 0.1, -0.42 + k * 0.08); });
    // put it down on the nightstand, next to hers
    held.remove(glassHis); glassHis.position.set(NS.x - 0.08, NS_TOP, NS.z - 0.12); glassHis.rotation.set(0, 0, 0); scene.add(glassHis);
    player.canMove = true;
    await say('red3.narr_3');
    await say('red3.her_2', { dur: 2.4 });
    // take a cherry from the bowl…
    let took = false;
    addInteract({ obj: pile, radius: 0.14, dist: 2.2, label: 'p.take_cherry', hold: 0, onUse: () => { took = true; } });
    await until(() => took);
    const c = cherries.pop(); pile.remove(c);
    heldCherry = c; held.add(c); c.position.set(0.05, -0.08, -0.22); c.rotation.set(0.2, 0.4, -0.3); c.scale.setScalar(1.25);
    E.audio?.step('wood', 0.3, { gain: 0.08 });
    // …and give it to her
    let gave = false;
    addInteract({ pos: herHead, radius: 0.35, dist: 2.2, label: 'p.give_cherry', hold: 0, onUse: () => { gave = true; } });
    await until(() => gave);
    player.canMove = false;
    await lookAtPoint(herHead, 0.9);
    const p0 = c.position.clone();
    await tween(1.5, (k) => { c.position.set(p0.x * (1 - k), p0.y + k * 0.06, p0.z - k * 0.28); c.scale.setScalar(1.25 * (1 - k * 0.3)); });
    held.remove(c);
    // fade to black on candlelight: the red lamp falls away first, then everything
    E.audio?.stopMusic(2.5);
    E.audio?.amb('fire', 0.75, 2); E.audio?.amb('room', 0.05, 2); E.audio?.amb('wind', 0.05, 2);
    E.post.setLook({ tint: [1.15, 0.85, 0.62], exposure: 1.0, dof: 0.8 }, 0.6);
    await tween(2.4, (k) => { S.lamp = 1 - k * 0.92; });
    await tween(2.2, (k) => { E.post.fx.fade = k; });
    // ~4 s of only candle and fire
    herA.group.visible = false; her = herB; herB.group.visible = true;
    S.lamp = 0.35; S.raysBase = 0.1;
    herB.uniforms.uSize.value = 0.0075; herB.shellU.uOpacity.value = 0.45; // close-up: finer light, clearer outline
    const camA = camPose(new THREE.Vector3(herX - 0.5, 0.92, -1.72), new THREE.Vector3(herX - 0.02, 0.72, -2.2), 0.14);
    S.cam = { ...camA, pitch0: 0 };
    player.yaw = 0; player.pitch = 0; player.yawLimit = { center: 0, range: 0.35 }; player.pitchMin = -0.3; player.pitchMax = 0.3; player.canLook = true;
    S.focusOverride = new THREE.Vector3(herX - 0.02, 0.72, -2.2);
    E.post.setLook({ dof: 0.3, dofNear: 0.1, focusRange: 0.3, exposure: 0.95, tint: [1.12, 0.72, 0.6] }, 1);
    await wait(4.0);
    E.audio?.playMusic('waltz', { fadeIn: 4 });
    E.audio?.amb('fire', 0.4, 3); E.audio?.amb('wind', 0.1, 3);
    await tween(2.6, (k) => { E.post.fx.fade = 1 - k; });
    // lying beside her, closer
    await wait(0.8);
    await say('red3.her_3');
    await say('red3.him_2');
    await say('red3.her_4', { dur: 2.4 });
    await wait(0.6);
    await say('red3.narr_4');
    // he lifts his head and looks past her, to the nightstand: the bottle is open. Empty.
    bottle.liquid.visible = false;
    bottle.group.rotation.set(0, 0.5, Math.PI / 2); bottle.group.position.set(NS.x - 0.1, NS_TOP + 0.0195, NS.z + 0.12);
    bottle.cap.removeFromParent(); bottle.cap.position.set(NS.x - 0.2, NS_TOP + 0.007, NS.z + 0.17); bottle.cap.rotation.set(0, 0, 0); scene.add(bottle.cap);
    const camB = camPose(new THREE.Vector3(0.12, 1.0, -1.82), new THREE.Vector3(NS.x - 0.1, NS_TOP + 0.02, NS.z + 0.12), 0.05);
    S.focusOverride = bottle.group.position.clone();
    E.post.setLook({ dof: 0.6, focusRange: 0.1 }, 0.8);
    await moveCam(camB, 3.2);
    await say('red3.narr_5');
    await wait(0.6);
    // back to her
    S.focusOverride = new THREE.Vector3(herX - 0.02, 0.72, -2.2);
    E.post.setLook({ dof: 0.3, focusRange: 0.3 }, 0.8);
    const camC = camPose(new THREE.Vector3(herX - 0.46, 0.88, -1.78), new THREE.Vector3(herX - 0.02, 0.71, -2.2), 0.18);
    await moveCam(camC, 2.4);
    E.audio?.amb('heart', 0, 0.1);
    S.hb = { t: 0.5, int: 0.85, gain: 0.55 };
    await say('red3.narr_6');
    await say('red3.her_5');
    S.hb.int = 0.75; S.tremble = 0.25;
    await say('red3.him_3', { dur: 2.6 });
    await say('red3.her_6');
    await say('red3.him_4', { dur: 3.0 });
    // her light slowly dims; his heartbeat (and hers) slows
    const dim = (async () => {
      await tween(26, (k) => {
        herB.lightScale = 0.6 * (1 - k * 0.8); herB.opacity = 0.8 * (1 - k * 0.6);
        if (S.hb) { S.hb.int = 0.8 + k * 1.6; S.hb.gain = 0.55 * (1 - k * 0.5); }
        for (const cd of candles) cd.base = 0.55 * (1 - k * 0.35);
      }, (x) => x);
    })();
    await say('red3.her_7');
    S.tremble = 0.1;
    await say('red3.him_5');
    moveCam(camPose(new THREE.Vector3(herX - 0.38, 0.84, -1.86), new THREE.Vector3(herX - 0.02, 0.7, -2.22), 0.22), 10);
    await say('red3.her_8', { dur: 5.5 });
    await wait(3.5);
    // ABRUPT
    await hardCut();
    void dim;
  }

  return obj;
}
