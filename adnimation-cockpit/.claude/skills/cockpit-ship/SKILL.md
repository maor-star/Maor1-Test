---
name: cockpit-ship
description: Test, build and deploy the Adnimation CEO Cockpit (adnimation-cockpit/) to the EC2 box over SSM, and the checks that catch the three ways a deploy has broken production before. Use whenever a change to the cockpit is ready to ship, or when a page is down.
---

# Shipping the cockpit

Everything runs from `adnimation-cockpit/`. Read the app's `CLAUDE.md` and the
repo-root `CLAUDE.md` first: never touch `adncdn.net`, the Lovable `adops-architect`
database is SELECT-only, nothing deletes (archive only).

## The order, every time

```bash
set -a; . ./.env.local; set +a          # tests need DATABASE_URL (a local Postgres 16)
pg_isready || service postgresql start   # the sandbox DB stops between sessions
npx tsc --noEmit
node deploy/build-detect.mjs             # regenerate the job copies of TS rule modules
npx vitest run                           # must be green, including every-page-loads
npm run build                            # "Compiled successfully" — a client import of lib/db fails here
git commit && git push -u origin <branch>
node deploy/redeploy.mjs                 # runs migrations, restarts the app, prints "live at"
```

The local `.env.local` DATABASE_URL is the **sandbox** Postgres, not production.
Test fixtures land there, not on the box. Production is reached only through
`node deploy/ssm.mjs '<shell>'` (never pass a secret as an argument; use
`deploy/set-secret.mjs`).

## What has broken production before

1. **A JS array in raw SQL** — `= any(${names}::text[])` becomes a row constructor
   → `cannot cast type record to text[]`, and the screen 500s. Use drizzle `inArray`.
   `tests/unit/every-page-loads.test.ts` calls every page's loaders against a real
   DB; add the new page's loaders there whenever a page is added.
2. **A new export in a TS module that a job copies** — `deploy/build-detect.mjs`
   generates ESM copies (`crm-from-mail.mjs`, `slack-bots.mjs`, …). Run it, or the
   job dies at 3am with "does not provide an export named …".
   `tests/unit/generated-copies.test.ts` guards this.
3. **A client component importing from a module that imports `lib/db`** — the build
   fails with "Can't resolve 'fs'". Put shared constants and types in a `types.ts`
   with no server imports (see `lib/marketing/types.ts`).

## Verifying a deploy

`curl` from the sandbox cannot reach the site (egress proxy). Check over SSM:

```bash
node deploy/ssm.mjs 'for p in / /copilot /marketing; do printf "%s %s\n" "$p" "$(curl -s -o /dev/null -w "%{http_code}" -H "Host: cockpit.wonderfool.xyz" http://127.0.0.1:3000$p)"; done'
```

307 means the route exists and redirects to login; full rendering is what the
data-loader test proves.
