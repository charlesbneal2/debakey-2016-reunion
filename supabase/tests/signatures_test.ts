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

const sig = (overrides: Record<string, unknown> = {}) => ({ message: "Hi", x: 0.5, y: 0.5, size: 24, ...overrides });
const get = () => new Request(URL_, { headers: { origin: SITE } });
const post = (body: unknown, ip = "1.1.1.1") =>
  new Request(URL_, {
    method: "POST",
    headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

Deno.test("lists signatures newest first with only public fields", async () => {
  const { db, deps } = await setup();
  await handleSignatures(post(sig({ message: "A" })), deps);
  await db.exec("update signatures set created_at = now() - interval '1 minute'");
  await handleSignatures(post(sig({ message: "B" })), deps);

  const res = await handleSignatures(get(), deps);
  const text = await res.text();
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertEquals(res.headers.get("access-control-allow-origin"), SITE);
  assertEquals(text.includes("ip"), false);
  const { signatures } = JSON.parse(text);
  assertEquals(signatures.map((s: { message: string }) => s.message), ["B", "A"]);
  assertEquals(Object.keys(signatures[0]).sort(), ["created_at", "message", "size", "x", "y"]);
});

Deno.test("adds a trimmed signature with position and size", async () => {
  const { deps } = await setup();
  const res = await handleSignatures(post({ message: "  HAGS – Jane  ", x: 0.25, y: 0.5, size: 36 }), deps);
  assertEquals(res.status, 201);
  const { signature } = await res.json();
  assertEquals(
    { message: signature.message, x: signature.x, y: signature.y, size: signature.size },
    { message: "HAGS – Jane", x: 0.25, y: 0.5, size: 36 },
  );
  assert(signature.created_at);
});

Deno.test("rejects bad input", async () => {
  const { db, deps } = await setup();
  const bad: unknown[] = [
    {},
    sig({ message: "" }),
    sig({ message: "   " }),
    sig({ message: "x".repeat(281) }),
    sig({ message: 5 }),
    "not json",
  ];
  for (const axis of ["x", "y"]) {
    for (const value of [-0.01, 1.01, "0.5", null, undefined]) bad.push(sig({ [axis]: value }));
  }
  for (const value of [20, "24", undefined]) bad.push(sig({ size: value }));

  for (const body of bad) {
    const res = await handleSignatures(post(body), deps);
    assertEquals(res.status, 400, JSON.stringify(body));
    assert((await res.json()).error);
  }
  const { rows } = await db.query("select * from signatures");
  assertEquals(rows.length, 0);

  assertEquals((await handleSignatures(post({ message: "x".repeat(280), x: 0, y: 1, size: 80 }), deps)).status, 201);
  assertEquals((await handleSignatures(post({ message: "y", x: 1, y: 0, size: 16 }), deps)).status, 201);
});

Deno.test("name field is ignored", async () => {
  const { deps } = await setup();
  const res = await handleSignatures(post(sig({ name: "Bob" })), deps);
  assertEquals(res.status, 201);
  assertEquals("name" in (await res.json()).signature, false);
});

Deno.test("rate limits after five per hour per ip", async () => {
  const { deps } = await setup();
  for (let i = 0; i < 5; i++) {
    assertEquals((await handleSignatures(post(sig({ message: `N${i}` })), deps)).status, 201);
  }
  const limited = await handleSignatures(post(sig()), deps);
  assertEquals(limited.status, 429);
  assertEquals((await limited.json()).error, "Too many signatures. Try again later.");
  assertEquals((await handleSignatures(post(sig(), "2.2.2.2"), deps)).status, 201);
});

Deno.test("stores a hash, not the ip", async () => {
  const { db, deps } = await setup();
  await handleSignatures(post(sig()), deps);
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
