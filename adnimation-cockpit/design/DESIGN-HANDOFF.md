# Handoff: CEO Cockpit (Adnimation)

## Overview
A single-operator executive cockpit for Adnimation: one dark-HUD console where the CEO reads company
performance and acts on it. Three screens (Company overview, Revenue & finance, Publishers & clients)
plus a right-hand account drawer. It layers ad-tech operating metrics (RPM, fill rate, impressions,
viewability) on top of the existing office-management data model (income, expenses, employees,
time entries) from `maor-star/Maor1-Test`.

## About the Design Files
The files in this bundle are **design references authored in HTML** — prototypes that show intended
look, structure and behavior. They are **not production code to copy**. The task is to **recreate
these designs inside the target codebase's own environment** (React/Vue/Svelte components, server
templates, native views — whatever the app already uses), following its established routing, state,
data-fetching and component patterns. The existing repo is a bundler-less Express + static SPA
(`public/app.js`, `public/styles.css`), so the natural path is to rebuild these screens as views in
that SPA — or to introduce a framework deliberately if the team decides to.

Note: the HTML prototypes use a streaming component runtime (`support.js`, `<x-dc>`, `<sc-for>`,
`<sc-if>`). Ignore that runtime entirely. Read the markup for structure and the inline styles for
values; `<sc-for list>` means "repeat per item", `<sc-if value>` means "conditional".

## Fidelity
**High-fidelity.** Colors, typography, spacing, sizes, motion and interaction states are final and
should be matched closely. Data values are realistic placeholders — wire them to real endpoints.

## Screens / Views

### Shell (all screens)
- **Layout**: CSS grid, `grid-template-columns: 248px 1fr`, `min-height: 100vh`.
- **Left rail** (248px, sticky, full height): vertical gradient `180deg #142330 → #0c151d`, 1px right
  border `rgba(196,218,240,0.2)`, padding `24px 0 18px`, internal gap 26px.
  - Wordmark "ADNIMATION" — Barlow Condensed 600, 25px, letter-spacing 0.2em, line-height 1.
  - Sub-label "CEO COCKPIT" — Barlow Semi Condensed 500, 10px, tracking 0.3em, color `#9cc3e8`,
    preceded by a 5×5px LED square that pulses (`ledPulse`, 2.6s ease-in-out infinite, opacity 1 → 0.2).
  - Nav: three rows, each `grid-template-columns: 18px 1fr auto`, gap 12px, padding `14px 18px`,
    1px top border `rgba(234,242,251,0.12)`, 2px inline-start marker (`#9cc3e8` when active,
    transparent otherwise), active background `rgba(234,242,251,0.14)`. Label: Barlow Semi Condensed
    15px, tracking 0.06em, color `#eaf2fb`. Index ("01"/"02"/"03"): Barlow Condensed 11px,
    tracking 0.16em, 45% opacity. Icon: Lucide, 16px, stroke-width 1.5, 85% opacity
    (layout-dashboard, line-chart, users).
  - WATCHLIST: section label Barlow Semi Condensed 9px/0.28em `#9cc3e8`; three rows
    `grid-template-columns: 5px 1fr auto`, 5px LED, name (13px, ellipsized), delta
    (Barlow Condensed 14px). Positive = `#9cc3e8`, negative = `#eaf2fb`. Row click opens the account drawer.
  - TELEMETRY: 22 bars, `flex: 1 1 0`, height 34px container, fill `#6f9fcc`, each animating
    `barPulse` (scaleY 0.35 → 1, 1.6–3.0s, staggered 0–1.08s delay). Decorative only.
  - Footer: LAST SYNC / FEEDS rows (Barlow Semi Condensed 10px, tracking 0.16em, `#9cc3e8` labels,
    `#eaf2fb` values), 1px divider, then a 30×30px hairline-boxed "CEO" avatar + "CHIEF EXECUTIVE".
- **Main ground**: background `#0f1a24` plus four layers, in order —
  1. scanlines: `repeating-linear-gradient(to bottom, rgba(196,218,240,0.035) 0 1px, transparent 1px 4px)`
  2. corner glow: `radial-gradient(120% 80% at 78% -10%, rgba(124,171,221,0.14) 0%, transparent 60%)`
  3. + 4. blueprint grid: 1px lines at 7% of text color, 48×48px.
- **Top bar**: padding `26px 30px 18px`, 1px bottom divider.
  - Kicker: 22px accent rule + "DASHBOARD / 01" (Barlow Semi Condensed 500, 10px, tracking 0.3em, `#a8cbea`).
  - Title: Barlow Condensed 600, 44px, line-height 0.92, tracking -0.012em,
    `text-shadow: 0 0 28px rgba(124,171,221,0.22)`.
  - Status cluster: pulsing LED + "LIVE" (`#9cc3e8`), clock, "SYS NOMINAL" — 10px, tracking 0.16em,
    `#8ba4bd`, 1px inline-end divider.
  - Period segmented control: 7D / 30D / QTD / YTD (radio inputs, visually hidden). Selected option =
    accent fill `#7cabdd` with `#0f1a24` text. Square corners, 1px border.
  - "EXPORT" secondary button.
