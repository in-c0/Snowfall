# Collect the publishable game into /home/claude/dist: index.html, js/**, and only the assets the code references.
import os, re, shutil, json, glob
SRC = '/home/claude/snowfall'
DST = '/home/claude/dist'
shutil.rmtree(DST, ignore_errors=True)
os.makedirs(DST)
code = ''
for f in glob.glob(f'{SRC}/js/**/*.js', recursive=True):
    code += open(f).read() + '\n'
shutil.copy(f'{SRC}/index.html', DST)
shutil.copytree(f'{SRC}/js', f'{DST}/js')
used, skipped = [], []
for f in sorted(glob.glob(f'{SRC}/assets/**/*.*', recursive=True)):
    rel = os.path.relpath(f, SRC)
    name = os.path.splitext(os.path.basename(f))[0]
    folder = rel.split('/')[1]
    keep = False
    if folder == 'piano':
        keep = True
    elif folder == 'tex':
        base = re.sub(r'_(diff|nor|arm)$', '', name)
        keep = f"'{base}'" in code or f"'{name}'" in code or f'"{base}"' in code
    elif folder == 'hdri':
        keep = f"'{name.replace('_1k', '')}'" in code
    else:
        keep = f"'{name}'" in code or f'"{name}"' in code
    if keep:
        os.makedirs(os.path.dirname(f'{DST}/{rel}'), exist_ok=True)
        shutil.copy(f, f'{DST}/{rel}'); used.append(rel)
    else:
        skipped.append(rel)
files = sorted(os.path.relpath(p, DST) for p in glob.glob(f'{DST}/**/*.*', recursive=True) if os.path.basename(p) != 'index.html')
size = sum(os.path.getsize(f'{DST}/{p}') for p in files) + os.path.getsize(f'{DST}/index.html')
json.dump({p: p for p in files}, open('/home/claude/tools/files_map.json', 'w'))
print('files', len(files), 'MB', round(size / 1e6, 1))
print('skipped', len(skipped), ' '.join(os.path.basename(s) for s in skipped))
