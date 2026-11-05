import { assertEquals } from "@std/assert";
import { newDb, orderArgs, type Rpc } from "./helpers.ts";
import { createStore } from "../functions/_shared/store.ts";
import { extractToken, handleDoor } from "../functions/door/handler.ts";

const SITE = "https://debakey2016reunion.com";
const PASSWORD = "door-secret";

async function setup(): Promise<{
  rpc: Rpc;
  door(body: unknown, ip?: string): Promise<Response>;
}> {
  const { rpc } = await newDb();
  const deps = { store: createStore(rpc), siteUrl: SITE, doorPassword: PASSWORD };
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

const auth = (body: Record<string, unknown>) => ({ password: PASSWORD, ...body });

Deno.test("login succeeds with correct password", async () => {
  const { door } = await setup();
  const res = await door(auth({ action: "login" }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
});

Deno.test("wrong password returns 401 and records failure", async () => {
  const { door, rpc } = await setup();
  const res = await door({ password: "wrong", action: "login" });
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error, "Wrong password.");
  for (let i = 0; i < 18; i++) await rpc("door_auth_failed", { p_ip: "1.2.3.4" });
  assertEquals(await rpc("door_auth_allowed", { p_ip: "1.2.3.4" }), true);
  await rpc("door_auth_failed", { p_ip: "1.2.3.4" });
  assertEquals(await rpc("door_auth_allowed", { p_ip: "1.2.3.4" }), false);
});

Deno.test("after 20 failures even correct password returns 429", async () => {
  const { door } = await setup();
  for (let i = 0; i < 20; i++) await door({ password: "wrong", action: "login" });
  const res = await door(auth({ action: "login" }));
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error, "Too many attempts. Wait 15 minutes.");
  assertEquals((await door(auth({ action: "login" }), "9.9.9.9")).status, 200);
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

Deno.test("search returns label, token, and checked-in state, requiring password", async () => {
  const { door, rpc } = await setup();
  const args = orderArgs();
  await rpc("record_paid_order", args);
  await door(auth({ action: "scan", scanned: args.p_classmate_token }));

  const { matches } = await (await door(auth({ action: "search", query: "jane" }))).json();
  assertEquals(matches.length, 1);
  assertEquals(matches[0].label, "Jane Doe");
  assertEquals(matches[0].token, args.p_classmate_token);
  assertEquals(typeof matches[0].checked_in_at, "string");
  assertEquals((await door({ password: "wrong", action: "search", query: "jane" })).status, 401);
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
