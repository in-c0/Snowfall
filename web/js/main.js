import * as THREE from 'three';
import { E, initRenderer, initInput, start, go, registerScene, player, togglePause, input, stepFrame, sim, renderOnce } from './engine.js';
import { initUI, applyTexts } from './ui.js';
import { AudioEngine } from './audio.js';
import { blizzardScene } from './scenes/blizzard.js';
import { libraryScene } from './scenes/library.js';
import { parkScene } from './scenes/park.js';
import { fieldScene } from './scenes/field.js';
import { roadScene } from './scenes/road.js';
import { redScene } from './scenes/red.js';

const canvas = document.getElementById('gl');
initRenderer(canvas);
initInput(canvas);
initUI();
E.audio = new AudioEngine();
E.post.fx.bright = E.settings.bright;

registerScene('blizzard', (o) => blizzardScene({ mode: 'intro', ...o }));
registerScene('bench', (o) => blizzardScene({ mode: 'end', ...o }));
// the hub is built once and kept: returning from a memory is instant
let hub = null;
const getHub = (o) => (hub ??= libraryScene(o));
registerScene('garden', (o) => getHub({ wake: true, ...o }));
registerScene('library', (o) => getHub(o));
registerScene('park', (o) => parkScene(o));
registerScene('field', (o) => fieldScene(o));
registerScene('road', (o) => roadScene(o));
registerScene('red1', (o) => redScene({ frag: 1, ...o }));
registerScene('red2', (o) => redScene({ frag: 2, ...o }));
registerScene('red3', (o) => redScene({ frag: 3, ...o }));

E.jumpChapter = (id) => {
  const f = E.flags;
  if (id === 'snow') { go('blizzard'); }
  if (id === 'garden') { go('garden'); }
  if (id === 'library') { Object.assign(f, { woke: true }); go('library', { spawn: 'hall' }); }
  if (id === 'road') { Object.assign(f, { woke: true, m_park: true }); go('road', { visit: 1 }); }
  if (id === 'red') { Object.assign(f, { woke: true, m_park: true, road1: true, m_field: true, m_cherry: true, radio: true }); go('red1'); }
  if (id === 'bench') { go('bench'); }
};

async function boot() {
  const params = new URLSearchParams(location.search);
  const sceneParam = params.get('scene');
  if (params.has('manual')) { E.manual = true; E.settings.quality = params.get('q') || 'low'; (await import('./engine.js')).resize(); }
  start();
  if (sceneParam) {
    // debug / screenshot entry: skip the title
    Object.assign(E.flags, JSON.parse(params.get('flags') || '{}'));
    E.started = true; E.paused = false;
    document.getElementById('title').classList.remove('show');
    try { await E.audio.init(); } catch (e) { /* headless */ }
    await go(sceneParam, { fadeIn: E.manual ? 0 : 1.5, ...JSON.parse(params.get('opts') || '{}') });
    E.ready = true;
    return;
  }
  // title: the storm plays behind the menu
  await go('blizzard', { titleMode: true, fadeIn: 3 });
  E.ui.title(true);
  E.ready = true;
  document.getElementById('begin').addEventListener('click', begin, { once: true });
}

async function begin(e) {
  e?.stopPropagation();
  await E.audio.init();
  E.audio.setVolumes({ master: E.settings.master, music: E.settings.music, sfx: E.settings.sfx });
  E.ui.title(false);
  if (!matchMedia('(pointer: coarse)').matches) canvas.requestPointerLock?.()?.catch?.(() => {});
  else { E.freeMouse = true; document.documentElement.requestFullscreen?.().catch(() => {}); }
  E.started = true; E.paused = false;
  E.sceneObj?.begin?.();
}

// debugging / automated screenshots
window.SF = { E, go, player, THREE, input, stepFrame, togglePause, sim, renderOnce };
boot();
