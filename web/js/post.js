// Post-processing: HDR scene -> mip chain (bloom + DOF source) -> god rays -> composite (tonemap, grade, lens).
import * as THREE from 'three';

const VS = /* glsl */`
varying vec2 vUv;
void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.0,1.0); }`;

function fsMat(fs, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra });
}

const DOWN_FS = /* glsl */`
precision highp float;
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uFirst;
varying vec2 vUv;
vec3 s(vec2 o){ return texture2D(tSrc, vUv + o*uTexel).rgb; }
float karis(vec3 c){ return 1.0/(1.0+dot(c,vec3(0.2126,0.7152,0.0722))); }
void main(){
  vec3 a=s(vec2(-2,2)), b=s(vec2(0,2)), c=s(vec2(2,2));
  vec3 d=s(vec2(-2,0)), e=s(vec2(0,0)), f=s(vec2(2,0));
  vec3 g=s(vec2(-2,-2)), h=s(vec2(0,-2)), i=s(vec2(2,-2));
  vec3 j=s(vec2(-1,1)), k=s(vec2(1,1)), l=s(vec2(-1,-1)), m=s(vec2(1,-1));
  vec3 r;
  if(uFirst>0.5){
    // Karis average on first downsample to kill fireflies
    vec3 g0=(a+b+d+e)*0.25, g1=(b+c+e+f)*0.25, g2=(d+e+g+h)*0.25, g3=(e+f+h+i)*0.25, g4=(j+k+l+m)*0.25;
    float w0=karis(g0),w1=karis(g1),w2=karis(g2),w3=karis(g3),w4=karis(g4);
    r=(g0*w0*0.125+g1*w1*0.125+g2*w2*0.125+g3*w3*0.125+g4*w4*0.5)/(w0*0.125+w1*0.125+w2*0.125+w3*0.125+w4*0.5);
  } else {
    r = e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125;
  }
  gl_FragColor = vec4(max(r,vec3(0.0)),1.0);
}`;

const UP_FS = /* glsl */`
precision highp float;
uniform sampler2D tSrc; uniform sampler2D tPrev; uniform vec2 uTexel; uniform float uRadius;
varying vec2 vUv;
void main(){
  vec2 t = uTexel*uRadius;
  vec3 c = texture2D(tSrc, vUv+vec2(-t.x, t.y)).rgb + texture2D(tSrc, vUv+vec2(0.0, t.y)).rgb*2.0 + texture2D(tSrc, vUv+vec2(t.x, t.y)).rgb
         + texture2D(tSrc, vUv+vec2(-t.x,0.0)).rgb*2.0 + texture2D(tSrc, vUv).rgb*4.0 + texture2D(tSrc, vUv+vec2(t.x,0.0)).rgb*2.0
         + texture2D(tSrc, vUv+vec2(-t.x,-t.y)).rgb + texture2D(tSrc, vUv+vec2(0.0,-t.y)).rgb*2.0 + texture2D(tSrc, vUv+vec2(t.x,-t.y)).rgb;
  c /= 16.0;
  gl_FragColor = vec4(texture2D(tPrev, vUv).rgb + c, 1.0);
}`;

const RAYS_FS = /* glsl */`
precision highp float;
uniform sampler2D tSrc; uniform sampler2D tDepth; uniform vec2 uLight; uniform float uThreshold; uniform float uDecay; uniform float uLen; uniform float uSky;
varying vec2 vUv;
float lum(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec2 dir = (uLight - vUv);
  float dist = length(dir);
  vec2 stepv = dir * uLen / 48.0;
  vec2 uv = vUv + stepv*hash(vUv*1000.0);
  vec3 acc = vec3(0.0); float w = 1.0; float tot=0.0;
  for(int i=0;i<48;i++){
    vec3 c = texture2D(tSrc, uv).rgb;
    float d = texture2D(tDepth, uv).r;
    float sky = step(0.9999, d) * uSky;
    float m = max(lum(c) - uThreshold, 0.0) + sky*lum(c)*0.5;
    acc += c * m * w; tot += w;
    w *= uDecay;
    uv += stepv;
  }
  gl_FragColor = vec4(acc/tot, 1.0);
}`;

const LINDEPTH_FS = /* glsl */`
precision highp float;
uniform sampler2D tDepth; uniform float uNear; uniform float uFar;
varying vec2 vUv;
void main(){ float d = texture2D(tDepth, vUv).r; float z = d*2.0-1.0; float l = (2.0*uNear*uFar)/(uFar+uNear - z*(uFar-uNear)); gl_FragColor = vec4(d>=0.99999 ? 1e4 : l, 0.0, 0.0, 1.0); }`;

