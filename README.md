# DeBakey Class of 2016 Ten-Year Reunion

Site and ticketing for the reunion on November 28, 2026 at Eureka Heights Brewery in Houston.

- `site/`: static pages, deployed to GitHub Pages at debakey2016reunion.com
- `supabase/`: database and edge functions for checkout, tickets, and door check-in
- `docs/stripe-setup.md`: first-time Stripe setup
- `docs/launch-runbook.md`: deployment, rehearsal, event night, and fixes

## Tests

```bash
deno task test                                   # backend, no accounts or Docker needed
(cd tests && npm install) && node tests/layout.mjs   # browser checks
```

Browser checks need Chromium (`npx playwright install --with-deps chromium`).

## Adding yearbook content

Open `site/index.html`, uncomment and copy the slots in the `#yearbook` section, and remove its `hidden` attribute.
