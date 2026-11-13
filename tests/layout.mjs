// Browser checks for the static site, run with: node tests/layout.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const SITE_DIR = new URL("../site/", import.meta.url).pathname;
const SHOTS = process.env.SCREENSHOT_DIR ?? tmpdir();
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml" };

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/stripe-mock") return res.writeHead(200, { "content-type": "text/html" }).end("<h1>Stripe</h1>");
  let file = normalize(path === "/" ? "/index.html" : path);
  if (!extname(file)) file += ".html"; // GitHub Pages serves /thanks from thanks.html
  try {
    const body = await readFile(join(SITE_DIR, file));
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const VIEWPORTS = [[360, 640], [390, 844], [1280, 800]];
let failures = 0;

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

async function newPage({ width = 390, height = 844, now = "2026-11-10T12:00:00Z", guests = [{ name: "Jane Doe", plus_one: false }] } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  context.setDefaultTimeout(4000);
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (error) => page.errors.push(error.message));
  await page.clock.setFixedTime(new Date(now));
  await page.route("**/guest-list", (route) =>
    guests === "fail" ? json(route, { error: "down" }, 500) : json(route, { guests }));
  return page;
}

async function test(name, fn) {
  let page;
  try {
    await fn((options) => newPage(options).then((p) => (page = p)));
    console.log(`ok - ${name}`);
  } catch (error) {
    failures++;
    console.log(`FAILED - ${name}\n  ${error.message}`);
  } finally {
    await page?.context().close();
  }
}

const noOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const [width, height] of VIEWPORTS) {
  await test(`index has no horizontal overflow at ${width}x${height}`, async (open) => {
    const page = await open({ width, height });
    await page.goto(BASE);
    await page.getByRole("heading", { name: "Get your tickets" }).waitFor();
    assert.equal(await noOverflow(page), true);
    await page.screenshot({ path: join(SHOTS, `index-${width}.png`), fullPage: true });
  });
}

await test("key facts fit on first screen of a small phone", async (open) => {
  const page = await open({ width: 360, height: 640 });
  await page.goto(BASE);
  const cover = page.locator("#cover");
  for (const text of ["November 28, 2026", "Eureka Heights", "Get Tickets", "info@debakey2016reunion.com"]) {
    const box = await cover.getByText(text).first().boundingBox();
    assert.ok(box, `${text} is visible`);
    assert.ok(box.y + box.height <= 640, `${text} bottom ${box.y + box.height} <= 640`);
  }
  await page.screenshot({ path: join(SHOTS, "cover-360.png") });
});

await test("yearbook section is hidden until content exists", async (open) => {
  const page = await open();
  await page.goto(BASE);
  assert.equal(await page.locator("#yearbook").count(), 1);
  assert.equal(await page.locator("#yearbook").isVisible(), false);
});

// ponytail: guest list is paused (see index.html); restore its old tests from git history when it comes back.
await test("paused guest list stays hidden and is never fetched", async (open) => {
  const page = await open();
  let fetched = false;
  page.on("request", (request) => { if (request.url().endsWith("/guest-list")) fetched = true; });
  await page.goto(BASE);
  await page.waitForTimeout(50);
  assert.equal(fetched, false);
  assert.equal(await page.locator("#guests").isVisible(), false);
  assert.equal(await page.getByLabel("Show my name on the list").isVisible(), false);
});

await test("guest name field appears only for +1", async (open) => {
  const page = await open();
  await page.goto(BASE);
  assert.equal(await page.getByLabel("Guest's name").isVisible(), false);
  await page.getByLabel("Me + guest, $30").check();
  assert.equal(await page.getByLabel("Guest's name").isVisible(), true);
});

await test("+1 submit posts form and goes to Stripe", async (open) => {
  const page = await open();
  let body;
  await page.route("**/create-checkout", (route) => {
    body = route.request().postDataJSON();
    return json(route, { url: `${BASE}/stripe-mock` });
  });
  await page.goto(BASE);
  await page.getByLabel("Me + guest, $30").check();
  await page.getByLabel("Your name").fill("Jane Doe");
  await page.getByLabel("Guest's name").fill("Sam Guest");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.waitForURL("**/stripe-mock");
  assert.deepEqual(body, { name: "Jane Doe", guest_name: "Sam Guest", with_guest: true, show_on_list: false });
});

