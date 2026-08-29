# Adnimation CEO Cockpit — Build Brief

You are building a **single-user internal web application** for the CEO of Adnimation, an Israeli ad-tech company. The full product specification is in `adnimation-ceo-cockpit-spec.md` (Hebrew). **Read it before writing code.** This file tells you how to build it; that file tells you what to build.

---

## 1. What this is

A private command centre for one person. It aggregates all company data (revenue, demand/supply partner health, sales pipeline, contracts, sites, tasks) into one interface, and lets the CEO act from it — delegating work to the team via Slack, filing contracts to Google Drive, and running configurable **agents** that perform recurring tasks on his behalf.

**Two users total.** The CEO (owner) and his Chief of Staff (operator). The team never logs in — they receive Slack messages and emails.

## 2. Non-goals — do not build these

- Multi-tenant anything. No org signup, no invites, no team seats.
- A replacement for ClickUp. The team keeps using ClickUp; we mirror it read-mostly.
- A public-facing site, marketing pages, or a landing page.
- A mobile native app. A responsive web app is sufficient.
- Role-based permissions beyond the two hardcoded users.
- Anything that deletes data. Archive only, everywhere.

---

## 3. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 15, App Router, TypeScript strict** | Server Components by default |
| Styling | **Tailwind CSS + shadcn/ui** | See §7 for RTL requirements |
| Database | **PostgreSQL** (Neon or Supabase) | Schema in `schema.sql` |
| ORM | **Drizzle ORM** | Generate types from schema; migrations checked into repo |
| Auth | **Auth.js (NextAuth) with Google provider** | Allowlist exactly two emails via `ALLOWED_EMAILS` env var. Reject everyone else at the callback. |
| Background jobs | **Inngest** | All scheduled reports, crawlers, and agent runs. Durable + retryable + observable. Do not use `setInterval`. |
| Charts | **Recharts** | |
| Dates | **date-fns** + `date-fns-tz` | Default timezone `Asia/Jerusalem` everywhere |
| Validation | **Zod** | Every API input and every external API response |
| Testing | **Vitest** + **Playwright** | See §9 |

Deploy target: Vercel for the app, Inngest Cloud for jobs. Keep them decoupled — no job logic inside route handlers.

---

## 4. Repo structure

```
/app
  /(auth)/login
  /(app)
    /page.tsx                  → Cockpit (home)
    /tasks
    /pipeline                  → Kanban + list + forecast
    /partners                  → demand & supply health
    /contracts
    /properties                → sites & apps
    /inbox                     → Action Inbox
    /agents                    → definitions, run log, kill switches
    /calendar
    /revenue
    /settings
  /api
    /webhooks/{clickup,calendly,slack,esign,gmail}
/lib
  /db          → drizzle schema, queries
  /integrations
    clickup.ts  slack.ts  gmail.ts  drive.ts  calendar.ts
    calendly.ts esign.ts  revenue.ts
  /agents
    runtime.ts        → the agent engine (see §6)
    definitions/      → one file per agent
  /scoring
    demand-risk.ts  supply-risk.ts  heat-score.ts  anomaly.ts
/inngest
  functions/         → scheduled jobs, one file each
/components
/tests
```

---

## 5. Environment variables

```
DATABASE_URL=
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
ALLOWED_EMAILS=            # comma-separated, exactly two
GOOGLE_SERVICE_ACCOUNT_KEY= # for Drive/Gmail/Calendar server-side access
DRIVE_CONTRACTS_ROOT_ID=   # folder ID of /Adnimation Contracts
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_CEO_USER_ID=
CLICKUP_API_TOKEN=
CLICKUP_TEAM_ID=
CALENDLY_TOKEN=
ESIGN_PROVIDER=            # docusign | dropboxsign | adobesign
ESIGN_API_KEY=
ESIGN_ACCOUNT_ID=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
AGENTS_GLOBAL_KILL=false   # global agent kill switch, also togglable in UI
MAX_AUTO_SIGN_VALUE_USD=   # hard ceiling; never sign above this
```

Never commit secrets. Never log secret values. Never put an API key in client-side code.

---

## 6. The agent engine — build this carefully

Spec section **6א**. This is the most sensitive part of the system.

An agent is a row in the `agents` table with: a trigger, a list of conditions, a list of actions, an autonomy level (1–4), and routing rules. The runtime evaluates conditions, then executes actions in order, writing an `agent_runs` row throughout.

### Hard constraints — enforce these in code, not just in the UI

