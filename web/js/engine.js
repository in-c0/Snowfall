// Core runtime: renderer, loop, input, first-person player, interactions, script helpers, scene manager.
import * as THREE from 'three';
import { Post } from './post.js';
import { T, setLang, getLang } from './text.js';

export const E = {
  THREE, renderer: null, post: null, camera: null, scene: null, sceneObj: null,
  time: 0, dt: 0, paused: true, started: false, frame: 0,
  settings: { lang: 'en', quality: 'high', sens: 1, bright: 1, music: 0.8, sfx: 0.9, master: 0.9, subSize: 1 },
  flags: {}, // story progression
  debug: new URLSearchParams(location.search).has('debug'),
  audio: null,
};

// ---------- settings persistence ----------
function loadSettings() {
  try { const s = JSON.parse(localStorage.getItem('snowfall.settings') || '{}'); Object.assign(E.settings, s); } catch (e) { /* storage unavailable */ }
  try { const f = JSON.parse(localStorage.getItem('snowfall.flags') || '{}'); E.savedFlags = f; } catch (e) { E.savedFlags = {}; }
}
export function saveSettings() { try { localStorage.setItem('snowfall.settings', JSON.stringify(E.settings)); } catch (e) { /* ignore */ } }
export function saveProgress(extra = {}) { try { localStorage.setItem('snowfall.flags', JSON.stringify({ ...E.flags, ...extra })); } catch (e) { /* ignore */ } }

// ---------- renderer ----------
export function initRenderer(canvas) {
  loadSettings();
  setLang(E.settings.lang);
  const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  r.outputColorSpace = THREE.LinearSRGBColorSpace; // post writes display-encoded values
  r.toneMapping = THREE.NoToneMapping;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.info.autoReset = true;
  E.renderer = r;
  E.post = new Post(r);
  E.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 900);
  E.listener = null;
  resize();
  addEventListener('resize', resize);
  return r;
}

const QUALITY = { low: { px: 0.6, samples: 0, shadow: 1024 }, medium: { px: 0.85, samples: 2, shadow: 2048 }, high: { px: 1.0, samples: 4, shadow: 2048 } };
export function qualityCfg() { return QUALITY[E.settings.quality] || QUALITY.high; }

export function resize() {
  const q = qualityCfg();
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  const w = innerWidth, h = innerHeight;
  E.renderer.setPixelRatio(1);
  E.renderer.setSize(w, h, false);
  E.renderer.domElement.style.width = w + 'px';
  E.renderer.domElement.style.height = h + 'px';
  const rw = Math.max(320, Math.round(w * dpr * q.px)), rh = Math.max(180, Math.round(h * dpr * q.px));
  E.renderer.setSize(rw, rh, false);
  E.post.setSize(rw, rh, q.samples);
  E.camera.aspect = w / h;
  E.camera.updateProjectionMatrix();
}

