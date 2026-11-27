// Procedural vegetation: branching trees, instanced leaf cards (atlas + wind), daisy meadow, grass, falling leaves, butterflies.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { twigTex, daisyTex } from './textures.js';

export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// shared wind uniform
export const WIND = { uTime: { value: 0 }, uWind: { value: 1 } };
const WIND_GLSL = /* glsl */`
uniform float uTime; uniform float uWind;
vec3 windOffset(vec3 wp, float h){
  float t = uTime;
  float s = sin(t*1.7 + wp.x*0.35 + wp.z*0.2)*0.6 + sin(t*3.1 + wp.x*1.3)*0.25 + sin(t*0.6 + wp.z*0.1)*0.8;
  return vec3(s, 0.0, s*0.6) * 0.03 * h * uWind;
}`;
function patchWind(mat, heightFrom = 'uv') {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    Object.assign(sh.uniforms, WIND);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + WIND_GLSL + '\nattribute float aSway;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 wp0 = (modelMatrix * vec4(transformed,1.0)).xyz;
          #ifdef USE_INSTANCING
          wp0 = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;
          #endif
          float hh = ${heightFrom === 'uv' ? 'uv.y' : 'max(position.y,0.0)'} * aSway;
          vec3 wo = windOffset(wp0, hh);
          #ifdef USE_INSTANCING
          wo = (inverse(mat3(instanceMatrix)) * wo);
          #endif
          transformed += wo;
        }`);
  };
  mat.customProgramCacheKey = () => 'wind' + heightFrom;
}

// ---------------- branching tree ----------------
// Returns { group, tips: Vector3[] } — trunk/branches as one merged mesh, optional twig cards at tips.
export function makeTree({ seed = 1, height = 9, trunkR = 0.28, depth = 4, spread = 0.7, gnarl = 0.25, upward = 0.35, barkMat, twigs = true, twigScale = 2.6, twigColor = 0x2b2622, arch = 0 } = {}) {
  const R = rng(seed);
  const geos = [];
  const tips = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  function seg(a, b, ra, rb) {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(rb, ra, len, ra > 0.12 ? 7 : ra > 0.04 ? 5 : 3, 1, true);
    g.translate(0, len / 2, 0);
    const dir = b.clone().sub(a).normalize();
    q.setFromUnitVectors(up, dir);
    g.applyQuaternion(q);
    g.translate(a.x, a.y, a.z);
    // uv.y along length for bark repeat
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len * 0.8);
    geos.push(g);
  }
  const GOLD = 2.39996;
  let sideAng = R() * 6.28;
  function branch(p, dir, len, r, d) {
    const steps = [6, 3, 2, 2, 2][d] ?? 2;
    let cur = p.clone(), cd = dir.clone(), cr = r;
    for (let s = 0; s < steps; s++) {
      const nd = cd.clone().add(new THREE.Vector3(R() - 0.5, (R() - 0.5) * 0.5 + upward * 0.3, R() - 0.5).multiplyScalar(gnarl)).normalize();
      if (arch && d > 0) nd.add(new THREE.Vector3(Math.sign(cur.x || 1) * arch * 0.15, -arch * 0.05 * d, 0)).normalize();
      const nxt = cur.clone().addScaledVector(nd, len / steps);
      const nr = cr * (d === 0 ? 0.88 : 0.78);
      seg(cur, nxt, cr, nr);
      cur = nxt; cd = nd; cr = nr;
      if (d < depth - 1 && s >= (d === 0 ? 1 : 0)) {
        const n = d === 0 ? 2 : (R() < (d === 1 ? 0.9 : 0.6) ? 1 : 0);
        for (let i = 0; i < n; i++) {
          sideAng += GOLD;
          const side = new THREE.Vector3(Math.cos(sideAng), 0, Math.sin(sideAng));
          const bd = cd.clone().multiplyScalar(1 - spread).addScaledVector(side, spread).add(new THREE.Vector3(0, upward, 0)).normalize();
          const f = d === 0 ? (1 - s / steps) * 0.5 + 0.35 : 0.6;
          branch(cur, bd, len * f * (0.8 + R() * 0.4), cr * 0.6, d + 1);
        }
      }
    }
    if (d >= depth - 2) tips.push(cur.clone());
  }
  branch(new THREE.Vector3(0, -0.4, 0), new THREE.Vector3((R() - 0.5) * 0.1, 1, (R() - 0.5) * 0.1).normalize(), height * 0.45, trunkR, 0);
  const geo = mergeGeometries(geos, false);
  geos.forEach(g => g.dispose());
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(geo, barkMat);
  trunk.castShadow = true; trunk.receiveShadow = true;
  group.add(trunk);
  if (twigs && tips.length) {
    const quads = [];
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    for (let i = 0; i < tips.length; i++) {
      for (let k = 0; k < 2; k++) {
        const g = base.clone();
        const s = twigScale * (0.6 + R() * 0.8);
        g.scale(s, s, s);
        g.rotateY(R() * Math.PI + k * Math.PI / 2);
        g.rotateZ((R() - 0.5) * 0.9);
        g.translate(tips[i].x, tips[i].y - s * 0.2, tips[i].z);
        quads.push(g);
      }
    }
    if (quads.length) {
      const tg = mergeGeometries(quads, false);
      const tm = new THREE.MeshStandardMaterial({ map: twigTex(seed % 3), alphaTest: 0.35, side: THREE.DoubleSide, color: twigColor, roughness: 1 });
      const tw = new THREE.Mesh(tg, tm);
      tw.castShadow = true;
      group.add(tw);
      group.userData.twigMat = tm;
    }
  }
  group.userData.tips = tips;
  return group;
}

// ---------------- instanced leaf cards ----------------
// cards: [{pos:Vector3, rot:Euler|Quaternion, scale, tile, color:Color}] ; atlas grid n x n
export function leafCards({ cards, atlas, grid = 4, size = 0.12, color = 0xffffff, rough = 0.8, sway = 1, translucent = 0.35, emissive = 0x000000 }) {
  const g = new THREE.PlaneGeometry(1, 1);
  const tiles = new Float32Array(cards.length);
  const swayA = new Float32Array(cards.length);
  cards.forEach((c, i) => { tiles[i] = c.tile ?? Math.floor(Math.random() * grid * grid); swayA[i] = c.sway ?? sway; });
  const mat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.45, side: THREE.DoubleSide, color, roughness: rough, metalness: 0, emissive });
  const mesh = new THREE.InstancedMesh(g, mat, cards.length);
  mesh.geometry.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 1));
  mesh.geometry.setAttribute('aSway', new THREE.InstancedBufferAttribute(swayA, 1));
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3();
  cards.forEach((c, i) => {
    if (c.rot?.isQuaternion) qq.copy(c.rot); else qq.setFromEuler(c.rot || new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    const s = (c.scale ?? 1) * size;
    sc.set(s, s, s);
    m4.compose(c.pos, qq, sc);
    mesh.setMatrixAt(i, m4);
    if (c.color) mesh.setColorAt(i, c.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WIND, { uGrid: { value: grid }, uTrans: { value: translucent } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aTile; attribute float aSway; uniform float uGrid;\n' + WIND_GLSL)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        { vec2 cell = vec2(mod(aTile,uGrid), floor(aTile/uGrid));
          #ifdef USE_MAP
          vMapUv = vec2((uv.x + cell.x)/uGrid, (uv.y + (uGrid-1.0-cell.y))/uGrid);
          #endif
        }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec3 wp0 = (modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0)).xyz;
          vec3 wo = windOffset(wp0, 6.0*aSway) + vec3(sin(uTime*6.0+wp0.x*9.0+wp0.z*7.0), sin(uTime*5.0+wp0.y*8.0), 0.0)*0.06*aSway;
          transformed += inverse(mat3(instanceMatrix)) * wo; }`);
    // cheap translucency: light through leaves from behind
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTrans;')
      .replace('#include <opaque_fragment>', `
        #ifdef OPAQUE
        diffuseColor.a = 1.0;
        #endif
        outgoingLight += diffuseColor.rgb * uTrans * 0.6 * max(0.0, 1.0 - abs(dot(normal, normalize(-vViewPosition))));
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'leafcards' + grid;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------- daisy meadow ----------------
// Each daisy: cupped textured head (facing up-ish) + a thin stem. Instanced. Plus grass blades.
export function daisyField({ count = 12000, area = [40, 40], center = new THREE.Vector3(), exclude = null, seed = 7, headSize = 0.075, heightRange = [0.12, 0.32] }) {
  const R = rng(seed);
  // head geometry: 10-segment shallow cone with uv disc mapping
  const segs = 12, head = new THREE.BufferGeometry();
  const pos = [0, 0.012, 0], uv = [0.5, 0.5], idx = [];
  for (let i = 0; i <= segs; i++) { const a = i / segs * Math.PI * 2; pos.push(Math.cos(a) * 0.5, 0.06 - 0.0, Math.sin(a) * 0.5); uv.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5); }
  for (let i = 1; i <= segs; i++) idx.push(0, i + 1, i);
  // cup: petals droop slightly (outer ring lower than centre)
  for (let i = 1; i <= segs + 1; i++) pos[i * 3 + 1] = -0.06;
  head.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  head.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  head.setIndex(idx); head.computeVertexNormals();
  const headMat = new THREE.MeshStandardMaterial({ map: daisyTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 });
  headMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WIND);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + WIND_GLSL)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec3 wp0 = (modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0)).xyz; transformed += inverse(mat3(instanceMatrix))*windOffset(wp0, 3.0); }`);
    // petals are thin: let sun shine through + keep normals facing up for soft shading
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight += diffuseColor.rgb*0.18;\n#include <opaque_fragment>');
  };
  const heads = new THREE.InstancedMesh(head, headMat, count);
  // stems
  const stemG = new THREE.PlaneGeometry(0.0032, 1, 1, 3); stemG.translate(0, 0.5, 0);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3a5a1e, roughness: 0.8, side: THREE.DoubleSide });
  patchWind(stemMat, 'pos');
  const stems = new THREE.InstancedMesh(stemG, stemMat, count);
  const swayAttr = new Float32Array(count).fill(1);
  stems.geometry.setAttribute('aSway', new THREE.InstancedBufferAttribute(swayAttr, 1));
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const col = new THREE.Color();
  let n = 0;
  for (let i = 0; i < count * 3 && n < count; i++) {
    // clumped distribution
    const cx = (R() - 0.5) * area[0], cz = (R() - 0.5) * area[1];
    const x = center.x + cx, z = center.z + cz;
    if (exclude && exclude(x, z)) continue;
    const h = heightRange[0] + R() * (heightRange[1] - heightRange[0]);
    // head
    e.set((R() - 0.5) * 0.7 - 0.1, R() * 6.28, (R() - 0.5) * 0.7);
    qq.setFromEuler(e);
    const hs = headSize * (0.75 + R() * 0.5);
    p.set(x, center.y + h, z); s.set(hs, hs, hs);
    m4.compose(p, qq, s); heads.setMatrixAt(n, m4);
    const tint = 0.9 + R() * 0.1;
    col.setRGB(tint, tint * (0.97 + R() * 0.03), 1.0); heads.setColorAt(n, col);
    // stem
    e.set((R() - 0.5) * 0.15, R() * 6.28, (R() - 0.5) * 0.15); qq.setFromEuler(e);
    p.set(x, center.y, z); s.set(1, h, 1);
    m4.compose(p, qq, s); stems.setMatrixAt(n, m4);
    n++;
  }
  heads.count = n; stems.count = n;
  heads.instanceMatrix.needsUpdate = true; stems.instanceMatrix.needsUpdate = true;
  heads.castShadow = false; heads.receiveShadow = true; stems.receiveShadow = true;
  heads.frustumCulled = false; stems.frustumCulled = false;
  const grp = new THREE.Group(); grp.add(heads, stems);
  return grp;
}