1. **Autonomy level 4 (silent execution) is forbidden for any irreversible action.** Irreversible actions are: `sign_contract`, `send_external_email`, `send_external_document`, `create_financial_commitment`, `archive_record`. Validate at write time (reject the agent config) *and* at run time (halt the run).
2. **A new agent starts at level 1** and cannot be promoted until `run_count >= 20`. Enforce in the mutation, not the form.
3. **Rate limit every agent.** More than `max_runs_per_hour` (default 10) → halt, disable the agent, alert. This is the loop protection.
4. **Global kill switch** (`AGENTS_GLOBAL_KILL` + a DB flag) checked at the top of every run.
5. **Dry-run mode** — every agent must be runnable against real data with all side effects stubbed, producing the full action list it *would* have taken.
6. **Immutable run log.** `agent_runs` rows are insert-only and append-only. No UPDATE that overwrites history, no DELETE. Enforce with a DB trigger.
7. **No agent may modify another agent's configuration.**

### The signing path

`contract-countersign` (spec 6א.3) is the highest-risk agent. All five conditions must pass, evaluated independently and logged individually:

- counterparty resolves to an existing `partners` row
- a matching `contracts` row exists in status `out_for_signature`
- diff between returned version and the approved version is **empty**
- contract value < `MAX_AUTO_SIGN_VALUE_USD`
- no clause flagged `redline` in the clause bank

If any condition fails → halt, write the reason, create an alert. Never partially proceed.

Signing goes through the e-signature provider API. **Never composite a signature image onto a PDF.** The provider's audit trail is the legal record.

Build the signing path **last** (milestone 5). Ship everything else first.

---

## 7. UI requirements

