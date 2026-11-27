// The road: a place stuck in time. Third person — HIM, a small dark figure walking away from the house down a
// narrow road under a tunnel of bare trees, swallowed by blue fog. The 70 m stretch loops seamlessly (Exit 8 style):
// everything along it is built with period L, so moving him + camera back by L is invisible. Each pass one detail changes.
import * as THREE from 'three';
import { E, player, wait, until, say, choose, tween, go, fadeOut, addInteract, T, input, moveAxis } from '../engine.js';
import { hdri, pbr } from '../assets.js';
import { Snow, FogCards } from '../fx/snow.js';
import { forest, terrain, fbm } from '../fx/world.js';
import { rng } from '../fx/foliage.js';
import { makeMan } from '../fx/figures.js';
import { glowTex } from '../fx/textures.js';

// ---------------- layout ----------------
// s = distance down the road = -z. Road centre x = cx(s). Everything along the loop is periodic in s with period L.
const L = 70;
const S_START = -9.4;        // his front door (he walks out of the house)
const HS = -10;              // the house (and its copy at HS + L)
const S_LAND = 8;            // where a new pass begins (S_LAND + L is the teleport line)
const S_MIN = -36, S_MAX = 160; // built extent
const ROAD_HW = 2.6;         // road half width
const TAU = Math.PI * 2;
const cx = (s) => 3.6 * Math.sin(TAU * s / L + 0.4) + 0.6 * Math.sin(2 * TAU * s / L + 1.3);
const cxd = (s) => 3.6 * TAU / L * Math.cos(TAU * s / L + 0.4) + 0.6 * 2 * TAU / L * Math.cos(2 * TAU * s / L + 1.3);
const roadYaw = (s) => Math.atan2(-cxd(s), 1); // yaw facing down the road (+s)

// periodic 2D noise along s: map s onto a circle in noise space
function pnoise(x, s, f = 0.07, o = 4) {
  const th = TAU * s / L, R = L * f / TAU;
  return fbm(x * f + 3 + R * Math.cos(th), R * Math.sin(th) + 5, o);
}
function groundH(x, z) {
  const s = -z, d = Math.abs(x - cx(s));
  const verge = THREE.MathUtils.smoothstep(d, ROAD_HW + 0.2, 7);
  const bank = 0.14 * Math.exp(-((d - ROAD_HW - 0.5) ** 2) / 0.25); // ploughed snow lip
  return -0.03 + bank + verge * (0.12 + (pnoise(x, s) - 0.5) * 0.7 + Math.max(0, d - 7) * 0.03);
}

// ---------------- periodic procedural snow (world noise wraps every L metres in z) ----------------
const PNOISE_GLSL = /* glsl */`
float rp_h(vec2 i, float N){ i.y = i.y - N*floor((i.y+0.5)/N); return fract(sin(dot(i, vec2(127.1,311.7)))*43758.5453); }
float rp_n(vec2 w, float f){ vec2 p = w*f + vec2(7.3, 0.0); float N = ${L.toFixed(1)}*f; vec2 i=floor(p), fr=fract(p); vec2 u=fr*fr*(3.0-2.0*fr);
  return mix(mix(rp_h(i,N),rp_h(i+vec2(1,0),N),u.x), mix(rp_h(i+vec2(0,1),N),rp_h(i+vec2(1,1),N),u.x), u.y); }
float rp_f(vec2 w, float k){ return rp_n(w,1.0*k)*0.55 + rp_n(w,3.0*k)*0.25 + rp_n(w,11.0*k)*0.12 + rp_n(w,37.0*k)*0.05; }`;

function loopSnowMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x2e4152, roughness: 0.86, metalness: 0, envMapIntensity: 0.6 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vSW = (modelMatrix*vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSW;\n' + PNOISE_GLSL)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { float h0 = rp_f(vSW.xz, 1.0); float e = 0.03;
        vec2 g = vec2(rp_f(vSW.xz+vec2(e,0.0),1.0)-h0, rp_f(vSW.xz+vec2(0.0,e),1.0)-h0)/e;
        normal = normalize(normal + (viewMatrix*vec4(-g.x,0.0,-g.y,0.0)).xyz*0.12); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      { float hn = rp_f(vSW.xz, 0.5); diffuseColor.rgb *= mix(vec3(0.8,0.86,0.96), vec3(1.0), smoothstep(0.2,0.7,hn)); }`);
  };
  m.customProgramCacheKey = () => 'road-loop-snow';
  return m;
}

// dark wet asphalt that disappears under snow toward its edges (uv.x across, uv.y = s/3.5 → 20 tiles per loop)
function roadMaterial() {
  const m = pbr('asphalt_snow', { repeat: 1, color: 0x2c3036, rough: 0.55, envI: 0.5 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n vRUv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vRUv;\n' + PNOISE_GLSL.replaceAll(L.toFixed(1), '20.0'))
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      float rEdge = abs(vRUv.x-0.5)*2.0;
      float rN = rp_f(vec2(vRUv.x*1.6, vRUv.y), 1.0);
      float rSnow = smoothstep(0.62, 0.95, rEdge + (rN-0.5)*0.55);
      // faint tyre lanes worn darker
      float lane = exp(-pow((rEdge-0.48)/0.09, 2.0));
      diffuseColor.rgb *= 1.0 - lane*0.25;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3,0.37,0.43), rSnow);
      roughnessFactor = mix(roughnessFactor, 0.9, rSnow);`);
  };
  m.customProgramCacheKey = () => 'road-asphalt';
  return m;
}

