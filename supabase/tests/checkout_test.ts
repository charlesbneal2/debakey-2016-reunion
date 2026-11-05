import { assertEquals, assertStringIncludes } from "@std/assert";
import { parseOrderForm, SALES_CLOSE } from "../functions/_shared/rules.ts";
import { corsHeaders } from "../functions/_shared/http.ts";
import { buildSessionParams, type CheckoutParams, handleCheckout } from "../functions/create-checkout/handler.ts";

const SITE = "https://debakey2016reunion.com";

function post(body: unknown) {
  return new Request("https://fn.test/create-checkout", {
    method: "POST",
    headers: { origin: SITE, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deps(overrides: Partial<Parameters<typeof handleCheckout>[1]> = {}) {
  const calls: CheckoutParams[] = [];
  return {
    calls,
    now: () => new Date("2026-11-10T00:00:00Z"),
    siteUrl: SITE,
    createSession: (params: CheckoutParams) => {
      calls.push(params);
      return Promise.resolve({ url: "https://checkout.stripe.com/x" });
    },
    ...overrides,
  };
}

Deno.test("trims name and requires it", async () => {
  const form = parseOrderForm({ name: "  Jane  " });
  assertEquals(form.ok && form.value.name, "Jane");
  const res = await handleCheckout(post({ name: "   " }), deps());
  assertEquals(res.status, 400);
});

Deno.test("rejects names over 80 chars and non-object body", () => {
  assertEquals(parseOrderForm({ name: "x".repeat(81) }).ok, false);
  assertEquals(parseOrderForm({ name: "Jane", guest_name: "x".repeat(81), with_guest: true }).ok, false);
  assertEquals(parseOrderForm(null).ok, false);
  assertEquals(parseOrderForm("Jane").ok, false);
  assertEquals(parseOrderForm({ name: 42 }).ok, false);
});

Deno.test("keeps HTML and emoji in names unchanged", () => {
  const name = `<b>Jos&é 🎉"`;
  const form = parseOrderForm({ name });
  assertEquals(form.ok && form.value.name, name);
});

Deno.test("guest name dropped unless withGuest", () => {
  const without = parseOrderForm({ name: "Jane", guest_name: "Sam", with_guest: false });
  assertEquals(without.ok && without.value.guestName, "");
  const withGuest = parseOrderForm({ name: "Jane", guest_name: " Sam ", with_guest: true });
  assertEquals(withGuest.ok && withGuest.value.guestName, "Sam");
});

Deno.test("quantity from withGuest, never from client", async () => {
  const d = deps();
  await handleCheckout(post({ name: "Jane", quantity: 99, with_guest: false }), d);
  await handleCheckout(post({ name: "Jane", quantity: 99, with_guest: true, guest_name: "Sam", show_on_list: true }), d);

  assertEquals(d.calls.map((c) => c.quantity), [1, 2]);
  assertEquals(d.calls[0].metadata, { name: "Jane", guest_name: "", with_guest: "false", show_on_list: "false" });
  assertEquals(d.calls[1].metadata, { name: "Jane", guest_name: "Sam", with_guest: "true", show_on_list: "true" });
  assertEquals(d.calls[0].successUrl, `${SITE}/thanks`);
  assertEquals(d.calls[0].cancelUrl, `${SITE}/#tickets`);
});

Deno.test("show_on_list requires literal true", () => {
  const form = parseOrderForm({ name: "Jane", show_on_list: "false" });
  assertEquals(form.ok && form.value.showOnList, false);
});

Deno.test("closed exactly at SALES_CLOSE", async () => {
  assertEquals(SALES_CLOSE.toISOString(), "2026-11-29T04:00:00.000Z");
  const before = await handleCheckout(
    post({ name: "Jane" }),
    deps({ now: () => new Date(SALES_CLOSE.getTime() - 1) }),
  );
  assertEquals(before.status, 200);
  assertEquals((await before.json()).url, "https://checkout.stripe.com/x");

  const at = await handleCheckout(post({ name: "Jane" }), deps({ now: () => SALES_CLOSE }));
  assertEquals(at.status, 410);
  assertEquals((await at.json()).error, "Ticket sales have closed.");
});

Deno.test("Stripe failure returns 502 without leaking the error text", async () => {
  const res = await handleCheckout(
    post({ name: "Jane" }),
    deps({ createSession: () => Promise.reject(new Error("sk_live_secret exploded")) }),
  );
  assertEquals(res.status, 502);
  const text = await res.text();
  assertEquals(text.includes("sk_live_secret"), false);
  assertStringIncludes(text, "error");
});

Deno.test("invalid JSON returns 400", async () => {
  const req = new Request("https://fn.test/", { method: "POST", headers: { origin: SITE }, body: "{nope" });
  assertEquals((await handleCheckout(req, deps())).status, 400);
});

Deno.test("CORS allows production and localhost, not other origins", () => {
  assertEquals(corsHeaders(SITE, SITE)["access-control-allow-origin"], SITE);
  assertEquals(
    corsHeaders("http://localhost:8000", SITE)["access-control-allow-origin"],
    "http://localhost:8000",
  );
  assertEquals(corsHeaders("https://evil.example", SITE)["access-control-allow-origin"], undefined);
  assertEquals(corsHeaders("http://localhost.evil.example", SITE)["access-control-allow-origin"], undefined);
  assertEquals(corsHeaders(null, SITE)["access-control-allow-origin"], undefined);
});

Deno.test("OPTIONS returns 204 with CORS headers; GET returns 405", async () => {
  const options = await handleCheckout(
    new Request("https://fn.test/", { method: "OPTIONS", headers: { origin: SITE } }),
    deps(),
  );
  assertEquals(options.status, 204);
  assertEquals(options.headers.get("access-control-allow-origin"), SITE);
  const get = await handleCheckout(new Request("https://fn.test/", { headers: { origin: SITE } }), deps());
  assertEquals(get.status, 405);
});

const checkoutParams = (guest_name: string): CheckoutParams => ({
  quantity: guest_name ? 2 : 1,
  successUrl: `${SITE}/thanks`,
  cancelUrl: `${SITE}/#tickets`,
  metadata: { name: "Jane", guest_name, with_guest: guest_name ? "true" : "false", show_on_list: "false" },
});

Deno.test("session takes instant card payments only, so tickets are never delayed", () => {
  const session = buildSessionParams(checkoutParams(""), "price_1");
  assertEquals(session.payment_method_types, ["card"]);
  assertEquals(session.mode, "payment");
  assertEquals(session.line_items, [{ price: "price_1", quantity: 1 }]);
  assertEquals(session.success_url, `${SITE}/thanks`);
  assertEquals(session.cancel_url, `${SITE}/#tickets`);
});

Deno.test("session metadata omits empty guest name and keeps a real one", () => {
  assertEquals(buildSessionParams(checkoutParams(""), "price_1").metadata, {
    name: "Jane",
    with_guest: "false",
    show_on_list: "false",
  });
  assertEquals(buildSessionParams(checkoutParams("Sam"), "price_1").metadata?.guest_name, "Sam");
});