- **The interface language is Hebrew. The layout is RTL.** Set `<html dir="rtl" lang="he">`. Use Tailwind logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`) — never `ml-*`/`mr-*`.
- **Ad-tech terms stay in English** inside Hebrew text: RTB, SSP, DSP, sellers.json, app-ads.txt, eCPM, Fill Rate, IVT, VAST, CTV. Numbers and currency render LTR inside RTL paragraphs — wrap them in `<span dir="ltr">`.
- Font: a Hebrew-capable sans (Assistant, Rubik, or Heebo) via `next/font`.
- **Density over decoration.** This is a working tool used daily by one person. Compact tables, tight spacing, no hero sections, no illustrations, no onboarding tours.
- **Every data point is clickable and drills down.** A revenue number opens the breakdown. A partner name opens the partner card.
- **Every list row has actions**: delegate, open task, snooze, acknowledge — inline, no modal chain.
- Loading states must be per-section, not full-page. A slow ClickUp sync must not block the revenue strip.
- Stale data is labelled, never hidden: `נתונים מ-14:32`.

---

## 8. Build order

Ship each milestone working end-to-end before starting the next. Do not scaffold everything first.

### Milestone 1 — Foundation + Tasks + Cockpit shell
- Auth with two-email allowlist. Anyone else gets a clean rejection page.
- Schema deployed from `schema.sql`, Drizzle types generated.
- Native task CRUD: create, edit, subtasks, due date, priority, tags, comments, recurring, search. Views: list, board, calendar.
- ClickUp mirror: webhook + 5-minute delta poll. Read-only display of all company tasks.
- Delegation: from any entity, pick a person → posts to Slack **and** creates a ClickUp task → tracked in `delegations` with a stale check.
- Heat Score computed per spec 6.2.
- Cockpit page with the tasks strip live and other strips stubbed.

**Acceptance:** CEO can run his whole task day here. Delegating produces a real Slack message and a real ClickUp task, and the delegation shows as stale after 3 days of no movement.

### Milestone 2 — Revenue + Action Inbox + Daily reports
- Revenue ingestion per department per day (Gross and Net, kept distinct everywhere).
- Anomaly detection per spec 7.4 with a 28-day day-of-week-adjusted baseline.
- Action Inbox: alerts persist until explicitly acknowledged. Acknowledgement is recorded with user and timestamp. Snooze requires a return date. Grouping, suppression, and a 15/day cap per spec 11.4.
- Inngest jobs: morning Slack brief (07:30), full daily email (08:00), evening revenue email to management (20:00), sorted by revenue descending.

**Acceptance:** An injected 40% revenue drop produces exactly one alert with all five required fields, it survives a page reload unacknowledged, and the 20:00 email sends with departments correctly sorted.

### Milestone 3 — Pipeline + Partner health
- Deals with the 8 stages + lost. Kanban, list sorted by next-step date, forecast, stale view, win/loss.
- **Saving a deal without `next_step` and `next_step_date` is rejected** — server-side, not just client-side.
- Calendly webhook → auto-creates a deal at stage 1.
- Demand and supply risk scoring per spec 8.2/8.3. Risk Board.
- Auto-promotion: contract signed → stage 7; first revenue → stage 8 + partner record created and linked.

**Acceptance:** A Calendly booking creates a deal within seconds. A deal with a past next-step date appears in the stale view and generates an alert.

### Milestone 4 — Contracts + Drive filing + Agent engine
- Contract records, "contracts out" screen with escalation ladder (7/14/21 days).
- Gmail watch on the `Contracts` label. Extraction, classification, Drive filing into `/Demand|/Supply|/General/<counterparty>/Signed` with the versioned naming convention. Low confidence → `_Unclassified` + alert.
- Never overwrite; always version.
- Agent engine with all seven hard constraints from §6. Agents screen: definitions, autonomy control, run log, per-agent and global kill switches, dry-run.
- Deploy the zero-risk agents first: `morning-brief`, `meeting-prep`, `task-hygiene`, `calendar-guard`, `pipeline-hygiene`, `contract-filing`, `contract-chaser`.

**Acceptance:** An emailed signed contract from a known partner is filed to the correct Drive folder, the contract record flips to signed, renewal alerts are scheduled, and the "contract out" task closes — with a Slack summary. Setting any irreversible agent to level 4 is rejected with a clear error.

### Milestone 5 — Counter-signature
Build only after §11 legal preconditions are confirmed.
- E-sign provider integration, "awaiting my signature" queue, step-up authentication separate from login, immutable signature log, kill switch, weekly signature review report.
- `contract-countersign` ships at **autonomy level 1 only**.

### Milestone 6 — Sites, calendar, communications
- ads.txt / app-ads.txt / sellers.json crawler with diffs.
- Calendar module, Calendly event types, Prep Cards.
- Gmail follow-up radar, `inbox-triage`.

---

## 9. Testing

- **Unit (Vitest):** every scoring function (heat, demand risk, supply risk, anomaly), every agent condition evaluator, the Drive path/filename builder, the contract diff.
- **Integration:** every external API wrapped in an adapter with a fake implementation. Tests run against fakes; no network in CI.
- **E2E (Playwright):** acknowledge an alert and confirm persistence across reload; delegate a task and confirm both side effects fire; attempt to set an irreversible agent to level 4 and confirm rejection; save a deal without a next step and confirm rejection.
- **Agent tests are mandatory.** Every agent needs a test proving it halts when each individual condition fails.

---

## 10. Engineering rules

- TypeScript strict. No `any`. Zod-parse every external response — ad-tech and Google APIs change shape without notice.
- Every integration exposes a health status (last successful sync, error count). Sync failure > 2 hours raises an `INTEGRATION_FAILURE` alert.
- Degrade gracefully: if ClickUp is down, show the last cached mirror with a timestamp. Never blank the page.
- All money stored in minor units as integers. Never floats.
- All timestamps stored UTC, rendered `Asia/Jerusalem`.
- Every mutation that touches contracts, signatures, or agent config writes an audit row.
- Idempotency keys on every webhook handler — Gmail, Calendly and Slack all redeliver.
- Deduplicate contracts by file hash before creating a record.

---

## 11. Preconditions the human must supply

Do not block on these for milestones 1–4, but they gate milestone 5 and some integrations. Flag them clearly if you reach a point where they're needed:

1. The revenue system's identity and API access (spec question 21.1 — likely Looker/Looker Studio, unconfirmed).
2. E-signature provider choice and account (21.9).
3. Written legal approval and an internal signing-authority document, plus confirmation of the company's signature-rights protocol (spec 9.7.5, questions 21.10–21.11).
4. Approved contract templates and clause bank content (21.12).
5. Routing table confirmation — who receives which contract type (spec 6א.4, question 21.15).
6. The Google Workspace service account with domain-wide delegation for Gmail, Drive and Calendar.

---

## 12. When in doubt

- If a requirement in this file conflicts with `adnimation-ceo-cockpit-spec.md`, **the spec wins on product behaviour, this file wins on implementation**.
- If something is genuinely ambiguous, build the reversible version and leave a `// DECISION:` comment explaining the choice and the alternative.
- Prefer boring, obvious code. This system will be maintained by whoever is available, not by a dedicated team.
