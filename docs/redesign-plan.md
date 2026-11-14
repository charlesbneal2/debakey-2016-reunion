# DeBakey 2016 reunion site: redesign analysis and implementation plan

Copied into the repo from the planning scratchpad. Phases 1 and 2 are implemented on `reunion-site`. `$S` below was a temporary scratchpad folder holding the mockups and screenshots; it is not in the repo and may no longer exist. Paths like `mockups/main.html` refer to files that lived there. Face sprite generator: `tools/yearbook_faces.py`; sprites: `site/assets/faces-{1,2}.webp`.

## 1. Mockups to review first

The yearbook mockup runs the real `site/yearbook.js` and vendor libraries against new markup and CSS, with `fetch` stubbed (sample signatures, nothing reaches Supabase).

| What | HTML | Desktop 1440 | Phone 390 |
|---|---|---|---|
| Main page, "Daylight" (owner's current pick; the file's default) | `$S/mockups/main.html` | `$S/mockups/main-B-daylight-1440.png` | `$S/mockups/main-B-daylight-390.png` |
| Main page, "Midnight" (set `data-theme="midnight"` on `<html>`) | same file | `$S/mockups/main-A-midnight-1440.png` | `$S/mockups/main-A-midnight-390.png` |
| Yearbook viewer, open spread | `$S/mockups/yearbook.html` | `$S/mockups/yearbook-spread-1440.png` | `$S/mockups/yearbook-page-390.png` |
| Yearbook viewer, cover | same | `$S/mockups/yearbook-cover-1440.png` | |
| Signing sheet, re-skinned | `$S/mockups/yearbook.html#sign` | `$S/mockups/yearbook-sign-1440.png` | `$S/mockups/yearbook-sign-390.png` |

