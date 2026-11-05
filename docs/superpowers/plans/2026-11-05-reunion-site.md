# DeBakey Reunion Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and launch the Class of 2016 ten-year reunion site, with $20 Stripe tickets, emailed QR codes, door check-in, and an opt-in guest list.

**Architecture:** A static site on GitHub Pages calls Supabase edge functions. Stripe-hosted Checkout takes payment; a signed webhook writes orders and tickets through atomic Postgres functions and then emails QR codes through Resend. Handler logic takes injected dependencies, so tests run it against real SQL in PGlite without Docker or network access.

**Tech Stack:** HTML/CSS/vanilla JS, Deno edge functions, Postgres (Supabase), `npm:stripe@17`, `npm:@supabase/supabase-js@2`, `npm:qrcode@1`, `npm:@electric-sql/pglite`, Resend REST API, vendored `html5-qrcode@2.3.8`, Playwright (layout checks only).

**Spec:** `docs/superpowers/specs/2026-11-05-reunion-site-design.md`

## Global Constraints

- Event copy: "Saturday, November 28, 2026", "7–10 PM", "Bad Astronaut", "Houston, TX". Time and venue address are open items, so keep them easy to change.
- Contact: Mourad Berrached, 832-860-7467, `tel:+18328607467`.
- Prices: 1 ticket `$20` (`amount_total` 2000), +1 `$40` (4000). One guest maximum.
- Sales close at `2026-11-29T04:00:00Z` (10 PM Central, CST).
- Production origin: `https://debakey2016reunion.com`.
- Sender: `tickets@debakey2016reunion.com`.
- Look: Yearbook Cover, per `.superpowers/brainstorm/2889-1793912404/content/visual-direction.html` option A. Navy `#12266b`, white, pale blue `#c9d4ff`, Libre Baskerville.
- Secrets only in Supabase: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `RESEND_API_KEY`, `DOOR_PASSWORD`, `REPLY_TO_EMAIL`, `SITE_URL`. Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- No framework or build step for the site. No new dependency beyond this list without need.
- Work on branch `reunion-site`, never on `master`.
- Mark deliberate shortcuts with a `ponytail:` comment.

## Review Focus

1. **Buyer mistypes email.** Organizer corrects `orders.email`, clears `email_sent_at`, and resends the Stripe event; tickets go to the corrected address and no new tickets appear. Test in Task 3.
2. **Names with HTML, quotes, emoji, or surrounding whitespace.** They show literally everywhere and never execute. Tests in Tasks 2, 3, and 6.
3. **Stripe sends events out of order or twice.** A refund arriving before its order gets a 500 so Stripe retries; duplicates create nothing. Test in Task 3.
4. **Door gets a repeat scan, simultaneous scans, or a non-ticket QR code.** Exactly one admit; others show "Already checked in" or "Not found", with no crash. Tests in Tasks 1 and 5.
5. **Backend down, or an in-app browser from the group chat.** Checkout failure shows a clear message with Mourad's number, the button becomes usable again, and a failed guest list hides its section. Test in Task 6.

---

## File Map

```
.github/workflows/{pages.yml,keep-awake.yml}
deno.json
docs/{stripe-setup.md,launch-runbook.md}
site/{index.html,styles.css,app.js,config.js,thanks.html,ticket.html,door.html,door.js,CNAME}
site/assets/{seal.png,og.png,favicon.png}
site/vendor/html5-qrcode.min.js
supabase/config.toml
supabase/migrations/20261105000000_init.sql
supabase/functions/_shared/{rules.ts,store.ts,http.ts,tickets.ts}
supabase/functions/{create-checkout,stripe-webhook}/{index.ts,handler.ts}
supabase/functions/{guest-list,ticket,door}/index.ts
supabase/tests/{helpers.ts,db_test.ts,checkout_test.ts,webhook_test.ts,public_test.ts,door_test.ts}
tests/layout.mjs
```

For `create-checkout` and `stripe-webhook`, `index.ts` wires env and real clients to `handler.ts`, which holds the testable logic. The three smaller functions keep exported handlers and wiring together in `index.ts`. Every `index.ts` starts serving only under `if (import.meta.main)`, so tests can import it.

