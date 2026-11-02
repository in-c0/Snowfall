#!/usr/bin/env python3
"""Post-process raw renders from render.py into 48 kHz / 16-bit stereo WAVs for Unreal.

- Music: 5 ms fade-in, 4 s fade-out, normalise to -18 LUFS, look-ahead limiter at -1.5 dBFS.
- Music loop: fold the reverb/release tail past the loop point back onto the head (no fades),
  normalise, limit circularly (so the gain envelope is continuous across the wrap).
- Ambience: skip pre-roll, crossfade the tail into the head (linear fade if tail/head are
  correlated, equal-power otherwise), RMS-normalise to a per-layer target, limit circularly.
- SFX: trim leading/trailing silence (-60 dB re peak), 10 ms fade-out, peak-normalise to -3 dBFS.
Then measures everything, writes manifest.json and the waveforms.png contact sheet.
"""
import json, sys
from pathlib import Path
import numpy as np
from scipy.io import wavfile
from scipy.ndimage import minimum_filter1d, maximum_filter1d
from scipy.signal import resample_poly
import pyloudnorm as pyln

SR = 48000
HERE = Path(__file__).resolve().parent
RAW = HERE / 'raw'
OUT = Path('/home/claude/ue/Snowfall/SourceArt/Audio')
db = lambda x: 20 * np.log10(max(float(x), 1e-12))
undb = lambda d: 10 ** (d / 20)
METER = pyln.Meter(SR)
# ambience layers dominated by transients: name -> (target RMS dBFS, max limiter GR dB, release ms)
TRANSIENT = {'vinyl': (-27.5, 22, 15), 'radio': (-26, 14, 15), 'clock': (-27.5, 10, 15)}

