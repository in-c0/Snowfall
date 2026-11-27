// Memory · park ("first meeting"). Autumn, Japanese maples, a red carpet of fallen leaves.
// First person: he stands behind her wheelchair and pushes (hold W) along a curving path while the
// conversation plays. Ends in a swell of light → white → library (spawn 'book').
import * as THREE from 'three';
import { E, player, wait, until, say, tween, go, fadeOut, T, input } from '../engine.js';
import { hdri, model, pbr, setRepeat } from '../assets.js';
import { leafCards, Drifters, WIND, rng } from '../fx/foliage.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrain, fbm } from '../fx/world.js';
import { makeHer } from '../fx/figures.js';
import { mapleAtlas, leafAtlas, glowTex } from '../fx/textures.js';

// ---------------------------------------------------------------- layout
// Ground: almost flat, a soft roll so the leaf carpet catches light unevenly.
function groundH(x, z) { return (fbm(x * 0.06 + 3, z * 0.06) - 0.5) * 0.5 + (fbm(x * 0.5, z * 0.5) - 0.5) * 0.05; }

// The path: gentle S-curve heading -z. Arc-length parameterised (getPointAt).
const PATH = new THREE.CatmullRomCurve3([
  [0, 0, 4], [0, 0, 0], [0.8, 0, -12], [-1.6, 0, -26], [-3.4, 0, -40], [-1.2, 0, -55], [2.4, 0, -68], [3.2, 0, -82], [1.0, 0, -96], [-1.5, 0, -110],
].map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
const PATH_LEN = PATH.getLength();
const S0 = 4.2; // wheelchair starts this far along the curve (the first point is a lead-in)
const _pp = new THREE.Vector3(), _pt = new THREE.Vector3();
function pathAt(s) { const u = THREE.MathUtils.clamp(s / PATH_LEN, 0, 1); PATH.getPointAt(u, _pp); PATH.getTangentAt(u, _pt); return { p: _pp.clone(), t: _pt.clone().setY(0).normalize() }; }
function headingOf(t) { return Math.atan2(-t.x, -t.z); } // yaw whose forward (-sinY, -cosY) equals t
// distance from (x,z) to the path centre-line (sampled; fine for layout)
const PATH_SAMPLES = PATH.getSpacedPoints(400);
function pathDist(x, z) { let d = 1e9; for (const p of PATH_SAMPLES) d = Math.min(d, (p.x - x) ** 2 + (p.z - z) ** 2); return Math.sqrt(d); }

// Her pose: seated upright, thighs level on the seat, shins down to the footrest, hands folded on her lap
// over the book. (Euler offsets on Michelle's mixamo rig; verified numerically: hands meet at lap height.)
const SIT_POSE = {
  LeftUpLeg: [86, 0, -4], RightUpLeg: [86, 0, 4],
  LeftLeg: [-84, 0, 0], RightLeg: [-84, 0, 0],
  LeftArm: [76, 0, 18], RightArm: [76, 0, -18],
  LeftForeArm: [0, 25, 80], RightForeArm: [0, -25, -80],
  Spine: [3, 0, 0], Head: [5, 0, 0],
};

export async function parkScene() {
  const scene = new THREE.Scene();
  const R = rng(4242);

  // ---------------------------------------------------------------- sky, light
  const env = await hdri('autumn_park');
  scene.environment = env.env;
  scene.environmentIntensity = 0.55;
  // no sky in frame: the far distance dissolves into a warm, low-sun haze
  const hazeCol = new THREE.Color(0x2e3418);
  scene.fog = new THREE.FogExp2(hazeCol, 0.009);
  // sky dome: warm haze, glowing toward the low sun (seen only through gaps in the canopy, always blurred)
  const SUN_DIR = new THREE.Vector3(0.45, 0.32, -1).normalize();
  {
    const g = new THREE.SphereGeometry(400, 32, 16);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: SUN_DIR }, uHaze: { value: hazeCol }, uGlow: { value: new THREE.Color(0xf0b060) } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uSun; uniform vec3 uHaze; uniform vec3 uGlow; varying vec3 vD;
        void main(){ float s = max(dot(normalize(vD), uSun), 0.0);
          vec3 c = mix(uHaze*1.2, uGlow*0.9, pow(s, 4.0)) + uGlow * pow(s, 40.0) * 2.0;
          c = mix(c, uHaze*0.9, smoothstep(0.1, -0.05, vD.y));
          gl_FragColor = vec4(c, 1.0); }`,
    });
    const sky = new THREE.Mesh(g, m); sky.frustumCulled = false; sky.renderOrder = -10;
    scene.add(sky); scene.userData.sky = sky;
  }

  const hemi = new THREE.HemisphereLight(0xffd7a8, 0x5a2a12, 0.55);
  scene.add(hemi);
  // low warm sun, ahead and to the right: the canopy is lit from behind as he looks down the path
  const sun = new THREE.DirectionalLight(0xffb870, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 140 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  // soft fill from the camera side so the back of the chair isn't a black hole
  const fill = new THREE.DirectionalLight(0xffcf9a, 0.35);
  fill.position.set(-0.3, 0.6, 1); scene.add(fill);

  // ---------------------------------------------------------------- ground
  const gmat = pbr('dry_decay_leaves', { repeat: 1, color: 0xd0583a, normalScale: 1.2 });
  setRepeat(gmat, 40, 60);
  const ground = terrain({ w: 90, l: 150, cx: 0, cz: -50, segW: 90, segL: 150, heightFn: groundH, material: gmat });
  scene.add(ground);
  // trodden path: a slightly darker, browner ribbon following the curve
  {
    const pts = PATH.getSpacedPoints(300), P = [], U = [], I = [];
    const W = 1.15;
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const t = b.clone().sub(a).setY(0).normalize(), n = new THREE.Vector3(-t.z, 0, t.x);
      if (i) acc += pts[i].distanceTo(pts[i - 1]);
      for (const sgn of [-1, 1]) {
        const x = pts[i].x + n.x * W * sgn, z = pts[i].z + n.z * W * sgn;
        P.push(x, groundH(x, z) + 0.012, z); U.push(sgn * 0.5 + 0.5, acc / 2.2);
      }
      if (i) { const k = i * 2; I.push(k - 2, k, k - 1, k - 1, k, k + 1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I); g.computeVertexNormals();
    const pm = pbr('forest_leaves_02', { repeat: 1, color: 0xc48a62 });
    pm.transparent = true; pm.depthWrite = false;
    pm.polygonOffset = true; pm.polygonOffsetFactor = -2;
    // feather the edges of the ribbon
    pm.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n diffuseColor.a *= smoothstep(0.0, 0.35, vMapUv.x) * smoothstep(1.0, 0.65, vMapUv.x) * 0.85;');
    };
    const pathMesh = new THREE.Mesh(g, pm); pathMesh.receiveShadow = true; pathMesh.renderOrder = 1;
    scene.add(pathMesh);
  }

  // ---------------------------------------------------------------- maples
  const maple = mapleAtlas();
  const bark = pbr('bark_brown_02', { repeat: 1, color: 0xd8c4a8, normalScale: 0.4 });
  // atlas tiles grouped by hue (see textures.js palette): crimson → red → orange → gold
  const HUE_TILES = [[0, 5, 8, 13], [1, 4, 7, 9, 12, 15], [2, 10], [3, 11], [6, 14]];
  const tileFor = (h) => { const g = HUE_TILES[THREE.MathUtils.clamp(Math.round(h * 4), 0, 4)]; return g[Math.floor(R() * g.length)]; };
  const barkGeos = [];
  const _e = new THREE.Euler(), _q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  function limb(a, b, ra, rb) {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(rb, ra, len, ra > 0.08 ? 7 : ra > 0.025 ? 4 : 3, 1, true);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(_q.setFromUnitVectors(UP, b.clone().sub(a).normalize()));
    g.translate(a.x, a.y, a.z);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len * 1.2);
    barkGeos.push(g);
  }
  // A Japanese maple: short trunk splitting low into a few leaders that lean out, then branch
  // into near-horizontal arms; leaves sit in flat, overlapping layers along the outer twigs.
  function addMaple(x, z, { scale = 1, hue = 0.4, leaves = 9000, seed = 1, lean = null, trunkH = 0.85 } = {}) {
    const r = rng(seed * 977 + 13);
    const base = new THREE.Vector3(x, groundH(x, z) - 0.05, z);
    let ymin = 1e9, ymax = -1e9;
    const leafSpots = []; // [pos, size, isEnd]
    function grow(p, dir, len, rad, lvl) {
      const steps = lvl === 0 ? 2 : 3;
      let cur = p.clone(), d = dir.clone(), cr = rad;
      for (let s = 0; s < steps; s++) {
        // outer limbs sag toward the horizontal: the layered silhouette
        const sag = lvl >= 1 ? 0.18 * lvl : 0;
        d.add(new THREE.Vector3((r() - 0.5) * 0.35, (r() - 0.5) * 0.2 - sag * d.y, (r() - 0.5) * 0.35)).normalize();
        const nxt = cur.clone().addScaledVector(d, len / steps);
        const nr = cr * (lvl === 0 ? 0.8 : 0.66);
        limb(cur, nxt, cr, Math.max(nr, 0.006));
        if (lvl >= 1) leafSpots.push([cur.clone().lerp(nxt, 0.5), (lvl === 1 ? 0.5 : 0.45) * scale, false]);
        cur = nxt; cr = nr;
        if (lvl < 3) {
          const kids = lvl === 0 ? 0 : (r() < 0.75 ? 1 : 0) + (lvl === 1 && r() < 0.5 ? 1 : 0);
          for (let k = 0; k < kids; k++) {
            const side = new THREE.Vector3(r() - 0.5, 0, r() - 0.5).normalize();
            const nd = d.clone().multiplyScalar(0.55).addScaledVector(side, 0.75);
            nd.y = nd.y * 0.45 + 0.08; nd.normalize();
            grow(cur, nd, len * (0.55 + r() * 0.25), cr * 0.62, lvl + 1);
          }
        }
      }
      if (lvl >= 2) leafSpots.push([cur.clone(), (lvl === 3 ? 0.8 : 0.65) * scale, true]);
      else {
        // leaders end in a fan of arms
        const n = 2 + Math.floor(r() * 2);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * 6.28 + r();
          const nd = new THREE.Vector3(Math.cos(a), 0.15 + r() * 0.25, Math.sin(a)).add(d.clone().multiplyScalar(0.6)).normalize();
          grow(cur, nd, len * (0.6 + r() * 0.3), cr * 0.7, lvl + 1);
        }
      }
    }
    // trunk
    const trunkTop = base.clone().add(new THREE.Vector3((r() - 0.5) * 0.25, (trunkH + r() * 0.5) * scale, (r() - 0.5) * 0.25));
    limb(base, trunkTop, 0.17 * scale, 0.13 * scale);
    const leaders = 3 + Math.floor(r() * 2);
    const a0 = r() * 6.28;
    for (let i = 0; i < leaders; i++) {
      const a = a0 + (i / leaders) * 6.28 + (r() - 0.5) * 0.6;
      const tilt = 0.45 + r() * 0.35;
      const d = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
      if (lean) d.add(lean).normalize();
      grow(trunkTop, d, (1.6 + r() * 0.9) * scale, 0.085 * scale, 0);
    }
    for (const [p] of leafSpots) { ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y); }
    // leaf pads: flattened clusters, thicker at branch ends (ends weigh 3x)
    const wsum = leafSpots.reduce((a, l) => a + (l[2] ? 3 : 1), 0);
    const cards = [];
    for (const [p, rad, isEnd] of leafSpots) {
      const n = Math.round(leaves * (isEnd ? 3 : 1) / wsum);
      for (let i = 0; i < n; i++) {
        const a = r() * 6.28, rr = Math.sqrt(r()) * rad;
        const pos = new THREE.Vector3(p.x + Math.cos(a) * rr, p.y + (r() - 0.35) * rad * 0.42 - rr * rr * 0.3, p.z + Math.sin(a) * rr);
        // leaves held flat, palms up, with flutter
        _e.set(-Math.PI / 2 + (r() - 0.5) * 1.1, r() * 6.28, (r() - 0.5) * 0.9, 'YXZ');
        const hk = THREE.MathUtils.clamp((pos.y - ymin) / Math.max(ymax - ymin, 0.1), 0, 1);
        // sunnier (higher, outer) leaves drift toward gold; inner/lower ones stay crimson
        const h = THREE.MathUtils.clamp(hue + (hk - 0.5) * 0.55 + (r() - 0.5) * 0.4, 0, 1);
        const v = 0.7 + r() * 0.35 + hk * 0.2;
        cards.push({ pos, rot: new THREE.Quaternion().setFromEuler(_e), scale: 0.8 + r() * 0.6, tile: tileFor(h), color: new THREE.Color(v, v * (0.9 + h * 0.12), v * 0.88), sway: 0.5 + r() * 0.6 });
      }
    }
    // shuffle so drawing only the first N instances thins the crown evenly (distance LOD)
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    // one instanced mesh per tree so off-screen trees (and their shadows) are culled
    const m = leafCards({ cards, atlas: maple, size: 0.19, rough: 0.7, translucent: 0.9 });
    m.frustumCulled = true; m.computeBoundingSphere(); m.boundingSphere.radius += 0.3;
    m.userData.full = cards.length; m.userData.c = new THREE.Vector3(x, 0, z);
    scene.add(m); crowns.push(m); leafTotal += cards.length;
  }
  const crowns = []; let leafTotal = 0;
  // the hero tree, right behind her chair in the opening frame (the photograph), then a grove down the path
  const SP = pathAt(S0).p;
  addMaple(SP.x + 1.25, SP.z + 2.3, { scale: 1.05, hue: 0.62, leaves: 24000, seed: 3, trunkH: 1.5, lean: new THREE.Vector3(-0.3, 0, -0.2) });
  addMaple(SP.x - 3.4, SP.z + 3.0, { scale: 1.0, hue: 0.08, leaves: 15000, seed: 7, lean: new THREE.Vector3(0.3, 0, -0.1) });
  addMaple(SP.x + 4.2, SP.z + 4.5, { scale: 0.95, hue: 0.42, leaves: 8000, seed: 19 });
  addMaple(SP.x - 6.5, SP.z + 7.5, { scale: 1.1, hue: 0.78, leaves: 5000, seed: 23 });
  addMaple(SP.x + 7.5, SP.z - 2.0, { scale: 1.0, hue: 0.2, leaves: 6000, seed: 29 });
  const groveS = [8, 14, 20, 27, 33, 40, 47, 54, 61, 68, 76, 84, 92, 100];
  groveS.forEach((s, i) => {
    const { p, t } = pathAt(S0 + s);
    const n = new THREE.Vector3(-t.z, 0, t.x);
    const side = i % 2 ? 1 : -1;
    const off = 2.2 + R() * 1.6;
    // lean the canopy over the path
    addMaple(p.x + n.x * off * side, p.z + n.z * off * side, { scale: 0.9 + R() * 0.3, hue: [0.1, 0.55, 0.3, 0.8, 0.2, 0.65][i % 6], leaves: 6000, seed: 30 + i * 3, lean: n.clone().multiplyScalar(-side * 0.35) });
    // the other side of the path, a little further out
    const off2 = 3.4 + R() * 2.5;
    const q = pathAt(S0 + s + 3.5);
    const n2 = new THREE.Vector3(-q.t.z, 0, q.t.x);
    addMaple(q.p.x - n2.x * off2 * side, q.p.z - n2.z * off2 * side, { scale: 0.9 + R() * 0.3, hue: R(), leaves: 4000, seed: 90 + i, lean: n2.clone().multiplyScalar(side * 0.3) });
    // and a scattered back row
    if (i % 2 === 0) {
      const off3 = 8 + R() * 3, sd = R() < 0.5 ? 1 : -1;
      addMaple(p.x + n.x * off3 * sd, p.z + n.z * off3 * sd, { scale: 1.0 + R() * 0.3, hue: R(), leaves: 2200, seed: 150 + i });
    }
  });
  const barkGeo = mergeGeometries(barkGeos, false); barkGeos.forEach((g) => g.dispose());
  const trunks = new THREE.Mesh(barkGeo, bark); trunks.castShadow = true; trunks.receiveShadow = true;
  scene.add(trunks);
  console.log('park: maple leaves', leafTotal, 'bark tris', barkGeo.index.count / 3);

  // ---------------------------------------------------------------- distant tree wall (dark green, gives the bokeh something to blur)
  {
    const cards = [];
    const green = leafAtlas();
    for (let s = -10; s < PATH_LEN + 10; s += 2.6) {
      const { p, t } = pathAt(THREE.MathUtils.clamp(s, 0, PATH_LEN));
      const n = new THREE.Vector3(-t.z, 0, t.x);
      for (const side of [-1, 1]) {
        const off = 11 + R() * 7;
        const cx = p.x + n.x * off * side + (s < 0 ? 0 : 0), cz = p.z + n.z * off * side + Math.min(s, 0);
        const cy = 3.5 + R() * 3, rad = 3 + R() * 2;
        const warm = R() < 0.18; // the odd ginkgo/yellow tree
        for (let i = 0; i < 260; i++) {
          const u = R() * 6.28, w = Math.acos(2 * R() - 1);
          const pos = new THREE.Vector3(cx + Math.sin(w) * Math.cos(u) * rad, Math.max(cy + Math.cos(w) * rad * 0.8, 0.6), cz + Math.sin(w) * Math.sin(u) * rad);
          const v = 0.3 + R() * 0.3;
          cards.push({ pos, rot: new THREE.Euler(R() * 6, R() * 6, R() * 6), scale: 1, color: warm ? new THREE.Color(v * 2.0, v * 1.5, v * 0.3) : new THREE.Color(v * 0.3, v * 0.5, v * 0.16), sway: 0.2 });
        }
      }
    }
    // behind the start, too
    for (let i = 0; i < 6; i++) {
      const cx = -15 + i * 6 + R() * 2, cz = SP.z + 16 + R() * 4, cy = 4 + R() * 2, rad = 3.5;
      for (let k = 0; k < 260; k++) {
        const u = R() * 6.28, w = Math.acos(2 * R() - 1);
        const v = 0.3 + R() * 0.3;
        cards.push({ pos: new THREE.Vector3(cx + Math.sin(w) * Math.cos(u) * rad, cy + Math.cos(w) * rad * 0.8, cz + Math.sin(w) * Math.sin(u) * rad), rot: new THREE.Euler(R() * 6, R() * 6, R() * 6), scale: 1, color: new THREE.Color(v * 0.5, v * 0.75, v * 0.3), sway: 0.2 });
      }
    }
    const wall = leafCards({ cards, atlas: green, size: 0.9, rough: 0.9, translucent: 0.3 });
    wall.castShadow = false; wall.receiveShadow = false;
    scene.add(wall);
  }

  // ---------------------------------------------------------------- the leaf carpet
  {
    const cards = [];
    const N = 42000;
    for (let i = 0; i < N * 2 && cards.length < N; i++) {
      // band around the path, denser near it (that's where the camera looks)
      const s = R() * (PATH_LEN - 2) + 1;
      const { p, t } = pathAt(s);
      const n = new THREE.Vector3(-t.z, 0, t.x);
      const lat = (R() - 0.5) * 2 * (1.5 + Math.pow(R(), 2) * 9);
      const x = p.x + n.x * lat, z = p.z + n.z * lat;
      // fewer on the trodden centre (two faint wheel ruts)
      const d = Math.abs(lat);
      if (d < 0.9 && R() < 0.55) continue;
      _e.set(-Math.PI / 2 + (R() - 0.5) * 0.5, 0, R() * 6.28, 'XYZ');
      const h = R();
      const v = 0.4 + R() * 0.65;
      cards.push({ pos: new THREE.Vector3(x, groundH(x, z) + 0.012 + R() * 0.03, z), rot: new THREE.Quaternion().setFromEuler(_e), scale: 0.8 + R() * 0.7, tile: tileFor(h * 0.85), color: new THREE.Color(v, v * 0.9, v * 0.85), sway: 0 });
    }
    const carpet = leafCards({ cards, atlas: maple, size: 0.12, rough: 0.85, sway: 0, translucent: 0.1 });
    carpet.castShadow = false;
    scene.add(carpet);
  }

  // ---------------------------------------------------------------- hedges (background, DOF-blurred)
  {
    const blobs = [];
    const hedgeCards = [];
    const green = leafAtlas();
    const place = (x, z, sx, sy, sz) => {
      const g = new THREE.IcosahedronGeometry(1, 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
        const k = 1 + (fbm(vx * 2 + x, vz * 2 + vy + z) - 0.5) * 0.5;
        p.setXYZ(i, vx * sx * k, Math.max(vy, -0.2) * sy * k, vz * sz * k);
      }
      g.computeVertexNormals(); g.translate(x, groundH(x, z) + sy * 0.55, z);
      blobs.push(g);
      for (let i = 0; i < 170 * sx; i++) {
        const a = R() * 6.28, b = R() * 1.4;
        const pos = new THREE.Vector3(x + Math.cos(a) * Math.cos(b) * sx * 1.02, groundH(x, z) + sy * 0.55 + Math.sin(b) * sy * 0.95, z + Math.sin(a) * Math.cos(b) * sz * 1.02);
        _e.set(R() * 6, R() * 6, R() * 6);
        const v = 0.35 + R() * 0.35;
        hedgeCards.push({ pos, rot: _e.clone(), scale: 1 + R(), color: new THREE.Color(v * 0.42, v * 0.72, v * 0.26), sway: 0.3 });
      }
    };
    // rows on both sides of the path, ~8–12 m out, plus behind the start
    for (let s = -6; s < PATH_LEN; s += 2.6) {
      const { p, t } = pathAt(Math.max(s, 0));
      const n = new THREE.Vector3(-t.z, 0, t.x);
      for (const side of [-1, 1]) {
        const off = 8.5 + fbm(s * 0.1, side * 3) * 5;
        place(p.x + n.x * off * side + (s < 0 ? 0 : 0), p.z + n.z * off * side + (s < 0 ? -s * 0 : 0), 1.8 + R() * 0.8, 0.9 + R() * 0.5, 1.3 + R() * 0.5);
      }
    }
    for (let x = -12; x <= 12; x += 2.4) place(x, SP.z + 11 + R() * 2, 1.8 + R() * 0.8, 0.9 + R() * 0.6, 1.4);
    const hg = mergeGeometries(blobs, false);
    const hm = pbr('leafy_grass', { repeat: 1, color: 0x3a5a22 });
    setRepeat(hm, 3, 3);
    const hedge = new THREE.Mesh(hg, hm); hedge.receiveShadow = true;
    scene.add(hedge);
    const hc = leafCards({ cards: hedgeCards, atlas: green, size: 0.2, rough: 0.8, translucent: 0.4 });
    hc.castShadow = false;
    scene.add(hc);
  }

  // ---------------------------------------------------------------- bokeh glints (sun through far leaves)
  const glints = new THREE.Group();
  {
    const mat = new THREE.SpriteMaterial({ map: glowTex(), color: 0xffc070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, fog: false });
    for (let i = 0; i < 70; i++) {
      const s = R() * PATH_LEN;
      const { p, t } = pathAt(s);
      const n = new THREE.Vector3(-t.z, 0, t.x);
      const lat = (R() - 0.5) * 22;
      const sp = new THREE.Sprite(mat);
      sp.position.set(p.x + n.x * lat, 1.2 + R() * 4.5, p.z + n.z * lat - 4);
      const k = 0.15 + R() * 0.3; sp.scale.set(k, k, 1);
      glints.add(sp);
    }
  }
  scene.add(glints);

  // ---------------------------------------------------------------- falling leaves
  const fall = new Drifters({ count: 220, atlas: maple, size: 0.1, box: [18, 9, 18], fall: 0.55, drift: [0.35, 0, 0.12] });
  scene.add(fall.mesh);

  // ---------------------------------------------------------------- the wheelchair, her, the book
  const cart = new THREE.Group(); // local forward = -z
  scene.add(cart);
  const chair = await model('wheelchair_01');
  const cb = new THREE.Box3().setFromObject(chair);
  chair.rotation.y = Math.PI; // the scan faces +z; turn it to face down the path
  chair.position.y = -cb.min.y;
  cart.add(chair);
  const SEAT_Y = 0.5, SEAT_Z = 0.04; // seat surface height / centre (cart-local)
  const her = await makeHer({ pose: SIT_POSE, color: 0xffe2b8, points: 6500, size: 0.015, opacity: 1.0, shellOpacity: 0.32 });
  her.group.rotation.y = Math.PI; // Michelle faces +z
  her.group.position.set(0, SEAT_Y - her.hipY + 0.1, SEAT_Z + 0.08);
  cart.add(her.group);
  // the book on her lap: hard cover + cream page block, slightly askew
  const book = new THREE.Group();
  {
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.028, 0.23), new THREE.MeshStandardMaterial({ color: 0x5a1a14, roughness: 0.6 }));
    const pages = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.022, 0.222), new THREE.MeshStandardMaterial({ color: 0xeee2c8, roughness: 0.9 }));
    pages.position.x = 0.007;
    book.add(cover, pages);
    book.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
  // her-local (she faces +z): on her thighs, under her hands
  book.position.set(0.0, 1.1, 0.24);
  book.rotation.set(-0.06, 0.25, 0.02);
  her.group.add(book);

  // ---------------------------------------------------------------- state
  const S = {
    s: S0,            // wheelchair arc position
    v: 0,             // push speed
    pushOn: false, maxV: 0.85, speedK: 1,
    lookYaw: 0, lookPitch: 0, basePitch: -0.13, upLook: 0,
    camMode: 'establish', blend: 0,
    stepAcc: 0, bob: 0, swirl: 0, ending: 0,
  };
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();

  function cartTransform() {
    const { p, t } = pathAt(S.s);
    cart.position.set(p.x, groundH(p.x, p.z), p.z);
    cart.rotation.y = headingOf(t);
    return { p, t };
  }

  // chair-local orbit point → world (a=0 directly behind; ±π in front)
  function orbit(a, r, h) {
    const local = new THREE.Vector3(Math.sin(a) * r, h, Math.cos(a) * r);
    return local.applyAxisAngle(new THREE.Vector3(0, 1, 0), cart.rotation.y).add(cart.position);
  }

  const obj = {
    scene, customPlayer: true, customCamera: true,
    dbg: { cart: () => cart, her: () => her, S: () => S },
    async enter() {
      player.canMove = false; player.canLook = true;
      player.pos.set(0, 0, 0);
      E.ui.crosshair(false);
      E.post.snapLook({
        exposure: 0.95, bloom: 0.07, halation: 0.1,
        focus: 3.0, focusRange: 1.6, dof: 0.6, dofNear: 0.1,
        lift: [0.03, 0.012, 0.0], gamma: [1.0, 1.0, 1.04], gain: [1.08, 0.98, 0.86], sat: 1.15, contrast: 1.12, tint: [1.04, 0.99, 0.92],
        vignette: 0.42, ca: 0.25, grain: 0.04,
        rays: 0.0, raysTint: [1.0, 0.72, 0.4], raysThreshold: 0.9, raysDecay: 0.95, raysLen: 0.7, raysSky: 0.0, raysLight: [0.7, 0.75],
      });
      E.post.fx.letterbox = 0;
      E.audio?.amb('birds', 0.28, 4);
      E.audio?.amb('wind', 0.08, 4);
      E.audio?.playMusic('her');
      cartTransform();
      run();
    },
    update(dt, t) {
      WIND.uTime.value = t;
      WIND.uWind.value = 0.8 + S.swirl * 2.2;
      // ---- input: mouse look (bounded), W to push
      const sens = E.settings.sens * 0.0022;
      if (player.canLook) { S.lookYaw -= input.dx * sens; S.lookPitch -= input.dy * sens; }
      input.dx = 0; input.dy = 0;
      S.lookYaw = THREE.MathUtils.clamp(S.lookYaw, -1.05, 1.05);
      S.lookPitch = THREE.MathUtils.clamp(S.lookPitch, -0.55, 0.75);
      const k = input.keys;
      const wantPush = S.pushOn && (k.has('KeyW') || k.has('ArrowUp') || (input.touchMove && input.touchMove.y < -0.3));
      const target = wantPush ? S.maxV * S.speedK : 0;
      S.v += (target - S.v) * (1 - Math.exp(-dt * (wantPush ? 1.6 : 2.4)));
      const endS = PATH_LEN - 3;
      if (S.s > endS - 6) S.v *= THREE.MathUtils.clamp((endS - S.s) / 6, 0, 1); // ease to a stop at the end of the path
      const ds = S.v * dt;
      S.s += ds;
      S.pushed = (S.pushed || 0) + ds;
      player.moved = S.pushed;
      player.currentSpeed = S.v;
      // footsteps in the leaves
      S.stepAcc += ds;
      if (S.stepAcc > 0.72 && S.v > 0.2) { S.stepAcc = 0; E.audio?.step('leaves', S.v * 1.3, { gain: 0.55 }); }
      S.bob += ds * 4.3;
      const { p, t: tan } = cartTransform();
      const yawPath = headingOf(tan);
      // ---- camera
      const cam = E.camera;
      cam.rotation.order = 'YXZ';
      // first-person pose: behind the handles
      const behind = orbit(0, 1.05, 1.62);
      const bobA = Math.min(S.v / 1.2, 1);
      behind.y += Math.sin(S.bob) * 0.025 * bobA + Math.sin(t * 0.9) * 0.004;
      const fpYaw = yawPath + S.lookYaw;
      const fpPitch = S.basePitch + S.lookPitch + S.upLook;
      if (S.camMode === 'establish' || S.camMode === 'glide') {
        // orbit from the front-left (the photograph) round to behind her
        const b = S.blend;
        const a = THREE.MathUtils.lerp(-2.75, 0, b), r = THREE.MathUtils.lerp(2.7, 1.05, b), h = THREE.MathUtils.lerp(0.75, 1.62, b);
        camPos.copy(orbit(a, r, h));
        camPos.y += Math.sin(t * 0.4) * 0.01;
        const lookChair = new THREE.Vector3(0, 1.45, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), cart.rotation.y).add(cart.position);
        const fwd = new THREE.Vector3(-Math.sin(fpYaw) * Math.cos(fpPitch), Math.sin(fpPitch), -Math.cos(fpYaw) * Math.cos(fpPitch));
        const lookFp = behind.clone().addScaledVector(fwd, 6);
        const lb = THREE.MathUtils.smoothstep(b, 0.45, 1);
        camLook.lerpVectors(lookChair, lookFp, lb);
        cam.position.copy(camPos);
        cam.lookAt(camLook);
        if (b >= 1) S.camMode = 'fp';
      } else {
        cam.position.copy(behind);
        cam.rotation.set(fpPitch, fpYaw, Math.sin(S.bob * 0.5) * 0.004 * bobA);
      }
      // ---- focus follows her (≈ distance to the chair)
      const dChair = cam.position.distanceTo(new THREE.Vector3(cart.position.x, cart.position.y + 0.9, cart.position.z));
      E.post.look.focus = E.post.target.focus = Math.max(dChair + 0.4 + S.upLook * 8, 1.4);
      // ---- sun & shadows follow; rays aimed at the sun's screen position
      sun.position.copy(cart.position).addScaledVector(SUN_DIR, 60);
      sun.target.position.copy(cart.position).addScaledVector(SUN_DIR, -8);
      const sp = cam.position.clone().addScaledVector(SUN_DIR, 100).project(cam);
      const on = sp.z < 1 && Math.abs(sp.x) < 1.6 && Math.abs(sp.y) < 1.6 ? 1 : 0;
      E.post.look.raysLight = E.post.target.raysLight = [sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5];
      E.post.target.rays = (0.06 + S.ending * 0.4) * on;
      // ---- crown LOD: far trees draw a fraction of their leaves (they're blurred and hazed anyway)
      for (const m of crowns) {
        const d = Math.hypot(m.userData.c.x - cam.position.x, m.userData.c.z - cam.position.z);
        m.count = Math.round(m.userData.full * THREE.MathUtils.clamp(1.25 - d / 18, 0.2, 1));
        m.castShadow = d < 22;
      }
      // ---- particles
      fall.center.set(cam.position.x, groundH(cam.position.x, cam.position.z) - 0.1, cam.position.z - 3);
      fall.drift.set(0.35 + S.swirl * 1.6 * Math.sin(t * 1.3), S.swirl * 0.6, 0.12 + S.swirl * 1.2 * Math.cos(t * 1.1));
      fall.timeScale = 1 - S.upLook * 0.9;
      fall.update(dt, t);
      her.update(dt, t);
      if (E.audio?.ready) { const f = new THREE.Vector3(); cam.getWorldDirection(f); E.audio.setListener(cam.position, f, cam.up); }
    },
    dispose() { scene.traverse((o) => { o.geometry?.dispose?.(); }); },
  };

  // ---------------------------------------------------------------- script
  async function run() {
    // establishing: the photograph — her chair under the maple
    await wait(1.2);
    await say('park.narr_1', { dur: 4.2 });
    // glide round behind her while he explains himself
    S.camMode = 'glide';
    const glide = tween(7.5, (k) => { S.blend = k; E.post.target.focus = 2.4; });
    E.post.setLook({ focusRange: 0.9, dof: 0.8 }, 0.6);
    await say('park.narr_2');
    await glide;
    S.camMode = 'fp'; S.blend = 1;
    E.post.setLook({ dof: 0.42, focusRange: 1.4 }, 1.2);
    // pushing
    S.pushOn = true;
    const p0 = () => S.pushed || 0;
    let hinted = false;
    wait(3).then(() => { if (p0() < 0.3) { hinted = true; E.ui.hint(T('p.push'), true); } });
    await until(() => p0() > 0.4);
    if (hinted) E.ui.hint(null);
    await until(() => p0() > 3);
    await say('park.her_1');
    await say('park.him_1');
    await say('park.her_2');
    await until(() => p0() > 15);
    await say('park.narr_3');
    await until(() => p0() > 22);
    // she looks up; he slows; the leaves hang in the air
    S.speedK = 0.35;
    tween(2.2, (k) => { S.upLook = k * 0.55; });
    E.post.setLook({ dof: 0.25 }, 0.8);
    await say('park.her_3', { dur: 5.2 });
    await wait(0.8);
    await tween(2.4, (k) => { S.upLook = 0.55 * (1 - k); S.speedK = 0.35 + 0.65 * k; });
    E.post.setLook({ dof: 0.42 }, 1.0);
    await until(() => p0() > 32);
    await say('park.narr_4');
    await until(() => p0() > 38);
    // faster: the leaves are winning
    S.speedK = 1.75;
    tween(1.2, (k) => { S.swirl = k; });
    E.audio?.whoosh?.(2.5);
    await say('park.her_4');
    await wait(3.5);
    tween(3, (k) => { S.swirl = 1 - k; S.speedK = 1.75 - 0.75 * k; });
    await until(() => p0() > 52);
    await say('park.narr_5', { dur: 5.5 });
    await say('park.narr_6', { gap: 0.2 });
    // light swells; white
    E.post.setLook({ exposure: 2.4, bloom: 0.55, halation: 0.3, dof: 1.0 }, 0.45);
    tween(4, (k) => { S.ending = k; });
    E.audio?.chime?.();
    await wait(2.0);
    E.audio?.stopMusic(4);
    E.audio?.stopAllAmb(4);
    await fadeOut(2.2, 0xffffff);
    E.flags.m_park = true;
    console.log('park: done → library');
    go('library', { spawn: 'book', color: 0xffffff, fadeOut: 0 });
  }

  return obj;
}