---

### Task 1: Database and atomic operations

**Files:**
- Create: `deno.json`, `.gitignore` (already has `.superpowers/`; keep it), `supabase/config.toml`, `supabase/migrations/20261105000000_init.sql`
- Test: `supabase/tests/helpers.ts`, `supabase/tests/db_test.ts`

**Interfaces:**
- Produces SQL functions, all `security definer` with `set search_path = public`, execute revoked from `public, anon, authenticated` and granted to `service_role`. Each returns `jsonb`:
  - `record_paid_order(p_session_id text, p_payment_intent text, p_buyer_name text, p_email text, p_guest_name text, p_with_guest boolean, p_show_on_list boolean, p_amount_total int, p_classmate_token text, p_guest_token text)` returns `{ id, email, status, email_sent_at, buyer_name, tickets: [{ token, holder_name, kind }] }`
  - `mark_order_emailed(p_order_id uuid)` returns `true`
  - `mark_order_refunded(p_payment_intent text)` returns `true`, or `false` if no such order
  - `public_guest_list()` returns `[{ name, plus_one }]`, oldest first
  - `get_ticket(p_token text)` returns `{ holder_name, buyer_name, kind, voided }` or `null`
  - `check_in_ticket(p_token text)` returns `{ result: 'ok'|'already'|'voided'|'not_found', holder_name?, buyer_name?, kind?, checked_in_at? }`
  - `search_tickets(p_query text)` returns up to 25 `[{ token, holder_name, buyer_name, kind, voided, checked_in_at }]`
  - `door_auth_allowed(p_ip text)` returns `true` if fewer than 20 failures in 15 minutes; `door_auth_failed(p_ip text)` records one and returns `true`
- Produces `newDb(): Promise<{ rpc(fn: string, args?: Record<string, unknown>): Promise<unknown>, db: PGlite }>` in `helpers.ts`. It creates roles `anon`, `authenticated`, `service_role`, applies the migration, and calls functions with named arguments.

- [ ] **Step 1: Set up branch and tools**

Run: `git switch -c reunion-site && git add docs .gitignore && git commit -m "docs: add reunion site design and plan"`
Then install Deno if `deno --version` fails (`curl -fsSL https://deno.land/install.sh | sh`).
Expected: on `reunion-site`, `deno --version` prints 2.x. Create `deno.json` with a `test` task, `deno test -A supabase/tests/`, and import aliases for the npm packages above. Set `verify_jwt = false` for all five functions in `config.toml`.

- [ ] **Step 2: Write the failing tests in `db_test.ts`**

```ts
Deno.test("same session twice creates one order and its tickets");
// second call returns same id; tickets count unchanged, tokens are the first call's
Deno.test("with guest creates classmate and guest tickets");
// kinds ["classmate","guest"]; guest holder_name null when no name given
Deno.test("guest list has only paid opted-in buyers, never guest names");
// opted-out hidden; refunded hidden; result deepEquals [{name:"Jane Doe",plus_one:true}]
Deno.test("refund voids tickets and missing payment intent returns false");
Deno.test("voided ticket cannot check in"); // result === "voided"
Deno.test("parallel check-ins admit exactly once");
// await Promise.all of two check_in_ticket calls: results sorted ["already","ok"]
Deno.test("unknown token returns not_found");
Deno.test("search matches holder and buyer, treats % and _ literally, ignores under 2 chars");
Deno.test("anon cannot read tables or execute functions");
// SET ROLE anon; select from orders rejects; select record_paid_order(...) rejects
Deno.test("door auth blocks after 20 failures");
```

Write each body with these exact assertions.

- [ ] **Step 3: Run tests to confirm failure**

Run: `deno task test`
Expected: FAIL, migration file missing.

- [ ] **Step 4: Implement migration**

Tables per the spec, plus `orders.stripe_payment_intent text` and `door_failures(ip text, at timestamptz default now())`. Use `check (kind in ('classmate','guest'))`, `check (status in ('paid','refunded'))`, RLS enabled on all three tables, and no policies. Revoke all table privileges from `anon, authenticated`.

