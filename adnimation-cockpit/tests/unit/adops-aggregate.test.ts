import { describe, expect, it } from 'vitest';
// eslint-disable-next-line prettier/prettier
// @ts-expect-error — the jobs are plain ESM with no types.
import { bidderDays, bookHasMoney, bookOrNull, categoryLine, cents, clampToHistory, coreClientDays, coreClientsLine, eachDay, endpointEnvironments, environmentOf, exchangeDays, exchangeEnvLine, googleCtvLine, ignoredSourceNames, mergeDays, PL_BOOKS, PL_NUMERIC, publishersDay, publishersDaysFromDetail, revShareLookup, seatDaysFrom, seatDays, historyFloor, HISTORY_DAYS } from '@/deploy/adops-aggregate.mjs';

/**
 * The arithmetic that used to live inside SQL.
 *
 * Reading the source over REST means the grouping and summing happen in Node,
 * so these are the expressions the P&L and the revenue engines are built from.
 * Every one of them decides a figure he reads as the truth about the company,
 * and none of them can be checked by looking at a screen — a wrong sum looks
 * exactly like a bad week.
 */

describe('money', () => {
  it('rounds to minor units once, at the end', () => {
    expect(cents(0.1 + 0.2)).toBe(30);
    expect(cents(12.344)).toBe(1234);
    expect(cents(12.346)).toBe(1235);
    expect(cents(null)).toBe(0);
    expect(cents(undefined)).toBe(0);
    expect(cents('12.34')).toBe(1234);
  });

  it('rounds a floating-point half the way the machine sees it', () => {
    /*
     * 1.005 * 100 is 100.49999999999999 in a double, so this is 100 and not
     * 101 — where Postgres, doing the same round() over `numeric`, would have
     * said 101. Pinned rather than papered over: it is a half-cent on a value
     * that ends in exactly .xx5, on a daily total summed from hundreds of
     * rows, and correcting it would mean decimal arithmetic through every
     * expression here. Worth knowing, not worth that.
     */
    expect(cents(1.005)).toBe(100);
  });

  it('treats nonsense as nothing rather than NaN', () => {
    // A NaN in one row would poison the whole day's sum silently.
    expect(cents('not a number')).toBe(0);
  });
});

describe('the days in a window', () => {
  it('includes both ends', () => {
    expect(eachDay('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02',
    ]);
  });

  it('is one day when both ends are the same', () => {
    expect(eachDay('2026-08-30', '2026-08-30')).toEqual(['2026-08-30']);
  });
});

describe('publishers', () => {
  it('sums the sites and takes profit as what is left after the payout', () => {
    const row = publishersDay('2026-08-01', [
      { gross: 100, source_fee: 10, net_after_fee: 90, net: 70, impressions: 1000 },
      { gross: 50, source_fee: 5, net_after_fee: 45, net: 35, impressions: 500 },
    ]);
    expect(row).toEqual({
      date: '2026-08-01',
      pub_gross_cents: 15_000,
      pub_source_fee_cents: 1_500,
      pub_net_after_fee_cents: 13_500,
      pub_payout_cents: 10_500,
      pub_profit_cents: 3_000,
      pub_impressions: 1_500,
    });
  });

  it('is a real zero on a day with no sites, not a missing day', () => {
    expect(publishersDay('2026-08-02', []).pub_gross_cents).toBe(0);
  });
});

describe('the bidder', () => {
  it('reads gross from revenue before the source changed how it reports', () => {
    const [day] = bidderDays([
      { report_date: '2026-05-31', revenue: 100, ssp_revenue: 999, third_party_net_revenue: 40, impressions: 10 },
    ]);
    expect(day.bidder_gross_cents).toBe(10_000);
    // Before the switch the source splits out no profit we trust.
    expect(day.bidder_profit_cents).toBe(0);
  });

  it('reads gross from the SSP revenue on and after the switch', () => {
    const [day] = bidderDays([
      { report_date: '2026-06-01', revenue: 100, ssp_revenue: 120, third_party_net_revenue: 40, impressions: 10 },
    ]);
    expect(day.bidder_gross_cents).toBe(12_000);
    expect(day.bidder_profit_cents).toBe(6_000);
  });

  it('sums several rows on one day', () => {
    const [day] = bidderDays([
      { report_date: '2026-07-01', ssp_revenue: 10, revenue: 8, third_party_net_revenue: 3, impressions: 5 },
      { report_date: '2026-07-01', ssp_revenue: 20, revenue: 15, third_party_net_revenue: 5, impressions: 7 },
    ]);
    expect(day.bidder_gross_cents).toBe(3_000);
    expect(day.bidder_impressions).toBe(12);
  });
});

