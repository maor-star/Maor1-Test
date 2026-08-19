# Cloud

Everything built here is meant to go up to the cloud. This file records how, and
what is missing to make it work unattended.

## Current status

| Provider | Status | Evidence |
|---|---|---|
| **AWS** | Not connected | `aws sts get-caller-identity` → `InvalidClientTokenId`. The CLI is installed in the working container, but `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are 14-character placeholders — a real key id is 20 characters and a secret is 40. |
| **Cloudflare** | Not connected | No connector on the account, no `CLOUDFLARE_*` or `CF_*` variables, no `wrangler` authentication. |
| **GitHub** | Connected | Pushes work. |

Account `450118321037`, user `Maor`, was verified in earlier sessions running on a
local machine — not from a cloud container. That distinction is the whole reason
deployment has to either run from a machine holding the credentials, or be handed
credentials explicitly.

## What each provider needs

### Cloudflare — preferred for static marketing assets

Two values, and the whole pipeline runs unattended:

- **API token** — Cloudflare dashboard → My Profile → API Tokens → Create Token →
  template **Edit Cloudflare Workers**, or a Pages-scoped token for static sites
- **Account ID** — right-hand sidebar of the dashboard

```bash
export CLOUDFLARE_API_TOKEN='...'
export CLOUDFLARE_ACCOUNT_ID='...'
npx wrangler pages deploy <build-dir> --project-name adnimation-marketing
```

`wrangler` installs from npm with no special access — verified reachable from the
working container. Free tier covers a marketing site comfortably, TLS is automatic,
and there is no server to maintain.

A scoped token can be revoked in one click when it is no longer needed. That makes
it a much smaller thing to hand over than a root AWS key pair.

### AWS — for anything needing S3, CloudFront or a real server

Either configure locally and deploy from that machine:

```bash
brew install awscli     # or the platform equivalent
aws configure
aws sts get-caller-identity   # should return 450118321037 / Maor
```

Or supply credentials to an automated run. Prefer **temporary** credentials over a
long-lived key pair:

```bash
aws sts get-session-token --duration-seconds 3600
```

They expire in an hour, which bounds the exposure of anything written into a
transcript.

## Deployment targets, by asset type

| Asset | Target | Why |
|---|---|---|
| Blog and landing pages | Cloudflare Pages, or S3 + CloudFront | Static output; no server needed |
| The marketing console | Already hosted as a published artifact | Saves its own state; nothing to deploy |
| Anything with a backend | Cloudflare Workers + D1, or AWS App Runner | Workers needs no server to maintain |

The S3 + CloudFront + Route53 + ACM pattern was used successfully on this account
before, for a static site. It is the proven path if AWS is preferred over Cloudflare.

## The one thing no provider solves

Publishing to LinkedIn. There is no organic-posting connector in the directory —
the LinkedIn integrations that exist are ad-analytics readers, and LinkedIn's
posting API requires an approved application with its own OAuth flow. Approved copy
lands in `marketing/ready-to-post/` and the paste is manual. That is unrelated to
AWS or Cloudflare and would not change if both were connected.
