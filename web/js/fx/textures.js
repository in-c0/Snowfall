// Canvas-generated textures for things no scan library has: daisies, maple leaves, twig masses, book spines, big tropical leaves.
import * as THREE from 'three';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function toTex(c, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);
const cache = {};

// Daisy head seen from above: white petals (faint lavender tips), golden centre. RGBA.
export function daisyTex() {
  if (cache.daisy) return cache.daisy;
  const [c, g] = canvas(256, 256);
  g.translate(128, 128);
  const N = 34;
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + layer * 0.09 + rnd(-0.04, 0.04);
      g.save(); g.rotate(a);
      const len = rnd(96, 118) - layer * 6, wdt = rnd(7, 9.5);
      const gr = g.createLinearGradient(0, 0, len, 0);
      gr.addColorStop(0, 'rgba(255,255,250,1)');
      gr.addColorStop(0.7, `rgba(${246 - layer * 6},${244 - layer * 8},255,1)`);
      gr.addColorStop(1, `rgba(${214 + rnd(-10, 10)},${206 + rnd(-10, 10)},250,1)`);
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(14, 0);
      g.quadraticCurveTo(len * 0.5, -wdt, len, -wdt * 0.25);
      g.quadraticCurveTo(len + 3, 0, len, wdt * 0.25);
      g.quadraticCurveTo(len * 0.5, wdt, 14, 0);
      g.fill();
      g.strokeStyle = 'rgba(180,170,200,0.25)'; g.lineWidth = 1; g.beginPath(); g.moveTo(16, 0); g.lineTo(len - 6, 0); g.stroke();
      g.restore();
    }
  }
  // centre disc florets
  const cg = g.createRadialGradient(0, 0, 2, 0, 0, 30);
  cg.addColorStop(0, '#f3b51c'); cg.addColorStop(0.6, '#f0a313'); cg.addColorStop(1, '#c97808');
  g.fillStyle = cg; g.beginPath(); g.arc(0, 0, 28, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 260; i++) {
    const r = Math.sqrt(Math.random()) * 26, a = Math.random() * 6.283;
    g.fillStyle = `rgba(${200 + rnd(0, 55)},${120 + rnd(0, 70)},${rnd(0, 30)},0.8)`;
    g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, rnd(0.8, 2), 0, 6.283); g.fill();
  }
  return (cache.daisy = toTex(c));
}

