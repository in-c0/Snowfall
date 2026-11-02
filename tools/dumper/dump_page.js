// In-page scene dumper (injected as a module into the running Snowfall page).
// Traverses SF.E.scene and writes the scene-transfer format described in SourceArt/SCENE_FORMAT.md.
// Files are handed to the Python driver through window.sfSave(relPath, base64, append).
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const SF = window.SF;
const log = (...a) => console.log('[dump]', ...a);

// ------------------------------------------------------------------ io
function b64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
async function save(path, data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
  const CHUNK = 6 * 1024 * 1024;
  if (u8.length === 0) { await window.sfSave(path, '', false); return; }
  for (let o = 0; o < u8.length; o += CHUNK) await window.sfSave(path, b64(u8.subarray(o, o + CHUNK)), o > 0);
}
async function saveText(path, text) { await save(path, new TextEncoder().encode(text)); }
const lin = (c) => [+c.r.toFixed(5), +c.g.toFixed(5), +c.b.toFixed(5)];
const v3 = (v) => [+v.x.toFixed(5), +v.y.toFixed(5), +v.z.toFixed(5)];
const r5 = (x) => +(+x).toFixed(5);

// ------------------------------------------------------------------ geometry hashing / export
const geoHashCache = new Map();
function fnv(h, u32) { for (let i = 0; i < u32.length; i++) { h ^= u32[i]; h = Math.imul(h, 16777619) >>> 0; } return h; }
function attrArray(a) {
  if (!a) return null;
  if (a.isInterleavedBufferAttribute) { const out = new Float32Array(a.count * a.itemSize); for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent ? a.getComponent(i, k) : [a.getX, a.getY, a.getZ, a.getW][k].call(a, i); return out; }
  return a.array;
}
function geoHash(g) {
  if (geoHashCache.has(g.uuid)) return geoHashCache.get(g.uuid);
  let h = 2166136261;
  for (const k of ['position', 'normal', 'uv', 'color']) {
    const a = attrArray(g.attributes[k]);
    if (!a) { h = fnv(h, new Uint32Array([k.length])); continue; }
    const f = a instanceof Float32Array ? a : Float32Array.from(a);
    h = fnv(h, new Uint32Array(f.buffer, f.byteOffset, f.length));
  }
  if (g.index) h = fnv(h, Uint32Array.from(g.index.array));
  const dr = g.drawRange; h = fnv(h, new Uint32Array([dr.start, Math.min(dr.count, 0x7fffffff)]));
  const key = 'g' + h.toString(16).padStart(8, '0') + '_' + g.attributes.position.count;
  geoHashCache.set(g.uuid, key);
  return key;
}
function cleanGeometry(g, flipV = true) {
  const out = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'uv', 'uv1', 'color']) {
    const a = g.attributes[k];
    if (!a || a.isInstancedBufferAttribute) continue;
    const arr = attrArray(a);
    const f = arr instanceof Float32Array ? new Float32Array(arr) : Float32Array.from(arr);
    // normalized integer attributes (meshopt) are de-quantised by getComponent above only for interleaved; handle plain normalized arrays
    if (a.normalized && !(arr instanceof Float32Array)) { const s = arr instanceof Int8Array ? 127 : arr instanceof Uint8Array ? 255 : arr instanceof Int16Array ? 32767 : arr instanceof Uint16Array ? 65535 : 1; for (let i = 0; i < f.length; i++) f[i] = Math.max(f[i] / s, -1); }
    // three samples flipY textures with v=0 at the image bottom; glTF has v=0 at the top -> store v' = 1 - v
    if (flipV && (k === 'uv' || k === 'uv1')) for (let i = 1; i < f.length; i += 2) f[i] = 1 - f[i];
    out.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
  }
  if (g.index) out.setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array), 1));
  // honour a finite draw range (only drawn part is visible)
  const dr = g.drawRange;
  if (dr.count !== Infinity && (dr.start > 0 || dr.count < (g.index ? g.index.count : g.attributes.position.count))) {
    if (out.index) out.setIndex(new THREE.BufferAttribute(out.index.array.slice(dr.start, dr.start + dr.count), 1));
    else { for (const k in out.attributes) { const a = out.attributes[k]; out.setAttribute(k, new THREE.BufferAttribute(a.array.slice(dr.start * a.itemSize, (dr.start + dr.count) * a.itemSize), a.itemSize)); } }
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
}
const exporter = new GLTFExporter();
function stripMaterials(ab) {
  const dv = new DataView(ab);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 20, jsonLen)));
  delete json.materials;
  for (const m of json.meshes || []) for (const p of m.primitives) delete p.material;
  for (const n of json.nodes || []) { delete n.name; }
  let js = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (js.length % 4)) % 4;
  const jsP = new Uint8Array(js.length + pad); jsP.set(js); jsP.fill(0x20, js.length);
  const rest = new Uint8Array(ab, 20 + jsonLen);
  const total = 12 + 8 + jsP.length + rest.length;
  const out = new Uint8Array(total); const o = new DataView(out.buffer);
  o.setUint32(0, 0x46546C67, true); o.setUint32(4, 2, true); o.setUint32(8, total, true);
  o.setUint32(12, jsP.length, true); o.setUint32(16, 0x4E4F534A, true);
  out.set(jsP, 20); out.set(rest, 20 + jsP.length);
  return out;
}
async function exportGLB(geo) {
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  const ab = await exporter.parseAsync(mesh, { binary: true });
  return stripMaterials(ab);
}
function triCount(g) { const dr = g.drawRange; const n = g.index ? g.index.count : g.attributes.position.count; return Math.floor(Math.min(n, dr.count) / 3); }

// ------------------------------------------------------------------ shader introspection
// Run a material's onBeforeCompile on a fake standard shader to see the uniforms it injects
// (snowCover: uSnowAmt/uSnowDir, leafCards: uGrid/uTrans, grass: uCA/uCB, snowMaterial: uSparkle/uRelief, WIND: uTime/uWind).
function patchInfo(mat) {
  if (!mat.onBeforeCompile || mat.onBeforeCompile === THREE.Material.prototype.onBeforeCompile) return null;
  const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, defines: {} };
  try { mat.onBeforeCompile(sh, SF.E.renderer); } catch (e) { return { error: String(e) }; }
  return { U: sh.uniforms, vs: sh.vertexShader, fs: sh.fragmentShader };
}

// ------------------------------------------------------------------ textures
let texNames = null;           // canvas -> name
const texOut = new Map();      // canvas -> {name, file}
const usedNames = new Set();
async function initTexNames() {
  texNames = new Map();
  const tx = await import('/js/fx/textures.js');
  const known = [['leafAtlas', () => tx.leafAtlas()], ['mapleAtlas', () => tx.mapleAtlas()], ['daisy', () => tx.daisyTex()], ['twig0', () => tx.twigTex(0)], ['twig1', () => tx.twigTex(1)], ['twig2', () => tx.twigTex(2)],
    ['spineWarm', () => tx.spineTex(true)], ['spineCool', () => tx.spineTex(false)], ['rug', () => tx.rugTex()], ['meadow', () => tx.meadowTex()], ['bigLeaf0', () => tx.bigLeafTex(0)], ['bigLeaf1', () => tx.bigLeafTex(1)],
    ['seed', () => tx.seedTex()], ['glow', () => tx.glowTex()], ['noise', () => tx.noiseTex()]];
  for (const [n, f] of known) { try { const t = f(); texNames.set(t.source.data, n); } catch (e) { log('tex init fail', n, e); } }
}
function imageCanvas(tex) { // ImageBitmap / HTMLImageElement -> canvas (cached)
  const d = tex?.source?.data; if (!d || canvasOf(tex)) return null;
  if (!(d instanceof ImageBitmap || d instanceof HTMLImageElement)) return null;
  if (d.__cv) return d.__cv;
  const c = document.createElement('canvas'); c.width = d.width; c.height = d.height; c.getContext('2d').drawImage(d, 0, 0);
  d.__cv = c; return c;
}
function canvasOf(tex) { const d = tex?.source?.data; return (d && (d instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== 'undefined' && d instanceof OffscreenCanvas))) ? d : null; }
function texFile(tex, hint) {
  const c = canvasOf(tex) || imageCanvas(tex); if (!c) return null;
  if (texOut.has(c)) return texOut.get(c).file;
  let name = texNames.get(c) || hint || 'canvas';
  // identical generated images share one file
  const url = c.toDataURL('image/png');
  for (const [, v] of texOut) if (v.url === url) { texOut.set(c, v); return v.file; }
  let n = name, i = 2; while (usedNames.has(n)) n = name + '_' + i++;
  usedNames.add(n);
  const rec = { name: n, file: 'tex/' + n + '.png', url };
  texOut.set(c, rec);
  return rec.file;
}

