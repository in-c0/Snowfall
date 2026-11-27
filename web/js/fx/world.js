// Shared world builders: displaced terrain, instanced forests, simple props.
import * as THREE from 'three';
import { makeTree, rng } from './foliage.js';
import { pbr, setRepeat, snowCover } from '../assets.js';

// value-noise helpers (CPU)
function h2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
export function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export function fbm(x, y, o = 4) { let s = 0, a = 0.5; for (let i = 0; i < o; i++) { s += a * vnoise(x, y); x *= 2.03; y *= 2.03; a *= 0.5; } return s; }

// Terrain mesh centred at (cx, cz), w x l metres, heightFn(x,z) in world space.
export function terrain({ w = 160, l = 400, cx = 0, cz = 0, segW = 128, segL = 320, heightFn = () => 0, material }) {
  const g = new THREE.PlaneGeometry(w, l, segW, segL);
  g.rotateX(-Math.PI / 2);
  g.translate(cx, 0, cz);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, heightFn(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  return m;
}

// Instanced forest: builds `variants` procedural trees, then instances them at `spots` [{x,z,s,r}].
// Spots are bucketed into chunks along z so far chunks can be hidden (forest.cull(cameraZ, range)).
export function forest({ spots, variants = 4, seed = 11, tree = {}, barkMat, snow = null, twigColor = 0x2b2622, heightFn = () => 0, chunk = 30 }) {
  const group = new THREE.Group();
  const R = rng(seed);
  const protos = [];
  for (let v = 0; v < variants; v++) protos.push(makeTree({ seed: seed * 31 + v * 7, barkMat, twigColor, ...tree }));
  if (snow) snowCover(barkMat, snow);
  const chunks = new Map();
  spots.forEach((s, i) => {
    const ck = Math.floor(s.z / chunk);
    if (!chunks.has(ck)) chunks.set(ck, protos.map(() => []));
    chunks.get(ck)[s.v ?? (i % variants)].push(s);
  });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  let tris = 0;
  for (const [ck, buckets] of chunks) {
    const cg = new THREE.Group(); cg.userData.zc = (ck + 0.5) * chunk;
    protos.forEach((proto, v) => {
      const list = buckets[v]; if (!list.length) return;
      proto.children.forEach((child) => {
        const im = new THREE.InstancedMesh(child.geometry, child.material, list.length);
        list.forEach((s, i) => {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.r ?? R() * 6.28);
          if (s.tilt) q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(s.tilt[0], 0, s.tilt[1])));
          const k = s.s ?? 1; sc.set(k, k, k);
          p.set(s.x, heightFn(s.x, s.z) + (s.y ?? 0), s.z);
          m4.compose(p, q, sc); im.setMatrixAt(i, m4);
        });
        im.castShadow = true; im.receiveShadow = true;
        im.computeBoundingSphere();
        tris += (child.geometry.index ? child.geometry.index.count : child.geometry.attributes.position.count) / 3 * list.length;
        cg.add(im);
      });
    });
    group.add(cg);
  }
  group.userData.tris = tris;
  group.userData.protoTris = protos.map(pr => pr.children.map(c => (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3));
  group.cull = (z, range = 90) => { for (const c of group.children) c.visible = Math.abs(c.userData.zc - z) < range; };
  return group;
}

