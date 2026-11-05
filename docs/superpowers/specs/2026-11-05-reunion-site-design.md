# DeBakey Class of 2016 Reunion Site: Design

Date: 2026-11-05. Event: Saturday, November 28, 2026 (23 days out).

## Intent

Classmates get a link in a group chat. Within ten seconds they should feel nostalgia for high school and know when the reunion is, where it is, who to contact, and how to buy a ticket. Buying should be quick, and the person at the door should be able to trust who has paid.

## Goals

- Beautiful, responsive one-page site in classic DeBakey blue and white, with the school seal.
- Sell tickets through Stripe at $20 each. A +1 is a second ticket, so $40 total.
- Email each person their own QR ticket.
- Check people in at the door by scanning, with name lookup as backup.
- Show an opt-in "who's coming" list to encourage sign-ups.
- Leave easy places to add yearbook material later.

## Non-goals

- Accounts or logins for buyers.
- Verifying that a buyer really is a classmate. Sales run on the honor system.
- Self-service refunds or ticket transfers.
- More than one guest per classmate.
- Admin dashboard. Stripe and Supabase dashboards cover this.
- A live "tickets left" count or a sales cap. The user has ruled out a capacity concern.

## Anti-goals

These count as failure even if the site otherwise works:

- Someone pays and has no ticket, or nobody can find their purchase at the door.
- Someone is charged twice, or gets duplicate valid tickets from one payment.
- A broken QR scanner or bad venue signal stops people getting in.
- Buyer emails or private details are publicly readable.
- The page feels like a generic event template.

## Constraints

- Static hosting on GitHub Pages (public repo, so no secrets in it) at `debakey2016reunion.com`. Domain is bought at Porkbun.
- Server code runs only in Supabase edge functions.
- Free tiers where possible. Supabase free projects pause when inactive, so a scheduled GitHub Action pings the project through the event.
- Must work well on phones first, since the link arrives in a group chat.

## Decided by the user

- Look: **Yearbook Cover**, mockup A. Deep navy, thin foil-style double border, classic serif, seal centered, white Get Tickets button.
- Stack: GitHub Pages, Supabase edge functions, Stripe.
- Contact: Mourad Berrached, 832-860-7467 (public on the page; confirm Mourad agrees before launch).
- Price: $20 per ticket; +1 costs $40 total.
- Door: QR tickets with a scanner page; opt-in who's coming list.
- A step-by-step Stripe setup guide is a required deliverable, since the user has not set Stripe up yet.

## Decided by Claude (approved in scope review or open to correction)

- Stripe-hosted Checkout, created by an edge function. Card data never touches our code.
- Resend for email, with `debakey2016reunion.com` verified for sending.
- One guest maximum per order.
- Sales close automatically at 10 PM Central on November 28, 2026.
- Refunds are done by hand in the Stripe dashboard.
- Buyers pay exactly $20 per ticket. Stripe's fee comes out of the organizers' proceeds, not added at checkout.
- Tickets send from `tickets@debakey2016reunion.com`. Replies go to an organizer inbox set during launch.

## Page

One page, in this order:

1. **Cover.** Seal, "The Ten-Year Reunion", school name, date, time, venue, Get Tickets button, contact line. All visible without scrolling on a phone.
2. **Yearbook.** Styled like a yearbook spread, with slots for photos, quotes, and memories. Content lives in an HTML block with comments marking each slot. Empty slots do not render, so the section is hidden until content exists.
3. **Who's coming.** Opt-in names, as "Jane Doe" or "Jane Doe +1". Classmates only; guest names never appear.
4. **Tickets.** Choose "Just me, $20" or "Me + guest, $40"; your name (required); guest name (optional); "Show my name on the list" (off by default). Continue goes to Stripe, which collects email and card.
5. **Questions.** Mourad's name with a tap-to-call link, a note that the ticket covers entry, and a map link for the venue.

After Stripe, buyers land on a thank-you page saying tickets are on their way, and to contact Mourad if nothing arrives within 15 minutes. Cancel returns to the tickets section.

Accessibility basics apply: real form labels, keyboard use, adequate contrast, reduced-motion support, and alt text on the seal.

Plain HTML, CSS, and a small amount of JS. No framework or build step.

## Tickets and payment flow

