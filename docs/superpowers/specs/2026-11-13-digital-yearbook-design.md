# Digital Yearbook — Design

## Intent
Let classmates flip through the 2016 DeBakey yearbook on the reunion site, like turning real pages, and sign it the way people signed yearbooks in school. Nostalgia piece for the ten-year reunion.

## Goals
- "Open the yearbook" button on the home page → new page `site/yearbook.html`.
- Book order: front cover (alone) → 118 interior pages (59 photographed spreads, each split into left/right) → 2-page signing spread → back cover (alone).
- Page turning: drag/swipe corner, click/tap edges, prev/next buttons, arrow keys.
- Desktop shows two-page spreads; phones show one page at a time.
- "Sign the yearbook" button (on home page and in the viewer) jumps straight to the signing spread.
- Signing (revised 2026-11-13 after local review): the signing spread is one huge sheet. Tap/click a spot → view zooms way in there → type your message in place, pick its size, post. Everyone sees it at that spot, immediately. Zoom out = whole crowded spread; zoom in to read.
- Owner removes unwanted signatures by deleting the row in Supabase Table Editor.

## Non-goals
- Finger-drawn signatures (follow-up).
- Approval queue, accounts, editing/deleting own signature.
- Search, zoom UI on the photographed pages, page thumbnails/index.
- Ink colours / fonts per signer, moving or editing a posted message.
- Serving original PDFs.

## Anti-goals
- Multi-hundred-MB downloads or slow first page on phones.
- Page splits that slice through text so pages are unreadable.

## Constraints
- PDFs (~590 MB) stay out of git: add `yearbook/` to `.gitignore`.
- GitHub Pages static site, vanilla JS, no build step. Supabase edge functions + Postgres for data.
- Source = phone photos of the physical book: some tilt, background around edges.
- Parts 1 and 3: rotate 90° counter-clockwise. Part 2 already landscape (PDF `/Rotate 270`).
- Part 3 last two PDF pages: front cover (index 11) and back cover (index 12), portrait, not split.

## Approaches
- **A. StPageFlip library (picked).** Real page-curl, touch drag, built-in portrait (single page) mode on narrow screens. One ~30 KB dependency, vendored in `site/vendor/` like html5-qrcode.
- B. Hand-rolled CSS 3D flip. No dependency, but lots of fiddly animation/touch code to own; worse mobile feel.
- C. Plain slideshow. No book feel; whole spreads too small on phones.

Signatures backend had one sensible option: new table + edge function, matching the existing `guest-list` pattern.

## Design

### Page images (one-time conversion)
- Script `tools/yearbook_pages.py` (PyMuPDF, run from a throwaway venv; not a site dependency). Reads `yearbook/*.pdf`, rotates, splits spreads at midpoint (with per-spread offset overrides in a small dict), writes `site/yearbook/pages/NNN.webp` (or JPEG if WebP tooling is a hassle) at ~1400 px tall, quality tuned for ~150–300 KB/page. Target total under ~40 MB.
- Covers written as `front.webp` / `back.webp`.
- Builder eyeballs every split (contact sheet) and adds offsets where the gutter drifts. Light cropping of background is fine but not required.
- Page list (filenames + count) baked into `yearbook.js` or derived from count — builder's call.

