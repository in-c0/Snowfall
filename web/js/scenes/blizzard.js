// Scene 0 (intro: the walk behind the Shadow) and Scene 5 (ending: the bench). Same storm, different weather of the heart.
import * as THREE from 'three';
import { E, player, wait, until, say, choose, tween, go, fadeOut, addInteract, T, input, currentEpoch, alive } from '../engine.js';
import { hdri, model, applySnowToObject, pbr, silhouette, prefetch, loadGLTF } from '../assets.js';
import { Snow, FogCards } from '../fx/snow.js';
import { forest, terrain, snowMaterial, fbm, wineGlass, stainDecal, contactShadow, ground as groundObj } from '../fx/world.js';
import { makeMan } from '../fx/figures.js';
import { glowTex, mapleAtlas } from '../fx/textures.js';
import { WIND } from '../fx/foliage.js';

const ROAD_W = 7;
function groundH(x, z) {
  const road = Math.exp(-(x * x) / (2 * ROAD_W * ROAD_W));
  const dunes = (fbm(x * 0.05, z * 0.05) - 0.5) * 2.2 + (fbm(x * 0.4 + 9, z * 0.4) - 0.5) * 0.25;
  const bank = Math.max(0, Math.abs(x) - 5) * 0.06;
  return dunes * (1 - road * 0.85) + bank + road * -0.05;
}