// ---------- input ----------
export const input = { keys: new Set(), dx: 0, dy: 0, locked: false, interactPressed: false, interactHeld: false, advance: false, touchMove: null, anyMoveKey: false };
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
export function initInput(canvas) {
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys.add(e.code);
    if (e.code === 'KeyE' || e.code === 'Enter') { input.interactPressed = true; input.interactHeld = true; }
    if (e.code === 'Space') { input.advance = true; input.interactPressed = true; input.interactHeld = true; }
    if (e.code === 'Escape' || e.code === 'KeyP') { if (E.started) togglePause(); }
    if (/Digit[1-3]/.test(e.code)) choiceKey(+e.code.slice(5) - 1);
  });
  addEventListener('keyup', (e) => {
    input.keys.delete(e.code);
    if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') input.interactHeld = false;
  });
  addEventListener('blur', () => { input.keys.clear(); input.interactHeld = false; });
  let downAt = null;
  canvas.addEventListener('mousedown', (e) => {
    if (!E.started || E.paused) return;
    if (!input.locked && !E.freeMouse && !matchMedia('(pointer: coarse)').matches) {
      try { const r = canvas.requestPointerLock?.(); r?.catch?.(() => { E.freeMouse = true; E.ui?.hint(T('ui.drag_to_look')); }); } catch (err) { E.freeMouse = true; }
    }
    if (e.button !== 0) return;
    if (E.freeMouse && !input.locked) { downAt = { x: e.clientX, y: e.clientY, moved: 0 }; input.interactHeld = true; return; }
    input.interactPressed = true; input.interactHeld = true; input.advance = true;
  });
  addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    input.interactHeld = false;
    // in drag-to-look mode a click without dragging is an interaction
    if (downAt && downAt.moved < 6) { input.interactPressed = true; input.advance = true; }
    downAt = null;
  });
  document.addEventListener('pointerlockerror', () => { E.freeMouse = true; E.ui?.hint(T('ui.drag_to_look')); });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked && E.started && !E.paused && !E.allowUnlock) togglePause(true);
  });
  addEventListener('mousemove', (e) => {
    if (input.locked) { input.dx += e.movementX; input.dy += e.movementY; }
    else if (E.freeMouse && E.started && !E.paused && (e.buttons & 1)) {
      input.dx += e.movementX; input.dy += e.movementY;
      if (downAt) { downAt.moved += Math.abs(e.movementX) + Math.abs(e.movementY); if (downAt.moved > 6) input.interactHeld = false; }
    }
  });
  // touch: left half = move stick, right half = look; quick tap = interact
  const touches = new Map();
  canvas.addEventListener('touchstart', (e) => {
    if (!E.started || E.paused) return;
    for (const t of e.changedTouches) touches.set(t.identifier, { x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, left: t.clientX < innerWidth * 0.45, t0: performance.now() });
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      const s = touches.get(t.identifier); if (!s) continue;
      if (s.left) input.touchMove = { x: (t.clientX - s.sx) / 60, y: (t.clientY - s.sy) / 60 };
      else { input.dx += (t.clientX - s.x) * 1.6; input.dy += (t.clientY - s.y) * 1.6; }
      s.x = t.clientX; s.y = t.clientY;
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      const s = touches.get(t.identifier); if (!s) continue;
      if (s.left) input.touchMove = null;
      if (performance.now() - s.t0 < 250 && Math.hypot(t.clientX - s.sx, t.clientY - s.sy) < 12) { input.interactPressed = true; input.advance = true; input.tapHold = 0.3; }
      touches.delete(t.identifier);
    }
  });
}
export function moveAxis() {
  const k = input.keys;
  let x = 0, y = 0;
  if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
  if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
  if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
  if (input.touchMove) { x += THREE.MathUtils.clamp(input.touchMove.x, -1, 1); y -= THREE.MathUtils.clamp(input.touchMove.y, -1, 1); }
  const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
  input.anyMoveKey = l > 0.05;
  return { x, y, run: k.has('ShiftLeft') || k.has('ShiftRight') };
}