// ------------------------------------------------------------------ materials
const matSigToId = new Map(); const materials = {};
function canvasHint(mat, mesh) {
  if (mat.vertexColors && mat.transparent) return 'wheelTracks';
  if (!mat.isMeshBasicMaterial && mat.alphaTest && mat.polygonOffset) return 'roadDash';
  if (mat.isMeshBasicMaterial && mat.polygonOffset && mat.transparent) return 'contactShadow';
  if (mat.metalness === 0.3 && mat.emissiveIntensity === 0.15) return 'butterflyWing';
  return (SF.__level || 'lvl') + '_canvas';
}
function describeMaterial(mat, mesh) {
  const d = { kind: 'basic', name: mat.name || '', three: mat.type };
  const P = patchInfo(mat);
  const U = P?.U || {};
  const mapCanvas = canvasOf(mat.map);
  const mapImg = mat.map?.source?.data;
  const pbrMatch = !mapCanvas && mapImg?.src ? /assets\/tex\/(.+)_diff\.webp/.exec(mapImg.src) : null;
  if (mat.color) d.color = lin(mat.color);
  if (mat.roughness !== undefined) d.roughness = r5(mat.roughness);
  if (mat.metalness !== undefined) d.metalness = r5(mat.metalness);
  if (mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0 && mat.emissiveIntensity > 0) { d.emissive = lin(mat.emissive); d.emissiveIntensity = r5(mat.emissiveIntensity); }
  if (mat.alphaTest) d.alphaTest = r5(mat.alphaTest);
  d.doubleSided = mat.side === THREE.DoubleSide;
  if (mat.side === THREE.BackSide) d.backSide = true;
  d.transparent = !!mat.transparent; d.opacity = r5(mat.opacity);
  if (mat.envMapIntensity !== undefined && mat.envMapIntensity !== 1) d.envMapIntensity = r5(mat.envMapIntensity);
  if (mat.normalScale && mat.normalMap) d.normalScale = r5(mat.normalScale.x);
  if (mat.isMeshPhysicalMaterial) {
    if (mat.clearcoat) { d.clearcoat = r5(mat.clearcoat); d.clearcoatRoughness = r5(mat.clearcoatRoughness); }
    if (mat.sheen) { d.sheen = r5(mat.sheen); d.sheenColor = lin(mat.sheenColor); d.sheenRoughness = r5(mat.sheenRoughness); }
    if (mat.transmission) d.transmission = r5(mat.transmission);
  }
  if (mat.blending === THREE.AdditiveBlending) d.additive = true;
  if (mat.depthWrite === false) d.depthWrite = false;
  if (mat.isMeshBasicMaterial) d.unlit = true;
  if (mat.vertexColors) d.vertexColors = true;
  // classification
  if (U.uGrid) {
    d.kind = 'leafcards'; d.grid = U.uGrid.value; d.translucency = r5(U.uTrans?.value ?? 0);
    const sw = mesh?.geometry?.attributes?.aSway; let m = 1;
    if (sw) { let s = 0; const n = Math.max(1, mesh.count); for (let i = 0; i < n; i++) s += sw.array[i]; m = s / n; }
    d.wind = Math.round(m * 10) / 10;
  } else if (U.uCA) {
    d.kind = 'grass'; d.colorA = lin(U.uCA.value); d.colorB = lin(U.uCB.value); d.wind = 1;
  } else if (U.uSparkle) {
    d.kind = 'snowground'; d.sparkle = r5(U.uSparkle.value); d.relief = r5(U.uRelief.value);
  } else if (mapCanvas && texNames.get(mapCanvas) === 'daisy') {
    d.kind = 'daisy'; d.wind = 1;
  } else if (mat.isShaderMaterial) {
    d.kind = 'emissive'; d.unlit = true; d.shader = 'custom';
    const uc = mat.uniforms?.uColor?.value; d.color = uc?.isColor ? lin(uc) : [0.03, 0.035, 0.05]; d.emissive = d.color; d.emissiveIntensity = 1;
    if (mat.uniforms?.uOn) { d.shader = 'windowFrost'; d.on = mat.uniforms.uOn.value; d.color = [0.05, 0.13, 0.22]; d.emissive = [0.3, 0.42, 0.55]; d.emissiveIntensity = r5(0.25 + mat.uniforms.uOn.value * 2.2); }
  } else if (pbrMatch) {
    d.kind = 'pbr'; d.polyhaven = pbrMatch[1]; d.tiling = [r5(mat.map.repeat.x), r5(mat.map.repeat.y)];
    if (mat.map.offset.x || mat.map.offset.y) d.offset = [r5(mat.map.offset.x), r5(mat.map.offset.y)];
  } else if (mat.isMeshBasicMaterial && !mat.map) {
    d.kind = 'emissive'; d.emissive = d.color; d.emissiveIntensity = 1;
  } else if (mat.transparent && mat.opacity < 0.95 && (mat.isMeshPhysicalMaterial || mat.isMeshStandardMaterial) && !mat.map) {
    d.kind = 'glass';
  }
  if (!mapCanvas && !pbrMatch && mat.map && imageCanvas(mat.map)) { d.map = texFile(mat.map, (mesh?.userData.__srcModel || 'scan') + '_diff'); if (mesh?.userData.__srcModel) d.sourceModel = mesh.userData.__srcModel; }
  if (mapCanvas) { d.map = texFile(mat.map, canvasHint(mat, mesh)); const rp = mat.map.repeat; if (rp.x !== 1 || rp.y !== 1) d.tiling = [r5(rp.x), r5(rp.y)]; }
  if (U.uSnowAmt) { d.snow = r5(U.uSnowAmt.value); if (U.uSnowDir) d.snowDir = v3(U.uSnowDir.value); }
  if (d.wind === undefined) d.wind = (U.uTime && U.uWind) ? 1 : 0;
  if (P && /smoothstep\(0\.0, 0\.35, vMapUv\.x\)/.test(P.fs || '')) d.featherEdges = true; // park path ribbon
  if (P && /vTU/.test(P.fs || '')) d.trackEdges = true;
  if (P && /rp_f\(vSW\.xz/.test(P.fs || '')) { d.kind = 'snowground'; d.sparkle = 0; d.relief = 1; d.periodicZ = 70; d.note = 'road loop snow: procedural noise periodic in z every 70 m'; }
  if (P && /rSnow/.test(P.fs || '')) { d.snowEdges = true; d.note = 'asphalt: snow creeps in from the ribbon edges (uv.x 0/1), worn tyre lanes'; }
  return d;
}
function materialId(mat, mesh) {
  const d = describeMaterial(mat, mesh);
  const sig = JSON.stringify(d);
  if (matSigToId.has(sig)) return matSigToId.get(sig);
  const id = 'mat' + matSigToId.size;
  matSigToId.set(sig, id); materials[id] = d;
  return id;
}

// ------------------------------------------------------------------ exclusions
function excludeReason(o) {
  if (o.isSkinnedMesh) return 'character';
  const m = o.material;
  if (o.isSprite) return 'sprite';
  if (o.isPoints) return 'points';
  if (!m || Array.isArray(m) && !m.length) return 'nomat';
  if (m.isShaderMaterial) {
    const u = m.uniforms || {};
    if (u.uBox && o.geometry.attributes.aSeed) return u.uDrift ? 'fogcards' : 'snow';
    if (u.uDissolve) return 'her';
    if (u.uGrow) return 'stain';
    if (m.side === THREE.BackSide) { o.geometry.computeBoundingSphere(); if (o.geometry.boundingSphere.radius >= 150) return 'sky'; }
  }
  if (m.isMeshBasicMaterial && m.depthTest === false && o.renderOrder >= 50) return 'flashcard';
  if (m.colorWrite === false) return 'invisible';
  return null;
}

// ------------------------------------------------------------------ main
export async function run(level, cfg) {
  const E = SF.E, scene = E.scene;
  SF.__level = level;
  await initTexNames();
  const LC = LEVELS[level];
  // model geometry lookup
  const assets = await import('/js/assets.js');
  const geoToModel = new Map();
  const modelOrig = new Map();
  for (const name of cfg.models) {
    let g; try { g = await assets.loadGLTF(name); } catch (e) { continue; }
    g.scene.traverse((m) => {
      if (!m.isMesh) return;
      let depth = 0, p = m; const chain = []; while (p && p !== g.scene) { chain.push(p.name); depth++; p = p.parent; }
      geoToModel.set(m.geometry.uuid, { name, depth, chain, mat: m.material, meshName: m.name, sceneName: g.scene.name, sceneKids: g.scene.children.length });
    });
  }
  scene.updateMatrixWorld(true);
  // animated detection: snapshot, step 0.15 s, compare
  const snap = new Map();
  scene.traverse((o) => { if (o.isInstancedMesh) snap.set(o, o.instanceMatrix.array.slice(0, 16 * Math.min(o.count, 32))); else if (o.isMesh) snap.set(o, o.matrixWorld.elements.slice()); });
  const ctx = makeCtx(level, scene, geoToModel);
  if (LC.prep) await LC.prep(ctx);
  scene.updateMatrixWorld(true);
  await SF.sim(0.15);
  scene.updateMatrixWorld(true);
  const animated = new Set();
  for (const [o, a] of snap) { const b = o.isInstancedMesh ? o.instanceMatrix.array : o.matrixWorld.elements; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-5) { animated.add(o); break; } }
  // model roots
  const modelRoots = new Map(); const partialNode = new Map();
  scene.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const info = geoToModel.get(o.geometry.uuid); if (!info) return;
    let r = o, partial = null;
    for (let i = 1; i <= info.depth; i++) {
      const up = r.parent;
      if (i < info.depth && (!up || up === scene || up.name !== info.chain[i])) { partial = r.name; break; }
      if (i === info.depth && (!up || up === scene || up.name !== info.sceneName || up.children.length !== info.sceneKids)) { partial = r.name; break; }
      r = up;
    }
    if (!modelRoots.has(r)) { modelRoots.set(r, info.name); if (partial) partialNode.set(r, partial); }
  });
  ctx.modelRoots = modelRoots;
  if (LC.tag) await LC.tag(ctx);
  scene.updateMatrixWorld(true);
  const herGroups = new Set();
  scene.traverse((o) => { if (o.isPoints && o.material?.uniforms?.uDissolve) { const g = o.parent?.parent; if (g) herGroups.add(g); } });

  const out = { level, source: LC.source, env: {}, look: {}, lights: [], materials, meshes: [], models: [], markers: [] };
  const groups = new Map(); // key -> {geo, matId, tag, hidden, castShadow, receiveShadow, mats:[], custom:[], cols:[], instanced, names:Set}
  const glows = [], coneMarkers = [];
  const skipped = {};
  const _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion();
  let figureLightsSkipped = 0;

  function effTag(o) { let p = o; while (p) { if (p.userData.__tag) return p.userData.__tag; p = p.parent; } return null; }
  function visit(o, hidden, underHer) {
    const isHer = underHer || herGroups.has(o);
    // a Group that is invisible is treated as streaming/culling (forest chunks, hub wings): still exported.
    // a Mesh/leaf that is invisible, or anything tagged __hidden, is exported with hidden:true.
    const hid = hidden || o.userData.__hidden || (!o.visible && !(o.isGroup || o.type === 'Object3D'));
    if (o.userData.__skip) { skipped.config = (skipped.config || 0) + 1; return; }
    if (o.isCamera) { skipped.cameraAttached = (skipped.cameraAttached || 0) + 1; return; }
    if (o.isMesh && o.material?.isShaderMaterial && !isHer) {
      const u = o.material.uniforms || {};
      if (u.uPow && u.uInt) { // soft glow billboard
        glows.push({ tag: 'Glow', position: v3(o.getWorldPosition(_v)), color: lin(u.uColor.value), size: r5(o.getWorldScale(_s).x), intensity: r5(u.uInt.value), ...(effTag(o) ? { group: effTag(o) } : {}) });
        return;
      }
      if (u.uSeed && u.uInt) { // candle flame
        glows.push({ tag: 'Glow', kind: 'flame', position: v3(o.getWorldPosition(_v)), color: [1, 0.55, 0.2], size: 0.05, intensity: r5(u.uInt.value), ...(effTag(o) ? { group: effTag(o) } : {}) });
        return;
      }
      if (u.uInt && u.uTime && o.geometry.type === 'CylinderGeometry') { // volumetric light cone
        o.updateMatrixWorld(true);
        const apex = new THREE.Vector3(0, 0.5, 0).applyMatrix4(o.matrixWorld), base = new THREE.Vector3(0, -0.5, 0).applyMatrix4(o.matrixWorld);
        coneMarkers.push({ tag: 'LightCone', position: v3(apex), lookAt: v3(base), length: r5(apex.distanceTo(base)), radiusTop: o.geometry.parameters.radiusTop, radiusBottom: o.geometry.parameters.radiusBottom, color: lin(u.uColor.value), intensity: r5(u.uInt.value) });
        return;
      }
    }
    if (modelRoots.has(o)) {
      const name = modelRoots.get(o);
      let snow = 0, tint = null, cast = false;
      o.traverse((m) => {
        if (!m.isMesh) return;
        cast ||= m.castShadow;
        const P = patchInfo(m.material); if (P?.U?.uSnowAmt) snow = Math.max(snow, P.U.uSnowAmt.value);
        if (!tint) { const info = geoToModel.get(m.geometry.uuid); const oc = info?.mat?.color, nc = m.material.color; if (oc && nc) tint = [r5(nc.r / Math.max(oc.r, 1e-4)), r5(nc.g / Math.max(oc.g, 1e-4)), r5(nc.b / Math.max(oc.b, 1e-4))]; }
      });
      const e = { name, ...(partialNode.has(o) ? { node: partialNode.get(o), nodeNote: 'only this node of the scan, placed with matrix (its own transform included)' } : {}), matrix: Array.from(o.matrixWorld.elements).map(r5), snow: r5(snow), tint: tint || [1, 1, 1], castShadow: cast };
      const tg = effTag(o); if (tg) e.tag = tg;
      if (hid) e.hidden = true;
      if (animated.has(o)) e.animated = true;
      out.models.push(e);
      return;
    }
    if (o.isLight) {
      if (isHer) { figureLightsSkipped++; return; }
      const L = { type: o.isDirectionalLight ? 'directional' : o.isPointLight ? 'point' : o.isSpotLight ? 'spot' : o.isHemisphereLight ? 'hemisphere' : o.isAmbientLight ? 'ambient' : o.type };
      if (o.isHemisphereLight) { L.sky = lin(o.color); L.ground = lin(o.groundColor); L.intensity = r5(o.intensity); }
      else {
        L.color = lin(o.color); L.intensity = r5(o.intensity);
        L.position = v3(o.getWorldPosition(_v));
        if (o.isDirectionalLight || o.isSpotLight) { o.target.updateMatrixWorld(true); L.target = v3(o.target.getWorldPosition(_v)); }
        if (o.isPointLight || o.isSpotLight) { L.distance = r5(o.distance); L.decay = r5(o.decay); }
        if (o.isSpotLight) { L.angle = r5(o.angle); L.penumbra = r5(o.penumbra); }
        L.castShadow = !!o.castShadow;
        if (o.castShadow && o.shadow) { L.shadowMapSize = o.shadow.mapSize.x; L.shadowBias = r5(o.shadow.bias); L.shadowNormalBias = r5(o.shadow.normalBias); if (o.isDirectionalLight) { const c = o.shadow.camera; L.shadowExtent = [c.left, c.right, c.bottom, c.top, c.near, c.far]; } }
      }
      const tg = effTag(o); if (tg) L.tag = tg;
      out.lights.push(L);
      return;
    }
    if (o.isSprite) {
      const mat = o.material;
      const op = mat.opacity;
      if (op > 0.02 && !o.userData.__skip) glows.push({ tag: 'Glow', position: v3(o.getWorldPosition(_v)), color: lin(mat.color), size: r5(o.getWorldScale(_s).x), opacity: r5(op), ...(animated.has(o) ? { animated: true } : {}) });
      else skipped.glowInvisible = (skipped.glowInvisible || 0) + 1;
      return;
    }
    if (o.isPoints) {
      if (o.material?.uniforms?.uDissolve) { skipped.her = (skipped.her || 0) + 1; return; }
      const mat = o.material; const pos = o.geometry.attributes.position;
      if (mat.map && mat.opacity > 0.02) {
        let n = 0;
        for (let i = 0; i < pos.count; i++) {
          _v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          if (_v.y < -50) continue;
          glows.push({ tag: 'Glow', position: v3(_v), color: lin(mat.color), size: r5(mat.size), opacity: r5(mat.opacity) }); n++;
        }
        if (!n) skipped.pointsEmpty = (skipped.pointsEmpty || 0) + 1;
      } else skipped.points = (skipped.points || 0) + 1;
      return;
    }
    if (o.isMesh) {
      const why = excludeReason(o);
      if (why) { skipped[why] = (skipped[why] || 0) + 1; }
      else addMesh(o, hid);
    }
    for (const c of o.children) visit(c, hid, isHer);
  }
  function addMesh(o, hid) {
    const g = o.geometry;
    if (Array.isArray(o.material)) { skipped.multiMaterial = (skipped.multiMaterial || 0) + 1; return; }
    const tris = triCount(g);
    if (tris <= 0) { skipped.emptyGeometry = (skipped.emptyGeometry || 0) + 1; return; }
    if (o.isInstancedMesh && o.count === 0 && !(o.userData.full > 0)) { skipped.emptyInstanced = (skipped.emptyInstanced || 0) + 1; return; }
    const flipV = o.material.map ? o.material.map.flipY !== false : true;
    const gk = geoHash(g) + (flipV ? '' : 'n');
    const matId = materialId(o.material, o);
    const tag = effTag(o) || '';
    const key = [gk, matId, tag, hid ? 1 : 0, o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0, animated.has(o) ? 1 : 0].join('|');
    let G = groups.get(key);
    const leaf = materials[matId].kind === 'leafcards';
    if (!G) { G = { geo: g, gk, flipV, matId, tag, hidden: hid, castShadow: o.castShadow, receiveShadow: o.receiveShadow, animated: animated.has(o), mats: [], custom: [], cols: [], anyCol: false, instanced: false, names: new Set(), leaf }; groups.set(key, G); }
    G.names.add(o.name || '');
    if (o.isInstancedMesh) {
      G.instanced = true;
      const n = Math.max(o.count, o.userData.full || 0);
      const tile = g.attributes.aTile, ic = o.instanceColor;
      for (let i = 0; i < n; i++) {
        _m.fromArray(o.instanceMatrix.array, i * 16);
        _w.multiplyMatrices(o.matrixWorld, _m);
        G.mats.push(_w.elements.slice());
        const c = ic ? [ic.array[i * 3], ic.array[i * 3 + 1], ic.array[i * 3 + 2]] : [1, 1, 1];
        if (ic) G.anyCol = true;
        if (leaf) G.custom.push([tile ? tile.array[i] : 0, ...c]);
        else G.cols.push(c);
      }
    } else {
      G.mats.push(o.matrixWorld.elements.slice());
      if (leaf) G.custom.push([0, 1, 1, 1]); else G.cols.push([1, 1, 1]);
    }
  }
  for (const c of scene.children) visit(c, false, false);

  // ---- write meshes
  const geoWritten = new Map();
  let idn = 0, totalTris = 0, totalInst = 0;
  const entries = [...groups.values()].sort((a, b) => (b.mats.length * triCount(b.geo)) - (a.mats.length * triCount(a.geo)));
  for (const G of entries) {
    const id = 'm' + idn++;
    if (!geoWritten.has(G.gk)) {
      const glb = await exportGLB(cleanGeometry(G.geo, G.flipV));
      const file = 'meshes/' + G.gk + '.glb';
      await save(file, glb);
      geoWritten.set(G.gk, file);
    }
    const e = { id, file: geoWritten.get(G.gk), material: G.matId, name: nameFor(G), castShadow: G.castShadow, receiveShadow: G.receiveShadow, triangles: triCount(G.geo) };
    if (G.tag) e.tag = G.tag;
    if (G.hidden) e.hidden = true;
    if (G.animated) e.animated = true;
    const n = G.mats.length;
    if (n === 1 && !G.instanced) {
      e.matrix = G.mats[0].map(r5);
    } else {
      const cf = G.leaf ? 4 : 0;
      const buf = new Float32Array(n * (16 + cf));
      for (let i = 0; i < n; i++) { buf.set(G.mats[i], i * (16 + cf)); if (cf) buf.set(G.custom[i], i * (16 + cf) + 16); }
      e.instances = 'inst/' + id + '.bin'; e.count = n; e.customFloats = cf;
      await save(e.instances, new Uint8Array(buf.buffer));
      if (!G.leaf && G.anyCol) {
        const cb = new Float32Array(n * 3); for (let i = 0; i < n; i++) cb.set(G.cols[i], i * 3);
        e.instanceColors = 'inst/' + id + '.col.bin';
        await save(e.instanceColors, new Uint8Array(cb.buffer));
      }
    }
    totalTris += e.triangles * n; totalInst += n;
    out.meshes.push(e);
  }
  // ---- textures (+ glow always, for Glow markers)
  try { const tx = await import('/js/fx/textures.js'); texFile(tx.glowTex(), 'glow'); } catch (e) { /* */ }
  for (const [, rec] of texOut) {
    if (rec.saved) continue; rec.saved = true;
    const bin = Uint8Array.from(atob(rec.url.split(',')[1]), (c) => c.charCodeAt(0));
    await save(rec.file, bin);
  }
  // ---- env / look
  const env = out.env;
  env.hdri = LC.hdri ?? null;
  env.envIntensity = r5(scene.environmentIntensity ?? 1);
  if (scene.background?.isColor) env.background = lin(scene.background);
  if (scene.fog) env.fog = scene.fog.isFogExp2 ? { type: 'exp2', color: lin(scene.fog.color), density: r5(scene.fog.density) } : { type: 'linear', color: lin(scene.fog.color), near: scene.fog.near, far: scene.fog.far };
  let sky = null;
  scene.traverse((o) => { if (o.isMesh && excludeReason(o) === 'sky') sky = o; });
  if (sky) {
    const u = {}; for (const [k, v] of Object.entries(sky.material.uniforms)) { const val = v.value; if (val?.isColor) u[k] = lin(val); else if (val?.isVector3) u[k] = v3(val); else if (typeof val === 'number') u[k] = val; }
    env.sky = { kind: 'dome', top: u.uTop || u.uZen || u.uHaze, horizon: u.uHor || u.uHaze, uniforms: u, radius: sky.geometry.parameters?.radius };
    if (!env.background) env.background = env.sky.horizon;
  } else env.sky = { kind: 'color', top: env.background, horizon: env.background };
  if (LC.env) Object.assign(env, LC.env);
  out.look = JSON.parse(JSON.stringify(E.post.target || E.post.look));
  // ---- markers
  out.markers = (await LC.markers(ctx)).concat(coneMarkers, glows);
  for (const mk of out.markers) { if (mk.tag === 'Shot' || mk.tag === 'OpeningCam') mk.fov ??= r5(E.camera.fov); }
  out.uvConvention = 'glTF: v=0 at the top of the stored PNG / Poly Haven image (three uv flipped on export)';
  out.stats = { meshEntries: out.meshes.length, instances: totalInst, triangles: totalTris, models: out.models.length, markers: out.markers.length, lights: out.lights.length, skipped, figureLightsSkipped, animatedObjects: animated.size, uniqueGeometries: geoWritten.size, textures: [...new Set([...texOut.values()].map((r) => r.file))] };
  out.notes = LC.notes || [];
  await saveText('scene.json', JSON.stringify(out, null, 1));
  if (level === 'L_Blizzard') {
    const bg = new THREE.BoxGeometry(1, 2, 3); bg.translate(1.5, 4, 7.5);
    await save('calib.glb', await exportGLB(cleanGeometry(bg)));
  }
  log('done', JSON.stringify(out.stats));
  return out.stats;
}
function nameFor(G) {
  const m = materials[G.matId];
  const nm = [...G.names].filter(Boolean)[0];
  const gt = G.geo.type.replace('Geometry', '').replace('Buffer', '') || 'Mesh';
  const what = m.kind === 'pbr' ? m.polyhaven : m.map ? m.map.replace(/^tex\/|\.png$/g, '') : m.kind;
  return [G.tag, nm, gt, what].filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ helpers for level configs
function makeCtx(level, scene, geoToModel) {
  const E = SF.E;
  const ray = new THREE.Raycaster();
  let grounds = null;
  const ctx = {
    E, scene, THREE, player: SF.player,
    groundAt(x, z, dflt = 0) {
      if (!grounds) {
        grounds = [];
        scene.traverse((o) => {
          if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || excludeReason(o)) return;
          o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
          if (Math.max(b.max.x - b.min.x, b.max.z - b.min.z) >= 30 && (b.max.y - b.min.y) < 40) grounds.push(o);
        });
      }
      ray.set(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0)); ray.far = 400;
      const h = ray.intersectObjects(grounds, false);
      return h.length ? h[0].point.y : dflt;
    },
    modelsNamed(name) { return [...(ctx.modelRoots || new Map())].filter(([, n]) => n === name).map(([o]) => o); },
    findModelRootsNow(name) { // before modelRoots is built (prep stage)
      const out = new Set();
      scene.traverse((o) => { if (!o.isMesh) return; const info = geoToModel.get(o.geometry.uuid); if (!info || info.name !== name) return; let r = o; for (let i = 0; i < info.depth; i++) r = r.parent; out.add(r); });
      return [...out];
    },
    tag(o, t) { if (o) o.userData.__tag = t; return o; },
    find(pred) { let r = null; scene.traverse((o) => { if (!r && pred(o)) r = o; }); return r; },
    findAll(pred) { const r = []; scene.traverse((o) => { if (pred(o)) r.push(o); }); return r; },
    // shot from position + yaw/pitch (player convention: forward = (-sin y cos p, sin p, -cos y cos p))
    shotYP(name, pos, yaw, pitch, dist = 10, fov) {
      const f = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      const p = new THREE.Vector3(...pos);
      return { tag: 'Shot', name, position: v3(p), lookAt: v3(p.clone().addScaledVector(f, dist)), fov: fov ?? r5(E.camera.fov), yaw: r5(yaw), pitch: r5(pitch) };
    },
    shotAt(name, pos, look, fov) { return { tag: 'Shot', name, position: v3(new THREE.Vector3(...pos)), lookAt: v3(new THREE.Vector3(...look)), fov: fov ?? r5(E.camera.fov) }; },
    yawOf(dir) { return Math.atan2(-dir.x, -dir.z); },
    // transform marker from an object (figure local front = +Z): yaw/pitch/roll describe the facing direction in player convention
    figureMarker(tag, obj, extra = {}) {
      obj.updateMatrixWorld(true);
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      obj.matrixWorld.decompose(p, q, s);
      const q2 = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      const e = new THREE.Euler().setFromQuaternion(q2, 'YXZ');
      return { tag, position: v3(p), yaw: r5(e.y), pitch: r5(e.x), roll: r5(e.z), quat: [r5(q.x), r5(q.y), r5(q.z), r5(q.w)], figureFront: '+Z', ...extra };
    },
    v3, r5,
  };
  return ctx;
}

