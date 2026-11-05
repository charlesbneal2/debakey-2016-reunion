# Launch Runbook

Do these in order. Stripe details are in `docs/stripe-setup.md`; do its steps 1-5 when step 3 below tells you to.

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com). Save the database password. Copy the **project reference**, which is the `abcd1234` part of `https://abcd1234.supabase.co`.
2. From the project folder:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push --remote
   ```

3. Put the reference into `site/config.js`, replacing `PROJECT_REF`, then commit.
4. Confirm the project's API settings still offer a `service_role` key, since the functions rely on `SUPABASE_SERVICE_ROLE_KEY`.

## 2. Resend (ticket email)

1. Create an account at [resend.com](https://resend.com).
2. Add domain `debakey2016reunion.com` under **Domains**. Resend shows DNS records.
3. In Porkbun, open the domain's **DNS Records** and add each record exactly as Resend shows it. Porkbun adds the domain itself, so enter only the part before `.debakey2016reunion.com` in the host field.
4. Click **Verify** in Resend and wait for it to pass.
5. Create an API key with sending access.

## 3. Secrets and functions

First do `docs/stripe-setup.md` steps 1-5 to get your Stripe values.

Generate the door password with `openssl rand -hex 8`. Send it to door staff privately so they can paste it. Don't use a short or guessable password, because it unlocks every ticket.

```bash
npx supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  STRIPE_PRICE_ID=price_... \
  RESEND_API_KEY=re_... \
  DOOR_PASSWORD='YOUR_GENERATED_PASSWORD' \
  REPLY_TO_EMAIL=you@example.com \
  SITE_URL=https://debakey2016reunion.com

npx supabase functions deploy --use-api
npx supabase functions list
```

The list must show `create-checkout`, `stripe-webhook`, `guest-list`, `ticket`, and `door`.

Smoke test before going further. This must print `{"guests":[]}`:

```bash
curl https://YOUR_PROJECT_REF.supabase.co/functions/v1/guest-list
```

## 4. GitHub Pages and domain

1. On a free GitHub plan, Pages needs a public repo, so check that no secrets are committed.
2. In the repo, open **Settings > Pages** and set **Source** to **GitHub Actions**.
3. Merge the site to `master`. Check the **Actions** tab shows **Deploy site** passing; if not, run it from there.
4. Under **Custom domain**, enter `debakey2016reunion.com` and save.
5. In Porkbun DNS, delete any default parking records for the apex and `www`, then add:

   | Type | Host | Answer |
   | --- | --- | --- |
   | A | (blank) | `185.199.108.153` |
   | A | (blank) | `185.199.109.153` |
   | A | (blank) | `185.199.110.153` |
   | A | (blank) | `185.199.111.153` |
   | CNAME | `www` | `charlesbneal2.github.io` |

6. When the DNS check passes, turn on **Enforce HTTPS**. The certificate can take a little while.
7. Run the **Keep Supabase awake** workflow once from the **Actions** tab and confirm it passes.

The page is now public, but it only takes test cards until you switch Stripe to live. Don't share the link yet.

## 5. Rehearse with test keys

Phone camera scanning needs HTTPS, so run this against the deployed site. Every item must pass.

- [ ] Buy **Me + guest** with card `4242 4242 4242 4242`, using an inbox you can check, with the name on the list.
- [ ] Thanks page appears; one email arrives with **two** QR codes.
- [ ] QR codes display in Gmail and iPhone Mail. Links open each ticket page.
- [ ] Your name appears under Who's coming with `+1`, after up to a minute.
- [ ] In Stripe, open the `checkout.session.completed` event and click **Resend**. No second email; no new tickets.
- [ ] Open `https://debakey2016reunion.com/door` on a phone, then allow the camera.
- [ ] Scan both codes: green, showing the right names.
- [ ] Scan one again: red, "Already checked in".
- [ ] Find a ticket with name search.
- [ ] Refund the payment in full in Stripe. Your name leaves the list, and scanning shows "Refunded or voided".
- [ ] Try a declined card: `4000 0000 0000 9995`. No tickets or email.
- [ ] Buy **Just me** with a name containing HTML and emoji, such as `<b>Jo</b> 🎉`. It displays literally in the email, list, and door.
- [ ] Practice the mistyped-email fix below. The same QR codes arrive at the new address.
- [ ] Send a forged door request, then check **Edge Functions > door > Logs** or `door_failures` to see which IP was recorded. If the forged value was recorded, password limiting can be bypassed, so fix that before launch:

  ```bash
  curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/door \
    -H 'x-forwarded-for: 203.0.113.99' -d '{"password":"wrong","action":"login"}'
  ```

