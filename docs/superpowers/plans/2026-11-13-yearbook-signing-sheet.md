# Yearbook Signing Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the form-based signing spread with one huge zoomable sheet where people tap a spot, type a message in place, pick its size and post it.

**Architecture:** Revision migration reshapes `signatures` to `{message, x, y, size}`; the edge function validates the new shape. In `yearbook.js`, the two signing pages in the book show mini copies of the sheet; a full-screen signer overlay holds the real 6000×4000-unit sheet inside vendored Panzoom for pinch/wheel zoom and pan, with tap-to-write.

**Tech Stack:** As before (vanilla JS, StPageFlip, Supabase, PGlite + deno test, Playwright) plus `@panzoom/panzoom@4.5.1` (`dist/panzoom.min.js`, vendored).

**Spec:** `docs/superpowers/specs/2026-11-13-digital-yearbook-design.md` (section "Signing sheet (revised)" and "Backend")

## Global Constraints

- Sheet = 6000 × 4000 units. Signature at `left = x*6000`, `top = y*4000` (top-left of text), `font-size = size` units, max width 600 units, `white-space: pre-wrap`, `overflow-wrap: anywhere`, Caveat font, text via `textContent` only.
- Sizes exactly `[16, 24, 36, 54, 80]`, default 24.
- Message only — no name field anywhere. Trimmed, 1–280 chars. x, y finite numbers in [0, 1].
- Rate limit unchanged: 5 per IP hash per rolling hour → 429 `"Too many signatures. Try again later."`.
- Prod already has the first signatures migration applied; never edit `20261113000000_signatures.sql` — add a new migration.
- No public deploy (master push, db push, functions deploy) without owner OK. Owner runs locally before master.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A drag/pan or pinch on the sheet must not open the write box (only a tap/click without movement). → Task 2 test "dragging the sheet does not open the write box".
2. Writing near the right/bottom edge keeps the message on the sheet (box start clamped so a 600-unit-wide box fits; y clamped ≤ 0.97). → Task 2 test "tap near edge keeps box on sheet".
3. Typing in the write box (arrows, space, Enter for new lines) never turns book pages or closes anything. → Task 2 test "typing in write box does not flip".
4. Phone keyboard opening (viewport shrink) must not lose the write box text. → Task 2 test "write box survives resize".
5. Signatures load failure: signer still opens and posting still works. → Task 2 test "signature load failure keeps signer usable".

---

### Task 1: Backend reshape

**Files:**
- Create: `supabase/migrations/20261113010000_signatures_sheet.sql`
- Modify: `supabase/functions/_shared/store.ts`, `supabase/functions/signatures/handler.ts`
- Test: `supabase/tests/signatures_test.ts` (rewrite for new shape)

**Interfaces:**
- Produces HTTP: `GET` → `200 {signatures: Signature[]}` newest first, `no-store`. `POST {message, x, y, size}` → `201 {signature}` / `400 {error}` / `429` / `500`.
- `type Signature = { message: string; x: number; y: number; size: number; created_at: string }`
- Store: `listSignatures(): Promise<Signature[]>`, `addSignature(input: { message: string; x: number; y: number; size: number }, ipHash: string): Promise<Signature | null>`.

- [ ] **Step 1: Rewrite tests** (keep helpers `post(body, ip)`):
  - `"lists signatures newest first with only public fields"` — keys exactly `["created_at","message","size","x","y"]`; order newest first; no `ip` in body text.
  - `"adds a trimmed signature with position and size"` — POST `{message:"  HAGS – Jane  ", x:0.25, y:0.5, size:36}` → 201, `{message:"HAGS – Jane", x:0.25, y:0.5, size:36}`.
  - `"rejects bad input"` — each 400, table empty after: `{}`; message `""`, `"   "`, `"x".repeat(281)`, `5`; x `-0.01`, `1.01`, `"0.5"`, `null`, missing; y same bad set; size `20`, `"24"`, missing; non-JSON. Then edge-valid `{message:"x".repeat(280), x:0, y:1, size:80}` → 201 and `{…, x:1, y:0, size:16}` → 201.
  - `"name field is ignored"` — POST with extra `name:"Bob"` → 201, response has no `name` key.
  - Keep `"rate limits after five per hour per ip"`, `"stores a hash, not the ip"`, `"OPTIONS 204, other methods 405"` (updated bodies).