// ---------- first-person player ----------
export class Player {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.eye = 1.62; this.eyeTarget = 1.62;
    this.speed = 2.0; this.runSpeed = 3.8;
    this.canMove = true; this.canLook = true;
    this.yawLimit = null; // {center, range}
    this.pitchMin = -1.3; this.pitchMax = 1.3;
    this.bob = 0; this.bobAmp = 1; this.stepPhase = 0; this.onStep = null;
    this.colliders = []; // {minX,maxX,minZ,maxZ}
    this.bounds = null; // fn(pos) => clamps in place
    this.radius = 0.3;
    this.roll = 0; this.extraPitch = 0; this.extraYaw = 0; this.shake = 0;
    this.moved = 0; // distance walked (for scripted triggers)
    this.groundY = () => 0;
    this.lookSmooth = new THREE.Vector2();
  }
  update(dt) {
    const s = E.settings.sens * 0.0022;
    if (this.canLook) {
      this.lookSmooth.x += (input.dx - this.lookSmooth.x) * 0.6;
      this.lookSmooth.y += (input.dy - this.lookSmooth.y) * 0.6;
      this.yaw -= input.dx * s; this.pitch -= input.dy * s;
    }
    input.dx = 0; input.dy = 0;
    if (this.yawLimit) {
      const c = this.yawLimit.center, r = this.yawLimit.range;
      let d = Math.atan2(Math.sin(this.yaw - c), Math.cos(this.yaw - c));
      // soft limit: resist near the edge
      if (Math.abs(d) > r) d = Math.sign(d) * (r + (Math.abs(d) - r) * 0.15);
      d = THREE.MathUtils.clamp(d, -r * 1.12, r * 1.12);
      this.yaw = c + d;
    }
    this.pitch = THREE.MathUtils.clamp(this.pitch, this.pitchMin, this.pitchMax);
    const m = this.canMove ? moveAxis() : { x: 0, y: 0, run: false };
    const sp = (m.run ? this.runSpeed : this.speed) * (this.speedScale ?? 1);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const tx = (fx * m.y + rx * m.x) * sp, tz = (fz * m.y + rz * m.x) * sp;
    const acc = 1 - Math.exp(-dt * 7);
    this.vel.x += (tx - this.vel.x) * acc; this.vel.z += (tz - this.vel.z) * acc;
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.collide(ox, oz);
    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
    this.moved += moved;
    const spd = moved / Math.max(dt, 1e-4);
    this.currentSpeed = spd;
    // head bob + footsteps
    const prev = this.stepPhase;
    this.stepPhase += moved * 1.15;
    if (Math.floor(prev / Math.PI) !== Math.floor(this.stepPhase / Math.PI) && spd > 0.3) this.onStep?.(spd);
    const bobT = Math.min(spd / 3, 1) * this.bobAmp;
    this.eye += (this.eyeTarget - this.eye) * (1 - Math.exp(-dt * 3));
    this.pos.y = this.groundY(this.pos.x, this.pos.z);
  }
  collide(ox, oz) {
    const p = this.pos, r = this.radius;
    for (const c of this.colliders) {
      if (p.x > c.minX - r && p.x < c.maxX + r && p.z > c.minZ - r && p.z < c.maxZ + r) {
        // resolve along the smallest penetration axis
        const dxl = p.x - (c.minX - r), dxr = (c.maxX + r) - p.x, dzl = p.z - (c.minZ - r), dzr = (c.maxZ + r) - p.z;
        const m = Math.min(dxl, dxr, dzl, dzr);
        if (m === dxl) p.x = c.minX - r; else if (m === dxr) p.x = c.maxX + r; else if (m === dzl) p.z = c.minZ - r; else p.z = c.maxZ + r;
      }
    }
    this.bounds?.(p);
  }
  apply(cam, t) {
    const bob = Math.sin(this.stepPhase) * 0.035 * Math.min((this.currentSpeed || 0) / 2.5, 1) * this.bobAmp;
    const sway = Math.cos(this.stepPhase * 0.5) * 0.02 * Math.min((this.currentSpeed || 0) / 2.5, 1) * this.bobAmp;
    const sh = this.shake;
    cam.position.set(this.pos.x + sway * Math.cos(this.yaw), this.pos.y + this.eye + bob, this.pos.z - sway * Math.sin(this.yaw));
    // subtle breathing idle
    const br = Math.sin(t * 0.9) * 0.004;
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.pitch + this.extraPitch + br + (Math.random() - 0.5) * sh, this.yaw + this.extraYaw + (Math.random() - 0.5) * sh, this.roll + sway * 0.3);
  }
  forward(v = new THREE.Vector3()) { return v.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }
}
export const player = new Player();

// ---------- interactables ----------
export const interact = { list: [], focus: null, holdT: 0 };
// item: { pos:Vector3 | obj, radius, dist, label:key, hold:seconds|0, enabled, onUse, seen }
export function addInteract(item) { item.enabled ??= true; item.dist ??= 2.6; item.angle ??= 0.22; interact.list.push(item); return item; }
export function clearInteract() { interact.list.length = 0; interact.focus = null; }
const _v = new THREE.Vector3(), _f = new THREE.Vector3();
function updateInteract(dt) {
  let best = null, bestScore = 1e9;
  if (player.canLook && !E.ui.choiceOpen && !E.blockInteract) {
    E.camera.getWorldDirection(_f);
    for (const it of interact.list) {
      if (!it.enabled) continue;
      const p = it.obj ? it.obj.getWorldPosition(_v) : _v.copy(it.pos);
      const d = _v.sub(E.camera.position);
      const dist = d.length();
      if (dist > it.dist) continue;
      const ang = Math.acos(THREE.MathUtils.clamp(d.normalize().dot(_f), -1, 1));
      const lim = it.angle + Math.atan2(it.radius ?? 0.3, dist);
      if (ang > lim) continue;
      const sc = ang + dist * 0.05;
      if (sc < bestScore) { bestScore = sc; best = it; }
    }
  }
  if (best !== interact.focus) { interact.focus = best; interact.holdT = 0; E.ui.setPrompt(best ? T(best.label) : null, best?.hold ? 0 : -1, best?.seen); }
  if (best) {
    if (best.hold) {
      if (input.interactHeld || input.tapHold > 0) {
        interact.holdT += dt;
        E.ui.setPrompt(T(best.label), Math.min(interact.holdT / best.hold, 1), best.seen);
        E.audio?.holdTone?.(Math.min(interact.holdT / best.hold, 1));
        if (interact.holdT >= best.hold) { const it = best; interact.focus = null; interact.holdT = 0; E.ui.setPrompt(null); it.enabled = !!it.repeat; E.audio?.holdTone?.(0); it.onUse(it); }
      } else if (interact.holdT > 0) { interact.holdT = Math.max(0, interact.holdT - dt * 2); E.ui.setPrompt(T(best.label), interact.holdT / best.hold, best.seen); E.audio?.holdTone?.(0); }
    } else if (input.interactPressed) {
      const it = best; interact.focus = null; E.ui.setPrompt(null); it.enabled = !!it.repeat; it.onUse(it);
    }
  }
  if (input.tapHold > 0) input.tapHold -= dt;
}

