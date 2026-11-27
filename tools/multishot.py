# usage: python3 multishot.py URL OUTPREFIX W H STEP_JS [STEP_JS ...]
# each STEP_JS is evaluated (awaited) in order; after each a screenshot OUTPREFIX_<i>.png is saved
import sys, time, json
from playwright.sync_api import sync_playwright
url, pre, W, H = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
steps = sys.argv[5:]
T0 = time.time()
def log(*a): print(f'{time.time()-T0:6.1f}s', *a, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': W, 'height': H})
    pg.on('console', lambda m: (None if ('GPU stall' in m.text or 'fallback' in m.text or 'Failed to load' in m.text) else log(f'[{m.type}] {m.text[:1500]}')))
    pg.on('pageerror', lambda e: log(f'[pageerror] {e}'))
    pg.goto(url)
    try:
        pg.wait_for_function('window.SF && window.SF.E.ready', timeout=200000, polling=1000)
        log('ready')
    except Exception as e:
        log('READY TIMEOUT')
    for i, js in enumerate(steps):
        try:
            r = pg.evaluate(js)
            if r is not None: log(f'js{i}->', json.dumps(r)[:800])
        except Exception as e:
            log('JS ERR', str(e)[:400])
        if js.strip().endswith('/*noshot*/'): continue
        try:
            info = pg.evaluate('({calls: SF.E.renderer.info.render.calls, tris: SF.E.renderer.info.render.triangles, scene: SF.E.sceneId, t: SF.E.time.toFixed(1)})')
            log(json.dumps(info))
        except Exception as e:
            log('info err', str(e)[:200])
        pg.screenshot(path=f'{pre}_{i}.png', timeout=120000)
        log('shot', f'{pre}_{i}.png')
    b.close()