- [ ] **Step 2:** `~/.deno/bin/deno test -A supabase/tests/signatures_test.ts` — FAIL.
- [ ] **Step 3: Migration** — `delete from signatures;` drop `name`; drop old message check and default, add `check (char_length(message) between 1 and 280)`; add `x double precision not null check (x between 0 and 1)`, `y` same, `size smallint not null check (size in (16, 24, 36, 54, 80))`. `drop function add_signature(text, text, text)`; `create or replace function list_signatures()` returning `{message, x, y, size, created_at}` newest first; `create function add_signature(p_message text, p_x double precision, p_y double precision, p_size int, p_ip_hash text) returns jsonb` (same 5/hour null rule). Same revoke/grant pattern for both.
- [ ] **Step 4:** Update store + handler. Handler: `typeof message === "string"`, trimmed length 1–280; `Number.isFinite(x) && 0 <= x <= 1` (same y; reject non-number types); `SIZES.includes(size)` with `SIZES = [16, 24, 36, 54, 80]`.
- [ ] **Step 5:** `~/.deno/bin/deno task test` — all PASS.
- [ ] **Step 6: Commit** — `feat: store yearbook signatures as positioned messages`.

### Task 2: Signing sheet UI

**Files:**
- Create: `site/vendor/panzoom.min.js` (from `https://cdn.jsdelivr.net/npm/@panzoom/panzoom@4.5.1/dist/panzoom.min.js`, unmodified)
- Modify: `site/yearbook.html` (replace form/list pages; add signer overlay; add panzoom script before `yearbook.js`)
- Modify: `site/yearbook.js` (drop form code; add sheet + signer)
- Modify: `site/styles.css` (drop `.yb-sign-form*`, `.yb-signature*`; add sheet/signer styles)
- Test: `tests/layout.mjs` (replace the yearbook signing tests; keep book/overflow/home tests)

**Interfaces:**
- Consumes: Task 1 HTTP API.
- DOM: book pages `#sign-left`, `#sign-right` each containing a `.sheet-mini` (scaled copy; left shows x 0–0.5, right 0.5–1). Overlay `#signer` (hidden until open) with `#signer-close` ("Back to book"), `#signer-viewport`, `#sheet` (6000×4000), `#write-here`, `#signer-status` (role=status), and while writing: `#write-box` (textarea, maxlength 280, placed on `#sheet`), `#size-down`, `#size-up`, `#write-cancel`, `#write-post`. Each posted message = `.signature` element with inline `left/top/font-size` in px.
- `#sign-jump`, `#sign` hash, and clicking `#sign-left`/`#sign-right` all open the signer (book turns to the signing spread underneath).

- [ ] **Step 1: Replace yearbook signing tests** in `tests/layout.mjs` (mock signatures shape `{message, x, y, size, created_at}`; helper `SIG(message, x=0.5, y=0.5, size=24)`):
  - `"#sign opens the signer"` at 390×844 and 1280×800 — `#signer` visible, `#sheet` visible; no page overflow.
  - `"sign-jump opens the signer"`; `"clicking a signing page opens the signer"` (turn book to signing spread, click `#sign-right`); `"back to book closes the signer"`.
  - `"signatures render at their positions"` — `SIG("A", 0.5, 0.25, 36)` → `#sheet .signature` has style left `3000px`, top `1000px`, font-size `36px`, text "A"; `.sheet-mini` in `#sign-right` contains "A".
  - `"tap opens write box zoomed in at that spot"` — click `#sheet` at viewport centre; `#write-box` visible + focused; `#sheet` transform scale ≥ 0.95.
  - `"posting sends message, position and size"` — tap, type `"HAGS – Jane"`, click `#size-up` once; POST body `message === "HAGS – Jane"`, `size === 36`, `0 <= x,y <= 1`; a `.signature` containing the text exists; `#write-box` gone; no request has a `name` key.
  - `"blank message is stopped before any request"`; `"429 shows try-later message and keeps text"` (`#signer-status` matches /later/i, `#write-box` value kept); `"post button disabled while sending"` (gate route, dblclick → 1 request).
  - `"size buttons clamp at smallest and largest"` — 5× `#size-up` → box font-size `80px`, `#size-up` disabled; 5× `#size-down` → `16px`.
  - `"write-here places box in view"` — click `#write-here`; `#write-box` visible + focused.
  - `"signature text is literal"`; `"long unbroken message wraps at 600 units"` (`.signature` offsetWidth ≤ 600).
  - Review Focus: `"dragging the sheet does not open the write box"` (mouse down on sheet, move 80px in steps, up → `#write-box` count 0); `"tap near edge keeps box on sheet"` (tap at bottom-right corner of fitted sheet → posted x ≤ 0.9, y ≤ 0.97); `"typing in write box does not flip"` (type with Enter + ArrowLeft/Right; book indicator unchanged; signer still open); `"write box survives resize"` (type text, `page.setViewportSize({width:390,height:400})`, value kept and box visible); `"signature load failure keeps signer usable"` (GET 500 → `#signer-status` says "Couldn't load signatures", tap + post still works).
