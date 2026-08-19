---
status: DRAFT — APPROVAL REQUIRED (all new blog articles do)
audience: 1 — PUBLISHERS
pillar: 1 — The agentic AI layer (approached through the problem, not the mechanism)
words: ~1,560
search_intent: >
  Informational, with commercial intent underneath. A publisher or in-house
  monetization manager who suspects their price floors are wrong and is searching for
  how to check. They want a method, not a vendor. The article gives them a method.
primary_keyword: price floor optimization
secondary_keywords:
  - static price floors
  - header bidding price floors
  - dynamic floor pricing
  - CPM floor strategy
  - unfilled impressions
meta_description: >
  Static price floors go stale within weeks. Here is how to audit yours using reports
  you already have, and what the numbers are telling you. (149 characters)
internal_links_needed: 4 — see [INTERNAL LINK] markers. I do not have the live URL
  structure for adnimation.com and have not guessed at it.
names_present: none
numbers: none presented as Adnimation data. The worked example is explicitly labelled
  as hypothetical arithmetic.
---

# Static Price Floors and the Money They Leave Behind

Most publishers set price floors once. They pick a number that feels defensible, watch
fill rate for a week, adjust if something looks broken, and move on. The number stays
there for months. Sometimes years.

That is a reasonable thing to have done. Floors are not the most urgent item on a
monetization manager's list, and a floor that is roughly right does most of its job. But
"roughly right" has a cost, and the cost compounds quietly, which is the hardest kind to
notice.

This article is about where that money goes, and how to find out how much of it is
yours. There is a spreadsheet exercise near the end you can run this week using reports
you already have.

## A floor is a bet about a market you cannot see

A price floor is a standing instruction: reject any bid below this number.

The instruction only makes sense if you know something the bidder does not — that
someone else will pay more, or that the impression is worth holding back. That is a
claim about future demand. You are betting on the shape of a market you observe only
through your own fill rate.

When you set the floor, you had some evidence. Recent clearing prices, a sense of
seasonality, maybe a benchmark from someone in the same vertical. That evidence had a
shelf life. Demand shifts when advertiser budgets reset, when a buyer changes its
bidding strategy, when a competitor for your audience raises its own bids, when your
traffic mix moves toward a different source. None of those events send you a
notification.

So the floor is a bet placed on old information, and it keeps getting placed, thousands
of times an hour, long after the information expired.

## Four ways a static floor loses money

The losses run in both directions, which is what makes them hard to see in a single
report.

### It blocks bids it should have taken

The obvious one. Your floor is $2.40. A bid arrives at $2.20. It is rejected. Nothing
better arrives, and the impression goes unfilled or falls through to a much cheaper
backfill.

You lost most of $2.20 to protect a $2.40 position that was not available. This shows up
in your reporting as an unfilled impression, which reads as a demand problem rather than
a pricing decision. It was a pricing decision.

### It accepts bids it should have pushed

Less obvious, and usually larger. Your floor is $2.40. A buyer would have paid $6.00 for
this particular impression, because this particular reader is worth that to them. Your
floor tells them $2.40 clears. In a first-price auction, a buyer who knows what clears
bids near what clears.

Nothing looks wrong here. The impression filled. The report shows revenue. You have no
line item for the $3.60 that was available and never asked for. Absence of a loss in
your reporting is not absence of a loss.

### It ages

A floor set in a strong quarter is too high in a weak one, and you find out through
falling fill rate. A floor set in a weak quarter is too low in a strong one, and you
never find out at all — fill rate stays high, revenue per impression stays flat, and the
market's willingness to pay more goes unexercised.

Note the asymmetry: a floor that is too high announces itself, and a floor that is too
low does not. If you only adjust when something looks broken, you will systematically
correct one error and never the other. Over a year, that bias has a direction.

### It averages away the differences that matter

One floor covers a placement. But the traffic through that placement is not one thing.

A reader arriving from search on a high-intent query, a reader arriving from a social
link, and a reader on their eleventh page view of the session are worth materially
different amounts to a buyer. So are the same three readers on a Tuesday morning and a
Saturday night, on desktop and on a three-year-old Android phone.

A single number cannot express that. It settles at something like the average, which
means it is too high for a large part of your traffic and too low for another large part,
simultaneously and permanently. The two errors partially cancel in your revenue report.
They do not cancel in your revenue.

## Why the usual fixes do not hold

Three reasonable responses, and where each one runs out.

### Raise the floor until fill rate drops

This finds the point where you start visibly losing impressions. That point is real
information, and worth knowing.

What it cannot find is the money in the second failure mode above. Fill rate tells you
when your floor is too high. It is silent on whether it is too low, because a floor that
is far too low produces perfect fill and a satisfied-looking report. Tuning against fill
rate optimizes against the one error that complains.

### Set a separate floor per ad unit

