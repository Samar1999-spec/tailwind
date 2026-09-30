# Method Machine Studio — Cloudflare site

Landing page, Stage 1 application, and form handling, deployed as a Cloudflare Worker
(Workers Builds, connected to this repo).

| Path | Purpose |
| --- | --- |
| `public/` | The site: `index.html`, `method.html` (The Method in full), `apply.html`, `institute.html` (The Method Institute), `404.html`, icon, manifest, `_headers` |
| `src/payments.js` | Stripe checkout, prices, webhook → `members` table |
| `src/worker.js` | Handles `POST /submit.php` (waitlist, applications, institute papers), serves everything else from `public/` |
| `wrangler.jsonc` | Worker config: static assets + D1 binding `DB` |
| `schema.sql` | Tables in the D1 database `method-machine-studio` (already created) |

## Deploys

Pushes to `main` deploy the live site at https://methodmachinestudio.com (and www). Other branches get a preview URL (Worker → Previews).

## Answer key (one-time setup)

The Stage 1 answer key is private and is **not** in this public repo. Add it as a secret:

Cloudflare dashboard → Workers & Pages → `tailwind` → Settings → Variables and Secrets →
Add → Type **Secret**, name `ANSWER_KEY`, value = the contents of `answer_key.json`
(sent separately). Save and redeploy.

Without it, applications are still saved, just not auto-scored.

## Reading submissions

Cloudflare dashboard → Storage & Databases → D1 → `method-machine-studio` → Console:

```sql
SELECT submitted_at, email FROM waitlist ORDER BY id DESC;
SELECT submitted_at, name, email, character_preferred, hard_fails, aptitude_auto FROM applications ORDER BY id DESC;
SELECT report FROM applications WHERE id = 1;   -- full scoring report
SELECT submitted_at, roll, name, email, track, years FROM institute_papers ORDER BY id DESC;
SELECT dossier FROM institute_papers WHERE id = 1;   -- a candidate's Method Dossier
```

Cloudflare Workers can't send email on their own, so there are no email alerts yet.

## Payments (Stripe)

Plans: Scholar, Company, Founder — monthly, or annual at 8.5× monthly (10 months less 15%, about 29% off), in the
currency the visitor picks (USD, EUR, GBP, INR). Amounts live in `PLANS` in `src/payments.js`;
Stripe products and prices are created automatically on first checkout.

One-time setup:

1. Create a Stripe account. Start in **test mode**.
2. Worker → Settings → Variables and Secrets → add secret `STRIPE_SECRET_KEY` (`sk_test_…`).
3. Stripe → Developers → Webhooks → Add endpoint `https://methodmachinestudio.com/api/stripe-webhook`
   with events `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`. Copy its signing secret
   into a Worker secret `STRIPE_WEBHOOK_SECRET` (`whsec_…`).
4. Stripe → Settings → Billing → Customer portal → activate, and copy the portal login link
   into a Worker variable `STRIPE_PORTAL_URL`.
5. Test with card `4242 4242 4242 4242`, then repeat steps 2–4 with live keys.

```sql
SELECT email, plan, interval, currency, status, current_period_end FROM members ORDER BY updated_at DESC;
```

### Promo codes

Visitors can type a code in the promo box beside the prices. Create codes in Stripe
(Product catalogue → Coupons → create a coupon, then add a customer-facing promotion code to it).
Examples: 100% off for 12 months = a free year; restrict to specific products or first-time
customers as needed. The site checks the code with Stripe before opening checkout; no code names
appear anywhere on the site.

## Collected Works uploads (Institute paper, Section F)

Section F requires work samples, sample scripts/stories and documented works. Each accepts a
link; file uploads switch on automatically once the Worker has an R2 bucket bound as `WORKS`:

1. Cloudflare dashboard → R2 → enable R2 (free tier covers 10 GB).
2. Create a bucket named `mms-collected-works` (keep it private).
3. Add to `wrangler.jsonc`: `"r2_buckets": [{ "binding": "WORKS", "bucket_name": "mms-collected-works" }]`, then push.

Uploaded files are listed in the `uploads` table and inside each paper's `answers` JSON:

```sql
SELECT submitted_at, slot, name, size, r2_key FROM uploads ORDER BY id DESC;
```

## Local development

```sh
npx wrangler d1 execute method-machine-studio --local --file schema.sql
echo "ANSWER_KEY=$(cat answer_key.json)" > .dev.vars   # optional, git-ignored
npx wrangler dev
```
