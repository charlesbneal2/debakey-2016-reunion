"""Turn the photographed yearbook PDFs (yearbook/, not in git) into site/yearbook/pages/*.webp.

One-time tool. Needs PyMuPDF + Pillow in a throwaway venv:
    python3 -m venv venv && venv/bin/pip install pymupdf pillow
    venv/bin/python -I tools/yearbook_pages.py [src] [out] [only]
"""
import io
import sys
from pathlib import Path

import pymupdf
from PIL import Image

HEIGHT = 1400
QUALITY = 72
# Spreads in book order as (pdf, page index, sideways). Parts 1 and 3 and 891112 are stored sideways;
# part 2 already has /Rotate in the PDF. 891112.pdf holds printed pp. 8-9 and 12-13, missed in the first scan.
P1 = [("yearbook_16_part_1", i, True) for i in range(0, 24)]
SPREADS = (
    P1[:4] + [("891112", 0, True)] + P1[4:5] + [("891112", 1, True)] + P1[5:]
    + [("yearbook_16_part_2", i, False) for i in range(0, 24)]
    + [("yearbook_16_part_3", i, True) for i in range(0, 11)]
)
COVERS = {"front": ("yearbook_16_part_3", 11), "back": ("yearbook_16_part_3", 12)}
PAGES = 2 * len(SPREADS)  # 122; printed page number = file number - 1
# Gutter nudges in output px, keyed by 1-based spread number. + moves the split right.
OFFSETS: dict[int, int] = {5: -5, 7: -12, 32: -60, 33: -62, 34: -55, 35: -25, 41: -25}
# Px trimmed off a left page's outer edge, keyed by page number (121: handwritten note).
TRIM_LEFT: dict[int, int] = {121: 75}


def render(doc, index, rotate, height):
    page = doc[index]
    w, h = page.rect.width, page.rect.height  # rect is already rotated by /Rotate
    target_h = w if rotate else h  # after our 90° turn, the old width becomes height
    scale = height / target_h
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale))
    img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    return img.rotate(90, expand=True) if rotate else img


def main(src="yearbook", out="site/yearbook/pages", only=None):
    """only: comma-separated 1-based spread numbers to (re)render, e.g. "5,7"; default all."""
    src, out = Path(src), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    docs = {name: pymupdf.open(src / f"{name}.pdf") for name in {s[0] for s in SPREADS}}
    only = {int(n) for n in only.split(",")} if only else None

    if not only:
        for name, (pdf, index) in COVERS.items():
            render(docs[pdf], index, False, HEIGHT).save(out / f"{name}.webp", quality=QUALITY)

    for spread, (pdf, index, rotate) in enumerate(SPREADS, 1):
        if only and spread not in only:
            continue
        img = render(docs[pdf], index, rotate, HEIGHT)
        cut = img.width // 2 + OFFSETS.get(spread, 0)
        left = 2 * spread - 1
        img.crop((TRIM_LEFT.get(left, 0), 0, cut, img.height)).save(out / f"{left:03}.webp", quality=QUALITY)
        img.crop((cut, 0, img.width, img.height)).save(out / f"{2 * spread:03}.webp", quality=QUALITY)
        print(f"spread {spread} ({pdf}#{index})", file=sys.stderr)

    check(out)


def check(out):
    numbered = sorted(out.glob("[0-9][0-9][0-9].webp"))
    assert [p.stem for p in numbered] == [f"{i:03}" for i in range(1, PAGES + 1)], f"expected pages 001-{PAGES:03}"
    assert (out / "front.webp").exists() and (out / "back.webp").exists(), "missing covers"
    for p in numbered:
        w, h = Image.open(p).size
        assert h > w, f"{p.name} is not portrait ({w}x{h})"
    total = sum(p.stat().st_size for p in out.glob("*.webp")) / 1e6
    assert total < 40, f"pages total {total:.1f} MB, want < 40"
    print(f"ok: {PAGES} pages + covers, {total:.1f} MB")


if __name__ == "__main__":
    main(*sys.argv[1:])
