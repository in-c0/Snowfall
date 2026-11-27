#!/usr/bin/env python3
"""Validate exported levels (SourceArt/Scenes/<level>/scene.json).
Checks: every referenced file exists; instance .bin = count*(16+customFloats)*4 bytes; .col.bin = count*3*4;
matrices finite; glb headers valid; materials referenced exist; required marker tags present.
Prints per level: mesh entries, total instances, total triangles, models, markers, lights.
usage: python3 check.py [L_Blizzard ...]   (default: every folder in Scenes/)
"""
import json, math, os, struct, sys
import numpy as np

ROOT = '/home/claude/ue/Snowfall/SourceArt/Scenes'
REQUIRED = {
    'L_Blizzard': ['PlayerStart', 'ShadowStart', 'shot_start', 'shot_trees', 'shot_wheelchair'],
    'L_Bench': ['PlayerStart', 'SitPoint', 'SeatPoint', 'GlassPoint', 'KidsCenter', 'shot_approach', 'shot_bench'],
    'L_Library': ['PlayerStart:wake', 'PlayerStart:hall', 'PlayerStart:book', 'PlayerStart:window', 'PlayerStart:globe', 'PlayerStart:door1', 'PlayerStart:door2', 'PlayerStart:door3',
                  'LibraryMouth', 'I_book', 'I_window', 'I_globe', 'I_cherries', 'I_bottle', 'I_radio', 'I_door1', 'I_door2', 'I_door3', 'I_exit', 'I_bedGive', 'HerBed', 'HerSit', 'CherryView',
                  'shot_wake', 'shot_meadow', 'shot_nave', 'shot_chamber', 'shot_door',
                  'mesh:WindowPane', 'light:WindowGlow', 'light:DoorLight1', 'light:DoorLight2', 'light:DoorLight3', 'mesh:DoorChains1', 'mesh:DoorChains2', 'mesh:DoorChains3'],
    'L_Park': ['PlayerStart', 'OpeningCam', 'Path0', 'Path1', 'model:Chair', 'shot_opening', 'shot_push', 'shot_canopy'],
    'L_Field': ['PlayerStart', 'FieldCenter', 'shot_start', 'shot_chase'],
    'L_Road': ['PlayerStart', 'RoadStart', 'RoadEnd', 'LeaveLight', 'shot_road', 'shot_house'],
    'L_Red': ['PlayerStart', 'HerBed', 'I_cherries', 'I_bedGive', 'PillowView', 'mesh|model:BottleFull', 'mesh|model:BottleEmpty', 'mesh|model:Frag3Only', 'shot_entry', 'shot_candles'],
}

def glb_ok(p):
    with open(p, 'rb') as f: h = f.read(20)
    if len(h) < 20: return False
    magic, ver, total = struct.unpack('<III', h[:12])
    return magic == 0x46546C67 and ver == 2 and total == os.path.getsize(p)

def finite(a): return all(math.isfinite(x) for x in a)

