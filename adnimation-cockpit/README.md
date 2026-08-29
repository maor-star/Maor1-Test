# Adnimation CEO Cockpit

מערכת ניהול פרטית למנכ"ל Adnimation. שני משתמשים בלבד: המנכ"ל (בעלים) וה-Chief of Staff (מפעילה).
הצוות לא נכנס למערכת — הוא מקבל ממנה, בסלאק ובמייל.

האפיון המלא: [`adnimation-ceo-cockpit-spec.md`](adnimation-ceo-cockpit-spec.md).
הנחיות הבנייה: [`CLAUDE.md`](CLAUDE.md). סכמת מסד הנתונים: [`db/schema.sql`](db/schema.sql).

---

## Status — Milestone 1 shipped

Per `CLAUDE.md` §8, each milestone ships working end-to-end before the next begins.

| # | Milestone | Status |
|---|---|---|
| 1 | Foundation + Tasks + Cockpit shell | **shipped** |
| 2 | Revenue + Action Inbox + daily reports | not started |
| 3 | Pipeline + partner health | not started |
| 4 | Contracts + Drive filing + agent engine | not started |
| 5 | Counter-signature | blocked on legal preconditions (§11) |
| 6 | Sites, calendar, communications | not started |

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
