#!/usr/bin/env python3
"""Dump Snowfall three.js scenes into SourceArt/Scenes/<level>/ (format: SourceArt/SCENE_FORMAT.md).

usage: python3 dump.py L_Blizzard [L_Bench ...]      (default: the five finished levels)
Also captures the original game's view from every Shot / OpeningCam marker (same page load, so the random
placements match the export) into tools/dumper/checks/<level>/orig_<shot>.png.
"""
import base64, json, os, shutil, sys, time
from urllib.parse import quote
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_ROOT = '/home/claude/ue/Snowfall/SourceArt/Scenes'
GAME = '/home/claude/snowfall'
BASE = 'http://localhost:8765/dev.html'
LEVELS = {
    'L_Blizzard': ('blizzard', {}, {}),
    'L_Bench': ('bench', {}, {}),
    'L_Library': ('library', {'spawn': 'hall'}, {'woke': True}),
    'L_Park': ('park', {}, {}),
    'L_Field': ('field', {}, {}),
    'L_Road': ('road', {'visit': 1}, {'woke': True, 'm_park': True}),
    'L_Red': ('red3', {}, {'woke': True, 'm_park': True, 'road1': True, 'm_field': True, 'm_cherry': True, 'radio': True, 'r1': True, 'r2': True}),
}
W, H = 960, 540
CHECK_FOG = 0.35   # fog density factor for the comparison captures (must match view.py FOG)
T0 = time.time()
def log(*a): print(f'{time.time()-T0:7.1f}s', *a, flush=True)

def dump_level(pw, level):
    scene_id, opts, flags = LEVELS[level]
    out = os.path.join(OUT_ROOT, level)
    if os.path.isdir(out): shutil.rmtree(out)
    os.makedirs(out)
    chk = os.path.join(HERE, 'checks', level)
    if os.path.isdir(chk): shutil.rmtree(chk)
    os.makedirs(chk)
    models = sorted(f[:-4] for f in os.listdir(os.path.join(GAME, 'assets/models')) if f.endswith('.glb'))
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--max-old-space-size=4096'])
    pg = b.new_page(viewport={'width': W, 'height': H})
    pg.set_default_timeout(0)
    pg.on('console', lambda m: log(f'[{m.type}] {m.text[:400]}') if ('[dump]' in m.text or m.type == 'error') else None)
    pg.on('pageerror', lambda e: log('[pageerror]', e))
    written = {'n': 0, 'bytes': 0}
    def sf_save(path, data, append):
        p = os.path.normpath(os.path.join(out, path))
        assert p.startswith(out + os.sep), path
        os.makedirs(os.path.dirname(p), exist_ok=True)
        raw = base64.b64decode(data) if data else b''
        with open(p, 'ab' if append else 'wb') as f: f.write(raw)
        if not append: written['n'] += 1
        written['bytes'] += len(raw)
        return True
    pg.expose_function('sfSave', sf_save)
    url = f"{BASE}?scene={scene_id}&manual&q=high&opts={quote(json.dumps(opts))}&flags={quote(json.dumps(flags))}"
    log(level, url)
    pg.goto(url)
    pg.wait_for_function('window.SF && window.SF.E.ready', timeout=300000, polling=500)
    log('ready; simulating 2 s')
    pg.evaluate('(async()=>{ await SF.sim(2); })()')
    pg.add_script_tag(path=os.path.join(HERE, 'dump_page.js'), type='module')
    pg.wait_for_function('window.SFDUMP', timeout=120000, polling=200)
    stats = pg.evaluate('(a)=>SFDUMP.run(a[0], {models: a[1]})', [level, models])
    log('dumped', written['n'], 'files', round(written['bytes'] / 1e6, 1), 'MB', json.dumps(stats))
    # original captures from the shot markers (same page load)
    scene = json.load(open(os.path.join(out, 'scene.json')))
    shots = [m for m in scene['markers'] if m['tag'] in ('Shot',)]
    # checks render at low quality (SwiftShader is slow); fog thinned (same factor in view.py) so geometry is comparable
    pg.evaluate('''async (fogK)=>{ const cv=SF.E.renderer.domElement; document.querySelectorAll('body *').forEach(e=>{ if(e!==cv && !e.contains(cv)) e.style.visibility='hidden'; });
      SF.E.settings.quality='low'; (await import('/js/engine.js')).resize();
      if (SF.E.scene.fog) SF.E.scene.fog.density *= fogK;
      // hide what the export deliberately leaves to Unreal (snow, fog cards, particles, her light figure, characters)
      SF.E.scene.traverse(o=>{ const u=o.material?.uniforms||{};
        if (o.isPoints || o.isSkinnedMesh || (u.uBox && o.geometry?.attributes?.aSeed) || u.uDissolve || u.uGrow) o.visible=false; }); }''', CHECK_FOG)
    for mk in shots:
        pg.evaluate('''(mk)=>{ const E=SF.E, c=E.camera; if(c.parent) c.parent.remove(c); c.position.set(...mk.position); c.up.set(0,1,0); c.fov=mk.fov; c.updateProjectionMatrix(); c.lookAt(...mk.lookAt); c.updateMatrixWorld(true);
          E.scene.traverse(o=>{ if(o.isGroup && o.userData.zc!==undefined) o.visible = true; });
          for (const L of [E.post.look, E.post.target]) if (L) { L.dof = 0; L.focus = 50; }
          E.post.fx.fade=0; E.post.fx.letterbox=0; E.post.fx.warp=0; SF.renderOnce(); }''', mk)
        pg.screenshot(path=os.path.join(chk, f"orig_{mk['name']}.png"))
        log('orig shot', mk['name'])
    b.close()
    return stats

if __name__ == '__main__':
    levels = sys.argv[1:] or ['L_Blizzard', 'L_Bench', 'L_Library', 'L_Park', 'L_Field']
    with sync_playwright() as pw:
        for lv in levels:
            dump_level(pw, lv)
