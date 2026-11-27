// Offline port of snowfall/js/audio.js (AudioEngine + PIECES) for baking WAVs for the Unreal port.
// Every node graph is copied from the game engine; the only changes are:
//  - an OfflineAudioContext at 48 kHz instead of a live AudioContext,
//  - `ctx.currentTime` replaced by an explicit clock (`this.now`) that the job driver advances,
//  - Math.random replaced by a seeded PRNG (mulberry32) so every render is reproducible,
//  - no master compressor/makeup (the bake stays linear; loudness + limiting happen in post.py).
// Results are kept on `window.__out` as interleaved float32 and pulled by render.py in base64 chunks.

const SR = 48000;
const NOTE_FILES = ['A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7'];
const NAME_TO_SEMI = { C: 0, Cs: 1, D: 2, Ds: 3, E: 4, F: 5, Fs: 6, G: 7, Gs: 8, A: 9, As: 10, B: 11 };
function fileMidi(n) { const m = n.match(/^([A-G]s?)(\d)$/); return 12 * (+m[2] + 1) + NAME_TO_SEMI[m[1]]; }
function midi(n) {
  if (typeof n === 'number') return n;
  const m = n.match(/^([A-G])([#b]?)(-?\d)$/);
  const s = NAME_TO_SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 12 * (+m[3] + 1) + s;
}

// ---------- seeded randomness ----------
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function seed(s) { Math.random = mulberry32(hashStr(String(s))); }
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------- piano samples (decoded once, AudioBuffers are context-independent) ----------
let PIANO = null;
async function loadPiano() {
  if (PIANO) return PIANO;
  const dec = new OfflineAudioContext(2, 1, SR);
  const samples = new Map();
  await Promise.all(NOTE_FILES.map(async (n) => {
    const r = await fetch(`/assets/piano/${n}.mp3`);
    samples.set(fileMidi(n), await dec.decodeAudioData(await r.arrayBuffer()));
  }));
  PIANO = { samples, keys: [...samples.keys()].sort((a, b) => a - b) };
  return PIANO;
}

// ---------- the engine (graph copied from AudioEngine.init) ----------
class OEngine {
  constructor(ctx, piano) {
    this.ctx = ctx; this.now = 0; this.voices = new Set();
    this.samples = piano.samples; this.sampleKeys = piano.keys;
    this.master = ctx.createGain(); this.master.gain.value = 0.9; // vol.master default
    this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.8 * 1.7; // setVolumes: music * 1.7
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9;
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0.9 * 0.9;
    this.musicLP = ctx.createBiquadFilter(); this.musicLP.type = 'lowpass'; this.musicLP.frequency.value = 18000; this.musicLP.Q.value = 0.5;
    this.musicBus.connect(this.musicLP).connect(this.master);
    this.sfxBus.connect(this.master); this.ambBus.connect(this.master);
    // reverb send: one fixed IR for every file so the whole bake shares the same "room"
    seed('ir'); this.rev = ctx.createConvolver(); this.rev.buffer = this.makeIR(3.8, 2.2);
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.55;
    this.rev.connect(this.revGain).connect(this.master);
    this.musicSend = ctx.createGain(); this.musicSend.gain.value = 0.5; this.musicBus.connect(this.musicSend).connect(this.rev);
    // tape detune + wow/flutter shared by every piano voice
    this.tapeDetune = ctx.createConstantSource(); this.tapeDetune.offset.value = 0; this.tapeDetune.start(0);
    this.wow = ctx.createOscillator(); this.wow.frequency.value = 0.55; this.wowGain = ctx.createGain(); this.wowGain.gain.value = 6;
    this.wow.connect(this.wowGain); this.wow.start(0);
    this.flutter = ctx.createOscillator(); this.flutter.frequency.value = 6.3; this.flutterGain = ctx.createGain(); this.flutterGain.gain.value = 1.5;
    this.flutter.connect(this.flutterGain); this.flutter.start(0);
    seed('noise');
    this.white = this.noiseBuf(4, 'white'); this.pink = this.noiseBuf(6, 'pink'); this.brown = this.noiseBuf(6, 'brown');
    this.crackleBuf = this.makeCrackle(8);
  }
  noiseBuf(sec, kind) {
    const sr = this.ctx.sampleRate, n = sr * sec, b = this.ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w * 0.5;
        else if (kind === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      }
    }
    return b;
  }
  makeIR(sec, decay) {
    const sr = this.ctx.sampleRate, n = Math.floor(sr * sec), b = this.ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) { const t = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < sr * 0.01 ? i / (sr * 0.01) : 1); }
    }
    return b;
  }
  makeCrackle(sec) {
    const sr = this.ctx.sampleRate, n = sr * sec, b = this.ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) { d[i] = (Math.random() * 2 - 1) * 0.004; if (Math.random() < 0.00035) { const a = Math.random() * 0.5; for (let k = 0; k < 40 && i + k < n; k++) d[i + k] += (Math.random() * 2 - 1) * a * Math.exp(-k / 6); } }
    return b;
  }
  makeSteps(kind) {
    const sr = this.ctx.sampleRate, out = [];
    for (let v = 0; v < 6; v++) {
      const len = Math.floor(sr * (kind === 'wood' || kind === 'stone' ? 0.22 : 0.32));
      const b = this.ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
      if (kind === 'snow') {
        for (const [start, dur, amp] of [[0, 0.12, 1], [0.07, 0.16, 0.8]]) {
          const s0 = Math.floor(start * sr), dn = Math.floor(dur * sr);
          for (let i = 0; i < dn && s0 + i < len; i++) {
            const env = Math.sin(Math.PI * i / dn) ** 1.5;
            if (Math.random() < 0.18) d[s0 + i] += (Math.random() * 2 - 1) * amp * env * (0.4 + Math.random());
            d[s0 + i] += (Math.random() * 2 - 1) * 0.06 * env;
          }
        }
      } else if (kind === 'leaves') {
        for (let i = 0; i < len; i++) { const env = Math.exp(-i / (sr * 0.08)) * (i < sr * 0.01 ? i / (sr * 0.01) : 1); if (Math.random() < 0.08) d[i] += (Math.random() * 2 - 1) * env * 1.2; d[i] += (Math.random() * 2 - 1) * env * 0.15; }
      } else if (kind === 'grass') {
        for (let i = 0; i < len; i++) { const env = Math.sin(Math.PI * Math.min(i / (sr * 0.25), 1)) ** 2; d[i] = (Math.random() * 2 - 1) * env * 0.35; }
      } else {
        const f0 = kind === 'wood' ? rand(85, 110) : rand(120, 160);
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          d[i] = Math.sin(2 * Math.PI * f0 * t * (1 - t * 1.5)) * Math.exp(-t * 32) * 0.9 + (Math.random() * 2 - 1) * Math.exp(-t * (kind === 'wood' ? 90 : 60)) * 0.35;
          if (kind === 'wood' && v % 3 === 0) d[i] += Math.sin(2 * Math.PI * (380 + 60 * Math.sin(t * 40)) * t) * Math.exp(-((t - 0.09) ** 2) / 0.0006) * 0.08;
        }
      }
      out.push(b);
    }
    return out;
  }
  src(buf, { rate = 1, gain = 1, dest = this.sfxBus, loop = false, when = 0, pan = 0, send = 0, filter = null } = {}) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; s.loop = loop;
    const g = ctx.createGain(); g.gain.value = gain;
    let node = s;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = filter.type; f.frequency.value = filter.freq; f.Q.value = filter.q ?? 0.7; node.connect(f); node = f; }
    let out = g;
    node.connect(g);
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    out.connect(dest);
    if (send) { const sg = ctx.createGain(); sg.gain.value = send; out.connect(sg).connect(this.rev); }
    s.start(when || this.now);
    return { s, g };
  }
  // ---------- piano ----------
  note(n, { vel = 0.5, when = 0, dur = 1.2, rel = 0.8, oct = 0, pan = 0, bright = 1, dest = null } = {}) {
    const m = midi(n) + oct * 12;
    let best = this.sampleKeys[0];
    for (const k of this.sampleKeys) if (Math.abs(k - m) < Math.abs(best - m)) best = k;
    const ctx = this.ctx, t = when || this.now;
    const s = ctx.createBufferSource(); s.buffer = this.samples.get(best);
    s.detune.value = (m - best) * 100 + rand(-5, 5);
    this.tapeDetune.connect(s.detune); this.wowGain.connect(s.detune); this.flutterGain.connect(s.detune);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = (900 + 7000 * vel * vel) * bright; f.Q.value = 0.3;
    const g = ctx.createGain(); const amp = Math.pow(vel, 1.4) * 3.4;
    g.gain.setValueAtTime(amp, t);
    g.gain.setTargetAtTime(0, t + dur, rel / 3);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    s.connect(f).connect(g).connect(p).connect(dest || this.musicBus);
    s.start(t);
    s.stop(t + dur + rel * 2 + 0.1);
    this.voices.add(s);
  }
  chord(notes, opts = {}) { notes.forEach((n, i) => this.note(n, { ...opts, when: (opts.when || this.now) + i * (opts.roll ?? 0.0), vel: (opts.vel ?? 0.4) * (i === 0 ? 1 : 0.85) })); }
  // ---------- tape stop (AudioEngine.tapeStop at an explicit time) ----------
  tapeStop(dur) {
    const t = this.now;
    this.tapeDetune.offset.setValueAtTime(0, t);
    this.tapeDetune.offset.linearRampToValueAtTime(-3600, t + dur);
    this.musicLP.frequency.setValueAtTime(18000, t);
    this.musicLP.frequency.exponentialRampToValueAtTime(200, t + dur);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.setValueAtTime(140, t + dur); o.frequency.exponentialRampToValueAtTime(40, t + dur + 0.15);
    g.gain.setValueAtTime(0.0001, t); g.gain.setValueAtTime(0.4, t + dur); g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.2);
    o.connect(g).connect(this.sfxBus); o.start(t); o.stop(t + dur + 0.3);
    this.src(this.white, { gain: 0.12, when: t + dur, filter: { type: 'bandpass', freq: 2500, q: 0.6 } }).s.stop(t + dur + 0.05);
  }
  // ---------- ambience (makeAmb, verbatim apart from the clock) ----------
  makeAmb(name, level, opt = {}) {
    const ctx = this.ctx, g = ctx.createGain(); g.gain.value = level; g.connect(this.ambBus);
    const a = { g };
    if (name === 'wind') {
      const s1 = this.src(this.pink, { loop: true, gain: 1, dest: g, filter: { type: 'bandpass', freq: opt.bodyFreq ?? 400, q: 0.6 } });
      const s2 = this.src(this.brown, { loop: true, gain: 0.8, dest: g, filter: { type: 'lowpass', freq: 300, q: 0.5 } });
      const hs = ctx.createBufferSource(); hs.buffer = this.white; hs.loop = true;
      const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 700; hf.Q.value = 9;
      const hg = ctx.createGain(); hg.gain.value = 0.25;
      const hp = ctx.createStereoPanner(); hp.pan.value = 0.3;
      hs.connect(hf).connect(hg).connect(hp).connect(g); hs.start(0);
      const howl = opt.howl ?? 1, gusts = opt.gustBody ?? 0;
      a.tick = (t) => {
        const gust = 0.6 + 0.4 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1);
        hf.frequency.setTargetAtTime(500 + 500 * gust + 120 * Math.sin(t * 0.7), this.now, 0.4);
        hg.gain.setTargetAtTime((0.08 + 0.3 * gust * gust) * howl, this.now, 0.5);
        hp.pan.setTargetAtTime(Math.sin(t * 0.17) * 0.6, this.now, 0.8);
        // blizzard: the scene drives amb('wind') level with the storm; bake that as body gusts
        if (gusts) { const k = 1 - gusts + gusts * 1.6 * gust * gust; s1.g.gain.setTargetAtTime(k, this.now, 0.6); s2.g.gain.setTargetAtTime(0.8 * k, this.now, 0.6); }
      };
    } else if (name === 'birds') {
      a.tick = () => { if (Math.random() < 0.012) this.birdSong(g); };
      this.src(this.pink, { loop: true, gain: 0.06, dest: g, filter: { type: 'highpass', freq: 2000 } });
    } else if (name === 'room') {
      this.src(this.brown, { loop: true, gain: 0.25, dest: g, filter: { type: 'lowpass', freq: 160 } });
      a.tick = () => { if (Math.random() < 0.002) this.creak(g); };
    } else if (name === 'clock') {
      a.tick = (t) => { const s = Math.floor(t + 1e-6); if (s !== a.last) { a.last = s; this.now = s; this.tickTock(g, s % 2); } };
    } else if (name === 'vinyl') {
      this.src(this.crackleBuf, { loop: true, gain: 1.2, dest: g, filter: { type: 'highpass', freq: 800 } });
    } else if (name === 'drone') {
      for (const f of [55, 55.4, 82.4, 110.9]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; const og = ctx.createGain(); og.gain.value = 0.08; o.connect(lp).connect(og).connect(g); o.start(0); }
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 0.3; lfo.connect(lg).connect(g.gain); lfo.start(0);
    } else if (name === 'heart') {
      a.tick = (t) => { const beat = Math.floor(t / 1.05 + 1e-6); if (beat !== a.last) { a.last = beat; this.now = beat * 1.05; this.heartbeat(g); } };
    } else if (name === 'fire') {
      this.src(this.brown, { loop: true, gain: 0.25, dest: g, filter: { type: 'lowpass', freq: 400 } });
      this.src(this.crackleBuf, { loop: true, gain: 3, dest: g, rate: 0.6, filter: { type: 'bandpass', freq: 1800, q: 0.5 } });
    } else if (name === 'kids') {
      a.tick = () => { if (Math.random() < 0.02) this.kidVoice(g); };
    } else if (name === 'radio') {
      const s = this.src(this.white, { loop: true, gain: 0.5, dest: g, filter: { type: 'bandpass', freq: 1700, q: 1.2 } });
      this.src(this.crackleBuf, { loop: true, gain: 4, dest: g });
      a.tick = (t) => { s.g.gain.setTargetAtTime(0.25 + 0.25 * Math.abs(Math.sin(t * 3.1) * Math.sin(t * 1.7)), this.now, 0.05); };
    } else if (name === 'hum') {
      const o = ctx.createOscillator(); o.frequency.value = 60; const og = ctx.createGain(); og.gain.value = 0.03; o.connect(og).connect(g); o.start(0);
      this.src(this.pink, { loop: true, gain: 0.12, dest: g, filter: { type: 'lowpass', freq: 500 } });
    }
    return a;
  }
  // ---------- one-shots (verbatim, clock -> this.now) ----------
  step(surface, bufIndex) {
    const buf = this.steps[surface][bufIndex];
    const f = { snow: { type: 'bandpass', freq: 2400, q: 0.5 }, leaves: { type: 'highpass', freq: 900 }, grass: { type: 'bandpass', freq: 3500, q: 0.4 }, wood: { type: 'lowpass', freq: 2500 }, stone: { type: 'lowpass', freq: 3500 } }[surface];
    // rate 1 / centre pan / dry: UE randomises pitch, spatialises and adds its own reverb
    this.src(buf, { rate: 1, gain: 0.55, filter: f });
  }
  bell(gain = 0.5, base = 392) {
    const ctx = this.ctx, t = this.now;
    const out = ctx.createGain(); out.gain.value = gain; out.connect(this.sfxBus); // HRTF panner dropped: UE spatialises
    const sg = ctx.createGain(); sg.gain.value = 0.9; out.connect(sg).connect(this.rev);
    const partials = [[0.5, 1, 7], [1, 0.8, 5], [1.19, 0.5, 3.5], [1.56, 0.35, 3], [2.0, 0.4, 2.5], [2.51, 0.2, 1.8], [2.66, 0.18, 1.6], [3.01, 0.12, 1.2], [4.1, 0.08, 0.8]];
    for (const [r, a, d] of partials) {
      const o = ctx.createOscillator(); o.frequency.value = base * r * (1 + rand(-0.002, 0.002));
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a * 0.25, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + d * 1.6);
      o.connect(g).connect(out); o.start(t); o.stop(t + d * 1.7);
    }
  }
  birdSong(dest) {
    const ctx = this.ctx, t0 = this.now + rand(0, 0.3);
    const n = Math.floor(rand(2, 7)), base = rand(2600, 4800), pan = rand(-0.8, 0.8), type = Math.random();
    const pn = ctx.createStereoPanner(); pn.pan.value = pan; const out = ctx.createGain(); out.gain.value = rand(0.03, 0.09);
    out.connect(pn).connect(dest); const sg = ctx.createGain(); sg.gain.value = 0.4; pn.connect(sg).connect(this.rev);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * rand(0.09, 0.16), d = rand(0.05, 0.12);
      const o = ctx.createOscillator(); o.type = 'sine';
      const f = base * (type < 0.5 ? (1 + i * 0.04) : (1 - i * 0.03));
      o.frequency.setValueAtTime(f * 0.8, t); o.frequency.exponentialRampToValueAtTime(f * rand(1.1, 1.4), t + d * 0.5); o.frequency.exponentialRampToValueAtTime(f * 0.9, t + d);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(out); o.start(t); o.stop(t + d + 0.02);
    }
  }
  creak(dest, panOverride) {
    const ctx = this.ctx, t = this.now, o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(rand(70, 120), t); o.frequency.linearRampToValueAtTime(rand(60, 140), t + 0.6);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = rand(500, 900); f.Q.value = 8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 0.2); g.gain.linearRampToValueAtTime(0, t + 0.7);
    const pn = ctx.createStereoPanner(); const p = rand(-1, 1); pn.pan.value = panOverride ?? p;
    o.connect(f).connect(g).connect(pn).connect(dest); pn.connect(this.rev); o.start(t); o.stop(t + 0.8);
  }
  tickTock(dest, alt) {
    const t = this.now;
    this.src(this.white, { gain: 0.05, dest, filter: { type: 'bandpass', freq: alt ? 3200 : 2600, q: 6 } }).s.stop(t + 0.02);
  }
  heartbeat(dest = this.sfxBus, gain = 0.6) {
    const ctx = this.ctx;
    for (const [dt, a] of [[0, 1], [0.28, 0.7]]) {
      const t = this.now + dt, o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(62, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.15);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a * gain, t + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g).connect(dest); o.start(t); o.stop(t + 0.25);
    }
  }
  glass() {
    const ctx = this.ctx, t = this.now;
    this.src(this.white, { gain: 0.4, filter: { type: 'highpass', freq: 2500 }, send: 0.3 }).g.gain.setTargetAtTime(0, t + 0.02, 0.05);
    for (let i = 0; i < 26; i++) {
      const tt = t + Math.pow(Math.random(), 2) * 0.5, o = ctx.createOscillator(), g = ctx.createGain(), f = rand(2800, 9000);
      o.frequency.value = f; g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(rand(0.02, 0.07), tt + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, tt + rand(0.05, 0.4));
      const pn = ctx.createStereoPanner(); pn.pan.value = rand(-0.6, 0.6);
      o.connect(g).connect(pn).connect(this.sfxBus); pn.connect(this.rev); o.start(tt); o.stop(tt + 0.5);
    }
  }
  whoosh(dur = 1.5) {
    const t = this.now;
    const { s, g } = this.src(this.pink, { gain: 0, filter: { type: 'bandpass', freq: 600, q: 1.2 }, send: 0.4 });
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    s.stop(t + dur + 0.1);
  }
  chime() {
    const t = this.now;
    ['Eb5', 'Bb5', 'G6', 'D7'].forEach((n, i) => this.note(n, { vel: 0.28 - i * 0.04, when: t + i * 0.11, dur: 2.5, rel: 2, dest: this.sfxBus }));
  }
  holdTone(k) {
    if (!this.hold) {
      const ctx = this.ctx, o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sine'; o2.type = 'sine'; o.frequency.value = 196; o2.frequency.value = 293.7; f.type = 'lowpass'; f.frequency.value = 900;
      g.gain.value = 0; o.connect(f); o2.connect(f); f.connect(g).connect(this.sfxBus); const sg = ctx.createGain(); sg.gain.value = 0.6; g.connect(sg).connect(this.rev);
      o.start(0); o2.start(0); this.hold = { o, o2, g };
    }
    const t = this.now;
    this.hold.g.gain.setTargetAtTime(k > 0 ? 0.025 + k * 0.035 : 0, t, k > 0 ? 0.05 : 0.15);
    this.hold.o.frequency.setTargetAtTime(196 * (1 + k * 0.5), t, 0.05); this.hold.o2.frequency.setTargetAtTime(293.7 * (1 + k * 0.5), t, 0.05);
  }
  kidVoice(dest) {
    const ctx = this.ctx, t0 = this.now;
    const laugh = Math.random() < 0.6;
    const n = laugh ? Math.floor(rand(3, 7)) : 1;
    const f0 = rand(330, 480);
    const out = ctx.createGain(); out.gain.value = rand(0.025, 0.06);
    const pn = ctx.createStereoPanner(); pn.pan.value = rand(-0.9, 0.9);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    out.connect(lp).connect(pn).connect(dest); const sg = ctx.createGain(); sg.gain.value = 1.2; pn.connect(sg).connect(this.rev);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    [[1000, 6, 1], [1700, 8, 0.6], [3000, 10, 0.25]].forEach(([f, q, a]) => { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f * rand(0.9, 1.1); b.Q.value = q; const g = ctx.createGain(); g.gain.value = a; o.connect(b).connect(g).connect(out); });
    const env = out.gain; const base = env.value; env.setValueAtTime(0, t0);
    let t = t0;
    for (let i = 0; i < n; i++) {
      const d = laugh ? rand(0.09, 0.14) : rand(0.4, 0.8);
      const f = laugh ? f0 * (1 - i * 0.04) : f0;
      o.frequency.setValueAtTime(f * 1.1, t); o.frequency.exponentialRampToValueAtTime(f * (laugh ? 0.9 : rand(1.2, 1.5)), t + d);
      env.setValueAtTime(0, t); env.linearRampToValueAtTime(base, t + 0.02); env.setTargetAtTime(0, t + d * 0.6, d * 0.2);
      t += d + (laugh ? rand(0.04, 0.08) : 0);
    }
    o.start(t0); o.stop(t + 0.3);
  }
}

