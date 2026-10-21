"""python3 scripts/intro-media/assemble.py <frames-dir> <out-dir> [steps, default 24]
Turns capture-story.mjs's frames (g<n>/) into docs/intro/*.webp: an animated WebP (a GIF has only on/off transparency) for each step.
Needs Pillow. Frames are cropped to the union of what is drawn, identical neighbours are merged into one longer frame, and the picture shown
first (what a viewer, or a preview that does not play, sees) is chosen: REP is a time in ms, or None for the last frame.
A step that is only a still (STILL) is written as one lossless frame instead."""
import glob, os, sys
from PIL import Image, ImageChops

NAMES = {1: 'one-file', 2: 'versions', 3: 'looks', 4: 'many-resumes'}
REP = {1: 9300, 2: 8500, 3: 5900, 4: None}       # 2: lines ticked, a wording picked; 4: the resumes fanned out
FADE = {4: 49}                                    # px: the stack runs under the board's rim, so its bottom edge fades out
STILL = {1, 3}
START = {1: 900, 2: 300, 3: 450, 4: 300}         # ms: skip the previous step's leftovers fading out
END = {1: 9500}                                   # ms: step 1 auto-advances into step 2 after this
PAD = 12

frames_dir, out = sys.argv[1], sys.argv[2]
for n in map(int, sys.argv[3] if len(sys.argv) > 3 else '24'):
    files = sorted(glob.glob(f'{frames_dir}/g{n}/*.png'))
    ts = [int(f.rsplit('_', 1)[1][:-4]) for f in files]
    keep = [i for i, t in enumerate(ts) if START[n] <= t <= END.get(n, 10**9)]
    files = [files[i] for i in keep]; ts = [ts[i] for i in keep]
    ims = [Image.open(f).convert('RGBA') for f in files]
    box = None
    for im in ims[::4]:
        b = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
        if b: box = b if not box else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    box = (max(0, box[0] - PAD), max(0, box[1] - PAD), min(ims[0].width, box[2] + PAD), min(ims[0].height, box[3] + PAD))

    def prep(im):
        c = im.crop(box)
        if n in FADE:
            fade = Image.linear_gradient('L').rotate(180).resize((c.width, FADE[n]))
            mask = Image.new('L', c.size, 255); mask.paste(fade, (0, c.height - FADE[n]))
            c.putalpha(ImageChops.multiply(c.getchannel('A'), mask))
        return c

    ri = len(ims) - 1 if REP[n] is None else min(range(len(ts)), key=lambda i: abs(ts[i] - REP[n]))
    path = f'{out}/{NAMES[n]}.webp'
    if n in STILL:
        prep(ims[ri]).save(path, lossless=True, quality=100, method=6)
    else:
        frames, durs = [], []
        for i, im in enumerate(ims):
            c = prep(im); d = (ts[i + 1] - ts[i]) if i + 1 < len(ims) else 1800
            if frames and ImageChops.difference(frames[-1], c).getbbox() is None: durs[-1] += d
            else: frames.append(c); durs.append(d)
        frames.insert(0, prep(ims[ri])); durs.insert(0, 900 if REP[n] is None else 1600)
        frames[0].save(path, save_all=True, append_images=frames[1:], duration=durs, loop=0, quality=80, method=4, exact=True)
    print(NAMES[n], os.path.getsize(path) // 1000, 'KB')
