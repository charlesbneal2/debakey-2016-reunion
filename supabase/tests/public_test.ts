import { assert, assertEquals } from "@std/assert";
import { newDb, orderArgs } from "./helpers.ts";
import { createStore } from "../functions/_shared/store.ts";
import { handleGuestList } from "../functions/guest-list/handler.ts";
import { handleTicket } from "../functions/ticket/handler.ts";

const SITE = "https://debakey2016reunion.com";

async function setup() {
  const { rpc } = await newDb();
  return { rpc, deps: { store: createStore(rpc), siteUrl: SITE } };
}

const get = (path: string) => new Request(`https://fn.test/${path}`, { headers: { origin: SITE } });

Deno.test("guest list exposes only name and plus_one", async () => {
  const { rpc, deps } = await setup();
  await rpc("record_paid_order", orderArgs({ p_email: "private@example.com" }));

  const res = await handleGuestList(get("guest-list"), deps);
  const text = await res.text();
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("cache-control"), "public, max-age=60");
  assertEquals(res.headers.get("access-control-allow-origin"), SITE);
  assertEquals(text.includes("private@example.com"), false);
  const { guests } = JSON.parse(text);
  assertEquals(Object.keys(guests[0]).sort(), ["name", "plus_one"]);
});

Deno.test("ticket response contains label and QR, no email or buyer details beyond label", async () => {
  const { rpc, deps } = await setup();
  const args = orderArgs({ p_email: "private@example.com" });
  await rpc("record_paid_order", args);

  const res = await handleTicket(get(`ticket?t=${args.p_classmate_token}`), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(Object.keys(body).sort(), ["kind", "label", "qr_png_base64", "voided"]);
  assertEquals(body.label, "Jane Doe");
  assertEquals(body.voided, false);
  assert(body.qr_png_base64.length > 100);
});

Deno.test("unknown or missing token returns 404", async () => {
  const { deps } = await setup();
  assertEquals((await handleTicket(get("ticket?t=nope"), deps)).status, 404);
  const missing = await handleTicket(get("ticket"), deps);
  assertEquals(missing.status, 404);
  assertEquals((await missing.json()).error, "Ticket not found.");
});

Deno.test("refunded ticket returns voided true", async () => {
  const { rpc, deps } = await setup();
  const args = orderArgs();
  await rpc("record_paid_order", args);
  await rpc("mark_order_refunded", { p_payment_intent: args.p_payment_intent });

  const body = await (await handleTicket(get(`ticket?t=${args.p_classmate_token}`), deps)).json();
  assertEquals(body.voided, true);
});

Deno.test("OPTIONS succeeds and POST is rejected", async () => {
  const { deps } = await setup();
  const options = new Request("https://fn.test/guest-list", { method: "OPTIONS", headers: { origin: SITE } });
  assertEquals((await handleGuestList(options, deps)).status, 204);
  const post = new Request("https://fn.test/ticket", { method: "POST", headers: { origin: SITE } });
  assertEquals((await handleTicket(post, deps)).status, 405);
});