describe('the exchange', () => {
  it('counts only the un-split rows', () => {
    // Counting the per-SSP rows as well counts every day once per SSP, and the
    // exchange appears several times its real size.
    const days = exchangeDays([
      { report_date: '2026-08-01', ssp_id: null, revenue: 100, dsp_spend: 60, impressions: 10 },
      { report_date: '2026-08-01', ssp_id: 'a', revenue: 60, dsp_spend: 40, impressions: 6 },
      { report_date: '2026-08-01', ssp_id: 'b', revenue: 40, dsp_spend: 20, impressions: 4 },
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].xe_revenue_cents).toBe(10_000);
    expect(days[0].xe_profit_cents).toBe(4_000);
  });
});

describe('seat lease', () => {
  it('sums the partners into one row per day', () => {
    const days = seatDays([
      { report_date: '2026-08-01', gross_revenue: 243.25, partner_payout: 218.93, adnimation_profit: 24.33, impressions: 100 },
      { report_date: '2026-08-01', gross_revenue: 681.72, partner_payout: 579.46, adnimation_profit: 102.26, impressions: 200 },
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].seat_gross_cents).toBe(92_497);
    expect(days[0].seat_impressions).toBe(300);
  });
});

/**
 * The publisher lines, read from the site detail.
 *
 * They used to be read from `ars_site_daily_rollup` and the core publishers
 * snapshot. The source revoked both from this sign-in mid-afternoon and all
 * three lines went to a flat zero on his screen — which is what he was looking
 * at when he said IBV was showing nothing. These read the detail underneath
 * instead, which the same sign-in can read and which no grant has since taken
 * away.
 */
describe('the publisher lines, off the site detail', () => {
  const sources = [
    { source_name: 'AnyClip Video', category: 'video', is_ignored: false },
    { source_name: 'Deductions', category: 'ignored', is_ignored: true },
  ];
  const ignored = ignoredSourceNames(sources);

  const rows = [
    { report_date: '2026-08-01', category: 'video', source_name: 'AnyClip Video', ars_site_id: 1, ars_account_id: 10, gross_revenue: 10, source_profit_usd: 3, impressions: 100 },
    { report_date: '2026-08-01', category: 'video', source_name: 'AnyClip Video', ars_site_id: 2, ars_account_id: 10, gross_revenue: 5, source_profit_usd: 1, impressions: 50 },
    { report_date: '2026-08-01', category: 'video', source_name: 'Deductions', ars_site_id: 3, ars_account_id: 10, gross_revenue: 99, source_profit_usd: 99, impressions: 999 },
    { report_date: '2026-08-01', category: 'header_bidding', source_name: 'OpenX', ars_site_id: 4, ars_account_id: 20, gross_revenue: 7, source_profit_usd: 2, impressions: 70 },
  ];

  it('cuts IBV to the video category alone', () => {
    const [video] = categoryLine(rows, 'video', ignored);
    expect(video.gross_cents).toBe(1_500);
    expect(video.profit_cents).toBe(400);
  });

  it('leaves out the sources the source itself ignores', () => {
    // Deductions and analytics are not revenue, and the ad ops team has
    // already said so on the demand source. Reading the detail moved that flag
    // one table away, so forgetting the join would silently add them back.
    const [video] = categoryLine(rows, 'video', ignored);
    expect(video.entities).toBe(2);
    expect(video.impressions).toBe(150);
  });

  it('gives core publishers every format together', () => {
    const [day] = coreClientsLine(rows, new Map(), ignored);
    expect(day.gross_cents).toBe(2_200);
    expect(day.profit_cents).toBe(600);
  });

  it('leaves trading accounts out of core publishers', () => {
    // They are a different business with a different margin. Counting them as
    // represented publishers overstates the portfolio he is judged on.
    const accounts = new Map([['20', { ars_id: 20, name: 'Resold', is_trading_account: true }]]);
    const [day] = coreClientsLine(rows, accounts, ignored);
    expect(day.gross_cents).toBe(1_500);
  });

  it('keeps trading accounts in the ranking, marked', () => {
    const accounts = new Map([
      ['10', { ars_id: 10, name: 'Big Publisher' }],
      ['20', { ars_id: 20, name: 'Resold', is_trading_account: true }],
    ]);
    const ranked = coreClientDays(rows, accounts, ignored);
    const names = ranked.map((r: { account: string }) => r.account).sort();
    expect(names).toEqual(['Big Publisher', 'Resold']);
    expect(ranked.find((r: { account: string; is_trading: boolean }) => r.account === 'Resold')?.is_trading).toBe(true);
  });
});