// Shared uniforms for soft particles (layer 1 objects sample the opaque scene's linear depth)
export const SOFT = { tSoftDepth: { value: null }, uSoftRes: { value: new THREE.Vector2(1, 1) } };
export const SOFT_GLSL = `
uniform sampler2D tSoftDepth; uniform vec2 uSoftRes;
float softFade(float myDepth, float range){ float sd = texture2D(tSoftDepth, gl_FragCoord.xy/uSoftRes).r; return clamp((sd - myDepth)/range, 0.0, 1.0); }
`;

const DOF_FS = /* glsl */`
precision highp float;
uniform sampler2D tScene; uniform sampler2D tDepth; uniform sampler2D tBlur1; uniform sampler2D tBlur2;
uniform float uNear; uniform float uFar; uniform float uFocus; uniform float uFocusRange; uniform float uDof; uniform float uDofNear;
varying vec2 vUv;
float linDepth(float d){ float z = d*2.0-1.0; return (2.0*uNear*uFar)/(uFar+uNear - z*(uFar-uNear)); }
void main(){
  vec3 col = texture2D(tScene, vUv).rgb;
  float d = texture2D(tDepth, vUv).r;
  float z = linDepth(d);
  float coc = clamp((abs(z - uFocus) - uFocusRange)/max(uFocus*1.5,0.5), 0.0, 1.0) * uDof;
  coc = max(coc, clamp((uFocus - z)/max(uFocus,0.01),0.0,1.0)*uDofNear);
  if(d >= 0.99999) coc = uDof;
  if(coc > 0.001){
    vec3 b1 = texture2D(tBlur1, vUv).rgb;
    vec3 b2 = texture2D(tBlur2, vUv).rgb;
    col = mix(col, mix(b1, b2, smoothstep(0.4,1.0,coc)), smoothstep(0.0,0.6,coc));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const COMP_FS = /* glsl */`
precision highp float;
uniform sampler2D tScene; uniform sampler2D tDepth; uniform sampler2D tBloom; uniform sampler2D tBlur1; uniform sampler2D tBlur2; uniform sampler2D tRays;
uniform vec2 uRes; uniform float uTime; uniform float uNear; uniform float uFar;
uniform float uExposure; uniform float uBloom; uniform float uRaysAmt; uniform vec3 uRaysTint;
uniform float uFocus; uniform float uFocusRange; uniform float uDof; uniform float uDofNear;
uniform vec3 uLift; uniform vec3 uGamma; uniform vec3 uGain; uniform float uSat; uniform float uContrast; uniform vec3 uTint;
uniform float uVignette; uniform float uCA; uniform float uGrain; uniform float uBright;
uniform vec3 uFadeColor; uniform float uFade; uniform float uWarp; uniform float uCollapse; uniform float uLetterbox; uniform float uGlitch;
uniform float uHalation; uniform float uDesat;
varying vec2 vUv;

