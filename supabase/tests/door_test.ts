import { assertEquals } from "@std/assert";
import { newDb, orderArgs, type Rpc } from "./helpers.ts";
import { createStore } from "../functions/_shared/store.ts";
import { extractToken, handleDoor } from "../functions/door/handler.ts";

const SITE = "https://debakey2016reunion.com";
const TOKEN = "admin-access-token";

async function setup(): Promise<{
  rpc: Rpc;
  door(body: unknown, ip?: string): Promise<Response>;
}> {
  const { rpc } = await newDb();
  const deps = { store: createStore(rpc), siteUrl: SITE, isAdmin: (token: string) => Promise.resolve(token === TOKEN) };
  return {
    rpc,
    door: (body, ip = "1.2.3.4") =>
      handleDoor(
        new Request("https://fn.test/door", {
          method: "POST",
          headers: { origin: SITE, "x-forwarded-for": `${ip}, 10.0.0.1` },
          body: JSON.stringify(body),
        }),
        deps,
      ),
  };
}

const auth = (body: Record<string, unknown>) => ({ token: TOKEN, ...body });

Deno.test("login succeeds with an admin token", async () => {
  const { door } = await setup();
  const res = await door(auth({ action: "login" }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
});

Deno.test("missing or non-admin token returns 401", async () => {
  const { door } = await setup();
  for (const body of [{ action: "login" }, { token: "someone-else", action: "scan", scanned: "x" }, { token: 7, action: "orders" }]) {
    const res = await door(body);
    assertEquals(res.status, 401);
    assertEquals((await res.json()).error, "Sign in with an organizer account.");
  }
});

Deno.test("orders lists every buyer with contact info, guest, and refund status", async () => {
  const { door, rpc } = await setup();
  await rpc("record_paid_order", orderArgs({ p_buyer_name: "Ana Ruiz", p_email: "ana@example.com" }));
  const refunded = orderArgs({
    p_buyer_name: "Bo Lee",
    p_email: "bo@example.com",
    p_with_guest: true,
    p_guest_name: "Cy Lee",
    p_guest_token: "g-bo",
  });
  await rpc("record_paid_order", refunded);
  await rpc("mark_order_refunded", { p_payment_intent: refunded.p_payment_intent });

  const { orders } = await (await door(auth({ action: "orders" }))).json();
  assertEquals(
    orders.map(({ created_at, ...rest }: { created_at: string }) => (assertEquals(typeof created_at, "string"), rest)),
    [
      { buyer_name: "Ana Ruiz", email: "ana@example.com", guest_name: null, with_guest: false, status: "paid" },
      { buyer_name: "Bo Lee", email: "bo@example.com", guest_name: "Cy Lee", with_guest: true, status: "refunded" },
    ],
  );
});

Deno.test("extractToken takes t from ticket URL or raw token", () => {
  assertEquals(extractToken(`${SITE}/ticket?t=abc123`), "abc123");
  assertEquals(extractToken("  abc123 "), "abc123");
});

Deno.test("garbage, non-ticket URL, and empty scans give not_found without throwing", async () => {
  const { door } = await setup();
  for (const scanned of ["https://example.com/menu", "http://[bad", "", "WIFI:S:venue;;", undefined, 42]) {
    const res = await door(auth({ action: "scan", scanned }));
    assertEquals(res.status, 200);
    assertEquals((await res.json()).result, "not_found");
  }
});

Deno.test("first scan ok with label; second scan already with time", async () => {
  const { door, rpc } = await setup();
  const args = orderArgs({ p_with_guest: true, p_guest_token: "guest-t", p_amount_total: 4000 });
  await rpc("record_paid_order", args);

  const first = await (await door(auth({ action: "scan", scanned: `${SITE}/ticket?t=guest-t` }))).json();
  assertEquals(first.result, "ok");
  assertEquals(first.label, "Guest of Jane Doe");
  assertEquals(first.kind, "guest");

  const second = await (await door(auth({ action: "scan", scanned: "guest-t" }))).json();
  assertEquals(second.result, "already");
  assertEquals(typeof second.checked_in_at, "string");
});

Deno.test("refunded ticket gives voided", async () => {
  const { door, rpc } = await setup();
  const args = orderArgs();
  await rpc("record_paid_order", args);
  await rpc("mark_order_refunded", { p_payment_intent: args.p_payment_intent });

  const body = await (await door(auth({ action: "scan", scanned: args.p_classmate_token }))).json();
  assertEquals(body.result, "voided");
});

Deno.test("search returns label, token, and checked-in state, requiring admin token", async () => {
  const { door, rpc } = await setup();
  const args = orderArgs();
  await rpc("record_paid_order", args);
  await door(auth({ action: "scan", scanned: args.p_classmate_token }));

  const { matches } = await (await door(auth({ action: "search", query: "jane" }))).json();
  assertEquals(matches.length, 1);
  assertEquals(matches[0].label, "Jane Doe");
  assertEquals(matches[0].token, args.p_classmate_token);
  assertEquals(typeof matches[0].checked_in_at, "string");
  assertEquals((await door({ token: "wrong", action: "search", query: "jane" })).status, 401);
});

Deno.test("search with non-string query returns no matches", async () => {
  const { door } = await setup();
  const { matches } = await (await door(auth({ action: "search", query: 5 }))).json();
  assertEquals(matches, []);
});

Deno.test("unknown action returns 400", async () => {
  const { door } = await setup();
  assertEquals((await door(auth({ action: "explode" }))).status, 400);
});
