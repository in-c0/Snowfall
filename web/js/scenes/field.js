// Memory · the snowfield. A bright, clear winter day: deep blue sky, low sun, long blue shadows, sparkling snow.
// She races her wheelchair in loops, leaving two wheel tracks; he chases her on foot until she lets herself be caught.
// Ends in white → library (spawn 'globe').
import * as THREE from 'three';
import { E, player, wait, until, say, tween, go, fadeOut, T } from '../engine.js';
import { hdri, model, snowCover, pbr } from '../assets.js';
import { Snow } from '../fx/snow.js';
import { terrain, snowMaterial, forest, fbm } from '../fx/world.js';
import { makeHer, makeMan } from '../fx/figures.js';
import { rng, WIND } from '../fx/foliage.js';
import { glowTex } from '../fx/textures.js';

// ---------------------------------------------------------------- terrain
// Broad swells far out, an almost level bowl where they play (so the chase reads clearly).
function groundH(x, z) {
  const r = Math.hypot(x, z + 18);
  const far = THREE.MathUtils.smoothstep(r, 25, 90);
  const swell = (fbm(x * 0.012 + 5, z * 0.012) - 0.5) * 14;
  const near = (fbm(x * 0.03, z * 0.03 + 3) - 0.5) * 2.4 + (fbm(x * 0.12 + 1, z * 0.12) - 0.5) * 0.35;
  return near * (1 - far) + swell * far + far * 2.5;
}

