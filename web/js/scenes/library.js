// Scene 1 + 2 (+ cherry memory, radio, red doors, reunion): the daisy garden and the library of memories.
// Layout (metres): garden z ∈ [2, 34]; the nave (a canyon of bookshelves) z ∈ [-34, 0], x ∈ [-2.3, 2.3];
// the overgrown bedroom (jungle chamber) z ∈ [-50, -34], x ∈ [-8, 8].
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { E, player, wait, until, say, choose, tween, go, fadeOut, fadeIn, addInteract, T, input, currentEpoch, alive } from '../engine.js';
import { hdri, model, pbr, setRepeat } from '../assets.js';
import { daisyField, grassField, leafCards, Drifters, Butterflies, WIND, rng, makeTree } from '../fx/foliage.js';
import { leafAtlas, spineTex, glowTex, rugTex, bigLeafTex, seedTex, mapleAtlas, meadowTex } from '../fx/textures.js';
import { makeHer } from '../fx/figures.js';
import { Snow } from '../fx/snow.js';
import { qualityCfg } from '../engine.js';

const NAVE_W = 4.6, NAVE_Z0 = 0, NAVE_Z1 = -34, H = 16;
const CH = { x0: -6.5, x1: 6.5, z0: -34, z1: -46 };

export async function libraryScene(opts = {}) {
  const R = rng(5);
  const scene = new THREE.Scene();
  scene.userData.soft = true;
  const q = qualityCfg();
  const env = await hdri('sunny_rose_garden');
  scene.environment = env.env; scene.environmentIntensity = 0.55;
  scene.background = new THREE.Color(0xd8c9a6);
  scene.fog = new THREE.FogExp2(0xb59a6a, 0.018);

  // ---------- sky dome ----------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(0x4f86c8) }, uHor: { value: new THREE.Color(0xf4ead2) }, uSun: { value: new THREE.Vector3(0.3, 0.75, 0.6).normalize() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; varying vec3 vD;
      void main(){ float h = clamp(vD.y,0.0,1.0); vec3 c = mix(uHor, uTop, pow(h,0.6)); float s = max(dot(normalize(vD), uSun),0.0); c += vec3(1.0,0.9,0.7)*(pow(s,40.0)*6.0 + pow(s,4.0)*0.35); gl_FragColor = vec4(c*0.95,1.0); }`,
  }));
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);

  // ---------- light ----------
  const sun = new THREE.DirectionalLight(0xffe2b0, 3.2);
  sun.position.set(14, 40, 26); sun.target.position.set(0, 0, -12);
  sun.castShadow = true; sun.shadow.mapSize.set(q.shadow, q.shadow);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 40, bottom: -40, near: 5, far: 110 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xffeccc, 0x3a2a18, 0.7);
  scene.add(hemi);

  // ---------- materials ----------
  const wood = pbr('dark_wooden_planks', { repeat: 1, normalScale: 0.6 }); wood.color.set(0x8a6a50);
  const floorMat = pbr('old_wood_floor', { repeat: 1 }); setRepeat(floorMat, 3, 22); floorMat.color.set(0xb09070);
  const grassGround = pbr('leafy_grass', { repeat: 1 }); setRepeat(grassGround, 14, 14); grassGround.color.set(0x7a8a5a);

  // ---------- garden ----------
  const gardenGrp = new THREE.Group(); scene.add(gardenGrp);
  const mt = meadowTex(); mt.repeat.set(26, 17);
  const meadowMat = new THREE.MeshStandardMaterial({ map: mt, roughness: 0.9, color: 0xe8f0d8 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, 46), meadowMat);
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, 18); ground.receiveShadow = true;
  gardenGrp.add(ground);
  const meadowCenter = new THREE.Vector3(0, 0, 16);
  const dCount = Math.round((q.px < 0.7 ? 6000 : q.px < 0.9 ? 9000 : 12000));
  // dense near the path you walk, sparse further out (the painted ground carries the distance)
  const daisies = daisyField({ count: Math.round(dCount * 0.7), area: [14, 22], center: new THREE.Vector3(0, 0, 12), seed: 9, exclude: (x, z) => z < 1.2 && Math.abs(x) < 3 });
  gardenGrp.add(daisies);
  gardenGrp.add(daisyField({ count: Math.round(dCount * 0.3), area: [46, 32], center: meadowCenter, seed: 19, exclude: (x, z) => Math.abs(x) < 7 && z > 1 && z < 23 }));
  gardenGrp.add(daisyField({ count: 500, area: [2.4, 2.4], center: new THREE.Vector3(0.6, 0, 14), seed: 33, heightRange: [0.2, 0.42], headSize: 0.085 }));
  const grass = grassField({ count: Math.round(dCount * 1.8), area: [16, 24], center: new THREE.Vector3(0, 0, 12), seed: 4, height: [0.1, 0.3], width: 0.04, colorA: 0x4a6a24, colorB: 0xa8c050 });
  gardenGrp.add(grass);
  // a hedge of trees around the garden edge (soft, out of focus)
  const gardenTrees = new THREE.Group();
  const leafMat = leafAtlas();
  for (let i = 0; i < 16; i++) {
    const t = makeTree({ seed: 100 + i, height: 9 + R() * 5, trunkR: 0.28, depth: 4, spread: 0.7, barkMat: wood, twigs: false });
    // a ring of trees around the meadow, open toward the library
    const a = -0.35 + (i / 15) * (Math.PI + 0.7);
    const rr = 27 + R() * 6;
    t.position.set(Math.cos(a) * rr, 0, 14 + Math.sin(a) * rr * 0.75);
    const cards = t.userData.tips.flatMap((p) => Array.from({ length: 28 }, () => ({ pos: p.clone().add(new THREE.Vector3((R() - 0.5) * 2.4, (R() - 0.5) * 1.6, (R() - 0.5) * 2.4)), scale: 0.8 + R() * 0.6, color: new THREE.Color().setHSL(0.24 + R() * 0.06, 0.45, 0.32 + R() * 0.1) })));
    const lc = leafCards({ cards, atlas: leafMat, size: 0.32, translucent: 0.5 });
    t.add(lc);
    gardenTrees.add(t);
  }
  gardenGrp.add(gardenTrees);
  const butterflies = new Butterflies({ count: 7, center: new THREE.Vector3(0.5, 0, 14), radius: 5, height: [0.6, 2.4] });
  gardenGrp.add(butterflies.group);
  const seeds = new Drifters({ count: 90, atlas: seedTex(), grid: 1, size: 0.05, box: [24, 5, 24], center: new THREE.Vector3(0, 0.2, 16), kind: 'seed', drift: [0.18, 0, -0.08], color: 0xffffff, blending: true });
  seeds.mesh.material.emissive = new THREE.Color(0x444444);
  gardenGrp.add(seeds.mesh);

  // ---------- the nave: two canyon walls of shelves ----------
  const shelves = new THREE.Group(); scene.add(shelves);
  const colliders = [];
  const openings = { L: [[-14.5, -11.5], [-29.2, -26.8]], R: [[-15.4, -12.6], [-25.2, -22.8], [-31.4, -29.4]] }; // alcove gaps (z ranges)
  const spineMat = new THREE.MeshStandardMaterial({ map: spineTex(true), roughness: 0.75, color: 0x8a7a68 });
  const boxes = { stile: [], plank: [], back: [] };
  const books = [];
  function wall(side) {
    const sx = side === 'L' ? -1 : 1;
    const x = sx * NAVE_W / 2;
    const gaps = openings[side];
    const inGap = (z) => gaps.some(([a, b]) => z > a && z < b);
    // back panel: full above the alcoves, broken by them below 3.4 m
    const AH = 3.4;
    boxes.back.push({ x: x + sx * 0.5, y: AH + (H - AH) / 2, z: (NAVE_Z0 + NAVE_Z1) / 2, w: 0.06, h: H - AH, d: NAVE_Z0 - NAVE_Z1 });
    {
      let zA = NAVE_Z0;
      for (const [a, b] of [...gaps].sort((p, q) => q[1] - p[1])) { boxes.back.push({ x: x + sx * 0.5, y: AH / 2, z: (zA + b) / 2, w: 0.06, h: AH, d: zA - b }); zA = a; }
      boxes.back.push({ x: x + sx * 0.5, y: AH / 2, z: (zA + NAVE_Z1) / 2, w: 0.06, h: AH, d: zA - NAVE_Z1 });
      // each alcove: a small panelled room behind the shelves
      for (const [a, b] of gaps) {
        const xb = sx * 4.4, zc = (a + b) / 2, dz = b - a;
        boxes.back.push({ x: xb, y: AH / 2, z: zc, w: 0.12, h: AH, d: dz + 0.12 });
        boxes.back.push({ x: (x + sx * 0.5 + xb) / 2, y: AH / 2, z: a, w: Math.abs(xb - x - sx * 0.5), h: AH, d: 0.12 });
        boxes.back.push({ x: (x + sx * 0.5 + xb) / 2, y: AH / 2, z: b, w: Math.abs(xb - x - sx * 0.5), h: AH, d: 0.12 });
        boxes.back.push({ x: (x + sx * 0.5 + xb) / 2, y: AH + 0.05, z: zc, w: Math.abs(xb - x - sx * 0.5) + 0.1, h: 0.1, d: dz + 0.1 });
      }
    }
    // stiles every 1.2 m
    for (let z = NAVE_Z0; z >= NAVE_Z1; z -= 1.2) {
      if (inGap(z)) boxes.stile.push({ x: x + sx * 0.25, y: 3.4 + (H - 3.4) / 2, z, w: 0.5, h: H - 3.4, d: 0.08 });
      else boxes.stile.push({ x: x + sx * 0.25, y: H / 2, z, w: 0.5, h: H, d: 0.08 });
    }
    // planks (shelves) every 0.42 m, heavier beams every ~4 m
    for (let y = 0.08; y < H; y += 0.42) {
      const beam = Math.abs((y % 4.2) - 0.08) < 0.05 && y > 1;
      for (let z = NAVE_Z0; z > NAVE_Z1; z -= 1.2) {
        const zc = z - 0.6;
        if (inGap(zc) && y < 3.4) continue;
        boxes.plank.push({ x: x + sx * (beam ? 0.12 : 0.25), y, z: zc, w: beam ? 0.75 : 0.5, h: beam ? 0.16 : 0.04, d: 1.2 });
      }
    }
    // books: individual near the floor, spine panels above
    for (let z = NAVE_Z0; z > NAVE_Z1; z -= 1.2) {
      const zc = z - 0.6;
      for (let y = 0.12; y < H - 0.4; y += 0.42) {
        if (inGap(zc) && y < 3.4) continue;
        if (y < 3.3) {
          let zz = z - 0.05;
          while (zz > z - 1.15) {
            const w = 0.025 + R() * 0.035, h = 0.24 + R() * 0.12, d = 0.16 + R() * 0.08;
            if (R() < 0.06) { zz -= 0.05 + R() * 0.15; continue; }
            const lean = R() < 0.08 ? (R() - 0.5) * 0.5 : 0;
            books.push({ x: x + sx * (0.42 - d / 2 + R() * 0.03), y: y + 0.02 + h / 2, z: zz - w / 2, w: d, h, d: w, lean, c: R() });
            zz -= w + 0.002;
          }
        } else {
          const p = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.36), spineMat);
          p.position.set(x + sx * 0.02 - sx * 0.03, y + 0.2, zc);
          p.rotation.y = -sx * Math.PI / 2;
          p.material = spineMat;
          shelves.add(p);
        }
      }
    }
    // collision: wall slab, broken at gaps
    let zA = NAVE_Z0;
    const segs = [...gaps].sort((a, b) => b[1] - a[1]);
    for (const [a, b] of segs) { colliders.push(side === 'L' ? { minX: -9, maxX: x + 0.1, minZ: b, maxZ: zA } : { minX: x - 0.1, maxX: 9, minZ: b, maxZ: zA }); zA = a; }
    colliders.push(side === 'L' ? { minX: -9, maxX: x + 0.1, minZ: NAVE_Z1, maxZ: zA } : { minX: x - 0.1, maxX: 9, minZ: NAVE_Z1, maxZ: zA });
  }
  wall('L'); wall('R');
  // spine panels share one material; merge them for draw calls
  {
    const ps = shelves.children.filter(c => c.isMesh);
    const geos = ps.map(p => { p.updateMatrix(); return p.geometry.clone().applyMatrix4(p.matrix); });
    ps.forEach(p => shelves.remove(p));
    const m = new THREE.Mesh(mergeGeometries(geos), spineMat); m.receiveShadow = true; shelves.add(m);
  }
  function instBoxes(list, mat) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const im = new THREE.InstancedMesh(g, mat, list.length);
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    list.forEach((b, i) => { p.set(b.x, b.y, b.z); s.set(b.w, b.h, b.d); qq.setFromEuler(new THREE.Euler(b.lean || 0, 0, 0)); m4.compose(p, qq, s); im.setMatrixAt(i, m4); });
    im.castShadow = true; im.receiveShadow = true;
    return im;
  }
  shelves.add(instBoxes(boxes.back, wood), instBoxes(boxes.stile, wood), instBoxes(boxes.plank, wood));
  const bookMat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 });
  const bookIM = instBoxes(books, bookMat);
  const pal = [0x5a2418, 0x6a3a1e, 0x3a2416, 0x7a5630, 0x2e3a24, 0x2a2e36, 0x5c4424, 0x8a6a3c, 0x40180f, 0x261e18, 0x5e2a1c, 0x3a4430, 0xa08458, 0x2a2018, 0x4a3020, 0x6a5030];
  const col = new THREE.Color();
  books.forEach((b, i) => { col.set(pal[Math.floor(b.c * pal.length)]).multiplyScalar(0.45 + R() * 0.4); bookIM.setColorAt(i, col); });
  bookIM.castShadow = false;
  shelves.add(bookIM);
  // nave floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(NAVE_W + 1, 36), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.005, -17.5); floor.receiveShadow = true;
  scene.add(floor);
  // the mouth of the library: grass and daisies creep in
  const creep = daisyField({ count: 900, area: [4.4, 5], center: new THREE.Vector3(0, 0, -0.5), seed: 21 });
  scene.add(creep);

  // ---------- golden vines and canopy ----------
  const vineCards = [];
  for (const sx of [-1, 1]) {
    for (let z = -1; z > NAVE_Z1; z -= 0.7) {
      if (R() < 0.45) continue;
      const len = 2 + R() * 9, top = H - R() * 4;
      const x = sx * (NAVE_W / 2 - 0.05);
      for (let y = top; y > top - len; y -= 0.09) {
        const sway = (top - y) / len;
        vineCards.push({ pos: new THREE.Vector3(x + (R() - 0.5) * 0.4 - sx * sway * 0.3, y, z + (R() - 0.5) * 0.4), scale: 0.7 + R() * 0.7, sway: 0.5 + sway, color: new THREE.Color().setHSL(0.13 + R() * 0.05, 0.55, 0.42 + R() * 0.12) });
      }
    }
  }
  // canopy over the top of the canyon (overgrown ceiling with light)
  for (let i = 0; i < 9000; i++) {
    const z = -R() * 34, x = (R() - 0.5) * (NAVE_W + 3);
    const y = H - 0.5 + R() * 3 - Math.abs(x) * 0.1;
    if (Math.abs(x) < 1.0 && R() < 0.7) continue; // keep a bright slit in the middle
    vineCards.push({ pos: new THREE.Vector3(x, y, z), scale: 0.8 + R(), sway: 1, color: new THREE.Color().setHSL(0.12 + R() * 0.06, 0.6, 0.45 + R() * 0.15) });
  }
  // bushes growing out of the shelves at every level (the reference's signature look)
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 46; i++) {
      const z = -1.5 - R() * 31.5, y = 1.2 + Math.pow(R(), 0.8) * 13.5;
      const x = sx * (NAVE_W / 2 - 0.1);
      const rad = 0.45 + R() * 0.9;
      const n = Math.round(110 + rad * 160);
      const hue = 0.12 + R() * 0.07, lit = 0.38 + R() * 0.14;
      for (let k = 0; k < n; k++) {
        const u = R() * 2 - 1, a = R() * 6.28, rr = rad * Math.cbrt(R());
        const v = new THREE.Vector3(Math.sqrt(1 - u * u) * Math.cos(a), u * 0.8, Math.sqrt(1 - u * u) * Math.sin(a)).multiplyScalar(rr);
        v.x = -sx * Math.abs(v.x) * 0.9; // bulge out into the aisle
        vineCards.push({ pos: new THREE.Vector3(x + v.x, y + v.y, z + v.z), scale: 0.7 + R() * 0.8, sway: 0.4, color: new THREE.Color().setHSL(hue + (R() - 0.5) * 0.03, 0.6, lit + (R() - 0.5) * 0.1) });
      }
      // trailing strands below some bushes
      if (R() < 0.5) for (let t = 0; t < 2 + R() * 3; t++) {
        const ox = (R() - 0.5) * rad, oz = (R() - 0.5) * rad, len = 1 + R() * 3;
        for (let yy = 0; yy < len; yy += 0.08) vineCards.push({ pos: new THREE.Vector3(x - sx * 0.2 + ox * 0.3, y - yy, z + oz), scale: 0.6 + R() * 0.5, sway: 0.4 + yy / len, color: new THREE.Color().setHSL(hue, 0.55, lit) });
      }
    }
  }
  for (let i = 0; i < 7000; i++) {
    const sx = R() < 0.5 ? -1 : 1, front = R() < 0.35;
    const y = Math.pow(R(), 0.6) * H;
    const p = front ? new THREE.Vector3(sx * (NAVE_W / 2 + R() * 0.55), y, 0.08) : new THREE.Vector3(sx * (NAVE_W / 2 + 0.6), y, -R() * 9);
    vineCards.push({ pos: p, scale: 0.8 + R() * 0.8, sway: 0.3, color: new THREE.Color().setHSL(0.2 + R() * 0.08, 0.45, 0.22 + R() * 0.15) });
  }
  const vines = leafCards({ cards: vineCards, atlas: leafMat, size: 0.2, translucent: 0.8 });
  vines.castShadow = true;
  scene.add(vines);

  // merge all meshes of a group that share a material (fewer draw calls)
  function mergeByMaterial(group) {
    const byMat = new Map();
    group.updateMatrixWorld(true);
    for (const m of [...group.children]) {
      if (!m.isMesh || m.isInstancedMesh) continue;
      const g = m.geometry.clone().applyMatrix4(m.matrix);
      if (!byMat.has(m.material)) byMat.set(m.material, []);
      byMat.get(m.material).push(g);
      group.remove(m);
    }
    for (const [mat, gs] of byMat) { const mm = new THREE.Mesh(mergeGeometries(gs), mat); mm.castShadow = true; mm.receiveShadow = true; group.add(mm); }
  }
  // ---------- props ----------
  const props = {};
  const SHADOWED = /chair|Chair|ladder|bookshelf|Nightstand|pachira/;
  async function place(name, pos, rot = 0, scale = 1) {
    const o = await model(name, { scale, shadows: SHADOWED.test(name) });
    o.position.set(...pos); o.rotation.y = rot; scene.add(o); return o;
  }
  const lad = await place('wooden_ladder', [-1.85, 0, -15.8], 0, 1);
  { const b = new THREE.Box3().setFromObject(lad); const k = 4.6 / (b.max.y - b.min.y); lad.scale.setScalar(k); lad.rotation.set(0, Math.PI / 2, 0.13, 'YXZ'); }
  const lad2 = lad.clone(); lad2.position.set(1.85, 0, -20.5); lad2.rotation.set(0, -Math.PI / 2, 0.13, 'YXZ'); scene.add(lad2);
  props.chair = await place('WoodenChair_01', [-1.35, 0, -8.2], Math.PI / 2 + 0.3);
  props.arm = await place('ArmChair_01', [1.3, 0, -3.6], -Math.PI / 2 - 0.4);
  props.table = await place('ClassicNightstand_01', [-1.45, 0, -20.2], Math.PI / 2);
  props.clock = await place('mantel_clock_01', [-1.5, 0.66, -20.55], Math.PI / 2, 1);
  props.radio = await place('vintage_radio_transceiver', [-3.0, 0.72, -35.3], Math.PI / 2 + 0.5, 1.0);
  props.radioTable = await place('ClassicNightstand_01', [-3.1, 0, -35.3], Math.PI / 2);
  props.fern = await place('fern_02', [1.8, 0, -10.5], 0, 1.4);
  props.cal = await place('calathea_orbifolia_01', [-1.8, 0, -16.5], 0, 1.3);
  props.anth = await place('anthurium_botany_01', [1.75, 0, -27], 0, 1.4);
  props.vase = await place('antique_ceramic_vase_01', [1.7, 0, -6.4], 0, 1.2);
  // book on the chair, with a pressed maple leaf
  const bookG = new THREE.Group();
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.035, 0.24), new THREE.MeshStandardMaterial({ color: 0x5a1f18, roughness: 0.6 }));
  const pages = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.028, 0.23), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 }));
  pages.position.x = 0.006;
  const leafSprite = leafCards({ cards: [{ pos: new THREE.Vector3(0.05, 0.02, 0.06), rot: new THREE.Euler(-Math.PI / 2, 0, 0.6), scale: 1, tile: 2, sway: 0 }], atlas: mapleAtlas(), size: 0.11, translucent: 0.2 });
  bookG.add(cover, pages, leafSprite);
  bookG.position.set(-1.35, 0.47, -8.2); bookG.rotation.y = 0.5;
  scene.add(bookG);
  // snow globe on the side table
  const globe = new THREE.Group();
  const gbase = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.05, 32), new THREE.MeshStandardMaterial({ color: 0x3a2214, roughness: 0.5 }));
  const gglass = new THREE.Mesh(new THREE.SphereGeometry(0.075, 32, 24), new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.22, roughness: 0.03, clearcoat: 1, color: 0xffffff, envMapIntensity: 2.2, depthWrite: false }));
  gglass.position.y = 0.1;
  const gsnow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 10, 0, 6.29, Math.PI * 0.62, Math.PI * 0.38), new THREE.MeshStandardMaterial({ color: 0xf4f6fa, roughness: 0.9 }));
  gsnow.position.y = 0.1;
  const gchair = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.002, 6, 16), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.4 }));
  gchair.position.set(0.012, 0.075, 0); gchair.rotation.y = Math.PI / 2;
  globe.add(gbase, gglass, gsnow, gchair);
  globe.position.set(-1.45, 0.72, -19.95);
  scene.add(globe);

  // procedural mushrooms and pumpkins (from the reference: tall glowing orange mushrooms)
  const mushMat = new THREE.MeshPhysicalMaterial({ color: 0xd9822f, roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color(0xffc080), emissive: 0x7a2c06, emissiveIntensity: 0.25 });
  const stemMat = new THREE.MeshStandardMaterial({ color: 0xd8b48a, roughness: 0.8 });
  function mushroom(x, z, h, r) {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.LatheGeometry([[0.035, 0], [0.028, h * 0.3], [0.024, h * 0.8], [0.03, h]].map(([a, b]) => new THREE.Vector2(a * r * 8, b))), stemMat);
    const cap = new THREE.Mesh(new THREE.LatheGeometry([[0, h + r * 0.55], [r * 0.35, h + r * 0.5], [r * 0.75, h + r * 0.3], [r, h + r * 0.05], [r * 1.02, h - r * 0.05], [r * 0.8, h - r * 0.02], [r * 0.2, h]].map(([a, b]) => new THREE.Vector2(a, b)), 40), mushMat);
    stem.castShadow = cap.castShadow = true;
    g.add(stem, cap); g.position.set(x, 0, z); g.rotation.z = (R() - 0.5) * 0.15;
    scene.add(g);
  }
  [[1.6, -11.5, 1.6, 0.5], [1.9, -12.3, 1.1, 0.34], [1.3, -11.0, 0.7, 0.22], [-1.85, -24.5, 2.1, 0.6], [-1.6, -25.3, 1.3, 0.36], [-1.9, -26.0, 0.8, 0.25], [1.85, -32, 1.5, 0.45]].forEach(a => mushroom(...a));
  const pumpMat = new THREE.MeshStandardMaterial({ color: 0xc8571c, roughness: 0.55 });
  function pumpkin(x, z, s) {
    const g = new THREE.SphereGeometry(0.22 * s, 32, 20);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const a = Math.atan2(v.z, v.x);
      const rib = 1 - 0.07 * Math.pow(Math.abs(Math.sin(a * 5)), 0.6);
      v.x *= rib; v.z *= rib; v.y *= 0.72;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, pumpMat); m.position.set(x, 0.15 * s, z); m.castShadow = true;
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * s, 0.02 * s, 0.07 * s, 6), new THREE.MeshStandardMaterial({ color: 0x4a5a2a }));
    st.position.y = 0.17 * s; st.rotation.z = 0.3; m.add(st);
    scene.add(m);
  }
  pumpkin(-1.4, -9.6, 1.1); pumpkin(1.5, -17.5, 0.9); pumpkin(-1.7, -30.5, 1.3);
  {
    const yg = new THREE.MeshStandardMaterial({ map: bigLeafTex(1), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, color: 0xe8e080 });
    const yg2 = new THREE.MeshStandardMaterial({ map: bigLeafTex(0), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, color: 0xd8d070 });
    const navePlants = new THREE.Group();
    for (const [cx, cz, n] of [[-1.9, -4.8, 7], [1.95, -12.9, 6], [-1.95, -17.8, 8], [1.9, -26.5, 7], [-1.9, -31.6, 9], [1.9, -33.2, 6]]) {
      for (let k = 0; k < n; k++) {
        const sz = 0.7 + R() * 1.1;
        const g = new THREE.PlaneGeometry(0.5 * sz, sz, 1, 4); g.translate(0, 0.5 * sz, 0);
        const pp = g.attributes.position; for (let i = 0; i < pp.count; i++) { const yy = pp.getY(i) / sz; pp.setZ(i, -0.25 * yy * yy * sz); } g.computeVertexNormals();
        const m = new THREE.Mesh(g, R() < 0.5 ? yg : yg2);
        m.position.set(cx + (R() - 0.5) * 0.5, 0, cz + (R() - 0.5) * 0.9);
        m.rotation.set(-0.2 - R() * 0.7, (cx < 0 ? 0.5 : -0.5) * Math.PI + (R() - 0.5) * 2.2, 0);
        m.castShadow = true; navePlants.add(m);
      }
    }
    mergeByMaterial(navePlants);
    scene.add(navePlants);
  }
  // floor litter: fallen leaves + book piles
  const litter = [];
  for (let i = 0; i < 1600; i++) {
    const z = -R() * 33.5, x = (R() - 0.5) * NAVE_W * (0.6 + 0.4 * R());
    litter.push({ pos: new THREE.Vector3(x, 0.01 + R() * 0.01, z), rot: new THREE.Euler(-Math.PI / 2 + (R() - 0.5) * 0.3, 0, R() * 6.28), scale: 0.6 + R() * 0.7, sway: 0, color: new THREE.Color().setHSL(0.07 + R() * 0.07, 0.65, 0.35 + R() * 0.15) });
  }
  const floorLeaves = leafCards({ cards: litter, atlas: leafMat, size: 0.13, translucent: 0.1 });
  floorLeaves.castShadow = false;
  scene.add(floorLeaves);
  const piles = [];
  for (const [px, pz, n] of [[1.5, -7.2, 7], [-1.6, -13.9, 5], [1.4, -21.5, 9], [-1.5, -33, 6], [1.2, -14.2, 4]]) {
    let y = 0;
    for (let k = 0; k < n; k++) { const h = 0.04 + R() * 0.03; piles.push({ x: px + (R() - 0.5) * 0.06, y: y + h / 2, z: pz + (R() - 0.5) * 0.06, w: 0.22 + R() * 0.08, h, d: 0.3 + R() * 0.05, lean: 0, c: R() }); y += h; }
  }
  const pileIM = instBoxes(piles, bookMat); piles.forEach((b, i) => { col.set(pal[Math.floor(b.c * pal.length)]); pileIM.setColorAt(i, col); });
  scene.add(pileIM);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.6), new THREE.MeshStandardMaterial({ map: rugTex(), roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0.2, 0.012, -9.5); rug.receiveShadow = true;
  scene.add(rug);

  // warm hanging bulbs along the nave (most are emissive sprites; 3 real lights)
  const bulbs = [];
  function glowPoints(list, size, color) {
    const g = new THREE.BufferGeometry().setFromPoints(list);
    const m = new THREE.PointsMaterial({ map: glowTex(), color, size, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const p = new THREE.Points(g, m); p.frustumCulled = false; return p;
  }
  const bulbPos = [];
  for (let i = 0; i < 26; i++) bulbPos.push(new THREE.Vector3((R() - 0.5) * NAVE_W * 0.9, 3 + R() * 11, -R() * 33));
  const bulbPts = glowPoints(bulbPos, 0.5, 0xffb35a); scene.add(bulbPts); bulbs.push(bulbPts);
  {
    const cores = new THREE.InstancedMesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe0b0 }), bulbPos.length);
    bulbPos.forEach((p, i) => cores.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
    scene.add(cores);
  }
  const glowMat = new THREE.SpriteMaterial({ map: glowTex(), color: 0xffb35a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  for (const [x, y, z] of [[0.6, 3.4, -9], [-0.5, 3.8, -22], [1.0, 3.2, -30]]) { const l = new THREE.PointLight(0xffa850, 2.2, 9, 2); l.position.set(x, y, z); scene.add(l); }

  // ---------- jungle bedroom (end of the nave) ----------
  const chamber = new THREE.Group(); scene.add(chamber);
  const chFloor = new THREE.Mesh(new THREE.PlaneGeometry(14, 13), grassGround.clone()); chFloor.material.color.set(0x4a5a30);
  chFloor.rotation.x = -Math.PI / 2; chFloor.position.set(0, 0.004, -40); chFloor.receiveShadow = true; chamber.add(chFloor);
  // walls: back wall of shelves, side walls dark, glass roof frames (black beams)
  const chWalls = [];
  chWalls.push({ x: 0, y: 4, z: CH.z1 - 0.3, w: 14, h: 8, d: 0.5 }, { x: CH.x0 - 0.3, y: 4, z: -40, w: 0.5, h: 8, d: 13 }, { x: CH.x1 + 0.3, y: 4, z: -40, w: 0.5, h: 8, d: 13 });
  chWalls.push({ x: -4.4, y: 4, z: CH.z0 - 0.1, w: 4.6, h: 8, d: 0.4 }, { x: 4.4, y: 4, z: CH.z0 - 0.1, w: 4.6, h: 8, d: 0.4 }, { x: 0, y: 7.3, z: CH.z0 - 0.1, w: 4.4, h: 1.4, d: 0.4 });
  const plaster = pbr('rough_plaster_03', { repeat: 1 }); setRepeat(plaster, 4, 2); plaster.color.set(0x3a3428);
  chamber.add(instBoxes(chWalls, plaster));
  const beams = [];
  for (let x = -6.5; x <= 6.5; x += 2.2) beams.push({ x, y: 8, z: -40, w: 0.12, h: 0.18, d: 13 });
  for (let z = -34; z >= -46; z -= 2.4) beams.push({ x: 0, y: 8.05, z, w: 13, h: 0.12, d: 0.1 });
  chamber.add(instBoxes(beams, new THREE.MeshStandardMaterial({ color: 0x14140f, roughness: 0.6, metalness: 0.4 })));
  // back-wall bookshelf (scan) ×3
  for (let i = -1; i <= 1; i++) { const b = await place('wooden_bookshelf_worn', [i * 2.4, 0, CH.z1 + 0.35], 0, 1.25); chamber.add(b); }
  chamber.add(grassField({ count: Math.round(9000 * q.px), area: [12.5, 11.5], center: new THREE.Vector3(0, 0, -40), seed: 77, height: [0.08, 0.3], colorA: 0x1f3410, colorB: 0x5a7a2a, exclude: (x, z) => Math.abs(x) < 1.1 && z < -38.9 && z > -41.7 }));
  // the bed (low, white linen, rumpled)
  const bed = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.28, 2.3), wood); frame.position.y = 0.14;
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.22, 2.2), new THREE.MeshStandardMaterial({ color: 0xefe9df, roughness: 0.9 })); mattress.position.y = 0.39;
  const duvetG = new THREE.PlaneGeometry(2.25, 2.0, 60, 54); duvetG.rotateX(-Math.PI / 2);
  { const p = duvetG.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); let y = 0.06 + 0.11 * (Math.sin(x * 4.1 + z * 1.7) * 0.45 + Math.sin(x * 1.6 - z * 5.3) * 0.35 + Math.sin(x * 9.5 + z * 7.3) * 0.12 + Math.sin(x * 17 - z * 3) * 0.05) * (0.6 + 0.4 * Math.sin(z * 2 + 1)); const edge = Math.max(Math.abs(x) - 0.95, 0); y -= edge * edge * 3.2 + edge * 0.7; if (z > 0.95) y -= (z - 0.95) * 0.8; p.setY(i, y); } duvetG.computeVertexNormals(); }
  const linen = new THREE.MeshPhysicalMaterial({ color: 0xd9d3c8, roughness: 0.95, sheen: 0.5, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff), side: THREE.DoubleSide });
  const duvet = new THREE.Mesh(duvetG, linen); duvet.position.set(0, 0.56, 0.18); duvet.castShadow = true; duvet.receiveShadow = true;
  bed.add(frame, mattress, duvet);
  for (const [px, pz, ry] of [[-0.45, -0.85, 0.1], [0.45, -0.88, -0.08]]) {
    const pg = new THREE.SphereGeometry(0.5, 24, 12); pg.scale(0.62, 0.17, 0.36);
    const pil = new THREE.Mesh(pg, linen); pil.position.set(px, 0.6, pz); pil.rotation.y = ry; pil.castShadow = true; bed.add(pil);
  }
  bed.position.set(0, 0, -40.3);
  bed.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  chamber.add(bed);
  const ns = await place('ClassicNightstand_01', [1.45, 0, -41.2], -Math.PI / 2 + 0.1);
  const lamp = await place('vintage_oil_lamp', [1.5, 0.69, -41.45], 0.4);
  const lampL = new THREE.PointLight(0xffb060, 2.2, 6, 2); lampL.position.set(1.5, 1.05, -41.45); scene.add(lampL);
  const bowl = await place('wooden_bowl_01', [1.42, 0.69, -41.0], 0, 1);
  const cherryG = new THREE.SphereGeometry(0.014, 14, 10);
  const cherryM = new THREE.MeshPhysicalMaterial({ color: 0x6a0812, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 });
  const cherries = new THREE.Group();
  for (let i = 0; i < 14; i++) { const c = new THREE.Mesh(cherryG, cherryM); const a = R() * 6.28, r = R() * 0.05; c.position.set(Math.cos(a) * r, 0.03 + R() * 0.02, Math.sin(a) * r); cherries.add(c); }
  cherries.position.copy(bowl.position); scene.add(cherries);
  // the small green bottle: innocent here. (It will matter later.)
  const bottle = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.018, 0], [0.019, 0.002], [0.019, 0.05], [0.012, 0.058], [0.007, 0.062], [0.007, 0.075], [0, 0.075]].map(([a, b]) => new THREE.Vector2(a, b)), 24),
    new THREE.MeshPhysicalMaterial({ color: 0x1f5a2c, transparent: true, opacity: 0.82, roughness: 0.08, clearcoat: 1, envMapIntensity: 1.8 }));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 12), new THREE.MeshStandardMaterial({ color: 0xc0b090, metalness: 0.8, roughness: 0.3 }));
  cap.position.y = 0.08; bottle.add(cap);
  bottle.position.set(1.6, 0.69, -40.85); scene.add(bottle);
  // jungle plants (scans) + big tropical leaves + twisted trees
  const plants = [['pachira_aquatica_01', -4.9, -37.6, 2.4], ['pachira_aquatica_01', 4.9, -44.3, 2.8], ['calathea_orbifolia_01', -2.6, -43.6, 2.0], ['anthurium_botany_01', 3.2, -37.6, 2.0], ['fern_02', -5.2, -44.2, 2.6], ['potted_plant_02', 5.2, -40.5, 1.6], ['fern_02', 2.6, -45.2, 2.2], ['calathea_orbifolia_01', -5.6, -35.6, 2.0], ['shrub_02', 5.4, -35.4, 1.2], ['fern_02', -3.4, -37.2, 1.8], ['fern_02', 3.8, -42.6, 1.6], ['anthurium_botany_01', -4.0, -41.0, 1.6], ['calathea_orbifolia_01', 1.0, -44.8, 1.6], ['fern_02', -1.6, -45.4, 2.0]];
  for (const [n, x, z, s] of plants) await place(n, [x, 0, z], R() * 6, s);
  const bigCards = [];
  const bigMat = new THREE.MeshStandardMaterial({ map: bigLeafTex(0), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55 });
  const bigMat2 = new THREE.MeshStandardMaterial({ map: bigLeafTex(1), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55 });
  const bigLeaves = new THREE.Group();
  function bigLeaf(x, y, z, s, ry, rx, m) {
    const g = new THREE.PlaneGeometry(0.5 * s, 1 * s, 1, 4); g.translate(0, 0.5 * s, 0);
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const yy = p.getY(i) / s; p.setZ(i, -0.25 * yy * yy * s); } g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, 0); mesh.castShadow = true; mesh.receiveShadow = true;
    bigLeaves.add(mesh);
  }
  const clumps = [[-3.6, -35.6, 12], [3.7, -36.0, 12], [-5.6, -40.5, 10], [5.8, -41.5, 10], [-2.2, -45.2, 8], [2.2, -45.4, 8], [-1.5, -34.6, 6], [1.8, -34.8, 6], [-5.6, -45.2, 9], [5.7, -37.6, 9], [-2.8, -38.8, 5], [3.0, -39.6, 5]];
  for (const [cx, cz, n] of clumps) for (let k = 0; k < n; k++) bigLeaf(cx + (R() - 0.5) * 1.4, R() * 0.5, cz + (R() - 0.5) * 1.4, 1.0 + R() * 1.8, R() * 6.28, -0.2 - R() * 0.9, R() < 0.6 ? bigMat : bigMat2);
  // vines climbing every chamber wall
  const wallVines = [];
  for (let i = 0; i < 5200; i++) {
    const side = Math.floor(R() * 3);
    const y = Math.pow(R(), 0.7) * 7.8;
    const p = side === 0 ? new THREE.Vector3((R() - 0.5) * 13, y, CH.z1 + 0.1) : new THREE.Vector3(side === 1 ? CH.x0 + 0.05 : CH.x1 - 0.05, y, -34.5 - R() * 11.5);
    wallVines.push({ pos: p, scale: 0.7 + R() * 0.8, sway: 0.3, color: new THREE.Color().setHSL(0.25 + R() * 0.07, 0.45, 0.16 + R() * 0.12) });
  }
  chamber.add(leafCards({ cards: wallVines, atlas: leafMat, size: 0.3, translucent: 0.25 }));
  mergeByMaterial(bigLeaves);
  chamber.add(bigLeaves);
  for (let i = 0; i < 4; i++) {
    const t = makeTree({ seed: 300 + i, height: 9, trunkR: 0.22, depth: 4, gnarl: 0.5, spread: 0.75, barkMat: pbr('bark_brown_02'), twigs: false });
    t.position.set(i < 2 ? -5.4 : 5.5, 0, i % 2 ? -36.8 : -44.6);
    const cards = t.userData.tips.flatMap((p) => Array.from({ length: 30 }, () => ({ pos: p.clone().add(new THREE.Vector3((R() - 0.5) * 2, (R() - 0.5) * 1.4, (R() - 0.5) * 2)), scale: 0.8 + R() * 0.7, color: new THREE.Color().setHSL(0.27 + R() * 0.06, 0.4, 0.22 + R() * 0.08) })));
    t.add(leafCards({ cards, atlas: leafMat, size: 0.36, translucent: 0.4 }));
    chamber.add(t);
  }
  // string lights over the bed
  {
    const fp = [];
    for (let i = 0; i < 70; i++) { const t = i / 69; fp.push(new THREE.Vector3(-5 + t * 10, 5.6 - Math.sin(t * Math.PI) * 1.5 + Math.sin(t * 40) * 0.05, -40 + Math.sin(t * 7) * 2.6)); }
    chamber.add(glowPoints(fp, 0.28, 0xffc070));
  }
  const chamberL = new THREE.PointLight(0xffb870, 3.0, 12, 2); chamberL.position.set(0, 4.5, -40); scene.add(chamberL);

  // ---------- story objects: alcoves, window, doors ----------
  // frosted window in the right alcove (z -15.4..-12.6): blue light, snow outside
  const winG = new THREE.Group();
  const winGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.2), new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOn: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; uniform float uOn; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      void main(){
        vec3 night = mix(vec3(0.02,0.07,0.13), vec3(0.08,0.2,0.32), vUv.y);
        float flakes = 0.0;
        for(int k=0;k<3;k++){ vec2 g = vUv*vec2(18.0,26.0)*(1.0+float(k)*0.6) + vec2(sin(uTime*0.3+float(k))*0.5, uTime*(1.2+float(k)*0.5)); vec2 c = fract(g)-0.5; float r = h(floor(g)+float(k)*7.0); flakes += step(0.82,r)*smoothstep(0.12,0.0,length(c)); }
        float frost = smoothstep(0.35, 0.95, n(vUv*9.0)*0.6 + n(vUv*30.0)*0.4 + pow(abs(vUv.x-0.5)*2.0,3.0) + pow(abs(vUv.y-0.5)*2.0,3.0)*0.8);
        vec3 c = night + flakes*vec3(0.7,0.85,1.0)*0.9;
        c = mix(c, vec3(0.55,0.7,0.85), frost*0.75);
        gl_FragColor = vec4(c*(0.25+uOn*2.2), 1.0);
      }`,
  }));
  winG.add(winGlass);
  const winFrame = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.4, 0.08), wood); winFrame.position.z = -0.05; winG.add(winFrame);
  const mull = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.2, 0.06), wood); mull.position.z = 0.02; winG.add(mull);
  const mull2 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.06), wood); mull2.position.set(0, 0.3, 0.02); winG.add(mull2);
  winG.position.set(4.32, 1.6, -14); winG.rotation.y = -Math.PI / 2;
  scene.add(winG);
  const winLight = new THREE.PointLight(0x5f9ad6, 0, 8, 2); winLight.position.set(3.4, 1.8, -14); scene.add(winLight);
  // alcove floors
  for (const [x, z] of [[-3.4, -13], [3.4, -14], [-3.4, -28], [3.4, -24], [3.4, -30.4]]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.2), floorMat); f.rotation.x = -Math.PI / 2; f.position.set(x, 0.004, z); scene.add(f); }
  // red doors: left alcove z -28, right alcoves z -24 and -30.4. In order: door1 (R -24), door2 (L -28), door3 (R -30.4)
  const doorSpots = [{ x: 4.3, z: -24, ry: -Math.PI / 2 }, { x: -4.3, z: -28, ry: Math.PI / 2 }, { x: 4.3, z: -30.4, ry: -Math.PI / 2 }];
  const doors = doorSpots.map((d, i) => {
    const g = new THREE.Group();
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.15, 0.06), new THREE.MeshStandardMaterial({ color: 0x6a3a26, roughness: 0.55 }));
    leaf.position.y = 1.075; g.add(leaf);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.3, 0.1), wood); fr.position.set(0, 1.15, -0.06); g.add(fr);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshStandardMaterial({ color: 0x8a7050, metalness: 0.8, roughness: 0.35 })); knob.position.set(0.38, 1.0, 0.05); g.add(knob);
    // red light leaking under the door
    const leak = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xff1a12, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    leak.rotation.x = -Math.PI / 2; leak.position.set(0, 0.012, 0.32); g.add(leak);
    const rl = new THREE.PointLight(0xff2010, 0, 4.5, 1.6); rl.position.set(0, 0.08, 0.5); g.add(rl);
    // chains across the door
    const links = [];
    for (let k = 0; k < 22; k++) { const t = k / 21; links.push({ x: -0.5 + t, y: 1.55 - Math.sin(t * Math.PI) * 0.35, z: 0.06, r: k % 2 }); }
    for (let k = 0; k < 22; k++) { const t = k / 21; links.push({ x: -0.5 + t, y: 0.9 + Math.sin(t * Math.PI) * 0.25 - t * 0.3, z: 0.07, r: k % 2 }); }
    const lg = new THREE.TorusGeometry(0.036, 0.011, 6, 14); lg.scale(1.45, 1, 1);
    const lim = new THREE.InstancedMesh(lg, new THREE.MeshStandardMaterial({ color: 0xb0a8a0, metalness: 0.85, roughness: 0.35 }), links.length);
    const m4 = new THREE.Matrix4();
    links.forEach((l, j) => { m4.compose(new THREE.Vector3(l.x, l.y, l.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(l.r ? Math.PI / 2 : 0, 0, 0)), new THREE.Vector3(1, 1, 1)); lim.setMatrixAt(j, m4); });
    lim.visible = false; g.add(lim);
    g.position.set(d.x, 0, d.z); g.rotation.y = d.ry;
    scene.add(g);
    return { g, leak, rl, chains: lim, front: new THREE.Vector3(d.x + (d.x > 0 ? -0.6 : 0.6), 1.2, d.z) };
  });

  // exit: the garden fills with snow once the radio has spoken
  const snow = new Snow({ count: 7000, box: [30, 16, 30], size: 0.022, wind: [0.2, -0.7, 0.05], turb: 0.2, streak: 0.4, intensity: 1.4, opacity: 0.85 });
  snow.density = 0; scene.add(snow.mesh);

  // her (for the cherry memory and the reunion), built lazily
  let her = null;
  async function ensureHer(pose, color) {
    if (her) { scene.remove(her.group); }
    her = await makeHer({ pose, color, points: 6000, size: 0.02, shellOpacity: 0.28 });
    scene.add(her.group);
    return her;
  }

  // glow markers that pull the player toward the next memory
  const lure = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffd8a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  lure.scale.setScalar(0.9); scene.add(lure);
  const motes = new Drifters({ count: 60, atlas: glowTex(), grid: 1, size: 0.03, box: [4, 8, 34], center: new THREE.Vector3(0, 0.3, -17), kind: 'seed', drift: [0, 0, 0], color: 0xffd090, emissive: 0xffb060, blending: true });
  motes.mesh.material.blending = THREE.AdditiveBlending;
  scene.add(motes.mesh);

  // ---------- story state ----------
  const S = { radioOn: false };
  const F = E.flags;
  const items = {};
  function lureAt(v) { if (!v) { S.lureTarget = null; return; } S.lureTarget = v.clone(); }

  function refresh() {
    clearItems();
    const next = !F.m_park ? 'book' : !F.road1 ? 'window' : !F.m_field ? 'globe' : !F.m_cherry ? 'cherry' : !F.radio ? 'radio' : (!F.r1 ? 'door1' : !F.r2 ? 'door2' : !F.r3 ? 'door3' : (!F.reunion ? 'bed' : null));
    S.next = next;
    // the book: first memory
    items.book = addInteract({ obj: bookG, radius: 0.25, label: 'p.book', hold: 1.4, enabled: true, seen: !!F.m_park, onUse: () => memory('park') });
    if (F.m_park) items.book.enabled = false;
    items.window = addInteract({ pos: new THREE.Vector3(4.2, 1.6, -14), radius: 0.7, dist: 3, label: 'p.window', hold: 1.4, enabled: F.m_park && !F.road1, onUse: async () => { await say('hub.narr_window'); go('road', { visit: 1, color: 0x0a1a2a }); } });
    items.globe = addInteract({ obj: globe, radius: 0.15, label: 'p.globe', hold: 1.4, enabled: F.road1 && !F.m_field, onUse: () => memory('field') });
    items.cherry = addInteract({ obj: cherries, radius: 0.25, angle: 0.3, label: 'p.cherries', hold: 1.4, enabled: F.m_field && !F.m_cherry, onUse: () => cherryMemory() });
    items.bottle = addInteract({ obj: bottle, radius: 0.03, angle: 0.07, dist: 1.6, label: 'p.bottle', hold: 0, enabled: !S.saidBottle, onUse: async () => { S.saidBottle = true; await say('hub.him_bottle', { dur: 2 }); } });
    items.radio = addInteract({ obj: props.radio, radius: 0.3, label: 'p.radio', hold: 1.0, enabled: F.m_cherry && !F.radio, onUse: () => radioSpeaks() });
    doors.forEach((d, i) => {
      const n = i + 1;
      const open = F.radio && !F['r' + n] && (n === 1 || F['r' + (n - 1)]);
      d.chains.visible = F.radio && !F['r' + n];
      d.leak.material.opacity = F.radio && !F['r' + n] ? (open ? 0.85 : 0.35) : 0;
      d.rl.intensity = F.radio && !F['r' + n] ? (open ? 2.6 : 0.7) : 0;
      items['door' + n] = addInteract({ pos: d.front.clone(), radius: 0.6, dist: 2.6, label: 'p.door', hold: 2.2, enabled: open, onUse: async () => { if (!S.saidDoor) { S.saidDoor = true; await say('hub.him_door', { dur: 2.2 }); } E.audio?.heartbeat(); go('red' + n, { fadeOut: 1.4 }); } });
    });
    items.exit = addInteract({ pos: new THREE.Vector3(0, 1.4, 3.5), radius: 2.5, dist: 4, label: 'p.exit', hold: 2.0, enabled: F.radio && !F.reunion, onUse: () => leaveEarly() });
    // window lights up when it's its turn; snow in the garden after the radio
    winGlass.material.uniforms.uOn.value = F.m_park && !F.road1 ? 1 : 0.15;
    winLight.intensity = F.m_park && !F.road1 ? 2.2 : 0.2;
    snow.density = F.radio ? 0.9 : 0;
    const target = { book: bookG.position, window: new THREE.Vector3(3.6, 1.6, -14), globe: globe.position, cherry: cherries.position, radio: props.radio.position, door1: doors[0].front, door2: doors[1].front, door3: doors[2].front, bed: new THREE.Vector3(0, 1, -40.3) }[next];
    lureAt(target);
  }
  function clearItems() { for (const k in items) { items[k].enabled = false; } E.ui.setPrompt(null); }

  async function memory(id) {
    player.canMove = false;
    E.audio?.chime();
    E.audio?.whoosh(2.2);
    E.post.setLook({ exposure: 3.6, bloom: 0.3 }, 1.6);
    await tween(2.2, (k) => { E.post.fx.warp = k * 0.5; });
    await fadeOut(0.6, 0xffffff);
    go(id, { fadeOut: 0, color: 0xffffff });
  }

  async function cherryMemory() {
    const ep = currentEpoch();
    player.canMove = false;
    E.audio?.chime();
    await fadeOut(1.6, 0xffffff);
    // morning: warmer, softer; she is in bed
    await ensureHer('lie', 0xffe6c0);
    her.group.position.set(-0.05, 0.6, -41.05); her.group.rotation.set(-Math.PI / 2, 0, 0);
    her.group.rotation.order = 'YXZ'; her.group.rotation.set(-Math.PI / 2, Math.PI, 0);
    E.post.setLook({ exposure: 1.25, sat: 1.0, tint: [1.06, 1.0, 0.9], bloom: 0.14, halation: 0.12, dof: 0.5, focus: 1.6, focusRange: 0.6 }, 1);
    player.pos.set(1.0, 0, -39.4); player.yaw = 2.6; player.pitch = -0.35;
    E.audio?.playMusic('her');
    await fadeIn(2);
    player.canMove = true;
    await say('cherry.narr_1');
    await say('cherry.her_1', { dur: 2.4 });
    // take a cherry
    let held = false;
    const take = addInteract({ obj: cherries, radius: 0.15, dist: 2.2, label: 'p.take_cherry', hold: 0, onUse: () => { held = true; } });
    await until(() => held);
    const c = cherries.children[0]; cherries.remove(c); E.camera.add(c); c.position.set(0.06, -0.08, -0.25); c.scale.setScalar(1.3);
    if (!E.camera.parent) scene.add(E.camera);
    let given = false;
    const give = addInteract({ pos: new THREE.Vector3(-0.1, 0.85, -41.2), radius: 0.4, dist: 2.2, label: 'p.give_cherry', hold: 0, onUse: () => { given = true; } });
    await until(() => given);
    player.canMove = false;
    await tween(1.4, (k) => { c.position.z = -0.25 - k * 0.2; c.position.y = -0.08 + k * 0.05; });
    E.camera.remove(c);
    await fadeOut(1.8, 0x1a0e08);
    await wait(1.2);
    await say('cherry.narr_2');
    await say('cherry.narr_3');
    if (!alive(ep)) return;
    scene.remove(her.group); her = null;
    F.m_cherry = true;
    E.audio?.stopMusic(3);
    E.post.setLook(LOOK, 0.8);
    player.canMove = true;
    await fadeIn(2.5);
    E.audio?.playMusic('library');
    E.audio?.amb('radio', 0.15, 3); // the radio is warming up in the corner
    refresh();
  }

  async function radioSpeaks() {
    player.canMove = false;
    E.audio?.stopMusic(2);
    E.audio?.amb('radio', 0.6, 0.5);
    await wait(1.2);
    await say('hub.radio_1', { who: 'radio' });
    await say('hub.radio_2', { who: 'radio' });
    await say('hub.radio_3', { who: 'radio' });
    E.audio?.amb('radio', 0.0, 2);
    F.radio = true;
    player.canMove = true;
    // red light under the doors; the garden behind is snowing now
    E.audio?.amb('drone', 0.25, 6);
    E.audio?.heartbeat();
    refresh();
    await wait(2);
    await say('hub.narr_exit');
  }

  async function leaveEarly() {
    player.canMove = false;
    E.audio?.stopMusic(4); E.audio?.stopAllAmb(4);
    await fadeOut(3, 0xe9ebee);
    go('bench', { fadeOut: 0, color: 0xe9ebee });
  }

  async function reunion() {
    const ep = currentEpoch();
    S.inReunion = true;
    player.canMove = false;
    // turn to face her
    const target = her.group.position.clone().add(new THREE.Vector3(0, 1.1, 0));
    const dir = target.clone().sub(E.camera.position);
    const yaw1 = Math.atan2(-dir.x, -dir.z), pitch1 = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    const y0 = player.yaw, p0 = player.pitch;
    const dy = Math.atan2(Math.sin(yaw1 - y0), Math.cos(yaw1 - y0));
    await tween(2, (k) => { player.yaw = y0 + dy * k; player.pitch = p0 + (pitch1 - p0) * k; });
    E.post.setLook({ dof: 0.6, focus: dir.length(), focusRange: 0.5, exposure: 1.1, sat: 0.8 }, 1);
    await say('reu.him_1');
    await say('reu.her_1');
    const c = await choose(['reu.c_missed', 'reu.c_why']);
    if (c === 0) { await say('reu.him_missed'); await say('reu.her_missed'); }
    else { await say('reu.him_why'); await say('reu.her_why'); }
    await say('reu.him_2');
    await say('reu.her_2');
    await say('reu.him_3');
    await say('reu.her_3');
    await say('reu.him_4');
    await say('reu.her_4');
    await say('reu.her_5');
    if (!alive(ep)) return;
    let let_go = false;
    player.canLook = true;
    addInteract({ obj: her.group, radius: 0.8, dist: 4, angle: 0.6, label: 'p.letgo', hold: 3.0, onUse: () => { let_go = true; } });
    await until(() => let_go);
    player.canLook = false;
    F.reunion = true;
    E.audio?.stopMusic(8);
    E.audio?.whoosh(5);
    snow.density = 0.6; snow.mesh.position.set(0, 0, 0);
    E.post.setLook({ exposure: 1.7 }, 0.2);
    await tween(7, (k) => { her.uniforms.uDissolve.value = k; her.lightScale = 1 - k; });
    await wait(2);
    await fadeOut(3, 0xffffff);
    go('road', { visit: 2, fadeOut: 0, color: 0xffffff });
  }

  // ---------- look ----------
  const LOOK = {
    exposure: 1.05, bloom: 0.11, halation: 0.07, lift: [0.015, 0.01, 0.0], gamma: [1, 1, 1], gain: [1.05, 1.0, 0.88], sat: 1.08, contrast: 1.14, tint: [1.03, 1.0, 0.9],
    vignette: 0.5, grain: 0.045, ca: 0.5, dof: 0.35, focus: 6, focusRange: 5, rays: 0.0, raysTint: [1.0, 0.85, 0.6], raysThreshold: 0.9, raysDecay: 0.965, raysLen: 0.85, raysLight: [0.5, 1.1],
  };

  const obj = {
    scene,
    async enter(o0 = {}) {
      const o = { ...opts, ...o0 };
      if (S.entered && !o0.spawn && !o0.wake) o.spawn = 'hall';
      S.entered = true;
      player.eye = player.eyeTarget = 1.62;
      if (her && !(F.r1 && F.r2 && F.r3 && !F.reunion)) { scene.remove(her.group); her = null; }
      E.post.fx.warp = 0;
      player.colliders = colliders.concat([
        { minX: -0.95, maxX: 0.95, minZ: -41.5, maxZ: -39.1 }, // bed
        { minX: 1.15, maxX: 1.8, minZ: -41.6, maxZ: -40.75 }, // nightstand
        { minX: -3.4, maxX: -2.8, minZ: -35.7, maxZ: -34.9 }, // radio table
        { minX: -2.4, maxX: -1.15, minZ: -20.6, maxZ: -19.7 }, // side table
      ]);
      player.bounds = (p) => {
        if (p.z > 2) { p.x = THREE.MathUtils.clamp(p.x, -16, 16); p.z = Math.min(p.z, 30); }
        else if (p.z > -34) {
          // nave + alcoves
          const inAl = (lo, hi) => p.z < hi && p.z > lo;
          const minX = (inAl(-14.3, -11.7) || inAl(-29.0, -27.0)) ? -3.9 : -NAVE_W / 2 + 0.3;
          const maxX = (inAl(-15.2, -12.8) || inAl(-25.0, -23.0) || inAl(-31.2, -29.6)) ? 3.9 : NAVE_W / 2 - 0.3;
          p.x = THREE.MathUtils.clamp(p.x, minX, maxX);
          if (p.z > -0.2 && Math.abs(p.x) > NAVE_W / 2 - 0.3 && p.z < 2) p.z = Math.max(p.z, 2.05);
        } else {
          p.x = THREE.MathUtils.clamp(p.x, CH.x0 + 0.5, CH.x1 - 0.5); p.z = Math.max(p.z, CH.z1 + 0.6);
          if (p.z > -34.6 && Math.abs(p.x) > NAVE_W / 2 - 0.3) p.z = -34.6;
        }
      };
      player.speed = 2.0; player.runSpeed = 3.8;
      player.onStep = (spd) => {
        const z = player.pos.z;
        if (z > 1.5) E.audio?.step('grass', spd, { gain: 0.4 });
        else E.audio?.step('wood', spd, { gain: 0.45, hall: 0.25, send: 0.12 });
      };
      E.post.snapLook(LOOK);
      E.ui.crosshair(true);
      const sp = o.spawn;
      const spawns = {
        hall: [0, -1.5, 0], book: [-0.4, -9.4, 0.5], window: [1.6, -14.2, 1.2], globe: [-0.5, -21.2, -0.2],
        door1: [2.6, -24, -1.4], door2: [-2.6, -28, 1.4], door3: [2.6, -30.4, -1.4],
      };
      E.audio?.stopAllAmb(1);
      E.audio?.setHall(0, 1); E.audio?.setRev(0.55, 1); E.audio?.muffle(18000, 0.5); E.audio?.setWow(6, 1.5);
      if (o.wake && !sp) {
        await wakeUp();
      } else {
        const s = spawns[sp] || spawns.hall;
        player.pos.set(s[0], 0, s[1]); player.yaw = s[2]; player.pitch = 0;
        E.audio?.amb('birds', 0.12, 2); E.audio?.amb('room', 0.4, 2); E.audio?.amb('clock', 0.5, 3);
        E.audio?.playMusic('library');
        if (F.radio) E.audio?.amb('drone', 0.2, 4);
        refresh();
        afterReturn(sp);
      }
    },
    update(dt, t) {
      WIND.uTime.value = t;
      butterflies.update(dt, t); seeds.update(dt, t); motes.update(dt, t);
      snow.update(dt, E.camera);
      winGlass.material.uniforms.uTime.value = t;
      her?.update(dt, t);
      // fog and light follow where you are: open garden → hazy golden canyon → dim green chamber
      const z = player.pos.z;
      const inGarden = THREE.MathUtils.smoothstep(z, -4, 3);
      const inChamber = THREE.MathUtils.smoothstep(-z, 31, 37);
      gardenGrp.visible = z > -12;
      chamber.visible = z < -10;
      scene.fog.density = 0.005 + (1 - inGarden) * 0.017 - inChamber * 0.008;
      scene.fog.color.setRGB(0.8 - (1 - inGarden) * 0.4 - inChamber * 0.18, 0.78 - (1 - inGarden) * 0.46 - inChamber * 0.14, 0.7 - (1 - inGarden) * 0.52 - inChamber * 0.12);
      hemi.intensity = 0.45 - inChamber * 0.25;
      E.post.target.rays = (1 - inGarden) * (1 - inChamber) * 0.35;
      // god rays come from the bright slit of canopy above, in front of you
      E.post.target.raysLight = [0.5, 1.25];
      // a luminous mote hovers by whatever wants remembering next
      if (S.lureTarget && !S.inReunion) {
        const d = E.camera.position.distanceTo(S.lureTarget);
        lure.position.copy(S.lureTarget).add(new THREE.Vector3(0, 0.35 + Math.sin(t * 1.3) * 0.05, 0));
        lure.material.opacity = THREE.MathUtils.lerp(lure.material.opacity, THREE.MathUtils.clamp(d / 6, 0.25, 0.8), 0.05);
        lure.scale.setScalar(0.5 + Math.sin(t * 2) * 0.05);
      } else lure.material.opacity *= 0.95;
      bulbPts.material.opacity = 0.8 + Math.sin(t * 2) * 0.08;
      // reunion trigger
      if (F.r1 && F.r2 && F.r3 && !F.reunion && her && !S.inReunion && player.pos.distanceTo(her.group.position) < 2.6) reunion();
      if (E.audio?.ready) { const f = new THREE.Vector3(); E.camera.getWorldDirection(f); E.audio.setListener(E.camera.position, f, E.camera.up); }
    },
    dispose() { /* persistent hub: kept in memory between memories */ },
    exit() { S.inReunion = false; E.blockInteract = false; },
  };

  // ---------- arrivals ----------
  async function wakeUp() {
    player.pos.set(0.6, 0, 14); player.yaw = 0.3; player.pitch = 0.95; player.eye = player.eyeTarget = 0.16;
    player.canMove = false; player.pitchMin = -1.3; player.pitchMax = 1.45;
    E.post.snapLook({ ...LOOK, exposure: 1.0, bloom: 0.16, halation: 0.1, dof: 0.5, focus: 2.5, focusRange: 2.0, sat: 1.0, tint: [1.0, 1.0, 0.97], gain: [1.0, 1.0, 0.97] });
    E.post.fx.fade = 1; E.post.fx.fadeColor.set(0x000000);
    E.audio?.amb('birds', 0.0); E.audio?.amb('birds', 0.35, 6);
    await wait(1.5);
    // eyes open: two slow blinks
    await tween(2.5, (k) => { E.post.fx.fade = 1 - k * 0.6; });
    await tween(0.35, (k) => { E.post.fx.fade = 0.4 + k * 0.6; });
    await tween(3, (k) => { E.post.fx.fade = 1 - k; });
    E.post.setLook({ ...LOOK, exposure: 1.05, bloom: 0.12, tint: [1.0, 1.0, 0.97], gain: [1.0, 1.0, 0.97] }, 0.3);
    E.audio?.playMusic('garden');
    await say('s1.him_warm', { dur: 2.6 });
    wait(5).then(() => { if (!S.up) E.ui.hint(T('p.getup')); });
    await until(() => input.anyMoveKey || input.keys.has('KeyW') || input.keys.has('ArrowUp') || input.interactPressed || !!input.touchMove);
    S.up = true; E.ui.hint(null);
    await tween(2.4, (k) => { player.eye = player.eyeTarget = 0.16 + k * 1.46; player.pitch = 0.95 * (1 - k); }, (x) => 1 - Math.pow(1 - x, 3));
    E.post.setLook(LOOK, 0.4);
    player.canMove = true; player.pitchMin = -1.3; player.pitchMax = 1.3;
    refresh();
    await until(() => player.pos.z < 4);
    await say('s1.him_been');
    await until(() => player.pos.z < -2.5);
    E.audio?.playMusic('library');
    E.audio?.amb('room', 0.4, 4); E.audio?.amb('clock', 0.5, 6); E.audio?.amb('birds', 0.1, 6);
    F.woke = true;
    await say('hub.narr_enter');
  }
  async function afterReturn(sp) {
    if (F.r1 && F.r2 && F.r3 && !F.reunion) {
      // the red rooms are done: their lights go out; someone waits by the bed
      await wait(1.5);
      await say('hub.narr_alldone');
      E.audio?.amb('drone', 0, 6);
      await ensureHer('sit', 0xfff0dc);
      her.group.position.set(0.0, 0.0, -39.4);
      her.group.position.y = 0.52 - her.hipY;
      her.group.rotation.y = 0;
      await wait(2);
      await say('hub.narr_bedlight');
      E.audio?.playMusic('her');
    }
  }

  return obj;
}