1. The site posts `{ name, guest_name, with_guest, show_on_list }` to the `create-checkout` edge function.
2. The function validates input (length limits, required name), rejects sales after closing, and creates a Checkout Session. Price and quantity come from the server, using a Stripe Price ID in a secret and quantity 1 or 2. The form details travel in session metadata.
3. Stripe collects payment, then sends `checkout.session.completed` to the `stripe-webhook` function.
4. The webhook verifies Stripe's signature and confirms the session is paid. In one transaction it creates the order and one ticket per person. The unique `stripe_session_id` means a Stripe retry cannot create a second order.
5. The webhook then sends the email and records `email_sent_at`. If sending fails, it returns an error so Stripe retries. Retries skip order creation and send only if `email_sent_at` is still empty.
6. `charge.refunded` with a full refund marks the order refunded. That voids its tickets and removes the name from the list. For a partial refund of one ticket, the organizer voids that ticket in the Supabase dashboard (documented in the runbook).

## Email

One email to the buyer. It contains event details and one QR code per ticket, labeled with the holder's name or "Guest of [name]", and is sent as inline CID attachments, since many mail clients block data URLs. Each QR also has a link to a simple ticket page (`/ticket?t=<token>`) as a fallback and so the buyer can forward the guest's ticket. The Stripe receipt is separate and also enabled.

## Data

All tables have row-level security on and no policies for anonymous users. Edge functions use the service role.

- `orders`: `id`, `stripe_session_id` (unique), `buyer_name`, `email`, `guest_name`, `show_on_list`, `amount_total`, `status` (`paid` or `refunded`), `email_sent_at`, `created_at`.
- `tickets`: `id`, `order_id`, `token` (unique, random, at least 128 bits), `holder_name`, `kind` (`classmate` or `guest`), `voided_at`, `checked_in_at`.

Public access goes through edge functions that return only what is needed. `guest-list` returns display name and +1 for paid, opted-in orders. `ticket` returns holder name and kind for a valid token.

## Door check-in

A `/door` page, not linked from the site and marked `noindex`.

- A shared door password is checked by the edge function, never in the browser. Failed attempts are rate limited.
- Camera scanning uses a small scanner library, since `BarcodeDetector` is missing from iOS Safari.
- Check-in uses one atomic update (`set checked_in_at where it is null and not voided`), so two scanners cannot admit the same ticket twice.
- Results are large and unmistakable: green with name and label, or red with "Already checked in at 7:42 PM", "Refunded", or "Not found".
- Name search finds tickets by holder or buyer name and allows manual check-in.
- Offline backup: the runbook covers exporting a CSV door list from Supabase on event day, to print or save.

## Security

- Secrets live only in Supabase: Stripe secret key, webhook signing secret, Resend key, door password.
- The public site uses no Supabase table access.
- CORS on browser-called functions allows only the production domain plus localhost for development.
- Escape all user-entered names when rendering them on the page or in email.

## Testing and launch

- One small automated check covers the money path: duplicate webhook delivery creates one order, a +1 creates two tickets, a bad signature is rejected, a failed email retries without duplicating, and sale closing and double check-in behave correctly.
- Full end-to-end in Stripe test mode using the Stripe CLI, including a real email and a phone scan.
- Layout checked at phone and desktop widths.
- Before opening sales: one real $20 purchase in live mode, scanned, then refunded.

## Deliverables

- The site, edge functions, database migration, and keep-awake GitHub Action.
- `docs/stripe-setup.md`: step-by-step for a first-time Stripe user. Account and bank verification, business details, branding, product and $20 price, test then live keys, webhook, receipts, and how refunds work. Warns that verification and first payouts can take days, so start now.
- `docs/launch-runbook.md`: Supabase, Resend, GitHub Pages, and Porkbun DNS setup; going live; event-night procedure; refunds and voids; resending a ticket; removing a name from the list.

## Left to the builder

Exact visual details within the Yearbook Cover direction, library choices for QR generation and scanning, file layout, and rate-limit method.

## Open items

Placeholders can go in now; each needs a real answer before launch.

- Final event times. 7-10 PM is tentative.
- Confirm that $20 covers entry only.
- Mourad's agreement to public phone number.
- Venue address for Bad Astronaut.
- A clean logo file. The current image has a textured background and a shadow, so the mockup crops it to a circle.
- Yearbook material.