// worn white dash texture
function dashTex() {
  const c = document.createElement('canvas'); c.width = 32; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(3, 4, 26, 248);
  for (let i = 0; i < 260; i++) { g.clearRect(Math.random() * 32, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3); }
  g.clearRect(0, 0, 32, 3 + Math.random() * 8); g.clearRect(0, 248, 32, 8);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// two wheel grooves pressed into the snow: dark core, a thin moonlit rim on one side (RGBA)
function tracksTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
  for (const x of [15, 49]) {
    const gr = g.createLinearGradient(x - 13, 0, x + 13, 0);
    gr.addColorStop(0, 'rgba(14,26,38,0)'); gr.addColorStop(0.25, 'rgba(6,12,20,0.95)'); gr.addColorStop(0.6, 'rgba(8,16,26,0.9)');
    gr.addColorStop(0.76, 'rgba(170,200,226,0.6)'); gr.addColorStop(1, 'rgba(170,200,226,0)');
    g.fillStyle = gr; g.fillRect(x - 13, 0, 26, 256);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}

// ribbon following the road at lateral offsets [d0,d1], from s0 to s1
function ribbon(s0, s1, d0, d1, step, yOff, nAcross = 1, vScale = 1 / 3.5) {
  const nS = Math.ceil((s1 - s0) / step);
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nS; i++) {
    const s = s0 + i * step, c = cx(s);
    for (let j = 0; j <= nAcross; j++) {
      const u = j / nAcross, d = d0 + (d1 - d0) * u;
      // offset perpendicular-ish (the road is gentle; x offset is enough)
      const x = c + d, z = -s;
      pos.push(x, groundH(x, z) + yOff, z); uv.push(u, s * vScale);
    }
  }
  const w = nAcross + 1;
  for (let i = 0; i < nS; i++) for (let j = 0; j < nAcross; j++) {
    const a = i * w + j, b = a + 1, c2 = a + w, d2 = c2 + 1;
    idx.push(a, b, c2, b, d2, c2); // counter-clockwise seen from above
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export async function roadScene(opts = {}) {
  const VISIT = opts.visit === 2 ? 2 : 1;
  const scene = new THREE.Scene();
  scene.userData.soft = true;
  const fogCol = new THREE.Color(0x084d6c);
  scene.background = fogCol.clone();
  scene.fog = new THREE.FogExp2(fogCol.clone(), 0.064);
  const env = await hdri('winter_evening');
  scene.environment = env.env;
  scene.environmentIntensity = 0.06;

  // ---- light: cold sky + a soft "moon" glow far down the road (he reads as a silhouette against it) ----
  const hemi = new THREE.HemisphereLight(0x2f7a9c, 0x02070d, 0.13);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0x8fbbe6, 0.55);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  Object.assign(moon.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 140 });
  moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.05;
  scene.add(moon, moon.target);

  // ---- ground + road ----
  // vertex grid aligned to whole metres so the mesh itself is periodic in L
  const ground = terrain({ w: 96, l: S_MAX - S_MIN + 10, cx: 0, cz: -(S_MIN + S_MAX) / 2, segW: 96, segL: S_MAX - S_MIN + 10, heightFn: groundH, material: loopSnowMaterial() });
  scene.add(ground);
  const road = new THREE.Mesh(ribbon(S_MIN, S_MAX, -ROAD_HW - 0.25, ROAD_HW + 0.25, 0.5, 0.02, 6), roadMaterial());
  road.receiveShadow = true;
  scene.add(road);
  // dashed centre line: 2.2 m dashes every 5 m (14 per loop)
  {
    const g = new THREE.PlaneGeometry(0.12, 2.2); g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9dfe6, emissive: 0x24384a, roughness: 0.5, map: dashTex(), alphaTest: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
    const list = []; for (let s = S_MIN + 1; s < S_MAX; s += 5) list.push(s);
    const im = new THREE.InstancedMesh(g, mat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    list.forEach((s, i) => { q.setFromAxisAngle(up, roadYaw(s)); m4.compose(new THREE.Vector3(cx(s), groundH(cx(s), -s) + 0.03, -s), q, one); im.setMatrixAt(i, m4); });
    im.receiveShadow = true;
    scene.add(im);
  }

  // ---- the tree tunnel (one period of spots, replicated every L) ----
  const R = rng(VISIT === 2 ? 77 : 41);
  const base = [];
  const LIGHT_S = 44, LIGHT_D = 19; // the warm light among the trees (pass 2+)
  const SCARF_S = 38;
  const clearing = (s, d) => d > 2 && Math.abs(s - LIGHT_S) < 3.6 && d < LIGHT_D + 5; // a narrow gap toward the light
  function addRow(dMin, dMax, step, sMin, sMax, lean, side) {
    for (let s = 0; s < L; s += step * (0.7 + R() * 0.6)) {
      const d = side * (dMin + R() * (dMax - dMin));
      base.push({ s, d, sc: sMin + R() * (sMax - sMin), lean: lean[0] + R() * (lean[1] - lean[0]), v: Math.floor(R() * 5) });
    }
  }
  for (const side of [-1, 1]) {
    addRow(4.3, 5.6, 2.6, 0.9, 1.2, [0.04, 0.15], side);   // inner row, leaning over the road
    addRow(6.0, 9.5, 3.0, 0.8, 1.1, [0.04, 0.14], side);   // second row
    addRow(10.5, 24, 4.2, 0.6, 1.0, [0.0, 0.1], side);     // the wood behind, lost in fog
  }
  base.push({ s: SCARF_S + 0.4, d: -4.1, sc: 1.0, lean: 0.22, v: 0 }); // the tree whose low bough holds the scarf
  const spots = [];
  for (let k = -1; k <= 2; k++) {
    for (const b of base) {
      const s = b.s + k * L;
      if (s < S_MIN || s > S_MAX) continue;
      if (clearing(b.s, b.d)) continue;
      { const hs = ((b.s - HS) % L + L) % L; if ((hs < 7 || hs > L - 5) && b.d < -3.2 && b.d > -16) continue; } // the house sits here
      const x = cx(s) + b.d, z = -s;
      // lean toward the road centre: rotate the desired world lean into the instance's local frame
      const r = (b.s * 12.9898 + b.d * 78.233) % TAU; // deterministic per base spot → identical every period
      const wx = -Math.sign(b.d), wz = 0;
      const lx = wx * Math.cos(r) - wz * Math.sin(r), lz = wx * Math.sin(r) + wz * Math.cos(r);
      spots.push({ x, z, s: b.sc, r, tilt: [b.lean * lz, -b.lean * lx], v: b.v });
    }
  }
  const bark = pbr('bark_brown_02', { repeat: 1 });
  bark.color.set(0x3a3c40);
  const trees = forest({
    spots, variants: 5, seed: 23, barkMat: bark, chunk: L / 4,
    tree: { height: 17, trunkR: 0.22, depth: 4, spread: 0.6, gnarl: 0.75, upward: 0.32, arch: 0.6, twigScale: 6.0 },
    twigColor: 0x1c2026, heightFn: groundH,
  });
  scene.add(trees);
  console.log('road forest tris', trees.userData.tris, JSON.stringify(trees.userData.protoTris), 'spots', spots.length);

  // the low bough for the scarf (periodic copies so it never pops)
  const bough = (() => {
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.5, 0.16, 0.05), new THREE.Vector3(1.0, 0.22, -0.04), new THREE.Vector3(1.55, 0.36, 0.06)];
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.045, 5, false);
    const im = new THREE.InstancedMesh(g, bark, 3);
    const m4 = new THREE.Matrix4();
    for (let k = 0; k < 3; k++) { const s = SCARF_S + k * L; m4.makeTranslation(cx(s) - 3.95, groundH(cx(s) - 3.95, -s) + 1.62, -s); im.setMatrixAt(k, m4); }
    im.castShadow = true;
    return im;
  })();
  scene.add(bough);

  // ---- the house he walked out of (left of the road). It is periodic like everything else: each pass he walks past it again. ----
  const house = new THREE.Group();
  const HX = cx(HS) - 10.2;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.95 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(7, 4.2, 8), wallMat); body.position.set(0, 2.1, 0); body.castShadow = true; body.receiveShadow = true; house.add(body);
  {
    const sh = new THREE.Shape(); sh.moveTo(-4, 0); sh.lineTo(0, 2.6); sh.lineTo(4, 0); sh.lineTo(-4, 0);
    const rg = new THREE.ExtrudeGeometry(sh, { depth: 8.6, bevelEnabled: false }); rg.translate(0, 0, -4.3);
    const roof = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0xc9d3de, roughness: 0.9 })); // snow-covered
    roof.position.y = 4.2; roof.castShadow = true; house.add(roof);
    const eave = new THREE.Mesh(new THREE.BoxGeometry(8.1, 0.18, 8.7), wallMat); eave.position.y = 4.2; house.add(eave);
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.8, 0.7), wallMat); chim.position.set(-1.6, 5.6, 1.8); house.add(chim);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.1), new THREE.MeshStandardMaterial({ color: 0x0e1013, roughness: 0.8 }));
    door.rotation.y = Math.PI / 2; door.position.set(3.51, 1.05, -0.6); house.add(door);
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.18, 1.4), new THREE.MeshStandardMaterial({ color: 0x4a5866, roughness: 0.9 })); step.position.set(3.9, 0.09, -0.6); house.add(step);
  }
  // the one warm window
  const winMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff8a40, emissiveIntensity: 2.6, roughness: 1 });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.3), winMat); win.rotation.y = Math.PI / 2; win.position.set(3.51, 1.8, 2.0); house.add(win);
  const barMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 1 });
  for (const [w, h, y, z] of [[0.06, 1.34, 1.8, 2.0], [1.14, 0.06, 1.8, 2.0], [1.22, 0.1, 1.12, 2.0]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, w), barMat); b.position.set(3.53, y, z); house.add(b); }
  const winLight = new THREE.PointLight(0xffa85e, 5, 11, 1.6); winLight.position.set(4.6, 1.8, 2.0); house.add(winLight);
  const winGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffa860, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, fog: false }));
  winGlow.scale.set(3.2, 3.2, 1); winGlow.position.set(3.7, 1.8, 2.0); house.add(winGlow);
  house.position.set(HX, groundH(HX, -HS) - 0.1, -HS);
  const house2 = house.clone(); house2.position.z -= L;
  scene.add(house, house2);
  const winLights = [], winGlows = [];
  for (const h of [house, house2]) h.traverse((o) => { if (o.isPointLight) winLights.push(o); if (o.isSprite) winGlows.push(o); });
  winGlows.forEach((g) => { g.material = g.material.clone(); });
  let houseLit = VISIT === 1 ? 1 : 0;
  const setHouseLit = (k) => { houseLit = k; winMat.emissiveIntensity = 2.6 * k; winLights.forEach((l) => { l.intensity = 5 * k; }); winGlows.forEach((g) => { g.material.opacity = 0.55 * k; }); };
  setHouseLit(houseLit);

  // ---- him ----
  const him = await makeMan({ color: 0x05080c });
  // he reads as a hard silhouette against the haze: unlit near-black, only lightly fogged so he never vanishes
  const himMat = new THREE.MeshBasicMaterial({ color: 0x03060a, fog: false });
  him.root.traverse((o) => { if (o.isMesh) o.material = himMat; });
  scene.add(him.group);

  // ---- weather (boxes divide L so the loop jump is invisible) ----
  const snow = new Snow({ count: 5000, box: [24, 16, L / 3], size: 0.018, color: 0xcfe2f4, intensity: 0.9, wind: [0.25, -0.75, 0.1], turb: 0.3, streak: 0.25, fogDensity: 0.05, nearFade: 2.5 });
  scene.add(snow.mesh);
  const fogCards = new FogCards({ count: 46, box: [60, 8, L], size: 13, color: 0x3d6f96, opacity: 0.22, drift: [0.35, 0, 0.0], near: 4 });
  scene.add(fogCards.mesh);
  // far glow down the road (follows him; behind the trees, not fogged)
  const farGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0x1f8cb0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6, fog: false }));
  farGlow.scale.set(64, 40, 1); scene.add(farGlow);

  // ---- pass details ----
  // pass 2: a red scarf caught on the low bough
  const scarf = (() => {
    const g = new THREE.PlaneGeometry(0.26, 1.5, 1, 24);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = (p.getY(i) + 0.75) / 1.5; // 0..1 along the scarf
      const fold = 0.56; // where it hangs over the bough
      const side = v < fold ? -1 : 1, t = Math.abs(v - fold) * 1.5;
      p.setXYZ(i, p.getX(i), 0.04 - t * 0.98 - Math.max(0, 0.1 - t) * 0, side * (0.05 + t * 0.06) + Math.sin(t * 5) * 0.02);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xa0101a, emissive: 0x5a050a, roughness: 0.92, side: THREE.DoubleSide }));
    m.castShadow = true;
    const s = SCARF_S, x = cx(s) - 3.95 + 1.0;
    m.position.set(x, groundH(cx(s) - 3.95, -s) + 1.62 + 0.24, -s - 0.02);
    m.visible = VISIT === 2;
    return m;
  })();
  scene.add(scarf);
  const scarf2 = scarf.clone(); scarf2.position.z -= L; scene.add(scarf2); // its copy one loop ahead
  // pass 3: wheelchair tracks on the right verge (they come from the trees, follow the road, and stop)
  const tracksMat = new THREE.MeshBasicMaterial({ color: 0xa8bccf, map: tracksTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, opacity: 0 });
  const tracks = (() => {
    const s0 = 27, s1 = 63;
    const g = ribbon(s0, s1, 0, 0.8, 0.4, 0.035, 1, 1 / 1.4);
    // wander a little, and fade both ends via vertex alpha
    const p = g.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      const s = -p.getZ(i), t = (s - s0) / (s1 - s0);
      const d = 3.3 + Math.sin(s * 0.21) * 0.2 + Math.max(0, 0.15 - t) * 14; // first metres: coming out of the trees
      const u = (i % 2);
      const x = cx(s) + d + u * 0.8;
      p.setX(i, x); p.setY(i, groundH(x, -s) + 0.03);
      const a = THREE.MathUtils.smoothstep(t, 0, 0.12) * (1 - THREE.MathUtils.smoothstep(t, 0.85, 1));
      col.push(1, 1, 1, a);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    tracksMat.vertexColors = true;
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, tracksMat); m.renderOrder = 1; m.receiveShadow = true;
    return m;
  })();
  const tracks2 = tracks.clone(); tracks2.position.z -= L;
  scene.add(tracks, tracks2);
  const setTracks = (k) => { tracksMat.opacity = 0.95 * k; tracks.visible = tracks2.visible = k > 0.001; };
  setTracks(VISIT === 2 ? 1 : 0);
  // pass 2+: a faint warm light deep among the trees, off the right side — a way out
  const lightPos = new THREE.Vector3(cx(LIGHT_S) + LIGHT_D, 0, -LIGHT_S);
  lightPos.y = groundH(lightPos.x, lightPos.z) + 1.4;
  const exitLight = new THREE.PointLight(0xffb070, 0, 16, 1.5); exitLight.position.copy(lightPos); scene.add(exitLight);
  const exitGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffb877, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false }));
  exitGlow.scale.set(5, 5, 1); exitGlow.position.copy(lightPos); scene.add(exitGlow);

  // ---- state ----
  const S = {
    pass: 1, lightOn: 0, leaving: false, control: true,
    s: S_START, heading: roadYaw(S_START), vel: new THREE.Vector2(), speed: 0,
    camYaw: roadYaw(S_START), orbitYaw: 0, orbitPitch: 0,
    camPos: new THREE.Vector3(), look: new THREE.Vector3(), lastPhase: 0, onRoad: true,
  };
  const pos = him.group.position;
  const _f = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

  function landCamera() {
    const d = pos.x - cx(S.s), sc = S.s - CAM.dist, sl = S.s + CAM.ahead;
    S.camPos.set((cx(sc) + pos.x - cxd(S.s) * CAM.dist) * 0.5 + d * 0.1, pos.y + CAM.h, -sc);
    S.look.set(cx(sl) + d * 0.25, pos.y + CAM.lookH, -sl);
    E.camera.position.copy(S.camPos); E.camera.lookAt(S.look);
  }
  const CAM = { dist: 11, h: 2.4, ahead: 14, lookH: 1.45 };

  // the loop: jump him and everything that follows him back by L
  function teleport() {
    pos.z += L; S.camPos.z += L; S.look.z += L; E.camera.position.z += L;
    E.camera.updateMatrixWorld();
    S.pass++;
    onPass(S.pass);
  }
  function onPass(n) {
    if (VISIT !== 1) return;
    if (n === 2) { scarf.visible = scarf2.visible = true; S.lightOn = 1; exitUse.enabled = true; }
    if (n === 3) { setHouseLit(0); tween(2.5, (k) => setTracks(k)); }
  }
  const exitUse = addInteract({ pos: lightPos, radius: 3.0, dist: 26, label: 'p.leave_road', hold: 0, enabled: false, onUse: () => leave() });

  const obj = {
    scene, customPlayer: true, customCamera: true,
    _S: S, // test hooks (headless captures)
    get _dbg() { return { snow, fogCards, trees, him, scarf, tracks, exitGlow }; },
    enter() {
      pos.set(cx(S_START) - 4.0, 0, -S_START); pos.y = groundH(pos.x, pos.z); S.s = S_START;
      S.heading = roadYaw(S_START) - 0.5; him.group.rotation.y = S.heading; // turned a little toward the road
      S.camYaw = S.heading;
      landCamera();
      player.pos.copy(pos); player.yaw = S.heading; player.canMove = true; player.canLook = true;
      E.ui.crosshair(false);
      E.post.snapLook(LOOK);
      E.post.fx.letterbox = 0;
      E.audio?.amb('wind', 0.18, 3);
      E.audio?.setWow(10, 2);
      E.audio?.muffle(2400, 2);
      E.audio?.playMusic('loop');
      if (VISIT === 1) runVisit1(); else runVisit2();
    },
    update(dt, t) {
      // ---- input: mouse orbits a little, WASD walks relative to the camera ----
      const sens = E.settings.sens * 0.0022;
      S.orbitYaw -= input.dx * sens; S.orbitPitch -= input.dy * sens;
      input.dx = 0; input.dy = 0;
      S.orbitYaw = THREE.MathUtils.clamp(S.orbitYaw, -0.85, 0.85);
      S.orbitPitch = THREE.MathUtils.clamp(S.orbitPitch, -0.22, 0.3);
      const m = (S.control && player.canMove) ? moveAxis() : { x: 0, y: 0, run: false };
      S.fwdIn = m.y;
      // move relative to where the camera looks
      const yc = Math.atan2(-(S.look.x - S.camPos.x), -(S.look.z - S.camPos.z));
      let fx = -Math.sin(yc), fz = -Math.cos(yc);
      const rx = Math.cos(yc), rz = -Math.sin(yc);
      // on the road, "forward" follows the road's curve (the road leads him; A/D still drift him sideways)
      {
        const onRoad = (1 - THREE.MathUtils.smoothstep(Math.abs(pos.x - cx(S.s)), 3.0, 4.5));
        const tl = Math.hypot(cxd(S.s), 1), tx0 = cxd(S.s) / tl, tz0 = -1 / tl;
        const w = onRoad * (fz < 0 ? 1 : 0); // only when facing down the road
        fx += (tx0 - fx) * w; fz += (tz0 - fz) * w;
        const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      }
      const sp = m.run ? 2.3 : 1.42;
      const tx = (fx * m.y + rx * m.x) * sp, tz = (fz * m.y + rz * m.x) * sp;
      const acc = 1 - Math.exp(-dt * 5);
      S.vel.x += (tx - S.vel.x) * acc; S.vel.y += (tz - S.vel.y) * acc;
      const ox = pos.x, oz = pos.z;
      pos.x += S.vel.x * dt; pos.z += S.vel.y * dt;
      // bounds: road + verges; from pass 2 a path opens on the right toward the warm light
      {
        let s = -pos.z;
        if (s < S_START - 1) { s = S_START - 1; pos.z = -s; }
        const d = pos.x - cx(s);
        let dMax = 4.0;
        if (S.lightOn && Math.abs(s - LIGHT_S) < 6) dMax = LIGHT_D + 2;
        else if (S.lightOn && d > 4) { // already in the clearing: keep him inside it
          dMax = 999; const sc = THREE.MathUtils.clamp(s, LIGHT_S - 6, LIGHT_S + 6); pos.z = -sc; s = sc;
        }
        pos.x = cx(s) + THREE.MathUtils.clamp(d, -4.0, dMax);
      }
      if (-pos.z > S_LAND + L) teleport();
      S.s = -pos.z;
      pos.y = groundH(pos.x, pos.z);
      const moved = Math.hypot(pos.x - ox, pos.z - oz);
      const spd = moved / Math.max(dt, 1e-4);
      S.speed += (spd - S.speed) * (1 - Math.exp(-dt * 8));
      // facing follows movement
      if (spd > 0.15) {
        const want = Math.atan2(-(pos.x - ox), -(pos.z - oz));
        S.heading += Math.atan2(Math.sin(want - S.heading), Math.cos(want - S.heading)) * (1 - Math.exp(-dt * 6));
      }
      him.group.rotation.y = S.heading;
      // animation + footsteps synced to the walk cycle
      if (S.speed > 0.25) { him.play('walk', 0.35); him.acts.walk.timeScale = S.speed / 1.38; }
      else him.play('idle', 0.5);
      him.update(dt);
      const wa = him.acts.walk;
      if (wa && wa.isRunning() && wa.getEffectiveWeight() > 0.5) {
        const ph = (wa.time / wa.getClip().duration) % 1;
        const crossed = (a, b, x) => (a < x && b >= x) || (a > b && (x > a || x <= b));
        if (crossed(S.lastPhase, ph, 0.02) || crossed(S.lastPhase, ph, 0.52)) {
          const d = Math.abs(pos.x - cx(S.s));
          if (d < ROAD_HW) E.audio?.step('stone', S.speed, { gain: 0.3, send: 0.12 });
          else E.audio?.step('snow', S.speed, { gain: 0.5, send: 0.1 });
        }
        S.lastPhase = ph;
      }
      // ---- camera: on the road behind him, looking down the road (like the reference framing).
      // Off the road (walking toward the warm light) it becomes a plain chase camera behind his heading.
      const dRoad = pos.x - cx(S.s);
      const inGap = S.lightOn && Math.abs(S.s - LIGHT_S) < 6 && dRoad > 2.5;
      const wRoad = inGap ? 1 - THREE.MathUtils.smoothstep(dRoad, 2.5, 4.5) : (1 - THREE.MathUtils.smoothstep(Math.abs(dRoad), 4, 6));
      const sc = S.s - CAM.dist;
      // halfway between the spline point and the point straight behind him along the tangent: keeps him in clear view on curves
      const roadCam = _a.set((cx(sc) + pos.x - cxd(S.s) * CAM.dist) * 0.5 + dRoad * 0.1, pos.y + CAM.h, -sc);
      const sl = S.s + CAM.ahead;
      const roadLook = _b.set(cx(sl) + dRoad * 0.25, pos.y + CAM.lookH, -sl);
      // chase camera swings behind him only while he walks forward (pure strafing must not spiral).
      // In the gap toward the warm light the camera turns to face the light: guide with light, not arrows.
      if (inGap) {
        const yl = Math.atan2(-(lightPos.x - pos.x), -(lightPos.z - pos.z));
        S.camYaw += Math.atan2(Math.sin(yl - S.camYaw), Math.cos(yl - S.camYaw)) * (1 - Math.exp(-dt * 1.2));
      } else S.camYaw += Math.atan2(Math.sin(S.heading - S.camYaw), Math.cos(S.heading - S.camYaw)) * (1 - Math.exp(-dt * 1.1 * Math.max(0, S.fwdIn) * Math.min(S.speed, 1)));
      const chaseCam = _c.set(pos.x + Math.sin(S.camYaw) * CAM.dist * 0.8, pos.y + CAM.h, pos.z + Math.cos(S.camYaw) * CAM.dist * 0.8);
      const chaseLook = _d.set(pos.x - Math.sin(S.camYaw) * CAM.ahead, pos.y + CAM.lookH, pos.z - Math.cos(S.camYaw) * CAM.ahead);
      const wantPos = roadCam.lerp(chaseCam, 1 - wRoad), wantLook = roadLook.lerp(chaseLook, 1 - wRoad);
      // mouse orbit: swing the camera around him a little
      if (S.speed > 0.4) { S.orbitYaw *= Math.exp(-dt * 0.3); S.orbitPitch *= Math.exp(-dt * 0.3); }
      if (S.orbitYaw || S.orbitPitch) {
        const rel = _c.copy(wantPos).sub(pos); rel.applyAxisAngle(_up, S.orbitYaw); rel.y += S.orbitPitch * 5;
        wantPos.copy(pos).add(rel);
        const rl = _d.copy(wantLook).sub(pos); rl.applyAxisAngle(_up, S.orbitYaw); rl.y -= S.orbitPitch * 3;
        wantLook.copy(pos).add(rl);
      }
      wantPos.y = Math.max(wantPos.y, groundH(wantPos.x, wantPos.z) + 0.6);
      S.camPos.lerp(wantPos, 1 - Math.exp(-dt * 2.2));
      S.look.lerp(wantLook, 1 - Math.exp(-dt * 3));
      const cam = E.camera;
      cam.position.copy(S.camPos);
      cam.position.y += Math.sin(t * 0.7) * 0.02; // breathing handheld drift
      cam.lookAt(S.look);
      // focus on him
      E.post.look.focus = cam.position.distanceTo(pos) + 0.5;
      E.post.target.focus = E.post.look.focus;
      // ---- world that follows him ----
      moon.position.set(pos.x - 6, 22, pos.z - 70); moon.target.position.set(pos.x, 0, pos.z - 6);
      const sAhead = S.s + 40;
      farGlow.position.set(cx(sAhead), groundH(cx(sAhead), -sAhead) + 3.5, -sAhead);
      snow.update(dt, cam); fogCards.update(dt, cam);
      trees.cull(cam.position.z - 15, 30);
      player.pos.copy(pos); player.yaw = yc;
      // the warm light: faint, only when near enough, breathing. Use the copy ahead of the camera.
      const lk = (S.s - CAM.dist > LIGHT_S + 5) ? 1 : 0;
      lightPos.z = -(LIGHT_S + lk * L); exitLight.position.copy(lightPos); exitGlow.position.copy(lightPos);
      if (S.lightOn) {
        const dl = cam.position.distanceTo(lightPos);
        const vis = (1 - THREE.MathUtils.smoothstep(dl, 22, 44)) * S.lightOn;
        exitGlow.material.opacity = vis * (0.55 + 0.08 * Math.sin(t * 1.3));
        exitLight.intensity = vis * 9;
        if (!S.leaving && pos.distanceTo(_f.set(lightPos.x, pos.y, lightPos.z)) < 3.2) leave();
      }
      // scarf sways
      scarf.rotation.z = Math.sin(t * 0.9) * 0.05;
      if (E.audio?.ready) { cam.getWorldDirection(_f); E.audio.setListener(cam.position, _f, cam.up); }
    },
    exit() { E.ui.crosshair(true); },
    dispose() { scene.traverse((o) => { o.geometry?.dispose?.(); }); },
  };

  const LOOK = {
    exposure: 1.05, bloom: 0.16, halation: 0.0,
    lift: [0.0, 0.01, 0.02], gamma: [0.97, 1.0, 1.02], gain: [0.9, 1.0, 1.0],
    sat: 0.95, contrast: 1.14, tint: [0.74, 1.0, 1.0],
    vignette: 0.62, grain: 0.06, ca: 0.3,
    dof: 0.32, focus: 9.5, focusRange: 5,
  };

  // ---------------- scripts ----------------
  const passStart = (n) => until(() => S.pass >= n);
  const along = (sv) => until(() => S.pass > 0 && S.s > sv);

  async function runVisit1() {
    wait(5).then(() => { if (S.s < S_START + 1 && !S.leaving) E.ui.hint(T('p.walk')); });
    await wait(1.8);
    await say('road.narr_1');
    await say('road.him_1');
    // pass 2
    await passStart(2);
    await along(S_LAND + 7);
    await say('road.narr_2');
    // pass 3: the exit is offered
    await passStart(3);
    await along(S_LAND + 6);
    await say('road.narr_3');
    await say('road.him_2');
    for (;;) {
      if (S.leaving) return;
      const p = S.pass;
      const c = await choose(['road.c_keep', 'road.c_leave']);
      if (S.leaving) return;
      if (c === 1) { leave(); return; }
      // keep walking: one more identical pass, then ask again
      await passStart(p + 1);
      await along(S_LAND + 12);
    }
  }

  async function runVisit2() {
    await wait(1.8);
    await say('road.narr_again');
    await passStart(2);
    await along(S_LAND + 6);
    await say('road.him_stop');
    const c = await choose(['road.c_leave']);
    if (c === 0) leave();
  }

  async function leave() {
    if (S.leaving) return;
    S.leaving = true; S.control = false;
    exitUse.enabled = false;
    E.ui.hideChoices(); E.ui.hint(null);
    if (VISIT === 1) {
      // he stops; the song stops with him
      await wait(0.8);
      E.audio?.tapeStop(1.4);
      tween(1.4, (k) => { snow.timeScale = 1 - k * 0.9; fogCards.timeScale = 1 - k * 0.9; });
      await wait(1.2);
      await fadeOut(1.6, 0x000000);
      E.flags.road1 = true;
      E.audio?.muffle(18000, 1); E.audio?.setWow(6, 1.5);
      await wait(0.6);
      go('library', { spawn: 'window', fadeOut: 0 });
    } else {
      await wait(1.0);
      E.audio?.stopMusic(6);
      E.audio?.amb('wind', 0.0, 6);
      E.post.setLook({ exposure: 2.2, sat: 0.5 }, 0.35); // the blue washes out toward white
      await fadeOut(6, 0xe9ebee);
      E.audio?.muffle(18000, 1); E.audio?.setWow(6, 1.5);
      await wait(0.8);
      go('bench', { fadeOut: 0, color: 0xe9ebee });
    }
  }

  return obj;
}
