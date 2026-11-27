#!/usr/bin/env python3
"""Render every Shot marker of an exported level with viewer.html (rebuilt purely from the export) and compose
side-by-side images with the original game capture made by dump.py.
usage: python3 view.py L_Bench [...]   -> tools/dumper/checks/<level>/cmp_<shot>.png
"""
import json, mimetypes, os, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SCENES = '/home/claude/ue/Snowfall/SourceArt/Scenes'
GAME = '/home/claude/snowfall'
W, H = 960, 540
FOG = 0.35   # must match CHECK_FOG in dump.py
T0 = time.time()
def log(*a): print(f'{time.time()-T0:7.1f}s', *a, flush=True)

def route(rt):
    url = rt.request.url
    path = url.split('sfview.local', 1)[1].split('?')[0]
    if path.startswith('/scene/'): fp = os.path.join(SCENES, path[len('/scene/'):])
    elif path.startswith('/assets/'): fp = os.path.join(GAME, path[1:])
    elif path == '/viewer.html': fp = os.path.join(HERE, 'viewer.html')
    else: return rt.fulfill(status=404, body='nf')
    if not os.path.isfile(fp): return rt.fulfill(status=404, body='nf')
    ct = mimetypes.guess_type(fp)[0] or 'application/octet-stream'
    if fp.endswith('.glb'): ct = 'model/gltf-binary'
    if fp.endswith('.webp'): ct = 'image/webp'
    rt.fulfill(path=fp, content_type=ct)

def compose(orig, view, out, title):
    a = Image.open(orig).convert('RGB') if os.path.exists(orig) else Image.new('RGB', (W, H), (60, 0, 0))
    b = Image.open(view).convert('RGB')
    c = Image.new('RGB', (W * 2 + 8, H + 26), (20, 20, 20))
    c.paste(a.resize((W, H)), (0, 26)); c.paste(b.resize((W, H)), (W + 8, 26))
    d = ImageDraw.Draw(c)
    d.text((8, 6), f'{title} — original game (post on, DOF off, fog x{FOG}, snow/her/characters hidden)', fill=(230, 230, 230))
    d.text((W + 16, 6), 'rebuilt from export (viewer.html, approx. materials)', fill=(230, 230, 230))
    c.save(out)

def view_level(pw, level):
    scene = json.load(open(os.path.join(SCENES, level, 'scene.json')))
    chk = os.path.join(HERE, 'checks', level); os.makedirs(chk, exist_ok=True)
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--max-old-space-size=4096'])
    pg = b.new_page(viewport={'width': W, 'height': H})
    pg.set_default_timeout(0)
    pg.on('console', lambda m: log(f'[{m.type}] {m.text[:300]}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: log('[pageerror]', e))
    pg.route('http://sfview.local/**', route)
    pg.goto(f'http://sfview.local/viewer.html?level={level}&fog={FOG}')
    pg.wait_for_function('window.VIEW_READY', timeout=600000, polling=500)
    log(level, 'viewer ready', pg.evaluate('JSON.stringify(VIEW.stats)'))
    outs = []
    for mk in [m for m in scene['markers'] if m['tag'] == 'Shot']:
        tris = pg.evaluate('(mk)=>VIEW.shot(mk)', mk)
        vp = os.path.join(chk, f"view_{mk['name']}.png")
        pg.screenshot(path=vp)
        cp = os.path.join(chk, f"cmp_{mk['name']}.png")
        compose(os.path.join(chk, f"orig_{mk['name']}.png"), vp, cp, f"{level} {mk['name']}")
        log('shot', mk['name'], 'tris', tris, '->', cp); outs.append(cp)
    b.close()
    return outs

if __name__ == '__main__':
    with sync_playwright() as pw:
        for lv in sys.argv[1:]:
            view_level(pw, lv)
