import sys, glob, os
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
files = sys.argv[3:] or sorted(glob.glob(d + '/*.png'))
W, H, C = 640, 360, 2
rows = (len(files) + C - 1) // C
sheet = Image.new('RGB', (W * C, H * rows), (0, 0, 0))
for i, f in enumerate(files):
    im = Image.open(os.path.join(d, f) if not f.startswith('/') else f).convert('RGB').resize((W, H))
    ImageDraw.Draw(im).text((8, 6), os.path.basename(f)[:-4], fill=(255, 60, 60))
    sheet.paste(im, ((i % C) * W, (i // C) * H))
sheet.save(out)
