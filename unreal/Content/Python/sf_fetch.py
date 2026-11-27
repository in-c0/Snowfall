"""Downloads the 2K Poly Haven scans/textures/HDRIs, characters and fonts the scenes reference (idempotent)."""
import glob, json, os, urllib.request, concurrent.futures as cf
from sf_common import DOWNLOADS, SCENES, log, warn, step

UA = {'User-Agent': 'snowfall-ue-build/1.0'}
RES = '2k'

def _get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r, open(path + '.part', 'wb') as f:
        f.write(r.read())
    os.replace(path + '.part', path)

def _files(aid):
    with urllib.request.urlopen(urllib.request.Request('https://api.polyhaven.com/files/' + aid, headers=UA), timeout=60) as r:
        return json.load(r)

def needs():
    models, textures, hdris = set(), set(), set()
    for sj in glob.glob(os.path.join(SCENES, '*', 'scene.json')):
        s = json.load(open(sj, encoding='utf-8'))
        for m in s.get('models', []):
            models.add(m['name'])
        for mat in s.get('materials', {}).values():
            if mat.get('kind') == 'pbr' and mat.get('polyhaven'):
                textures.add(mat['polyhaven'])
        if s.get('env', {}).get('hdri'):
            hdris.add(s['env']['hdri'])
    models.add('wheelchair_01')  # spawned by directors
    return sorted(models), sorted(textures), sorted(hdris)

def run():
    models, textures, hdris = needs()
    step('fetch', models=len(models), textures=len(textures), hdris=len(hdris))
    jobs = []
    for m in models:
        try:
            d = _files(m)['gltf'][RES]['gltf']
        except Exception as e:
            warn(f'no gltf for {m}: {e}'); continue
        base = os.path.join(DOWNLOADS, 'models', m)
        jobs.append((d['url'], os.path.join(base, m + '.gltf')))
        for rel, inc in d['include'].items():
            jobs.append((inc['url'], os.path.join(base, rel)))
    for t in textures:
        try:
            d = _files(t)
        except Exception as e:
            warn(f'no texture {t}: {e}'); continue
        for key, short in (('Diffuse', 'diff'), ('nor_gl', 'nor'), ('arm', 'arm')):
            if key in d and RES in d[key]:
                src = d[key][RES].get('png') or d[key][RES].get('jpg')
                ext = '.png' if 'png' in d[key][RES] else '.jpg'
                jobs.append((src['url'], os.path.join(DOWNLOADS, 'textures', t, f'{t}_{short}{ext}')))
    for h in hdris:
        try:
            jobs.append((_files(h)['hdri']['4k']['hdr']['url'], os.path.join(DOWNLOADS, 'hdri', h + '_4k.hdr')))
        except Exception as e:
            warn(f'no hdri {h}: {e}')
    T3 = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/'
    for n in ('Xbot.glb', 'Michelle.glb'):
        jobs.append((T3 + n, os.path.join(DOWNLOADS, 'chars', n)))
    GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'
    fonts = {
        'CormorantGaramond-Regular.ttf': GF + 'cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf',
        'CormorantGaramond-Italic.ttf': GF + 'cormorantgaramond/CormorantGaramond-Italic%5Bwght%5D.ttf',
        'GowunBatang-Regular.ttf': GF + 'gowunbatang/GowunBatang-Regular.ttf',
        'DMMono-Regular.ttf': GF + 'dmmono/DMMono-Regular.ttf',
    }
    for name, url in fonts.items():
        jobs.append((url, os.path.join(DOWNLOADS, 'fonts', name)))
    errs = []
    def go(j):
        try:
            _get(*j)
        except Exception as e:
            errs.append(f'{j[0]}: {e}')
    with cf.ThreadPoolExecutor(8) as ex:
        list(ex.map(go, jobs))
    for e in errs[:30]:
        warn('download failed ' + e)
    step('fetch done', files=len(jobs), failed=len(errs))
    return models, textures, hdris
