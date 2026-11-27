// DOM overlay: title, subtitles, choices, interaction prompt, pause/settings, chapters, ending card.
import { E, saveSettings, resize, togglePause, go, input } from './engine.js';
import { T, setLang, getLang } from './text.js';

const $ = (s) => document.querySelector(s);
const CHAPTERS = [['snow', 'ui.ch_snow'], ['garden', 'ui.ch_garden'], ['library', 'ui.ch_library'], ['road', 'ui.ch_road'], ['red', 'ui.ch_red'], ['bench', 'ui.ch_bench']];

export function initUI() {
  const ui = {
    choiceOpen: false,
    showLine(text, who) {
      const el = $('#line');
      el.className = 'line who-' + who;
      el.textContent = text;
      el.style.fontSize = `calc(var(--sub) * ${E.settings.subSize})`;
      el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
      if (who === 'radio') el.classList.add('flicker');
    },
    hideLine() { $('#line').classList.remove('show'); },
    showChoices(labels, cb) {
      const box = $('#choices');
      box.innerHTML = '';
      labels.forEach((l, i) => {
        const b = document.createElement('button');
        b.className = 'choice';
        b.innerHTML = `<span class="k">${i + 1}</span><span>${l}</span>`;
        b.addEventListener('click', (e) => { e.stopPropagation(); this.pickChoice(i); });
        box.appendChild(b);
      });
      box.classList.add('show');
      this.choiceOpen = true; this._cb = cb;
      E.allowUnlock = true; document.exitPointerLock?.();
      E.blockLook = true;
    },
    pickChoice(i) {
      if (!this.choiceOpen) return;
      const btns = [...document.querySelectorAll('#choices .choice')];
      if (!btns[i]) return;
      btns[i].classList.add('picked');
      E.audio?.note?.(['G4', 'Bb4', 'D5'][i] || 'G4', { vel: 0.18, dur: 1.5, rel: 1.5, dest: E.audio.sfxBus });
      this.choiceOpen = false;
      setTimeout(() => { this.hideChoices(); E.allowUnlock = false; E.blockLook = false; this._cb?.(i); }, E.manual ? 0 : 450);
    },
    hideChoices() { $('#choices').classList.remove('show'); this.choiceOpen = false; },
    setPrompt(text, progress = -1, seen = false) {
      const p = $('#prompt'), dot = $('#dot');
      if (!text) { p.classList.remove('show'); dot.classList.remove('focus'); $('#ring').style.opacity = 0; return; }
      $('#prompt .label').textContent = text;
      $('#prompt .act').textContent = progress >= 0 ? `${touchy() ? 'tap' : 'E'} · ${T('ui.hold')}` : (touchy() ? 'tap' : 'E');
      $('#prompt .seen').textContent = seen ? T('ui.seen') : '';
      p.classList.add('show'); dot.classList.add('focus');
      const ring = $('#ring circle');
      ring.style.strokeDashoffset = String(113 * (1 - Math.max(progress, 0)));
      $('#ring').style.opacity = progress > 0 ? 1 : 0;
    },
    hint(text, sticky = false) {
      const h = $('#hint');
      if (!text) { h.classList.remove('show'); return; }
      h.textContent = text; h.classList.add('show');
      clearTimeout(this._ht);
      if (!sticky) this._ht = setTimeout(() => h.classList.remove('show'), 6000);
    },
    loading(on) { $('#loading').classList.toggle('show', on); },
    toast(text) { const t = $('#toast'); t.textContent = text; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3500); },
    chapter(id) {
      const map = { blizzard: 'snow', garden: 'garden', library: 'library', road: 'road', red1: 'red', red2: 'red', red3: 'red', bench: 'bench' };
      const ch = map[id];
      if (ch) { E.flags['ch_' + ch] = true; import('./engine.js').then(m => m.saveProgress()); }
    },
    pause(p) {
      $('#pause').classList.toggle('show', p);
      if (p) buildChapters();
    },
    title(show) { $('#title').classList.toggle('show', show); },
    showEnd(closed) {
      const e = $('#end');
      $('#end .closed').textContent = closed ? T('end.closed') : '';
      e.classList.add('show');
      E.allowUnlock = true; document.exitPointerLock?.();
    },
    crosshair(on) { $('#dot').style.opacity = on ? '' : '0'; },
  };
  E.ui = ui;
  applyTexts();
  wireSettings();
  return ui;
}
function touchy() { return matchMedia('(pointer: coarse)').matches; }

export function applyTexts() {
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = T(el.dataset.t); });
  $('#ctrl').textContent = touchy() ? T('ui.controls_touch') : T('ui.controls');
  document.querySelectorAll('.lang button').forEach(b => b.classList.toggle('on', b.dataset.lang === getLang()));
  document.querySelectorAll('.q button').forEach(b => b.classList.toggle('on', b.dataset.q === E.settings.quality));
  document.body.classList.toggle('ko', getLang() === 'ko');
}

function wireSettings() {
  document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    E.settings.lang = b.dataset.lang; setLang(b.dataset.lang); saveSettings(); applyTexts(); buildChapters();
  }));
  document.querySelectorAll('.q button').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    E.settings.quality = b.dataset.q; saveSettings(); resize(); applyTexts();
  }));
  const sliders = { master: 'master', music: 'music', sfx: 'sfx', bright: 'bright', sens: 'sens', subSize: 'subSize' };
  for (const [id, key] of Object.entries(sliders)) {
    const el = document.getElementById('s-' + id); if (!el) continue;
    el.value = E.settings[key];
    el.addEventListener('input', () => {
      E.settings[key] = +el.value; saveSettings();
      if (['master', 'music', 'sfx'].includes(key)) E.audio?.setVolumes({ master: E.settings.master, music: E.settings.music, sfx: E.settings.sfx });
      if (key === 'bright') E.post.fx.bright = E.settings.bright;
      if (key === 'subSize') { E.ui.showLine(T('s0.him_where'), 'him'); clearTimeout(E._subT); E._subT = setTimeout(() => E.ui.hideLine(), 1600); }
    });
    // play the related sound once when a volume setting changes
    el.addEventListener('change', () => {
      if (!E.audio?.ready) return;
      if (key === 'music' || key === 'master') E.audio.note('G4', { vel: 0.3, dur: 1.2, rel: 1 });
      if (key === 'sfx') E.audio.step('snow', 1.5);
    });
  }
  $('#resume').addEventListener('click', (e) => { e.stopPropagation(); togglePause(false); requestLock(); });
  $('#again').addEventListener('click', () => location.reload());
}
function requestLock() { if (!touchy()) E.renderer.domElement.requestPointerLock?.()?.catch?.(() => {}); }

function buildChapters() {
  const box = $('#chapters'); if (!box) return;
  box.innerHTML = '';
  const unlocked = { ...(E.savedFlags || {}), ...E.flags };
  for (const [id, key] of CHAPTERS) {
    const b = document.createElement('button');
    b.textContent = T(key);
    b.disabled = !unlocked['ch_' + id] && !E.debug;
    b.addEventListener('click', (e) => { e.stopPropagation(); togglePause(false); requestLock(); E.jumpChapter?.(id); });
    box.appendChild(b);
  }
}
