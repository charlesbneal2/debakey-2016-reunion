import Stripe from "npm:stripe@17";
import { json } from "../_shared/http.ts";
import { liveStore } from "../_shared/live_store.ts";
import { sendEmail } from "../_shared/email.ts";
import { handleStripeEvent, verifyEvent } from "./handler.ts";

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
