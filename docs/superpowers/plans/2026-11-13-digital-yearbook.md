# Digital Yearbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip-through 2016 yearbook page on the reunion site with a public "sign the yearbook" spread.

**Architecture:** One-time Python script turns the three photographed-yearbook PDFs into per-page WebP images committed under `site/yearbook/pages/`. `site/yearbook.html` renders them with vendored StPageFlip, plus a two-page HTML signing spread before the back cover. Signatures live in a new Postgres table behind a `signatures` edge function (GET list / POST add, per-IP rate limit), same pattern as `guest-list`.

**Tech Stack:** Vanilla JS/HTML/CSS (no build), StPageFlip (`page-flip@2.0.7`, `dist/js/page-flip.browser.js`), Supabase Postgres + Deno edge functions, PGlite + `deno test` for backend, Playwright `tests/layout.mjs` for site, PyMuPDF + Pillow (throwaway venv) for conversion.

**Spec:** `docs/superpowers/specs/2026-11-13-digital-yearbook-design.md`

## Global Constraints

- PDFs never committed: `yearbook/` in `.gitignore`.
- Book order: front cover → 118 interior pages → 2 signing pages → back cover. Covers shown alone.
- Parts 1 and 3 rotate 90° counter-clockwise; part 2 already landscape (PDF `/Rotate 270` — render as-is).
- Front cover = part 3 PDF page index 11; back cover = index 12. Interior = part 1 idx 0–23, part 2 idx 0–23, part 3 idx 0–10 (59 spreads).
- Name required, trimmed, ≤60 chars. Message optional, trimmed, ≤280 chars.
- Rate limit: 5 signatures per IP hash per rolling hour → HTTP 429.
- Signatures rendered with `textContent` only; newest first.
- No public deploy (push to `master`, `supabase db push`, `functions deploy`) without owner OK. Owner runs it locally and approves before `master`.
- Site pages `noindex`; Geist font, existing CSS tokens in `site/styles.css`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Typing in the sign form (letters, space, arrow keys, mobile keyboard, tapping fields) must not turn the page. → Task 3 test "typing in sign form does not flip".
2. Long unbroken text (280-char URL, no spaces) must wrap inside the signatures page, not overflow. → Task 3 test "long signature wraps".
3. `<script>`/HTML in name or message shows literally. → Task 3 test "signature text is literal".
4. Double-tap on Sign sends one request. → Task 3 test "sign button disabled while sending".
5. Signatures fetch fails → book still flips; signatures page says it couldn't load; form still posts. → Task 3 test "signature load failure keeps book usable".

---

### Task 1: Page images

**Files:**
- Modify: `.gitignore` (add `yearbook/`)
- Create: `tools/yearbook_pages.py`
- Create: `site/yearbook/pages/front.webp`, `back.webp`, `001.webp` … `118.webp`

**Interfaces:**
- Produces: `site/yearbook/pages/{front,back,001..118}.webp`. Odd numbers = left halves, even = right halves (spread `s` (0-based) → `2s+1` left, `2s+2` right).

- [ ] **Step 1:** Add `yearbook/` to `.gitignore`; confirm `git status` no longer lists the PDFs.
- [ ] **Step 2:** Venv in scratchpad: `python3 -m venv $S/venv && $S/venv/bin/pip install pymupdf pillow`.
- [ ] **Step 3: Write `tools/yearbook_pages.py`** — `main(src="yearbook", out="site/yearbook/pages")`. For each spread: render at a scale giving ~2800 px long edge, rotate parts 1/3 by +90° CCW (Pillow `rotate(90, expand=True)`), split at `width//2 + OFFSETS.get(n, 0)` where `OFFSETS: dict[int, int]` keyed by 1-based spread number (px at output scale), resize each half to height 1400, save WebP quality 72. Covers: render, resize to height 1400, no split. Ends with a self-check: asserts 118 numbered files + front + back exist, every numbered page has height > width, total size < 40 MB; prints total MB. Docstring line: run with `$S/venv/bin/python -I tools/yearbook_pages.py`.
- [ ] **Step 4:** Run it. Expected: self-check passes, prints total size.
- [ ] **Step 5:** Build a contact sheet of every spread's two halves side-by-side with page numbers (scratchpad, not committed). Look at all 59. Where a gutter is visibly off-centre (text cut, other page's edge showing >~3% width), add an `OFFSETS` entry, rerun. Also confirm text reads upright on parts 1/3 (if upside down, flip rotation to -90).
- [ ] **Step 6: Commit** `.gitignore`, `tools/yearbook_pages.py`, `site/yearbook/pages/` — `feat: add yearbook page images`.

