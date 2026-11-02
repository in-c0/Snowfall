# side-by-side WEB vs UE sheets for a shot tag: cmp.py <tag>
import os, sys
from PIL import Image, ImageDraw
tag = sys.argv[1]
U = f'/mnt/user-data/uploads/Projects/Snowfall/Saved/AutoShots/{tag}'; C = '/home/claude/ue/tools/dumper/checks'
pairs = []
for f in sorted(os.listdir(U)):
    if not f.endswith('.png'): continue
    lv = '_'.join(f.split('_')[:2]); shot = f[len(lv) + 1:]
    o = f'{C}/{lv}/orig_{shot}'
    if os.path.exists(o): pairs.append((o, f'{U}/{f}', f[:-4]))
W, H = 400, 225
for k in range(0, len(pairs), 7):
    ps = pairs[k:k + 7]
    im = Image.new('RGB', (W * 2, H * len(ps)))
    for i, (o, u, n) in enumerate(ps):
        a = Image.open(o).convert('RGB').resize((W, H)); b = Image.open(u).convert('RGB').resize((W, H))
        ImageDraw.Draw(a).text((6, 4), 'WEB ' + n, fill=(255, 60, 60)); ImageDraw.Draw(b).text((6, 4), 'UE ' + tag, fill=(255, 60, 60))
        im.paste(a, (0, i * H)); im.paste(b, (W, i * H))
    im.save(f'/tmp/cmp_{tag}_{k // 7}.png'); print(f'/tmp/cmp_{tag}_{k // 7}.png')
