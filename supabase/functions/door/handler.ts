import { corsHeaders, json } from "../_shared/http.ts";
import type { Store } from "../_shared/store.ts";
import { ticketLabel } from "../_shared/tickets.ts";

export function extractToken(scanned: string): string {
  const text = scanned.trim();
  if (!/^https?:/i.test(text)) return text;
  try {
    return new URL(text).searchParams.get("t") ?? "";
  } catch {
    return "";
  }
}

async function passwordMatches(given: string, expected: string): Promise<boolean> {
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  return a.reduce((diff, byte, i) => diff | (byte ^ b[i]), 0) === 0;
}

export async function handleDoor(
  req: Request,
  deps: { store: Store; siteUrl: string; doorPassword: string },
): Promise<Response> {
  const cors = corsHeaders(req.headers.get("origin"), deps.siteUrl);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, cors);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (typeof body !== "object" || body === null) throw new Error("not an object");
  } catch {
    return json({ error: "Bad request." }, 400, cors);
  }

  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    if (!(await deps.store.doorAuthAllowed(ip))) {
      return json({ error: "Too many attempts. Wait 15 minutes." }, 429, cors);
    }
    const password = typeof body.password === "string" ? body.password : "";
    if (!(await passwordMatches(password, deps.doorPassword))) {
      await deps.store.doorAuthFailed(ip);
      return json({ error: "Wrong password." }, 401, cors);
    }

    switch (body.action) {
      case "login":
        return json({ ok: true }, 200, cors);
      case "scan": {
        const token = typeof body.scanned === "string" ? extractToken(body.scanned) : "";
        if (!token) return json({ result: "not_found" }, 200, cors);
        const checkIn = await deps.store.checkInTicket(token);
        if (checkIn.result === "not_found") return json({ result: "not_found" }, 200, cors);
        return json(
          {
            result: checkIn.result,
            label: ticketLabel({
              holder_name: checkIn.holder_name ?? null,
              kind: checkIn.kind!,
              buyer_name: checkIn.buyer_name!,
            }),
            kind: checkIn.kind,
            checked_in_at: checkIn.checked_in_at,
          },
          200,
          cors,
        );
      }
      case "search": {
        const query = typeof body.query === "string" ? body.query : "";
        const matches = await deps.store.searchTickets(query);
        return json(
          {
            matches: matches.map((m) => ({
              token: m.token,
              label: ticketLabel(m),
              kind: m.kind,
              voided: m.voided,
              checked_in_at: m.checked_in_at,
            })),
          },
          200,
          cors,
        );
      }
      default:
        return json({ error: "Bad request." }, 400, cors);
    }
  } catch (error) {
    console.error("Door request failed", error);
    return json({ error: "Something went wrong. Try again or use the printed list." }, 500, cors);
  }
}
