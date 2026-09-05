import { describe, expect, it } from 'vitest';
// @ts-expect-error — the jobs are plain ESM with no types.
// eslint-disable-next-line prettier/prettier
import { appsLine, bidderDays, cents, coreClientsLine, ctvLine, eachDay, exchangeDays, googleCtvLine, publishersDay, rollupLine, seatDaysFrom, seatDays } from '@/deploy/adops-aggregate.mjs';

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

describe('the engines cut out of the site rollup', () => {
  const rows = [
    { report_date: '2026-08-01', category: 'video', src_ignored: false, ars_site_id: 1, gross_revenue: 10, source_profit_usd: 3, impressions: 100 },
    { report_date: '2026-08-01', category: 'video', src_ignored: false, ars_site_id: 2, gross_revenue: 5, source_profit_usd: 1, impressions: 50 },
    { report_date: '2026-08-01', category: 'video', src_ignored: true, ars_site_id: 3, gross_revenue: 99, source_profit_usd: 99, impressions: 999 },
    { report_date: '2026-08-01', category: 'header_bidding', src_ignored: false, ars_site_id: 4, gross_revenue: 7, source_profit_usd: 2, impressions: 70 },
  ];

  it('keeps only its own category', () => {
    const [video] = rollupLine(rows, 'video');
    expect(video.gross_cents).toBe(1_500);
    const [display] = rollupLine(rows, 'header_bidding');
    expect(display.gross_cents).toBe(700);
  });

  it('leaves out what the source has marked ignored', () => {
    // The source has already decided those do not count.
    const [video] = rollupLine(rows, 'video');
    expect(video.entities).toBe(2);
    expect(video.impressions).toBe(150);
  });
});

describe('CTV', () => {
  it('is the environment the request came from, not one endpoint guess', () => {
    const days = ctvLine([
      { report_date: '2026-08-01', env_type: 'CTV', dsp_id: 'x', revenue: 10, profit: 4, impressions: 100 },
      { report_date: '2026-08-01', env_type: 'CTV', dsp_id: 'y', revenue: 5, profit: 1, impressions: 50 },
      { report_date: '2026-08-01', env_type: 'MOBILE', dsp_id: 'z', revenue: 99, profit: 99, impressions: 999 },
    ]);
    expect(days[0].gross_cents).toBe(1_500);
    expect(days[0].profit_cents).toBe(500);
    expect(days[0].entities).toBe(2);
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

describe('apps', () => {
  it('counts an app once however many ad units it has', () => {
    const days = appsLine([
      { report_date: '2026-08-01', app_id: 'a', site_id: 1, revenue: 4, impressions: 40 },
      { report_date: '2026-08-01', app_id: 'a', site_id: 1, revenue: 6, impressions: 60 },
      { report_date: '2026-08-01', app_id: null, site_id: 2, revenue: 5, impressions: 50 },
    ]);
    expect(days[0].gross_cents).toBe(1_500);
    expect(days[0].entities).toBe(2);
  });
});

describe('core publishers', () => {
  it('takes profit as what is left after the fee and the payout', () => {
    const [day] = coreClientsLine([
      { report_date: '2026-08-01', gross: 100, source_fee: 10, net_after_fee: 90, net: 70 },
    ]);
    expect(day.gross_cents).toBe(10_000);
    expect(day.profit_cents).toBe(2_000);
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