- **Telemetry strip**: full-width `#0b141c` band, 1px top/bottom dividers, 6 equal cells with 1px
  inner dividers. Each: label (9px, tracking 0.14em, `#9cc3e8`, nowrap+ellipsis) over value
  (Barlow Condensed 500, 20px). Cells: REVENUE PACE, RPM INDEX, FILL, OPEN SIGNALS, PIPELINE, RUNWAY.
- **Content padding**: `22px 30px 56px`, section gap 20px.

### Card pattern (used everywhere)
Square corners, 1px border `rgba(196,218,240,0.2)`, background `color-mix(in srgb, #0f1a24 84%, transparent)`,
`box-shadow: inset 0 0 0 1px rgba(196,218,240,0.055), 0 18px 40px rgba(4,9,13,0.45)`, padding 17–19px,
flex column. **Every card carries four "+" registration marks** at its corners (11×11px crosshairs,
offset -6px, color = 55% of text color). Section headings: Barlow Condensed 600, 21–26px, line-height 1.

### 01 Company overview
- **KPI row**: 4 equal cards. Header row: label (Barlow Semi Condensed 500, 10px, tracking 0.14em,
  `#9db4ca`, nowrap) + index K01–K04 (Barlow Condensed 10px, tracking 0.16em, `#a8cbea`).
  Value: Barlow Condensed 600, 38px, line-height 0.9, tracking -0.02em, color `#dcecfb`,
  `text-shadow: 0 0 22px rgba(124,171,221,0.35)`. Below it a segmented gauge: 8px tall track of
  `repeating-linear-gradient(90deg, rgba(196,218,240,0.16) 0 2px, transparent 2px 5px)` with an
  accent-filled inner div at the gauge percentage, plus the percentage as text (10px, `#8ba4bd`).
  Then a 42px sparkline SVG (viewBox 0 0 120 34, non-scaling 1.5px stroke `#7cabdd`, solid baseline
  and dashed mid-line in `#33465a`). Footer above a 1px divider: delta % (13px, positive `#c2dbf2`,
  negative `#c2d3e4`) and comparison note (11px, tracking 0.1em, `#8ba4bd`).
  Metrics: NET REVENUE, GROSS PROFIT, AVG RPM, FILL RATE — all ILS (₪).
- **Revenue plot** (2.1fr): kicker "NET REVENUE / {period}", title "Actual against plan", legend
  (ACTUAL swatch `#6f9fcc`; PLAN dashed `#dcecfb` + value). Grid `56px 1fr`: left column = 5 value
  axis labels, space-between, 10px, tracking 0.12em, `#8ba4bd`, right-aligned. Plot: 212px tall,
  bottom + inline-start 1px borders `#4a6076`, horizontal grid lines every 53px at 7% text color,
  bars `flex: 1 1 0` with 5px gap, fill `linear-gradient(180deg,#8fbde8,#4d7ba6)`, 2px top cap
  `#dcecfb`, `box-shadow: 0 0 14px rgba(124,171,221,0.35)`, hover `#a8cbea`, `title` tooltip per bar.
  Dashed plan line positioned at the plan-per-bar height. A 90px scan sweep
  (`linear-gradient` to `rgba(196,226,255,0.55)` + 1px right edge) animates `scanSweep` 7s linear
  infinite across the plot. Below: 5 x-axis ticks, space-between. Footer: 3 cells separated by 1px
  gaps on a divider background — IMPRESSIONS / VIEWABILITY / ACTIVE PUBLISHERS (label 9px/0.26em,
  value Barlow Condensed 600 28px, note 12px).
- **Signals** (1fr): count tag; each row `grid-template-columns: 3px 1fr`, gap 12px, 1px top border
  at 9% text. 3px severity bar; severity word (Barlow Condensed 600, 12px, tracking 0.22em) colored
  CRITICAL `#dcecfb`, HIGH `#c2dbf2`, FINANCE `#a8cbea`, GROWTH `#86b3dc`; timestamp (11px, `#8ba4bd`);
  body 13px/1.45; ghost-button CTA (11px, tracking 0.18em) that navigates to the relevant screen.
