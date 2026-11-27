// GPU snowfall: instanced billboards wrapped in a box around the camera, with wind, turbulence and motion streaks.
import * as THREE from 'three';
import { SOFT, SOFT_GLSL } from '../post.js';

const VS = /* glsl */`
attribute vec4 aSeed;
uniform vec3 uOffset; uniform vec3 uCam; uniform vec3 uBox; uniform float uTime; uniform float uSize; uniform float uTurb;
uniform vec3 uVel; uniform float uStreak; uniform float uNearFade; uniform float uFogDensity; uniform float uTimeScale;
varying vec2 vUv; varying float vAlpha; varying float vBlur; varying float vDepth;
void main(){
  vec3 p = aSeed.xyz * uBox;
  float spd = 0.65 + 0.7*aSeed.w;
  p += uOffset * spd;
  float t = uTime;
  p.x += sin(t*1.3*(0.5+aSeed.w) + aSeed.y*40.0) * uTurb * (0.6+aSeed.z);
  p.z += cos(t*1.1*(0.5+aSeed.x) + aSeed.x*30.0) * uTurb * (0.6+aSeed.y);
  p.y += sin(t*0.7 + aSeed.z*20.0) * uTurb*0.3;
  // wrap into box centred on camera
  p = mod(p - uCam + uBox*0.5, uBox) - uBox*0.5 + uCam;
  vec4 mv = viewMatrix * vec4(p,1.0);
  float depth = -mv.z;
  // screen-space velocity for streaks
  vec3 vv = (viewMatrix * vec4(uVel*spd,0.0)).xyz;
  vec2 dir = vv.xy; float dl = length(dir);
  dir = dl>1e-4 ? dir/dl : vec2(0.0,1.0);
  vec2 perp = vec2(dir.y, -dir.x);
  float size = uSize * (0.45 + aSeed.w*0.9);
  // near flakes get big and soft (out of focus)
  float nearB = smoothstep(2.2, 0.25, depth);
  size *= 1.0 + nearB*3.5;
  float stretch = 1.0 + uStreak * dl * 0.06 / max(depth*0.15,0.2) * uTimeScale;
  vec2 corner = position.xy;
  vec2 off = perp*corner.x*size + dir*corner.y*size*stretch;
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy;
  float fog = exp(-uFogDensity*uFogDensity*depth*depth);
  vAlpha = mix(1.0, 0.25, nearB) * smoothstep(0.08, uNearFade, depth) * (0.35 + 0.65*fog) / mix(1.0, stretch, 0.5);
  vBlur = nearB; vDepth = depth;
}`;
const FS = /* glsl */`
uniform vec3 uColor; uniform float uOpacity;
varying vec2 vUv; varying float vAlpha; varying float vBlur; varying float vDepth;
${SOFT_GLSL}
void main(){
  float r = length(vUv);
  float a = smoothstep(1.0, mix(0.15, 0.0, vBlur), r);
  a *= vAlpha * uOpacity * softFade(vDepth, 0.3);
  if(a < 0.003) discard;
  vec3 col = uColor * mix(0.78, 1.0, smoothstep(0.7, 0.0, r));
  gl_FragColor = vec4(col * a, a);
}`;

