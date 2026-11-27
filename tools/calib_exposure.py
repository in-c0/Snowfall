# Fit per-level exposure offsets so UE autoshots match the mean luminance of the web renders at the same Shot cameras.
# usage: calib_exposure.py <ue_shot_dir> [--apply]
import sys, os, json, math, glob
import numpy as np
from PIL import Image
UE = sys.argv[1]; APPLY = '--apply' in sys.argv
WEB = '/home/claude/ue/tools/dumper/checks'
CAL = '/home/claude/ue/Snowfall/Content/Data/look_calib.json'
def lum(p):
    a = np.asarray(Image.open(p).convert('RGB').resize((320, 180)), dtype=np.float32) / 255.0
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    y = lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722
    return float(np.exp(np.mean(np.log(y + 1e-3))))   # geometric mean, like an exposure meter
cal = json.load(open(CAL)) if os.path.exists(CAL) else {}
bias = cal.setdefault('level_bias', {})
per = {}
for f in sorted(glob.glob(UE + '/L_*.png')):
    n = os.path.basename(f)[:-4]; lv = '_'.join(n.split('_')[:2]); shot = n[len(lv) + 1:]
    o = f'{WEB}/{lv}/orig_{shot}.png'
    if os.path.exists(o):
        per.setdefault(lv, []).append(math.log2(lum(o) / lum(f)))
for lv, ds in per.items():
    d = float(np.median(ds))
    new = max(-5.0, min(5.0, bias.get(lv, 0.0) + 0.8 * d))
    print(f'{lv}: shots {len(ds)}  log2(web/ue) median {d:+.2f}  bias {bias.get(lv, 0.0):+.2f} -> {new:+.2f}')
    if APPLY:
        bias[lv] = round(new, 3)
if APPLY:
    json.dump(cal, open(CAL, 'w'), indent=1)