- **Top accounts** (2.1fr): `table-layout: fixed`, Barlow Semi Condensed 14px. Columns
  Account 40% / Revenue 19% / RPM 13% / Δ 12% / Status 16%. Header cells: 11px uppercase,
  tracking 0.08em, `#9db4ca`, 1px bottom divider. Name cell: Barlow Condensed 500, 17px, nowrap.
  All data cells nowrap. Row hover = 4% text tint; row click opens the drawer. Status pill: HEALTHY /
  GROWING = accent tag (`#17293a` bg, `#c2dbf2` text), WATCH = neutral tag, ANOMALY = outlined tag.
  "ALL ACCOUNTS" ghost button navigates to screen 03.
- **Waiting on me** (1fr): three approval blocks — title (Barlow Condensed 600, 18px), due date
  (11px, tracking 0.12em), detail (12.5px/1.5, `#c2d3e4`), primary accent button + secondary DEFER
  button (both 11px, tracking 0.16em, padding 8px 13px). Footer note in 12px.
- **Sales pipeline**: 5 cells in a 1px-gap grid on a divider background. Per cell: stage label
  (9px/0.18em) over count (11px), value (Barlow Condensed 600, 30px), a 6px progress bar
  (track `#33465a`, fill `#7cabdd`), note (12px).
- **People & payroll** (1.3fr): 4 metric cells (HEADCOUNT, OPEN ROLES, LABOR COST, HOURS LOGGED) in
  the same 1px-gap grid. **Open roles** (1fr): four rows, title left (14px), stage right
  (11px, tracking 0.16em).

### 02 Revenue & finance
- **Income against cost** (1.55fr): grouped bars per month, 3 bars × 6 months, group gap 20px,
  bar gap 3px, 224px tall, same axis borders and 56px grid lines. Series colors: income `#6f9fcc`,
  direct expenses `#dcecfb`, labor `#8ba4bd`. Month labels below (11px, tracking 0.18em).
  Legend uses matching 10px swatches.
- **P&L** (1fr): four rows — Income, Direct expenses, Labor cost, Net profit. Left: label (14px) +
  note (11px, `#8ba4bd`). Right: value Barlow Condensed 600, 26px, nowrap; negatives use U+2212 and
  `#c2d3e4`, net profit uses `#dcecfb`. **Formula must match the repo**: net = income − direct
  expenses − labor cost, where labor cost = Σ(hours × hourly_rate).
- **Expenses by category**: six rows, name (14px) + amount (Barlow Condensed 600, 19px), 6px bar
  scaled to the largest category, note (11px).
- **Cash & collection**: `table-layout: fixed` — Client 38% / Invoiced 20% / Age 15% / State 27%.
  Client cell nowrap + ellipsis; age shortened to "62 D". Below, 3 metric cells: CASH ON HAND,
  RECEIVABLES, RUNWAY.

### 03 Publishers & clients
Single card. Header: title + segmented type filter (ALL / PUBLISHER / CLIENT, `flex: 0 0 auto` so it
never clips) + search input (max-width 220px, 1px border, square corners). Table columns: Account,
Type, Tier, Net revenue, RPM, Fill, Δ, Status — all nowrap, name in Barlow Condensed 17px.
Footer line reports "N OF 10 ACCOUNTS · NET REVENUE, LAST 30 DAYS".

### Account drawer (over any screen)
Fixed overlay, backdrop `rgba(5,11,16,0.72)` + `backdrop-filter: blur(2px)`, panel aligned to the
inline end: 548px wide (max 92vw), full height, background `#0f1a24`, padding 26px, gap 19px,
`box-shadow` lg, scrollable, with the four corner marks. Contents: crumb ("PUBLISHER / TIER 1",
10px, tracking 0.28em, `#a8cbea`), name (Barlow Condensed 600, 32px), icon close button; 2×2 stat
cells; a 30-bar 118px "LAST 30 DAYS" chart; a placements table (4 rows); an OWNER NOTE block;
sticky-bottom actions "OPEN OPTIMIZATION THREAD" (primary) + "CLOSE".

## Interactions & Behavior
- **Nav**: sets the active screen and clears any open drawer.
- **Period control**: 7D / 30D / QTD / YTD swaps every KPI value, delta, sparkline, plan line, axis,
  bar series, x-axis ticks and the sub-stat trio. It does **not** change the pipeline, people,
  finance-trend or receivables blocks.
- **Type filter + search** (screen 03): AND-combined; search is a case-insensitive substring match on
  account name; the footer count reflects the filtered set.
- **Row / watchlist click**: opens the drawer for that account. Close via the ✕ button or CLOSE.
- **Signal CTA**: routes to the screen that resolves it (accounts or finance).
- **Approval buttons**: currently navigate as stand-ins — wire to real mutations.
- **Animations**: `ledPulse` 1.8–2.6s opacity pulse; `barPulse` scaleY 0.35→1, 1.6–3.0s, staggered;
  `scanSweep` 7s linear infinite translateX across the plot. Bar hover is an instant color change.
