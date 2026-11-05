import { corsHeaders, json } from "../_shared/http.ts";
import { liveStore } from "../_shared/live_store.ts";
import type { Store } from "../_shared/store.ts";
import { qrPngBase64, ticketLabel, ticketUrl } from "../_shared/tickets.ts";

export async function handleTicket(req: Request, deps: { store: Store; siteUrl: string }): Promise<Response> {
  const cors = corsHeaders(req.headers.get("origin"), deps.siteUrl);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405, cors);

  const token = new URL(req.url).searchParams.get("t") ?? "";
  try {
    const ticket = token ? await deps.store.getTicket(token) : null;
    if (!ticket) return json({ error: "Ticket not found." }, 404, cors);
    return json(
      {
        label: ticketLabel(ticket),
        kind: ticket.kind,
        voided: ticket.voided,
        qr_png_base64: await qrPngBase64(ticketUrl(deps.siteUrl, token)),
      },
      200,
      cors,
    );
  } catch (error) {
    console.error("Ticket lookup failed", error);
    return json({ error: "Could not load the ticket." }, 500, cors);
  }
}

if (import.meta.main) {
  const deps = { store: liveStore(), siteUrl: Deno.env.get("SITE_URL")! };
  Deno.serve((req) => handleTicket(req, deps));
}