### Viewer (`site/yearbook.html`, `site/yearbook.js`, styles in `site/styles.css`)
- StPageFlip from HTML pages; `showCover: true`; covers hard pages.
- Images `loading="lazy"` / only nearby pages loaded, so first view is fast.
- Controls below book: ‹ Prev, page indicator, Next ›, "Sign the yearbook", back link to home.
- `yearbook.html#sign` opens directly on the signing spread (home page's sign button uses this).
- Matches site look (Geist, sky-blue brand, `noindex`).

### Signing sheet (revised)
Owner rejected the first form-based version: "i was picturing a canvas where you can click in to type your message ... you should be able to zoom in and adjust size of your text", "the page is essentially much larger and then when user clicks in it zooms in a lot ... so theres plenty of space".

Approaches considered:
- **A. Real DOM text on one big sheet + vendored Panzoom (`@panzoom/panzoom@4.5.1`, ~10 KB) for zoom/pan (picked).** Crisp text at any zoom, native cursor and phone keyboard, later finger-drawing can sit on the same sheet as SVG.
- B. Same, hand-rolled pinch/zoom — no dependency but fiddly touch code, worse first version on phones.
- C. Canvas 2D rendering — needs DOM input overlay anyway, own hit-testing, blur between redraws.

Design:
- **Sheet:** one virtual 2100 × 1400 unit sheet (shrunk from 6000 × 4000 in two steps after owner found the overview too zoomed out) (same shape as an open spread), paper background, faint centre fold line. Each signature = absolutely positioned text at `(x, y)` (fractions 0–1 of the sheet, top-left of the text), font size `size` in sheet units, handwriting font, wraps at max 600 units wide, `white-space: pre-wrap`, built with `textContent`.
- **In the book:** the signing spread's two pages each show their half of the sheet scaled to fit (left page = left half, right page = right half). Text is tiny there by design. Clicking/tapping either page opens the signer.
- **Signer (full-screen overlay):** opened by "Sign the yearbook" (viewer and home page `#sign`) or clicking the signing pages. Starts fitted to screen. Pinch / wheel / trackpad zoom, drag to pan (Panzoom). Tap or click on the sheet without dragging → zooms to scale 1 centred on that spot and puts a text box with a blinking cursor there. Toolbar while writing: Cancel, Post. One text size (24 units) for everyone; owner dropped the A−/A+ size buttons as distracting (API still accepts 16/24/36/54/80). Post → saved → box becomes the posted message, view zooms back out to fit. "Back to book" closes the overlay. Keyboard users: a "Write here" button places the box at the centre of the current view.
- **Limits:** message required, trimmed, 1–280 chars; size one of 16/24/36/54/80; x, y in [0, 1]. Overlap allowed (sheet is big; owner deletes anything bad).
- **Message only, no name field.** The signer types one message; they may or may not include their name in it.
- Arrow keys / typing never turn book pages while the overlay is open.

### Backend
- First migration (already applied to prod): `signatures (id, name, message, ip_hash, created_at)` + `list_signatures` / `add_signature`, RLS on, service_role only.
- Revision migration: delete existing rows (test data only), drop `name`, `message` becomes required 1–280, add `x`, `y` (double precision, 0–1) and `size` (smallint in 16/24/36/54/80); recreate both functions with the new shape.
- Edge function `signatures`: `GET` → `{ signatures: [{message, x, y, size, created_at}] }` (no ip_hash, no-store); `POST {message, x, y, size}` → validates and trims; rate limit 5 per IP-hash per hour → 429.
- Plain text only; rendered with `textContent`. Owner deletes junk rows in Supabase Table Editor → `signatures`.

### Home page
- Replace hidden placeholder `#yearbook` section with: front cover thumbnail, "Open the yearbook" → `yearbook.html`, "Sign the yearbook" → `yearbook.html#sign`. Unhide it.

### Tests
- `supabase/tests/`: signatures handler (list, add, validation, rate limit).
- `tests/layout.mjs`: yearbook page loads without errors, no horizontal scroll at phone widths, `#sign` opens the signer, tap-to-write posts `{message, x, y, size}`, mocked signatures render at their positions.

### Deploy
- Owner runs it locally (site served locally + local Supabase or mocked function) and approves before anything is pushed to `master`.
- Push `master` for site. Migration + function deploy to prod only with owner OK (`--yes` in agent runs).

## Left to the builder
- Exact image size/quality, WebP vs JPEG.
- Per-spread split offsets.
- Visual styling of controls, toolbar and sheet within site style.
- Exact zoom limits and animation.
