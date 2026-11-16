"""Cut the cover chevron photos and the washed cover background out of the yearbook page images.

One-time tool. Needs Pillow in a throwaway venv:
    python3 -m venv venv && venv/bin/pip install pillow
    venv/bin/python -I tools/cover_tiles.py [pages_dir] [out_dir]

Each box is percent of the page (x, y, w, h). It is centre-cropped to the output shape, which is what
CSS `background-size: cover; background-position: center` does, then resized and saved as WebP.
Changing a pick is one line in TILES plus a re-run."""
import sys
from pathlib import Path
from PIL import Image

TILE_SIZE = (320, 304)   # 20:19, shown at 76-160 css px
TILE_QUALITY = 72
TILE_MAX_KB = 18
BG_SIZE = (1200, 800)    # 3:2
BG_QUALITY = 55
BG_MAX_KB = 60
WASH = 0.72              # background is blended this far toward white

# name, page, (x%, y%, w%, h%)
TILES = [
    ("c05", "013", (25, 3, 73, 52)),
    ("c02", "062", (3, 5, 85, 45)),
    ("c07", "045", (5, 14, 95, 36)),
    ("n01", "035", (35, 8, 55, 34)),
    ("n16", "034", (0, 15, 70, 30)),
    ("n26", "022", (0, 0, 60, 40)),
    ("c06", "029", (15, 12, 85, 73)),
]
BG = ("bg", "025", (0, 5, 100, 50))

def cut(pages, page, box, size):
    img = Image.open(pages / f"{page}.webp").convert("RGB")
    W, H = img.size
    x, y, w, h = box
    if min(x, y, w, h) < 0 or x + w > 100 or y + h > 100 or w == 0 or h == 0:
        sys.exit(f"box {box} falls outside page {page}")
    l, t, r, b = x * W / 100, y * H / 100, (x + w) * W / 100, (y + h) * H / 100
    want = size[0] / size[1]
    if (r - l) / (b - t) > want:  # too wide: trim sides
        d = ((r - l) - (b - t) * want) / 2; l, r = l + d, r - d
    else:                         # too tall: trim top/bottom
        d = ((b - t) - (r - l) / want) / 2; t, b = t + d, b - d
    return img.resize(size, Image.LANCZOS, box=(l, t, r, b))

def main():
    pages = Path(sys.argv[1] if len(sys.argv) > 1 else "site/yearbook/pages")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "site/assets/cover")
    out.mkdir(parents=True, exist_ok=True)
    over = False
    for name, page, box in TILES + [BG]:
        bg = name == "bg"
        im = cut(pages, page, box, BG_SIZE if bg else TILE_SIZE)
        if bg:
            im = Image.blend(im, Image.new("RGB", im.size, "white"), WASH)
        path = out / (f"{name}.webp" if bg else f"chev-{name}.webp")
        limit = BG_MAX_KB if bg else TILE_MAX_KB
        q = BG_QUALITY if bg else TILE_QUALITY
        while True:  # "about" the target quality: step down until under budget
            im.save(path, "WEBP", quality=q, method=6)
            kb = path.stat().st_size / 1024
            if kb <= limit or q <= 50: break
            q -= 2
        print(f"{path}  q{q} {kb:.1f} KB (limit {limit})")
        over |= kb > limit
    if over:
        sys.exit("over budget")

main()