// ---------- coroutine helpers (game-time) ----------
const timers = []; const conds = [];
let epoch = 0; // bumps on scene change; stale scripts stop resolving
export function wait(s) { const ep = epoch; return new Promise(r => timers.push({ t: s, r, ep })); }
export function until(fn) { const ep = epoch; return new Promise(r => conds.push({ fn, r, ep })); }
export function frame() { return wait(0); }
export async function tween(dur, fn, ease = (x) => x * x * (3 - 2 * x)) {
  if (dur <= 0) { fn(1); return; }
  let t = 0; fn(0);
  while (t < dur) { await frame(); t += E.dt; fn(ease(Math.min(t / dur, 1))); }
}
function updateCoroutines(dt) {
  for (let i = timers.length - 1; i >= 0; i--) {
    const tm = timers[i];
    if (tm.ep !== epoch) { timers.splice(i, 1); continue; }
    tm.t -= dt; if (tm.t <= 0) { timers.splice(i, 1); tm.r(); }
  }
  for (let i = conds.length - 1; i >= 0; i--) {
    const c = conds[i];
    if (c.ep !== epoch) { conds.splice(i, 1); continue; }
    let ok = false; try { ok = c.fn(); } catch (e) { console.error(e); }
    if (ok) { conds.splice(i, 1); c.r(); }
  }
}
export function alive(ep) { return ep === epoch; }
export function currentEpoch() { return epoch; }