export function grassField({ count = 60000, area = [40, 40], center = new THREE.Vector3(), exclude = null, seed = 3, height = [0.12, 0.35], colorA = 0x2f4d18, colorB = 0x86a33c, width = 0.03 }) {
  const R = rng(seed);
  // blade: 4 segments tapering, curved by shader
  const bg = new THREE.BufferGeometry();
  const P = [], U = [], I = [];
  const segs = 4;
  for (let i = 0; i <= segs; i++) { const t = i / segs, w = width * (1 - t * 0.92); P.push(-w / 2, t, 0, w / 2, t, 0); U.push(0, t, 1, t); }
  for (let i = 0; i < segs; i++) { const a = i * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  bg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  bg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  bg.setIndex(I); bg.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, side: THREE.DoubleSide });
  const cA = new THREE.Color(colorA), cB = new THREE.Color(colorB);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WIND, { uCA: { value: cA }, uCB: { value: cB } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + WIND_GLSL + '\nvarying float vH;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vH = uv.y;
        { vec3 wp0 = (modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0)).xyz;
          float bend = uv.y*uv.y;
          transformed.z += bend*0.25;
          transformed += inverse(mat3(instanceMatrix))*windOffset(wp0, 5.0*bend); }`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n objectNormal = normalize(vec3(0.0, 0.6, 1.0));');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vH; uniform vec3 uCA; uniform vec3 uCB;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mix(uCA, uCB, vH);')
      .replace('#include <opaque_fragment>', 'outgoingLight += diffuseColor.rgb*0.12*vH;\n#include <opaque_fragment>');
  };
  const mesh = new THREE.InstancedMesh(bg, mat, count);
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
  let n = 0;
  for (let i = 0; i < count * 3 && n < count; i++) {
    const x = center.x + (R() - 0.5) * area[0], z = center.z + (R() - 0.5) * area[1];
    if (exclude && exclude(x, z)) continue;
    e.set((R() - 0.5) * 0.3, R() * 6.28, 0); qq.setFromEuler(e);
    const h = height[0] + R() * (height[1] - height[0]);
    p.set(x, center.y, z); s.set(1, h, 1);
    m4.compose(p, qq, s); mesh.setMatrixAt(n, m4);
    const v = 0.75 + R() * 0.45; col.setRGB(v, v * (0.95 + R() * 0.1), v * 0.9); mesh.setColorAt(n, col);
    n++;
  }
  mesh.count = n;
  mesh.receiveShadow = true; mesh.frustumCulled = false;
  return mesh;
}

// ---------------- falling leaves / drifting things (CPU-simple, instanced) ----------------
export class Drifters {
  // kind: 'leaf' (tumbling, falling) | 'seed' (floating up/drift) | 'petal'
  constructor({ count = 120, atlas, grid = 4, size = 0.1, box = [20, 10, 20], center = new THREE.Vector3(), fall = 0.6, drift = [0.4, 0, 0.1], kind = 'leaf', color = 0xffffff, emissive = 0x000000, blending = false }) {
    this.count = count; this.box = new THREE.Vector3(...box); this.center = center.clone(); this.fall = fall; this.drift = new THREE.Vector3(...drift); this.kind = kind;
    const cards = [];
    for (let i = 0; i < count; i++) cards.push({ pos: new THREE.Vector3(), scale: 0.7 + Math.random() * 0.6, tile: Math.floor(Math.random() * grid * grid), sway: 0 });
    this.mesh = leafCards({ cards, atlas, grid, size, color, sway: 0, translucent: 0.5, emissive });
    this.mesh.castShadow = false;
    if (blending) { this.mesh.material.transparent = true; this.mesh.material.alphaTest = 0.05; this.mesh.material.depthWrite = false; }
    this.p = []; this.r = []; this.w = [];
    for (let i = 0; i < count; i++) {
      this.p.push(new THREE.Vector3((Math.random() - 0.5) * box[0], Math.random() * box[1], (Math.random() - 0.5) * box[2]).add(center));
      this.r.push(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      this.w.push(Math.random() * 10);
    }
    this.size = size; this.timeScale = 1;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
  }
  update(dt, t) {
    dt *= this.timeScale;
    for (let i = 0; i < this.count; i++) {
      const p = this.p[i], r = this.r[i], w = this.w[i];
      if (this.kind === 'seed') {
        p.x += (this.drift.x + Math.sin(t * 0.7 + w) * 0.15) * dt;
        p.y += (Math.sin(t * 0.5 + w * 2) * 0.12 + 0.03) * dt;
        p.z += (this.drift.z + Math.cos(t * 0.6 + w) * 0.12) * dt;
        r.set(Math.sin(t * 0.5 + w) * 0.3, r.y + dt * 0.2, Math.cos(t * 0.4 + w) * 0.3);
      } else {
        p.y -= this.fall * (0.7 + (w % 1) * 0.6) * dt;
        p.x += (this.drift.x + Math.sin(t * 1.5 + w) * 0.5) * dt;
        p.z += (this.drift.z + Math.cos(t * 1.2 + w) * 0.4) * dt;
        r.x += dt * (1.5 + (w % 2)); r.y += dt * 0.7; r.z += dt * Math.sin(w) * 2;
      }
      // wrap
      const c = this.center, b = this.box;
      if (p.y < c.y) { p.y += b.y; }
      if (p.y > c.y + b.y) p.y -= b.y;
      if (p.x > c.x + b.x / 2) p.x -= b.x; if (p.x < c.x - b.x / 2) p.x += b.x;
      if (p.z > c.z + b.z / 2) p.z -= b.z; if (p.z < c.z - b.z / 2) p.z += b.z;
      this._q.setFromEuler(r);
      const s = this.size * (0.7 + (w % 1) * 0.6);
      this._s.set(s, s, s);
      this._m.compose(p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------- butterflies (blue morpho) ----------------
export class Butterflies {
  constructor({ count = 6, center = new THREE.Vector3(), radius = 6, height = [0.4, 2.2], color = 0x2a7fe0 }) {
    this.group = new THREE.Group();
    this.list = [];
    const wingTex = morphoTex();
    const wg = new THREE.PlaneGeometry(0.11, 0.09); wg.translate(0.055, 0, 0);
    const mat = new THREE.MeshStandardMaterial({ map: wingTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.35, metalness: 0.3, emissive: color, emissiveIntensity: 0.15 });
    for (let i = 0; i < count; i++) {
      const b = new THREE.Group();
      const l = new THREE.Mesh(wg, mat), r = new THREE.Mesh(wg, mat);
      r.scale.x = -1;
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.004, 0.05, 2, 4), new THREE.MeshStandardMaterial({ color: 0x111111 }));
      body.rotation.z = Math.PI / 2;
      b.add(l, r, body);
      l.rotation.x = r.rotation.x = -Math.PI / 2;
      this.group.add(b);
      this.list.push({ b, l, r, ph: Math.random() * 10, c: center.clone().add(new THREE.Vector3((Math.random() - 0.5) * radius, 0, (Math.random() - 0.5) * radius)), rad: 1 + Math.random() * 2, h: height[0] + Math.random() * (height[1] - height[0]), sp: 0.3 + Math.random() * 0.4 });
    }
    this.timeScale = 1;
  }
  update(dt, t) {
    for (const o of this.list) {
      o.ph += dt * o.sp * this.timeScale;
      const a = o.ph;
      const x = o.c.x + Math.cos(a) * o.rad + Math.sin(a * 2.3) * 0.4, z = o.c.z + Math.sin(a * 1.3) * o.rad;
      const y = o.h + Math.sin(a * 3.1) * 0.3;
      const nx = o.c.x + Math.cos(a + 0.05) * o.rad + Math.sin((a + 0.05) * 2.3) * 0.4, nz = o.c.z + Math.sin((a + 0.05) * 1.3) * o.rad;
      o.b.position.set(x, y, z);
      o.b.rotation.y = Math.atan2(nx - x, nz - z) - Math.PI / 2;
      const flap = Math.sin(t * 18 * this.timeScale + o.ph * 5) * 1.0;
      o.l.rotation.y = -0.2 - flap * 0.9; o.r.rotation.y = 0.2 + flap * 0.9;
      o.l.rotation.x = -Math.PI / 2; o.r.rotation.x = -Math.PI / 2;
    }
  }
}
function morphoTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
  g.translate(4, 64);
  g.beginPath(); g.moveTo(0, -4); g.bezierCurveTo(40, -70, 120, -60, 118, -18); g.bezierCurveTo(116, 4, 70, 10, 60, 8); g.bezierCurveTo(80, 30, 70, 60, 30, 56); g.bezierCurveTo(10, 50, 0, 20, 0, 4); g.closePath();
  const gr = g.createRadialGradient(20, 0, 5, 40, 0, 110);
  gr.addColorStop(0, '#0b1a40'); gr.addColorStop(0.25, '#1f63d8'); gr.addColorStop(0.6, '#47a6ff'); gr.addColorStop(0.85, '#1c3f8a'); gr.addColorStop(1, '#05070c');
  g.fillStyle = gr; g.fill();
  g.strokeStyle = '#05070c'; g.lineWidth = 6; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.8)'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(90 + i * 4, -30 + i * 6, 2, 0, 6.28); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
