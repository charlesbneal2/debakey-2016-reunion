import { corsHeaders, json } from "../_shared/http.ts";
import { liveStore } from "../_shared/live_store.ts";
import type { Store } from "../_shared/store.ts";

export async function handleGuestList(req: Request, deps: { store: Store; siteUrl: string }): Promise<Response> {
  const cors = corsHeaders(req.headers.get("origin"), deps.siteUrl);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405, cors);

  try {
    const guests = await deps.store.publicGuestList();
    return json({ guests }, 200, { ...cors, "cache-control": "public, max-age=60" });
  } catch (error) {
    console.error("Guest list failed", error);
    return json({ error: "Could not load the list." }, 500, cors);
  }
}

if (import.meta.main) {
  const deps = { store: liveStore(), siteUrl: Deno.env.get("SITE_URL")! };
  Deno.serve((req) => handleGuestList(req, deps));
}
