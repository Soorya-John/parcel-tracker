# Parcel

A single-owner parcel tracker for shipments within, into, and out of India. Saved Parcels is the home screen; delivered parcels keep their full history in a searchable archive. A static, mobile-friendly frontend runs on GitHub Pages. A Cloudflare Worker owns authentication, 17TRACK integration, D1 persistence, webhook verification, and Resend email digests.

Public frontend: https://soorya-john.github.io/parcel-tracker/ · Source: https://github.com/Soorya-John/parcel-tracker

The public site starts with fictional demo parcels. Real parcel data remains behind the separately configured Worker authentication.

## Run locally

Requires Node.js 24 and npm. On Windows PowerShell, use `npm.cmd` / `npx.cmd` if the execution policy blocks `.ps1` wrappers.

```sh
npm ci
npm run dev
```

Open the printed local URL. The **clearly labelled demo** works without accounts or provider keys. All demo tracking numbers and scans are fictional. Demo additions are stored only in that browser's local storage and never registered with 17TRACK. To reset them, remove `parcel-demo-v1` from local storage.

For your private, persistent workspace:

1. Copy `.dev.vars.example` to `.dev.vars` (ignored by Git).
2. Run `npm run password`; copy its password hash and session secret into `.dev.vars`. The prompt is visible; choose a unique password of at least 16 characters. It is read from stdin, not command line arguments.
3. Add your `TRACK17_KEY` and `RESEND_KEY` to `.dev.vars`. Set `OWNER_EMAIL` and `EMAIL_FROM` in `wrangler.jsonc`. The sender must be verified in Resend.
4. Run `npm run db:local`, then `npm run worker:dev` in one terminal and `npm run dev` in another.
5. Click **Connect your account** and sign in. Leave the backend URL as `/api`: Vite proxies it to `127.0.0.1:8787`.

The default origin allows `http://localhost:5173`. If you open Vite using `http://127.0.0.1:5173`, set `ALLOWED_ORIGIN` to that origin (or a comma-separated list of exact origins) in `.dev.vars`. `npm run db:local` uses the same persistent `.wrangler` storage as Wrangler dev. Real tracking registration consumes your provider quota; the frontend demo and automated tests do not.

## Deploy the private backend

```sh
npx wrangler login
npx wrangler d1 create parcel-tracker
```

Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc` with the returned ID. Keep binding `DB` and migrations directory `migrations`. Set:

- `ALLOWED_ORIGIN`: your exact Pages origin, e.g. `https://your-user.github.io` (no project path or trailing slash).
- `OWNER_EMAIL`: the one owner and digest recipient.
- `EMAIL_FROM`: a verified Resend sender, e.g. `Parcel <parcels@your-domain.com>`.

Generate the password hash and session secret locally with `npm run password`, then store each backend secret through Wrangler's interactive stdin prompt:

```sh
npx wrangler secret put OWNER_PASSWORD_HASH
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TRACK17_KEY
npx wrangler secret put RESEND_KEY
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
```

Never put these secrets in GitHub Pages variables, frontend source, or a `VITE_` variable. `.dev.vars` is local only and is not uploaded by `wrangler deploy`. Authentication has no public signup: a password derived with PBKDF2-SHA256 (100,000 iterations and a random salt) unlocks the one owner's account. Signed bearer sessions last 12 hours and live in `sessionStorage`; signing in on a fresh browser/device loads the same D1 records. Login attempts are limited to ten per IP per 15-minute bucket. Rotate `SESSION_SECRET` to revoke every session. Sign-out clears the current browser token.

### 17TRACK webhooks and tracking