/**
 * The three EXCHANGE tiles.
 *
 * He settled what they mean himself: one business in three environments. Two
 * of them used to point somewhere else entirely — EXCHANGE APP at Google's app
 * inventory, EXCHANGE DISPLAY at the publishers' header bidding — so the wall
 * reported two things that are not the exchange under names that say they are.
 */
describe('the exchange, split by environment', () => {
  const envByDsp = endpointEnvironments([
    { kind: 'dsp', id: 1, name: 'Buyer A', environments: { inapp: true, web: false } },
    { kind: 'dsp', id: 2, name: 'Buyer B', environments: { web: true } },
    { kind: 'dsp', id: 3, name: 'Buyer CTV EU', environments: { inapp: true } },
    // A supply endpoint carries an environment too, and it is the wrong one
    // to read: the tile is about where the buyer is spending.
    { kind: 'ssp', id: 1, name: 'Seller CTV', environments: { web: true } },
  ]);

  const reports = [
    { report_date: '2026-08-01', dsp_id: 1, ssp_id: null, revenue: 100, dsp_spend: 70, impressions: 1000 },
    { report_date: '2026-08-01', dsp_id: 2, ssp_id: null, revenue: 10, dsp_spend: 8, impressions: 100 },
    { report_date: '2026-08-01', dsp_id: 3, ssp_id: null, revenue: 1, dsp_spend: 1, impressions: 10 },
    // The pair rows say the same money once per endpoint it passed through.
    { report_date: '2026-08-01', dsp_id: 1, ssp_id: 55, revenue: 100, dsp_spend: 100, impressions: 1000 },
  ];

  it('reads the environment off the demand endpoint', () => {
    expect(envByDsp.get('1')).toBe('INAPP');
    expect(envByDsp.get('3')).toBe('CTV');
  });

  it('leaves the supply endpoints out of it', () => {
    // Both sides of a trade have an environment and only the buyer's counts.
    expect([...envByDsp.keys()].sort()).toEqual(['1', '2', '3']);
  });

  it('sends each environment to its own tile', () => {
    expect(exchangeEnvLine(reports, envByDsp, 'apps')[0].gross_cents).toBe(10_000);
    expect(exchangeEnvLine(reports, envByDsp, 'rtb_display')[0].gross_cents).toBe(1_000);
    expect(exchangeEnvLine(reports, envByDsp, 'ctv')[0].gross_cents).toBe(100);
  });

  it('counts the per-endpoint totals once, not the pair rows as well', () => {
    // Summing both reports the exchange at twice its size, and the app tile
    // would have read 200 instead of 100.
    const [apps] = exchangeEnvLine(reports, envByDsp, 'apps');
    expect(apps.gross_cents).toBe(10_000);
    expect(apps.entities).toBe(1);
  });

  it('takes profit as revenue less what the buyer was charged', () => {
    expect(exchangeEnvLine(reports, envByDsp, 'apps')[0].profit_cents).toBe(3_000);
  });

  it('drops an endpoint whose environment nobody has recorded', () => {
    // Better a line that is short than a line that quietly files unknown
    // demand under apps because apps is the big one.
    const unknown = [{ report_date: '2026-08-01', dsp_id: 99, ssp_id: null, revenue: 500, dsp_spend: 1, impressions: 1 }];
    expect(exchangeEnvLine(unknown, envByDsp, 'apps')).toEqual([]);
  });
});

/**
 * The source's own rule for which environment an endpoint sells into.
 *
 * Ported from its `xe_endpoint_dim` view rather than invented, because the
 * view is denied to this sign-in and the table underneath it is not. Checked
 * against the view on all 380 demand endpoints it has: same answer every time.
 * These pin the branches, so a change here has to be a deliberate one.
 */
