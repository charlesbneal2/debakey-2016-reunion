import Stripe from "npm:stripe@17";
import { handleCheckout } from "./handler.ts";

if (import.meta.main) {
  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    httpClient: Stripe.createFetchHttpClient(),
  });
  const price = Deno.env.get("STRIPE_PRICE_ID")!;

  Deno.serve((req) =>
    handleCheckout(req, {
      now: () => new Date(),
      siteUrl: Deno.env.get("SITE_URL")!,
      createSession: async ({ quantity, successUrl, cancelUrl, metadata }) => {
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          line_items: [{ price, quantity }],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata,
        });
        return { url: session.url! };
      },
    })
  );
}
