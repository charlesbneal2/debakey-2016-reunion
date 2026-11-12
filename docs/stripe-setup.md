# Stripe Setup Guide

For first-time Stripe users. It takes about 30 minutes, plus any time Stripe needs to verify you.

> **Start now.** Identity and bank verification can take days, and your first payout can take a week or more. The reunion is November 28, 2026.

Stripe changes its dashboard labels from time to time. If a label differs from this guide, use the link beside the step.

## What you need

- Legal name, date of birth, home address, and the last four digits or full Social Security number
- A bank account for payouts
- A support email and phone number that buyers can see
- A support address and email for your receipts. The privacy policy is already on the site.

## 1. Create your account

1. Sign up at [dashboard.stripe.com/register](https://dashboard.stripe.com/register).
2. Confirm your email.
3. Start in test mode or a sandbox, using the environment switcher in the dashboard. Nothing there charges real money.

Live activation comes in step 8, so you can set up and rehearse first.

## 2. Create the ticket

Do this in test mode now. You'll repeat it in live mode in step 8.

1. Open **Product catalog** at [dashboard.stripe.com/products](https://dashboard.stripe.com/products) and click **Add product**.
2. Name it `Class of 2016 Reunion Ticket`.
3. Set **One-off** pricing, **$15.00 USD**.
4. Save, open the product, and copy the **Price ID**. It starts with `price_`, not `prod_`.

Your site asks Stripe for quantity 1 or 2, so a +1 comes to $30 automatically. Don't create a second price. The site accepts cards only, which includes Apple Pay and Google Pay where available, so tickets go out right after payment.

## 3. Copy your test API key

1. Open **API keys** at [dashboard.stripe.com/test/apikeys](https://dashboard.stripe.com/test/apikeys).
2. Copy the **Secret key**. It starts with `sk_test_`.

**Treat the secret key like a password.** Never paste it into the website, the GitHub repo, or a chat. It goes only into Supabase secrets, as shown in `docs/launch-runbook.md`.

## 4. Add branding and business details

1. **Branding:** open [Branding](https://dashboard.stripe.com/settings/branding). Upload `site/assets/seal.jpg` as both logo and icon, and set the brand color to `#12266b`.
2. **Public details:** open [Business details](https://dashboard.stripe.com/settings/business) and edit **Public details**:
   - Public business name, such as `DeBakey Class of 2016 Reunion`
   - Statement descriptor: `DEBAKEY REUNION`, which is what appears on card statements
   - Customer support email, phone, and address
   - Privacy policy URL: `https://debakey2016reunion.com/privacy`

Stripe says receipts must carry a legal business name, support address, support email, and privacy policy URL.

## 5. Add the webhook

The webhook is how Stripe tells your site that someone paid. Without it, buyers get no tickets. You need your Supabase project reference for this step, so do step 1 of `docs/launch-runbook.md` first.

1. Open [Webhooks in Workbench](https://dashboard.stripe.com/webhooks) and click **Create an event destination**.
2. Select **Your account**.
3. For payload format, choose **Snapshot**. **Stripe's form recommends Thin, but your webhook needs Snapshot and will not issue tickets with Thin.**
4. Select exactly these three events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `charge.refunded`
5. Choose **Webhook endpoint** and enter:

   ```
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook
   ```

6. On the settings page, click **Reveal secret** and copy the value starting with `whsec_`.

## 6. Give the values to Supabase

From the project folder:

```bash
npx supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  STRIPE_PRICE_ID=price_...
```

## 7. Test a purchase

Follow the rehearsal in `docs/launch-runbook.md`. Use these on the Stripe checkout page, with any future expiry date, any CVC, and any ZIP:

| Card | Result |
| --- | --- |
| `4242 4242 4242 4242` | Payment succeeds |
| `4000 0000 0000 9995` | Payment is declined |
| `4000 0025 0000 3155` | Asks for extra authentication |

Two test-mode differences to expect:

- **Stripe doesn't email receipts for test payments.** Your QR ticket email still sends, because your own system sends it.
- **Stripe retries failed webhooks only a few times over a few hours in test mode.** In live mode it retries for up to three days.

## 8. Go live

1. Click **Activate payments** or complete the prompts in the dashboard. Enter your identity details and payout bank account, then wait for approval.
2. Switch to live mode and **repeat steps 2, 3, and 5**. Products, keys, and webhooks are separate in each mode, so all three values change.
3. Update Supabase with the live values:

   ```bash
   npx supabase secrets set \
     STRIPE_SECRET_KEY=sk_live_... \
     STRIPE_WEBHOOK_SECRET=whsec_... \
     STRIPE_PRICE_ID=price_...
   ```

4. Turn on receipts: open [Customer emails](https://dashboard.stripe.com/settings/emails) and, under **Payments**, turn on **Successful payments**. Turn on **Refunds** too.

Then do the one real $15 test purchase in the runbook.

## Everyday tasks

### Refund someone

1. Open [Payments](https://dashboard.stripe.com/payments) and click the payment.
2. Click **Refund** and confirm.

| Refund | What happens |
| --- | --- |
| Full amount | Tickets are voided automatically and the name leaves the list. |
| Part of a +1 order ($15 of $30) | **Nothing changes automatically.** Void the guest ticket by hand, using the steps in the runbook. |

Refunds take several days to reach the buyer. Stripe doesn't return its original processing fee, so a refund costs you that fee. Check [Stripe's pricing page](https://stripe.com/pricing) for current rates.

### Check your money

Open [Balances](https://dashboard.stripe.com/balance). Stripe pays out to your bank on a rolling schedule. Fees come out of each sale, so a standard US card sale at 2.9% + 30¢ nets about $14.26 per $15 ticket, or about $28.83 on a $30 order.

### If a buyer disputes a charge

Stripe emails you. Respond in the dashboard before the deadline. The scan record and buyer's email in Supabase can serve as evidence.
