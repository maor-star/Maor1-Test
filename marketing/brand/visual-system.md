# Visual System

> **STATUS: SPEC INCOMPLETE.** The palette, type family, and logo files are not on
> file here. I have not invented values. Open items are listed at the bottom and
> mirrored in `approvals/queue.md`. Until they are filled, no post ships with a
> custom graphic — text-only LinkedIn posts are unaffected and can run as normal.

## Rules that hold regardless of the missing values

- **One** approved color palette. **One** type family. No exceptions per-post.
- Fixed logo position, identical across every template.
- Fixed aspect ratios: **1200 x 627** standard, **1080 x 1080** square.
- Templates are **frozen**. Select a template. Never redesign one for a specific post.
- **No generic stock imagery.** Ever.
- Events: real photos from the field only.

## Template inventory

Seven frozen templates. Each has exactly one purpose.

| Template | Used for |
|---|---|
| `quote` | Pull-quote from an article, talk, or approved partner statement |
| `new-hire` | Team announcements. Identical treatment at every seniority level |
| `partnership` | Partnership announcements, post-sign-off only |
| `success-story` | Client results, post-approval only |
| `stat` | A single approved number with its basis visible |
| `event` | Conference and field content |
| `article` | Blog distribution |

## New-hire visual rule

One photo. Same visual treatment for everyone, regardless of seniority. The template
does not scale with title.

## Dashboard screenshots

**Always ask the user for a real screenshot before building any post that relies on
one. Never invent or reconstruct an interface.**

Pre-publication screen for:
- Client names
- Domains
- Account identifiers
- Absolute revenue figures
- Demand partner names
- Anything else identifying a client

Never show screens revealing internal logic, signal names, or data structure.

Prefer a tight crop over a full screen. Prefer relative trends over absolute numbers.
Identical visual treatment on every screenshot.

## Competitor visual material

Never copy a competitor's visual format, carousel, or template.

Screenshots of others' posts collected in `monitoring/` are internal input only.
Never uploaded, never quoted as an image, never used as a visual basis.

## Open items — needed from the user

1. **Color palette** — hex values, with the role of each (primary, secondary, accent,
   background, text). One palette, not a range to choose from.
2. **Type family** — name, weights licensed, and licence scope for social assets.
3. **Logo files** — SVG plus PNG, light and dark variants, and the fixed position
   spec (which corner, what margin) for each aspect ratio.
4. **Existing template files** — if the seven templates exist as Figma/Canva assets,
   the links. If they do not exist yet, that is a separate build and should be scoped
   as one rather than improvised post by post.
