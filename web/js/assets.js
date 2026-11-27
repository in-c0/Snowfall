// Asset loading: glTF (meshopt), PBR texture sets, HDR environments, plus material patches.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { E } from './engine.js';

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();
const rgbe = new RGBELoader();
const cache = new Map();
let pmrem = null;

function once(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }

export function loadGLTF(name, dir = 'models') {
  return once('g:' + dir + name, () => new Promise((res, rej) => gltfLoader.load(`assets/${dir}/${name}.glb`, (g) => {
    g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    res(g);
  }, undefined, rej)));
}
// returns a fresh clone of a model's scene, normalised so its base sits at y=0
export async function model(name, { scale = 1, shadows = true } = {}) {
  const g = await loadGLTF(name);
  const o = g.scene.clone(true);
  o.scale.setScalar(scale);
  o.traverse((m) => { if (m.isMesh) { m.castShadow = shadows; m.receiveShadow = true; } });
  return o;
}
export async function character(name) {
  const g = await loadGLTF(name, 'chars');
  const o = SkeletonUtils.clone(g.scene);
  return { root: o, clips: g.animations };
}

export function tex(file, { repeat = 1, srgb = false, aniso = 8 } = {}) {
  const key = `t:${file}:${repeat}:${srgb}`;
  return once(key, () => {
    const t = texLoader.load(`assets/tex/${file}.webp`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = Math.min(aniso, E.renderer.capabilities.getMaxAnisotropy());
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}
// Poly Haven set: <name>_diff / _nor / _arm (AO, Rough, Metal packed in R,G,B — exactly three's convention)
export function pbr(name, { repeat = 1, color = 0xffffff, normalScale = 1, rough = 1, metal = 1, envI = 1 } = {}) {
  const arm = tex(`${name}_arm`, { repeat });
  const m = new THREE.MeshStandardMaterial({
    map: tex(`${name}_diff`, { repeat, srgb: true }),
    normalMap: tex(`${name}_nor`, { repeat }),
    aoMap: arm, roughnessMap: arm, metalnessMap: arm,
    color, roughness: rough, metalness: metal, envMapIntensity: envI,
  });
  m.normalScale.set(normalScale, normalScale);
  return m;
}
export function setRepeat(mat, rx, ry = rx) {
  for (const k of ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap']) {
    if (mat[k]) { mat[k] = mat[k].clone(); mat[k].needsUpdate = true; mat[k].repeat.set(rx, ry); }
  }
  return mat;
}

export function hdri(name) {
  return once('h:' + name, () => new Promise((res, rej) => rgbe.load(`assets/hdri/${name}_1k.hdr`, (t) => {
    pmrem ??= new THREE.PMREMGenerator(E.renderer);
    const env = pmrem.fromEquirectangular(t).texture;
    t.mapping = THREE.EquirectangularReflectionMapping;
    res({ env, bg: t });
  }, undefined, rej)));
}

// ---- material patches ----
// Snow accumulation on upward faces (world-space), with noisy edge. amount 0..1 via uniform.
export function snowCover(mat, uniforms) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    sh.uniforms.uSnowAmt = uniforms.amount;
    sh.uniforms.uSnowDir = uniforms.dir || { value: new THREE.Vector3(0, 0, 0) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnowW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vSnowW = (modelMatrix * vec4(transformed,1.0)).xyz;\n #ifdef USE_INSTANCING\n vSnowW = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;\n #endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uSnowAmt; uniform vec3 uSnowDir; varying vec3 vSnowW;
      float sn_h(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
      float sn_n(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(sn_h(i),sn_h(i+vec3(1,0,0)),f.x),mix(sn_h(i+vec3(0,1,0)),sn_h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(sn_h(i+vec3(0,0,1)),sn_h(i+vec3(1,0,1)),f.x),mix(sn_h(i+vec3(0,1,1)),sn_h(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        vec3 wn = normalize((vec4(normal,0.0)*viewMatrix).xyz);
        float nz = sn_n(vSnowW*6.0)*0.5 + sn_n(vSnowW*23.0)*0.25;
        float m = smoothstep(0.35, 0.75, wn.y + (nz-0.4)*0.6);
        // wind-driven snow plastered on the windward side
        m = max(m, smoothstep(0.25, 0.7, dot(wn, uSnowDir) + (nz-0.45)*0.8) * length(uSnowDir));
        m *= uSnowAmt;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86,0.88,0.92), m);
        roughnessFactor = mix(roughnessFactor, 0.85, m);
        metalnessFactor = mix(metalnessFactor, 0.0, m);
        normal = normalize(mix(normal, (viewMatrix*vec4(0.0,1.0,0.0,0.0)).xyz, m*0.7));
      }`);
  };
  mat.needsUpdate = true;
  return mat;
}
// Make every material of an object a dark, rough silhouette material (keeps skinning).
export function silhouette(obj, color = 0x0c0d10, rough = 0.95) {
  const mats = new Map();
  obj.traverse((m) => {
    if (m.isMesh || m.isSkinnedMesh) {
      const k = m.material.uuid;
      if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 }));
      m.material = mats.get(k);
      m.castShadow = true;
    }
  });
  return obj;
}
export function applySnowToObject(obj, uniforms) {
  obj.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); snowCover(m.material, uniforms); } });
}
export function bbox(obj) { return new THREE.Box3().setFromObject(obj); }

// Warm the cache for a later scene (network + decode only; scene building happens behind a fade).
export function prefetch({ models = [], textures = [], hdris = [] } = {}) {
  const jobs = [];
  for (const m of models) jobs.push(loadGLTF(m).catch(() => {}));
  for (const h of hdris) jobs.push(hdri(h).catch(() => {}));
  for (const t of textures) tex(t);
  return Promise.all(jobs);
}