export async function blizzardScene({ mode = 'intro', titleMode = false } = {}) {
  const END = mode === 'end';
  const scene = new THREE.Scene();
  scene.userData.soft = true;
  const fogCol = new THREE.Color(END ? 0xc8ccd2 : 0xc3c7cc);
  scene.background = fogCol.clone();
  scene.fog = new THREE.FogExp2(fogCol.clone(), END ? 0.03 : 0.042);
  const env = await hdri('snowy_field');
  scene.environment = env.env;
  scene.environmentIntensity = 0.55;

  const hemi = new THREE.HemisphereLight(0xdde4ec, 0x9aa0a8, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(END ? 0xfff1e0 : 0xe8eef6, END ? 0.9 : 0.45);
  sun.position.set(-30, 40, 20);
  sun.castShadow = END;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // ground
  const gmat = snowMaterial({ sparkle: END ? 0.8 : 0.25 });
  const ground = terrain({ w: 140, l: 520, cx: 0, cz: -200, segW: 120, segL: 400, heightFn: groundH, material: gmat });
  scene.add(ground);
  // forest: dense mass on the left, sparse on the right (like the reference photo)
  const spots = [];
  for (let z = 40; z > -460; z -= 1.7) {
    for (let k = 0; k < 4; k++) {
      const x = -4.2 - Math.pow(Math.random(), 1.4) * 30 - k * 2;
      spots.push({ x, z: z + Math.random() * 1.7, s: 0.75 + Math.random() * 0.8 });
    }
    if (Math.random() < 0.18) spots.push({ x: 14 + Math.random() * 40, z: z + Math.random() * 2, s: 0.6 + Math.random() * 0.8 });
  }
  const snowAmt = { amount: { value: 0.85 }, dir: { value: new THREE.Vector3(-0.85, 0.0, -0.35) } };
  const bark = pbr('bark_brown_02', { repeat: 1 });
  bark.color.set(0x8a8580);
  const trees = forest({ spots, variants: 5, seed: END ? 21 : 13, barkMat: bark, snow: snowAmt, tree: { height: 13, trunkR: 0.32, depth: 4, spread: 0.6, twigScale: 3.6 }, twigColor: 0x3a3532, heightFn: groundH });
  scene.add(trees);
  console.log('forest tris', trees.userData.tris, JSON.stringify(trees.userData.protoTris));

  // weather
  const snow = new Snow({ count: END ? 9000 : 20000, box: [26, 18, 26], size: 0.03, wind: END ? [0.25, -0.8, 0.05] : [2.4, -1.6, 0.8], turb: END ? 0.2 : 0.45, streak: END ? 0.6 : 1.6, intensity: 1.5, fogDensity: 0.05 });
  scene.add(snow.mesh);
  const fog = new FogCards({ count: 70, box: [90, 10, 90], size: 16, color: 0xe2e6ea, opacity: END ? 0.18 : 0.38, drift: END ? [0.4, 0, 0.1] : [3.2, 0, 1.0], near: 3 });
  scene.add(fog.mesh);

  // memorials, half buried along the road (intro only)
  const memorials = [];
  async function memorial(name, pos, rot, sink = 0.2, scale = 1) {
    const o = await model(name, { scale });
    o.rotation.set(...rot);
    groundObj(o, pos[0], pos[2], groundH, sink);
    const cs = contactShadow(1.6 * scale, 1.6 * scale, 0.35); cs.position.set(pos[0], groundH(pos[0], pos[2]) + 0.01, pos[2]); scene.add(cs);
    applySnowToObject(o, snowAmt);
    scene.add(o); memorials.push(o); return o;
  }
  if (!END) {
    await Promise.all([
      memorial('wheelchair_01', [3.2, 0, -26], [0.1, 0.6, 1.25], 0.28),
      memorial('vintage_radio_transceiver', [-2.9, 0, -58], [0, 2.4, 0.12], 0.08, 1.4),
      memorial('Rockingchair_01', [4.0, 0, -88], [0.0, -0.7, 0.0], 0.25),
      memorial('wooden_bowl_01', [-2.4, 0, -116], [0.25, 0.3, 0], 0.03, 1.4),
      memorial('street_lamp_01', [5.5, 0, -142], [0, 0, 0.16], 0.5),
    ]);
    // cherries spilled from the bowl: the only colour in the white
    const cg = new THREE.SphereGeometry(0.014, 14, 10);
    const cm = new THREE.MeshPhysicalMaterial({ color: 0x5e0610, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.1 });
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Mesh(cg, cm);
      c.position.set(-2.4 + (Math.random() - 0.5) * 0.7, groundH(-2.4, -116) + 0.004, -116 + (Math.random() - 0.5) * 0.7);
      c.scale.y = 0.95; c.castShadow = true; scene.add(c);
    }
  }

  // the Shadow
  const shadow = END ? null : await makeMan({ color: 0x14161a });
  if (shadow) { shadow.group.position.set(0.4, groundH(0.4, -16), -16); shadow.group.rotation.y = Math.PI; scene.add(shadow.group); }
  // player's own body: invisible, but casts a shadow in the light that comes from behind
  const body = await makeMan({ color: 0x000000 });
  body.root.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.colorWrite = false; o.material.depthWrite = false; } });
  scene.add(body.group);
  // light from behind (phase 3)
  const back = new THREE.SpotLight(0xffe6c4, 0, 80, 0.55, 0.6, 1.2);
  back.castShadow = true; back.shadow.mapSize.set(1024, 1024); back.shadow.bias = -0.0005;
  scene.add(back, back.target);
  const orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffe2b0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  orb.scale.set(6, 6, 1); scene.add(orb);

  // ---- ending props ----
  let bench, lamp, him, glass, stain, kids = [];
  if (END) {
    const BZ = -70;
    bench = await model('painted_wooden_bench');
    bench.rotation.y = Math.PI / 2 + 0.08; groundObj(bench, 1.8, BZ, groundH, 0.06);
    const bcs = contactShadow(2.4, 1.2, 0.5); bcs.rotation.z = 0.08; bcs.position.set(1.8, groundH(1.8, BZ) + 0.01, BZ); scene.add(bcs);
    applySnowToObject(bench, { amount: { value: 0.7 } });
    bench.traverse((o) => { if (o.isMesh) o.material.color.multiply(new THREE.Color(0.42, 0.5, 0.46)); }); // weathered, not fresh red
    scene.add(bench);
    lamp = await model('street_lamp_01');
    groundObj(lamp, 3.3, BZ - 1.6, groundH, 0.1);
    applySnowToObject(lamp, { amount: { value: 0.6 } });
    scene.add(lamp);
    const lampLight = new THREE.PointLight(0xffc98a, 4, 14, 2); lampLight.position.set(3.3, 3.6, BZ - 1.6); scene.add(lampLight);
    const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffd9a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
    lampGlow.scale.set(1.4, 1.4, 1); lampGlow.position.copy(lampLight.position); scene.add(lampGlow);
    him = await makeMan({ color: 0x1b1d22 });
    him.group.visible = false; scene.add(him.group);
    glass = wineGlass({ wine: 0.55 }); glass.visible = false; scene.add(glass);
    stain = stainDecal(1.8); stain.visible = false; scene.add(stain);
    // children playing far out on the open snow
    const coats = [0x6a2a2a, 0x2a3a5a, 0x7a6a2a, 0x3a4a3a];
    for (let i = 0; i < 4; i++) {
      const k = await makeMan({ color: coats[i], height: 1.15 });
      k.root.traverse((o) => { if (o.isMesh) o.material.roughness = 0.9; });
      k.play('run', 0); k.acts.run.timeScale = 0.9 + Math.random() * 0.3;
      k.c = new THREE.Vector3(11 + i * 3.2, 0, BZ - 5 - i * 2.2); k.ph = Math.random() * 6; k.r = 3 + Math.random() * 4; k.sp = 0.35 + Math.random() * 0.25;
      scene.add(k.group); kids.push(k);
    }
  }

  // ---- state ----
  const S = { storm: 0, dark: 0, backOn: 0, phase: 'walk', lookedBack: false, warp: 0 };
  const yaw0 = 0;

  function setStorm(k) { // 0 calm → 1 white-out
    S.storm = k;
    scene.fog.density = THREE.MathUtils.lerp(END ? 0.03 : 0.042, 0.11, k);
    snow.wind.set(2.4 + k * 4, -1.6 - k, 0.8 + k * 1.5);
    snow.uniforms.uStreak.value = 1.6 + k * 2;
    fog.uniforms.uOpacity.value = 0.38 + k * 0.4;
    E.audio?.amb('wind', 0.5 + k * 0.6, 1);
  }

  const obj = {
    scene,
    async enter() {
      player.pos.set(0, 0, 0); player.yaw = yaw0; player.pitch = -0.02;
      player.groundY = groundH;
      player.speed = 1.75; player.runSpeed = 3.2;
      player.bounds = (p) => { p.x = THREE.MathUtils.clamp(p.x, -6, 9); if (p.z > 3) p.z = 3; };
      player.onStep = (spd) => {
        if (S.dark > 0.6) E.audio?.step('stone', spd, { gain: 0.65, hall: 0.9, send: 0.2 });
        else E.audio?.step('snow', spd, { gain: 0.5 });
      };
      E.post.snapLook({
        exposure: END ? 1.0 : 0.95, bloom: 0.08, halation: 0.0,
        lift: [0.035, 0.032, 0.03], gamma: [1, 1, 1], gain: [1.0, 0.99, 0.97], sat: END ? 0.55 : 0.3, contrast: 1.0, tint: [1.02, 1.0, 0.97],
        vignette: 0.45, grain: 0.05, ca: 0.4, dof: 0.35, focus: 14, focusRange: 10,
      });
      E.post.fx.letterbox = 0;
      if (titleMode) { player.canMove = false; player.canLook = false; E.ui.crosshair(false); }
      else { E.ui.crosshair(true); }
      E.audio?.amb('wind', titleMode ? 0.5 : 0.55, 3);
      if (!titleMode) this.begin();
    },
    begin() {
      if (S.begun) return; S.begun = true;
      if (!END) setTimeout(() => prefetch({
        models: ['wooden_ladder', 'WoodenChair_01', 'ArmChair_01', 'ClassicNightstand_01', 'mantel_clock_01', 'fern_02', 'calathea_orbifolia_01', 'anthurium_botany_01', 'antique_ceramic_vase_01', 'wooden_bookshelf_worn', 'vintage_oil_lamp', 'pachira_aquatica_01', 'potted_plant_02', 'shrub_02'],
        hdris: ['sunny_rose_garden'],
        textures: ['dark_wooden_planks_diff', 'dark_wooden_planks_nor', 'dark_wooden_planks_arm', 'old_wood_floor_diff', 'old_wood_floor_nor', 'old_wood_floor_arm', 'leafy_grass_diff', 'leafy_grass_nor', 'leafy_grass_arm', 'rough_plaster_03_diff', 'rough_plaster_03_nor', 'rough_plaster_03_arm'],
      }), 4000);
      player.canMove = true; player.canLook = true; E.ui.crosshair(true);
      E.audio?.amb('wind', 0.55, 2);
      if (END) runEnd(); else runIntro();
    },
    update(dt, t) {
      WIND.uTime.value = t;
      snow.update(dt, E.camera); fog.update(dt, E.camera);
      trees.cull(E.camera.position.z, END ? 110 : 80);
      // keep sun/shadow frustum around the player
      sun.position.set(player.pos.x - 30, 40, player.pos.z + 20); sun.target.position.set(player.pos.x, 0, player.pos.z);
      // invisible body follows the player
      body.group.position.set(player.pos.x, player.pos.y, player.pos.z);
      body.group.rotation.y = player.yaw + Math.PI;
      const spd = player.currentSpeed || 0;
      if (spd > 0.3) { body.play('walk', 0.3); body.acts.walk.timeScale = spd / 1.4; } else body.play('idle', 0.4);
      body.update(dt);
      // the Shadow keeps his distance
      if (shadow && shadow.group.visible) {
        const gp = shadow.group.position;
        const dist = gp.z - player.pos.z; // negative: ahead
        const ahead = -dist;
        let sp = 0;
        if (S.phase === 'walk' || S.phase === 'storm') {
          const want = 14;
          sp = THREE.MathUtils.clamp(spd * 0.95 + (want - ahead) * -0.25, 0, 2.6);
          if (spd < 0.2 && ahead > 10) sp = Math.max(0, sp - 0.6);
        }
        S.shSpeed = THREE.MathUtils.lerp(S.shSpeed ?? 0, sp, 1 - Math.exp(-dt * 2));
        gp.z -= S.shSpeed * dt;
        gp.x += (Math.sin(gp.z * 0.05) * 0.6 - gp.x) * dt * 0.3;
        gp.y = groundH(gp.x, gp.z);
        if (S.shSpeed > 0.25) { shadow.play('walk', 0.5); shadow.acts.walk.timeScale = S.shSpeed / 1.35; }
        else shadow.play('idle', 0.6);
        shadow.update(dt);
      }
      // light from behind
      back.position.set(player.pos.x + 0.5, 3.2, player.pos.z + 9);
      back.target.position.set(player.pos.x, 0, player.pos.z - 10);
      back.intensity = S.backOn * 140;
      orb.position.set(player.pos.x, 2.2, player.pos.z + 26);
      orb.material.opacity = S.backOn * 0.9;
      // ending: children & him
      for (const k of kids) {
        k.ph += dt * k.sp;
        const x = k.c.x + Math.cos(k.ph) * k.r, z = k.c.z + Math.sin(k.ph * 1.3) * k.r * 0.6;
        const nx = k.c.x + Math.cos(k.ph + 0.05) * k.r, nz = k.c.z + Math.sin((k.ph + 0.05) * 1.3) * k.r * 0.6;
        k.group.position.set(x, groundH(x, z), z); k.group.rotation.y = Math.atan2(nx - x, nz - z);
        k.update(dt);
      }
      if (him?.group.visible) him.update(dt);
      if (stain) stain.material.uniforms.uTime.value = t;
      if (titleMode && !S.begun) { player.yaw = Math.sin(t * 0.07) * 0.05; player.pitch = -0.03 + Math.sin(t * 0.11) * 0.01; }
      // audio listener
      if (E.audio?.ready) { const f = new THREE.Vector3(); E.camera.getWorldDirection(f); E.audio.setListener(E.camera.position, f, E.camera.up); }
    },
    dispose() { scene.traverse((o) => { o.geometry?.dispose?.(); }); },
  };

  // ---------------- intro script ----------------
  async function runIntro() {
    player.yawLimit = { center: yaw0, range: 0.95 };
    E.audio?.playMusic('blizzard');
    wait(4).then(() => { if (player.moved < 1) E.ui.hint(T('p.walk')); });
    await until(() => player.moved > 7);
    E.ui.hint(null);
    await say('s0.him_where');
    await wait(0.6);
    await say('s0.shadow_dots', { dur: 2.2 });
    await until(() => player.moved > 30);
    await say('s0.him_from');
    await say('s0.shadow_dots2', { dur: 2.4 });
    await say('s0.shadow_dont', { dur: 2.8 });
    await say('s0.shadow_hold');
    await say('s0.shadow_follow');
    await say('s0.him_dots', { dur: 1.8 });
    const c = await choose(['s0.c_follow', 's0.c_stay', 's0.c_else']);
    E.flags.s0choice = c;
    if (c === 0) await say('s0.shadow_good', { dur: 2 });
    if (c === 1) { player.speedScale = 0.0; await wait(2.5); await say('s0.shadow_freeze'); await wait(1); player.speedScale = 1; }
    if (c === 2) await say('s0.shadow_nowhere');
    // the storm rises as they keep walking
    S.phase = 'storm';
    const m0 = player.moved;
    const t0 = E.time;
    let stormK = 0;
    await until(() => {
      const k = Math.min(Math.max((player.moved - m0) / 38, (E.time - t0) / 45), 1);
      stormK = k; setStorm(k);
      // the world dims as the white closes in
      const dk = THREE.MathUtils.smoothstep(k, 0.55, 1);
      hemi.intensity = 1.1 * (1 - dk * 0.97); sun.intensity = 0.45 * (1 - dk); scene.environmentIntensity = 0.55 * (1 - dk * 0.97);
      const fc = fogCol.clone().multiplyScalar(1 - dk * 0.96);
      scene.fog.color.copy(fc); scene.background.copy(fc); fog.uniforms.uColor.value.copy(new THREE.Color(0xe2e6ea).multiplyScalar(1 - dk * 0.9));
      snow.uniforms.uColor.value.setScalar(1.5 * (1 - dk * 0.7));
      if (shadow) { const op = 1 - THREE.MathUtils.smoothstep(k, 0.6, 0.95); shadow.group.visible = op > 0.02; }
      if (k > 0.75 && !S.saidCant) { S.saidCant = true; say('s0.him_cold'); }
      return k >= 1;
    });
    // darkness; a hall made of echoes; light from behind
    S.phase = 'dark';
    E.audio?.stopMusic(4);
    await tween(5, (k) => {
      S.dark = k;
      snow.density = 1 - k * 0.75; snow.wind.set(6.4 * (1 - k) + 0.2, -2.6 + k * 1.8, 2.3 * (1 - k));
      fog.uniforms.uOpacity.value = 0.78 * (1 - k);
      scene.fog.density = 0.11 - k * 0.07;
      S.backOn = k * 0.7;
      E.audio?.amb('wind', 1.1 * (1 - k) + 0.05, 0.5);
      E.audio?.setHall(k * 0.8, 0.5);
    });
    scene.fog.color.setRGB(0.012, 0.012, 0.014); scene.background.copy(scene.fog.color);
    E.post.setLook({ exposure: 1.15, sat: 0.6, tint: [1.04, 1.0, 0.96], dof: 0.2 }, 0.6);
    // the bell, behind
    let bells = 0;
    const ep = currentEpoch();
    const ring = async () => {
      while (!S.lookedBack && alive(ep)) {
        E.audio?.bell({ x: player.pos.x, y: 1.8, z: player.pos.z + 22 }, 0.55 + bells * 0.1);
        bells++;
        if (bells === 1) { player.yawLimit = null; }
        if (bells === 3) E.ui.hint(T('p.lookback'));
        await wait(8.5);
      }
    };
    await wait(2.5);
    ring();
    await until(() => {
      const d = Math.abs(Math.atan2(Math.sin(player.yaw - yaw0), Math.cos(player.yaw - yaw0)));
      return bells > 0 && d > 2.45;
    });
    S.lookedBack = true;
    E.ui.hint(null);
    await lookBack();
  }

  async function lookBack() {
    // time slows; the storm holds its breath; fleeting images; then the tape stops
    player.canMove = false;
    E.audio?.whoosh(4);
    const flashes = await makeFlashes();
    tween(3.5, (k) => { snow.timeScale = 1 - k * 0.97; fog.timeScale = 1 - k * 0.97; S.backOn = 0.7 + k * 0.8; E.post.fx.warp = k * 0.8; E.post.look.exposure = 1.15 + k * 1.2; });
    await wait(1.4);
    await flashes.play();
    E.audio?.tapeStop(1.6);
    E.post.fx.glitch = 0.6;
    await tween(1.6, (k) => { E.post.fx.collapse = k; E.post.fx.warp = 0.8 + k; });
    E.post.fx.glitch = 0;
    E.post.fx.fade = 1; E.post.fx.fadeColor.set(0x000000);
    E.flags.s0done = true;
    await wait(1.2);
    go('garden', { fadeOut: 0, fadeIn: 0, holdFade: true });
  }

  // fleeting memory flashes: textured cards that blink in the white void
  async function makeFlashes() {
    const cards = [];
    const mk = (draw) => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 320; const g = c.getContext('2d');
      draw(g); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0, depthTest: false, blending: THREE.AdditiveBlending, fog: false }));
      m.renderOrder = 50; m.frustumCulled = false; cards.push(m); scene.add(m); return m;
    };
    const vign = (g, a, b) => { const gr = g.createRadialGradient(256, 160, 10, 256, 160, 300); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, 512, 320); };
    mk((g) => { vign(g, '#d9542a', '#1a0603'); g.drawImage(mapleAtlas().image, 0, 0, 256, 256, 160, 40, 220, 220); });
    mk((g) => { vign(g, '#e8e2d6', '#141414'); g.strokeStyle = '#1a1a1a'; g.lineWidth = 7; g.beginPath(); g.arc(300, 210, 70, 0, 6.28); g.stroke(); g.beginPath(); g.moveTo(200, 230); g.lineTo(230, 110); g.lineTo(330, 120); g.lineTo(320, 210); g.stroke(); g.beginPath(); g.arc(205, 255, 22, 0, 6.28); g.stroke(); });
    mk((g) => { vign(g, '#3a0a10', '#050102'); g.fillStyle = '#8a0c1c'; for (const [x, y] of [[230, 170], [275, 182], [252, 140]]) { g.beginPath(); g.arc(x, y, 20, 0, 6.28); g.fill(); } g.strokeStyle = '#3c5a1a'; g.lineWidth = 3; g.beginPath(); g.moveTo(252, 120); g.quadraticCurveTo(280, 60, 300, 40); g.stroke(); });
    mk((g) => { vign(g, '#ffb860', '#120802'); g.fillStyle = '#fff2c0'; g.beginPath(); g.ellipse(256, 150, 14, 34, 0, 0, 6.28); g.fill(); g.fillStyle = '#d8c8a8'; g.fillRect(244, 182, 24, 120); });
    mk((g) => { vign(g, '#aac4e6', '#04070c'); g.fillStyle = '#05070a'; g.fillRect(252, 150, 10, 46); g.beginPath(); g.arc(257, 142, 8, 0, 6.28); g.fill(); });
    return {
      async play() {
        for (let i = 0; i < 9; i++) {
          const card = cards[i % cards.length];
          const f = new THREE.Vector3(); E.camera.getWorldDirection(f);
          card.position.copy(E.camera.position).addScaledVector(f, 1.6 + Math.random() * 0.4);
          card.position.x += (Math.random() - 0.5) * 0.5; card.position.y += (Math.random() - 0.5) * 0.3;
          card.quaternion.copy(E.camera.quaternion);
          card.material.opacity = 0.75;
          E.post.fx.glitch = 0.25;
          await wait(0.07 + Math.random() * 0.1);
          card.material.opacity = 0; E.post.fx.glitch = 0;
          await wait(0.12 + Math.random() * 0.25);
        }
      },
    };
  }

  // ---------------- ending script ----------------
  async function runEnd() {
    E.audio?.amb('wind', 0.3, 3);
    E.audio?.amb('kids', 0.0);
    E.audio?.playMusic('end');
    player.speed = 1.6;
    await wait(3);
    await say('s5.narr_1');
    await until(() => player.pos.z < -40);
    E.audio?.amb('kids', 0.9, 6);
    await say('s5.narr_2');
    const sit = addInteract({ pos: new THREE.Vector3(1.8, 0.8, -70), radius: 0.8, dist: 3.2, label: 'p.sit', hold: 0.8, onUse: () => sitDown() });
  }
  async function sitDown() {
    E.ui.crosshair(false); E.ui.setPrompt(null); E.blockInteract = true;
    await fadeOut(0.8);
    const BZ = -70;
    E.sceneObj.customCamera = true;
    player.canMove = false; player.canLook = false;
    him.group.visible = true;
    him.pose('sitSlump');
    // seat height of the scanned bench ≈ 0.45m; drop the hips onto it
    const seatY = groundH(1.8, BZ) + 0.42;
    him.group.position.set(1.62, seatY - 0.86, BZ);
    him.group.rotation.y = -Math.PI / 2 + 0.08;
    glass.visible = true; glass.position.set(1.05, groundH(1.05, BZ - 0.15), BZ - 0.15);
    stain.visible = true; stain.position.set(0.82, groundH(0.82, BZ - 0.2) + 0.01, BZ - 0.2); stain.rotation.y = 0.4;
    const cam = E.camera;
    const camA = new THREE.Vector3(-0.7, 0.62, BZ + 1.75), lookA = new THREE.Vector3(1.25, 0.42, BZ - 0.15);
    const camB = new THREE.Vector3(-9, 3.4, BZ + 11), lookB = new THREE.Vector3(3, 0.9, BZ - 2);
    cam.position.copy(camA); cam.lookAt(lookA);
    E.post.setLook({ dof: 0.6, focus: 2.3, focusRange: 0.9, sat: 0.6 }, 2);
    E.post.fx.letterbox = 1;
    await (async () => { const f0 = E.post.fx.fade; await tween(2.5, (k) => { E.post.fx.fade = f0 * (1 - k); }); })();
    await wait(2.5);
    // the glass tips over
    await tween(0.7, (k) => { glass.rotation.z = k * 1.45; glass.position.y = groundH(1.05, BZ - 0.15) + Math.sin(k * Math.PI) * 0.02; }, (x) => x * x);
    if (glass.userData.wine) glass.userData.wine.visible = false;
    E.audio?.step('snow', 0.5, { gain: 0.3 });
    tween(14, (k) => { stain.material.uniforms.uGrow.value = Math.pow(k, 0.5) * 0.95; }, (x) => x);
    await wait(3);
    // slow pull back
    const pull = tween(26, (k) => {
      cam.position.lerpVectors(camA, camB, k);
      const lk = new THREE.Vector3().lerpVectors(lookA, lookB, k);
      cam.lookAt(lk);
      E.post.look.focus = E.post.target.focus = THREE.MathUtils.lerp(2.3, 11, k);
    });
    await wait(7);
    // he stands, and walks away
    him.group.position.y = groundH(1.62, BZ);
    him.stopAll(); him.play('idle', 0.6);
    await wait(1.6);
    him.play('walk', 0.6); him.acts.walk.timeScale = 0.85;
    him.group.rotation.y = -Math.PI / 2 - 0.5;
    const walkAway = tween(16, (k) => {
      const x = 1.62 - k * 18, z = BZ - k * 9;
      him.group.position.set(x, groundH(x, z), z);
    }, (x) => x);
    await pull;
    await walkAway;
    him.group.visible = false;
    // the snow covers the stain
    E.audio?.amb('kids', 0.0, 18);
    await tween(16, (k) => { stain.material.uniforms.uCover.value = k; }, (x) => x);
    await wait(2);
    E.audio?.stopMusic(8);
    E.audio?.stopAllAmb(8);
    await fadeOut(6, 0xe9ebee);
    const closed = !(E.flags.r1 && E.flags.r2 && E.flags.r3);
    E.ui.showEnd(closed);
  }

  return obj;
}
