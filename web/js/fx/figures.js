// Human figures. Him/the Shadow: animated dark silhouettes (Xbot). Her: a figure made of light, baked from a posed Michelle.
import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { character, silhouette } from '../assets.js';

const DEG = Math.PI / 180;
function bone(root, name) { let b = null; root.traverse((o) => { if (o.isBone && o.name === 'mixamorig' + name) b = o; }); return b; }

// ---- poses: rotations (degrees) added on top of the rest pose, keyed by bone ----
export const POSES = {
  sit: { LeftUpLeg: [-88, 0, 4], RightUpLeg: [-88, 0, -4], LeftLeg: [92, 0, 0], RightLeg: [92, 0, 0], Spine: [4, 0, 0], LeftArm: [58, 0, -28], RightArm: [58, 0, 28], LeftForeArm: [0, 0, -55], RightForeArm: [0, 0, 55], Head: [8, 0, 0] },
  sitSlump: { LeftUpLeg: [-84, 0, 7], RightUpLeg: [-84, 0, -7], LeftLeg: [84, 0, 0], RightLeg: [84, 0, 0], Spine: [12, 0, 0], Spine1: [6, 0, 0] },
  lie: { LeftUpLeg: [0, 0, 3], RightUpLeg: [0, 0, -3], LeftArm: [72, 0, -8], RightArm: [60, 0, 30], RightForeArm: [0, 0, 60], Head: [-4, 18, 0] },
  stand: { LeftArm: [72, 0, -6], RightArm: [72, 0, 6], LeftForeArm: [0, 0, -10], RightForeArm: [0, 0, 10] },
  reach: { LeftArm: [72, 0, -6], RightArm: [20, 0, 50], RightForeArm: [0, 0, 20], Head: [8, 0, 0] },
};
export function applyPose(root, pose, restQuats) {
  for (const [name, r] of Object.entries(pose)) {
    const b = bone(root, name); if (!b) continue;
    const rest = restQuats?.get(b) || b.quaternion.clone();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'XYZ'));
    b.quaternion.copy(rest).multiply(q);
  }
  root.updateMatrixWorld(true);
}
function restPose(root, clips) {
  const tp = clips.find(c => /tpose/i.test(c.name));
  if (tp) { const m = new THREE.AnimationMixer(root); m.clipAction(tp).play(); m.update(0); }
  const map = new Map();
  root.traverse((o) => { if (o.isBone) map.set(o, o.quaternion.clone()); });
  root.updateMatrixWorld(true);
  return map;
}

// ---------------- Him / the Shadow ----------------
export async function makeMan({ color = 0x0b0c0f, height = 1.8, bulk = 1.14 } = {}) {
  const { root, clips } = await character('Xbot');
  silhouette(root, color, 0.95);
  restPose(root, clips);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  const s = height / (box.max.y - box.min.y);
  root.scale.set(s * bulk, s, s * bulk);
  const group = new THREE.Group(); group.add(root);
  const mixer = new THREE.AnimationMixer(root);
  const get = (n) => clips.find(c => c.name.toLowerCase() === n);
  const acts = {};
  for (const n of ['walk', 'idle', 'run', 'sad_pose']) { const c = get(n); if (c) acts[n] = mixer.clipAction(c); }
  // remove root motion drift on walk
  for (const a of Object.values(acts)) { a.getClip().tracks = a.getClip().tracks.filter(t => !/Hips\.position/.test(t.name) || true); }
  let cur = null;
  const man = {
    group, root, mixer, acts, speed: 0,
    play(name, fade = 0.4) { this.posed = false; const a = acts[name]; if (!a || cur === a) return; a.reset().setEffectiveWeight(1).fadeIn(fade).play(); cur?.fadeOut(fade); cur = a; },
    stopAll() { mixer.stopAllAction(); cur = null; },
    // base: an existing clip frame (e.g. 'sad_pose': arms hanging, head bowed); then bone offsets on top
    pose(p, base = 'sad_pose') {
      this.stopAll();
      const c = clips.find(c => c.name.toLowerCase() === base);
      if (c) { const a = mixer.clipAction(c); a.reset().play(); mixer.update(0.0); a.paused = true; }
      const cur = new Map(); root.traverse((o) => { if (o.isBone) cur.set(o, o.quaternion.clone()); });
      applyPose(root, POSES[p] || p, cur);
      this.posed = true;
    },
    update(dt) { if (!this.posed) mixer.update(dt); },
  };
  man.play('idle', 0);
  return man;
}