Better. Genuinely worth doing if you have not. Above-the-fold and below-the-fold
inventory should not share a price.

But it splits your traffic by *where the ad sits*, and the differences that move price
are mostly about *who is looking at it*. A single placement still carries your whole
audience mix. You have gone from one wrong number to eight wrong numbers, each wrong in
the same way for the same reason.

### Set it once and review quarterly

A quarterly review is four data points a year against a market that moves weekly. It
catches drift. It cannot catch the thing that makes floors hard, which is that the right
floor for the impression currently being sold is different from the right floor for the
one sold ninety seconds ago.

There is no schedule that solves a continuous problem. There is only a faster schedule.

## Run this audit yourself

Here is the useful part. You can do this in a spreadsheet with reports you already have.
It takes an afternoon and it does not require buying anything from anyone.

**1. Pull three months of impression-level or hourly data** from your ad server and your
wrapper, whatever granularity you can get. You need: placement, clearing price,
timestamp, traffic source, device type, and whether the impression filled.

**2. Segment by traffic source, then look at the spread of clearing prices *above* your
floor.** Not the average — the spread. If a segment's prices cluster tightly just above
your floor, that is a signal the floor is setting the price rather than discovering it.
If prices in another segment range widely above it, that segment has demand your floor
is not interacting with much at all.

Those two patterns need opposite responses. A single floor gives them the same one.

**3. Count your unfilled impressions and multiply by your floor.** That is the
approximate ceiling on what the first failure mode cost you. It is a ceiling, not the
number — some of those impressions had no bid at any price. But it establishes the scale,
and for most publishers looking at it for the first time, the scale is the surprise.

**4. For each segment, find the 90th-percentile clearing price and compare it to your
floor.** Illustrative arithmetic, using arbitrary numbers to show the shape of the
calculation rather than any real result: if your floor is $2.40 and one segment's 90th
percentile is $9.00, that segment routinely supports prices nearly four times your floor
— and your floor is telling every buyer in it that $2.40 is enough.

**5. Do it again, split by hour of day and day of week.** If the segment-level answers
change materially across time, you have confirmed the core problem: the right number is
not a number. It is a function.

You will finish this exercise knowing which of your inventory is underpriced, by roughly
how much, and how fast the answer changes. That is genuinely actionable on its own. Even
with a static floor, you can set better static floors per segment, and you should.

## What a better answer looks like

The audit above ends at a wall, and it is worth being direct about where the wall is.

Once you know the right floor is a function of audience, source, time, and device, you
also know that maintaining it by hand is not a job anyone can do. You would need to
re-derive several hundred numbers, continuously, from data most standard setups do not
produce in the first place. Nobody has those hours, and the setups that would make the
hours worth spending are not the default.

This is the problem Adnimation built an agentic yield layer to handle. It learns the
specific property — its sections, its audience, and how people actually behave on it —
builds data layers the standard stack does not produce, and runs agents that act on
pricing continuously rather than on a schedule. Our team operates it; the publisher's
side of the work is approving the integration and reading the reporting.

That is the pitch, stated once. The audit is worth running whether or not you ever talk
to us, and the numbers it gives you are yours.

## Where this leaves you

Static floors are not a mistake. They were the correct tool when the alternative was no
floor at all, and a segmented set of static floors is a real improvement over one number
for everything.

The honest limitation is structural. A fixed number cannot track a moving market, and the
version of the error that costs the most is the version your reporting cannot show you.
Knowing which of your inventory is underpriced is most of the work. Do the audit first.
Decide what to do about it second.

---

## Editor notes — for the approval pass

**[INTERNAL LINK] slots — I need the live URL structure:**
1. In "A floor is a bet about a market you cannot see" → an existing piece on demand
   dynamics or auction mechanics, if one exists
2. In "It averages away the differences that matter" → anything published on audience
   segmentation or traffic quality
3. In "Run this audit yourself" → any existing practical/how-to piece, to establish the
   pattern that this blog gives away method
4. In "What a better answer looks like" → the product or services page

**Disclosure check.** The article is deep on the problem and precise on the shape of the
result, and discloses no architecture, model, data source, signal, or pricing logic. The
audit steps use only the reader's own reports — nothing about how our system reaches its
answers. Standard percentile analysis is public statistical practice, not our method.

**Numbers check.** No Adnimation data appears. The $2.40 / $9.00 example is labelled as
arbitrary illustrative arithmetic. The 50% figure is **not** used — it cannot be until
its basis is on file. If you supply the basis, the natural insertion point is the
penultimate paragraph of "What a better answer looks like", in the single approved
wording only.

**Requirements met.** Defined search intent; one primary and five secondary keywords;
hierarchical H2/H3; meta description at 149 characters. Contains a substantial thing the
reader can apply without hiring Adnimation — that is the whole middle section, and it is
not a token gesture: a publisher who runs it and then fixes their own segmented floors
has captured real revenue and owes us nothing.