`record_paid_order` must do `insert ... on conflict (stripe_session_id) do nothing returning id`, insert tickets only when a row was inserted, then always select and return the stored order. `check_in_ticket` must use a single `update ... where token = $1 and checked_in_at is null and voided_at is null returning ...`, and only inspect the row to choose a failure reason when the update hits nothing. `search_tickets` must escape `\`, `%`, `_` before `ilike`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno task test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add deno.json deno.lock supabase
git commit -m "feat: add ticket database and atomic operations"
```

---

### Task 2: Create checkout

**Files:**
- Create: `supabase/functions/_shared/rules.ts`, `supabase/functions/_shared/http.ts`, `supabase/functions/create-checkout/handler.ts`, `supabase/functions/create-checkout/index.ts`
- Test: `supabase/tests/checkout_test.ts`

**Interfaces:**
- Produces in `rules.ts`:
  - `SALES_CLOSE = new Date("2026-11-29T04:00:00Z")`
  - `parseOrderForm(body: unknown): { ok: true, value: OrderForm } | { ok: false, error: string }`
  - `type OrderForm = { name: string, guestName: string, withGuest: boolean, showOnList: boolean }`
- Produces in `http.ts`: `corsHeaders(origin: string | null, siteUrl: string): Record<string,string>`, `json(data: unknown, status: number, headers?: Record<string,string>): Response`
- Produces in the handler: `handleCheckout(req: Request, deps: { now(): Date, siteUrl: string, createSession(params: CheckoutParams): Promise<{ url: string }> }): Promise<Response>`, with `type CheckoutParams = { quantity: 1 | 2, successUrl: string, cancelUrl: string, metadata: { name: string, guest_name: string, with_guest: "true"|"false", show_on_list: "true"|"false" } }`
- Response: `200 { url }`, `400 { error }`, `410 { error: "Ticket sales have closed." }`, `502 { error }` when Stripe fails.

- [ ] **Step 1: Write the failing tests**

```ts
Deno.test("trims name and requires it"); // "  Jane  " -> "Jane"; "   " -> 400
Deno.test("rejects names over 80 chars and non-object body");
Deno.test("keeps HTML and emoji in names unchanged"); // `<b>Jos&é 🎉"` stays exact; escaping is output's job
Deno.test("guest name dropped unless withGuest");
Deno.test("quantity from withGuest, never from client"); // body {quantity:99, with_guest:false} -> quantity 1
Deno.test("closed exactly at SALES_CLOSE"); // now = close - 1ms -> 200; now = close -> 410
Deno.test("Stripe failure returns 502 without leaking the error text");
Deno.test("CORS allows production and localhost, not other origins");
Deno.test("OPTIONS returns 204 with CORS headers; GET returns 405");
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test -A supabase/tests/checkout_test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `rules.ts`, `http.ts`, handler, and `index.ts`**

Request body fields are `name`, `guest_name`, `with_guest`, `show_on_list`. `index.ts` builds a Stripe client with `Stripe.createFetchHttpClient()`, using `mode: "payment"`, `line_items: [{ price: STRIPE_PRICE_ID, quantity }]`, success URL `${SITE_URL}/thanks`, and cancel URL `${SITE_URL}/#tickets`.

- [ ] **Step 4: Run to verify pass**

Run: `deno test -A supabase/tests/checkout_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "feat: add checkout session function"
```

---

### Task 3: Webhook and ticket email

**Files:**
- Create: `supabase/functions/_shared/store.ts`, `supabase/functions/_shared/tickets.ts`, `supabase/functions/stripe-webhook/handler.ts`, `supabase/functions/stripe-webhook/index.ts`
- Test: `supabase/tests/webhook_test.ts`

