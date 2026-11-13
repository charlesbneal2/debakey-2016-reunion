# Digital Yearbook — Design

## Intent
Let classmates flip through the 2016 DeBakey yearbook on the reunion site, like turning real pages, and sign it the way people signed yearbooks in school. Nostalgia piece for the ten-year reunion.

## Goals
- "Open the yearbook" button on the home page → new page `site/yearbook.html`.
- Book order: front cover (alone) → 118 interior pages (59 photographed spreads, each split into left/right) → 2-page signing spread → back cover (alone).
- Page turning: drag/swipe corner, click/tap edges, prev/next buttons, arrow keys.
- Desktop shows two-page spreads; phones show one page at a time.
- "Sign the yearbook" button (on home page and in the viewer) jumps straight to the signing spread.
- Signing: name + message, visible to everyone immediately.
- Owner removes unwanted signatures by deleting the row in Supabase Table Editor.

## Non-goals
- Finger-drawn signatures (follow-up).
- Approval queue, accounts, editing/deleting own signature.
- Search, zoom UI beyond browser pinch-zoom, page thumbnails/index.
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

### Signing spread (two HTML pages inside the book)
- Left page: "Sign the yearbook" form — name (required, ≤60 chars), message (optional, ≤280 chars), Sign button. Success → signature appears on the right page.
- Right page: all signatures, newest first, scrolls within the page if long. Styled like handwriting on paper (a handwriting web font is fine).
- Inputs must still be usable inside the flip widget (taps on form fields don't trigger page turn).

### Backend
- Migration: `signatures (id uuid pk, name text not null, message text, ip_hash text, created_at timestamptz default now())`, RLS on, no anon access, service_role only (same as other tables).
- Edge function `signatures`: `GET` → `{ signatures: [{name, message, created_at}] }` (no ip_hash); `POST {name, message}` → validates lengths, trims, rejects empty name; rate limit ~5 signatures per IP-hash per hour → 429.
- Store functions added to `Store` / `live_store.ts`; handler tested with fake store in `supabase/tests/` like existing handlers.
- Plain text only; rendered with `textContent` (no HTML injection).
- Owner deletes junk rows in Supabase Table Editor → `signatures`.

### Home page
- Replace hidden placeholder `#yearbook` section with: front cover thumbnail, "Open the yearbook" → `yearbook.html`, "Sign the yearbook" → `yearbook.html#sign`. Unhide it.

### Tests
- `supabase/tests/`: signatures handler (list, add, validation, rate limit).
- `tests/layout.mjs`: yearbook page loads without errors, no horizontal scroll at phone widths, `#sign` lands on signing form, mocked signature list renders.

### Deploy
- Owner runs it locally (site served locally + local Supabase or mocked function) and approves before anything is pushed to `master`.
- Push `master` for site. Migration + function deploy to prod only with owner OK (`--yes` in agent runs).

## Left to the builder
- Exact image size/quality, WebP vs JPEG.
- Per-spread split offsets.
- Visual styling of controls and signing pages within site style.