// ---------------- Her: figure of light ----------------
const HER_VS = /* glsl */`
attribute float aSeed; attribute vec3 aNormal;
uniform float uTime; uniform float uSize; uniform float uDissolve; uniform float uPixel; uniform vec3 uRise;
varying float vA; varying float vSeed;
void main(){
  vec3 p = position;
  float s = aSeed;
  // breathing shimmer
  p += aNormal * (sin(uTime*1.3 + s*30.0)*0.004 + 0.006);
  // dissolve: drift up and outward, staggered by seed
  float d = clamp(uDissolve*1.6 - s*0.6, 0.0, 1.0);
  p += (aNormal*0.8 + uRise + vec3(sin(s*91.0), 0.0, cos(s*57.0))*0.6) * d*d * 2.5;
  vec4 mv = modelViewMatrix * vec4(p,1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.55 + 0.45*sin(uTime*(1.0+s*3.0) + s*100.0);
  gl_PointSize = uSize * uPixel * (0.5 + s*0.9) * (0.7+0.6*tw) / max(-mv.z, 0.2);
  vA = tw * (1.0 - d);
  vSeed = s;
}`;
const HER_FS = /* glsl */`
uniform vec3 uColor; uniform float uOpacity;
varying float vA; varying float vSeed;
void main(){
  vec2 c = gl_PointCoord-0.5; float r = length(c)*2.0;
  float a = smoothstep(1.0, 0.0, r); a = a*a;
  a *= vA * uOpacity;
  if(a<0.004) discard;
  gl_FragColor = vec4(uColor*a, a);
}`;
const SHELL_VS = /* glsl */`
uniform float uTime;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){
  vec4 wp = modelMatrix*vec4(position + normal*0.004*sin(uTime*1.3),1.0);
  vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - wp.xyz); vP = wp.xyz;
  gl_Position = projectionMatrix*viewMatrix*wp;
}`;
const SHELL_FS = /* glsl */`
uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uDissolve;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
float h(vec3 p){ return fract(sin(dot(p,vec3(12.9,78.2,37.7)))*43758.5); }
void main(){
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(f, 2.2);
  float band = 0.5+0.5*sin(vP.y*40.0 - uTime*1.5);
  float a = (rim*0.9 + 0.08 + band*0.04) * uOpacity * (1.0 - uDissolve);
  gl_FragColor = vec4(uColor*a, a);
}`;

