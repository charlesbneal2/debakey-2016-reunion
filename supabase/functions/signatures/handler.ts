import { corsHeaders, json } from "../_shared/http.ts";
import type { Store } from "../_shared/store.ts";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleSignatures(req: Request, deps: { store: Store; siteUrl: string }): Promise<Response> {
  const cors = corsHeaders(req.headers.get("origin"), deps.siteUrl);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (req.method === "GET") {
    try {
      const signatures = await deps.store.listSignatures();
      return json({ signatures }, 200, { ...cors, "cache-control": "no-store" });
    } catch (error) {
      console.error("List signatures failed", error);
      return json({ error: "Could not load signatures." }, 500, cors);
    }
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, cors);

  let body: { name?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400, cors);
  }
  const rawMessage = body?.message ?? "";
  if (typeof body?.name !== "string" || typeof rawMessage !== "string") {
    return json({ error: "Invalid request." }, 400, cors);
  }
  const name = body.name.trim();
  const message = rawMessage.trim();
  if (name.length < 1 || name.length > 60) return json({ error: "Name must be 1 to 60 characters." }, 400, cors);
  if (message.length > 280) return json({ error: "Message must be 280 characters or fewer." }, 400, cors);

  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    const signature = await deps.store.addSignature(name, message, await sha256Hex(ip));
    if (!signature) return json({ error: "Too many signatures. Try again later." }, 429, cors);
    return json({ signature }, 201, cors);
  } catch (error) {
    console.error("Add signature failed", error);
    return json({ error: "Could not save your signature." }, 500, cors);
  }
}
