# Adnimation CEO Cockpit

A private console for the CEO of Adnimation. Two users only: the CEO (owner) and the
Chief of Staff (operator). The team never signs in — they receive from it, in Slack and email.

Full specification: [`adnimation-ceo-cockpit-spec.md`](adnimation-ceo-cockpit-spec.md).
Build brief: [`CLAUDE.md`](CLAUDE.md). Database schema: [`db/schema.sql`](db/schema.sql).

**Interface language is English (LTR)**, per the product owner's direction on 2026-08-29.
This supersedes CLAUDE.md §7, which specified Hebrew RTL. The visual system follows the
dark-HUD design handoff (`design/`).

---

## Status — Milestone 1 shipped

Per `CLAUDE.md` §8, each milestone ships working end-to-end before the next begins.

| # | Milestone | Status |
|---|---|---|
| 1 | Foundation + Tasks + Cockpit shell | **shipped** |
| 2 | Revenue + Action Inbox + daily reports | **revenue shipped**; inbox + reports pending |
| 3 | Pipeline + partner health | not started |
| 4 | Contracts + Drive filing + agent engine | not started |
| 5 | Counter-signature | blocked on legal preconditions (§11) |
| 6 | Sites, calendar, communications | not started |

### Revenue (milestone 2, first slice)

- **Source**: the Ad Ops Architect project's PostgreSQL (`ars_*` tables) — spec question 21.1,
  now answered. Access is **read-only**; the cockpit never writes to that system.
- **Net is derived as `gross - fee`**, never read from the source's `total_revenue`. That column
  is filled by a settlement pass running a day or two behind, and reading it directly showed a
  ~170% overnight jump in net that never happened. See `lib/revenue/normalize.ts`.
- **Department mapping is a proposal, not a fact.** The source distinguishes business line and
  demand category but carries no business-unit split, so every assignment is marked unconfirmed
  in the UI and unmatched revenue lands in an explicit UNASSIGNED bucket.
- Anomaly detection per spec 7.4: 28-day day-of-week-adjusted baseline, drop/spike thresholds.
- Cockpit strip 1 and a `/revenue` page with drill-down to demand category.

### What Milestone 1 delivers

- **Auth** — Google Workspace SSO, allowlist of exactly two addresses. The list is
  checked in the Auth.js `signIn` callback, and every request's session is verified
  in middleware before any page renders.
- **Tasks (native)** — full CRUD, subtasks, comments, due/start dates, priority,
  tags, recurrence field, money impact, search. Views: list, board, calendar.
- **Tasks (ClickUp mirror)** — read-only company layer, kept current by a signed
  webhook plus a five-minute delta poll. Editing a mirrored task is rejected
  server-side, not merely hidden in the UI.
- **Delegation** — one action sends a Slack message *and* creates a ClickUp task,
  linked back here. Tracked in `delegations`; anything that has not moved for three
  days flips to stale and raises an alert.
- **Heat Score** — spec 6.2, recomputed nightly and on every edit.
- **Hygiene rules** — spec 6.3, evaluated daily, one alert per task per rule.
- **Cockpit** — strips 2 (what is burning) and 6 (open delegations) live. The
  revenue and Risk Radar strips are labelled with the milestone that fills them
  rather than filled with sample numbers.

---

## Deployed

Running at **https://cockpit.wonderfool.xyz** — EC2 in `us-east-1`, the same region and
pattern as the account's other applications (a dedicated instance with a friendly
subdomain, as `weight.wonderfool.xyz` does). The app lives in its own directory,
`/opt/adnimation-cockpit`, and shares nothing with the other hosts.

| | |
|---|---|
| Instance | `i-0966fc654697d30ec` (t3.small, us-east-1c) |
| Address | `54.164.112.169` (Elastic IP, survives reboots) |
| TLS | Let's Encrypt, auto-renewing |
| Ports | 80 and 443 only — no SSH |
| Database | PostgreSQL on the instance; schema from `db/schema.sql` |
| Integrations | Running against the in-memory fakes (`USE_FAKE_INTEGRATIONS=1`) |

**`adncdn.net` is never touched.** See the repository-root `CLAUDE.md`.

### Enabling sign-in

The app is built for Google Workspace SSO and needs an OAuth client, which only the
account owner can create:

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** → Web application.
2. Authorised redirect URI: `https://cockpit.wonderfool.xyz/api/auth/callback/google`
3. Authorised JavaScript origin: `https://cockpit.wonderfool.xyz`
4. Apply the two values on the box: `set-google-oauth <CLIENT_ID> <CLIENT_SECRET>`