await test("guest name is not sent after switching back to just me", async (open) => {
  const page = await open();
  let body;
  await page.route("**/create-checkout", (route) => {
    body = route.request().postDataJSON();
    return json(route, { url: `${BASE}/stripe-mock` });
  });
  await page.goto(BASE);
  await page.getByLabel("Me + guest, $30").check();
  await page.getByLabel("Guest's name").fill("Sam Guest");
  await page.getByLabel("Just me, $15").check();
  await page.getByLabel("Your name").fill("Jane Doe");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.waitForURL("**/stripe-mock");
  assert.deepEqual(body, { name: "Jane Doe", guest_name: "", with_guest: false, show_on_list: false });
});

await test("blank name is stopped before any request", async (open) => {
  const page = await open();
  let called = false;
  await page.route("**/create-checkout", (route) => {
    called = true;
    return json(route, { url: `${BASE}/stripe-mock` });
  });
  await page.goto(BASE);
  await page.getByLabel("Your name").fill("   ");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.waitForTimeout(50);
  assert.equal(called, false);
});

await test("checkout failure shows contact and re-enables button", async (open) => {
  const page = await open();
  await page.route("**/create-checkout", (route) => json(route, { error: "Could not start checkout." }, 502));
  await page.goto(BASE);
  await page.getByLabel("Your name").fill("Jane Doe");
  const button = page.getByRole("button", { name: "Continue to payment" });
  await button.click();
  await page.locator("#form-status").getByText("info@debakey2016reunion.com").waitFor();
  assert.equal(await button.isEnabled(), true);
});

await test("network failure shows contact and re-enables button", async (open) => {
  const page = await open();
  await page.route("**/create-checkout", (route) => route.abort());
  await page.goto(BASE);
  await page.getByLabel("Your name").fill("Jane Doe");
  const button = page.getByRole("button", { name: "Continue to payment" });
  await button.click();
  await page.locator("#form-status").getByText("info@debakey2016reunion.com").waitFor();
  assert.equal(await button.isEnabled(), true);
});

await test("button works again after coming back from Stripe", async (open) => {
  const page = await open();
  await page.route("**/create-checkout", (route) => json(route, { url: `${BASE}/stripe-mock` }));
  await page.goto(BASE);
  await page.getByLabel("Your name").fill("Jane Doe");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.waitForURL("**/stripe-mock");
  await page.goBack();
  assert.equal(await page.getByRole("button", { name: "Continue to payment" }).isEnabled(), true);
});

await test("form is replaced after sales close", async (open) => {
  const page = await open({ now: "2026-11-29T03:00:00Z" });
  await page.goto(BASE);
  await page.getByText("Ticket sales have closed.").first().waitFor();
  assert.equal(await page.getByLabel("Your name").count(), 0);
  assert.equal(await page.getByRole("link", { name: /Get Tickets/ }).isVisible(), false);
});

await test("form stays open just before sales close", async (open) => {
  const page = await open({ now: "2026-11-29T02:59:59Z" });
  await page.goto(BASE);
  assert.equal(await page.getByLabel("Your name").isVisible(), true);
});

await test("server says closed while page is stale", async (open) => {
  const page = await open();
  await page.route("**/create-checkout", (route) => json(route, { error: "Ticket sales have closed." }, 410));
  await page.goto(BASE);
  await page.getByLabel("Your name").fill("Jane Doe");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.locator("#form-status").getByText("Ticket sales have closed.").waitFor();
});

