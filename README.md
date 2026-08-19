# Adnimation — Brand &amp; Marketing

Working repository for the brand and marketing programme: positioning reference,
content calendar, drafts, approval queue, monitoring, and the scheduled automation
that runs the cycle.

Everything lives under [`marketing/`](marketing/). Start with
[`marketing/README.md`](marketing/README.md).

## Live surfaces

| Surface | What it is |
|---|---|
| [Marketing console](https://claude.ai/code/artifact/a31759dc-117f-4ef3-829b-7552bc7838b6) | Approve posts and brand actions; enter competitors, inspiration sources, graphic language, and the basis for the 50% claim. Saves its own state. |
| [Operating system](https://claude.ai/code/artifact/17f553b5-9d06-4aa0-b6cf-2542a2f295cb) | The full reference — pillars, audiences, channel specs, governance, templates |

## Layout

```
marketing/
  README.md          operating rules, the two-list autonomy split, the names rule
  AUTOMATION.md      the three scheduled routines and their real limits
  brand/             messaging reference, visual system spec
  monitoring/        competitors, analysts, publications — read each cycle
  calendar/          one file per week
  posts/             LinkedIn drafts
  blog/              articles, drafts and published
  ready-to-post/     approved copy, cleared for publishing
  reports/           monthly performance, quarterly audit
  templates/         frozen announcement structures
  approvals/         the queue and its blocking questions
cloud/               how marketing assets get deployed, and what credentials that needs
```

## Cloud

Marketing assets — the blog, landing pages, the console — deploy to AWS or
Cloudflare. See [`cloud/README.md`](cloud/README.md) for the connection
requirements and the current status of each.
