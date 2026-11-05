import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import Stripe from "stripe";
import { newDb } from "./helpers.ts";
import { createStore } from "../functions/_shared/store.ts";
import type { TicketEmail } from "../functions/_shared/tickets.ts";
import { handleStripeEvent } from "../functions/stripe-webhook/handler.ts";
import { verifyEvent } from "../functions/stripe-webhook/index.ts";

const SITE = "https://debakey2016reunion.com";

function paidSession(overrides: Record<string, unknown> = {}) {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        payment_intent: "pi_1",
        payment_status: "paid",
        amount_total: 2000,
        customer_details: { email: "jane@example.com", name: "Card Name" },
        metadata: { name: "Jane Doe", guest_name: "", with_guest: "false", show_on_list: "true" },
        ...overrides,
      },
    },
  };
}

const plusOne = (guest_name = "") => ({
  amount_total: 4000,
  metadata: { name: "Jane Doe", guest_name, with_guest: "true", show_on_list: "true" },
});

function refundEvent(refunded = true) {
  return { type: "charge.refunded", data: { object: { payment_intent: "pi_1", refunded } } };
}

async function setup() {
  const { db, rpc } = await newDb();
  const sent: { to: string; email: TicketEmail }[] = [];
  let failures = 0;
  const deps = {
    store: createStore(rpc),
    siteUrl: SITE,
    sendEmail: (to: string, email: TicketEmail) => {
      if (failures > 0) {
        failures--;
        return Promise.reject(new Error("email down"));
      }
      sent.push({ to, email });
      return Promise.resolve();
    },
  };
  const count = async (table: string) =>
    (await db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n;
  const tokens = async () =>
    (await db.query<{ token: string }>("select token from tickets order by kind")).rows.map((r) => r.token);
  return { db, deps, sent, count, tokens, failNext: () => failures++ };
}

Deno.test("paid session creates order, tickets, and sends one email", async () => {
  const { deps, sent, count } = await setup();
  const res = await handleStripeEvent(paidSession(), deps);

  assertEquals(res.status, 200);
  assertEquals(await count("orders"), 1);
  assertEquals(await count("tickets"), 1);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].to, "jane@example.com");
});