def check(level):
    d = os.path.join(ROOT, level)
    S = json.load(open(os.path.join(d, 'scene.json')))
    errs = []
    files = set()
    def need(rel):
        p = os.path.join(d, rel); files.add(os.path.normpath(p))
        if not os.path.isfile(p): errs.append('missing ' + rel); return None
        return p
    tris = inst = 0
    for e in S['meshes']:
        p = need(e['file'])
        if p and not glb_ok(p): errs.append('bad glb ' + e['file'])
        if e['material'] not in S['materials']: errs.append(f"{e['id']}: unknown material {e['material']}")
        if 'matrix' in e:
            if len(e['matrix']) != 16 or not finite(e['matrix']): errs.append(f"{e['id']}: bad matrix")
            n = 1
        else:
            n, cf = e['count'], e['customFloats']
            bp = need(e['instances'])
            if bp:
                sz = os.path.getsize(bp)
                if sz != n * (16 + cf) * 4: errs.append(f"{e['id']}: bin {sz} != {n}*(16+{cf})*4")
                else:
                    a = np.fromfile(bp, dtype='<f4').reshape(n, 16 + cf)
                    if not np.isfinite(a).all(): errs.append(f"{e['id']}: non-finite instance data")
                    if not np.allclose(a[:, 15], 1.0, atol=1e-4): errs.append(f"{e['id']}: matrix w != 1")
            if e.get('instanceColors'):
                cp = need(e['instanceColors'])
                if cp and os.path.getsize(cp) != n * 12: errs.append(f"{e['id']}: col.bin size")
        tris += e.get('triangles', 0) * n; inst += n
    for k, m in S['materials'].items():
        if m.get('map'): need(m['map'])
        if m['kind'] == 'pbr' and not os.path.isfile(f"/home/claude/snowfall/assets/tex/{m['polyhaven']}_diff.webp"): errs.append(f'{k}: unknown polyhaven set {m["polyhaven"]}')
    for m in S['models']:
        if len(m['matrix']) != 16 or not finite(m['matrix']): errs.append(f"model {m['name']}: bad matrix")
        if not os.path.isfile(f"/home/claude/snowfall/assets/models/{m['name']}.glb"): errs.append(f"model {m['name']}: not a known scan")
    for mk in S['markers']:
        for k in ('position', 'lookAt'):
            if k in mk and (len(mk[k]) != 3 or not finite(mk[k])): errs.append(f"marker {mk['tag']}: bad {k}")
    for L in S['lights']:
        for k in ('position', 'target', 'color'):
            if k in L and not finite(L[k]): errs.append(f'light bad {k}')
    if level == 'L_Blizzard':
        p = need('calib.glb')
        if p and not glb_ok(p): errs.append('bad calib.glb')
    # required anchors
    tags = {mk['tag'] for mk in S['markers']} | {mk.get('name') for mk in S['markers'] if mk.get('name')}
    spawns = {'PlayerStart:' + mk['spawn'] for mk in S['markers'] if mk['tag'] == 'PlayerStart' and mk.get('spawn')}
    mtags = {e.get('tag') for e in S['meshes']}; ltags = {l.get('tag') for l in S['lights']}; motags = {m.get('tag') for m in S['models']}
    for r in REQUIRED.get(level, []):
        ok = (r in spawns) if r.startswith('PlayerStart:') else \
             (r[5:] in mtags) if r.startswith('mesh:') else (r[6:] in ltags) if r.startswith('light:') else \
             (r[6:] in motags) if r.startswith('model:') else (r[11:] in mtags | motags) if r.startswith('mesh|model:') else (r in tags)
        if not ok: errs.append('missing anchor ' + r)
    # unreferenced files
    on_disk = {os.path.normpath(os.path.join(dp, f)) for dp, _, fs in os.walk(d) for f in fs if f not in ('scene.json', 'calib.glb', 'glow.png')}
    extra = on_disk - files
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(d) for f in fs)
    nglow = sum(1 for mk in S['markers'] if mk['tag'] == 'Glow')
    print(f"{level:11s} meshes {len(S['meshes']):4d}  instances {inst:8d}  triangles {tris:10d}  models {len(S['models']):3d}  markers {len(S['markers']):4d} (glow {nglow})  lights {len(S['lights']):3d}  materials {len(S['materials']):3d}  size {size/1e6:6.1f} MB  {'OK' if not errs else 'ERRORS'}")
    for e in errs: print('   !', e)
    if extra: print('   (unreferenced files:', len(extra), ')', sorted(extra)[:5])
    return not errs, size

if __name__ == '__main__':
    levels = sys.argv[1:] or sorted(x for x in os.listdir(ROOT) if os.path.isfile(os.path.join(ROOT, x, 'scene.json')))
    tot = 0; ok = True
    for lv in levels:
        o, s = check(lv); ok &= o; tot += s
    print(f'total size on disk: {tot/1e6:.1f} MB')
    sys.exit(0 if ok else 1)