### Task 2: Signatures backend

**Files:**
- Create: `supabase/migrations/20261113000000_signatures.sql`
- Modify: `supabase/tests/helpers.ts` (apply every file in `supabase/migrations/` in name order, not just init)
- Modify: `supabase/functions/_shared/store.ts`
- Create: `supabase/functions/signatures/handler.ts`, `supabase/functions/signatures/index.ts`
- Modify: `supabase/config.toml` (`[functions.signatures] verify_jwt = false`)
- Modify: `supabase/tests/deploy_test.ts` (add `"signatures"` to `FUNCTIONS`)
- Test: `supabase/tests/signatures_test.ts`

**Interfaces:**
- Produces HTTP: `GET {FUNCTIONS_URL}/signatures` → `200 {signatures: Signature[]}` with `cache-control: no-store`. `POST {FUNCTIONS_URL}/signatures` body `{name, message}` → `201 {signature: Signature}`; `400 {error}` invalid; `429 {error: "Too many signatures. Try again later."}`; `500 {error}`.
- `type Signature = { name: string; message: string; created_at: string }` (message `""` when none).
- Store: `listSignatures(): Promise<Signature[]>`, `addSignature(name: string, message: string, ipHash: string): Promise<Signature | null>` (null = rate limited).

- [ ] **Step 1: Migration.** Table `signatures(id uuid pk default gen_random_uuid(), name text not null check (char_length(name) between 1 and 60), message text not null default '' check (char_length(message) <= 280), ip_hash text not null, created_at timestamptz not null default now())`, index on `(ip_hash, created_at)`, RLS on, revoke from anon/authenticated, grant to service_role. Functions (security definer, `search_path = public`, execute only for service_role — same revoke/grant pattern as init): `list_signatures() returns jsonb` (array of `{name, message, created_at}` ordered `created_at desc, id desc`, `[]` when empty); `add_signature(p_name text, p_message text, p_ip_hash text) returns jsonb` (returns `null` if ≥5 rows for that ip_hash in last hour, else inserts and returns the new `{name, message, created_at}`).
- [ ] **Step 2: Helpers** — `newDb` reads and execs all `.sql` in `supabase/migrations/` sorted by name. Run `deno task test` — existing tests still pass.
- [ ] **Step 3: Write failing tests** in `signatures_test.ts` (use `newDb` + `createStore` + `handleSignatures`, origin `https://debakey2016reunion.com`, header `x-forwarded-for`):
  - `"lists signatures newest first with only public fields"` — add A then B; GET → 200, `no-store`, CORS header = SITE, names `["B","A"]`, keys exactly `["created_at","message","name"]`, body text has no `ip`.
  - `"adds a trimmed signature"` — POST `{name:"  Jane  ", message:"  hi  "}` → 201, `signature.name === "Jane"`, `message === "hi"`.
  - `"message is optional"` — POST `{name:"Jane"}` → 201, `message === ""`.
  - `"rejects bad input"` — each of `{name:""}`, `{name:"   "}`, `{name:"x".repeat(61)}`, `{name:"Jane", message:"x".repeat(281)}`, `{name: 5}`, non-JSON body → 400; table still empty. `{name:"x".repeat(60), message:"x".repeat(280)}` → 201.
  - `"rate limits after five per hour per ip"` — 5 POSTs from `1.1.1.1` → 201, 6th → 429; POST from `2.2.2.2` → 201.
  - `"stores a hash, not the ip"` — after POST from `1.1.1.1`, `select ip_hash from signatures` ≠ `"1.1.1.1"` and length 64.
  - `"OPTIONS 204, other methods 405"`.
