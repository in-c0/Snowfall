import sys, time, json
from playwright.sync_api import sync_playwright
url = sys.argv[1]; js = sys.argv[2]
T0=time.time()
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width':960,'height':540})
    pg.on('pageerror', lambda e: print('[pageerror]', e))
    pg.goto(url)
    pg.wait_for_function('window.SF && window.SF.E.ready', timeout=300000, polling=500)
    print('ready', time.time()-T0)
    print(json.dumps(pg.evaluate(js), indent=1)[:6000])
    print('done', time.time()-T0)
    b.close()