// ------------------------------------------------------------------ per-level configs
const deg = Math.PI / 180;
const LEVELS = {
  L_Blizzard: {
    source: 'blizzard.js mode=intro', hdri: 'snowy_field',
    notes: ['forest chunks are exported regardless of the runtime z-culling (forest.cull)', 'contact-shadow blobs under the memorials are exported as unlit transparent decals (tex/contactShadow*.png)'],
    async markers(c) {
      const g = (x, z) => c.groundAt(x, z);
      const M = [];
      M.push({ tag: 'PlayerStart', spawn: 'default', position: [0, r5(g(0, 0)), 0], yaw: 0, pitch: -0.02 });
      M.push({ tag: 'ShadowStart', position: [0.4, r5(g(0.4, -16)), -16], yaw: 0, note: 'the Shadow walks ahead down −Z (its figure is rotated π)' });
      const eye = [0, g(0, 0) + 1.62, 0];
      M.push(c.shotYP('shot_start', eye, 0, -0.02, 20));
      M.push(c.shotYP('shot_trees', eye, 0.55, 0.15, 20));
      const wc = c.modelsNamed('wheelchair_01')[0];
      const bb = new c.THREE.Box3().setFromObject(wc); const ctr = bb.getCenter(new c.THREE.Vector3());
      M.push(c.shotAt('shot_wheelchair', [0.9, g(0.9, -21.8) + 1.62, -21.8], [ctr.x, ctr.y, ctr.z]));
      return M;
    },
  },
  L_Bench: {
    source: 'blizzard.js mode=end', hdri: 'snowy_field',
    notes: ['WineGlass mesh is hidden until the cutscene (director spawns SM_WineGlass at GlassPoint)'],
    async tag(c) {
      for (const b of c.modelsNamed('painted_wooden_bench')) c.tag(b, 'Bench');
      for (const l of c.modelsNamed('street_lamp_01')) c.tag(l, 'Lamp');
      // the wine glass group (lathe glass + wine), hidden until sitDown()
      const glassMesh = c.find((o) => o.isMesh && o.geometry.type === 'LatheGeometry' && o.material.isMeshPhysicalMaterial && o.material.opacity < 0.5);
      if (glassMesh) { c.tag(glassMesh.parent, 'WineGlass'); glassMesh.parent.userData.__hidden = true; }
      const lampL = c.find((o) => o.isPointLight && o.color.getHex() === 0xffc98a); c.tag(lampL, 'LampLight');
    },
    async markers(c) {
      const T = c.THREE, g = (x, z) => c.groundAt(x, z);
      const BZ = -70, M = [];
      M.push({ tag: 'PlayerStart', spawn: 'default', position: [0, r5(g(0, 0)), 0], yaw: 0, pitch: 0 });
      M.push({ tag: 'SitPoint', position: [1.8, r5(g(1.8, BZ)), BZ], note: 'ground under the interact point; the game interact sits 0.8 m above (1.8,0.8,-70)' });
      const seatY = g(1.8, BZ) + 0.42;
      const bench = c.modelsNamed('painted_wooden_bench')[0];
      // him: group.rotation.y = -π/2+0.08 with the figure facing +Z → facing yaw (player convention) = π/2+0.08 = bench.rotation.y
      M.push({ tag: 'SeatPoint', position: [1.62, r5(seatY), BZ], yaw: r5(Math.PI / 2 + 0.08), pitch: 0, benchYaw: r5(bench.rotation.y), note: 'hip/seat point at seat height (ground+0.42); yaw = direction the sitter faces' });
      M.push({ tag: 'GlassPoint', position: [1.05, r5(g(1.05, BZ - 0.15)), BZ - 0.15] });
      let kx = 0, kz = 0; for (let i = 0; i < 4; i++) { kx += 11 + i * 3.2; kz += BZ - 5 - i * 2.2; } kx /= 4; kz /= 4;
      M.push({ tag: 'KidsCenter', position: [r5(kx), r5(g(kx, kz)), r5(kz)], radius: 5, note: '4 children run ellipses r 3..7 m around centres (11+3.2i, BZ-5-2.2i)' });
      M.push(c.shotAt('shot_approach', [0.2, g(0.2, -60) + 1.62, -60], [2.5, g(2.5, -70.8) + 1.3, -70.8]));
      M.push(c.shotAt('shot_bench', [-0.7, 0.62, BZ + 1.75], [1.25, 0.42, BZ - 0.15]));
      M.push(c.shotAt('shot_pullback_end', [-9, 3.4, BZ + 11], [3, 0.9, BZ - 2]));
      return M;
    },
  },
  L_Library: {
    source: 'library.js (hub: garden + nave + jungle chamber), loaded with spawn=hall, no story flags', hdri: 'sunny_rose_garden',
    notes: ['gardenGrp / chamber visibility (runtime streaming by player z) ignored: everything exported', 'door chains are hidden until the radio has spoken (hidden:true, tags DoorChains1..3)', 'lure sprite and drifting motes/seeds are runtime FX (motes/seeds exported as animated leafcards snapshots)'],
    async prep(c) {
      // runtime streaming: make both wings visible
      for (const o of c.scene.children) if (o.isGroup && !o.visible) o.visible = true;
    },
    async tag(c) {
      const pane = c.find((o) => o.isMesh && o.material?.uniforms?.uOn); c.tag(pane, 'WindowPane');
      const wl = c.find((o) => o.isPointLight && o.color.getHex() === 0x5f9ad6); c.tag(wl, 'WindowGlow');
      const spots = [{ x: 4.3, z: -24 }, { x: -4.3, z: -28 }, { x: 4.3, z: -30.4 }];
      const doorLights = c.findAll((o) => o.isPointLight && o.color.getHex() === 0xff2010);
      for (const l of doorLights) {
        const grp = l.parent; const n = spots.findIndex((s) => Math.abs(s.x - grp.position.x) < 0.1 && Math.abs(s.z - grp.position.z) < 0.1) + 1;
        c.tag(l, 'DoorLight' + n);
        const chains = grp.children.find((ch) => ch.isInstancedMesh); if (chains) { c.tag(chains, 'DoorChains' + n); chains.userData.__hidden = !chains.visible; chains.visible = true; }
        const leaf = grp.children.find((ch) => ch.isMesh && ch.geometry.type === 'BoxGeometry' && Math.abs(ch.geometry.parameters.height - 2.15) < 0.01); if (leaf) c.tag(leaf, 'Door' + n);
      }
      // the lure sprite moves to whatever is next: not a static glow
      const lure = c.find((o) => o.isSprite && o.material.color.getHex() === 0xffd8a0); if (lure) lure.userData.__skip = true;
      // story props
      const cherries = c.find((o) => o.isGroup && o.children.length === 14 && o.children.every((ch) => ch.isMesh && ch.geometry.type === 'SphereGeometry')); c.tag(cherries, 'Cherries');
      const bottle = c.find((o) => o.isMesh && o.geometry.type === 'LatheGeometry' && o.material.isMeshPhysicalMaterial && o.material.opacity > 0.8 && o.material.opacity < 0.9); c.tag(bottle, 'Bottle');
      for (const r of c.modelsNamed('vintage_radio_transceiver')) c.tag(r, 'Radio');
    },
    async markers(c) {
      const M = [];
      // spawns table + wakeUp()
      const spawns = { hall: [0, -1.5, 0], book: [-0.4, -9.4, 0.5], window: [1.6, -14.2, 1.2], globe: [-0.5, -21.2, -0.2], door1: [2.6, -24, -1.4], door2: [-2.6, -28, 1.4], door3: [2.6, -30.4, -1.4] };
      M.push({ tag: 'PlayerStart', spawn: 'wake', position: [0.6, 0, 14], yaw: 0.3, pitch: 0.95, eye: 0.16, note: 'lying in the daisies; eye height 0.16 m, stands up to 1.62' });
      M.push({ tag: 'PlayerStart', spawn: 'default', position: [0.6, 0, 14], yaw: 0.3, pitch: 0.95, eye: 0.16, note: 'same as wake (first arrival)' });
      for (const [k, s] of Object.entries(spawns)) M.push({ tag: 'PlayerStart', spawn: k, position: [s[0], 0, s[1]], yaw: s[2], pitch: 0 });
      M.push({ tag: 'LibraryMouth', position: [0, 0, 0], yaw: 0 });
      const I = { I_book: [-1.35, 0.47, -8.2], I_window: [4.2, 1.6, -14], I_globe: [-1.45, 0.72, -19.95], I_cherries: [1.42, 0.69, -41.0], I_bottle: [1.6, 0.69, -40.85], I_radio: [-3.0, 0.72, -35.3],
        I_door1: [3.7, 1.2, -24], I_door2: [-3.7, 1.2, -28], I_door3: [3.7, 1.2, -30.4], I_exit: [0, 1.4, 3.5], I_bedGive: [-0.1, 0.85, -41.2] };
      const radius = { I_book: 0.25, I_window: 0.7, I_globe: 0.15, I_cherries: 0.25, I_bottle: 0.03, I_radio: 0.3, I_door1: 0.6, I_door2: 0.6, I_door3: 0.6, I_exit: 2.5, I_bedGive: 0.4 };
      // read live positions where the object exists
      const radio = c.modelsNamed('vintage_radio_transceiver')[0]; if (radio) I.I_radio = v3(radio.getWorldPosition(new c.THREE.Vector3()));
      const bowl = c.modelsNamed('wooden_bowl_01')[0]; if (bowl) I.I_cherries = v3(bowl.getWorldPosition(new c.THREE.Vector3()));
      for (const [k, p] of Object.entries(I)) M.push({ tag: k, position: p, radius: radius[k] });
      // her lying transform (cherryMemory): position (-0.05,0.6,-41.05), rotation YXZ (-π/2, π, 0)
      const bed = new c.THREE.Object3D(); bed.position.set(-0.05, 0.6, -41.05); bed.rotation.order = 'YXZ'; bed.rotation.set(-Math.PI / 2, Math.PI, 0);
      M.push(c.figureMarker('HerBed', bed, { euler: [-Math.PI / 2, Math.PI, 0, 'YXZ'], note: 'her.group transform (feet origin, figure local front +Z) as set in cherryMemory()' }));
      const sit = new c.THREE.Object3D(); sit.position.set(0, 0.52, -39.4);
      M.push(c.figureMarker('HerSit', sit, { seatHeight: 0.52, note: 'reunion: hips at y=0.52 (her.group.y = 0.52 - hipY), facing +Z toward the nave' }));
      M.push({ tag: 'CherryView', position: [1.0, 0, -39.4], yaw: 2.6, pitch: -0.35, note: 'player feet position + look during the cherry memory' });
      M.push(c.shotYP('shot_wake', [0.6, 0.16, 14], 0.3, 0.95));
      M.push(c.shotYP('shot_meadow', [0.4, 1.6, 10], 0, 0));
      M.push(c.shotYP('shot_nave', [0, 1.6, -3], 0, 0.25));
      M.push(c.shotYP('shot_chamber', [0.3, 1.6, -34.8], 0, -0.12));
      M.push(c.shotYP('shot_door', [-1.2, 1.6, -23.6], -Math.PI / 2 + 0.12, 0));
      return M;
    },
  },
  L_Park: {
    source: 'park.js', hdri: 'autumn_park',
    notes: ['maple crowns use per-tree distance LOD at runtime (mesh.count); exported at full count', 'the book on her lap is exported (tag ChairAttached) at the start pose; it rides with the Chair', 'falling leaves (Drifters) exported as an animated leafcards snapshot'],
    park: null,
    async tag(c) {
      const wc = c.modelsNamed('wheelchair_01')[0]; c.tag(wc, 'Chair');
      // her book: plain meshes inside her figure group
      const her = c.find((o) => o.isPoints && o.material?.uniforms?.uDissolve)?.parent?.parent;
      if (her) for (const ch of her.children) if (ch.isGroup && ch.children.some((m) => m.isMesh && m.geometry.type === 'BoxGeometry')) c.tag(ch, 'ChairAttached');
    },
    async markers(c) {
      const T = c.THREE, g = (x, z) => c.groundAt(x, z);
      const PATH = new T.CatmullRomCurve3([[0, 0, 4], [0, 0, 0], [0.8, 0, -12], [-1.6, 0, -26], [-3.4, 0, -40], [-1.2, 0, -55], [2.4, 0, -68], [3.2, 0, -82], [1.0, 0, -96], [-1.5, 0, -110]].map(([x, y, z]) => new T.Vector3(x, y, z)), false, 'centripetal');
      const L = PATH.getLength(), S0 = 4.2;
      const pathAt = (s) => { const u = T.MathUtils.clamp(s / L, 0, 1); const p = PATH.getPointAt(u), t = PATH.getTangentAt(u).setY(0).normalize(); return { p, t }; };
      const heading = (t) => Math.atan2(-t.x, -t.z);
      const cart = c.modelsNamed('wheelchair_01')[0].parent;
      cart.updateMatrixWorld(true);
      const M = [];
      const ps = cart.localToWorld(new T.Vector3(0, 0, 1.05));
      M.push({ tag: 'PlayerStart', spawn: 'default', position: [r5(ps.x), r5(g(ps.x, ps.z)), r5(ps.z)], yaw: r5(cart.rotation.y), pitch: -0.13, note: 'behind the push handles (1.05 m behind the chair origin); park is on rails' });
      const oc = cart.localToWorld(new T.Vector3(Math.sin(-2.75) * 2.7, 0.75, Math.cos(-2.75) * 2.7));
      const ol = cart.localToWorld(new T.Vector3(0, 1.45, 0));
      M.push({ tag: 'OpeningCam', name: 'OpeningCam', position: v3(oc), lookAt: v3(ol), fov: 62 });
      M.push({ tag: 'Shot', name: 'shot_opening', position: v3(oc), lookAt: v3(ol), fov: 62 });
      let i = 0;
      for (let s = S0; s <= L - 3 + 1e-6; s += 2) { const { p } = pathAt(s); M.push({ tag: 'Path' + i++, position: [r5(p.x), r5(g(p.x, p.z)), r5(p.z)] }); }
      { const { p } = pathAt(L - 3); M.push({ tag: 'Path' + i++, position: [r5(p.x), r5(g(p.x, p.z)), r5(p.z)], note: 'end of push (PATH_LEN-3)' }); }
      const fp = (s, pitch, name) => {
        const { p, t } = pathAt(s); const yaw = heading(t);
        const pos = new T.Vector3(0, 1.62, 1.05).applyAxisAngle(new T.Vector3(0, 1, 0), yaw).add(new T.Vector3(p.x, g(p.x, p.z), p.z));
        return c.shotYP(name, v3(pos), yaw, pitch, 8);
      };
      M.push(fp(S0 + 12, -0.13, 'shot_push'));
      M.push(fp(S0 + 26, -0.13 + 0.55, 'shot_canopy'));
      return M;
    },
  },
  L_Field: {
    source: 'field.js', hdri: 'snowy_field',
    notes: ['wheel tracks / wheel spray are runtime-generated (not exported)', 'the wheelchair (tag Chair) is placed at the loop start; it moves along the loop at runtime'],
    async tag(c) { const wc = c.modelsNamed('wheelchair_01')[0]; c.tag(wc, 'Chair'); },
    async markers(c) {
      const T = c.THREE, g = (x, z) => c.groundAt(x, z);
      const LOOP = new T.CatmullRomCurve3([[0, -5], [-2.5, -13], [0.5, -22], [8, -28.5], [16.5, -26], [19.5, -17], [14, -9.5], [6, -3.5]].map(([x, z]) => new T.Vector3(x, 0, z)), true, 'centripetal');
      const LL = LOOP.getLength();
      const pts = LOOP.getSpacedPoints(200); pts.pop();
      const ctr = pts.reduce((a, p) => a.add(p), new T.Vector3()).multiplyScalar(1 / pts.length);
      const rad = pts.reduce((a, p) => a + Math.hypot(p.x - ctr.x, p.z - ctr.z), 0) / pts.length;
      const M = [];
      M.push({ tag: 'PlayerStart', spawn: 'default', position: [0, r5(g(0, 1)), 1], yaw: 0, pitch: -0.1 });
      M.push({ tag: 'FieldCenter', position: [r5(ctr.x), r5(g(ctr.x, ctr.z)), r5(ctr.z)], radius: r5(rad), loopLength: r5(LL), note: 'her loop is an irregular closed CatmullRom; Loop0..N give the exact centre line (2 m spacing)' });
      let i = 0; for (let s = 0; s < LL - 1; s += 2) { const p = LOOP.getPointAt(s / LL); M.push({ tag: 'Loop' + i++, position: [r5(p.x), r5(g(p.x, p.z)), r5(p.z)] }); }
      const eye = [0, g(0, 1) + 1.62, 1];
      M.push(c.shotYP('shot_start', eye, 0, -0.1, 12));
      const her = LOOP.getPointAt(0.42);
      M.push(c.shotAt('shot_chase', [5.5, g(5.5, -9) + 1.62, -9], [her.x, g(her.x, her.z) + 0.8, her.z]));
      return M;
    },
  },
  L_Road: {
    source: 'road.js visit=1 (pass 1 state; scarf / wheel tracks / exit light are pass-2+/3 details, exported hidden)', hdri: 'winter_evening',
    notes: ['the 70 m stretch is periodic: everything (trees, house, scarf, tracks) repeats every L=70 m along −Z; RoadStart→RoadEnd is one loop (teleport back by 70 m at RoadEnd)',
      'forest chunks exported regardless of runtime culling (trees.cull)', 'him (the silhouette) is a character: not exported',
      'FarGlow follows him 40 m ahead down the road (marker gives one sample)'],
    async tag(c) {
      const scarves = c.findAll((o) => o.isMesh && o.material?.color?.getHex?.() === 0xa0101a);
      for (const sc of scarves) { c.tag(sc, 'Scarf'); sc.userData.__hidden = !sc.visible; sc.visible = true; }
      const tracks = c.findAll((o) => o.isMesh && o.material?.vertexColors && o.material.transparent && o.material.isMeshBasicMaterial);
      for (const t of tracks) { c.tag(t, 'WheelTracks'); t.userData.__hidden = true; t.visible = true; }
      const exitL = c.find((o) => o.isPointLight && o.color.getHex() === 0xffb070); c.tag(exitL, 'LeaveLightPoint');
      const far = c.find((o) => o.isSprite && o.scale.x > 30); if (far) { far.userData.__skip = true; c.__far = far; }
      for (const l of c.findAll((o) => o.isPointLight && o.color.getHex() === 0xffa85e)) c.tag(l, 'HouseWindowLight');
      const winMeshes = c.findAll((o) => o.isMesh && o.material?.emissive?.getHex?.() === 0xff8a40); for (const w of winMeshes) c.tag(w, 'HouseWindow');
      const moon = c.find((o) => o.isDirectionalLight); c.tag(moon, 'Moon');
    },
    async markers(c) {
      const T = c.THREE, g = (x, z) => c.groundAt(x, z), M = [];
      const L = 70, TAU = Math.PI * 2, S_START = -9.4, S_LAND = 8, HS = -10, LIGHT_S = 44, LIGHT_D = 19, SCARF_S = 38;
      const cx = (s) => 3.6 * Math.sin(TAU * s / L + 0.4) + 0.6 * Math.sin(2 * TAU * s / L + 1.3);
      const cxd = (s) => 3.6 * TAU / L * Math.cos(TAU * s / L + 0.4) + 0.6 * 2 * TAU / L * Math.cos(2 * TAU * s / L + 1.3);
      const roadYaw = (s) => Math.atan2(-cxd(s), 1);
      const px = cx(S_START) - 4.0, pz = -S_START;
      M.push({ tag: 'PlayerStart', spawn: 'default', position: [r5(px), r5(g(px, pz)), r5(pz)], yaw: r5(roadYaw(S_START) - 0.5), note: 'HIS start by the front door (third person); yaw = his heading, slightly turned toward the road' });
      M.push({ tag: 'RoadStart', position: [r5(cx(S_LAND)), r5(g(cx(S_LAND), -S_LAND)), -S_LAND], yaw: r5(roadYaw(S_LAND)), period: L, note: 'a new pass begins here (S_LAND = 8)' });
      M.push({ tag: 'RoadEnd', position: [r5(cx(S_LAND + L)), r5(g(cx(S_LAND + L), -(S_LAND + L))), -(S_LAND + L)], yaw: r5(roadYaw(S_LAND + L)), period: L, note: 'teleport line: crossing it moves him and the camera back by 70 m (+Z)' });
      const lx = cx(LIGHT_S) + LIGHT_D, lz = -LIGHT_S;
      M.push({ tag: 'LeaveLight', position: [r5(lx), r5(g(lx, lz) + 1.4), lz], color: [1, 0.69, 0.44], intensity: 9, distance: 16, note: 'warm exit light off the right of the road (pass 2+); the path toward it opens for |s-44|<6; copy one loop ahead at z-70' });
      M.push({ tag: 'ScarfBough', position: [r5(cx(SCARF_S) - 3.95), r5(g(cx(SCARF_S) - 3.95, -SCARF_S) + 1.62), -SCARF_S], note: 'low bough holding the red scarf (pass 2)' });
      M.push({ tag: 'HouseDoor', position: [r5(cx(HS) - 10.2 + 3.9), r5(g(cx(HS) - 10.2, -HS)), -HS - 0.6], note: 'his front door step' });
      if (c.__far) M.push({ tag: 'FarGlow', position: v3(c.__far.getWorldPosition(new T.Vector3())), color: lin(c.__far.material.color), size: [64, 40], opacity: 0.6, note: 'follows him: always 40 m ahead down the road, 3.5 m up, unfogged' });
      // reference framing: third-person road camera (landCamera / update) with him on the centre line at s
      const roadShot = (name, s) => {
        const pos = new T.Vector3(cx(s), g(cx(s), -s), -s), sc = s - 11, sl = s + 14;
        const cam = [(cx(sc) + pos.x - cxd(s) * 11) * 0.5, pos.y + 2.4, -sc], look = [cx(sl), pos.y + 1.45, -sl];
        return { ...c.shotAt(name, cam, look), him: v3(pos) };
      };
      M.push(roadShot('shot_road', 22));
      const HX = cx(HS) - 10.2;
      M.push(c.shotAt('shot_house', [cx(-3) + 1.2, g(cx(-3) + 1.2, 3) + 1.7, 3], [HX + 2.5, 2.2, 10]));
      M.push(roadShot('shot_start', S_START + 1.2));
      return M;
    },
  },
  L_Red: {
    source: 'red.js opts.frag=3 (room exported once with the fragment-3 props; those are tagged Frag3Only)', hdri: null,
    notes: [
      'env/look/lights are the fragment-3 (WARM) values. Fragments 1/2 differ: lamp colour 0xff0d06, spot 12, fill 0.9, wash 3, hemi 0x3a0404 @0.06, fog 0x070001 density 0.08, wall tint 0x8a6a62, sconce emissive 14, cold window light 0.25, look tint [1.12,0.62,0.68] (frag 3: [1.12,0.72,0.6]).',
      'environment is a PMREM of a tiny generated room (no HDRI): near-black sphere + red lamp blob',
      'chains are a per-frame animated InstancedMesh (exported snapshot, animated:true); curtains are vertex-animated (snapshot)',
      'window: the cracked-open right casement (frag 3) is tagged Frag3Only; a closed copy is tagged Frag12Only (hide it in frag 3)',
      'BottleEmpty = the end-of-frag-3 state (tipped glass, liquid hidden, cap beside it), hidden by default',
      'light cone, lamp halo and candle flames are exported as LightCone / Glow markers; window snow + dust motes are not exported',
    ],
    async tag(c) {
      const T = c.THREE;
      const NS = new T.Vector3(0.55, 0, -2.25), NS_TOP = 0.70;
      // lamp
      const sconce = c.find((o) => o.isMesh && o.material?.emissiveIntensity >= 6 && o.material.emissive && o.material.emissive.r > 0.5 && o.material.emissive.g < 0.2);
      if (sconce) { sconce.userData.__srcModel = 'industrial_caged_sconce'; c.tag(sconce, 'RedLamp'); }
      const spot = c.find((o) => o.isSpotLight && o.castShadow); c.tag(spot, 'RedLampSpot');
      const wash = c.find((o) => o.isSpotLight && !o.castShadow); c.tag(wash, 'RedLampWash');
      const cold = c.find((o) => o.isPointLight && o.color.getHex() === 0x8090b0); c.tag(cold, 'WindowCold');
      const fill = c.find((o) => o.isPointLight && o.parent === c.scene && o.color.r > 0.9 && o.color.g < 0.1 && o.distance > 5); c.tag(fill, 'RedLampFill');
      // bottle: full (as built) + empty variant (end of fragment 3)
      const glass = c.find((o) => o.isMesh && o.geometry.type === 'LatheGeometry' && o.material.emissive?.getHex() === 0x0e5a22);
      const full = glass.parent; c.tag(full, 'BottleFull');
      const cap = full.children.find((m) => m.geometry.type === 'CylinderGeometry');
      const empty = new T.Group(); empty.name = 'bottle empty';
      const tipped = new T.Group(); tipped.rotation.set(0, 0.5, Math.PI / 2); tipped.position.set(NS.x - 0.1, NS_TOP + 0.0195, NS.z + 0.12);
      tipped.add(glass.clone()); empty.add(tipped);
      const cap2 = cap.clone(); cap2.position.set(NS.x - 0.2, NS_TOP + 0.007, NS.z + 0.17); cap2.rotation.set(0, 0, 0); empty.add(cap2);
      c.scene.add(empty); c.tag(empty, 'BottleEmpty'); empty.userData.__hidden = true;
      // fragment 3 props: candles, wine bottle, her glass, his glass (put down on the nightstand during the scene)
      for (const st of c.modelsNamed('wooden_candlestick')) c.tag(st.parent, 'Frag3Only');
      for (const wb of c.modelsNamed('wine_bottles_01')) c.tag(wb.parent && wb.parent !== c.scene ? wb.parent : wb, 'Frag3Only');
      const wineGlasses = c.findAll((o) => o.isMesh && o.geometry.type === 'LatheGeometry' && o.material.isMeshPhysicalMaterial && o.material.opacity < 0.5).map((m) => m.parent);
      for (const gl of wineGlasses) {
        let p = gl, onCam = false; while (p) { if (p.isCamera) onCam = true; p = p.parent; }
        if (onCam) { const his = gl.clone(true); his.position.set(NS.x - 0.08, NS_TOP, NS.z - 0.12); his.rotation.set(0, 0, 0); his.scale.setScalar(1); his.name = 'his glass (on the nightstand)'; c.scene.add(his); c.tag(his, 'Frag3Only'); }
        else c.tag(gl, 'Frag3Only');
      }
      // window casement: open in frag 3
      const hinges = c.findAll((o) => o.isGroup && o.parent === c.scene && o.children.length === 1 && o.children[0].isGroup && o.children[0].children.some((m) => m.isMesh && m.material.opacity < 0.2));
      for (const h of hinges) if (Math.abs(h.rotation.y) > 0.1) {
        c.tag(h, 'Frag3Only');
        const closed = h.clone(true); closed.rotation.y = 0; c.scene.add(closed); c.tag(closed, 'Frag12Only');
      }
      c.scene.updateMatrixWorld(true);
    },
    async markers(c) {
      const T = c.THREE, M = [];
      const BED_X = -0.55, herX = BED_X + 0.42, NS = new T.Vector3(0.55, 0, -2.25), NS_TOP = 0.70;
      M.push({ tag: 'PlayerStart', spawn: 'default', position: [1.0, 0, 1.95], yaw: 0.22, pitch: 0.12, note: 'frag 1 entry at the door' });
      const headF3 = new T.Vector3(herX, 1.12, -2.22), headF1 = new T.Vector3(herX + 0.03, 0.66, -2.22);
      const bedside = new T.Vector3(0.78, 0, -1.5);
      const yawTo = (from, to, eye = 1.62) => { const d = to.clone().sub(new T.Vector3(from.x, eye, from.z)); return [Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.hypot(d.x, d.z))]; };
      { const [y, p] = yawTo(bedside, headF1); M.push({ tag: 'PlayerStart', spawn: 'bedside', position: v3(bedside), yaw: r5(y), pitch: r5(p), note: 'frag 2 start (BEDSIDE), looking at her head' }); }
      { const b3 = bedside.clone().add(new T.Vector3(0, 0, 0.15)); const [y, p] = yawTo(b3, headF3); M.push({ tag: 'PlayerStart', spawn: 'bedside3', position: v3(b3), yaw: r5(y), pitch: r5(p - 0.05), note: 'frag 3 start' }); }
      // her: frag 1/2 lying (layDown(herA, herX, 0.32)): rotation XYZ (-π/2, 0.32, 0), feet at (herX, 0.6, -0.70)
      const lie = new T.Object3D(); lie.rotation.order = 'XYZ'; lie.rotation.set(-Math.PI / 2, 0.32, 0); lie.position.set(herX, 0.6, -2.36 + 1.66);
      M.push(c.figureMarker('HerBed', lie, { euler: [-Math.PI / 2, 0.32, 0, 'XYZ'], note: 'frags 1/2: lying, feet at the group origin, head toward the headboard (−Z), rolled 0.32 toward the player' }));
      const hers = c.findAll((o) => o.isPoints && o.material?.uniforms?.uDissolve).map((p) => p.parent.parent);
      for (const h of hers) {
        if (h.visible) M.push(c.figureMarker('HerSitFrag3', h, { note: 'frag 3: sitting up against the headboard (sitUp)' }));
        else M.push(c.figureMarker('HerBedFrag3', h, { note: 'frag 3 after the fade: lying close (layDown(herB, herX-0.05, -0.55))' }));
      }
      M.push({ tag: 'HerHead', position: v3(headF1), note: 'frags 1/2 head (capsule / talk target)' });
      const bowl = c.modelsNamed('wooden_bowl_01')[0];
      M.push({ tag: 'I_cherries', position: bowl ? v3(bowl.getWorldPosition(new T.Vector3())) : [NS.x + 0.1, NS_TOP, NS.z + 0.04], radius: 0.14 });
      M.push({ tag: 'I_bedGive', position: v3(headF3), radius: 0.35, note: 'her head in frag 3 (give the cherry)' });
      // post-fade lying view (camA in frag3)
      const pv = new T.Vector3(herX - 0.5, 0.92, -1.72), pt = new T.Vector3(herX - 0.02, 0.72, -2.2), d = pt.clone().sub(pv);
      M.push({ tag: 'PillowView', position: v3(pv), yaw: r5(Math.atan2(-d.x, -d.z)), pitch: r5(Math.atan2(d.y, Math.hypot(d.x, d.z))), roll: 0.14, lookAt: v3(pt), note: 'camera position (not feet)' });
      M.push({ tag: 'BedsideView', position: [0.12, 1.0, -1.82], lookAt: [NS.x - 0.1, NS_TOP + 0.02, NS.z + 0.12], roll: 0.05, note: 'frag 3: camB looking at the empty bottle' });
      M.push(c.shotYP('shot_entry', [1.0, 1.62, 1.95], 0.22, 0.12, 4));
      M.push(c.shotAt('shot_candles', [0.05, 1.3, -0.85], [0.75, 0.9, -2.38]));
      M.push(c.shotAt('shot_pillow', v3(pv), v3(pt)));
      return M;
    },
  },
};
window.SFDUMP = { run, LEVELS };
