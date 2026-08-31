import { describe, expect, it } from 'vitest';
import { contractCounts, listContracts } from '@/lib/contracts/intake-module';

/**
 * Listing contracts against a database that actually holds some.
 *
 * This exists because of a bug that reached production: the versions were
 * fetched with a hand-written `= any(...)` and a JS array, which Postgres
 * rejects with "op ANY/ALL requires array on right side". Every existing test
 * passed, because they were all pure functions and the only database test path
 * ran with an empty table — where the query is skipped entirely.
 *
 * So the thing under test here is not the filtering logic. It is that the
 * queries run at all when there is data, which is the case nothing covered.
 */
describe('contracts — listing with real rows', () => {
  it('lists without throwing, and loads each contract its versions', async () => {
    const rows = await listContracts('all');
    expect(Array.isArray(rows)).toBe(true);

    const seeded = rows.find((r) => r.counterpartyName === 'Testco Ltd');
    expect(seeded, 'the seeded contract should be listed').toBeDefined();
    expect(seeded!.versions.length).toBeGreaterThanOrEqual(2);
    // Newest first, so the current version is the one he reads.
    expect(seeded!.versions[0]!.versionNo).toBeGreaterThan(seeded!.versions[1]!.versionNo);
  });

  it('runs every view, since each one is a separate query path', async () => {
    for (const view of ['classify', 'on_you', 'on_them', 'signed', 'all'] as const) {
      const rows = await listContracts(view);
      expect(Array.isArray(rows)).toBe(true);
    }
  });

  it('counts without throwing', async () => {
    const counts = await contractCounts();
    expect(counts.needsClassifying).toBeGreaterThanOrEqual(1);
    expect(counts.notFiled).toBeGreaterThanOrEqual(2);
  });

  it('puts an unclassified contract in the classify view and nowhere else', async () => {
    const classify = await listContracts('classify');
    const onThem = await listContracts('on_them');
    expect(classify.some((r) => r.counterpartyName === 'Testco Ltd')).toBe(true);
    expect(onThem.some((r) => r.counterpartyName === 'Testco Ltd')).toBe(false);
  });
});