float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
float linDepth(float d){ float z = d*2.0-1.0; return (2.0*uNear*uFar)/(uFar+uNear - z*(uFar-uNear)); }
vec3 agx(vec3 v){
  // AgX-ish filmic curve (approximation) — soft shoulder, gentle desaturation of highlights
  const mat3 inm = mat3(0.842479,0.0423282,0.0423756, 0.0784336,0.878468,0.0784336, 0.0792237,0.0791661,0.879142);
  const mat3 outm = mat3(1.19687,-0.0528968,-0.0529716, -0.0980209,1.15190,-0.0980435, -0.0990297,-0.0989612,1.15107);
  v = inm * v;
  v = clamp(log2(max(v,1e-10)), -12.47393, 4.026069);
  v = (v + 12.47393) / 16.49999;
  vec3 x2=v*v, x4=x2*x2;
  v = 15.5*x4*x2 - 40.14*x4*v + 31.96*x4 - 6.868*x2*v + 0.4298*x2 + 0.1191*v - 0.00232;
  v = outm * v;
  return clamp(v, 0.0, 1.0); // display-encoded output (we write straight to the canvas)
}
vec3 sampleScene(vec2 uv){
  vec2 c = uv - 0.5;
  float ca = uCA * 0.03 * dot(c,c);
  vec3 col;
  col.r = texture2D(tScene, uv - c*ca).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv + c*ca).b;
  return col;
}
void main(){
  vec2 uv = vUv;
  // glitch: horizontal tearing bands
  if(uGlitch>0.0){
    float band = floor(uv.y*28.0 + floor(uTime*24.0)*3.1);
    float r = hash(vec2(band, floor(uTime*24.0)));
    if(r > 1.0-uGlitch*0.5) uv.x += (hash(vec2(band,1.7))-0.5)*0.08*uGlitch;
  }
  // collapse (old TV off): squeeze vertically into a line
  if(uCollapse>0.0){
    float sy = mix(1.0, 0.004, smoothstep(0.0,0.7,uCollapse));
    float sx = mix(1.0, 0.0, smoothstep(0.65,1.0,uCollapse));
    uv = (uv-0.5)/vec2(max(sx,1e-4), sy) + 0.5;
  }
  // warp: radial zoom blur toward centre
  vec3 col;
  if(uWarp>0.0){
    vec3 acc=vec3(0.0); float tw=0.0;
    float jit = hash(vUv*uRes + fract(uTime)*91.0);
    for(int i=0;i<16;i++){
      float t = (float(i)+jit)/16.0;
      vec2 suv = mix(uv, vec2(0.5), t*uWarp*0.35);
      float w = 1.0 - t*0.5;
      acc += texture2D(tScene, suv).rgb*w; tw+=w;
    }
    col = acc/tw;
  } else {
    col = sampleScene(uv);
  }
  // bloom + halation
  vec3 bl = texture2D(tBloom, uv).rgb;
  col = mix(col, bl, uBloom);
  col += bl * vec3(1.0,0.35,0.15) * uHalation;
  // god rays
  col += texture2D(tRays, uv).rgb * uRaysTint * uRaysAmt;
  // exposure + tonemap
  col *= uExposure * uBright;
  col = agx(col);
  // grade (lift/gamma/gain, sat, contrast, tint)
  col = pow(max(col*uGain + uLift*(1.0-col), 0.0), 1.0/uGamma);
  float l = dot(col, vec3(0.2126,0.7152,0.0722));
  col = mix(vec3(l), col, uSat * (1.0-uDesat));
  col = (col-0.5)*uContrast + 0.5;
  col *= uTint;
  // vignette
  vec2 vc = vUv-0.5; vc.x *= uRes.x/uRes.y;
  col *= mix(1.0, smoothstep(1.15, 0.25, length(vc)), uVignette);
  // grain (luma-weighted, animated)
  float g = hash(vUv*uRes + fract(uTime*7.13)*100.0) - 0.5;
  col += g * uGrain * (0.35 + 0.65*(1.0-l));
  // collapse bright line
  if(uCollapse>0.0){
    float edge = step(0.0, uv.x)*step(uv.x,1.0)*step(0.0,uv.y)*step(uv.y,1.0);
    col *= edge;
    col += vec3(0.9,0.95,1.0) * smoothstep(0.55,0.75,uCollapse)*(1.0-smoothstep(0.85,1.0,uCollapse)) * exp(-abs(vUv.y-0.5)*400.0) * smoothstep(0.5,0.0,abs(vUv.x-0.5)*(1.0+uCollapse*2.0));
  }
  // letterbox
  float lb = uLetterbox*0.12;
  if(vUv.y < lb || vUv.y > 1.0-lb) col = vec3(0.0);
  // fade
  col = mix(col, uFadeColor, clamp(uFade,0.0,1.0));
  // dither
  col += (hash(vUv*uRes+3.1)-0.5)/255.0;
  gl_FragColor = vec4(clamp(col,0.0,1.0), 1.0);
}`;

export const DEFAULT_LOOK = {
  exposure: 1.0, bloom: 0.06, halation: 0.0,
  focus: 8, focusRange: 6, dof: 0.0, dofNear: 0.0,
  lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], sat: 1.0, contrast: 1.0, tint: [1, 1, 1],
  vignette: 0.35, ca: 0.0, grain: 0.035,
  rays: 0.0, raysTint: [1, 1, 1], raysThreshold: 0.8, raysDecay: 0.96, raysLen: 0.9, raysSky: 1.0, raysLight: [0.5, 0.8],
};

export class Post {
  constructor(renderer) {
    this.r = renderer;
    this.look = structuredClone(DEFAULT_LOOK);
    this.target = structuredClone(DEFAULT_LOOK);
    this.lookSpeed = 1.5;
    this.fx = { fade: 1, fadeColor: new THREE.Color(0, 0, 0), warp: 0, collapse: 0, letterbox: 0, glitch: 0, bright: 1, desat: 0 };
    this.quad = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)));
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene(); this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.downMat = fsMat(DOWN_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 } });
    this.upMat = fsMat(UP_FS, { tSrc: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } });
    this.raysMat = fsMat(RAYS_FS, { tSrc: { value: null }, tDepth: { value: null }, uLight: { value: new THREE.Vector2(0.5, 0.8) }, uThreshold: { value: 0.8 }, uDecay: { value: 0.96 }, uLen: { value: 0.9 }, uSky: { value: 1 } });
    const u = (v) => ({ value: v });
    this.compMat = fsMat(COMP_FS, {
      tScene: u(null), tDepth: u(null), tBloom: u(null), tBlur1: u(null), tBlur2: u(null), tRays: u(null),
      uRes: u(new THREE.Vector2()), uTime: u(0), uNear: u(0.1), uFar: u(1000),
      uExposure: u(1), uBloom: u(0.05), uRaysAmt: u(0), uRaysTint: u(new THREE.Vector3(1, 1, 1)),
      uFocus: u(8), uFocusRange: u(6), uDof: u(0), uDofNear: u(0),
      uLift: u(new THREE.Vector3()), uGamma: u(new THREE.Vector3(1, 1, 1)), uGain: u(new THREE.Vector3(1, 1, 1)), uSat: u(1), uContrast: u(1), uTint: u(new THREE.Vector3(1, 1, 1)),
      uVignette: u(0.3), uCA: u(0), uGrain: u(0.03), uBright: u(1),
      uFadeColor: u(new THREE.Color()), uFade: u(1), uWarp: u(0), uCollapse: u(0), uLetterbox: u(0), uGlitch: u(0), uHalation: u(0), uDesat: u(0),
    });
    this.dofMat = fsMat(DOF_FS, { tScene: { value: null }, tDepth: { value: null }, tBlur1: { value: null }, tBlur2: { value: null }, uNear: { value: 0.1 }, uFar: { value: 1000 }, uFocus: { value: 8 }, uFocusRange: { value: 6 }, uDof: { value: 0 }, uDofNear: { value: 0 } });
    this.linMat = fsMat(LINDEPTH_FS, { tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 1000 } });
    this.mips = [];
    this.ups = [];
    this.samples = 4;
    this.scale = 1;
  }

  setSize(w, h, samples) {
    this.w = w; this.h = h;
    if (samples !== undefined) this.samples = samples;
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.sceneRT?.dispose();
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.samples, depthBuffer: true });
    this.sceneRT.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    this.mips.forEach(m => m.dispose()); this.ups.forEach(m => m.dispose());
    this.mips = []; this.ups = [];
    let mw = w, mh = h;
    for (let i = 0; i < 6; i++) {
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
      this.mips.push(new THREE.WebGLRenderTarget(mw, mh, opts));
      this.ups.push(new THREE.WebGLRenderTarget(mw, mh, opts));
    }
    this.dofRT?.dispose();
    this.dofRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.linRT?.dispose();
    this.linRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    SOFT.tSoftDepth.value = this.linRT.texture; SOFT.uSoftRes.value.set(w, h);
    this.raysRT?.dispose();
    this.raysRT = new THREE.WebGLRenderTarget(Math.max(1, w >> 2), Math.max(1, h >> 2), opts);
    this.compMat.uniforms.uRes.value.set(w, h);
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.qScene, this.qCam);
  }

  setLook(partial, speed) {
    Object.assign(this.target, structuredClone(partial));
    if (speed !== undefined) this.lookSpeed = speed;
  }
  snapLook(partial) {
    this.target = Object.assign(structuredClone(DEFAULT_LOOK), structuredClone(partial));
    this.look = structuredClone(this.target);
  }

  updateLook(dt) {
    const k = 1 - Math.exp(-dt * this.lookSpeed);
    for (const key in this.target) {
      const t = this.target[key];
      if (Array.isArray(t)) for (let i = 0; i < t.length; i++) this.look[key][i] += (t[i] - this.look[key][i]) * k;
      else this.look[key] += (t - this.look[key]) * k;
    }
  }

  render(scene, camera, time, dt) {
    this.updateLook(dt);
    const L = this.look, U = this.compMat.uniforms, r = this.r;
    r.setRenderTarget(this.sceneRT);
    camera.layers.set(0);
    r.render(scene, camera);
    // linear depth (for soft particles, which occlude themselves against it)
    this.linMat.uniforms.tDepth.value = this.sceneRT.depthTexture;
    this.linMat.uniforms.uNear.value = camera.near; this.linMat.uniforms.uFar.value = camera.far;
    this.pass(this.linMat, this.linRT);
    // mip chain
    let src = this.sceneRT.texture, sw = this.w, sh = this.h;
    for (let i = 0; i < this.mips.length; i++) {
      this.downMat.uniforms.tSrc.value = src;
      this.downMat.uniforms.uTexel.value.set(1 / sw, 1 / sh);
      this.downMat.uniforms.uFirst.value = i === 0 ? 1 : 0;
      this.pass(this.downMat, this.mips[i]);
      src = this.mips[i].texture; sw = this.mips[i].width; sh = this.mips[i].height;
    }
    // upsample (accumulate)
    let prev = this.mips[this.mips.length - 1].texture;
    for (let i = this.mips.length - 2; i >= 0; i--) {
      this.upMat.uniforms.tSrc.value = prev;
      this.upMat.uniforms.tPrev.value = this.mips[i].texture;
      this.upMat.uniforms.uTexel.value.set(1 / this.mips[i + 1].width, 1 / this.mips[i + 1].height);
      this.pass(this.upMat, this.ups[i]);
      prev = this.ups[i].texture;
    }
    // rays
    if (L.rays > 0.001) {
      const R = this.raysMat.uniforms;
      R.tSrc.value = this.mips[1].texture; R.tDepth.value = this.sceneRT.depthTexture;
      R.uLight.value.set(L.raysLight[0], L.raysLight[1]); R.uThreshold.value = L.raysThreshold; R.uDecay.value = L.raysDecay; R.uLen.value = L.raysLen; R.uSky.value = L.raysSky;
      this.pass(this.raysMat, this.raysRT);
    }
    // depth of field on the opaque image, then particles on top (so DOF never smears snowflakes)
    const D = this.dofMat.uniforms;
    D.tScene.value = this.sceneRT.texture; D.tDepth.value = this.sceneRT.depthTexture; D.tBlur1.value = this.mips[1].texture; D.tBlur2.value = this.mips[2].texture;
    D.uNear.value = camera.near; D.uFar.value = camera.far; D.uFocus.value = L.focus; D.uFocusRange.value = L.focusRange; D.uDof.value = L.dof * (this.dofScale ?? 1); D.uDofNear.value = L.dofNear;
    this.pass(this.dofMat, this.dofRT);
    if (scene.userData.soft) {
      r.setRenderTarget(this.dofRT);
      camera.layers.set(1);
      const ac = r.autoClear; r.autoClear = false;
      const bg = scene.background; scene.background = null;
      r.render(scene, camera);
      scene.background = bg; r.autoClear = ac;
      camera.layers.set(0);
    }
    U.tScene.value = this.dofRT.texture; U.tDepth.value = this.sceneRT.depthTexture;
    U.tBloom.value = this.ups[0].texture; U.tBlur1.value = this.mips[1].texture; U.tBlur2.value = this.mips[2].texture; U.tRays.value = this.raysRT.texture;
    U.uTime.value = time; U.uNear.value = camera.near; U.uFar.value = camera.far;
    U.uExposure.value = L.exposure; U.uBloom.value = L.bloom * (this.bloomScale ?? 1); U.uHalation.value = L.halation;
    U.uRaysAmt.value = L.rays; U.uRaysTint.value.set(...L.raysTint);
    U.uFocus.value = L.focus; U.uFocusRange.value = L.focusRange; U.uDof.value = L.dof * (this.dofScale ?? 1); U.uDofNear.value = L.dofNear;
    U.uLift.value.set(...L.lift); U.uGamma.value.set(...L.gamma); U.uGain.value.set(...L.gain);
    U.uSat.value = L.sat; U.uContrast.value = L.contrast; U.uTint.value.set(...L.tint);
    U.uVignette.value = L.vignette; U.uCA.value = L.ca; U.uGrain.value = L.grain;
    const F = this.fx;
    U.uFade.value = F.fade; U.uFadeColor.value.copy(F.fadeColor); U.uWarp.value = F.warp; U.uCollapse.value = F.collapse;
    U.uLetterbox.value = F.letterbox; U.uGlitch.value = F.glitch; U.uBright.value = F.bright; U.uDesat.value = F.desat;
    this.pass(this.compMat, null);
  }
}