// ---------- the score (verbatim copy of PIECES) ----------
const V = (a, n, o) => a.note(n, o);
const PIECES = {
  blizzard: { bar(a, t, i, dest) { const dur = 6.5; const lows = ['D2', 'A1', 'F2', 'C2']; V(a, lows[i % 4], { when: t, vel: 0.22, dur: 6, rel: 3, dest, bright: 0.5 }); if (i % 2 === 1) V(a, pick(['A4', 'E5', 'F5', 'D5', 'C5']), { when: t + rand(1.5, 4), vel: 0.16, dur: 3, rel: 3, dest, pan: rand(-0.4, 0.4) }); return dur; } },
  garden: {
    bar(a, t, i, dest) {
      const b = 3.6;
      const prog = [['F2', 'C3', 'A3', 'E4', 'G4'], ['A2', 'E3', 'G3', 'C4', 'E4'], ['Bb2', 'F3', 'A3', 'D4', 'E4'], ['C3', 'G3', 'D4', 'E4', 'A4']];
      const ch = prog[i % 4]; const steps = [0, 1, 2, 3, 4, 3, 2, 1];
      steps.forEach((s, k) => V(a, ch[s], { when: t + k * (b / 8) + rand(0, 0.02), vel: k === 0 ? 0.32 : 0.18 + rand(0, 0.06), dur: b, rel: 1.5, dest, pan: (s - 2) * 0.12 }));
      if (i % 2 === 0) { const mel = ['C6', 'A5', 'G5', 'E6', 'D6', 'F5']; V(a, pick(mel), { when: t + b * 0.5, vel: 0.14, dur: 2, rel: 2, dest, pan: 0.3 }); }
      return b;
    },
  },
  library: {
    bar(a, t, i, dest) {
      const beat = 0.9, b = beat * 3;
      const prog = [['A2', 'E3', 'C4', 'B4'], ['F2', 'C3', 'A3', 'E4'], ['C3', 'G3', 'E4', 'D5'], ['G2', 'D3', 'B3', 'E4']];
      const ch = prog[i % 4];
      V(a, ch[0], { when: t, vel: 0.3, dur: b * 1.4, rel: 2, dest });
      V(a, ch[1], { when: t + beat, vel: 0.17, dur: b, rel: 1.5, dest, pan: -0.15 });
      V(a, ch[2], { when: t + beat * 1.5, vel: 0.15, dur: b, rel: 1.5, dest, pan: 0.1 });
      V(a, ch[3], { when: t + beat * 2, vel: 0.15, dur: b, rel: 1.5, dest, pan: 0.2 });
      const mel = [['E5', 'C5'], ['A4', 'C5'], ['G5', 'E5'], ['D5', 'B4']][i % 4];
      if (i % 8 >= 4) { V(a, mel[0], { when: t, vel: 0.2, dur: beat * 2, dest, rel: 1.5 }); V(a, mel[1], { when: t + beat * 2, vel: 0.17, dur: beat, dest, rel: 1.5 }); }
      if (Math.random() < 0.3) V(a, pick(['E6', 'A6', 'C7', 'B6']), { when: t + rand(0, b), vel: 0.07, dur: 1, rel: 2, dest, pan: rand(-0.6, 0.6) });
      return b;
    },
  },
  her: {
    bar(a, t, i, dest, st) {
      const beat = 0.95, b = beat * 4;
      const LH = [['Eb2', 'Bb2', 'F3', 'G3'], ['C2', 'G2', 'D3', 'Eb3'], ['Ab1', 'Eb2', 'C3', 'G3'], ['Bb1', 'F2', 'D3', 'G3'], ['Eb2', 'Bb2', 'F3', 'G3'], ['C2', 'G2', 'D3', 'Eb3'], ['Ab1', 'Eb2', 'C3', 'G3'], ['Bb1', 'F2', 'Ab3', 'D3']];
      const RH = [
        [['G5', 0, 2], ['F5', 2, 1], ['Eb5', 3, 1]], [['D5', 0, 3], ['Bb4', 3, 1]], [['C5', 0, 1], ['Eb5', 1, 1], ['G5', 2, 1], ['F5', 3, 1]], [['F5', 0, 4]],
        [['G5', 0, 1], ['Bb5', 1, 1], ['Ab5', 2, 2]], [['G5', 0, 2], ['F5', 2, 1], ['Eb5', 3, 1]], [['Eb5', 0, 2], ['C5', 2, 1], ['D5', 3, 1]], [['Eb5', 0, 4]],
      ];
      const k = i % 8, lh = LH[k];
      V(a, lh[0], { when: t, vel: 0.3, dur: b * 1.2, rel: 2, dest });
      [1, 2, 3, 2].forEach((s, j) => V(a, lh[s], { when: t + (j + 1) * beat * 0.75 + rand(0, 0.02), vel: 0.15, dur: b * 0.8, rel: 1.5, dest, pan: -0.1 + s * 0.06 }));
      const showMel = !st.sparse || i % 16 < 8;
      if (showMel) for (const [n, at, d] of RH[k]) V(a, n, { when: t + at * beat + rand(0, 0.03), vel: 0.26 + rand(0, 0.05), dur: d * beat * 1.05, rel: 1.6, dest, pan: 0.12 });
      return b * (k === 7 ? 1.25 : 1);
    },
  },
  loop: {
    bar(a, t, i, dest) {
      const beat = 0.88, b = beat * 4;
      const prog = [['Eb2', 'Bb2', 'D3', 'G3', 'Bb3'], ['G2', 'D3', 'F3', 'Bb3', 'D4'], ['C2', 'G2', 'Eb3', 'Bb3', 'D4'], ['Ab1', 'Eb2', 'C3', 'G3', 'C4']];
      const ch = prog[i % 4];
      V(a, ch[0], { when: t, vel: 0.3, dur: b * 1.1, rel: 2, dest, bright: 0.6 });
      [1, 2, 3, 4, 3, 2].forEach((s, j) => V(a, ch[s], { when: t + j * beat * 0.66, vel: 0.17, dur: b * 0.7, rel: 1.5, dest, bright: 0.6 }));
      const mel = [['G4', 'F4'], ['D4', 'F4'], ['Eb4', 'D4'], ['C4', 'Bb3']][i % 4];
      V(a, mel[0], { when: t + beat * 0.0, vel: 0.22, dur: beat * 2.5, rel: 1.5, dest, bright: 0.6, oct: 1 });
      V(a, mel[1], { when: t + beat * 2.5, vel: 0.2, dur: beat * 1.5, rel: 1.5, dest, bright: 0.6, oct: 1 });
      return b;
    },
  },
  red: { bar(a, t, i, dest) { const b = 7; V(a, pick(['C2', 'Db2', 'B1']), { when: t, vel: 0.25, dur: 6, rel: 3, dest, bright: 0.4 }); if (i % 2) a.chord(['F#2', 'G2', 'C3'], { when: t + 3, vel: 0.12, dur: 4, rel: 3, dest, bright: 0.4 }); return b; } },
  waltz: {
    bar(a, t, i, dest) {
      const beat = 1.0, b = beat * 3;
      const prog = [['Eb2', 'G3', 'Bb3'], ['C2', 'G3', 'Eb4'], ['Ab1', 'Ab3', 'C4'], ['Bb1', 'F3', 'D4']];
      const ch = prog[i % 4];
      V(a, ch[0], { when: t, vel: 0.28, dur: b, rel: 1.5, dest });
      V(a, ch[1], { when: t + beat, vel: 0.16, dur: beat * 1.5, rel: 1, dest }); V(a, ch[2], { when: t + beat, vel: 0.15, dur: beat * 1.5, rel: 1, dest });
      V(a, ch[1], { when: t + beat * 2, vel: 0.14, dur: beat * 1.5, rel: 1, dest }); V(a, ch[2], { when: t + beat * 2, vel: 0.13, dur: beat * 1.5, rel: 1, dest });
      const mel = ['G5', 'Eb5', 'C5', 'D5'][i % 4];
      V(a, mel, { when: t, vel: 0.22, dur: b * 0.95, rel: 1.5, dest });
      return b;
    },
  },
  end: { bar(a, t, i, dest, st) { st.sparse = true; const d = PIECES.her.bar(a, t, i, dest, st); return d * 1.15; } },
};

