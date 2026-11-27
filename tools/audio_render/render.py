#!/usr/bin/env python3
"""Drive headless Chrome to bake the Snowfall WebAudio engine offline.

Serves render.html/render.js from this folder under http://localhost:8765/__ar/ (Playwright route,
so the page shares the game server's origin and can fetch /assets/piano/*.mp3), runs each job in an
OfflineAudioContext at 48 kHz, and pulls the float32 result back as base64 chunks.
Raw output: raw/<id>.f32 (interleaved stereo float32) + raw/<id>.json (job + render info).
Post-processing (loop folding, loudness, limiting, WAV writing) lives in post.py.

usage: python3 render.py [id-substring ...]   (no args = render everything)
"""
import base64, json, os, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
RAW = HERE / 'raw'; RAW.mkdir(exist_ok=True)

def jobs():
    J = []
    for name, dur in [('blizzard', 90), ('garden', 100), ('library', 180), ('her', 180), ('red', 120), ('waltz', 120), ('end', 180)]:
        J.append(dict(id=f'Music/MU_{name}', type='music', name=name, dur=dur, cls='music'))
    J.append(dict(id='Music/MU_loop', type='musicLoop', name='loop', bars=8, tail=12, cls='musicloop'))
    # ambience: pre-roll (settle filters/reverb) + loop length L + crossfade xf
    amb = [  # id, layer, level, L, xf, pre, opt, target RMS dBFS
        ('wind', 'wind', 1.0, 36, 4, 4, {'gustBody': 0.7}, -23),
        ('wind_soft', 'wind', 0.15, 36, 4, 4, {'howl': 0.45, 'bodyFreq': 300}, -27),
        ('birds', 'birds', 0.3, 36, 3, 4, None, -27),
        ('room', 'room', 0.4, 36, 3, 4, None, -27),
        ('clock', 'clock', 0.5, 36, 1, 2.5, None, -27),
        ('vinyl', 'vinyl', 0.5, 32, 2, 4, None, -26),
        ('drone', 'drone', 0.3, 40, 4, 4, None, -24),
        ('heart', 'heart', 0.25, 33.6, 1.05, 2.625, None, -26),
        ('fire', 'fire', 0.6, 36, 3, 4, None, -25),
        ('kids', 'kids', 0.9, 36, 3, 4, None, -27),
        ('radio', 'radio', 0.5, 36, 3, 4, None, -25),
    ]
    for n, layer, lvl, L, xf, pre, opt, tgt in amb:
        J.append(dict(id=f'Amb/AMB_{n}_loop', type='amb', name=n, layer=layer, level=lvl, L=L, xf=xf, pre=pre,
                      total=pre + L + xf + 0.1, opt=opt, target=tgt, cls='amb'))
    for s in ['snow', 'wood', 'leaves', 'grass', 'stone']:
        for i in range(6):
            J.append(dict(id=f'SFX/SFX_Step_{s}_{i}', type='step', surface=s, index=i, cls='sfx'))
    one = [('SFX/SFX_Bell', 'bell', 9, None, 8.0), ('SFX/SFX_Glass_Shatter', 'glass', 5, None, None),
           ('SFX/SFX_Whoosh', 'whoosh', 9, 4, None), ('SFX/SFX_Chime', 'chime', 8, None, None),
           ('SFX/SFX_Heartbeat', 'heartbeat', 1, None, None), ('SFX/SFX_TapeStop', 'tapestop', 6, 1.6, None),
           ('SFX/SFX_HoldTone', 'hold', 6, None, None)]
    for i in range(3): one.append((f'SFX/SFX_Creak_{i}', 'creak', 5, i, None))
    for n in ['G4', 'Bb4', 'D5']: one.append((f'SFX/SFX_PianoNote_{n}', 'piano', 4, n, None))
    for jid, kind, secs, arg, maxlen in one:
        J.append(dict(id=jid, type='oneshot', kind=kind, seconds=secs, arg=arg, maxlen=maxlen, cls='sfx'))
    return J

def main():
    sel = sys.argv[1:]
    todo = [j for j in jobs() if not sel or any(s in j['id'] for s in sel)]
    T0 = time.time()
    log = lambda *a: print(f'{time.time() - T0:6.1f}s', *a, flush=True)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        pg = b.new_page()
        pg.on('console', lambda m: log(f'[{m.type}] {m.text[:300]}'))
        pg.on('pageerror', lambda e: log(f'[pageerror] {e}'))
        def serve(route):
            f = HERE / route.request.url.split('/__ar/', 1)[1].split('?')[0]
            ct = 'text/javascript' if f.suffix == '.js' else 'text/html'
            route.fulfill(status=200, body=f.read_bytes(), headers={'content-type': ct, 'cache-control': 'no-store'})
        pg.route('**/__ar/**', serve)
        pg.goto('http://localhost:8765/__ar/render.html')
        pg.wait_for_function('window.__ready === true', timeout=30000)
        for j in todo:
            info = pg.evaluate('job => window.renderJob(job)', j)
            n, CH = info['bytes'], 6 * 1024 * 1024
            out = RAW / (j['id'].replace('/', '__') + '.f32')
            with open(out, 'wb') as fh:
                for off in range(0, n, CH):
                    fh.write(base64.b64decode(pg.evaluate('([o, n]) => window.chunk(o, n)', [off, CH])))
            (out.with_suffix('.json')).write_text(json.dumps({'job': j, 'info': info}))
            log(f"{j['id']}: {info['frames'] / 48000:.2f}s rendered in {info['ms']} ms")
        b.close()

if __name__ == '__main__':
    main()
