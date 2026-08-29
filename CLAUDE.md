# Operating rules for this repository

## Hard rules — never violate

1. **Never touch `adncdn.net` (the CDN), in any way.**
   No DNS records, no certificates, no distributions, no origin changes — nothing,
   in Route 53 or anywhere else. It is production CDN infrastructure.
   This applies to every future session without needing to be repeated.

2. **The Ad Ops Architect system (Lovable project `adops-architect`) is read-only.**
   `SELECT` only. Never INSERT, UPDATE, DELETE or run DDL against it. It is the
   live operational system the ad ops team works in.

3. **Ask before creating or changing shared infrastructure.** Deploy into the
   account's existing hosting arrangement rather than inventing a new one, and
   keep each app in its own separate folder/prefix.

## Deployment

The CEO Cockpit lives in `adnimation-cockpit/`. See its README for the stack and
`deploy/` for the provisioning script. AWS account 450118321037, eu-central-1.
