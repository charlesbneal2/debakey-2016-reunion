"""Cut the 170 senior portraits out of yearbook page files 099-107 (printed pp. 102-110) and
pack them into two sprite strips for the home-page marquee.

One-time tool. Needs opencv + numpy in a throwaway venv:
    python3 -m venv venv && venv/bin/pip install opencv-python-headless numpy
    venv/bin/python -I tools/yearbook_faces.py [pages_dir] [out_dir] [debug_dir]

Portraits are dark/blue rectangles on white paper: threshold "not paper", open to detach caption
text, keep contours with portrait-like size + aspect; fill grid gaps for odd photos."""
import sys, cv2, numpy as np
from pathlib import Path

TILE = 144      # px per face in the sprite (shown at 56-76 css px, so >= 2x)
GAP = 10        # transparent px between faces, baked into the sprite
RADIUS = 34     # rounded-corner radius, baked in as alpha
SKIP: set[int] = set()  # 1-based portrait numbers (see debug images) to leave out on request

def boxes(img):
    H = img.shape[0]; k = H / 1400
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    # paper = bright + unsaturated; portraits = everything dark or saturated-blue
    mask = ((hsv[..., 2] < 150) | ((hsv[..., 1] > 90) & (hsv[..., 0] > 90) & (hsv[..., 0] < 130))).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((int(7 * k),) * 2, np.uint8))  # detach caption text
    out = []
    for c in cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
        x, y, w, h = cv2.boundingRect(c)
        if 120 * k < w < 200 * k and 150 * k < h < 240 * k and 0.65 < w / h < 0.95:
            out.append((x, y, w, h))
    out.sort(key=lambda b: b[1])
    rows, row = [], []
    for b in out:  # group into rows by y
        if row and b[1] - row[0][1] > 80 * k: rows.append(sorted(row)); row = []
        row.append(b)
    if row: rows.append(sorted(row))
    # Odd photos (white coat, red shirt) miss the mask: the layout is a 5-column grid, so fill gaps
    # from the column's x and the row's y. ponytail: assumes every row is a full 5; true for these 9 pages.
    full = [r for r in rows if len(r) == 5]
    med = lambda v: int(np.median(v))
    w, h = med([b[2] for b in out]), med([b[3] for b in out])
    cols = [med([r[i][0] for r in full]) for i in range(5)]
    for r in rows:
        for cx in cols:
            if not any(abs(b[0] - cx) < w / 2 for b in r): r.append((cx, med([b[1] for b in r]), w, h))
        r.sort()
    return [b for r in rows for b in r]

def faces(src):
    counts, out = {}, []
    for p in range(99, 108):
        img = cv2.imread(f"{src}/{p:03}.webp"); bs = boxes(img); counts[p] = len(bs)
        for (x, y, w, h) in bs:
            i = int(w * .07); s = w - 2 * i  # square on the head; inset shaves photo edge + camera skew
            out.append((p, (x, y, w, h), cv2.resize(img[y + i:y + i + s, x + i:x + i + s], (TILE, TILE), interpolation=cv2.INTER_AREA)))
    assert all(v == 20 for p, v in counts.items() if p < 107) and counts[107] == 10, f"expected 8x20 + 10 portraits, got {counts}"
    return out

def strip(tiles):
    alpha = np.zeros((TILE, TILE), np.uint8)
    cv2.rectangle(alpha, (RADIUS, 0), (TILE - RADIUS - 1, TILE - 1), 255, -1); cv2.rectangle(alpha, (0, RADIUS), (TILE - 1, TILE - RADIUS - 1), 255, -1)
    for c in ((RADIUS, RADIUS), (TILE - RADIUS - 1, RADIUS), (RADIUS, TILE - RADIUS - 1), (TILE - RADIUS - 1, TILE - RADIUS - 1)):
        cv2.circle(alpha, c, RADIUS, 255, -1, cv2.LINE_AA)
    out = np.zeros((TILE, len(tiles) * (TILE + GAP), 4), np.uint8)
    for n, t in enumerate(tiles):
        x = n * (TILE + GAP) + GAP // 2
        out[:, x:x + TILE, :3] = t; out[:, x:x + TILE, 3] = alpha
    return out

def main(src="site/yearbook/pages", out="site/assets", debug=None):
    all_faces = faces(src)
    if debug:
        Path(debug).mkdir(parents=True, exist_ok=True)
        for p in range(99, 108):
            img = cv2.imread(f"{src}/{p:03}.webp")
            for n, (pp, (x, y, w, h), _) in enumerate(all_faces, 1):
                if pp == p: cv2.rectangle(img, (x, y), (x + w, y + h), (0, 255, 0), 3); cv2.putText(img, str(n), (x + 5, y + 30), 0, 1, (0, 255, 255), 2)
            cv2.imwrite(f"{debug}/debug-{p}.jpg", img)
    keep = [t for n, (_, _, t) in enumerate(all_faces, 1) if n not in SKIP]
    for row in (0, 1):  # alternate faces between rows so both run A-Z; each strip stays under WebP's 16383 px limit
        s = strip(keep[row::2]); assert s.shape[1] <= 16383
        cv2.imwrite(f"{out}/faces-{row + 1}.webp", s, [cv2.IMWRITE_WEBP_QUALITY, 72])
        print(f"faces-{row + 1}.webp {s.shape[1]}x{s.shape[0]} {Path(f'{out}/faces-{row + 1}.webp').stat().st_size // 1000} KB")

if __name__ == "__main__":
    main(*sys.argv[1:])