## 6. Before opening sales

- [ ] Final event time, in `site/index.html`, `site/thanks.html`, `site/ticket.html`, and `supabase/functions/_shared/tickets.ts`
- [ ] Sales closing time, if the end time changes, in `site/app.js` and `supabase/functions/_shared/rules.ts`
- [ ] Confirm the ticket covers entry only
- [ ] Venue address and map link, in the same files as the time
- [ ] Clean logo file, if available
- [ ] Yearbook material, if ready
- [ ] Commit and push site changes, then run `npx supabase functions deploy --use-api` so ticket emails and sales closing match the site. Pushing updates only the site, never the functions.
- [ ] Clear test data in the Supabase SQL editor. **This permanently deletes every order and ticket, so run it only before real sales begin:**

  ```sql
  truncate orders, door_failures cascade;
  ```

- [ ] Switch to live Stripe keys, price, and webhook secret (`docs/stripe-setup.md`, step 8)
- [ ] Buy one real $20 ticket, get the email, scan it, then refund it in full
- [ ] Check the link preview by sending the URL to yourself in a chat
- [ ] Share the link with the class

## Event night

1. **Print a backup list that afternoon, and again right before doors.** In the Supabase SQL editor, run this and download the CSV:

   ```sql
   select coalesce(t.holder_name, 'Guest of ' || o.buyer_name) as name,
          o.buyer_name as purchased_by,
          t.kind,
          t.checked_in_at
   from tickets t
   join orders o on o.id = t.order_id
   where t.voided_at is null
   order by name;
   ```

2. Send door staff `https://debakey2016reunion.com/door` and the password. Have them test it before doors open.
3. If signal fails, check people against the printed list by name. The site won't record those check-ins.
4. Sales close automatically at 10 PM Central.

## Fixing problems

Run SQL in the Supabase **SQL editor**.

### Someone mistyped their email, or never got it

1. Find the order:

   ```sql
   select id, buyer_name, email, email_sent_at, stripe_session_id from orders where buyer_name ilike '%name%';
   ```

2. Correct the address and clear the sent marker:

   ```sql
   update orders set email = 'correct@example.com', email_sent_at = null where id = 'ORDER_ID';
   ```

3. In Stripe, open that payment's `checkout.session.completed` event and click **Resend**. The dashboard allows this for 15 days after the event. After that, use `stripe events resend EVENT_ID --webhook-endpoint=ENDPOINT_ID`, which works for 30 days.

The same QR codes go to the new address.

### Void one ticket, such as after a partial refund

```sql
update tickets set voided_at = now()
where kind = 'guest'
  and order_id = (select id from orders where stripe_payment_intent = 'pi_...');
```

### Remove a name from Who's coming

```sql
update orders set show_on_list = false where id = 'ORDER_ID';
```

### Someone paid but has no order

Open the webhook in Stripe Workbench and check **Event deliveries** for errors. Check logs under **Edge Functions > stripe-webhook** in Supabase. After fixing the cause, click **Resend** on the event. The order and tickets will be created without any double charge.

### Change the door password

```bash
npx supabase secrets set DOOR_PASSWORD='new-password'
```

Staff then log in again.

### Door says "Too many attempts"

Wait 15 minutes, or clear the failures:

```sql
delete from door_failures;
```

## After the reunion

Delete `.github/workflows/keep-awake.yml`. Then export anything you want to keep and delete the Supabase project, which removes buyer names and emails.