describe('the environment rule, as the source writes it', () => {
  it('calls an endpoint that targets only televisions CTV', () => {
    expect(environmentOf({ targeting: { device: { ctv: true } }, environments: { inapp: true } })).toBe('CTV');
  });

  it('does not, once it also targets phones', () => {
    // A buyer taking CTV and mobile is not a CTV buyer; it is an app buyer
    // that will also take a television.
    expect(environmentOf({
      targeting: { device: { ctv: true, mobile: true } },
      environments: { inapp: true },
    })).toBe('INAPP');
  });

  it('reads CTV or OTT in the name as a word, not as letters inside one', () => {
    expect(environmentOf({ name: 'Nexxen CTV EU', environments: { inapp: true } })).toBe('CTV');
    expect(environmentOf({ name: 'OTT-DSP-1', environments: { web: true } })).toBe('CTV');
    // "Scottish" and "Lottery" contain ott and must not become televisions.
    expect(environmentOf({ name: 'Lottery Media', environments: { web: true } })).toBe('WEB');
  });

  it('sends an endpoint that sells both ways to the web', () => {
    // The source's own default, and the reason it is written down: guessing
    // the other way would move real money onto the app tile.
    expect(environmentOf({ environments: { inapp: true, web: true } })).toBe('WEB');
  });

  it('accepts the flags as strings, which is how the source writes them', () => {
    expect(environmentOf({ environments: { inapp: 'true', web: 'false' } })).toBe('INAPP');
  });

  it('answers nothing rather than guessing when there is no signal', () => {
    expect(environmentOf({ name: 'Anonymous', environments: {} })).toBe(null);
  });
});

describe('Google CTV', () => {
  it('counts a set-top box as a television', () => {
    const days = googleCtvLine([
      { report_date: '2026-08-01', device_category: 'connected tv', site_id: 1, revenue: 10, impressions: 100 },
      { report_date: '2026-08-01', device_category: 'Set-Top Box', site_id: 2, revenue: 5, impressions: 50 },
      { report_date: '2026-08-01', device_category: 'desktop', site_id: 3, revenue: 99, impressions: 999 },
    ]);
    expect(days[0].gross_cents).toBe(1_500);
    expect(days[0].entities).toBe(2);
  });
});

/**
 * The publisher book, rebuilt from the site detail.
 *
 * The source's own overview report now answers "platform_only: this data is
 * served through the application, not directly" — someone closed it on
 * purpose. Every column below is checked against what that report returned for
 * 24 August, the last day it answered.
 */
describe('the publisher book', () => {
  const accounts = new Map([
    ['10', { ars_id: 10, name: 'Represented' }],
    ['20', { ars_id: 20, name: 'Resold', is_trading_account: true }],
  ]);
  const shareAt = revShareLookup([
    { ars_site_id: 1, effective_date: '2026-01-01', rev_share_pct: 20 },
    { ars_site_id: 1, effective_date: '2026-07-01', rev_share_pct: 10 },
  ]);
  const rows = [
    { report_date: '2026-08-24', ars_site_id: 1, ars_account_id: 10, source_name: 'OpenX', category: 'header_bidding', gross_revenue: 100, source_profit_usd: 5, publisher_revenue: 95, impressions: 1000 },
    { report_date: '2026-08-24', ars_site_id: 2, ars_account_id: 10, source_name: 'OpenX', category: 'header_bidding', gross_revenue: 50, source_profit_usd: 2, publisher_revenue: 48, impressions: 500 },
    { report_date: '2026-08-24', ars_site_id: 9, ars_account_id: 20, source_name: 'OpenX', category: 'header_bidding', gross_revenue: 999, source_profit_usd: 99, publisher_revenue: 900, impressions: 9999 },
  ];

  it('takes the fee column as the demand source’s cut, which is what the report called it', () => {
    const [day] = publishersDaysFromDetail(rows, accounts, new Set(), shareAt);
    expect(day.pub_gross_cents).toBe(15_000);
    expect(day.pub_source_fee_cents).toBe(700);
    expect(day.pub_net_after_fee_cents).toBe(14_300);
  });

  it('splits what is left by our share, not the publisher’s', () => {
    // rev_share_pct is OURS. Read the other way a 10% margin becomes 90%,
    // which is the sort of wrong that looks like a very good month.
    const [day] = publishersDaysFromDetail(rows, accounts, new Set(), shareAt);
    expect(day.pub_profit_cents).toBe(950); // $95 × 10%
    expect(day.pub_payout_cents).toBe(13_350);
  });

  it('prices a day at the share in force on that day', () => {
    expect(shareAt(1, '2026-08-24')).toBe(10);
    expect(shareAt(1, '2026-03-01')).toBe(20);
    // Before the first agreement there is no share to apply.
    expect(shareAt(1, '2025-12-31')).toBe(null);
  });

  it('claims no margin on a site nobody has recorded a share for', () => {
    // Twenty of five hundred sites are in that state on a given day. Treating
    // a missing share as a hundred per cent would flatter the book, which is
    // the wrong direction for this figure to be wrong in.
    const [day] = publishersDaysFromDetail(rows, accounts, new Set(), shareAt);
    expect(shareAt(2, '2026-08-24')).toBe(null);
    expect(day.pub_profit_cents).toBe(950);
  });

  it('leaves trading accounts out, as the report did', () => {
    const [day] = publishersDaysFromDetail(rows, accounts, new Set(), shareAt);
    expect(day.pub_gross_cents).toBe(15_000);
  });
});

