---
name: cockpit-agent
description: How to add or change an in-app agent in the Adnimation CEO Cockpit — the five files an agent touches, the hard constraints (§6) that are enforced in code, and the tests that fail when one is missed. Use when asked for a new agent, a new dial on an agent, or a new thing an agent may do.
---

# Adding an agent to the cockpit

An agent is a row in `agents` seeded from `lib/agents/definitions/index.ts`.
Five places, and a test checks each one:

| Where | What | Test that fails without it |
|---|---|---|
| `lib/agents/definitions/index.ts` | name, description, rationale, trigger, conditions, actions, `autonomyLevel: 1`, `enabled: false` | `agent-settings.test.ts` |
| `lib/agents/settings.ts` → `AGENT_SETTINGS[name]` | the dials, each with its default | `agent-settings.test.ts` |
| `lib/agents/checks.ts` → `conditions` / `performers` | the named check and the named action | `every-page-loads.test.ts` runs every condition |
| `lib/agents/slack-bots.ts` → `AGENT_BOT[name]` | which bot speaks for it; then `node deploy/build-detect.mjs` | `slack-bots.test.ts` |
| `lib/agents/types.ts` → `ACTION_TYPES` | a new action type, with a comment on why it is reversible | typecheck |

Optionally `components/agents/agent-card.tsx` → `PLAYBOOK_HINTS[name]` for the
skeleton he sees when he loads it a document.

## Rules enforced in code, not in the UI

- Level 4 is forbidden for anything in `IRREVERSIBLE_ACTIONS`; a new agent starts
  at level 1 and needs 20 runs to be promoted (`validateAgentConfig`).
- Anything that leaves the company (a Slack post, a LinkedIn post, external mail)
  is **not** an agent action. The agent drafts or proposes; his click on a screen
  sends. See `NEVER_AUTOMATIC` in `lib/copilot/autopilot.ts` and the marketing
  screen's publish action.
- Every mutation of agent config writes an audit row and is undoable
  (`RESTORABLE.agent` in `lib/undo.ts`).

## How they run

A systemd timer POSTs `/api/internal/tick` every 20 minutes; the route runs each
enabled agent whose `runEveryMinutes` has elapsed (the autopilot: once a day in
the hour he set). Job-style agents (mail, contracts, CRM harvest) run as
`deploy/*.mjs` on their own timers and are registered in `deploy/redeploy.mjs` JOBS.