export class Snow {
  constructor({ count = 12000, box = [36, 22, 36], size = 0.02, color = 0xffffff, intensity = 1.6, wind = [0.6, -1.1, 0.2], turb = 0.25, streak = 1, opacity = 0.9, fogDensity = 0.02, nearFade = 0.35 } = {}) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i++) seeds[i] = Math.random();
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = count;
    this.maxCount = count;
    this.uniforms = {
      uOffset: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...box) },
      uTime: { value: 0 }, uSize: { value: size }, uTurb: { value: turb }, uVel: { value: new THREE.Vector3(...wind) },
      uStreak: { value: streak }, uColor: { value: new THREE.Color(color).multiplyScalar(intensity) }, uOpacity: { value: opacity },
      uNearFade: { value: nearFade }, uFogDensity: { value: fogDensity }, uTimeScale: { value: 1 }, ...SOFT,
    };
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: this.uniforms, side: THREE.DoubleSide, transparent: true, depthWrite: false, depthTest: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.layers.set(1);
    this.wind = new THREE.Vector3(...wind);
    this.timeScale = 1;
    this.t = 0;
    this.gust = 0;
  }
  set density(f) { this.mesh.geometry.instanceCount = Math.floor(this.maxCount * THREE.MathUtils.clamp(f, 0, 1)); }
  update(dt, cam) {
    const ts = this.timeScale;
    this.t += dt * ts;
    const U = this.uniforms;
    // gusts
    this.gust = 0.7 + 0.3 * Math.sin(this.t * 0.31) + 0.25 * Math.sin(this.t * 0.87 + 1.3);
    const w = this.wind;
    U.uOffset.value.x += w.x * this.gust * dt * ts;
    U.uOffset.value.y += w.y * dt * ts;
    U.uOffset.value.z += w.z * this.gust * dt * ts;
    U.uVel.value.set(w.x * this.gust, w.y, w.z * this.gust);
    U.uCam.value.copy(cam.position);
    U.uTime.value = this.t;
    U.uTimeScale.value = ts;
  }
}

// Drifting fog/snow-curtain cards: large camera-facing quads with animated fbm, depth-faded.
const FOG_VS = /* glsl */`
attribute vec4 aSeed;
uniform vec3 uCam; uniform float uTime; uniform vec3 uBox; uniform vec3 uDrift; uniform float uSize;
varying vec2 vUv; varying float vSeed; varying float vDepth;
void main(){
  vec3 p = aSeed.xyz*uBox + uDrift*uTime*(0.5+aSeed.w);
  p = mod(p - uCam + uBox*0.5, uBox) - uBox*0.5 + uCam;
  p.y = uCam.y - 1.5 + aSeed.y*uBox.y*0.5;
  vec4 mv = viewMatrix*vec4(p,1.0);
  float s = uSize*(0.6+aSeed.w*0.8);
  mv.xy += position.xy*s;
  gl_Position = projectionMatrix*mv;
  vUv = position.xy*0.5+0.5; vSeed = aSeed.w*17.0; vDepth = -mv.z;
}`;
const FOG_FS = /* glsl */`
uniform float uTime; uniform vec3 uColor; uniform float uOpacity; uniform float uNear;
varying vec2 vUv; varying float vSeed; varying float vDepth;
${SOFT_GLSL}
float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
void main(){
  vec2 c = vUv-0.5;
  float r = length(c)*2.0;
  float f = fbm(vUv*2.5 + vec2(vSeed, uTime*0.05) + fbm(vUv*3.0 - uTime*0.03)*1.2);
  float a = smoothstep(1.0, 0.2, r) * smoothstep(0.35, 0.8, f);
  a *= smoothstep(uNear, uNear*3.0, vDepth) * uOpacity * softFade(vDepth, 6.0);
  gl_FragColor = vec4(uColor*a, a);
}`;
export class FogCards {
  constructor({ count = 60, box = [80, 10, 80], size = 14, color = 0xcfd4da, intensity = 1.0, opacity = 0.35, drift = [1.2, 0, 0.3], near = 2.0 } = {}) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i++) seeds[i] = Math.random();
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = count;
    this.uniforms = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBox: { value: new THREE.Vector3(...box) }, uDrift: { value: new THREE.Vector3(...drift) }, uSize: { value: size }, uColor: { value: new THREE.Color(color).multiplyScalar(intensity) }, uOpacity: { value: opacity }, uNear: { value: near }, ...SOFT };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: FOG_VS, fragmentShader: FOG_FS, uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.layers.set(1);
    this.t = 0; this.timeScale = 1;
  }
  update(dt, cam) { this.t += dt * this.timeScale; this.uniforms.uTime.value = this.t; this.uniforms.uCam.value.copy(cam.position); }
}