/**
 * What the P&L is allowed to overwrite.
 *
 * The source closed two of its reporting functions today. The sync answered by
 * writing a column of zeroes where each of them used to be, and twelve days of
 * the publisher and seat-lease books went to nothing — which on the screen is
 * indistinguishable from a business that stopped. These pin the two ways that
 * must not happen again.
 */
describe('the four books of the P&L', () => {
  const at = new Date('2026-09-05T00:00:00Z');
  const publishers = [{ date: '2026-08-24', pub_gross_cents: 2_339_253, pub_profit_cents: 353_347 }];
  const bidder = [{ date: '2026-08-24', bidder_gross_cents: 144_000 }];

  it('writes only the columns of the books that answered', () => {
    const { columns } = mergeDays(
      { publishers, seat: null, bidder, exchange: null },
      at,
    );
    expect(columns).toEqual([...PL_BOOKS.publishers, ...PL_BOOKS.bidder]);
    expect(columns).not.toContain('seat_gross_cents');
  });

  it('leaves a refused book’s columns out of the row entirely', () => {
    // Not zero, and not null — absent, so the upsert never names the column
    // and the day keeps the figure it already had.
    const { rows } = mergeDays({ publishers, seat: null, bidder, exchange: null }, at);
    expect(rows[0]).not.toHaveProperty('seat_gross_cents');
    expect(rows[0].pub_gross_cents).toBe(2_339_253);
  });

  it('still writes a real zero for a day a book that answered earned nothing', () => {
    // A quiet Sunday on the bidder is a fact. Dropping it would take the whole
    // day out of a SUM further up and understate the month.
    const quiet = [{ date: '2026-08-24', bidder_gross_cents: 0 }, { date: '2026-08-25', bidder_gross_cents: 144_000 }];
    const { rows } = mergeDays({ publishers: null, seat: null, bidder: quiet, exchange: null }, at);
    expect(rows[0].bidder_gross_cents).toBe(0);
  });

  it('drops a book that came back with no money at all, and says which', () => {
    // How the publisher book was written with the right gross and a margin of
    // zero: the detail read was missing publisher_revenue, so both columns
    // computed off a column that was not there. Silent, and wrong.
    const nothing = [{ date: '2026-08-24', pub_gross_cents: 0, pub_profit_cents: 0 }];
    const { columns, empty } = mergeDays({ publishers: nothing, seat: null, bidder, exchange: null }, at);
    expect(empty).toEqual(['publishers']);
    expect(columns).not.toContain('pub_gross_cents');
  });

  it('knows money from no money', () => {
    expect(bookHasMoney([{ date: 'x', pub_gross_cents: 0 }])).toBe(false);
    expect(bookHasMoney([{ date: 'x', pub_gross_cents: 1 }])).toBe(true);
    // Impressions are not money: a book with traffic and no revenue read wrong.
    expect(bookHasMoney([{ date: 'x', pub_gross_cents: 0, pub_impressions: 900 }])).toBe(false);
    expect(bookHasMoney([])).toBe(false);
  });

  it('treats a refused book and an empty one the same way at the column level', () => {
    expect(bookOrNull(publishers, true)).toBe(null);
    expect(bookOrNull(publishers, false)).toBe(publishers);
  });

  it('accounts for every P&L column exactly once', () => {
    // A column in the table but in no book would never be written by anything.
    expect(PL_NUMERIC.length).toBe(new Set(PL_NUMERIC).size);
    expect(PL_NUMERIC.length).toBe(Object.values(PL_BOOKS).flat().length);
  });
});

