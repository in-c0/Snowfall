// Audio: piano sampler + generative score, synthesized ambience & foley, HRTF-positioned cues.
const NOTE_FILES = ['A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7'];
const NAME_TO_SEMI = { C: 0, Cs: 1, D: 2, Ds: 3, E: 4, F: 5, Fs: 6, G: 7, Gs: 8, A: 9, As: 10, B: 11 };
function fileMidi(n) { const m = n.match(/^([A-G]s?)(\d)$/); return 12 * (+m[2] + 1) + NAME_TO_SEMI[m[1]]; }
// note-name parser for scores: 'Eb5', 'F#4', 'C4'
export function midi(n) {
  if (typeof n === 'number') return n;
  const m = n.match(/^([A-G])([#b]?)(-?\d)$/);
  let s = NAME_TO_SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 12 * (+m[3] + 1) + s;
}
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class AudioEngine {
  constructor() { this.ready = false; this.samples = new Map(); this.music = null; this.voices = new Set(); this.vol = { master: 0.9, music: 0.8, sfx: 0.9 }; }

  async init() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    const makeup = ctx.createGain(); makeup.gain.value = 2.6; // headroom was too generous; the compressor catches peaks
    this.master.connect(makeup).connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.sfxBus = ctx.createGain(); this.ambBus = ctx.createGain();
    // music: lowpass ("through a wall") + tape-stop detune source
    this.musicLP = ctx.createBiquadFilter(); this.musicLP.type = 'lowpass'; this.musicLP.frequency.value = 18000; this.musicLP.Q.value = 0.5;
    this.musicBus.connect(this.musicLP).connect(this.master);
    this.sfxBus.connect(this.master); this.ambBus.connect(this.master);
    // reverb send
    this.rev = ctx.createConvolver(); this.rev.buffer = this.makeIR(3.8, 2.2);
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.55;
    this.rev.connect(this.revGain).connect(this.master);
    this.hall = ctx.createConvolver(); this.hall.buffer = this.makeIR(6.5, 1.6);
    this.hallGain = ctx.createGain(); this.hallGain.gain.value = 0.0;
    this.hall.connect(this.hallGain).connect(this.master);
    this.musicSend = ctx.createGain(); this.musicSend.gain.value = 0.5; this.musicBus.connect(this.musicSend).connect(this.rev);
    // tape detune (shared): connected to every piano voice's detune
    this.tapeDetune = ctx.createConstantSource(); this.tapeDetune.offset.value = 0; this.tapeDetune.start();
    this.wow = ctx.createOscillator(); this.wow.frequency.value = 0.55; this.wowGain = ctx.createGain(); this.wowGain.gain.value = 6;
    this.wow.connect(this.wowGain); this.wow.start();
    this.flutter = ctx.createOscillator(); this.flutter.frequency.value = 6.3; this.flutterGain = ctx.createGain(); this.flutterGain.gain.value = 1.5;
    this.flutter.connect(this.flutterGain); this.flutter.start();
    // noise buffers
    this.white = this.noiseBuf(4, 'white'); this.pink = this.noiseBuf(6, 'pink'); this.brown = this.noiseBuf(6, 'brown');
    this.crackleBuf = this.makeCrackle(8);
    this.steps = { snow: this.makeSteps('snow'), wood: this.makeSteps('wood'), leaves: this.makeSteps('leaves'), grass: this.makeSteps('grass'), stone: this.makeSteps('stone') };
    this.setVolumes(this.vol);
    this.ready = true;
    // load piano (non-blocking for the first scene)
    this.pianoReady = this.loadPiano();
  }
  setVolumes({ master, music, sfx }) {
    this.vol = { master, music, sfx };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(music * 1.7, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(sfx, t, 0.05);
    this.ambBus.gain.setTargetAtTime(sfx * 0.9, t, 0.05);
  }
  pause(p) { if (!this.ctx) return; if (p) this.ctx.suspend(); else this.ctx.resume(); }

  async loadPiano() {
    await Promise.all(NOTE_FILES.map(async (n) => {
      try {
        const r = await fetch(`assets/piano/${n}.mp3`);
        const b = await this.ctx.decodeAudioData(await r.arrayBuffer());
        this.samples.set(fileMidi(n), b);
      } catch (e) { console.warn('piano sample', n, e); }
    }));
    this.sampleKeys = [...this.samples.keys()].sort((a, b) => a - b);
  }

  // ---------- buffers ----------
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
        // compacting snow: dense micro-crackles, two-part (heel, toe)
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
      } else { // wood / stone: thump + click (+ creak for wood)
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

  // ---------- generic players ----------
  src(buf, { rate = 1, gain = 1, dest = this.sfxBus, loop = false, when = 0, pan = 0, send = 0, hall = 0, filter = null } = {}) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; s.loop = loop;
    const g = ctx.createGain(); g.gain.value = gain;
    let node = s;
    if (filter) { const f = ctx.createBiquadFilter(); Object.assign(f, {}); f.type = filter.type; f.frequency.value = filter.freq; f.Q.value = filter.q ?? 0.7; node.connect(f); node = f; }
    let out = g;
    node.connect(g);
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    out.connect(dest);
    if (send) { const sg = ctx.createGain(); sg.gain.value = send; out.connect(sg).connect(this.rev); }
    if (hall) { const hg = ctx.createGain(); hg.gain.value = hall; out.connect(hg).connect(this.hall); }
    s.start(when || ctx.currentTime);
    return { s, g };
  }

  // ---------- piano ----------
  note(n, { vel = 0.5, when = 0, dur = 1.2, rel = 0.8, oct = 0, pan = 0, bright = 1, dest = null } = {}) {
    if (!this.sampleKeys?.length) return;
    const m = midi(n) + oct * 12;
    let best = this.sampleKeys[0];
    for (const k of this.sampleKeys) if (Math.abs(k - m) < Math.abs(best - m)) best = k;
    const ctx = this.ctx, t = when || ctx.currentTime;
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
    this.voices.add(s); s.onended = () => this.voices.delete(s);
  }
  chord(notes, opts = {}) { notes.forEach((n, i) => this.note(n, { ...opts, when: (opts.when || this.ctx.currentTime) + i * (opts.roll ?? 0.0), vel: (opts.vel ?? 0.4) * (i === 0 ? 1 : 0.85) })); }

  // ---------- music sequencer ----------
  playMusic(name, { fadeIn = 3 } = {}) {
    if (!this.ready) return;
    if (this.music?.name === name) return;
    this.stopMusic(2.5);
    const piece = PIECES[name]; if (!piece) return;
    this.music = { name, piece, next: this.ctx.currentTime + 0.3, bar: 0, gain: this.ctx.createGain() };
    this.music.gain.gain.value = 0;
    this.music.gain.connect(this.musicBus);
    this.music.gain.gain.setTargetAtTime(1, this.ctx.currentTime, fadeIn / 3);
  }
  stopMusic(fade = 2) {
    if (!this.music) return;
    const m = this.music; this.music = null;
    m.gain.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    setTimeout(() => m.gain.disconnect(), fade * 1500 + 500);
  }
  schedule() {
    const m = this.music; if (!m || !this.sampleKeys?.length) return;
    const ahead = this.ctx.currentTime + 0.6;
    while (m.next < ahead) {
      const barDur = m.piece.bar(this, m.next, m.bar, m.gain, m);
      m.next += barDur; m.bar++;
    }
  }
  tapeStop(dur = 1.4) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tapeDetune.offset.cancelScheduledValues(t);
    this.tapeDetune.offset.setValueAtTime(0, t);
    this.tapeDetune.offset.linearRampToValueAtTime(-3600, t + dur);
    this.musicLP.frequency.cancelScheduledValues(t);
    this.musicLP.frequency.setValueAtTime(this.musicLP.frequency.value, t);
    this.musicLP.frequency.exponentialRampToValueAtTime(200, t + dur);
    // the mechanical clunk
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.setValueAtTime(140, t + dur); o.frequency.exponentialRampToValueAtTime(40, t + dur + 0.15);
    g.gain.setValueAtTime(0.0001, t); g.gain.setValueAtTime(0.4, t + dur); g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.2);
    o.connect(g).connect(this.sfxBus); o.start(t); o.stop(t + dur + 0.3);
    this.src(this.white, { gain: 0.12, when: t + dur, filter: { type: 'bandpass', freq: 2500, q: 0.6 } }).s.stop(t + dur + 0.05);
    // ambience drops too
    this.fadeAmb(0, dur * 0.8);
    setTimeout(() => this.resetTape(), (dur + 0.6) * 1000);
  }
  resetTape() {
    const t = this.ctx.currentTime;
    this.stopMusic(0.05);
    this.voices.forEach(v => { try { v.stop(); } catch (e) { /* already stopped */ } });
    this.tapeDetune.offset.cancelScheduledValues(t); this.tapeDetune.offset.setValueAtTime(0, t);
    this.musicLP.frequency.cancelScheduledValues(t); this.musicLP.frequency.setValueAtTime(18000, t);
  }
  setWow(depth = 6, flutter = 1.5) { if (!this.ctx) return; this.wowGain.gain.setTargetAtTime(depth, this.ctx.currentTime, 0.5); this.flutterGain.gain.setTargetAtTime(flutter, this.ctx.currentTime, 0.5); }
  muffle(freq = 18000, t = 1) { if (!this.ctx) return; this.musicLP.frequency.setTargetAtTime(freq, this.ctx.currentTime, t / 3); }

  // ---------- ambience layers ----------
  amb(name, level, t = 2) {
    if (!this.ctx) return;
    this.ambs ??= {};
    let a = this.ambs[name];
    if (!a) a = this.ambs[name] = this.makeAmb(name);
    if (!a) return;
    a.level = level;
    a.g.gain.setTargetAtTime(level, this.ctx.currentTime, t / 3);
  }
  fadeAmb(level = 0, t = 1) { if (!this.ambs) return; for (const k in this.ambs) { this.ambs[k].g.gain.setTargetAtTime(level * (this.ambs[k].level ?? 0), this.ctx.currentTime, t / 3); } }
  makeAmb(name) {
    const ctx = this.ctx, g = ctx.createGain(); g.gain.value = 0; g.connect(this.ambBus);
    const a = { g, nodes: [] };
    if (name === 'wind') {
      // body
      const s1 = this.src(this.pink, { loop: true, gain: 1, dest: g, filter: { type: 'bandpass', freq: 400, q: 0.6 } });
      const s2 = this.src(this.brown, { loop: true, gain: 0.8, dest: g, filter: { type: 'lowpass', freq: 300, q: 0.5 } });
      // howl: resonant band that drifts
      const hs = ctx.createBufferSource(); hs.buffer = this.white; hs.loop = true;
      const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 700; hf.Q.value = 9;
      const hg = ctx.createGain(); hg.gain.value = 0.25;
      const hp = ctx.createStereoPanner(); hp.pan.value = 0.3;
      hs.connect(hf).connect(hg).connect(hp).connect(g); hs.start();
      a.howl = hf; a.howlG = hg; a.howlP = hp; a.body = s1;
      a.tick = (t) => {
        const gust = 0.6 + 0.4 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1);
        hf.frequency.setTargetAtTime(500 + 500 * gust + 120 * Math.sin(t * 0.7), ctx.currentTime, 0.4);
        hg.gain.setTargetAtTime(0.08 + 0.3 * gust * gust, ctx.currentTime, 0.5);
        hp.pan.setTargetAtTime(Math.sin(t * 0.17) * 0.6, ctx.currentTime, 0.8);
      };
    } else if (name === 'birds') {
      a.tick = (t) => { if (Math.random() < 0.012) this.birdSong(g); };
      this.src(this.pink, { loop: true, gain: 0.06, dest: g, filter: { type: 'highpass', freq: 2000 } }); // leaves rustle
    } else if (name === 'room') {
      this.src(this.brown, { loop: true, gain: 0.25, dest: g, filter: { type: 'lowpass', freq: 160 } });
      a.tick = () => { if (Math.random() < 0.002) this.creak(g); };
    } else if (name === 'clock') {
      a.tick = (t) => { const s = Math.floor(t); if (s !== a.last) { a.last = s; this.tickTock(g, s % 2); } };
    } else if (name === 'vinyl') {
      this.src(this.crackleBuf, { loop: true, gain: 1.2, dest: g, filter: { type: 'highpass', freq: 800 } });
    } else if (name === 'drone') {
      for (const [f, d] of [[55, 0], [55.4, 0], [82.4, 0], [110.9, 0]]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; const og = ctx.createGain(); og.gain.value = 0.08; o.connect(lp).connect(og).connect(g); o.start(); }
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 0.3; lfo.connect(lg).connect(g.gain); lfo.start();
    } else if (name === 'heart') {
      a.tick = (t) => { const beat = Math.floor(t / 1.05); if (beat !== a.last) { a.last = beat; this.heartbeat(g); } };
    } else if (name === 'fire') {
      this.src(this.brown, { loop: true, gain: 0.25, dest: g, filter: { type: 'lowpass', freq: 400 } });
      this.src(this.crackleBuf, { loop: true, gain: 3, dest: g, rate: 0.6, filter: { type: 'bandpass', freq: 1800, q: 0.5 } });
    } else if (name === 'kids') {
      a.tick = () => { if (Math.random() < 0.02) this.kidVoice(g); };
    } else if (name === 'radio') {
      const s = this.src(this.white, { loop: true, gain: 0.5, dest: g, filter: { type: 'bandpass', freq: 1700, q: 1.2 } });
      this.src(this.crackleBuf, { loop: true, gain: 4, dest: g });
      a.tick = (t) => { s.g.gain.setTargetAtTime(0.25 + 0.25 * Math.abs(Math.sin(t * 3.1) * Math.sin(t * 1.7)), ctx.currentTime, 0.05); };
    } else if (name === 'hum') { // warm interior tone
      const o = ctx.createOscillator(); o.frequency.value = 60; const og = ctx.createGain(); og.gain.value = 0.03; o.connect(og).connect(g); o.start();
      this.src(this.pink, { loop: true, gain: 0.12, dest: g, filter: { type: 'lowpass', freq: 500 } });
    } else return null;
    return a;
  }

  // ---------- one-shots ----------
  step(surface = 'snow', speed = 1.5, opts = {}) {
    if (!this.ready) return;
    const bank = this.steps[surface] || this.steps.snow;
    const f = { snow: [{ type: 'bandpass', freq: 2400, q: 0.5 }], leaves: [{ type: 'highpass', freq: 900 }], grass: [{ type: 'bandpass', freq: 3500, q: 0.4 }], wood: [{ type: 'lowpass', freq: 2500 }], stone: [{ type: 'lowpass', freq: 3500 }] }[surface] || [];
    this.src(pick(bank), { rate: rand(0.88, 1.12), gain: (opts.gain ?? 0.55) * Math.min(0.5 + speed / 3, 1.2), filter: f[0], pan: rand(-0.08, 0.08), send: opts.send ?? 0.06, hall: opts.hall ?? 0 });
  }
  bell(panner = { x: 0, y: 1.6, z: 8 }, gain = 0.5, base = 392) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 4;
    p.positionX.value = panner.x; p.positionY.value = panner.y; p.positionZ.value = panner.z;
    const out = ctx.createGain(); out.gain.value = gain;
    out.connect(p).connect(this.sfxBus);
    const sg = ctx.createGain(); sg.gain.value = 0.9; out.connect(sg).connect(this.rev);
    const partials = [[0.5, 1, 7], [1, 0.8, 5], [1.19, 0.5, 3.5], [1.56, 0.35, 3], [2.0, 0.4, 2.5], [2.51, 0.2, 1.8], [2.66, 0.18, 1.6], [3.01, 0.12, 1.2], [4.1, 0.08, 0.8]];
    for (const [r, a, d] of partials) {
      const o = ctx.createOscillator(); o.frequency.value = base * r * (1 + rand(-0.002, 0.002));
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a * 0.25, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + d * 1.6);
      o.connect(g).connect(out); o.start(t); o.stop(t + d * 1.7);
    }
  }
  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) { L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t); L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t); L.upX.setValueAtTime(up.x, t); L.upY.setValueAtTime(up.y, t); L.upZ.setValueAtTime(up.z, t); }
    else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
  }
  birdSong(dest) {
    const ctx = this.ctx, t0 = ctx.currentTime + rand(0, 0.3);
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
  creak(dest) {
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(rand(70, 120), t); o.frequency.linearRampToValueAtTime(rand(60, 140), t + 0.6);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = rand(500, 900); f.Q.value = 8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 0.2); g.gain.linearRampToValueAtTime(0, t + 0.7);
    const pn = ctx.createStereoPanner(); pn.pan.value = rand(-1, 1);
    o.connect(f).connect(g).connect(pn).connect(dest); pn.connect(this.rev); o.start(t); o.stop(t + 0.8);
  }
  tickTock(dest, alt) {
    const ctx = this.ctx, t = ctx.currentTime;
    this.src(this.white, { gain: 0.05, dest, filter: { type: 'bandpass', freq: alt ? 3200 : 2600, q: 6 } }).s.stop(t + 0.02);
  }
  heartbeat(dest = this.sfxBus, gain = 0.6) {
    const ctx = this.ctx;
    for (const [dt, a] of [[0, 1], [0.28, 0.7]]) {
      const t = ctx.currentTime + dt, o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(62, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.15);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a * gain, t + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g).connect(dest); o.start(t); o.stop(t + 0.25);
    }
  }
  glass() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.src(this.white, { gain: 0.4, filter: { type: 'highpass', freq: 2500 }, send: 0.3 }).g.gain.setTargetAtTime(0, t + 0.02, 0.05);
    for (let i = 0; i < 26; i++) {
      const tt = t + Math.pow(Math.random(), 2) * 0.5, o = ctx.createOscillator(), g = ctx.createGain(), f = rand(2800, 9000);
      o.frequency.value = f; g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(rand(0.02, 0.07), tt + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, tt + rand(0.05, 0.4));
      const pn = ctx.createStereoPanner(); pn.pan.value = rand(-0.6, 0.6);
      o.connect(g).connect(pn).connect(this.sfxBus); pn.connect(this.rev); o.start(tt); o.stop(tt + 0.5);
    }
  }
  whoosh(dur = 1.5, up = true) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const { s, g } = this.src(this.pink, { gain: 0, filter: { type: 'bandpass', freq: 600, q: 1.2 }, send: 0.4 });
    g.gain.linearRampToValueAtTime(0.5, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    s.stop(t + dur + 0.1);
  }
  chime() { // memory remembered
    if (!this.sampleKeys?.length) return;
    const t = this.ctx.currentTime;
    ['Eb5', 'Bb5', 'G6', 'D7'].forEach((n, i) => this.note(n, { vel: 0.28 - i * 0.04, when: t + i * 0.11, dur: 2.5, rel: 2, dest: this.sfxBus }));
  }
  holdTone(k) {
    if (!this.ctx) return;
    if (!this.hold) {
      const o = this.ctx.createOscillator(), o2 = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
      o.type = 'sine'; o2.type = 'sine'; o.frequency.value = 196; o2.frequency.value = 293.7; f.type = 'lowpass'; f.frequency.value = 900;
      g.gain.value = 0; o.connect(f); o2.connect(f); f.connect(g).connect(this.sfxBus); const sg = this.ctx.createGain(); sg.gain.value = 0.6; g.connect(sg).connect(this.rev);
      o.start(); o2.start(); this.hold = { o, o2, g };
    }
    const t = this.ctx.currentTime;
    this.hold.g.gain.setTargetAtTime(k > 0 ? 0.025 + k * 0.035 : 0, t, k > 0 ? 0.05 : 0.15);
    this.hold.o.frequency.setTargetAtTime(196 * (1 + k * 0.5), t, 0.05); this.hold.o2.frequency.setTargetAtTime(293.7 * (1 + k * 0.5), t, 0.05);
  }
  lineCue(who) { /* lines are silent by design: the score and room tone carry them */ }
  kidVoice(dest) {
    // distant child laugh / call: buzzy source through child formants, chopped into syllables
    const ctx = this.ctx, t0 = ctx.currentTime;
    const laugh = Math.random() < 0.6;
    const n = laugh ? Math.floor(rand(3, 7)) : 1;
    const f0 = rand(330, 480);
    const out = ctx.createGain(); out.gain.value = rand(0.025, 0.06);
    const pn = ctx.createStereoPanner(); pn.pan.value = rand(-0.9, 0.9);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    out.connect(lp).connect(pn).connect(dest); const sg = ctx.createGain(); sg.gain.value = 1.2; pn.connect(sg).connect(this.rev);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const formants = [[1000, 6, 1], [1700, 8, 0.6], [3000, 10, 0.25]].map(([f, q, a]) => { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f * rand(0.9, 1.1); b.Q.value = q; const g = ctx.createGain(); g.gain.value = a; o.connect(b).connect(g).connect(out); return b; });
    const amp = ctx.createGain(); amp.gain.value = 0; out.gain.value *= 1; // envelope via out
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
  update(dt) {
    if (!this.ctx) return;
    this.schedule();
    const t = this.ctx.currentTime;
    if (this.ambs) for (const k in this.ambs) this.ambs[k].tick?.(t);
  }
  sceneChange() { /* ambience persists unless scenes change it */ }
  setHall(v, t = 2) { if (this.ctx) this.hallGain.gain.setTargetAtTime(v, this.ctx.currentTime, t / 3); }
  setRev(v, t = 2) { if (this.ctx) this.revGain.gain.setTargetAtTime(v, this.ctx.currentTime, t / 3); }
  stopAllAmb(t = 2) { if (!this.ambs) return; for (const k in this.ambs) { this.ambs[k].level = 0; this.ambs[k].g.gain.setTargetAtTime(0, this.ctx.currentTime, t / 3); } }
}