export async function makeHer({ pose = 'sit', color = 0xffe2b8, points = 5000, size = 0.022, opacity = 1, shellOpacity = 0.35, height = 1.66 } = {}) {
  const { root, clips } = await character('Michelle');
  const rest = restPose(root, clips);
  root.updateMatrixWorld(true);
  const restBox = new THREE.Box3().setFromObject(root, true);
  const h0 = restBox.max.y - restBox.min.y;
  // classify triangles in the rest pose: drop the two hair buns (they read as ears in light)
  const headB = bone(root, 'Head'), topB = bone(root, 'HeadTop_End');
  const hp0 = new THREE.Vector3(), tp0 = new THREE.Vector3();
  headB.getWorldPosition(hp0); topB ? topB.getWorldPosition(tp0) : tp0.copy(hp0).add(new THREE.Vector3(0, h0 * 0.12, 0));
  const HH = tp0.y - hp0.y;
  const keepTri = new Map();
  {
    const v = new THREE.Vector3();
    root.traverse((m) => {
      if (!m.isSkinnedMesh) return;
      const pos = m.geometry.attributes.position, idx = m.geometry.index;
      const rp = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); rp[i * 3] = v.x; rp[i * 3 + 1] = v.y; rp[i * 3 + 2] = v.z; }
      const keep = [];
      const n = idx ? idx.count : pos.count;
      for (let t = 0; t < n; t += 3) {
        const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
        const cx = (rp[a * 3] + rp[b * 3] + rp[c * 3]) / 3, cy = (rp[a * 3 + 1] + rp[b * 3 + 1] + rp[c * 3 + 1]) / 3, cz = (rp[a * 3 + 2] + rp[b * 3 + 2] + rp[c * 3 + 2]) / 3;
        const bun = cy > hp0.y + HH * 0.55 && Math.hypot(cx - hp0.x, cz - hp0.z) > HH * 0.42;
        if (!bun) keep.push(a, b, c);
      }
      keepTri.set(m, keep);
    });
  }
  applyPose(root, POSES[pose] || pose, rest);
  root.updateMatrixWorld(true);
  // bake skinned geometry in root space
  const geos = [];
  const v = new THREE.Vector3();
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const src = m.geometry;
    const pos = src.attributes.position;
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      m.getVertexPosition(i, v);
      v.applyMatrix4(m.matrixWorld).applyMatrix4(inv);
      out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(out, 3));
    g.setIndex(keepTri.get(m));
    g.computeVertexNormals();
    geos.push(g);
  });
  const group = new THREE.Group();
  const s = height / h0;
  const inner = new THREE.Group();
  inner.scale.setScalar(s);
  inner.position.y = -restBox.min.y * s;
  group.add(inner);
  const hips = bone(root, 'Hips'); const hp = new THREE.Vector3(); hips.getWorldPosition(hp); hp.applyMatrix4(inv);
  const hipY = hp.y * s + inner.position.y;
  const uniforms = { uTime: { value: 0 }, uSize: { value: size }, uDissolve: { value: 0 }, uPixel: { value: 900 }, uRise: { value: new THREE.Vector3(0, 1, 0) }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } };
  const shellU = { uTime: uniforms.uTime, uDissolve: uniforms.uDissolve, uColor: { value: new THREE.Color(color) }, uOpacity: { value: shellOpacity } };
  const shellMat = new THREE.ShaderMaterial({ vertexShader: SHELL_VS, fragmentShader: SHELL_FS, uniforms: shellU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide });
  // sample points across all parts, weighted by area via sampler per part (proportional count)
  let totalArea = 0; const areas = [];
  for (const g of geos) { const a = areaOf(g); areas.push(a); totalArea += a; }
  const P = [], N = [], S = [];
  const tp = new THREE.Vector3(), tn = new THREE.Vector3();
  geos.forEach((g, gi) => {
    const mesh = new THREE.Mesh(g);
    const sampler = new MeshSurfaceSampler(mesh).build();
    const n = Math.round(points * areas[gi] / totalArea);
    for (let i = 0; i < n; i++) { sampler.sample(tp, tn); P.push(tp.x, tp.y, tp.z); N.push(tn.x, tn.y, tn.z); S.push(Math.random()); }
    const shell = new THREE.Mesh(g, shellMat); shell.renderOrder = 5; inner.add(shell);
  });
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  pg.setAttribute('aNormal', new THREE.Float32BufferAttribute(N, 3));
  pg.setAttribute('aSeed', new THREE.Float32BufferAttribute(S, 1));
  const pts = new THREE.Points(pg, new THREE.ShaderMaterial({ vertexShader: HER_VS, fragmentShader: HER_FS, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false; pts.renderOrder = 6;
  inner.add(pts);
  // soft key light that she emits
  const light = new THREE.PointLight(color, 0.6, 3.5, 2);
  light.position.set(0, 1.0, 0.2);
  group.add(light);
  return {
    group, uniforms, light, shellU, hipY,
    update(dt, t) { uniforms.uTime.value = t; uniforms.uPixel.value = innerHeight * 0.9; light.intensity = (0.5 + 0.08 * Math.sin(t * 1.3)) * (1 - uniforms.uDissolve.value) * this.lightScale; },
    lightScale: 1,
    set opacity(o) { uniforms.uOpacity.value = o; shellU.uOpacity.value = shellOpacity * o; },
  };
}
function areaOf(g) {
  const p = g.attributes.position, idx = g.index; let a = 0;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const n = idx ? idx.count : p.count;
  for (let i = 0; i < n; i += 3) {
    const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
    A.fromBufferAttribute(p, i0); B.fromBufferAttribute(p, i1); C.fromBufferAttribute(p, i2);
    a += B.sub(A).cross(C.sub(A)).length() * 0.5;
  }
  return a;
}