- [ ] **Step 2:** Run `node tests/layout.mjs` with LD_LIBRARY_PATH — new tests FAIL.
- [ ] **Step 3: Markup** — replace `#sign-page` and `#signatures-page` with `<div class="page page-paper" id="sign-left"><div class="sheet-mini"></div></div>` and `#sign-right` likewise (keep both before back cover; page count/indices unchanged: SIGN = 119). Overlay after `</main>`: `<div id="signer" class="signer" hidden>` with top bar (Back to book, hint "Tap anywhere to write. Pinch or scroll to zoom.", `#write-here`), `#signer-viewport` > `#sheet`, `#signer-status`.
- [ ] **Step 4: JS** — `renderSignature(sig) -> HTMLElement` (shared by sheet and minis; minis are 6000×4000 clones scaled with CSS transform to page size, right one translated −3000 units). `openSigner()` / `closeSigner()`; Panzoom on `#sheet` with `{ maxScale: 2, minScale: fitScale, contain: "outside", canvas: true }` and wheel zoom on viewport; fit to screen on open and on resize when not writing. Tap detection: pointerdown→pointerup within 6px and 300ms on `#sheet` (not on `.signature`/write UI) → `startWriting(sheetX, sheetY)`: clamp x to `[0, 6000-600]`, y to `[0, 4000*0.97]`, zoom to scale 1 centred there, create `#write-box` at that spot, show toolbar, focus. `post()`: validate trimmed non-empty, disable `#write-post`, POST `{message, x: left/6000, y: top/4000, size}`; on 201 replace box with `renderSignature(signature)` (also into both minis), zoom back to fit; 429 → status "You've signed a lot. Try again later." keep text; other → "Couldn't save. Try again." keep text. Book arrow-key handler ignores keys while `#signer` is open. Remove old form/list code.
- [ ] **Step 5: CSS** — overlay fixed inset 0, sky background, top bar + toolbar wrap on phones; `#sheet` paper colour with faint vertical fold at 3000 units; `.signature` per Global Constraints; write box transparent with dashed outline, same font as `.signature`; `.sheet-mini` positioned absolute at top-left, `transform-origin: 0 0`.
- [ ] **Step 6:** Run `node tests/layout.mjs` — all PASS. Screenshots of signer fitted, writing, and book signing spread at 390 and 1280; look at them.
- [ ] **Step 7: Commit** — `feat: sign the yearbook on a zoomable sheet`.

### Task 3: Deploy backend + local run (owner gate)

- [ ] **Step 1:** `npx supabase db push --remote --dry-run` → only `20261113010000_signatures_sheet.sql` pending. Then (owner already OK'd function/migration deploys for this feature) `npx supabase db push --remote --yes` and `npx supabase functions deploy signatures --use-api --yes`. Smoke: `curl …/signatures` → `{"signatures":[]}`.
- [ ] **Step 2:** Local server already on :8000 (restart if not). Owner tries signer on desktop + device mode, posts a test message, checks `ip_hash` ≠ prefix `b23a6a8439c0`, deletes row.
- [ ] **Step 3:** Owner approves → push `master` (with OK).