// ---------- the score ----------
// Each piece: bar(audio, time, barIndex, dest, state) schedules one bar and returns its duration (seconds).
const V = (a, n, o) => a.note(n, o);
const PIECES = {
  // sparse low tones in the storm
  blizzard: {
    bar(a, t, i, dest) {
      const dur = 6.5;
      const lows = ['D2', 'A1', 'F2', 'C2'];
      V(a, lows[i % 4], { when: t, vel: 0.22, dur: 6, rel: 3, dest, bright: 0.5 });
      if (i % 2 === 1) V(a, pick(['A4', 'E5', 'F5', 'D5', 'C5']), { when: t + rand(1.5, 4), vel: 0.16, dur: 3, rel: 3, dest, pan: rand(-0.4, 0.4) });
      return dur;
    },
  },
  // garden: warm, open, lydian
  garden: {
    bar(a, t, i, dest) {
      const b = 3.6;
      const prog = [['F2', 'C3', 'A3', 'E4', 'G4'], ['A2', 'E3', 'G3', 'C4', 'E4'], ['Bb2', 'F3', 'A3', 'D4', 'E4'], ['C3', 'G3', 'D4', 'E4', 'A4']];
      const ch = prog[i % 4];
      const steps = [0, 1, 2, 3, 4, 3, 2, 1];
      steps.forEach((s, k) => V(a, ch[s], { when: t + k * (b / 8) + rand(0, 0.02), vel: k === 0 ? 0.32 : 0.18 + rand(0, 0.06), dur: b, rel: 1.5, dest, pan: (s - 2) * 0.12 }));
      if (i % 2 === 0) { const mel = ['C6', 'A5', 'G5', 'E6', 'D6', 'F5']; V(a, pick(mel), { when: t + b * 0.5, vel: 0.14, dur: 2, rel: 2, dest, pan: 0.3 }); }
      return b;
    },
  },
  // library: 3/4 broken waltz, music-box sparkle
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
  // her theme (Eb major): two 4-bar phrases over broken left hand
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
      return b * (k === 7 ? 1.25 : 1); // ritardando at phrase end
    },
  },
  // the loop: identical every time, on purpose
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
  // red rooms: no melody, low clusters
  red: {
    bar(a, t, i, dest) {
      const b = 7;
      V(a, pick(['C2', 'Db2', 'B1']), { when: t, vel: 0.25, dur: 6, rel: 3, dest, bright: 0.4 });
      if (i % 2) a.chord(['F#2', 'G2', 'C3'], { when: t + 3, vel: 0.12, dur: 4, rel: 3, dest, bright: 0.4 });
      return b;
    },
  },
  // the special day: slow warm waltz (library harmony, lower)
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
  // ending: her theme, slower, sparse, then unresolved
  end: {
    bar(a, t, i, dest, st) { st.sparse = true; const d = PIECES.her.bar(a, t, i, dest, st); return d * 1.15; },
  },
};
