import { assertEquals, assertRejects } from "@std/assert";
import { newDb, orderArgs } from "./helpers.ts";

type Order = {
  id: string;
  email: string;
  status: string;
  email_sent_at: string | null;
  buyer_name: string;
  tickets: { token: string; holder_name: string | null; kind: string }[];
};

Deno.test("same session twice creates one order and its tickets", async () => {
  const { rpc, db } = await newDb();
  const args = orderArgs();
  const first = await rpc("record_paid_order", args) as Order;
  const second = await rpc("record_paid_order", {
    ...args,
    p_classmate_token: "different-token",
  }) as Order;

  assertEquals(second.id, first.id);
  assertEquals(second.tickets, first.tickets);
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from tickets");
  assertEquals(rows[0].n, 1);
});

Deno.test("with guest creates classmate and guest tickets", async () => {
  const { rpc } = await newDb();
  const order = await rpc(
    "record_paid_order",
    orderArgs({ p_with_guest: true, p_guest_token: "guest-token", p_amount_total: 4000 }),
  ) as Order;

  assertEquals(order.tickets.map((t) => t.kind), ["classmate", "guest"]);
  assertEquals(order.tickets[0].holder_name, "Jane Doe");
  assertEquals(order.tickets[1].holder_name, null);
});

Deno.test("guest list has only paid opted-in buyers, never guest names", async () => {
  const { rpc } = await newDb();
  await rpc("record_paid_order", orderArgs({
    p_with_guest: true,
    p_guest_name: "Secret Guest",
    p_guest_token: "g1",
    p_amount_total: 4000,
  }));
  await rpc("record_paid_order", orderArgs({ p_buyer_name: "Hidden", p_show_on_list: false }));
  const refunded = orderArgs({ p_buyer_name: "Refunded" });
  await rpc("record_paid_order", refunded);
  await rpc("mark_order_refunded", { p_payment_intent: refunded.p_payment_intent });

  assertEquals(await rpc("public_guest_list"), [{ name: "Jane Doe", plus_one: true }]);
});

Deno.test("refund voids tickets and missing payment intent returns false", async () => {
  const { rpc } = await newDb();
  const args = orderArgs();
  await rpc("record_paid_order", args);

  assertEquals(await rpc("mark_order_refunded", { p_payment_intent: args.p_payment_intent }), true);
  assertEquals(await rpc("mark_order_refunded", { p_payment_intent: "pi_missing" }), false);
  const ticket = await rpc("get_ticket", { p_token: args.p_classmate_token }) as { voided: boolean };
  assertEquals(ticket.voided, true);
});

Deno.test("voided ticket cannot check in", async () => {
  const { rpc } = await newDb();
  const args = orderArgs();
  await rpc("record_paid_order", args);
  await rpc("mark_order_refunded", { p_payment_intent: args.p_payment_intent });

  const result = await rpc("check_in_ticket", { p_token: args.p_classmate_token }) as { result: string };
  assertEquals(result.result, "voided");
});

Deno.test("parallel check-ins admit exactly once", async () => {
  const { rpc } = await newDb();
  const args = orderArgs();
  await rpc("record_paid_order", args);

  const results = await Promise.all([
    rpc("check_in_ticket", { p_token: args.p_classmate_token }),
    rpc("check_in_ticket", { p_token: args.p_classmate_token }),
  ]) as { result: string; checked_in_at?: string }[];

  assertEquals(results.map((r) => r.result).sort(), ["already", "ok"]);
  assertEquals(typeof results.find((r) => r.result === "already")!.checked_in_at, "string");
});

Deno.test("unknown token returns not_found", async () => {
  const { rpc } = await newDb();
  assertEquals(await rpc("check_in_ticket", { p_token: "nope" }), { result: "not_found" });
  assertEquals(await rpc("get_ticket", { p_token: "nope" }), null);
});

Deno.test("search matches holder and buyer, treats % and _ literally, ignores under 2 chars", async () => {
  const { rpc } = await newDb();
  await rpc("record_paid_order", orderArgs({
    p_buyer_name: "Jane Doe",
    p_with_guest: true,
    p_guest_name: "Sam Guest",
    p_guest_token: "g2",
    p_amount_total: 4000,
  }));
  type Match = { holder_name: string | null; buyer_name: string; kind: string };

  const byGuest = await rpc("search_tickets", { p_query: "sam" }) as Match[];
  assertEquals(byGuest.map((m) => m.holder_name), ["Sam Guest"]);
  const byBuyer = await rpc("search_tickets", { p_query: "doe" }) as Match[];
  assertEquals(byBuyer.map((m) => m.kind).sort(), ["classmate", "guest"]);
  assertEquals(await rpc("search_tickets", { p_query: "%%" }), []);
  assertEquals(await rpc("search_tickets", { p_query: "J_ne" }), []);
  assertEquals(await rpc("search_tickets", { p_query: "j" }), []);
});

Deno.test("anon cannot read tables or execute functions", async () => {
  const { db } = await newDb();
  await db.exec("set role anon");
  await assertRejects(() => db.query("select * from orders"));
  await assertRejects(() => db.query("select * from tickets"));
  await assertRejects(() => db.query("select public_guest_list()"));
  await assertRejects(() => db.query("select check_in_ticket('x')"));
});

Deno.test("service role can execute functions", async () => {
  const { db } = await newDb();
  await db.exec("set role service_role");
  const { rows } = await db.query<{ r: unknown }>("select public_guest_list() as r");
  assertEquals(rows[0].r, []);
});

Deno.test("door auth blocks after 20 failures", async () => {
  const { rpc } = await newDb();
  for (let i = 0; i < 19; i++) await rpc("door_auth_failed", { p_ip: "1.2.3.4" });
  assertEquals(await rpc("door_auth_allowed", { p_ip: "1.2.3.4" }), true);
  await rpc("door_auth_failed", { p_ip: "1.2.3.4" });
  assertEquals(await rpc("door_auth_allowed", { p_ip: "1.2.3.4" }), false);
  assertEquals(await rpc("door_auth_allowed", { p_ip: "5.6.7.8" }), true);
});
