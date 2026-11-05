import Stripe from "npm:stripe@17";
import { buildSessionParams, handleCheckout } from "./handler.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  httpClient: Stripe.createFetchHttpClient(),
});
const price = Deno.env.get("STRIPE_PRICE_ID")!;

Deno.serve((req) =>
  handleCheckout(req, {
    now: () => new Date(),
    siteUrl: Deno.env.get("SITE_URL")!,
    createSession: async (params) => {
      const session = await stripe.checkout.sessions.create(buildSessionParams(params, price));
      return { url: session.url! };
    },
  })
);