**Interfaces:**
- Consumes: SQL functions from Task 1; `newDb` from helpers.
- Produces in `store.ts`: `createStore(rpc): Store`, where `rpc(fn, args)` is a supabase-js wrapper in production and PGlite in tests. `Store` has one typed method per SQL function.
- Produces in `tickets.ts`:
  - `newToken(): string` (32 hex chars from `crypto.getRandomValues`)
  - `ticketUrl(siteUrl: string, token: string): string` (`${siteUrl}/ticket?t=${token}`)
  - `qrPngBase64(text: string): Promise<string>` (shared with Task 4)
  - `escapeHtml(s: string): string`
  - `ticketLabel(t: { holder_name: string|null, kind: string, buyer_name: string }): string` (holder name, else `Guest of <buyer>`)
  - `buildTicketEmail(order, siteUrl): Promise<{ subject: string, html: string, attachments: { filename: string, content: string, content_id: string }[] }>`
- Produces in the handler: `handleStripeEvent(event: { type: string, data: { object: any } }, deps: { store: Store, siteUrl: string, sendEmail(to: string, email: TicketEmail): Promise<void> }): Promise<Response>`

- [ ] **Step 1: Write the failing tests against PGlite and a fake `sendEmail`**

```ts
Deno.test("paid session creates order, tickets, and sends one email");
Deno.test("unpaid session creates nothing and returns 200");
Deno.test("duplicate event sends no second email and keeps same tokens");
Deno.test("email failure returns 500, retry sends without duplicate tickets");
// first sendEmail throws -> 500, email_sent_at null; retry -> 200, 1 order, 2 tickets
Deno.test("after correcting email and clearing email_sent_at, retry goes to new address");
// fake sendEmail receives "fixed@example.com" and same tokens
Deno.test("email uses one QR per ticket and escapes names");
// `<b>A&B</b>` appears as `&lt;b&gt;A&amp;B&lt;/b&gt;`; 2 attachments; html has `cid:` for each and ticket URLs
Deno.test("unnamed guest ticket labeled Guest of buyer");
Deno.test("full refund voids tickets; partial refund changes nothing");
// charge.refunded true vs false, amount_refunded partial
Deno.test("refund before order returns 500 so Stripe retries");
Deno.test("refunded order retry sends no email");
Deno.test("unknown event type returns 200");
```

Add a separate signature test against `index.ts`'s exported `verifyEvent(rawBody, signature, secret)`: a valid header from `stripe.webhooks.generateTestHeaderString` passes; a tampered body rejects.

- [ ] **Step 2: Run to verify failure**

Run: `deno test -A supabase/tests/webhook_test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement store, tickets, handler, and `index.ts`**

Order of work in `checkout.session.completed` when `payment_status === "paid"`: read `customer_details.email`, generate tokens, call `recordPaidOrder`, return 200 if status is `refunded` or `email_sent_at` is set, otherwise send to the **returned row's** `email`, then mark emailed. Add `// ponytail: parallel duplicate delivery can send a harmless second email; tokens are identical`.

`index.ts` must read the raw body with `req.text()` and verify with `constructEventAsync` and `Stripe.createSubtleCryptoProvider()`; a bad signature returns 400. Send email with `fetch("https://api.resend.com/emails")`, using `from: "DeBakey Reunion <tickets@debakey2016reunion.com>"` and `reply_to: REPLY_TO_EMAIL`. Treat non-2xx as a thrown error. Check Resend's current docs for the inline attachment field name when writing this call.

- [ ] **Step 4: Run to verify pass**

Run: `deno test -A supabase/tests/webhook_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "feat: add Stripe webhook and QR ticket email"
```

---

### Task 4: Guest list and ticket lookup

**Files:**
- Create: `supabase/functions/guest-list/index.ts`, `supabase/functions/ticket/index.ts`
- Test: `supabase/tests/public_test.ts`

**Interfaces:**
- Consumes: `Store`, `corsHeaders`, `json`, `qrPngBase64`, `ticketUrl`, `ticketLabel`.
- Produces: exported `handleGuestList(req, { store, siteUrl })` responding `200 { guests: [{ name, plus_one }] }` with `cache-control: public, max-age=60`. Exported `handleTicket(req, { store, siteUrl })` for `GET ?t=<token>`, responding `200 { label, kind, voided, qr_png_base64 }`, or `404 { error: "Ticket not found." }`.