Until that is done the login page renders but cannot complete a sign-in. The
allowlist still applies afterwards: only the two addresses in `ALLOWED_EMAILS`
can hold a session, whatever Google returns.

### Redeploying

```bash
npm run build
node deploy/aws-provision.mjs      # DEPLOY_HOST, EIP_ALLOCATION_ID, EIP_ADDRESS
```

## Published read

A static read of the 2026-08-28 revenue, in the same design system, is published at
<https://claude.ai/code/artifact/22da96c3-861b-447c-9226-045bba6d02e5>. Source in
`design/revenue-console.html`. It is a snapshot, not the live app.

**Deploying the live app** needs three things this repo cannot supply on its own: a host
(Vercel), a PostgreSQL instance, and a Google OAuth client with the two allowed addresses.
With those, `.env.example` lists every variable required.

## Running it

Requires Node 20+ and PostgreSQL 14+.

```bash
cp .env.example .env.local     # then fill it in
npm install
npm run db:push                # applies db/schema.sql
npm run db:seed                # optional: two users, the team, a few tasks
npm run dev
```

Open <http://localhost:3000>.

`USE_FAKE_INTEGRATIONS=1` swaps Slack and ClickUp for in-memory fakes, so the
whole app is usable without external credentials.

### Background jobs

Scheduled work runs on Inngest, never on `setInterval`. In development:

```bash
npm run inngest    # Inngest dev server, discovers /api/inngest
```

| Job | Schedule (UTC) | What it does |
|---|---|---|
| `clickup-delta-poll` | every 5 min | Pulls ClickUp changes the webhook missed |
| `task-hygiene` | 04:00 | Recomputes heat, applies spec 6.3, raises alerts |
| `delegation-stale-watch` | 04:30 | Flips delegations with no movement to stale |

---

## Testing

```bash
npm run typecheck
npm test           # Vitest — scoring, hygiene, allowlist, webhook, mapping
npm run test:e2e   # Playwright — auth, tasks, delegation
```

Unit tests are pure: no database, no network. Integration adapters each ship a
fake (`FakeSlackAdapter`, `FakeClickUpAdapter`) and the E2E suite runs against
them, so CI needs no credentials.

---

## Layout

```
app/
  (auth)/login          sign-in and the rejection page
  (app)/                the authenticated shell
    page.tsx            Cockpit — the six strips
    tasks/              list / board / calendar, task detail
    delegations/        Delegation Tracker
  actions/              server actions (tasks, delegate)
  api/
    auth/[...nextauth]  Auth.js handlers
    inngest/            job handler
    webhooks/clickup/   signed, idempotent
lib/
  auth/                 allowlist, session helpers
  db/                   Drizzle schema mirroring db/schema.sql
  delegation/           the delegate flow and staleness sweep
  integrations/         adapters + fakes + health tracking
  scoring/heat-score.ts spec 6.2
  sync/                 ClickUp mirror (pure mapping split from db writes)
  tasks/                types, queries, mutations, hygiene rules
inngest/functions/      one file per scheduled job
tests/unit, tests/e2e
```

---

## Conventions that are enforced, not just documented

- **Money** is stored in minor units as `BIGINT`. Never floats.
- **Timestamps** are stored UTC (`timestamptz`) and rendered `Asia/Jerusalem`.
- **Nothing is deleted.** Archive only; `agent_runs`, `audit_log` and
  `signature_requests` are append-only via database triggers.
- **RTL.** `dir="rtl"`, logical properties (`ms-*`/`me-*`) only — never `ml-*`/`mr-*`.
  Numbers and ad-tech terms render LTR through the `<Num>` component.
- **Every external response is Zod-parsed.** ClickUp and Google change shapes
  without notice; an unparseable task is dropped, not crashed on.
- **Webhooks** verify an HMAC signature in constant time and carry an
  idempotency key — ClickUp redelivers.

---

## Not yet wired

These need a human decision or credential before the relevant milestone (see
`CLAUDE.md` §11 and spec §21):

1. The revenue system's identity and API access (spec 21.1) — gates milestone 2.
2. E-signature provider and account (21.9) — gates milestone 5.
3. Written legal approval and signing-authority document (21.10–21.11) — gates milestone 5.
4. Approved contract templates and clause bank (21.12) — gates milestone 4.
5. Routing table confirmation (21.15) — gates milestone 4.
6. Google Workspace service account with domain-wide delegation — gates milestones 4 and 6.