await test("page has share tags, contact link, and logo alt text", async (open) => {
  const page = await open();
  await page.goto(BASE);
  assert.match(await page.title(), /DeBakey/);
  for (const property of ["og:title", "og:description", "og:image"]) {
    assert.ok(await page.locator(`meta[property="${property}"]`).getAttribute("content"), property);
  }
  assert.match(await page.locator('meta[property="og:image"]').getAttribute("content"), /^https:\/\/debakey2016reunion\.com\//);
  assert.ok(await page.locator('a[href="mailto:info@debakey2016reunion.com"]').count());
  assert.match(await page.locator("#cover img").getAttribute("alt"), /DeBakey/);
  const loaded = await page.locator("#cover img").evaluate((img) => img.decode().then(() => img.naturalWidth));
  assert.ok(loaded > 0, "logo image loads");
});

await test("checkout works on browsers without AbortSignal.timeout", async (open) => {
  const page = await open();
  await page.addInitScript(() => {
    delete AbortSignal.timeout;
  });
  await page.route("**/create-checkout", (route) => json(route, { url: `${BASE}/stripe-mock` }));
  await page.goto(BASE);
  await page.getByLabel("Your name").fill("Jane Doe");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.waitForURL("**/stripe-mock");
});

await test("privacy page is linked and says what is collected and who to contact", async (open) => {
  const page = await open({ width: 360, height: 640 });
  await page.goto(BASE);
  await page.locator("#questions").getByRole("link", { name: "Privacy" }).click();
  await page.waitForURL("**/privacy");
  await page.getByRole("heading", { name: "Privacy" }).waitFor();
  for (const text of ["name", "email", "Stripe", "info@debakey2016reunion.com"]) {
    await page.locator("main").getByText(text).first().waitFor();
  }
  assert.equal(await noOverflow(page), true);
});

const DOOR = "**/functions/v1/door";
const TICKET = "**/functions/v1/ticket*";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

await test("thanks page explains next steps", async (open) => {
  const page = await open({ width: 360, height: 640 });
  await page.goto(`${BASE}/thanks`);
  await page.getByText("on their way").waitFor();
  await page.getByText("15 minutes").waitFor();
  assert.ok(await page.locator('a[href="mailto:info@debakey2016reunion.com"]').count());
  assert.equal(await noOverflow(page), true);
});

await test("ticket page shows QR and literal label", async (open) => {
  const page = await open({ width: 360, height: 640 });
  const label = "<b>Jane</b>";
  await page.route(TICKET, (route) => json(route, { label, kind: "classmate", voided: false, qr_png_base64: PNG }));
  await page.goto(`${BASE}/ticket?t=x`);
  await page.getByText(label).waitFor();
  assert.match(await page.locator("#qr").getAttribute("src"), /^data:image\/png;base64,/);
  assert.equal(await noOverflow(page), true);
  await page.screenshot({ path: join(SHOTS, "ticket-360.png") });
});

await test("voided ticket says no longer valid and hides QR", async (open) => {
  const page = await open();
  await page.route(TICKET, (route) => json(route, { label: "Jane", kind: "classmate", voided: true, qr_png_base64: PNG }));
  await page.goto(`${BASE}/ticket?t=x`);
  await page.getByText("no longer valid").waitFor();
  assert.equal(await page.locator("#qr").isVisible(), false);
});

await test("unknown ticket shows not found and contact", async (open) => {
  const page = await open();
  await page.route(TICKET, (route) => json(route, { error: "Ticket not found." }, 404));
  await page.goto(`${BASE}/ticket?t=bad`);
  await page.getByText("not found").waitFor();
  await page.getByText("info@debakey2016reunion.com").first().waitFor();
});

await test("thanks, ticket, and door pages are not indexed or linked", async (open) => {
  const page = await open();
  for (const path of ["thanks", "ticket", "door"]) {
    await page.route(TICKET, (route) => json(route, { error: "Ticket not found." }, 404));
    await page.goto(`${BASE}/${path}`);
    assert.equal(await page.locator('meta[name="robots"]').getAttribute("content"), "noindex");
  }
  await page.goto(BASE);
  const linked = await page.locator("a").evaluateAll((links) => links.map((a) => new URL(a.href).pathname));
  for (const path of ["/thanks", "/ticket", "/door"]) {
    assert.equal(linked.includes(path), false, path);
  }
});

async function openDoor(open, scanResponse, options = {}) {
  const page = await open({ width: 360, height: 640, ...options });
  const posts = [];
  await page.route(DOOR, (route) => {
    const body = route.request().postDataJSON();
    posts.push(body);
    if (body.password !== "right") return json(route, { error: "Wrong password." }, 401);
    if (body.action === "login") return json(route, { ok: true });
    if (body.action === "search") {
      return json(route, {
        matches: [
          { token: "tok-1", label: "<i>Jane</i>", kind: "classmate", voided: false, checked_in_at: null },
          { token: "tok-2", label: "Guest of Jane", kind: "guest", voided: false, checked_in_at: "2026-11-29T01:42:00Z" },
        ],
      });
    }
    return json(route, scanResponse);
  });
  await page.goto(`${BASE}/door`);
  return { page, posts };
}

async function login(page) {
  await page.getByLabel("Door password").fill("right");
  await page.getByRole("button", { name: "Open check-in" }).click();
  await page.getByLabel("Find by name").waitFor();
}

async function checkInFromSearch(page) {
  await page.getByLabel("Find by name").fill("jane");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Check in" }).first().click();
}

await test("door requires password and shows error", async (open) => {
  const { page } = await openDoor(open, {});
  assert.equal(await page.getByLabel("Find by name").isVisible(), false);
  await page.getByLabel("Door password").fill("wrong");
  await page.getByRole("button", { name: "Open check-in" }).click();
  await page.getByText("Wrong password.").waitFor();
});

await test("door search renders names literally and marks checked-in tickets", async (open) => {
  const { page } = await openDoor(open, {});
  await login(page);
  await page.getByLabel("Find by name").fill("jane");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByText("<i>Jane</i>").waitFor();
  await page.getByText("Checked in 7:42 PM").waitFor();
  assert.equal(await page.getByRole("button", { name: "Check in" }).count(), 1);
  await page.screenshot({ path: join(SHOTS, "door-search-360.png") });
  assert.equal(await noOverflow(page), true);
});

await test("door success is green with label, and posts the ticket token", async (open) => {
  const { page, posts } = await openDoor(open, { result: "ok", label: "Jane Doe", kind: "classmate", checked_in_at: "2026-11-29T01:42:00Z" });
  await login(page);
  await checkInFromSearch(page);
  const result = page.locator("#result");
  await result.getByText("Jane Doe").waitFor();
  assert.equal(await result.getAttribute("data-state"), "good");
  const scan = posts.find((p) => p.action === "scan");
  assert.equal(scan.scanned, "tok-1");
  await page.screenshot({ path: join(SHOTS, "door-ok-360.png") });
  await page.getByRole("button", { name: "Next" }).click();
  assert.equal(await result.isVisible(), false);
});

await test("door repeat scan is red with Central time", async (open) => {
  const { page } = await openDoor(open, { result: "already", label: "Jane Doe", kind: "classmate", checked_in_at: "2026-11-29T01:42:00Z" });
  await login(page);
  await checkInFromSearch(page);
  const result = page.locator("#result");
  await result.getByText("Already checked in at 7:42 PM").waitFor();
  assert.equal(await result.getAttribute("data-state"), "bad");
  await page.screenshot({ path: join(SHOTS, "door-already-360.png") });
});

await test("door voided and not-found results are red", async (open) => {
  for (const [response, text] of [
    [{ result: "voided", label: "Jane", kind: "classmate" }, "Refunded or voided"],
    [{ result: "not_found" }, "Not found"],
  ]) {
    const { page } = await openDoor(open, response);
    await login(page);
    await checkInFromSearch(page);
    await page.locator("#result").getByText(text).waitFor();
    assert.equal(await page.locator("#result").getAttribute("data-state"), "bad");
  }
});

await test("door keeps name search usable when camera is unavailable", async (open) => {
  const { page } = await openDoor(open, {});
  await login(page);
  await page.getByText("Camera unavailable").waitFor();
  assert.equal(await page.getByLabel("Find by name").isVisible(), true);
});

await test("door network failure points staff to printed list", async (open) => {
  const { page } = await openDoor(open, {});
  await login(page);
  await page.unroute(DOOR);
  await page.route(DOOR, (route) => route.abort());
  await page.getByLabel("Find by name").fill("jane");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByText("printed list").waitFor();
  assert.deepEqual(page.errors, []);
});

await browser.close();
server.close();
if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall layout checks passed");
