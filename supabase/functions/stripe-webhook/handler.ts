import Stripe from "npm:stripe@17";
import { json } from "../_shared/http.ts";
import type { Store } from "../_shared/store.ts";
import { buildTicketEmail, newToken, type TicketEmail } from "../_shared/tickets.ts";

type Deps = {
  store: Store;
  siteUrl: string;
  sendEmail(to: string, email: TicketEmail): Promise<void>;
};

export function verifyEvent(rawBody: string, signature: string, secret: string, stripe: Stripe) {
  return stripe.webhooks.constructEventAsync(
    rawBody,
    signature,
    secret,
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
}

// deno-lint-ignore no-explicit-any
async function issueTickets(session: any, deps: Deps) {
  const metadata = session.metadata ?? {};
  const withGuest = metadata.with_guest === "true";
  const order = await deps.store.recordPaidOrder({
    sessionId: session.id,
    paymentIntent: session.payment_intent ?? null,
    buyerName: metadata.name || session.customer_details?.name || "Unknown",
    email: session.customer_details.email,
    guestName: metadata.guest_name ?? "",
    withGuest,
    showOnList: metadata.show_on_list === "true",
    amountTotal: session.amount_total,
    classmateToken: newToken(),
    guestToken: withGuest ? newToken() : null,
  });

  if (order.status === "refunded" || order.email_sent_at) return;
  // ponytail: parallel duplicate delivery can send a harmless second email; tokens are identical
  await deps.sendEmail(order.email, await buildTicketEmail(order, deps.siteUrl));
  await deps.store.markOrderEmailed(order.id);
}

export async function handleStripeEvent(
  // deno-lint-ignore no-explicit-any
  event: { type: string; data: { object: any } },
  deps: Deps,
): Promise<Response> {
  const object = event.data.object;
  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        if (object.payment_status === "paid") await issueTickets(object, deps);
        break;
      case "charge.refunded":
        if (object.refunded && !(await deps.store.markOrderRefunded(object.payment_intent))) {
          // The order may not be recorded yet; a failure makes Stripe retry.
          return json({ error: "Order not found." }, 500);
        }
        break;
    }
    return json({ received: true }, 200);
  } catch (error) {
    console.error(`Failed to process ${event.type}`, error);
    return json({ error: "Processing failed." }, 500);
  }
}