// Her loop: a closed, irregular circuit through her starting spot (≈70 m around).
const LOOP = new THREE.CatmullRomCurve3([
  [0, -5], [-2.5, -13], [0.5, -22], [8, -28.5], [16.5, -26], [19.5, -17], [14, -9.5], [6, -3.5],
].map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
const LOOP_LEN = LOOP.getLength();
const _lp = new THREE.Vector3(), _lt = new THREE.Vector3();
function loopAt(s) { const u = ((s / LOOP_LEN) % 1 + 1) % 1; LOOP.getPointAt(u, _lp); LOOP.getTangentAt(u, _lt); return { p: _lp.clone(), t: _lt.clone().setY(0).normalize() }; }
const headingOf = (t) => Math.atan2(-t.x, -t.z); // yaw whose forward (-sin, -cos) is t
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// Seated pose (same as the park; see park.js). Here her chin is up and one hand lifts a little: she's racing.
const SIT_POSE = {
  LeftUpLeg: [86, 0, -4], RightUpLeg: [86, 0, 4],
  LeftLeg: [-84, 0, 0], RightLeg: [-84, 0, 0],
  LeftArm: [76, 0, 18], RightArm: [76, 0, -18],
  LeftForeArm: [0, 25, 80], RightForeArm: [0, -25, -80],
  Spine: [-2, 0, 0], Head: [-6, 0, 0],
};

// Two wheel tracks: ribbons that grow behind the chair (preallocated, drawRange grows).
class Tracks {
  constructor(max = 5000, gauge = 0.29, width = 0.075) {
    this.max = max; this.gauge = gauge; this.w = width; this.n = 0; this.last = null; this.acc = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 2 * 4 * 3); // 2 tracks × 2 verts per sample… stored as quads per segment
    this.uv = new Float32Array(max * 2 * 4 * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    const nrm = new Float32Array(max * 2 * 4 * 3); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    const idx = new Uint32Array(max * 2 * 6);
    for (let i = 0; i < max * 2; i++) { const v = i * 4; idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6); }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    // compressed snow: a little darker and bluer (it sits in its own micro-shadow), soft edges
    const m = new THREE.MeshStandardMaterial({ color: 0x7f98c4, roughness: 0.5, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vTU;').replace('#include <uv_vertex>', '#include <uv_vertex>\n vTU = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vTU;')
        .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n { float e = abs(vTU.x-0.5)*2.0; diffuseColor.a *= smoothstep(1.0, 0.45, e) * (0.75 + 0.25*sin(vTU.y*40.0)); diffuseColor.rgb *= mix(0.85, 1.05, e); }');
    };
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.renderOrder = 1;
    this.dist = 0;
  }
  // centre position + heading; called every frame, records a sample each ~0.14 m
  add(p, yaw) {
    if (!this.last) { this.last = { p: p.clone(), yaw }; return; }
    const d = p.distanceTo(this.last.p);
    if (d < 0.14 || this.n >= this.max) return;
    const a = this.last, k = this.n;
    this.dist += d;
    for (let side = 0; side < 2; side++) {
      const sg = side ? 1 : -1;
      const quad = (k * 2 + side) * 4;
      const pts = [[a.p, a.yaw, this.dist - d], [p, yaw, this.dist]];
      let vi = 0;
      for (const [pp, yw, dd] of pts) {
        const rx = Math.cos(yw), rz = -Math.sin(yw); // right vector for heading yaw
        const cx = pp.x + rx * this.gauge * sg, cz = pp.z + rz * this.gauge * sg;
        for (const e of [-1, 1]) {
          const x = cx + rx * this.w * 0.5 * e, z = cz + rz * this.w * 0.5 * e;
          this.pos.set([x, groundH(x, z) + 0.012, z], (quad + vi) * 3);
          this.uv.set([e * 0.5 + 0.5, dd], (quad + vi) * 2);
          vi++;
        }
      }
    }
    this.n++;
    this.last = { p: p.clone(), yaw };
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.uv.needsUpdate = true;
    g.setDrawRange(0, this.n * 2 * 6);
  }
}

export async function fieldScene() {
  const scene = new THREE.Scene();
  scene.userData.soft = true;
  const R = rng(777);

  // ---------------------------------------------------------------- sky & light
  const env = await hdri('snowy_field');
  scene.environment = env.env;
  scene.environmentIntensity = 0.3;
  const horizon = new THREE.Color(0xd4e2f4);
  scene.fog = new THREE.FogExp2(new THREE.Color(0xb8cbe6), 0.0018);
  // sun low in the south-west, in front-left of the player: long shadows run back toward him
  const SUN_DIR = new THREE.Vector3(-0.62, 0.3, -0.76).normalize();
  {
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: SUN_DIR }, uZen: { value: new THREE.Color(0x0e3a8c) }, uMid: { value: new THREE.Color(0x3f7fd0) }, uHor: { value: horizon } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uSun; uniform vec3 uZen; uniform vec3 uMid; uniform vec3 uHor; varying vec3 vD;
        void main(){ vec3 d = normalize(vD); float h = max(d.y, 0.0);
          vec3 c = mix(uHor, uMid, smoothstep(0.0, 0.18, h)); c = mix(c, uZen, smoothstep(0.15, 0.75, h));
          float s = max(dot(d, uSun), 0.0);
          c += vec3(1.0, 0.93, 0.8) * (pow(s, 8.0) * 0.25 + pow(s, 300.0) * 4.0 + pow(s, 3000.0) * 40.0);
          c = mix(c, uHor * 0.95, smoothstep(0.0, -0.1, d.y));
          gl_FragColor = vec4(c, 1.0); }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 24), m);
    sky.frustumCulled = false; sky.renderOrder = -10;
    scene.add(sky);
  }
  // the sky is blue: shadows on snow go blue
  const hemi = new THREE.HemisphereLight(0x5f8de6, 0xdfe6f2, 0.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2de, 4.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 200 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  // ---------------------------------------------------------------- ground
  const gmat = snowMaterial({ sparkle: 1.2, relief: 0.8, color: 0xf6f8fc });
  const ground = terrain({ w: 520, l: 520, cx: 0, cz: -30, segW: 180, segL: 180, heightFn: groundH, material: gmat });
  scene.add(ground);
  // a finer patch under the play area, so wheel tracks and shadows sit on accurate geometry
  const patch = terrain({ w: 60, l: 50, cx: 8, cz: -16, segW: 120, segL: 100, heightFn: (x, z) => groundH(x, z) + 0.003, material: gmat });
  scene.add(patch);

  // ---------------------------------------------------------------- the horizon: dark conifers + a few bare trees
  {
    // conifer: stacked cones + a trunk, merged; instanced
    const parts = [];
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
      const k = i / (tiers - 1);
      const r = THREE.MathUtils.lerp(0.32, 0.08, k), h = THREE.MathUtils.lerp(0.34, 0.2, k);
      const c = new THREE.ConeGeometry(r, h, 7, 1, true); c.translate(0, 0.16 + k * 0.72 + h / 2, 0);
      parts.push(c);
    }
    const trunk = new THREE.CylinderGeometry(0.02, 0.03, 0.2, 5, 1, true); trunk.translate(0, 0.1, 0);
    const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
    const cg = mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p; }).concat([(() => { trunk.deleteAttribute('uv'); return trunk; })()]), false);
    cg.computeVertexNormals();
    const cm = new THREE.MeshStandardMaterial({ color: 0x0f1c18, roughness: 0.95, envMapIntensity: 0.4 });
    snowCover(cm, { amount: { value: 0.12 } });
    const spots = [];
    for (let i = 0; i < 900; i++) {
      // a ragged band of forest 85–170 m out, thicker to the north and west, with gaps
      const a = R() * Math.PI * 2;
      const band = fbm(Math.cos(a) * 3 + 7, Math.sin(a) * 3);
      if (band < 0.42) continue;
      const rr = 85 + R() * 70 + (1 - band) * 30;
      const x = Math.cos(a) * rr, z = -18 + Math.sin(a) * rr;
      spots.push({ x, z, s: 9 + R() * 9 + band * 6, r: R() * 6.28 });
    }
    const im = new THREE.InstancedMesh(cg, cm, spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    spots.forEach((s, i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.r); sc.set(s.s * (0.85 + R() * 0.3), s.s, s.s * (0.85 + R() * 0.3)); p.set(s.x, groundH(s.x, s.z) - 0.4, s.z); m4.compose(p, q, sc); im.setMatrixAt(i, m4); });
    im.castShadow = false; im.receiveShadow = false;
    scene.add(im);
    // bare deciduous trees: a few loose groups, nearer than the conifers
    const bark = pbr('bark_brown_02', { repeat: 1, color: 0x3a3532 });
    const bspots = [];
    for (let g = 0; g < 7; g++) {
      const a = -2.6 + g * 0.55 + R() * 0.3, rr = 55 + R() * 30;
      const cx = Math.cos(a) * rr, cz = -18 + Math.sin(a) * rr;
      for (let i = 0; i < 3 + Math.floor(R() * 4); i++) bspots.push({ x: cx + (R() - 0.5) * 12, z: cz + (R() - 0.5) * 8, s: 0.8 + R() * 0.5 });
    }
    const bare = forest({ spots: bspots, variants: 3, seed: 31, barkMat: bark, snow: { amount: { value: 0.2 } }, tree: { height: 11, trunkR: 0.25, depth: 4, spread: 0.65, twigScale: 1.6 }, twigColor: 0x3a3634, heightFn: groundH, chunk: 400 });
    bare.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    scene.add(bare);
  }

  // ---------------------------------------------------------------- air: a few glittering crystals
  const snow = new Snow({ count: 2600, box: [22, 12, 22], size: 0.011, wind: [0.35, -0.22, 0.12], turb: 0.35, streak: 0.15, intensity: 2.6, fogDensity: 0.015, nearFade: 0.5 });
  scene.add(snow.mesh);

  // ---------------------------------------------------------------- her
  const cart = new THREE.Group();
  scene.add(cart);
  const chair = await model('wheelchair_01');
  const cb = new THREE.Box3().setFromObject(chair);
  chair.rotation.y = Math.PI; chair.position.y = -cb.min.y;
  cart.add(chair);
  const her = await makeHer({ pose: SIT_POSE, color: 0xfff6e8, points: 7000, size: 0.018, opacity: 1, shellOpacity: 0.18 });
  her.group.rotation.y = Math.PI;
  her.group.position.set(0, 0.6 - her.hipY, 0.12);
  her.uniforms.uColor.value.multiplyScalar(5.0); // HDR-bright so she blooms against the white
  her.shellU.uColor.value.multiplyScalar(2.5);
  her.lightScale = 2.0;
  cart.add(her.group);
  const tracks = new Tracks();
  scene.add(tracks.mesh);
  // snow thrown up by the wheels
  const SPRAY = 160;
  const spray = { p: [], v: [], life: new Float32Array(SPRAY), i: 0 };
  const sprayGeo = new THREE.BufferGeometry();
  const sprayPos = new Float32Array(SPRAY * 3);
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
  for (let i = 0; i < SPRAY; i++) { spray.p.push(new THREE.Vector3(0, -99, 0)); spray.v.push(new THREE.Vector3()); }
  const sprayPts = new THREE.Points(sprayGeo, new THREE.PointsMaterial({ map: glowTex(), size: 0.07, color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true }));
  sprayPts.frustumCulled = false;
  scene.add(sprayPts);

  // the player's own body: invisible, but casts its long shadow
  const body = await makeMan({ color: 0x000000 });
  body.root.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.colorWrite = false; o.material.depthWrite = false; } });
  scene.add(body.group);

  // ---------------------------------------------------------------- state
  const S = {
    s: 0, sp: 0, dir: 1, yaw: 0, spin: 0,
    phase: 'intro', chaseT: 0, caught: false, flips: 0, flipCool: 0,
  };
  const yaw0 = 0;

  function placeCart(dt) {
    const { p, t } = loopAt(S.s);
    const want = headingOf(t.clone().multiplyScalar(S.dir)) + S.spin;
    if (S.phase === 'caught') {
      // turn to face him
      const toP = Math.atan2(-(player.pos.x - cart.position.x), -(player.pos.z - cart.position.z));
      S.yaw += angDiff(toP, S.yaw) * (1 - Math.exp(-dt * 2.2));
    } else {
      S.yaw += angDiff(want, S.yaw) * (1 - Math.exp(-dt * 6));
    }
    cart.position.set(p.x, groundH(p.x, p.z), p.z);
    cart.rotation.y = S.yaw;
    // lean a touch into the turn
    cart.rotation.z = THREE.MathUtils.clamp(angDiff(want, S.yaw) * 0.25, -0.12, 0.12) * Math.min(S.sp / 3, 1);
  }

  function laugh(vel = 0.3) {
    const a = E.audio; if (!a?.ctx || !a.note) return;
    const t = a.ctx.currentTime + 0.05;
    const run = Math.random() < 0.5 ? ['G5', 'Bb5', 'D6', 'Eb6', 'G6', 'Bb6', 'D7'] : ['Eb6', 'G6', 'Bb6', 'C7', 'D7', 'G7'];
    run.forEach((n, i) => a.note(n, { vel: vel - i * 0.015, when: t + i * 0.055 + Math.random() * 0.01, dur: 0.6, rel: 1.4, pan: -0.2 + i * 0.07 }));
    a.note(run[run.length - 2], { vel: vel * 0.6, when: t + run.length * 0.055 + 0.1, dur: 1.2, rel: 2 });
  }
  async function herSay(key, opts) { laugh(); return say(key, opts); }

  const obj = {
    scene,
    dbg: { S: () => S, cart: () => cart, tracks: () => tracks },
    async enter() {
      player.pos.set(0, groundH(0, 1), 1); player.yaw = yaw0; player.pitch = -0.1;
      player.groundY = groundH;
      player.speed = 2.1; player.runSpeed = 4.0;
      player.canMove = false; player.canLook = true;
      player.bounds = (p) => { const dx = p.x - 8, dz = p.z + 16; const d = Math.hypot(dx, dz); if (d > 40) { p.x = 8 + dx / d * 40; p.z = -16 + dz / d * 40; } };
      player.onStep = (spd) => E.audio?.step('snow', spd, { gain: 0.5 });
      E.ui.crosshair(true);
      S.yaw = headingOf(loopAt(0).t);
      placeCart(1);
      E.post.snapLook({
        exposure: 0.92, bloom: 0.09, halation: 0.04,
        focus: 6, focusRange: 4, dof: 0.25, dofNear: 0.0,
        lift: [0.0, 0.006, 0.025], gamma: [1, 1, 1], gain: [1.03, 1.01, 0.99], sat: 1.15, contrast: 1.15, tint: [1.0, 1.0, 1.01],
        vignette: 0.3, ca: 0.2, grain: 0.04,
      });
      E.post.fx.letterbox = 0;
      E.audio?.amb('wind', 0.14, 4);
      E.audio?.playMusic('her');
      run();
    },
    update(dt, t) {
      WIND.uTime.value = t;
      // ---- her motion
      const dx = player.pos.x - cart.position.x, dz = player.pos.z - cart.position.z;
      const d = Math.hypot(dx, dz);
      let target = 0;
      if (S.phase === 'show') target = 3.2;
      if (S.phase === 'chase') {
        S.chaseT += dt;
        // early on she's quicker than him and dodges; after ~25 s she runs out of mischief
        const tired = THREE.MathUtils.smoothstep(S.chaseT, 18, 40);
        const cap = THREE.MathUtils.lerp(4.4, 1.3, tired);
        target = cap;
        if (d > 7) target = Math.min(cap, THREE.MathUtils.lerp(cap, 0.6, THREE.MathUtils.smoothstep(d, 7, 14))); // wait for him
        if (d < 3 && S.chaseT < 24) target = Math.max(target, 5.2); // burst away
        // if he cuts across and gets in front of her, she spins round and goes the other way
        S.flipCool -= dt;
        const { t: tan } = loopAt(S.s);
        const ahead = (dx * tan.x + dz * tan.z) * S.dir;
        if (ahead > 0 && d < 5.5 && S.flipCool < 0 && S.chaseT < 26) { S.dir *= -1; S.flipCool = 3.5; S.flips++; S.sp *= 0.3; laugh(0.22); }
        if (d < 1.8 && S.chaseT > 22) { S.phase = 'caught'; S.caught = true; player.canMove = false; player.vel.multiplyScalar(0.3); }
      }
      if (S.phase === 'caught') target = 0;
      const acc = target > S.sp ? 2.6 : (S.phase === 'caught' ? 5 : 2.2);
      S.sp += (target - S.sp) * (1 - Math.exp(-dt * acc));
      S.s += S.sp * S.dir * dt;
      placeCart(dt);
      tracks.add(cart.position, S.yaw);
      // ---- wheel spray
      if (S.sp > 1.5) {
        const n = Math.min(4, Math.floor(S.sp * dt * 18 + Math.random()));
        for (let k = 0; k < n; k++) {
          const i = spray.i = (spray.i + 1) % SPRAY;
          const side = Math.random() < 0.5 ? -1 : 1;
          const rx = Math.cos(S.yaw), rz = -Math.sin(S.yaw), fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw);
          spray.p[i].set(cart.position.x + rx * 0.3 * side - fx * 0.15, cart.position.y + 0.05, cart.position.z + rz * 0.3 * side - fz * 0.15);
          spray.v[i].set(-fx * S.sp * 0.25 + (Math.random() - 0.5) * 0.6 + rx * side * 0.3, 0.6 + Math.random() * 0.9, -fz * S.sp * 0.25 + (Math.random() - 0.5) * 0.6 + rz * side * 0.3);
          spray.life[i] = 0.6 + Math.random() * 0.5;
        }
      }
      for (let i = 0; i < SPRAY; i++) {
        if (spray.life[i] > 0) { spray.life[i] -= dt; spray.v[i].y -= 3.2 * dt; spray.p[i].addScaledVector(spray.v[i], dt); if (spray.life[i] <= 0) spray.p[i].y = -99; }
        sprayPos[i * 3] = spray.p[i].x; sprayPos[i * 3 + 1] = spray.p[i].y; sprayPos[i * 3 + 2] = spray.p[i].z;
      }
      sprayGeo.attributes.position.needsUpdate = true;
      her.update(dt, t);
      // ---- player body (shadow) + sun follows
      body.group.position.set(player.pos.x, player.pos.y, player.pos.z);
      body.group.rotation.y = player.yaw + Math.PI;
      const spd = player.currentSpeed || 0;
      if (spd > 2.8) { body.play('run', 0.3); body.acts.run.timeScale = spd / 3.6; } else if (spd > 0.3) { body.play('walk', 0.3); body.acts.walk.timeScale = spd / 1.4; } else body.play('idle', 0.4);
      body.update(dt);
      const mid = new THREE.Vector3().addVectors(player.pos, cart.position).multiplyScalar(0.5);
      sun.position.copy(mid).addScaledVector(SUN_DIR, 90);
      sun.target.position.copy(mid);
      // ---- focus on her
      if (S.phase !== 'end') E.post.target.focus = Math.max(E.camera.position.distanceTo(cart.position), 1.5);
      snow.update(dt, E.camera);
      if (E.audio?.ready) { const f = new THREE.Vector3(); E.camera.getWorldDirection(f); E.audio.setListener(E.camera.position, f, E.camera.up); }
    },
    dispose() { scene.traverse((o) => { o.geometry?.dispose?.(); }); },
  };

  // ---------------------------------------------------------------- script
  async function run() {
    await wait(1.5);
    await say('field.narr_1', { dur: 4.5 });
    await herSay('field.her_1');
    // she takes off: a flourish of a lap while he watches
    S.phase = 'show';
    await wait(2.2);
    await say('field.narr_2');
    await herSay('field.her_2');
    // the chase
    S.phase = 'chase';
    player.canMove = true;
    const ep0 = E.time;
    wait(4).then(() => { if (S.phase === 'chase' && player.moved < 2) E.ui.hint(T('p.catch')); });
    until(() => player.moved > 2 || S.phase !== 'chase').then(() => E.ui.hint(null));
    until(() => S.chaseT > 11 && S.phase === 'chase').then(async () => { laugh(0.26); await say('field.narr_3'); });
    await until(() => S.caught);
    E.ui.hint(null);
    console.log('field: caught at chase t', S.chaseT.toFixed(1), 'flips', S.flips, 'total', (E.time - ep0).toFixed(1));
    // she stops and turns; he slows; the world holds
    player.canMove = false;
    const yawTo = () => Math.atan2(-(cart.position.x - player.pos.x), -(cart.position.z - player.pos.z));
    const y0 = player.yaw, p0 = player.pitch;
    tween(1.6, (k) => { player.yaw = y0 + angDiff(yawTo(), y0) * k; player.pitch = p0 + (-0.22 - p0) * k; });
    E.post.setLook({ dof: 0.55, focusRange: 1.0 }, 1.5);
    await wait(1.4);
    await herSay('field.her_3');
    await say('field.him_1', { dur: 2.2 });
    await say('field.narr_4', { dur: 2.6 });
    S.phase = 'end';
    E.post.setLook({ exposure: 2.0, bloom: 0.4, halation: 0.15 }, 0.5);
    E.audio?.chime?.();
    E.audio?.stopMusic(4);
    E.audio?.stopAllAmb(4);
    await fadeOut(2.2, 0xffffff);
    E.flags.m_field = true;
    console.log('field: done → library');
    go('library', { spawn: 'globe', color: 0xffffff, fadeOut: 0 });
  }

  return obj;
}