// Maple leaf atlas (4x4 variations, autumn reds/oranges/yellows). RGBA.
export function mapleAtlas() {
  if (cache.maple) return cache.maple;
  const S = 128, [c, g] = canvas(S * 4, S * 4);
  const pal = [[178, 34, 20], [205, 60, 18], [226, 98, 22], [238, 140, 30], [214, 46, 28], [190, 22, 30], [244, 170, 40], [160, 40, 24]];
  for (let k = 0; k < 16; k++) {
    const ox = (k % 4) * S + S / 2, oy = Math.floor(k / 4) * S + S / 2;
    const col = pal[k % pal.length];
    g.save(); g.translate(ox, oy + 8); g.rotate(rnd(-0.2, 0.2));
    g.beginPath();
    // 7-point palmate maple outline
    const pts = [];
    const lobes = 7;
    for (let i = 0; i <= lobes * 4; i++) {
      const t = i / (lobes * 4);
      const a = -Math.PI / 2 + (t - 0.5) * Math.PI * 1.75;
      const lob = (i % 4 === 0) ? 1 : (i % 4 === 2 ? 0.42 : 0.7);
      const lobeIdx = Math.round(t * lobes);
      const lenScale = 1 - Math.abs(lobeIdx / lobes - 0.5) * 0.9;
      const r = 54 * lob * lenScale + rnd(-2, 2);
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    g.moveTo(0, 6);
    for (const p of pts) g.lineTo(p[0], p[1]);
    g.closePath();
    const gr = g.createRadialGradient(0, 0, 4, 0, -10, 60);
    gr.addColorStop(0, `rgb(${col[0] * 0.75},${col[1] * 0.8},${col[2]})`);
    gr.addColorStop(0.6, `rgb(${col[0]},${col[1]},${col[2]})`);
    gr.addColorStop(1, `rgb(${Math.min(255, col[0] + 30)},${Math.min(255, col[1] + 50)},${col[2] + 10})`);
    g.fillStyle = gr; g.fill();
    // veins
    g.strokeStyle = `rgba(${col[0] * 0.6},${col[1] * 0.5},10,0.55)`; g.lineWidth = 1.2;
    for (let i = 0; i < lobes; i++) { const a = -Math.PI / 2 + (i / (lobes - 1) - 0.5) * Math.PI * 1.5; g.beginPath(); g.moveTo(0, 6); g.lineTo(Math.cos(a) * 40, Math.sin(a) * 40); g.stroke(); }
    // stem
    g.strokeStyle = 'rgba(90,40,20,0.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 6); g.lineTo(2, 34); g.stroke();
    // speckles / decay
    for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(60,20,10,${rnd(0.05, 0.2)})`; g.beginPath(); g.arc(rnd(-30, 30), rnd(-35, 10), rnd(1, 4), 0, 6.28); g.fill(); }
    g.restore();
  }
  return (cache.maple = toTex(c));
}

// Generic leaf atlas for golden vines / ivy / foliage (4x4). tint applied in material.
export function leafAtlas() {
  if (cache.leaf) return cache.leaf;
  const S = 128, [c, g] = canvas(S * 4, S * 4);
  for (let k = 0; k < 16; k++) {
    const ox = (k % 4) * S + S / 2, oy = Math.floor(k / 4) * S + S / 2;
    g.save(); g.translate(ox, oy); g.rotate(rnd(-0.3, 0.3));
    const L = rnd(44, 58), W = rnd(18, 30);
    g.beginPath(); g.moveTo(0, L); g.bezierCurveTo(W, L * 0.4, W * 0.9, -L * 0.5, 0, -L); g.bezierCurveTo(-W * 0.9, -L * 0.5, -W, L * 0.4, 0, L); g.closePath();
    const v = rnd(0.8, 1.1);
    const gr = g.createLinearGradient(-W, 0, W, 0);
    gr.addColorStop(0, `rgb(${170 * v},${170 * v},${70 * v})`); gr.addColorStop(0.5, `rgb(${220 * v},${210 * v},${110 * v})`); gr.addColorStop(1, `rgb(${160 * v},${160 * v},${60 * v})`);
    g.fillStyle = gr; g.fill();
    g.strokeStyle = 'rgba(120,110,40,0.5)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, L); g.lineTo(0, -L); g.stroke();
    for (let i = -4; i <= 4; i++) { if (!i) continue; g.beginPath(); g.moveTo(0, i * 9); g.lineTo(Math.sign(i) * W * 0.7, i * 9 - 12); g.stroke(); }
    g.restore();
  }
  return (cache.leaf = toTex(c));
}

// Large tropical leaf (alocasia/monstera-ish) with veins; RGBA, single.
export function bigLeafTex(kind = 0) {
  const key = 'big' + kind; if (cache[key]) return cache[key];
  const [c, g] = canvas(256, 512);
  g.translate(128, 256);
  g.beginPath();
  if (kind === 0) { // alocasia: heart-shaped, pointed
    g.moveTo(0, 250); g.bezierCurveTo(130, 160, 125, -120, 0, -250); g.bezierCurveTo(-125, -120, -130, 160, 0, 250);
  } else { // banana/strelitzia: long oval
    g.moveTo(0, 250); g.bezierCurveTo(90, 120, 95, -150, 0, -250); g.bezierCurveTo(-95, -150, -90, 120, 0, 250);
  }
  g.closePath();
  const gr = g.createLinearGradient(-120, 0, 120, 0);
  gr.addColorStop(0, '#55702e'); gr.addColorStop(0.45, '#7c9a46'); gr.addColorStop(0.55, '#86a44e'); gr.addColorStop(1, '#4e6a2a');
  g.fillStyle = gr; g.fill();
  g.save(); g.clip();
  g.strokeStyle = 'rgba(214,226,170,0.55)'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(0, 250); g.lineTo(0, -250); g.stroke();
  g.lineWidth = 1.6;
  for (let i = -11; i < 12; i++) {
    const y = i * 21;
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(s * 50, y - 26, s * 140, y - 70); g.stroke(); }
  }
  // lighting variation
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(30,40,10,${rnd(0.02, 0.08)})`; g.beginPath(); g.arc(rnd(-120, 120), rnd(-240, 240), rnd(10, 40), 0, 6.28); g.fill(); }
  g.restore();
  return (cache[key] = toTex(c));
}

// Fractal twig mass for bare trees (RGBA, dark branches on transparent). Used on crossed crown cards.
export function twigTex(seed = 0) {
  const key = 'twig' + seed; if (cache[key]) return cache[key];
  const [c, g] = canvas(1024, 1024);
  g.lineCap = 'round';
  function br(x, y, a, len, w, d) {
    if (d > 9 || len < 2.5 || w < 0.35) return;
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    const sh = 46 + d * 7;
    g.strokeStyle = `rgba(${sh},${sh - 4},${sh - 8},${1 - d * 0.05})`;
    g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo((x + x2) / 2 + rnd(-len, len) * 0.15, (y + y2) / 2 + rnd(-len, len) * 0.15, x2, y2); g.stroke();
    // snow resting on the upper edge of thicker twigs
    if (w > 1.5 && Math.abs(Math.cos(a)) > 0.3) { g.strokeStyle = 'rgba(235,238,242,0.55)'; g.lineWidth = w * 0.45; g.beginPath(); g.moveTo(x, y - w * 0.4); g.lineTo(x2, y2 - w * 0.4); g.stroke(); }
    const n = d < 3 ? 3 : 2 + (Math.random() < 0.45 ? 1 : 0);
    for (let i = 0; i < n; i++) br(x2, y2, a + rnd(-0.7, 0.7) - 0.05 * Math.sign(a + Math.PI / 2), len * rnd(0.62, 0.8), w * 0.64, d + 1);
  }
  for (let i = 0; i < 4; i++) br(512 + rnd(-90, 90), 1024, -Math.PI / 2 + rnd(-0.45, 0.45), 210, 12, 0);
  return (cache[key] = toTex(c));
}

// Book spines atlas: rows of varied spines (for distant shelf rows), plus a matching roughness-ish normal not needed.
export function spineTex(warm = true) {
  const key = 'spine' + warm; if (cache[key]) return cache[key];
  const [c, g] = canvas(1024, 256);
  const pal = warm
    ? ['#5a2a1e', '#6e3a20', '#3d2a1c', '#7a5530', '#2f3a2c', '#24304a', '#5c4a2a', '#8a6a3a', '#40201a', '#2a2620', '#6a3020', '#3a4a3a', '#a08050', '#1e2430']
    : ['#2a3040', '#303848', '#202530', '#4a4a50', '#3a3530'];
  let x = 0;
  g.fillStyle = '#0d0907'; g.fillRect(0, 0, 1024, 256);
  while (x < 1024) {
    const w = rnd(10, 30), h = rnd(170, 250);
    const col = pal[Math.floor(Math.random() * pal.length)];
    const y = 256 - h;
    const gr = g.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(0.25, col); gr.addColorStop(0.7, col); gr.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = col; g.fillRect(x, y, w, h);
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    // bands & title
    if (Math.random() < 0.7) {
      g.fillStyle = `rgba(200,160,80,${rnd(0.3, 0.7)})`;
      const by = y + rnd(10, 30); g.fillRect(x + 1, by, w - 2, 2); g.fillRect(x + 1, by + 6, w - 2, 1);
      g.fillRect(x + 1, 256 - rnd(14, 26), w - 2, 2);
      g.fillStyle = `rgba(210,180,110,${rnd(0.25, 0.55)})`;
      for (let k = 0; k < 6; k++) g.fillRect(x + w / 2 - 1, y + 50 + k * 9 + rnd(0, 3), 2.5, 5);
    }
    // wear
    g.fillStyle = 'rgba(255,240,200,0.05)'; g.fillRect(x + w * 0.3, y, 2, h);
    x += w + (Math.random() < 0.08 ? rnd(4, 30) : rnd(0, 1.5));
    if (Math.random() < 0.05 && x < 1000) { // leaning book
      g.save(); g.translate(x, 256); g.rotate(-0.25); g.fillStyle = pal[Math.floor(Math.random() * pal.length)]; g.fillRect(0, -200, 18, 200); g.restore(); x += 50;
    }
  }
  const t = toTex(c, true, true);
  return (cache[key] = t);
}

// Soft round sprite (for glows / bokeh)
export function glowTex() {
  if (cache.glow) return cache.glow;
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.8)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return (cache.glow = toTex(c, false));
}

