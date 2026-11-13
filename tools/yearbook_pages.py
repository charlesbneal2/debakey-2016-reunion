"""Turn the photographed yearbook PDFs (yearbook/, not in git) into site/yearbook/pages/*.webp.

One-time tool. Needs PyMuPDF + Pillow in a throwaway venv:
    python3 -m venv venv && venv/bin/pip install pymupdf pillow
    venv/bin/python -I tools/yearbook_pages.py
"""
import io
import sys
from pathlib import Path

import pymupdf
from PIL import Image

HEIGHT = 1400
QUALITY = 72
# Parts 1 and 3 are stored sideways; part 2 already has /Rotate in the PDF.
PARTS = [(1, range(0, 24), True), (2, range(0, 24), False), (3, range(0, 11), True)]
COVERS = {"front": (3, 11), "back": (3, 12)}
# Gutter nudges in output px, keyed by 1-based spread number. + moves the split right.
OFFSETS: dict[int, int] = {30: -60, 31: -62, 32: -55, 33: -25, 39: -25}


def render(doc, index, rotate, height):
    page = doc[index]
    w, h = page.rect.width, page.rect.height  # rect is already rotated by /Rotate
    target_h = w if rotate else h  # after our 90° turn, the old width becomes height
    scale = height / target_h
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale))
    img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    return img.rotate(90, expand=True) if rotate else img


def main(src="yearbook", out="site/yearbook/pages"):
    src, out = Path(src), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    docs = {n: pymupdf.open(src / f"yearbook_16_part_{n}.pdf") for n in (1, 2, 3)}

    for name, (part, index) in COVERS.items():
        render(docs[part], index, False, HEIGHT).save(out / f"{name}.webp", quality=QUALITY)

    spread = 0
    for part, indexes, rotate in PARTS:
        for index in indexes:
            spread += 1
            img = render(docs[part], index, rotate, HEIGHT)
            cut = img.width // 2 + OFFSETS.get(spread, 0)
            img.crop((0, 0, cut, img.height)).save(out / f"{2 * spread - 1:03}.webp", quality=QUALITY)
            img.crop((cut, 0, img.width, img.height)).save(out / f"{2 * spread:03}.webp", quality=QUALITY)
            print(f"spread {spread} ({part}#{index})", file=sys.stderr)

    check(out)


def check(out):
    numbered = sorted(out.glob("[0-9][0-9][0-9].webp"))
    assert [p.stem for p in numbered] == [f"{i:03}" for i in range(1, 119)], "expected pages 001-118"
    assert (out / "front.webp").exists() and (out / "back.webp").exists(), "missing covers"
    for p in numbered:
        w, h = Image.open(p).size
        assert h > w, f"{p.name} is not portrait ({w}x{h})"
    total = sum(p.stat().st_size for p in out.glob("*.webp")) / 1e6
    assert total < 40, f"pages total {total:.1f} MB, want < 40"
    print(f"ok: 118 pages + covers, {total:.1f} MB")


if __name__ == "__main__":
    main()
