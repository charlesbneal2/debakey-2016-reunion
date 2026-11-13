import { corsHeaders, json } from "../_shared/http.ts";
import type { Store } from "../_shared/store.ts";

const SIZES = [16, 24, 36, 54, 80];

const isFraction = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

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

  let body: { message?: unknown; x?: unknown; y?: unknown; size?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400, cors);
  }
  const { x, y, size } = body ?? {};
  if (typeof body?.message !== "string" || !isFraction(x) || !isFraction(y) || !SIZES.includes(size as number)) {
    return json({ error: "Invalid request." }, 400, cors);
  }
  const message = body.message.trim();
  if (message.length < 1 || message.length > 280) {
    return json({ error: "Message must be 1 to 280 characters." }, 400, cors);
  }

  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    const input = { message, x, y, size: size as number };
    const signature = await deps.store.addSignature(input, await sha256Hex(ip));
    if (!signature) return json({ error: "Too many signatures. Try again later." }, 429, cors);
    return json({ signature }, 201, cors);
  } catch (error) {
    console.error("Add signature failed", error);
    return json({ error: "Could not save your signature." }, 500, cors);
  }
}
