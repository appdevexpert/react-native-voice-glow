"""Assembles the README images from the rendered frames and parity renders.

    node scripts/make-docs.mjs && python3 scripts/make-gif.py
"""
import glob
import os

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
FRAMES = os.path.join(ROOT, 'renders/frames')
DOCS = os.path.join(ROOT, 'docs')
os.makedirs(DOCS, exist_ok=True)


def webp(name, scale=0.5, step=1, quality=80):
    """Animated WebP: smooth gradients (a GIF's 256 colours band them) at a fraction of the size."""
    files = sorted(glob.glob(os.path.join(FRAMES, f'{name}-*.png')))[::step]
    frames = []
    for f in files:
        im = Image.open(f).convert('RGB')
        frames.append(im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS))
    path = os.path.join(DOCS, f'{name}.webp')
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=int(1000 / 30 * step), loop=0, quality=quality, method=6)
    print(path, os.path.getsize(path) // 1024, 'KB')


def gif(name, scale=0.5, step=1):
    files = sorted(glob.glob(os.path.join(FRAMES, f'{name}-*.png')))[::step]
    frames = []
    for f in files:
        im = Image.open(f).convert('RGB')
        im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        frames.append(im)
    # One palette for the whole loop, taken from a strip of frames, so colours
    # do not flicker between frames.
    sample = Image.new('RGB', (frames[0].width, frames[0].height * 6))
    for i in range(6):
        sample.paste(frames[(i * len(frames)) // 6], (0, frames[0].height * i))
    palette = sample.quantize(colors=255, method=Image.MEDIANCUT)
    out = [f.quantize(palette=palette, dither=Image.NONE) for f in frames]
    path = os.path.join(DOCS, f'{name}.gif')
    out[0].save(path, save_all=True, append_images=out[1:], duration=int(1000 / 30 * step), loop=0, optimize=True)
    print(path, os.path.getsize(path) // 1024, 'KB')


def parity():
    names = ['dark-default-speaking', 'light-default-speaking', 'dark-mobile-distortion']
    web = [Image.open(os.path.join(ROOT, 'test/golden', f'{n}.png')).convert('RGB') for n in names]
    nat = [Image.open(os.path.join(ROOT, 'renders/native', f'{n}.png')).convert('RGB') for n in names]
    scale = 0.5
    gap = 12
    cols = []
    for a, b in zip(web, nat):
        a = a.resize((int(a.width * scale), int(a.height * scale)), Image.LANCZOS)
        b = b.resize((int(b.width * scale), int(b.height * scale)), Image.LANCZOS)
        cols.append((a, b))
    width = max(a.width for a, _ in cols) * 2 + gap * 3
    height = sum(a.height for a, _ in cols) + gap * (len(cols) + 1)
    sheet = Image.new('RGB', (width, height), (24, 24, 28))
    y = gap
    for a, b in cols:
        sheet.paste(a, (gap, y))
        sheet.paste(b, (gap * 2 + max(c.width for c, _ in cols), y))
        y += a.height + gap
    path = os.path.join(DOCS, 'parity.png')
    sheet.save(path, optimize=True)
    print(path, os.path.getsize(path) // 1024, 'KB')


webp('chat', scale=1, step=1)
webp('phone', scale=1, step=1)
parity()
