import { assert, assertEquals } from "@std/assert";

const FUNCTIONS = ["create-checkout", "stripe-webhook", "guest-list", "ticket", "door", "signatures"];

Deno.test("every function serves unconditionally on Supabase's runtime", async () => {
  for (const name of FUNCTIONS) {
    const source = await Deno.readTextFile(new URL(`../functions/${name}/index.ts`, import.meta.url));
    assert(source.includes("Deno.serve"), `${name} serves`);
    assertEquals(source.includes("import.meta.main"), false, `${name} has no main guard`);
  }
});