// Persian-ish rug
export function rugTex() {
  if (cache.rug) return cache.rug;
  const [c, g] = canvas(512, 768);
  g.fillStyle = '#6b2a1c'; g.fillRect(0, 0, 512, 768);
  g.strokeStyle = '#d8b878'; g.lineWidth = 10; g.strokeRect(20, 20, 472, 728);
  g.strokeStyle = '#1e2a3a'; g.lineWidth = 26; g.strokeRect(48, 48, 416, 672);
  g.fillStyle = '#c99a5a';
  for (let y = 100; y < 680; y += 60) for (let x = 100; x < 420; x += 60) { g.save(); g.translate(x + 20, y + 20); g.rotate(Math.PI / 4); g.fillRect(-10, -10, 20, 20); g.restore(); }
  g.fillStyle = '#e8d4a8'; g.beginPath(); g.ellipse(256, 384, 110, 170, 0, 0, 6.28); g.fill();
  g.fillStyle = '#7a2a20'; g.beginPath(); g.ellipse(256, 384, 80, 130, 0, 0, 6.28); g.fill();
  const im = g.getImageData(0, 0, 512, 768);
  for (let i = 0; i < im.data.length; i += 4) { const n = (Math.random() - 0.5) * 30; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; }
  g.putImageData(im, 0, 0);
  return (cache.rug = toTex(c));
}