- [ ] **Step 4:** Run `deno test -A supabase/tests/signatures_test.ts` — FAIL (module missing).
- [ ] **Step 5: Implement** `handleSignatures(req: Request, deps: { store: Store; siteUrl: string }): Promise<Response>` in `handler.ts`, using `corsHeaders`/`json` from `_shared/http.ts`. IP = first `x-forwarded-for` entry or `"unknown"`; `ipHash` = hex SHA-256 via `crypto.subtle`. `index.ts` mirrors `guest-list/index.ts`. Add store methods + config entry + deploy_test entry.
- [ ] **Step 6:** `deno task test` — all PASS.
- [ ] **Step 7: Commit** — `feat: add yearbook signatures function`.

### Task 3: Yearbook viewer page

**Files:**
- Create: `site/vendor/page-flip.browser.js` (from `https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.js`, unmodified)
- Create: `site/yearbook.html`, `site/yearbook.js`
- Modify: `site/styles.css` (yearbook viewer + signing page styles; handwriting font e.g. Google Fonts "Caveat" for signatures)
- Modify: `tests/layout.mjs` (add `.webp: "image/webp"` to `TYPES`; `newPage` routes `**/signatures` GET to a `signatures` option, default `[]`)

**Interfaces:**
- Consumes: Task 1 image paths; Task 2 HTTP API; `window.FUNCTIONS_URL` from `site/config.js`.
- Produces: `yearbook.html` and `yearbook.html#sign` (opens on the signing form). DOM ids used by tests and Task 4: `#book`, `#prev`, `#next`, `#page-indicator`, `#sign-jump`, `#sign-form`, `#sign-name`, `#sign-message`, `#sign-submit`, `#sign-status`, `#signature-list`.

- [ ] **Step 1: Write failing layout tests** (in `tests/layout.mjs`):
  - `"yearbook has no horizontal overflow"` at each of `VIEWPORTS`; no page errors.
  - `"yearbook opens on front cover and next turns page"` — `#page-indicator` text changes after clicking `#next`; `img[src$="front.webp"]` visible at start.
  - `"sign link opens on signing form"` at 390×844 and 1280×800 — goto `yearbook.html#sign`; `#sign-name` visible.
  - `"sign-jump button goes to signing form"` — click `#sign-jump`; `#sign-name` visible.
  - `"signature list renders newest first"` — signatures `[{name:"B",message:"two",…},{name:"A",message:"",…}]`; `#signature-list` text order B before A.
  - `"signing posts and shows new signature"` — route POST → 201 `{signature:{name:"Jane",message:"hi",created_at:…}}`; fill and submit; posted body equals `{name:"Jane",message:"hi"}`; `#signature-list` first item contains "Jane"; form fields cleared.
  - `"blank name is stopped before any request"` (yearbook) — no POST sent; `#sign-status` visible.
  - `"429 shows try-later message and re-enables button"`.
  - Review Focus: `"typing in sign form does not flip"` (type `"hello world"` + press ArrowLeft/ArrowRight inside `#sign-message`; `#page-indicator` unchanged, `#sign-name` still visible); `"long signature wraps"` (message = 280 × `"a"`; `#signature-list` `scrollWidth <= clientWidth`, no page overflow at 360×640); `"signature text is literal"` (name `<b>x</b>` shows literal text, no `b` element in list); `"sign button disabled while sending"` (delayed POST route; `#sign-submit` disabled; double click → 1 request); `"signature load failure keeps book usable"` (GET 500 → list shows "Couldn't load signatures"; `#next` still turns page; POST still works).
