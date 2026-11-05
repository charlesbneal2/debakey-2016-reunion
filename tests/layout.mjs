// Browser checks for the static site, run with: node tests/layout.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const SITE_DIR = new URL("../site/", import.meta.url).pathname;
const SHOTS = process.env.SCREENSHOT_DIR ?? tmpdir();
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png" };

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
    await page.getByRole("heading", { name: "Who's coming" }).waitFor();
    assert.equal(await noOverflow(page), true);
    await page.screenshot({ path: join(SHOTS, `index-${width}.png`), fullPage: true });
  });
}

await test("key facts fit on first screen of a small phone", async (open) => {
  const page = await open({ width: 360, height: 640 });
  await page.goto(BASE);
  const cover = page.locator("#cover");
  for (const text of ["November 28, 2026", "Bad Astronaut", "Get Tickets", "832-860-7467"]) {
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

await test("guest names render literally with +1", async (open) => {
  const name = "<img src=x onerror=window.__xss=1>";
  const page = await open({ guests: [{ name, plus_one: true }] });
  await page.goto(BASE);
  await page.getByText(`${name} +1`).waitFor();
  assert.equal(await page.evaluate(() => window.__xss), undefined);
});

await test("empty guest list invites first buyer", async (open) => {
  const page = await open({ guests: [] });
  await page.goto(BASE);
  await page.getByText("Be the first on the list").waitFor();
});

await test("failed guest list hides its section without page errors", async (open) => {
  const page = await open({ guests: "fail" });
  const response = page.waitForResponse("**/guest-list");
  await page.goto(BASE);
  await response;
  await page.waitForTimeout(50);
  assert.equal(await page.locator("#guests").isVisible(), false);
  assert.deepEqual(page.errors, []);
});

await test("guest name field appears only for +1", async (open) => {
  const page = await open();
  await page.goto(BASE);
  assert.equal(await page.getByLabel("Guest's name").isVisible(), false);
  await page.getByLabel("Me + guest, $40").check();
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
  await page.getByLabel("Me + guest, $40").check();
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
  await page.getByLabel("Me + guest, $40").check();
  await page.getByLabel("Guest's name").fill("Sam Guest");
  await page.getByLabel("Just me, $20").check();
  await page.getByLabel("Your name").fill("Jane Doe");
  await page.getByLabel("Show my name on the list").check();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.waitForURL("**/stripe-mock");
  assert.deepEqual(body, { name: "Jane Doe", guest_name: "", with_guest: false, show_on_list: true });
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
  await page.locator("#form-status").getByText("832-860-7467").waitFor();
  assert.equal(await button.isEnabled(), true);
});

await test("network failure shows contact and re-enables button", async (open) => {
  const page = await open();
  await page.route("**/create-checkout", (route) => route.abort());
  await page.goto(BASE);
  await page.getByLabel("Your name").fill("Jane Doe");
  const button = page.getByRole("button", { name: "Continue to payment" });
  await button.click();
  await page.locator("#form-status").getByText("832-860-7467").waitFor();
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
  const page = await open({ now: "2026-11-29T04:00:00Z" });
  await page.goto(BASE);
  await page.getByText("Ticket sales have closed.").first().waitFor();
  assert.equal(await page.getByLabel("Your name").count(), 0);
  assert.equal(await page.getByRole("link", { name: /Get Tickets/ }).isVisible(), false);
});

await test("form stays open just before sales close", async (open) => {
  const page = await open({ now: "2026-11-29T03:59:59Z" });
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

await test("page has share tags, contact link, and seal alt text", async (open) => {
  const page = await open();
  await page.goto(BASE);
  assert.match(await page.title(), /DeBakey/);
  for (const property of ["og:title", "og:description", "og:image"]) {
    assert.ok(await page.locator(`meta[property="${property}"]`).getAttribute("content"), property);
  }
  assert.match(await page.locator('meta[property="og:image"]').getAttribute("content"), /^https:\/\/debakey2016reunion\.com\//);
  assert.ok(await page.locator('a[href="tel:+18328607467"]').count());
  assert.match(await page.locator("#cover img").getAttribute("alt"), /DeBakey/);
  const loaded = await page.locator("#cover img").evaluate((img) => img.decode().then(() => img.naturalWidth));
  assert.ok(loaded > 0, "seal image loads");
});

await browser.close();
server.close();
if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall layout checks passed");
