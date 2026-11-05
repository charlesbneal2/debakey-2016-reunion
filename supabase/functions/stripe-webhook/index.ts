import Stripe from "stripe";
import { json } from "../_shared/http.ts";
import { liveStore } from "../_shared/live_store.ts";
import type { TicketEmail } from "../_shared/tickets.ts";
import { handleStripeEvent } from "./handler.ts";

export function verifyEvent(rawBody: string, signature: string, secret: string, stripe: Stripe) {
  return stripe.webhooks.constructEventAsync(
    rawBody,
    signature,
    secret,
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
}

async function sendEmail(to: string, email: TicketEmail) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: "DeBakey Reunion <tickets@debakey2016reunion.com>",
      to,
      reply_to: Deno.env.get("REPLY_TO_EMAIL"),
      ...email,
    }),
  });
  if (!response.ok) throw new Error(`Resend returned ${response.status}: ${await response.text()}`);
}

if (import.meta.main) {
  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    httpClient: Stripe.createFetchHttpClient(),
  });
  const store = liveStore();

  Deno.serve(async (req) => {
    const rawBody = await req.text();
    let event;
    try {
      event = await verifyEvent(
        rawBody,
        req.headers.get("stripe-signature") ?? "",
        Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
        stripe,
      );
    } catch {
      return json({ error: "Invalid signature." }, 400);
    }
    return handleStripeEvent(event, { store, siteUrl: Deno.env.get("SITE_URL")!, sendEmail });
  });
}