- [ ] **Step 1: Write the failing tests**

```ts
Deno.test("guest list exposes only name and plus_one"); // Object.keys exactly those two; no email anywhere in JSON
Deno.test("ticket response contains label and QR, no email or buyer details beyond label");
Deno.test("unknown or missing token returns 404");
Deno.test("refunded ticket returns voided true");
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test -A supabase/tests/public_test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement both handlers and server wiring**

- [ ] **Step 4: Run to verify pass**

Run: `deno test -A supabase/tests/public_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "feat: add guest list and ticket lookup functions"
```

---

### Task 5: Door function

**Files:**
- Create: `supabase/functions/door/index.ts`
- Test: `supabase/tests/door_test.ts`

**Interfaces:**
- Consumes: `Store`, `corsHeaders`, `json`, `ticketLabel`.
- Produces: exported `extractToken(scanned: string): string` and `handleDoor(req, { store, siteUrl, doorPassword })`. POST body `{ password, action: "login" | "scan" | "search", scanned?, query? }`, where manual check-in sends a `token` value as `scanned`. Responses: `200 { ok: true }`; `200 { result, label?, kind?, checked_in_at? }`; `200 { matches: [...] }`; `401 { error: "Wrong password." }`; `429 { error: "Too many attempts. Wait 15 minutes." }`.

- [ ] **Step 1: Write the failing tests**

```ts
Deno.test("wrong password returns 401 and records failure");
Deno.test("after 20 failures even correct password returns 429");
Deno.test("extractToken takes t from ticket URL or raw token");
Deno.test("garbage, non-ticket URL, and empty scans give not_found without throwing");
Deno.test("first scan ok with label; second scan already with time");
Deno.test("refunded ticket gives voided");
Deno.test("search returns label, token, and checked-in state, requiring password");
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test -A supabase/tests/door_test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement handler**

Compare the password by SHA-256 hashing both sides and doing a constant-time byte comparison. Client IP is the first value of `x-forwarded-for`, falling back to `"unknown"`. Check `doorAuthAllowed` before the password.

- [ ] **Step 4: Run all backend tests**

Run: `deno task test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "feat: add door check-in function"
```

---

### Task 6: Main page

**Files:**
- Create: `site/index.html`, `site/styles.css`, `site/app.js`, `site/config.js`, `site/assets/seal.png`, `site/assets/og.png`, `site/assets/favicon.png`, `site/CNAME`
- Test: `tests/layout.mjs`

**Interfaces:**
- Consumes: `POST {FUNCTIONS_URL}/create-checkout`, `GET {FUNCTIONS_URL}/guest-list`.
- Produces: `site/config.js` sets `window.FUNCTIONS_URL`, used by all pages. `site/styles.css` provides the Yearbook base styles reused by Task 7 pages.

- [ ] **Step 1: Generate image assets**

Run a one-off command in the scratchpad using `npx sharp-cli` or `sharp`, with the source PNG at `/tmp/claude-1000/-home-charl-debakey-2016-reunion/f5e72658-8d6a-4b23-971a-ee4b4b3e7982/images/1.png`: crop the 690×690 square at left 600, top 165; apply a circular alpha mask; export `seal.png` at 512px and `favicon.png` at 64px. Compose `og.png` at 1200×630 with the seal on navy `#12266b`. Do not commit the script.
Expected: Read each image and confirm the circle is clean with no gray background at its edge.

- [ ] **Step 2: Write the failing test `tests/layout.mjs`**

A plain Node script using Playwright (`npx playwright@1 install chromium` if needed), serving `site/` on a local port and mocking functions with `page.route`. Assert with `node:assert`:

```js
// 360x640 and 390x844 and 1280x800:
assert(documentElement.scrollWidth <= innerWidth);
// 360x640: date, venue, Get Tickets, and contact line bottoms <= 640
// yearbook section not visible
// guest list mock [{name:'<img src=x onerror=window.__xss=1>',plus_one:true}]:
//   visible text contains the literal string + " +1"; window.__xss undefined
// guest-list mock 500: section hidden, no uncaught page errors
// submit "Me + guest": POST body has with_guest true, guest_name, show_on_list false by default
// checkout mock returns {url}: page navigates to that url
// checkout mock 500: error text contains "832-860-7467"; submit button enabled again
// after SALES_CLOSE (page.clock at 2026-11-29T04:00:00Z): form replaced with "Ticket sales have closed."
// <title>, og:title, og:description, og:image present; seal img has alt text
```

Also save screenshots at each viewport to the scratchpad directory.

- [ ] **Step 3: Run to verify failure**

Run: `node tests/layout.mjs`
Expected: FAIL, `site/index.html` not found.

- [ ] **Step 4: Implement page**

Follow Spec "Page" order and copy. Cover matches mockup A: double thin border, seal, kicker "Class of 2016 · Ten Years", heading "The Ten-Year Reunion". Render names only through `textContent`. Yearbook `<section id="yearbook" hidden>` holds commented, labeled slots for photo, quote, and memory, with a comment explaining to remove `hidden` once content is added. Disable the submit button during a request. Tickets radio labels are "Just me, $20" and "Me + guest, $40"; guest name field shows only for +1. Tap-to-call uses the Global Constraints `tel:` link. Questions says "Your ticket covers entry." Map link is a Google Maps search for `Bad Astronaut Houston TX`. Respect `prefers-reduced-motion`. `CNAME` contains `debakey2016reunion.com`.

- [ ] **Step 5: Run to verify pass**

Run: `node tests/layout.mjs`
Expected: PASS. Read the screenshots: the page should look like the chosen mockup and nothing should overlap or crowd.

- [ ] **Step 6: Commit**

```bash
git add site tests/layout.mjs
git commit -m "feat: add yearbook-style reunion page"
```

---

### Task 7: Thank-you, ticket, and door pages

**Files:**
- Create: `site/thanks.html`, `site/ticket.html`, `site/door.html`, `site/door.js`, `site/vendor/html5-qrcode.min.js`
- Modify: `tests/layout.mjs`

**Interfaces:**
- Consumes: `GET {FUNCTIONS_URL}/ticket?t=`, `POST {FUNCTIONS_URL}/door`, `site/styles.css`, `window.FUNCTIONS_URL`.
- Produces: pages at `/thanks`, `/ticket?t=`, `/door`. All three have `<meta name="robots" content="noindex">`; none is linked from `index.html`.

- [ ] **Step 1: Add failing checks to `tests/layout.mjs`, using mocks**

```js
// /thanks: text says tickets are on their way, mentions 15 minutes and 832-860-7467
// /ticket?t=x with mock: shows QR <img> and label via textContent; voided shows "no longer valid"
// /ticket?t=bad with 404 mock: shows "not found" and 832-860-7467
// /door: login form first; wrong password shows error
// /door with mocked ok scan: large green state with label
// mocked already: red with formatted time in America/Chicago, e.g. "Already checked in at 7:42 PM"
// mocked voided: red "Refunded or voided"; not_found: red "Not found"
// search result "Check in" button posts action scan with its token
// 360x640: no horizontal overflow on all three pages
```

- [ ] **Step 2: Run to verify failure**

Run: `node tests/layout.mjs`
Expected: FAIL, pages not found.

- [ ] **Step 3: Implement pages**

Vendor `html5-qrcode@2.3.8` from npm into `site/vendor/`. Keep the door password in `sessionStorage` wrapped in try/catch, falling back to an in-memory variable. After a scan, hold the result on screen and ignore the camera until staff tap "Next", so one code isn't scanned repeatedly. If the camera is denied, show name search with a clear note.

- [ ] **Step 4: Run to verify pass**

Run: `node tests/layout.mjs`
Expected: PASS. Read door screenshots for legibility.

- [ ] **Step 5: Commit**

```bash
git add site tests/layout.mjs
git commit -m "feat: add thank-you, ticket, and door pages"
```

---

### Task 8: Deployment workflows and guides

**Files:**
- Create: `.github/workflows/pages.yml`, `.github/workflows/keep-awake.yml`, `docs/stripe-setup.md`, `docs/launch-runbook.md`
- Modify: `README.md`