// ---------- jobs ----------
async function newEngine(seconds) {
  const piano = await loadPiano();
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  return new OEngine(ctx, piano);
}
// schedule a piece; returns the time the last scheduled bar ends
function schedulePiece(e, name, { start = 0, until = Infinity, bars = Infinity, dest }) {
  const st = {}; let t = start, i = 0;
  while (t < until && i < bars) { t += PIECES[name].bar(e, t, i, dest, st); i++; }
  return { end: t, bars: i };
}

const JOBS = {
  // music: piece rendered from t=0.05 to `dur`; post.py fades the last 4 s
  async music({ name, dur }) {
    const e = await newEngine(dur + 0.25); seed('music:' + name);
    const g = e.ctx.createGain(); g.connect(e.musicBus);
    const info = schedulePiece(e, name, { start: 0.05, until: dur, dest: g });
    return { e, info };
  },
  // seamless music loop: N bars from t=0 plus a tail; post.py folds the tail back onto the head
  async musicLoop({ name, bars, tail }) {
    const barDur = 0.88 * 4; const L = bars * barDur;
    const e = await newEngine(L + tail); seed('music:' + name);
    const g = e.ctx.createGain(); g.connect(e.musicBus);
    const info = schedulePiece(e, name, { start: 0, bars, dest: g });
    return { e, info: { ...info, loopSeconds: L, loopSamples: Math.round(L * SR) } };
  },
  // ambience: pre-roll + loop length + crossfade region, ticked at 60 fps like the game loop
  async amb({ name, layer, level, total, opt }) {
    const e = await newEngine(total); seed('amb:' + name);
    const a = e.makeAmb(layer, level, opt || {});
    if (a.tick) {
      const fps = 60, n = Math.floor(total * fps);
      for (let f = 0; f < n; f++) { const t = f / fps; e.now = t; a.tick(t); }
    }
    return { e, info: {} };
  },
  async step({ surface, index }) {
    const e = await newEngine(0.5); seed('steps:' + surface);
    e.steps = { [surface]: e.makeSteps(surface) }; // same 6 buffers as the game's bank for this surface
    e.now = 0.0; e.step(surface, index);
    return { e, info: {} };
  },
  async oneshot({ kind, seconds, arg }) {
    const e = await newEngine(seconds); seed('sfx:' + kind + ':' + (arg ?? ''));
    e.now = 0.005;
    if (kind === 'bell') e.bell(0.55, 392);
    else if (kind === 'glass') e.glass();
    else if (kind === 'whoosh') e.whoosh(arg);
    else if (kind === 'chime') e.chime();
    else if (kind === 'heartbeat') e.heartbeat(e.sfxBus, 0.6);
    else if (kind === 'creak') e.creak(e.sfxBus, 0);
    else if (kind === 'piano') e.note(arg, { vel: 0.18, dur: 1.5, rel: 1.5, dest: e.sfxBus, when: 0.005 }); // ui.js choice notes
    else if (kind === 'hold') { // holdTone(k) per frame while holding for 3 s, then released
      const fps = 60; for (let f = 0; f <= 3 * fps; f++) { e.now = f / fps; e.holdTone(f / (3 * fps)); }
      e.now = 3.0; e.holdTone(0);
    } else if (kind === 'tapestop') { // 4 s of `her`; tape stop over the last 1.6 s ending in the clunk
      const g = e.ctx.createGain(); g.connect(e.musicBus);
      schedulePiece(e, 'her', { start: 0.0, until: 4.0, dest: g });
      const stopAt = 4.0 - arg; e.now = stopAt; e.tapeStop(arg);
      // the tape has stopped: the recorded music (and its reverb) ends with the clunk
      g.gain.setTargetAtTime(0, 4.0, 0.02);
      e.revGain.gain.setTargetAtTime(0, 4.0, 0.05);
    }
    return { e, info: {} };
  },
};

window.__out = null;
window.renderJob = async (job) => {
  const t0 = performance.now();
  const { e, info } = await JOBS[job.type](job);
  const buf = await e.ctx.startRendering();
  const L = buf.length, c0 = buf.getChannelData(0), c1 = buf.getChannelData(1);
  const inter = new Float32Array(L * 2);
  for (let i = 0; i < L; i++) { inter[2 * i] = c0[i]; inter[2 * i + 1] = c1[i]; }
  window.__out = new Uint8Array(inter.buffer);
  return { ...info, frames: L, bytes: window.__out.length, ms: Math.round(performance.now() - t0) };
};
window.chunk = (off, n) => {
  const u = window.__out.subarray(off, off + n);
  let s = ''; const step = 0x8000;
  for (let i = 0; i < u.length; i += step) s += String.fromCharCode.apply(null, u.subarray(i, i + step));
  return btoa(s);
};
window.__ready = true;