- [ ] **Step 2:** Run `node tests/layout.mjs` (Playwright libs per memory note: LD_LIBRARY_PATH from scratchpad) — new tests FAIL.
- [ ] **Step 3: Build `yearbook.html`** — same head conventions as `index.html` (noindex, favicon, Geist, `styles.css`), title "Yearbook · DeBakey Class of 2016". Header with back link to `/`, `#book` container, controls row (`#prev`, `#page-indicator`, `#next`, `#sign-jump`). Scripts: `config.js`, `vendor/page-flip.browser.js`, `yearbook.js`.
- [ ] **Step 4: Build `yearbook.js`** — creates 122 `.page` divs (front cover `data-density="hard"`, 001–118 with `<img data-src>`, sign form page, signature list page, back cover hard); `new St.PageFlip(book, { width: 550, height: 733, size: "stretch", minWidth: 280, maxWidth: 1000, minHeight: 373, maxHeight: 1333, showCover: true, mobileScrollSupport: false })` then `loadFromHTML`. Image loading: on init and every `flip` event, set `src` from `data-src` for pages current−2…current+4. Indicator: "Cover", "Page N of 118", "Sign", "Back cover". `#sign-jump` and `#sign` hash → `turnToPage(index of form page)` (in portrait mode lands on form page). Keyboard ←/→ flip only when `document.activeElement` is not an input/textarea. Sign form: stop `mousedown`/`touchstart`/`pointerdown` propagation on the form page so the widget doesn't start a drag; validate trimmed name 1–60 / message ≤280 client-side (`maxlength` attrs too); disable submit while pending; on 201 prepend item, clear fields, status "Thanks for signing!"; 429 → "You've signed a lot — try again later."; other failures → "Couldn't save. Try again." and re-enable. Signatures list built with `textContent`, `white-space: pre-line`, `overflow-wrap: anywhere`, scrolls within page (`overflow-y: auto`). Fetch list on load; failure → "Couldn't load signatures."
- [ ] **Step 5:** Styles in `styles.css` — book centered, max width fits viewport with 16px gutters, controls wrap on small phones, signing pages look like paper (off-white, handwriting font for signatures).
- [ ] **Step 6:** Run `node tests/layout.mjs` — all PASS (old + new). Screenshot 390×844 and 1280×800 at cover, mid-book, sign spread; look at them.
- [ ] **Step 7: Commit** — `feat: add flip-through yearbook page with signing`.

### Task 4: Home page entry

**Files:**
- Modify: `site/index.html` (replace hidden placeholder `#yearbook` section contents; remove `hidden`)
- Modify: `site/styles.css` (drop unused `.spread*` rules, add section styles)
- Modify: `tests/layout.mjs` (replace `"yearbook section is hidden until content exists"`)

**Interfaces:**
- Consumes: `yearbook.html`, `yearbook.html#sign`, `yearbook/pages/front.webp`.

- [ ] **Step 1: Failing test** `"yearbook section links to the book and signing"` — `#yearbook` visible; contains `a[href="yearbook.html"]` text "Open the yearbook" and `a[href="yearbook.html#sign"]` text "Sign the yearbook"; cover `img` has non-empty alt. Existing overflow tests still cover the section.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Section: eyebrow "From the yearbook", h2 "Flip through 2016", front cover thumbnail (`loading="lazy"`, width/height attrs), two buttons (`.button` and `.button` secondary style). Delete placeholder comment slots.
- [ ] **Step 4:** Run `node tests/layout.mjs` — all PASS.
- [ ] **Step 5: Commit** — `feat: link yearbook from home page`.

### Task 5: Local run with owner (gate before master)

- [ ] **Step 1:** Ask owner OK to apply migration and deploy only the `signatures` function to prod Supabase (no public site change; nothing links to it until `master` push). On OK: `npx supabase db push --remote`, `npx supabase functions deploy signatures --use-api --yes`. Smoke: `curl {FUNCTIONS_URL}/signatures` → `{"signatures":[]}`.
- [ ] **Step 2:** `cd site && npx serve@14 -l 8000`; owner opens `http://localhost:8000` (CORS already allows localhost) and `http://localhost:8000/yearbook`, flips pages on desktop and phone (same Wi-Fi via PC IP won't pass CORS — phone check uses browser devtools device mode, or owner tests phone after push).
- [ ] **Step 3:** Owner signs a test entry, then deletes it in Supabase Table Editor → `signatures` to confirm the delete flow.
- [ ] **Step 4:** Owner approves → fast-forward `master` from `reunion-site` and push (with OK). Not before.