In the [17TRACK API dashboard](https://api.17track.net/admin/settings), configure:

```text
https://YOUR-WORKER.workers.dev/api/webhook
```

Use the webhook test in the provider dashboard. The handler verifies the `sign` header against the SHA-256 hex digest of the **unchanged raw request body + `/` + your 17TRACK API key**. It commits all events transactionally before acknowledging HTTP 200. It accepts the documented single-parcel payload and the `data.accepted` envelope.

Saving a parcel registers it through the v2.4 API. Tracking continues through 17TRACK even when the app is closed; signed webhooks write updates to D1. The Worker cron runs every two hours (`0 */2 * * *`, UTC), retries registration failures, reconciles active history via `gettrackinfo`, stops delivered tracking with `stoptrack`, and sends a digest. Archive placement is immediate when delivery is ingested; stopping at the provider is retried on the next cron until acknowledged. Delivered records and scans are retained. A late in-transit webhook cannot move them back to active.

Auto-detect omits the carrier code; manual selection uses the official carrier code. Correcting an existing registered parcel uses `changecarrier`, preserving its local history. Extra information uses `changeinfo`; registration errors and provider tips are shown in the detail view. If 17TRACK stops an undelivered registration, the detail view explains how to check/retrack it in the provider dashboard.

`(normalized tracking number, carrier)` is unique in D1. Re-entering a saved pair opens the existing record without registering it again. Auto-detect opens an existing record for that number when one exists; if the same number belongs to multiple couriers, choose a courier explicitly. Registration is serialized by number, and provider-side “already registered” responses are reused. Carrier corrections into an already saved pair open the existing destination record; the original remains saved with its own history.

The catalog comes from [17TRACK's official carrier JSON](https://res.17track.net/asset/carrier/info/apicarrier.all.json). All entries marked `IN` are shown under **Indian couriers**, including regional operators. **All couriers** exposes the entire international catalog. Nothing is reduced to a fixed shortlist. A complete bundled snapshot provides a first-run fallback. Cron refreshes it at most once daily, validates it, and retains the last good D1 copy on failure. `npm run catalog:update` updates the bundled backend snapshot and compact frontend demo snapshot.

All timezone-aware scans display in `Asia/Kolkata` (IST). If a courier omits its timezone, the raw local time is retained and explicitly labelled as unconvertible; the app does not invent an IST timestamp. Scan freshness depends on the courier and 17TRACK.

### Resend digests and retry behavior

Verify your sending domain in [Resend](https://resend.com/domains), configure `EMAIL_FROM`, and put its API key in `RESEND_KEY`. Every scheduled run sends at most one nonempty digest covering unassigned scans across **active and delivered** parcels. Scan fingerprints include time, description, stage, location and source carrier, so duplicate webhook deliveries do not alert twice; a location change under the same “In transit” status still produces an update. Delivery is retained as a scan even if the provider omits a delivery event from its event array.

An immutable D1 outbox freezes the scan set, email body, recipient and idempotency key. Only a successful Resend response with an email ID marks it sent. Failed requests retry that exact outbox with the same `Idempotency-Key`. Scans arriving during retries wait for the next digest. A D1 lease prevents concurrent cron runs from sending separate digests for the same scans.

**Resend retains idempotency keys for 24 hours.** If a pending send reaches 23 hours after its first attempt, automatic retries pause before that limit, to avoid duplicate mail after an ambiguous timeout. The workspace displays the error. Inspect the outbox and match `parcel-digest/<id>` in Resend's request logs:

```sh
npx wrangler d1 execute DB --remote --command "SELECT id,state,created_at,first_attempt,provider_id,error FROM digests ORDER BY created_at DESC LIMIT 10"
```

If Resend confirms acceptance, mark that exact outbox `sent`, with its actual email ID and send timestamp, using a parameterized D1 operation or the D1 console. If Resend conclusively confirms **no email was accepted**, reset `first_attempt` to NULL on that exact pending outbox to resume retries. Do not reset ambiguous sends. A paused outbox holds later scans until reconciled. This is an explicit delivery ambiguity limit, not a claim of unlimited exactly-once email across independent services.

## Deploy GitHub Pages

The production bundle uses relative asset URLs; both a root site and `/parcel-tracker/` project URLs work. Navigation does not require an SPA server fallback.

1. Push this repository to GitHub.
2. In **Settings → Pages**, select **GitHub Actions** as the build source.
3. Set the repository Actions variable `VITE_API_URL` to `https://YOUR-WORKER.workers.dev/api`. This is a public URL, never a key.
4. Run **Deploy GitHub Pages** from Actions, or push a frontend change to `main`. This repository is public and Pages is enabled with GitHub Actions as its build source.

The included workflow builds `dist`, uploads the Pages artifact, and deploys it with GitHub's Pages action. You can also leave `VITE_API_URL` unset and supply the Worker URL under **Connect your account → Backend connection**. In a new browser this starts in the labelled demo until sign-in; private parcel data is never bundled or served by Pages. No Cloudflare or provider deployment is automatically performed by the GitHub workflow.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
npx wrangler deploy --dry-run
```

`npm test` exercises the actual Worker handlers and real local D1/SQLite through Miniflare, with mocked external provider HTTP. It covers authentication/CORS, persistence after a fresh login, duplicate registration, signed duplicate webhooks, location changes, empty digests, immutable email retries, concurrent digests, idempotency expiry, the final delivery alert, stop retries, auto-detection, correction, extra information, and last-good catalog retention.

The browser suite serves the **production build at `/parcel-tracker/`**, drives desktop and mobile Chromium, signs in, saves a parcel, verifies duplicate reuse, closes its browser context, signs into a completely fresh context, opens the saved parcel without re-entering its number, ingests delivery, and finds it through search and the archive. Screenshots go to ignored `test-results/`. The Verify GitHub workflow runs these checks on push/PR.

These checks do not send real emails or register real tracking numbers. Production delivery requires your Cloudflare, 17TRACK and Resend accounts, secrets, webhook URL and verified sending domain. After deploying, add a real parcel and use the provider's webhook test plus a scheduled digest to verify your account configuration end to end.

## Layout

- `src/`: static app, fake-data demo and styles
- `worker/`: private API, provider adapters, scheduled work and bundled catalog
- `migrations/`: D1 schema and constraints
- `test/`: D1 integration and fresh-context browser checks
- `.github/workflows/`: verification and Pages deployment

Protocol references: [17TRACK v2.4](https://api.17track.net/en/doc), [official carrier catalog guidance](https://help.17track.net/hc/en-us/articles/37467353177753-Supported-carriers-and-carrier-codes), [Resend idempotency](https://resend.com/changelog/idempotency-keys), [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/).