// say: show a subtitle line. who: 'him'|'her'|'shadow'|'narr'. Duration from reading speed; click/space skips ahead.
export async function say(key, opts = {}) {
  const text = typeof key === 'string' ? T(key) : key.text;
  const who = opts.who || (typeof key === 'string' ? whoOf(key) : 'narr');
  const ep = epoch;
  E.ui.showLine(text, who);
  E.audio?.lineCue?.(who, text);
  const words = text.replace(/[.…\s]+/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  const base = opts.dur ?? Math.max(2.2, 1.3 + words * 0.32 + (getLang() === 'ko' ? text.length * 0.03 : 0));
  input.advance = false;
  let t = 0;
  while (t < base) {
    await frame();
    if (ep !== epoch) return;
    t += E.dt;
    if (input.advance && t > 0.5 && !opts.noSkip) break;
  }
  input.advance = false;
  if (!opts.keep) E.ui.hideLine();
  await wait(opts.gap ?? 0.45);
}
function whoOf(key) { return key.split('.')[1]?.split('_')[0] || 'narr'; }

export async function choose(keys) {
  const ep = epoch;
  return new Promise((resolve) => {
    E.ui.showChoices(keys.map(k => T(k)), (i) => { if (ep === epoch) resolve(i); });
  });
}
function choiceKey(i) { E.ui.pickChoice?.(i); }

// ---------- scene manager ----------
export const scenes = {};
export function registerScene(id, factory) { scenes[id] = factory; }

let transitioning = false;
export async function go(id, opts = {}) {
  if (transitioning && !opts.force) return;
  transitioning = true;
  const fadeTime = opts.fadeOut ?? 1.2;
  const color = opts.color ?? 0x000000;
  if (E.sceneObj && fadeTime > 0) {
    E.post.fx.fadeColor.set(color);
    const f0 = E.post.fx.fade;
    await tweenReal(fadeTime, (k) => { E.post.fx.fade = f0 + (1 - f0) * k; });
  }
  E.post.fx.fade = 1; E.post.fx.fadeColor.set(color);
  epoch++;
  timers.length = 0; conds.length = 0;
  clearInteract();
  E.ui.setPrompt(null); E.ui.hideLine(); E.ui.hideChoices(); E.ui.hint(null);
  const prev = E.sceneObj;
  if (prev) { try { prev.exit?.(); } catch (e) { console.error(e); } }
  // scenes sometimes parent props to the camera; detach so the new scene's camera matrices update
  if (E.camera.parent) E.camera.parent.remove(E.camera);
  for (const c of [...E.camera.children]) E.camera.remove(c);
  E.sceneObj = null; E.post.fx.warp = 0;
  E.audio?.sceneChange?.();
  E.ui.loading(true);
  const factory = scenes[id];
  const obj = await factory(opts);
  if (prev && prev !== obj) { try { prev.dispose?.(); } catch (e) { console.error(e); } }
  E.ui.loading(false);
  E.sceneObj = obj; E.scene = obj.scene; E.sceneId = id;
  player.yawLimit = null; player.canMove = true; player.canLook = true; player.colliders = []; player.bounds = null; player.onStep = null; player.speedScale = 1; player.shake = 0; player.roll = 0; player.extraPitch = 0; player.extraYaw = 0; player.eyeTarget = player.eye = 1.62; player.bobAmp = 1; player.moved = 0; player.groundY = () => 0;
  E.post.fx.warp = 0; E.post.fx.collapse = 0; E.post.fx.glitch = 0; E.post.fx.desat = 0;
  E.ui.chapter?.(id);
  transitioning = false;
  obj.enter?.(opts);
  // compile before reveal to avoid hitches
  try { E.renderer.compile(obj.scene, E.camera); } catch (e) { /* ignore */ }
  const fin = opts.fadeIn ?? 1.6;
  if (!opts.holdFade) await fadeIn(fin);
}
export async function fadeIn(t = 1.5) { const f0 = E.post.fx.fade; await tween(t, (k) => { E.post.fx.fade = f0 * (1 - k); }); }
export async function fadeOut(t = 1.5, color = 0x000000) { E.post.fx.fadeColor.set(color); const f0 = E.post.fx.fade; await tween(t, (k) => { E.post.fx.fade = f0 + (1 - f0) * k; }); }
// real-time tween (works during scene switch)
function tweenReal(dur, fn) {
  return new Promise((res) => {
    const t0 = performance.now();
    const step = () => { const k = Math.min((performance.now() - t0) / 1000 / dur, 1); fn(k * k * (3 - 2 * k)); if (k < 1) requestAnimationFrame(step); else res(); };
    step();
  });
}

// ---------- pause ----------
export function togglePause(force) {
  const p = force ?? !E.paused;
  E.paused = p;
  E.ui.pause(p);
  E.audio?.pause?.(p);
  if (p) { document.exitPointerLock?.(); input.keys.clear(); }
}

// ---------- main loop ----------
let last = performance.now();
const fpsWin = [];
export function start() {
  const loop = (now) => {
    requestAnimationFrame(loop);
    let dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (E.manual) return;
    stepFrame(dt);
    // adaptive resolution: if consistently slow on high, step down once
    fpsWin.push(dt); if (fpsWin.length > 120) fpsWin.shift();
    if (E.started && !E.paused && fpsWin.length === 120 && !E.autoDowngraded && E.frame > 400) {
      const avg = fpsWin.reduce((a, b) => a + b) / fpsWin.length;
      if (avg > 1 / 26 && E.settings.quality !== 'low') {
        E.autoDowngraded = true;
        E.settings.quality = E.settings.quality === 'high' ? 'medium' : 'low';
        resize(); E.ui.toast?.(T('ui.quality_auto'));
      }
    }
  };
  requestAnimationFrame(loop);
}
export function stepFrame(dt, render = true) {
  if (!E.scene) return;
  const playing = !E.paused || !E.started;
  if (playing) {
    E.dt = dt * (E.timeScale ?? 1);
    E.time += E.dt;
    E.frame++;
    if (E.started) {
      updateCoroutines(E.dt);
      if (!E.sceneObj?.customPlayer) player.update(E.dt);
      updateInteract(E.dt);
    }
    E.sceneObj?.update?.(E.dt, E.time);
    if (!E.sceneObj?.customCamera) player.apply(E.camera, E.time);
    E.sceneObj?.lateUpdate?.(E.dt, E.time);
    E.audio?.update?.(E.dt);
  }
  input.interactPressed = false;
  if (render) E.post.render(E.scene, E.camera, E.time, playing ? E.dt : 0);
  else E.post.updateLook(playing ? E.dt : 0);
}
// manual stepping for automated captures: advance game time without drawing, then draw once
export async function sim(sec, dt = 1 / 30) {
  const n = Math.round(sec / dt);
  for (let i = 0; i < n; i++) { stepFrame(dt, false); await Promise.resolve(); await Promise.resolve(); if (i % 15 === 14) await new Promise((r) => setTimeout(r, 0)); }
}
export function renderOnce() { E.post.render(E.scene, E.camera, E.time, 0); }

export { T };