- [ ] **Step 1: Write workflows**

`pages.yml` deploys `site/` with `actions/upload-pages-artifact` and `actions/deploy-pages` on pushes to `master`. `keep-awake.yml` runs on a cron every 3 days plus `workflow_dispatch`, and curls the production `guest-list` URL with `--fail`.

- [ ] **Step 2: Write `docs/stripe-setup.md`**

For a first-time Stripe user. Cover everything in Spec "Deliverables": sign-up and verification, payout bank, public business name and statement descriptor `DEBAKEY REUNION`, branding with `site/assets/seal.png`, product "Class of 2016 Reunion Ticket" at $20 one-time, test mode first with test card `4242 4242 4242 4242`, API key and Price ID into Supabase secrets, webhook endpoint `https://<project-ref>.supabase.co/functions/v1/stripe-webhook` with events `checkout.session.completed` and `charge.refunded`, enabling customer receipts, refunds, and repeating setup in live mode. Warn at the top: start now, because verification and first payouts can take days. Check each dashboard step against Stripe's current docs.

- [ ] **Step 3: Write `docs/launch-runbook.md`**

Include exact commands and steps for:
- Supabase project, `supabase db push`, `supabase secrets set`, `supabase functions deploy`.
- Resend domain verification with Porkbun DNS records.
- GitHub Pages: public repo, Source "GitHub Actions", custom domain, Enforce HTTPS.
- Porkbun DNS: apex A records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; `www` CNAME to `charlesbneal2.github.io`.
- `site/config.js` production URL.
- Launch checklist: open items in the Spec, plus one live $20 purchase, scan, and refund.
- Event night: door URL, password sharing, CSV export SQL for the printed list.
- Fixes, with exact SQL: correct email and resend (Stripe dashboard event resend), void one ticket, remove name from list.

- [ ] **Step 4: Verify docs against code**

Run: `grep -E "stripe-webhook|STRIPE_PRICE_ID|DOOR_PASSWORD|REPLY_TO_EMAIL" docs/*.md`
Expected: names match Global Constraints and function directories. Validate workflow YAML by parsing it with `deno eval` and `npm:yaml`.

- [ ] **Step 5: Commit**

```bash
git add .github docs README.md
git commit -m "docs: add deployment workflows and setup guides"
```

---

### Task 9: Test-mode rehearsal and launch

Outward-facing steps. Needs the user's accounts, and each deploy, live key, push to `master`, and real charge needs the user's go-ahead at that moment.

- [ ] **Step 1: User completes account setup**

User follows `docs/stripe-setup.md` in test mode and creates Supabase and Resend accounts per `docs/launch-runbook.md`.
Expected: all secrets set with test Stripe keys; Resend domain verified.

- [ ] **Step 2: Deploy backend**

Run: `supabase db push && supabase functions deploy`
Expected: five functions listed by `supabase functions list`.

- [ ] **Step 3: Rehearse end to end against the deployed backend, with a local site**

Buy with `+1` using a test card, delivered to a real inbox. Confirm one email with 2 QR codes that render in Gmail and on iPhone Mail. Resend the event from Stripe and confirm no duplicates. Scan each QR at `/door` from a real phone over HTTPS, then rescan to see "Already checked in". Use name search. Refund in Stripe and confirm the name leaves the list and scanning shows voided.
Expected: every result above observed; record any failure and fix it before continuing.

- [ ] **Step 4: Resolve Spec open items with the user**

Final times, entry-only, Mourad's consent, venue address, clean logo, yearbook material if ready. Update `site/index.html` and email copy.

- [ ] **Step 5: Go live, after user approval**

Merge to `master`, enable Pages, set DNS, switch to live Stripe keys, price, and webhook secret.
Expected: `curl -I https://debakey2016reunion.com` returns 200 over HTTPS, and link preview shows seal and title.

- [ ] **Step 6: Live smoke test**

User buys one real $20 ticket, scans it, then refunds it.
Expected: same results as Step 3. Then share the link with classmates.
