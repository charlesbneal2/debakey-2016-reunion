import { corsHeaders, json } from "../_shared/http.ts";
import { parseOrderForm, SALES_CLOSE } from "../_shared/rules.ts";

export type CheckoutParams = {
  quantity: 1 | 2;
  successUrl: string;
  cancelUrl: string;
  metadata: {
    name: string;
    guest_name: string;
    with_guest: "true" | "false";
    show_on_list: "true" | "false";
  };
};

export function buildSessionParams(params: CheckoutParams, price: string) {
  const { guest_name, ...metadata } = params.metadata;
  return {
    mode: "payment" as const,
    // Cards only: delayed bank payments could leave a buyer without a ticket on event night.
    payment_method_types: ["card" as const],
    line_items: [{ price, quantity: params.quantity }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: (guest_name ? { ...metadata, guest_name } : metadata) as Record<string, string>,
  };
}

export async function handleCheckout(
  req: Request,
  deps: {
    now(): Date;
    siteUrl: string;
    createSession(params: CheckoutParams): Promise<{ url: string }>;
  },
): Promise<Response> {
  const cors = corsHeaders(req.headers.get("origin"), deps.siteUrl);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, cors);
  if (deps.now() >= SALES_CLOSE) return json({ error: "Ticket sales have closed." }, 410, cors);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Please fill out the form." }, 400, cors);
  }
  const form = parseOrderForm(body);
  if (!form.ok) return json({ error: form.error }, 400, cors);

  const { name, guestName, withGuest, showOnList } = form.value;
  try {
    const session = await deps.createSession({
      quantity: withGuest ? 2 : 1,
      successUrl: `${deps.siteUrl}/thanks`,
      cancelUrl: `${deps.siteUrl}/#tickets`,
      metadata: {
        name,
        guest_name: guestName,
        with_guest: withGuest ? "true" : "false",
        show_on_list: showOnList ? "true" : "false",
      },
    });
    return json({ url: session.url }, 200, cors);
  } catch (error) {
    console.error("Stripe session failed", error);
    return json({ error: "Could not start checkout." }, 502, cors);
  }
}
