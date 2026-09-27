# Method Machine Studio — Cloudflare site

Landing page, Stage 1 application, and form handling, deployed as a Cloudflare Worker
(Workers Builds, connected to this repo).

| Path | Purpose |
| --- | --- |
| `public/` | The site: `index.html`, `apply.html`, `404.html`, icon, manifest, `_headers` |
| `src/worker.js` | Handles `POST /submit.php` (waitlist + applications), serves everything else from `public/` |
| `wrangler.jsonc` | Worker config: static assets + D1 binding `DB` |
| `schema.sql` | Tables in the D1 database `method-machine-studio` (already created) |

## Deploys

Pushes to `main` deploy the live site. Other branches get a preview URL (Worker → Previews).

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
```

Cloudflare Workers can't send email on their own, so there are no email alerts yet.

## Local development

```sh
npx wrangler d1 execute method-machine-studio --local --file schema.sql
echo "ANSWER_KEY=$(cat answer_key.json)" > .dev.vars   # optional, git-ignored
npx wrangler dev
```