Guided walkthrough for the owner (12 slides, led by Daylight with Midnight shown alongside, plain-language callouts, opens directly from disk; local only, do not publish, it shows classmates' faces): `$S/mockups/slideshow.html`. Its extra images are in `$S/mockups/img/`.

Notes on the mockups:
- There is no visitor-facing theme switch. The scheme is one attribute in the page's code: `<html data-theme="daylight">` or `"midnight"` in `main.html`. The two schemes share all markup and layout; only about 20 colour tokens differ.
- The yearbook viewer and the signing sheet are dark in both schemes (owner's decision); `yearbook.html` has no theme setting. I tried a light warm-grey signing surround and dropped it: cream paper on light grey has little separation, while on dark the sheet stands out, and the signer is an overlay on the already-dark viewer.
- The mockup folder symlinks `yearbook/`, `vendor/` and `yearbook.js` to the repo's `site/`, so the HTML only works on this machine. Serve it with `cd $S/mockups && python3 -m http.server 8766` and open `http://127.0.0.1:8766/main.html` (that is how the PNGs were rendered; opening the files directly was not tried).
- The PNGs are static; the marquee moves in the HTML.

Screenshots of the current site, for comparison: `$S/shots/cur-main-1440.png`, `cur-main-390.png`, `cur-yearbook-1440.png`, `cur-yearbook-390.png`, `cur-sign-1440.png`.

Portrait prototype output: `$S/portraits/contact-sheet.png` (all 170 faces), `$S/portraits/debug-99.jpg` … `debug-107.jpg` (detected boxes, numbered), sprites `$S/mockups/assets/faces-1.webp` and `faces-2.webp`, and the script `$S/yearbook_faces.py`.

## 2. What the codebase is

- Static site in `site/`, no build step, no framework. Deployed by `.github/workflows/pages.yml`, which uploads `site/` to GitHub Pages on push to `master`. Work happens on `reunion-site`; master is only fast-forwarded with the owner's OK.
- One stylesheet, `site/styles.css` (378 lines), shared by `index.html`, `yearbook.html`, `thanks.html`, `ticket.html`, `privacy.html`, `door.html`. Tokens on `:root` (navy `#12266b`, sky `#a2bffe`, shadcn-style neutrals), font Geist from Google Fonts.
- `site/index.html` + `site/app.js`: cover, yearbook teaser, ticket form (Stripe checkout via a Supabase function), footer. The guest list is paused (hidden).
- `site/yearbook.html` + `site/yearbook.js` (307 lines): StPageFlip (`vendor/page-flip.browser.js`) for the book, Panzoom (`vendor/panzoom.min.js`) for the signing sheet only. The book itself has no zoom.
  - Pages are `site/yearbook/pages/001.webp` … `118.webp` plus `front.webp`, `back.webp`, about 1050–1100 x 1400 px, 16 MB total, assigned lazily from `data-src` for pages near the current one.
  - `yearbook.js` finds things by id: `book`, `sign-left`, `sign-right`, `page-indicator`, `prev`, `next`, `sign-jump`, `signer`, `signer-viewport`, `sheet`, `write-tools`, `write-post`, `write-cancel`, `write-here`, `signer-close`, `signer-status`; and by class: `.yb-header`, `.yb-main` (made `inert` while signing), `.sheet-mini`. Keep all of these and no JS change is needed.
  - Keyboard: ArrowLeft/ArrowRight flip (ignored while typing or signing), Escape closes the write box then the signer, Tab is trapped in the signer.
  - `.yb-book-wrap` has `overflow: hidden` and a `max-width` derived from viewport height. Both are load-bearing (commit 697590b: flip shadows otherwise add scrollbars).
- `tools/yearbook_pages.py`: one-time PyMuPDF + Pillow script that produced the page images from `yearbook/*.pdf` (git-ignored, 561 MB). The source scans are only about 1717 px tall per page, so re-rendering gains 1.2x at most.
- `tests/layout.mjs`: Playwright checks. The ones this redesign touches:
  - "key facts fit on first screen of a small phone" (360x640: date, venue, Get Tickets and the email must all sit above 640 px inside `#cover`). The marquee eats hero height, so this is the tightest constraint. The mockup passes it (email bottom at 598 px) by hiding the second marquee row on short phones.
  - "yearbook section links to the book and signing" asserts the link texts "Open the yearbook" and "Sign the yearbook". It must be updated with the new labels.
  - "no scrollbars while arrow keys flip interior pages", the overflow checks at 360/390/1280, and all signer tests. The mockup viewer measured 0 px overflow during ten flips at 360x640, 390x844 and 1280x720.

## 3. Critique of the current site

1. The cover is one flat, saturated periwinkle slab (`#a2bffe`) with a faint white glow. Paired with generic UI-kit sans headings it reads as a template, not an invitation.
2. Geist at weight 600 for every heading gives no contrast between display and body text. There is no typographic voice.
3. The yearbook teaser is a tilted thumbnail with a drop shadow, an eyebrow, a heading, a sentence and two buttons. Five elements say one thing.
4. Section rhythm is "grey band, hairline, grey band" with small blue eyebrow labels ("From the yearbook", "Admission"), which is SaaS landing-page vocabulary.
5. Square-ish 8 px buttons, 1 px borders and tiny shadows everywhere: tidy but anonymous.
6. Yearbook viewer: the same periwinkle fills the screen and competes with a very colourful book. White slab buttons and a text header take attention from the pages. On phones the lower 40% of the screen is empty periwinkle.
7. Signing sheet: same periwinkle surround, heavy bordered buttons.

## 4. Design direction

One idea: a quiet stage (light sky for Daylight, deep navy for Midnight, always dark inside the yearbook) with a few glass surfaces, a serif display face, and the class's own faces and yearbook supplying all the colour.

### Palette

The owner is leaning toward Daylight. Both schemes stay in the stylesheet, chosen by one attribute (see "Theme switch" below). Midnight tokens:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#050a1c` | page base |
| `--bg-glow-1` | `rgb(47 73 201 / 55%)` | royal-blue radial glows |
| `--bg-glow-2` | `rgb(162 191 254 / 28%)` | sky radial glows (the existing brand sky) |
| `--ink` / `--ink-2` / `--ink-3` | `#f5f7ff` at 100% / 70% / 48% | text tiers |
| `--accent` | `#a2bffe` | italic word in the title, focus ring, checked states |
| `--cta` / `--cta-ink` | `#f5f7ff` / `#0b1846` | the one solid button |

Daylight (current pick): same layout, `--bg #e9efff`, navy ink `#0b1846`, accent `#2f49c9`, white-frost glass, navy CTA `#12266b`. Closer to today's brand colour; glass is subtler on light.

Theme switch: code-level only, never shown to visitors. `site/index.html` carries `<html lang="en" data-theme="daylight">`; the stylesheet has the Midnight tokens as the base block and a `:root[data-theme="daylight"]` override block (as in `mockups/main.html`). To preview the other scheme, change that one word. No JS, no cookie, no toggle UI.

Yearbook viewer and signing sheet (identical in both schemes, no theme attribute): neutral near-black, not navy, so the pages' colours stay true: `radial-gradient(120% 85% at 50% 38%, #262a36 0, #12141b 52%, #050609 100%)`.

### Typography

- Display: Instrument Serif 400 (roman + italic) for `h1`, `h2` and the yearbook label. One weight, a small download.
- UI/body: Geist 400/500 (already loaded). Drop 600/700 from the index font request if nothing else there uses them.
- Signing: Caveat, unchanged.
- Sizes: h1 `clamp(2.7rem, min(11vw, 10svh), 5.6rem)`, h2 `clamp(2rem, 6vw, 3rem)`, body 16 px, small-caps labels .7rem with `.12em` tracking.
- Fallback stack: `"Instrument Serif", "Iowan Old Style", Georgia, serif`.

### Spacing, shape, motion

- Sections get `clamp(44px, 7vw, 80px)` vertical padding, with no hairlines or alternating bands; the background glow carries the transitions.
- Radii: 999 px pills for buttons and chips, 22–26 px for cards, 14 px for fields.
- Motion: one easing, `cubic-bezier(.2,.8,.2,1)`; 200–250 ms on buttons, 700 ms on the book tilt; the marquee is linear. Everything is off under `prefers-reduced-motion`.

### Liquid glass recipe

```css
.glass {
  background: linear-gradient(135deg, var(--glass-a), var(--glass-b));   /* Midnight: white 15% -> 4%; Daylight: white 72% -> 34% */
  border: 1px solid var(--glass-edge);                                   /* Midnight: white 22%; Daylight: white 85% */
  box-shadow:
    inset 0 1px 0 var(--glass-hi),            /* top specular edge. Midnight: white 45% */
    inset 0 -1px 0 rgb(255 255 255 / 6%),     /* faint bottom rim */
    0 18px 40px -18px var(--glass-shadow);    /* soft lift */
  -webkit-backdrop-filter: blur(18px) saturate(170%);
  backdrop-filter: blur(18px) saturate(170%);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass { background: var(--glass-solid); }  /* Midnight: #17224d; Daylight: #f6f8ff */
}
```

Where it goes, and nowhere else: the "Class of 2016" chip, the when/where card, the Open / Sign pills, the ticket form card, the yearbook dock and back chip, the signer buttons and toast.

Rules that keep it tasteful and fast:
- At most three or four glass surfaces in any viewport.
- Never put glass over the moving marquee or animate a glass element's size: that forces a re-blur every frame on phones.
- Blur stays at or under 20 px. Surfaces are small, except the ticket card, which sits on a static gradient.
- The page background is an absolutely positioned gradient layer that scrolls with the content, not `background-attachment: fixed`, which repaints on iOS.
- True refraction (SVG `feDisplacementMap` inside `backdrop-filter`) only works in Chromium. Skipped; the gradient plus specular edge gets most of the look everywhere.
- Text on glass must stay above 4.5:1 contrast: near-white on Midnight, navy on Daylight. Field fills are a separate, more opaque token (`--field`). Contrast was judged by eye in the mockups, not measured.

### What to remove

- The copy "The whole yearbook, page by page. Then leave your name and a note on the last page, just like back then."
- The eyebrows "From the yearbook" and "Admission", the heading "Flip through 2016", and the rotated thumbnail.
- The grey section bands and hairline borders, and the footer "Questions?" heading (one line is enough; the cover already has the email).
- In the viewer: the text header, the white Prev/Next slabs, the periwinkle background.

## 5. Portrait extraction: findings

- The owner's "pages 99–107" are the viewer's page numbers, which are the files `site/yearbook/pages/099.webp` … `107.webp`. The numbers printed on the paper are 102–110 (file 098 is the "Class of 2017 Superlatives" page, printed 101).
- Layout: 5 columns x 4 rows on eight pages, 5 x 2 on the last. 8 x 20 + 10 = **170 portraits**.
- Prototype result: **170 of 170 found, in reading order (alphabetical, Adams to Zhang)**. 168 came from the colour threshold and contours, 2 from grid inference (one white coat on grey, one red shirt). The script asserts the 20/20/…/10 counts, so a regression fails loudly.
- Method (`$S/yearbook_faces.py`, about 85 lines, ready to drop in as `tools/yearbook_faces.py`):
  1. HSV mask of "not paper": dark pixels or saturated blue.
  2. 7 px morphological open to detach caption text.
  3. External contours; keep bounding boxes 120–200 px wide, 150–240 px tall, aspect .65–.95.
  4. Group into rows by y, sort by x, and fill any missing cell from the column's median x and the row's median y.
  5. Crop a square from the top of each box (a 7% inset hides the photo edge and the camera skew), resize to 144 px.
  6. Pack into two sprite strips (faces alternate between the strips so both run A–Z), with rounded corners and 10 px gaps baked in as alpha.
- Output: `faces-1.webp` and `faces-2.webp`, each 13090 x 144 px, 181 KB + 175 KB at quality 72. Two strips because WebP caps at 16383 px per side, and two counter-scrolling rows look better anyway.
- Quality: source crops are about 135 px square, so 144 px tiles shown at 52–76 CSS px are sharp on 2x screens and slightly soft on 3x phones. Re-rendering from the PDFs would only give 1.2x; not worth it.
- Known blemishes: the two grid-inferred crops (numbers 29 and 82 in the debug images) sit slightly off-centre, and a few tiles show a sliver of white paper at a corner from page curl. Fixable with a per-number nudge table if the owner cares; I would ship as is.
- Names: printed under each photo and legible, but captions run straight into the quotes. OCR would need Tesseract (not installed) plus proofreading 170 names by hand. Recommendation: **no names**. The banner is decorative, and unnamed faces are the lower-risk choice.
- Tools: system Python 3.12 has no imaging libraries. The prototype used a scratch venv with `opencv-python-headless` and `numpy` (Pillow and PyMuPDF were installed for inspection only). This is the same throwaway-venv pattern as the existing `tools/yearbook_pages.py`. Nothing is added to the site's runtime.
- Privacy: the site is already `noindex` (meta tag; there is also a `robots.txt`), and these faces are already in the yearbook pages it serves. The banner makes them more prominent, on the first screen. Mitigations built in: no names, `alt=""` plus `aria-hidden`, and a `SKIP` set in the script to drop anyone who asks (a rebuild takes a second). Worth a line in `privacy.html`.

## 6. Marquee banner spec

Markup (inside `#cover`, above `.cover-inner`):

```html
<div class="faces" aria-hidden="true">
  <div class="faces-track">
    <img src="assets/faces-1.webp" width="13090" height="144" alt="" decoding="async">
    <img src="assets/faces-1.webp" width="13090" height="144" alt="" decoding="async">
  </div>
  <div class="faces-track"> …same with faces-2.webp… </div>
</div>
```

```css
.faces { --tile: clamp(52px, 6.2vw, 76px); display: grid; gap: 8px; overflow: hidden; padding-top: 14px;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
          mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); }
.faces-track { display: flex; width: max-content; animation: faces 240s linear infinite; }
.faces-track:nth-child(2) { animation-direction: reverse; animation-duration: 280s; }
.faces-track img { display: block; height: var(--tile); width: auto; max-width: none; }
.faces:hover .faces-track { animation-play-state: paused; }
@keyframes faces { to { transform: translateX(-50%); } }
@media (prefers-reduced-motion: reduce) { .faces { overflow-x: auto; scrollbar-width: none; } .faces-track { animation: none; } }
@media (max-height: 700px) and (max-width: 560px) { .faces-track:nth-child(2) { display: none; } }
```

- CSS only, no JS. Each track holds the strip twice and slides by exactly half its width, so the loop is seamless. Only `transform` animates, so it runs on the compositor.
- Speed: about 29 px/s on desktop, 20 px/s on phones, slow enough to recognise people. If phones feel too slow, set 170s under 560 px.
- Loading: four `<img>` elements, two HTTP requests, 356 KB total. The `width`/`height` attributes plus the fixed `--tile` height mean no layout shift. Not lazy (it is the first thing on the page); `decoding="async"` keeps decode off the main thread. Optionally add `fetchpriority="low"` so the font and logo win.
- Pause on hover is for desktop; touch devices just keep scrolling.
- Phones: 52 px tiles, two rows (about 126 px), one row when the viewport is under 700 px tall so the key facts still fit the first screen.
- Risk to check on a real iPhone: a 13090 px-wide image as a composited layer. Only desktop Chromium was tested. If Safari shows blank tiles, change the script's `row::2` split to four strips of about 43 and use four `<img>` per track.

## 7. Yearbook entry point (main page)

- The cover image becomes a small 3D book built in CSS: front board, a striped fore-edge (`::before` rotated 90°), and a back board carrying the shadow (`::after`). It rests at `rotateY(-26deg) rotateX(5deg)` and swings to `-10deg` and lifts 6 px on hover or keyboard focus.
- Under it: one serif italic label, "The 2016 Yearbook", and two small glass pills, "Open" and "Sign it". No sentence.
- The whole book is a link to `yearbook.html`; the pills are the explicit, touch-friendly targets. Hover does not exist on phones, so the resting tilt has to carry the look there.
- Leaner alternative if the owner wants even less: drop the pills and keep only the book and label; signing is reachable from the viewer's dock.

## 8. Yearbook viewer redesign

- Background: the neutral dark vignette above, with the light spot behind the book.
- The header becomes a 44 px glass back chip, fixed top-left (`aria-label="Reunion home"`); the `h1` stays in the DOM, visually hidden.
- The controls become one floating glass dock, fixed bottom-centre: chevron, page indicator, chevron, hairline, pen icon + "Sign". Same ids, same `aria-label`s, 44 px hit targets, inline SVG icons (no icon font or library).
- Book sizing: `.yb-main { display: grid; place-items: center; min-height: 100dvh; padding: 16px 16px 92px; }` and `.yb-book-wrap { width: 100%; max-width: min(1400px, calc((100dvh - 124px) * 1.5)); overflow: hidden; }`. The book can grow from 1100 to 1400 px wide on big screens and is vertically centred on phones. `overflow: hidden` on the wrap stays.
- Signer: the same vignette behind the cream sheet, glass pills for Book / Write here, Cancel / Post as a floating dock instead of a flex row, glass toast.
- JS: **no change required**. In the mockup, running the real `yearbook.js`, these were exercised: next-button flips, ArrowRight flips, lazy page loading, and the `#sign` deep link opening the signer. Tap-to-write, posting, pinch and focus return were not exercised in the mockup; the existing test suite covers them once the change is in the repo.
- Interaction with the zoom code: Panzoom is attached only to `#sheet` inside the signer; nothing on the book. `fit()` and `centreOn()` read `#signer-viewport`'s client size. Moving `.signer-tools` from a flex row to an absolutely positioned dock means the viewport no longer shrinks when the tools appear, which should be neutral for the centring maths. `touch-action: none` on the viewport and `.panzoom-exclude` on the write box stay as they are.
- Optional polish, each a few lines, only if the owner asks:
  - Centre the closed cover (StPageFlip parks it on the right half; see `yearbook-cover-1440.png`): toggle a class in `update()` when the index is 0 or the last page in landscape, and `translateX(-25%)` the book with a transition.
  - A shorter indicator ("5–6 / 118") by editing `label()`.
  - Keep the signer hint visible on phones (the mockup hides it under 560 px; today it wraps to its own line).

## 9. Implementation plan

Small phases, each shippable on `reunion-site` on its own. No new runtime dependencies in any phase. Nothing goes to `master` without the owner's go-ahead.

Before starting: get answers to the open questions in section 10. Phase 2 can start on Daylight now, since switching later is a one-word change.

Local preview and test setup, used by every phase:
- `cd site && python3 -m http.server 8765`
- Playwright needs extra libraries on this WSL box: `apt-get download libnss3 libnspr4 libasound2t64`, `dpkg-deb -x` each into a scratch folder, then `LD_LIBRARY_PATH=<folder>/usr/lib/x86_64-linux-gnu node tests/layout.mjs`. Set `SCREENSHOT_DIR=<folder>` to keep the test screenshots.

### Phase 1: face sprites (assets only, invisible until phase 2)

Files:
- New `tools/yearbook_faces.py`: a copy of `$S/yearbook_faces.py`. Its defaults already point at `site/yearbook/pages` and `site/assets`.
- New `site/assets/faces-1.webp` and `site/assets/faces-2.webp` (generated).

Verify:
- The script prints two lines with `13090x144` and exits 0 (its assertion checks 8 x 20 + 10).
- Run once with a debug folder as the third argument and look at the nine `debug-*.jpg` images: every portrait boxed and numbered in reading order.
- Open both sprites; no captions or page edges visible.

### Phase 2: main page

Files:
- `site/index.html`
  - Add Instrument Serif to the Google Fonts link.
  - Add `class="home"` to `<body>` so the new look is scoped to this page (see phase 4), and `data-theme="daylight"` to `<html>` as the single scheme switch.
  - Insert the `.faces` block at the top of `#cover`.
  - The kicker gets `glass`; the title becomes `The Ten‑Year <em>Reunion</em>`; `.facts` becomes a two-cell glass card (When / Where). Keep the exact strings "November 28, 2026", "Eureka Heights", "Get Tickets" and the email inside `#cover`; tests look for them.
  - Keep `#cover-cta`, `#cover-closed` and every form id untouched (`app.js` uses them).
  - Replace the body of the `#yearbook` section with the book link, label and two pills from the mockup. Delete the lede paragraph, eyebrow and old heading.
  - Remove the "Admission" eyebrow, shorten the tickets blurb, centre the heading.
  - Collapse the footer to two lines; keep `id="questions"` and the "Privacy" link (a test clicks it there).
- `site/styles.css`
  - Add both token sets (Midnight base, `:root[data-theme="daylight"]` override), applied under `body.home`, plus `.glass`, `.faces*`, `.book*` and the restyled cover, button, form and footer rules from `mockups/main.html`, all scoped so `thanks`, `ticket`, `privacy` and `door` render exactly as before.
  - Delete the now-unused `.yearbook-feature`, `.yearbook-cover`, `.yearbook-lede` rules. `.eyebrow` is still used by the hidden `#guests` section; leave or restyle it.
  - Extend the reduced-motion block.
- `tests/layout.mjs`
  - Update "yearbook section links to the book and signing" for the new labels and structure.
  - Add one check: the removed sentence is gone and `.faces img` count is 4.

Verify:
- `node tests/layout.mjs` is green, in particular "key facts fit on first screen of a small phone" and the three index overflow cases.
- Screenshots at 360x640, 390x844 and 1440x900 match the mockups, once with `data-theme="daylight"` and once with `"midnight"`.
- Ticket flow by hand: both radio choices, the guest field appears, the blank-name error is readable on the glass card, the disabled button state is visible. (The mockup form is static; these states were not mocked.)
- Sales-closed state: load with the clock past 2026-11-29T03:00Z (the tests already do) and check `.sales-closed` and `#cover-closed` are legible on the new background. Not mocked either.
- With the OS "reduce motion" setting on: the marquee is still and can be swiped sideways.
- With `backdrop-filter` unavailable: the solid fallback is readable.
- Real iPhone and Android: the marquee is smooth, no blank tiles, page scrolling stays smooth.

### Phase 3: yearbook viewer and signer skin

Files:
- `site/yearbook.html`: the header becomes the back chip plus a visually hidden `h1`; the controls become the dock; the signer buttons get the pill classes. Keep every id and the `.yb-header` / `.yb-main` wrappers. The markup is in `mockups/yearbook.html` (drop its mock `fetch` script and restore `config.js`).
- `site/styles.css`: replace the "Yearbook viewer" and "Signing sheet" blocks (lines 316–378) with the mockup's CSS. `.yearbook-page` gets its own dark tokens and ignores `data-theme`: viewer and signer are dark in both schemes.
- `site/yearbook.js`: no change. (The optional polish items from section 8 would go here.)
- `tests/layout.mjs`: no change expected.

Verify:
- `node tests/layout.mjs` is green: overflow at three sizes, "no scrollbars while arrow keys flip interior pages", cover-then-next, arrow keys, and every signer case (tap to write, drag does not write, wheel zoom keeps the point under the cursor, edge clamping, resize, focus return, `#sign` deep link).
- By hand on desktop: arrow keys flip; Tab order is back chip, prev, next, Sign; focus rings are visible on dark; Escape closes the write box, then the signer.
- By hand on a real phone (pinch is still listed as untested in the project notes): swipe to flip, pinch on the signing sheet, tap to write with the keyboard up. The floating Cancel/Post dock must not sit under the keyboard or over the write box. This is the main regression risk of the phase.
- Landscape phone (about 844x390): the book must still fit above the dock. The `100dvh - 124px` term should handle it, but it was not rendered.

### Phase 4 (optional): bring the small pages along

- `thanks.html`, `ticket.html`, `privacy.html`: add `class="home"` and check the `.panel` and `.prose` rules against the new tokens. The ticket QR must stay on a pure white tile for scanning.
- `door.html`: leave it alone. It is a tool used at the door; high-contrast green/red is correct.
- `site/assets/og.png` still shows the sky-blue look. It is close to Daylight already; regenerate it only if Midnight ships or the owner wants the new serif on it, and bump `?v=5` in `index.html`. The ticket email header PNG is independent and can stay.
- `privacy.html`: one sentence saying senior portraits from the 2016 yearbook appear on the site and how to ask for removal.
- `README.md`: the "Adding yearbook content" paragraph is stale; replace it with one line each for `tools/yearbook_pages.py` and `tools/yearbook_faces.py`.

### Phase 5: ship

- The owner reviews `reunion-site` locally or via screenshots.
- On approval, fast-forward `master` (site only; this plan has no Supabase function or migration changes).
- After deploy: load the live page on a phone, confirm the two sprites load and the yearbook opens. The earlier pre-merge item still stands: check that a real signature's `ip_hash` does not start with `b23a6a8439c0`.

## 10. Open questions for the owner

1. Daylight confirmed for the main page? (Owner is leaning that way; Midnight remains a one-word change. The viewer and signing sheet stay dark either way: decided.)
2. Faces banner: fine to show all 170 portraits, without names, on the first screen? Anyone to leave out?
3. Two rows scrolling in opposite directions (as in the mockup) or a single row?
4. Yearbook entry: book + "The 2016 Yearbook" + Open / Sign it pills, or book and label only?
5. Is the serif (Instrument Serif) the right voice, or keep everything sans?
6. Viewer: want the closed cover centred, and the shorter "5–6 / 118" indicator? Both are small optional JS edits.
7. Should the thanks / ticket / privacy pages get the new look too (phase 4), and should the share image (`og.png`) be regenerated to match?