Deno.test("delayed payment success also issues tickets", async () => {
  const { deps, sent, count } = await setup();
  const res = await handleStripeEvent(
    { ...paidSession(), type: "checkout.session.async_payment_succeeded" },
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(await count("tickets"), 1);
  assertEquals(sent.length, 1);
});

Deno.test("unpaid session creates nothing and returns 200", async () => {
  const { deps, sent, count } = await setup();
  const res = await handleStripeEvent(paidSession({ payment_status: "unpaid" }), deps);
  assertEquals(res.status, 200);
  assertEquals(await count("orders"), 0);
  assertEquals(sent.length, 0);
});

Deno.test("duplicate event sends no second email and keeps same tokens", async () => {
  const { deps, sent, count, tokens } = await setup();
  await handleStripeEvent(paidSession(), deps);
  const before = await tokens();
  const res = await handleStripeEvent(paidSession(), deps);

  assertEquals(res.status, 200);
  assertEquals(sent.length, 1);
  assertEquals(await count("orders"), 1);
  assertEquals(await tokens(), before);
});

Deno.test("email failure returns 500, retry sends without duplicate tickets", async () => {
  const { deps, sent, count, failNext, db } = await setup();
  failNext();
  const failed = await handleStripeEvent(paidSession(plusOne()), deps);
  assertEquals(failed.status, 500);
  const { rows } = await db.query<{ email_sent_at: string | null }>("select email_sent_at from orders");
  assertEquals(rows[0].email_sent_at, null);

  const retried = await handleStripeEvent(paidSession(plusOne()), deps);
  assertEquals(retried.status, 200);
  assertEquals(await count("orders"), 1);
  assertEquals(await count("tickets"), 2);
  assertEquals(sent.length, 1);
});

Deno.test("after correcting email and clearing email_sent_at, retry goes to new address", async () => {
  const { deps, sent, db, tokens } = await setup();
  await handleStripeEvent(paidSession(), deps);
  const before = await tokens();
  await db.exec("update orders set email = 'fixed@example.com', email_sent_at = null");

  await handleStripeEvent(paidSession(), deps);

  assertEquals(sent.length, 2);
  assertEquals(sent[1].to, "fixed@example.com");
  assertEquals(await tokens(), before);
  assertStringIncludes(sent[1].email.html, before[0]);
});

Deno.test("email uses one QR per ticket and escapes names", async () => {
  const { deps, sent, tokens } = await setup();
  const name = "<b>A&B</b>";
  await handleStripeEvent(
    paidSession({
      amount_total: 4000,
      metadata: { name, guest_name: "Sam", with_guest: "true", show_on_list: "false" },
    }),
    deps,
  );
  const { html, attachments, subject } = sent[0].email;

  assertEquals(subject, "Your DeBakey reunion tickets");
  assertStringIncludes(html, "&lt;b&gt;A&amp;B&lt;/b&gt;");
  assertEquals(html.includes("<b>A&B</b>"), false);
  assertEquals(attachments.length, 2);
  for (const attachment of attachments) {
    assertStringIncludes(html, `cid:${attachment.content_id}`);
    assert(attachment.content.length > 100, "QR image has content");
  }
  for (const token of await tokens()) {
    assertStringIncludes(html, `${SITE}/ticket?t=${token}`);
  }
  assertStringIncludes(html, "Saturday, November 28, 2026");
  assertStringIncludes(html, "Bad Astronaut");
});

Deno.test("unnamed guest ticket labeled Guest of buyer", async () => {
  const { deps, sent } = await setup();
  await handleStripeEvent(paidSession(plusOne()), deps);
  assertStringIncludes(sent[0].email.html, "Guest of Jane Doe");
});

Deno.test("named guest ticket shows guest name", async () => {
  const { deps, sent } = await setup();
  await handleStripeEvent(paidSession(plusOne("Sam Guest")), deps);
  assertStringIncludes(sent[0].email.html, "Sam Guest");
});

Deno.test("full refund voids tickets; partial refund changes nothing", async () => {
  const { deps, db } = await setup();
  await handleStripeEvent(paidSession(), deps);
  const status = async () =>
    (await db.query<{ status: string; voided_at: string | null }>(
      "select o.status, t.voided_at from orders o join tickets t on t.order_id = o.id",
    )).rows[0];

  assertEquals((await handleStripeEvent(refundEvent(false), deps)).status, 200);
  assertEquals((await status()).status, "paid");
  assertEquals((await status()).voided_at, null);

  assertEquals((await handleStripeEvent(refundEvent(true), deps)).status, 200);
  assertEquals((await status()).status, "refunded");
  assert((await status()).voided_at !== null);
});

Deno.test("refund before order returns 500 so Stripe retries", async () => {
  const { deps } = await setup();
  assertEquals((await handleStripeEvent(refundEvent(), deps)).status, 500);
});

Deno.test("refunded order retry sends no email", async () => {
  const { deps, sent, failNext } = await setup();
  failNext();
  await handleStripeEvent(paidSession(), deps);
  await handleStripeEvent(refundEvent(), deps);

  const res = await handleStripeEvent(paidSession(), deps);
  assertEquals(res.status, 200);
  assertEquals(sent.length, 0);
});

Deno.test("unknown event type returns 200", async () => {
  const { deps } = await setup();
  const res = await handleStripeEvent({ type: "invoice.paid", data: { object: {} } }, deps);
  assertEquals(res.status, 200);
});

Deno.test("verifyEvent accepts valid signature and rejects tampered body", async () => {
  const stripe = new Stripe("sk_test_x", { httpClient: Stripe.createFetchHttpClient() });
  const secret = "whsec_test";
  const payload = JSON.stringify({ id: "evt_1", object: "event", type: "invoice.paid", data: { object: {} } });
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
  const signature = `t=${timestamp},v1=${hex}`;

  const event = await verifyEvent(payload, signature, secret, stripe);
  assertEquals(event.type, "invoice.paid");
  await assertRejects(() => verifyEvent(payload + " ", signature, secret, stripe));
  await assertRejects(() => verifyEvent(payload, signature, "whsec_other", stripe));
});