- **Focus**: 2px accent outline, 2px offset, on every interactive element. Never the browser default.
- **Responsive**: designed for a 1440×980 desktop console. Below ~1200px the 4-up KPI grid and the
  2.1fr/1fr pairs should collapse to two columns, then one; the 248px rail can become a top bar.

## State Management
```
screen:     'overview' | 'finance' | 'accounts'   (default 'overview')
period:     '7D' | '30D' | 'QTD' | 'YTD'          (default '30D', exposed as a prop)
typeFilter: 'All' | 'Publisher' | 'Client'        (default 'All')
query:      string                                (default '')
selected:   account object | null                 (drives the drawer)
showAlerts: boolean                               (prop; hides the Signals list)
```
Data the screens need, mapped to the existing API:
- `GET /api/dashboard?month=` → income, expenses, labor cost, hours, net profit, category split,
  hours per employee, 6-month trend → KPI row, P&L, expenses-by-category, income-against-cost.
- `GET /api/income` → client/account revenue → top accounts, portfolio, receivables.
- `GET /api/expenses` → category and vendor detail.
- `GET /api/employees`, `GET /api/time-entries` → headcount, labor cost, hours logged.
- **Not yet in the API** (needs new endpoints or an ad-server integration): RPM, fill rate,
  impressions, viewability, publisher tiers, signals/anomalies, sales pipeline, open roles,
  cash on hand, runway, approvals queue.

## Design Tokens
Dark HUD values as overridden on the root element (the light Industry originals are in
`_ds/industry-.../styles.css`).

Colors
```
--paper              #eaf2fb    rail/strip type
--color-bg           #0f1a24    ground
--color-surface      #16232f
--color-text         #e6eef7
--color-divider      rgba(196,218,240,0.2)
neutral 100→900      #1a2734 #22303d #33465a #4a6076 #8ba4bd #9db4ca #c2d3e4 #d7e4f1 #eaf2fb
--color-accent       #7cabdd    primary fill, sparklines, progress, focus ring
accent 100→900       #17293a #1f354a #9cc3e8 #8ab6e2 #6f9fcc #86b3dc #a8cbea #c2dbf2 #dcecfb
rail gradient        #142330 → #0c151d
telemetry strip      #0b141c
bar gradient         #8fbde8 → #4d7ba6
glow                 rgba(124,171,221,0.35) numerals · 0.22 title · 0.14 corner wash
scanlines            rgba(196,218,240,0.035)
drawer backdrop      rgba(5,11,16,0.72) + blur(2px)
```
Spacing (Industry scale, 0.85×): 3.4 / 6.8 / 10.2 / 13.6 / 20.4 / 27.2px. Layout uses
14px grid gaps, 18–19px card padding, 20px section gaps, 30px page gutters.

Typography
```
Display / numerals   Barlow Condensed 500-600 — 44 (title) · 38 (KPI) · 30 · 28 · 26 · 21-24 (headings) · 17 (table names)
Technical labels     Barlow Semi Condensed 400-500 — 9-15px, uppercase, tracking 0.06-0.30em
Prose                Barlow 400 — 12.5-13px, line-height 1.45-1.55
Numerals             font-variant-numeric: tabular-nums, set on the root
```
Radius: 0 everywhere (square corners are the system's rule). Borders: 1px hairlines.
Shadows: `inset 0 0 0 1px rgba(196,218,240,0.055)`, `0 18px 40px rgba(4,9,13,0.45)`,
`0 0 14px rgba(124,171,221,0.35)` on bar caps.

## Assets
- Fonts: Barlow, Barlow Condensed, Barlow Semi Condensed (Google Fonts, weights 400–700).
- Icons: Lucide, stroke-width 1.5 — layout-dashboard, line-chart, users. No icon font; inline SVG.
- No images. Charts are HTML/CSS bars and inline SVG. Nothing to license.

## Files
- `CEO Cockpit.dc.html` — the current dark-HUD design, all three screens + drawer (the reference).
- `CEO Cockpit v2 light.dc.html` — same structure on the light Industry ground, if a light theme is wanted.
- `CEO Cockpit v1.dc.html` — the first pass, kept for history.
- `styles.css` — the Industry design-system token sheet and component layer the design builds on.
- `github.md` — the repo association and the screen → repo-file map.

## Suggested order of work
1. Introduce the dark token set and the three Barlow families; keep square corners and hairlines.
2. Build the shell (rail, top bar, telemetry strip) and screen routing.
3. Screen 02 first — it maps entirely onto existing endpoints.
4. Screen 01 with the metrics you have; stub RPM / fill / signals / pipeline behind a flag.
5. Screen 03 + the drawer.
6. Add the new ad-server and CRM endpoints, then remove the stubs.
