import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { newDb } from "./helpers.ts";
import { createStore } from "../functions/_shared/store.ts";
import { handleSignatures } from "../functions/signatures/handler.ts";

const SITE = "https://debakey2016reunion.com";
const URL_ = "https://fn.test/signatures";

async function setup() {
  const { db, rpc } = await newDb();
  return { db, deps: { store: createStore(rpc), siteUrl: SITE } };
}

const get = () => new Request(URL_, { headers: { origin: SITE } });
const post = (body: unknown, ip = "1.1.1.1") =>
  new Request(URL_, {
    method: "POST",
    headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

Deno.test("lists signatures newest first with only public fields", async () => {
  const { db, deps } = await setup();
  await handleSignatures(post({ name: "A", message: "one" }), deps);
  await db.exec("update signatures set created_at = now() - interval '1 minute'");
  await handleSignatures(post({ name: "B", message: "two" }), deps);

  const res = await handleSignatures(get(), deps);
  const text = await res.text();
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertEquals(res.headers.get("access-control-allow-origin"), SITE);
  assertEquals(text.includes("ip"), false);
  const { signatures } = JSON.parse(text);
  assertEquals(signatures.map((s: { name: string }) => s.name), ["B", "A"]);
  assertEquals(Object.keys(signatures[0]).sort(), ["created_at", "message", "name"]);
});

Deno.test("adds a trimmed signature", async () => {
  const { deps } = await setup();
  const res = await handleSignatures(post({ name: "  Jane  ", message: "  hi  " }), deps);
  assertEquals(res.status, 201);
  const { signature } = await res.json();
  assertEquals(signature.name, "Jane");
  assertEquals(signature.message, "hi");
  assert(signature.created_at);
});

Deno.test("message is optional", async () => {
  const { deps } = await setup();
  const res = await handleSignatures(post({ name: "Jane" }), deps);
  assertEquals(res.status, 201);
  assertEquals((await res.json()).signature.message, "");
});

Deno.test("rejects bad input", async () => {
  const { db, deps } = await setup();
  const bad = [
    { name: "" },
    { name: "   " },
    { name: "x".repeat(61) },
    { name: "Jane", message: "x".repeat(281) },
    { name: 5 },
    { name: "Jane", message: 5 },
    "not json",
  ];
  for (const body of bad) {
    const res = await handleSignatures(post(body), deps);
    assertEquals(res.status, 400, JSON.stringify(body));
    assert((await res.json()).error);
  }
  const { rows } = await db.query("select * from signatures");
  assertEquals(rows.length, 0);

  const ok = await handleSignatures(post({ name: "x".repeat(60), message: "x".repeat(280) }), deps);
  assertEquals(ok.status, 201);
});

Deno.test("rate limits after five per hour per ip", async () => {
  const { deps } = await setup();
  for (let i = 0; i < 5; i++) {
    assertEquals((await handleSignatures(post({ name: `N${i}` }), deps)).status, 201);
  }
  const limited = await handleSignatures(post({ name: "N5" }), deps);
  assertEquals(limited.status, 429);
  assertEquals((await limited.json()).error, "Too many signatures. Try again later.");
  assertEquals((await handleSignatures(post({ name: "Other" }, "2.2.2.2"), deps)).status, 201);
});

Deno.test("stores a hash, not the ip", async () => {
  const { db, deps } = await setup();
  await handleSignatures(post({ name: "Jane" }), deps);
  const { rows } = await db.query<{ ip_hash: string }>("select ip_hash from signatures");
  assertNotEquals(rows[0].ip_hash, "1.1.1.1");
  assertEquals(rows[0].ip_hash.length, 64);
});

Deno.test("OPTIONS 204, other methods 405", async () => {
  const { deps } = await setup();
  const options = await handleSignatures(new Request(URL_, { method: "OPTIONS", headers: { origin: SITE } }), deps);
  assertEquals(options.status, 204);
  assertEquals(options.headers.get("access-control-allow-origin"), SITE);
  assertEquals((await handleSignatures(new Request(URL_, { method: "DELETE" }), deps)).status, 405);
});
