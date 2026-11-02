# usage: python3 shot.py URL OUT.png [wait_s] [js_after_ready] [w] [h]
import sys, time, json
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
wait_s = float(sys.argv[3]) if len(sys.argv) > 3 else 6
js = sys.argv[4] if len(sys.argv) > 4 else ''
W = int(sys.argv[5]) if len(sys.argv) > 5 else 640
H = int(sys.argv[6]) if len(sys.argv) > 6 else 360
T0 = time.time()
def log(*a): print(f'{time.time()-T0:6.1f}s', *a, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': W, 'height': H})
    pg.on('console', lambda m: (None if ('GPU stall' in m.text or 'fallback' in m.text) else log(f'[{m.type}] {m.text[:300]}')))
    pg.on('pageerror', lambda e: log(f'[pageerror] {e}'))
    pg.on("response", lambda r: log("[404]", r.url[:140]) if r.status>=400 else None)
    pg.on("requestfailed", lambda r: log('[reqfail]', r.url[:120], r.failure))
    pg.goto(url)
    try:
        pg.wait_for_function('window.SF && window.SF.E.ready', timeout=float(sys.argv[7])*1000 if len(sys.argv)>7 else 150000, polling=1000)
        log('ready')
    except Exception as e:
        log('READY TIMEOUT')
    if js:
        try:
            r = pg.evaluate(js)
            if r is not None: log('js->', json.dumps(r)[:600])
        except Exception as e:
            log('JS ERR', str(e)[:400])
    time.sleep(wait_s)
    try:
        info = pg.evaluate('({calls: SF.E.renderer.info.render.calls, tris: SF.E.renderer.info.render.triangles, frame: SF.E.frame, scene: SF.E.sceneId, t: SF.E.time.toFixed(1)})', )
        log(json.dumps(info))
    except Exception as e:
        log('info err', str(e)[:200])
    pg.screenshot(path=out, timeout=90000)
    log('shot saved')
    b.close()