export function snowMaterial({ sparkle = 0.6, relief = 1.0, color = 0xf4f6fa } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, envMapIntensity: 1.0 });
  const U = { uSparkle: { value: sparkle }, uRelief: { value: relief } };
  m.userData.snowU = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vSW = (modelMatrix*vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vSW; uniform float uSparkle; uniform float uRelief;
      float sh_h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float sh_n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f); return mix(mix(sh_h(i),sh_h(i+vec2(1,0)),u.x),mix(sh_h(i+vec2(0,1)),sh_h(i+vec2(1,1)),u.x),u.y); }
      float sh_f(vec2 p){ return sh_n(p*0.9)*0.55 + sh_n(p*3.1+7.0)*0.25 + sh_n(p*11.0+3.0)*0.12 + sh_n(p*37.0)*0.05; }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float snH = sh_f(vSW.xz);
      {
        float e = 0.03;
        vec2 g = vec2(sh_f(vSW.xz+vec2(e,0.0))-snH, sh_f(vSW.xz+vec2(0.0,e))-snH)/e;
        vec3 pert = (viewMatrix*vec4(-g.x, 0.0, -g.y, 0.0)).xyz * 0.12 * uRelief;
        normal = normalize(normal + pert);
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      { float hn = sh_f(vSW.xz*0.5); diffuseColor.rgb *= mix(vec3(0.86,0.9,0.98), vec3(1.0), smoothstep(0.2,0.7,hn)); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec2 cell = floor(vSW.xz*90.0);
        float r = sh_h(cell + floor(cameraPosition.xz*4.0)*0.37);
        float sp = step(0.9965, r) * uSparkle;
        float facing = max(dot(normal, normalize(vViewPosition)*-1.0 + vec3(0.0)), 0.0);
        float dist = length(vViewPosition);
        totalEmissiveRadiance += vec3(1.0,0.98,0.95) * sp * 2.5 * smoothstep(14.0, 2.0, dist);
      }`);
  };
  m.customProgramCacheKey = () => 'proc-snow';
  return m;
}

// procedural glass (lathe) for wine glasses
export function wineGlass({ wine = 0.5 } = {}) {
  const pts = [[0, 0], [0.034, 0], [0.036, 0.003], [0.006, 0.008], [0.004, 0.012], [0.004, 0.085], [0.008, 0.092], [0.03, 0.105], [0.042, 0.13], [0.043, 0.16], [0.039, 0.19], [0.038, 0.192]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 32);
  const glass = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.32, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 3.0, depthWrite: false, side: THREE.DoubleSide }));
  const grp = new THREE.Group(); grp.add(glass);
  if (wine > 0) {
    const wp = [[0, 0.097], [0.024, 0.104], [0.036, 0.122], [0.038, 0.097 + 0.06 * wine], [0, 0.097 + 0.06 * wine]].map(([x, y]) => new THREE.Vector2(x, y));
    const wm = new THREE.Mesh(new THREE.LatheGeometry(wp, 24), new THREE.MeshPhysicalMaterial({ color: 0x4a0410, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.5 }));
    grp.add(wm); grp.userData.wine = wm;
  }
  grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return grp;
}

// Red stain that spreads through snow and is slowly covered again.
export function stainDecal(size = 1.6) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uGrow: { value: 0 }, uCover: { value: 0 }, uTime: { value: 0 } }]),
    vertexShader: '#include <fog_pars_vertex>\nvarying vec2 vUv; void main(){ vUv=uv; vec4 mvPosition = modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mvPosition; \n#include <fog_vertex>\n }',
    fragmentShader: `#include <fog_pars_fragment>
      uniform float uGrow; uniform float uCover; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.1; a*=0.5;} return s; }
      void main(){
        vec2 c = vUv-0.5; c.x *= 1.0; c.y = c.y*1.6 + 0.12; // elongated downhill
        float r = length(c)*2.0;
        float edge = uGrow*(0.75 + fbm(vUv*5.0)*0.6) ;
        float m = smoothstep(edge, edge-0.12, r);
        float core = smoothstep(edge*0.8, 0.0, r);
        float speck = step(0.78, fbm(vUv*28.0)) * smoothstep(edge*1.35, edge*0.9, r);
        m = max(m, speck*0.8);
        vec3 col = mix(vec3(0.34,0.03,0.07), vec3(0.16,0.01,0.03), core);
        // soaked edge is lighter (wine diluted in snow)
        col = mix(col, vec3(0.6,0.22,0.3), smoothstep(0.6,1.0, r/max(edge,0.001))*0.55);
        float cov = smoothstep(0.0,1.0, uCover + (fbm(vUv*14.0)-0.5)*0.6);
        float a = m*(1.0-cov)*0.92;
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }`,
  });
  const g = new THREE.PlaneGeometry(size, size); g.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 2;
  return mesh;
}

// Soft contact shadow (ambient occlusion blob) to ground objects on snow/floors.
export function contactShadow(w = 1, d = 1, strength = 0.55) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, `rgba(0,0,0,${strength})`); gr.addColorStop(0.55, `rgba(0,0,0,${strength * 0.45})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 1;
  return m;
}
// Put an object's lowest point on the ground at (x, z).
export function ground(obj, x, z, heightFn = () => 0, sink = 0) {
  obj.position.set(x, 0, z); obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  obj.position.y = heightFn(x, z) - b.min.y - sink;
  return obj;
}