// Grass blade colour strip (vertical gradient) used by grass shader as map
export function noiseTex(size = 256) {
  if (cache.noise) return cache.noise;
  const [c, g] = canvas(size, size);
  const im = g.createImageData(size, size);
  for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = v; im.data[i + 1] = Math.random() * 255; im.data[i + 2] = Math.random() * 255; im.data[i + 3] = 255; }
  g.putImageData(im, 0, 0);
  return (cache.noise = toTex(c, false, true));
}

// Dandelion seed (pappus) sprite
export function seedTex() {
  if (cache.seed) return cache.seed;
  const [c, g] = canvas(128, 128);
  g.translate(64, 64);
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 0.8;
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 40, Math.sin(a) * 40 - 10); g.stroke(); }
  g.fillStyle = 'rgba(220,210,190,1)'; g.beginPath(); g.ellipse(0, 26, 2, 8, 0, 0, 6.28); g.fill();
  return (cache.seed = toTex(c, false));
}

// Dense daisy meadow seen from a distance: grass noise with hundreds of tiny daisies (tiles seamlessly-ish).
export function meadowTex() {
  if (cache.meadow) return cache.meadow;
  const S = 1024, [c, g] = canvas(S, S);
  g.fillStyle = '#4a6a2a'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) { // grass strokes
    const x = Math.random() * S, y = Math.random() * S, l = rnd(4, 14);
    g.strokeStyle = `hsl(${rnd(75, 100)},${rnd(35, 55)}%,${rnd(18, 42)}%)`; g.lineWidth = rnd(0.8, 2);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + rnd(-3, 3), y - l); g.stroke();
  }
  for (let i = 0; i < 2600; i++) { // daisies
    const x = Math.random() * S, y = Math.random() * S, r = rnd(3, 7);
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      const px = x + ox, py = y + oy;
      if (px < -10 || px > S + 10 || py < -10 || py > S + 10) continue;
      g.fillStyle = `rgba(${rnd(235, 255)},${rnd(232, 250)},255,0.95)`;
      g.beginPath(); g.ellipse(px, py, r, r * rnd(0.55, 0.9), rnd(0, 3), 0, 6.28); g.fill();
      g.fillStyle = '#e9a316'; g.beginPath(); g.arc(px, py, r * 0.32, 0, 6.28); g.fill();
    }
  }
  return (cache.meadow = toTex(c, true, true));
}