/**
 * Twelve months, and no further back.
 *
 * A floor rather than a suggestion: the run that walked the source's whole
 * history is the one he asked me to stop. It rolls with the calendar because
 * "a year back" in September reaches into the previous autumn, which a fixed
 * New Year's Day floor would have refused.
 */
describe('the window', () => {
  const today = '2026-09-05';

  it('reaches back exactly twelve months', () => {
    expect(historyFloor(today)).toBe('2025-09-05');
    expect(HISTORY_DAYS).toBe(365);
  });

  it('refuses to go further back than that', () => {
    expect(clampToHistory('2024-01-01', today)).toBe('2025-09-05');
    expect(clampToHistory('2025-01-01', today)).toBe('2025-09-05');
  });

  it('leaves a window inside the twelve months alone', () => {
    expect(clampToHistory('2025-11-01', today)).toBe('2025-11-01');
    expect(clampToHistory('2026-06-01', today)).toBe('2026-06-01');
  });

  it('moves with the calendar rather than standing on New Year', () => {
    // The whole point of the change: the same request asked on two days gets
    // two different floors, and neither of them is 1 January.
    expect(historyFloor('2026-12-31')).toBe('2025-12-31');
    expect(historyFloor('2027-03-01')).toBe('2026-03-01');
  });
});

/** One row out of the seat aggregation, for the assertions below. */
interface Row {
  side: string;
  seat: string;
  revenue_cents: number;
  cost_cents: number;
  profit_cents: number;
  impressions: number;
  endpoints: number;
}

describe('the seats', () => {
  const rows = [
    { report_date: '2026-08-01', ssp_id: 's1', ssp_name: 'magnite', dsp_id: 'd1', dsp_name: 'thetradedesk', revenue: 100, dsp_spend: 60, impressions: 1000, requests: 5000 },
    { report_date: '2026-08-01', ssp_id: 's2', ssp_name: 'nexxen', dsp_id: 'd1', dsp_name: 'thetradedesk', revenue: 50, dsp_spend: 30, impressions: 500, requests: 2000 },
    { report_date: '2026-08-01', ssp_id: null, ssp_name: null, dsp_id: null, dsp_name: null, revenue: 150, dsp_spend: 90, impressions: 1500, requests: 7000 },
  ];

  it('answers both sides from the same rows', () => {
    const seats: Row[] = seatDaysFrom(rows);
    const demand = seats.filter((s) => s.side === 'demand');
    const supply = seats.filter((s) => s.side === 'supply');
    expect(demand.map((s) => s.seat)).toEqual(['thetradedesk']);
    expect(supply.map((s) => s.seat).sort()).toEqual(['magnite', 'nexxen']);
  });

  it('rolls a demand seat up across every endpoint it bought through', () => {
    const [ttd] = (seatDaysFrom(rows) as Row[]).filter((s) => s.side === 'demand');
    expect(ttd).toBeDefined();
    expect(ttd!.revenue_cents).toBe(15_000);
    expect(ttd!.cost_cents).toBe(9_000);
    expect(ttd!.profit_cents).toBe(6_000);
    expect(ttd!.impressions).toBe(1_500);
    // Two endpoints: it bought through magnite and through nexxen.
    expect(ttd!.endpoints).toBe(2);
  });

  it('leaves the un-split total out of both sides', () => {
    // A row with neither an SSP nor a DSP is the day's total, and belongs to
    // the P&L rather than to a seat — counting it would double every figure.
    const seats: Row[] = seatDaysFrom(rows);
    expect(seats.every((s) => s.seat !== null && String(s.seat) !== 'null')).toBe(true);
    const supplyRevenue = seats
      .filter((s) => s.side === 'supply')
      .reduce((a, s) => a + s.revenue_cents, 0);
    expect(supplyRevenue).toBe(15_000);
  });
});