def limiter(x, ceil_db=-1.5, look_ms=3, rel_ms=120, circular=False):
    """Block-based look-ahead peak limiter. Returns (y, max gain reduction dB)."""
    n = len(x)
    if circular:  # process three copies, keep the middle: the gain is continuous across the wrap
        y, gr = limiter(np.concatenate([x, x, x]), ceil_db, look_ms, rel_ms, False)
        return y[n:2 * n], gr
    ceil = undb(ceil_db); B = 48  # 1 ms blocks
    nb = -(-n // B)
    pk = np.zeros(nb * B); pk[:n] = np.abs(x).max(axis=1)
    pk = pk.reshape(nb, B).max(axis=1)
    req = np.minimum(1.0, ceil / np.maximum(pk, 1e-12))
    la = max(1, int(look_ms))
    gmin = minimum_filter1d(req, size=2 * la + 1, mode='nearest')
    rc = 1 - np.exp(-1.0 / rel_ms)  # per 1 ms block
    g = np.empty_like(gmin); cur = 1.0
    for i in range(nb):
        cur = min(gmin[i], cur + (1 - cur) * rc); g[i] = cur
    # smooth attack: backward pass so gain glides down over the look-ahead window instead of stepping
    ac = 1 - np.exp(-1.0 / la); cur = 1.0
    for i in range(nb - 1, -1, -1):
        cur = g[i] if g[i] < cur else cur + (g[i] - cur) * ac
        g[i] = cur
    gs = np.interp(np.arange(n), np.arange(nb) * B + B / 2, g)
    y = x * gs[:, None]
    return np.clip(y, -ceil, ceil), -db(g.min())

def lufs(x):
    try: return METER.integrated_loudness(x)
    except Exception: return float('nan')

def rms_db(x): return db(np.sqrt(np.mean(x ** 2)))
def true_peak_db(x): return db(np.abs(resample_poly(x, 4, 1, axis=0)).max())

def fade(n, kind='lin'):
    t = np.linspace(0, 1, n)
    return np.sin(t * np.pi / 2) if kind == 'pow' else (0.5 - 0.5 * np.cos(np.pi * t) if kind == 'cos' else t)

def write_wav(path, x, seed):
    rng = np.random.default_rng(seed)
    d = (rng.random(x.shape) - rng.random(x.shape))  # TPDF dither, +-1 LSB
    q = np.clip(np.round(x * 32767 + d), -32768, 32767).astype(np.int16)
    path.parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(path, SR, q)
    return q.astype(np.float64) / 32768

def seam(y):
    """Wrap discontinuity vs. typical sample-to-sample step."""
    jump = float(np.abs(y[0] - y[-1]).max())
    w = np.concatenate([y[-SR // 2:], y[:SR // 2]])  # one second centred on the wrap
    steps = np.abs(np.diff(w, axis=0)).max(axis=1)
    return jump, float(np.median(steps)), float(np.mean(steps < jump) * 100)

def process(meta, x):
    j = meta['job']; cls = j['cls']; st = {'id': j['id'], 'cls': cls}
    if cls == 'music':
        n = int(j['dur'] * SR); y = x[:n].copy()
        y[:240] *= fade(240)[:, None]
        nf = 4 * SR; y[-nf:] *= fade(nf, 'cos')[::-1, None]
        y *= undb(-18 - lufs(y)); y, gr = limiter(y)
    elif cls == 'musicloop':
        L = meta['info']['loopSamples']; y = x[:L].copy(); tail = x[L:]
        for k in range(0, len(tail), L):  # fold the tail (reverb + releases) back onto the head
            c = tail[k:k + L]; y[:len(c)] += c
        y *= undb(-18 - lufs(np.concatenate([y, y]))); y, gr = limiter(y, circular=True)
        st['loop_bars'] = j['bars']
    elif cls == 'amb':
        pre, L, xf = int(round(j['pre'] * SR)), int(round(j['L'] * SR)), int(round(j['xf'] * SR))
        seg = x[pre:pre + L + xf]
        head, tail = seg[:xf], seg[L:L + xf]
        corr = float(np.sum(head * tail) / np.sqrt(np.sum(head ** 2) * np.sum(tail ** 2) + 1e-20))
        kind = 'cos' if corr > 0.5 else 'pow'
        fi = fade(xf, kind)[:, None]; fo = fade(xf, kind)[::-1, None]
        y = seg[:L].copy(); y[:xf] = head * fi + tail * fo
        # spiky layers (crackle pops, clock ticks) get a fast-release transient limiter with a higher cap,
        # otherwise their crest factor keeps the RMS far below the ambience band
        target, cap, rel = TRANSIENT.get(j['name'], (j['target'], 4, 120))
        x0, gdb = y, target - rms_db(y)
        for _ in range(20):  # solve for the gain whose post-limiter RMS lands on the target
            gdb = min(gdb, -1.5 + cap - db(np.abs(x0).max()))  # never ask the limiter for more than `cap` dB
            y, gr = limiter(x0 * undb(gdb), rel_ms=rel, circular=True)
            miss = target - rms_db(y)
            if abs(miss) < 0.05: break
            gdb += 2 * miss
        # the loop is seamless by construction (y[-1], y[0] are consecutive render samples); rotate it so
        # the wrap also sits at the quietest high-frequency moment, keeping the seam step tiny for broadband beds
        s = np.abs(np.diff(y, axis=0, append=y[:1])).max(axis=1)  # s[i] = step from y[i] to y[i+1]
        e = np.convolve(np.concatenate([s, s[:480]]), np.ones(480) / 480, 'valid')[:len(s)]
        c = int(np.argmin(e)) + 240; win = np.arange(c - 240, c + 240) % len(s)
        i = int(win[np.argmin(s[win])]) + 1
        y = np.roll(y, -i, axis=0)
        st.update(xfade=kind, xfade_corr=round(corr, 3), rotated_s=round(i / SR, 3), target_rms=target)
    else:  # sfx
        y = x.copy(); a = np.abs(y).max(axis=1); pk = a.max()
        env = maximum_filter1d(a, 480)
        idx = np.nonzero(env > pk * undb(-60))[0]
        s0 = max(0, int(np.nonzero(a > pk * undb(-50))[0][0]) - 48)  # keep 1 ms before the onset
        s1 = min(len(y), idx[-1] + 480)
        if j.get('maxlen'): s1 = min(s1, s0 + int(j['maxlen'] * SR))
        y = y[s0:s1]
        nf = 480; y[-nf:] *= fade(nf)[::-1, None]
        y *= undb(-3) / np.abs(y).max(); gr = 0.0
    st['limiter_gr_db'] = round(gr, 2)
    return y, st

def main():
    sel = sys.argv[1:]
    stats = []
    for f in sorted(RAW.glob('*.json')):
        meta = json.loads(f.read_text()); j = meta['job']
        if sel and not any(s in j['id'] for s in sel): continue
        x = np.fromfile(f.with_suffix('.f32'), dtype=np.float32).astype(np.float64).reshape(-1, 2)
        y, st = process(meta, x)
        path = OUT / (j['id'] + '.wav')
        q = write_wav(path, y, abs(hash(j['id'])) % 2**32)
        st.update(path=str(path), seconds=round(len(q) / SR, 3), frames=len(q),
                  peak_dbfs=round(db(np.abs(q).max()), 2), rms_dbfs=round(rms_db(q), 2),
                  clipped_samples=int(np.sum(np.abs(q) >= 32767 / 32768)))
        if st['cls'] in ('music', 'musicloop', 'amb'):
            st['lufs'] = round(lufs(np.concatenate([q, q]) if st['cls'] != 'music' else q), 2)
            st['true_peak_dbfs'] = round(true_peak_db(q), 2)
        if st['cls'] in ('musicloop', 'amb'):
            jump, med, pct = seam(q); st['seam_jump'] = round(jump, 5); st['local_step_median'] = round(med, 5); st['seam_step_percentile'] = round(pct, 1)
        stats.append(st)
        print(json.dumps(st))
    if not sel:
        (HERE / 'manifest.json').write_text(json.dumps(stats, indent=1))
        contact(stats)

def contact(stats):
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    col = {'music': '#2a78d6', 'musicloop': '#2a78d6', 'amb': '#eb6834', 'sfx': '#1baf7a'}
    ink, ink2, surf = '#0b0b0b', '#52514e', '#fcfcfb'
    ncol = 5; nrow = -(-len(stats) // ncol)
    fig, axs = plt.subplots(nrow, ncol, figsize=(ncol * 4.2, nrow * 1.25), facecolor=surf)
    for ax in axs.flat: ax.axis('off')
    for ax, st in zip(axs.flat, stats):
        _, d = wavfile.read(st['path']); m = d.astype(np.float64).mean(axis=1) / 32768
        W = 600; n = len(m) // W * W or len(m)
        blk = m[:n].reshape(min(W, n), -1) if n >= W else m[:, None]
        t = np.linspace(0, st['seconds'], len(blk))
        ax.fill_between(t, blk.min(axis=1), blk.max(axis=1), color=col[st['cls']], lw=0)
        ax.axhline(0, color=ink2, lw=0.3); ax.set_ylim(-1, 1); ax.set_xlim(0, st['seconds'])
        ax.set_facecolor(surf)
        name = Path(st['path']).stem
        lvl = f"{st['lufs']:.1f} LUFS" if st['cls'] != 'sfx' and st['cls'] != 'amb' else (f"{st['rms_dbfs']:.1f} dB RMS" if st['cls'] == 'amb' else '')
        ax.set_title(name, fontsize=8, color=ink, loc='left', pad=2)
        ax.text(1, 1.02, f"{st['seconds']:.2f}s  pk {st['peak_dbfs']:.1f}  {lvl}", transform=ax.transAxes,
                fontsize=6.5, color=ink2, ha='right', va='bottom')
    fig.suptitle('Snowfall audio bake: Music (blue) / Ambience loops (orange) / SFX (green), full scale +-1',
                 color=ink, fontsize=11, x=0.01, ha='left')
    fig.tight_layout(rect=(0, 0, 1, 0.985))
    fig.savefig(HERE / 'waveforms.png', dpi=80, facecolor=surf)

if __name__ == '__main__':
    main()
