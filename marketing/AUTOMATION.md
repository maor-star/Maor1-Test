# Automation

Three scheduled routines run the cycle. Each fires a fresh session that reads the
console for state and this repo for rules, does the work, and commits back here.

## The console

**https://claude.ai/code/artifact/a31759dc-117f-4ef3-829b-7552bc7838b6**

A live page that saves its own state. It holds the approval queue, the competitor
list, the inspiration sources, the graphic language, and the basis for the 50%
claim. What you enter there persists in the page itself and is read at the start of
every cycle.

## The routines

| Trigger ID | When (UTC) | Local | What it does |
|---|---|---|---|
| `trig_01H2vAGPeN9TrRNRdLzcsymi` | `7 10 * * 0` | Sun 06:07 ET | Weekly cycle — reads decisions, extracts topics and gaps from the inspiration sources, builds next week's calendar against the required mix, drafts the posts, files them as pending |
| `trig_01LH5xggMn9ViqBqjGnG5gd8` | `27 12 * * 1-4` | Mon–Thu 08:27 ET | Daily handoff — finds what is approved and due, runs the pre-flight, writes final copy to `marketing/ready-to-post/`, and sends approved press pitches if Gmail is available |
| `trig_01B3Bz2PV1cQ6b15WEXDZVCU` | `9 11 1 * *` | 1st, 07:09 ET | Monthly report, next month's calendar, three blog topics, Tier 2 roundup. Quarterly months also run the message audit |

Cron is evaluated in **UTC**, so these shift by an hour when US daylight saving
ends — Sunday becomes 05:07 ET, the daily becomes 07:27 ET. Adjust the expressions
in November if the earlier time matters.

To pause or change one, ask in any session, or edit it in the claude.ai routines UI.

## What is automatic and what is not

**Automatic:** market review, calendar construction, drafting, the whole rule set
(word counts, one audience per post, hashtag caps, banned language, the names rule,
the disclosure boundary, the 50% lock), filing to the queue, committing to the repo,
monthly reporting, quarterly audit.

**Yours:** approving in the console, and the final paste into LinkedIn.

## Three real limits

**1 · There is no LinkedIn publishing connector.** The connector directory has no
organic posting tool for LinkedIn — the LinkedIn integrations that exist are
ad-analytics readers. LinkedIn's posting API requires an approved application with
its own OAuth flow. So the chain ends at finished copy in `marketing/ready-to-post/`,
and the paste is manual. Nothing in this repo will ever claim a post went live.

**2 · Fired sessions carry no connectors.** Attaching them programmatically is
refused for this organization — `create_trigger` returns *"the connectors parameter
is not available for this organization"* — so the scheduled sessions have no Gmail
and no Slack and cannot email or message you when work is ready. Output lands in
this repo and in the session's own transcript.

**Fix, and it is worth doing:** recreate the three routines from the claude.ai
Routines UI, which can attach connectors, or add connectors to the existing ones
there. The prompts already handle it — each notification step is written as
conditional, so the moment Gmail or Slack is attached the routine starts sending
without any further change. That single step turns the daily handoff from "a file
appeared in the repo" into "the copy is in your inbox at 08:27", and lets approved
press pitches actually go out.

**3 · The weekly routine may not be able to write back to the console.** The Artifact
tool is not in the fired sessions' tool list. The commit to `marketing/posts/` is the
reliable channel; treat the console update as best-effort. If drafts appear in the
repo but not in the queue, that is this limitation, not a failure.

## Adding the missing inputs

Four things in the console unblock most of what is currently stalled:

1. **The 50% basis** — N properties, period, range, confirmation. Returns pillar 2
   to service and makes a success story writable.
2. **Inspiration sources** — unblocks three channels at once: the weekly market
   review, the newsletter's market updates, and the comment round.
3. **Graphic language** — unblocks every post carrying an image.
4. **Competitors** — unblocks the monitoring cycle and the category analysis.
