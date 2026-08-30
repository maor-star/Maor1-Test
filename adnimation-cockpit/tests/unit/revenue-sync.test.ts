import { describe, expect, it } from 'vitest';
// @ts-expect-error — the deploy jobs are plain ESM, deliberately dependency-free.
import { NUMERIC, assertSelect, assertWorthWriting, buildQueries, mergeDays } from '@/deploy/revenue-source.mjs';

/**
 * The revenue sync, in the two places it could do real damage.
 *
 * The Ad Ops Architect system is the live system the ad ops team works in and
 * is read-only to us, so the guard that keeps every statement a SELECT is not
 * a nicety — it is the rule, and it should be as hard to break by accident as
 * any other invariant in this codebase.
 *
 * The second is the merge. Four result sets arrive with four different sets of
 * dates, and a missing figure has to become a zero rather than an undefined,
 * or a day silently drops out of every total downstream.
 */
describe('revenue sync — the read-only guard', () => {
  it('accepts the expressions the job actually sends', () => {
    const q = buildQueries('2026-08-21', '2026-08-30');
    for (const statement of Object.values(q)) {
      expect(() => assertSelect(statement)).not.toThrow();
    }
  });

  it.each([
    ['insert into company_daily values (1)'],
    ['update ars_sites set is_archived = true'],
    ['delete from trading_xe_reports'],
    ['drop table ars_sites'],
    ['truncate ars_site_daily_revenue'],
    ['alter table ars_sites add column x int'],
    ['grant all on ars_sites to public'],
  ])('refuses %s', (statement) => {
    expect(() => assertSelect(statement)).toThrow(/refusing/);
  });

  it('refuses a write smuggled in behind a SELECT', () => {
    expect(() =>
      assertSelect('select 1; drop table ars_sites'),
    ).toThrow(/write keyword/);
  });

  it('refuses a write hidden under a leading comment', () => {
    expect(() => assertSelect('-- select\ndelete from ars_sites')).toThrow(/non-SELECT/);
  });

  it('rejects a date that is not a plain ISO day', () => {
    expect(() => buildQueries("2026-08-21'; drop table x --", '2026-08-30')).toThrow(/YYYY-MM-DD/);
  });
});

describe('revenue sync — merging the four lines', () => {
  const pub = [{ date: '2026-08-29', pub_gross_cents: 2716821, pub_profit_cents: 374397 }];
  const seat = [{ date: '2026-08-29', seat_gross_cents: 685990, seat_profit_cents: 132542 }];
  const bidder = [{ date: '2026-08-29', bidder_gross_cents: 121334, bidder_profit_cents: 8141 }];
  const xe = [{ date: '2026-08-29', xe_revenue_cents: 56544, xe_profit_cents: 17142 }];

  it('puts all four lines on one row', () => {
    const [row] = mergeDays([pub, seat, bidder, xe]);
    expect(row.date).toBe('2026-08-29');
    expect(row.pub_profit_cents).toBe(374397);
    expect(row.seat_profit_cents).toBe(132542);
    expect(row.bidder_profit_cents).toBe(8141);
    expect(row.xe_profit_cents).toBe(17142);
  });

  it('fills every column, so a day can never be partly undefined', () => {
    const [row] = mergeDays([pub, [], [], []]);
    for (const col of NUMERIC) expect(typeof row[col]).toBe('number');
    expect(row.xe_revenue_cents).toBe(0);
  });

  it('keeps a day a line never reported, as a zero rather than a gap', () => {
    // The exchange all but stopped on 2026-08-30; the other lines still traded.
    const rows = mergeDays([
      [{ date: '2026-08-30', pub_gross_cents: 276455 }],
      [{ date: '2026-08-30', seat_gross_cents: 65032 }],
      [],
      [],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.xe_revenue_cents).toBe(0);
    expect(rows[0]!.bidder_gross_cents).toBe(0);
  });

  it('returns days in order, whichever line reported first', () => {
    const rows = mergeDays([
      [{ date: '2026-08-30', pub_gross_cents: 1 }],
      [{ date: '2026-08-28', seat_gross_cents: 1 }],
      [{ date: '2026-08-29', bidder_gross_cents: 1 }],
      [],
    ]);
    expect(rows.map((r: { date: string }) => r.date)).toEqual(['2026-08-28', '2026-08-29', '2026-08-30']);
  });

  it('ignores a column the source does not declare', () => {
    const [row] = mergeDays([[{ date: '2026-08-29', something_new: 5, pub_gross_cents: 7 }]]);
    expect(row.something_new).toBeUndefined();
    expect(row.pub_gross_cents).toBe(7);
  });
});

describe('revenue sync — refusing to write a bad pull', () => {
  it('refuses an empty pull rather than emptying the table', () => {
    expect(() => assertWorthWriting([])).toThrow(/no days at all/);
  });

  it('refuses an all-zero window rather than zeroing real days', () => {
    // What a source outage looks like: rows come back, all of them empty.
    const rows = mergeDays([
      [{ date: '2026-08-29' }],
      [{ date: '2026-08-29' }],
      [{ date: '2026-08-29' }],
      [{ date: '2026-08-29' }],
    ]);
    expect(() => assertWorthWriting(rows)).toThrow(/only zeroes/);
  });

  it('accepts a window where one line is dead but the others are not', () => {
    // The exchange collapsed to near nothing on 2026-08-29. That is a real day
    // and must still be written.
    const rows = mergeDays([
      [{ date: '2026-08-29', pub_gross_cents: 2716821 }],
      [], [],
      [{ date: '2026-08-29', xe_revenue_cents: 0 }],
    ]);
    expect(() => assertWorthWriting(rows)).not.toThrow();
  });
});
