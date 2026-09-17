import { describe, expect, it, beforeEach } from 'vitest';
import { db, pillars } from '@/lib/db';
import { ACTIVITY_LINES } from '@/lib/control/lines';
import { cleanLines, lineKeyFor, PILLAR_OPTIONS } from '@/lib/control/pillars';
import {
  addPillar, allPillars, editPillar, knownLines, livePillars, movePillar, pillarOptions,
  setPillarActive, SEEDED,
} from '@/lib/control/pillar-store';
import { eq, inArray, notInArray } from 'drizzle-orm';

const ACTOR = 'maor@adnimation.com';

/**
 * The pillar list is his to edit, and the things that must not break when he
 * does: the key never moves, nothing is deleted, and a pillar he adds himself
 * never claims a revenue tile it has no source for.
 */
async function resetToSeed() {
  // Everything that is not one of the seven goes; the seven go back to seed.
  await db.delete(pillars).where(notInArray(pillars.line, [...ACTIVITY_LINES]));
  for (const p of SEEDED) {
    await db
      .insert(pillars)
      .values(p)
      .onConflictDoUpdate({
        target: pillars.line,
        set: { label: p.label, unit: p.unit, sourceNote: p.sourceNote, sortOrder: p.sortOrder, active: true, hasRevenue: true },
      });
  }
}

beforeEach(resetToSeed);

describe('the list as it ships', () => {
  it('is seeded with exactly the seven the app was built around', async () => {
    const list = await allPillars();
    expect(list.map((p) => p.line)).toEqual([...ACTIVITY_LINES]);
    expect(list.every((p) => p.hasRevenue)).toBe(true);
  });

  it('shows the same labels the compiled-in constant did', async () => {
    const live = await pillarOptions();
    expect(live).toEqual(PILLAR_OPTIONS.map((p) => ({ line: p.line, label: p.label })));
  });
});

describe('renaming', () => {
  it('changes the name and leaves the key alone', async () => {
    const done = await editPillar('rtb_display', { label: 'WEB EXCHANGE' }, ACTOR);
    expect(done.ok).toBe(true);

    const list = await allPillars();
    const row = list.find((p) => p.line === 'rtb_display');
    expect(row?.label).toBe('WEB EXCHANGE');
    // The key is what every tag and every target stores. If a rename moved it,
    // every task tagged with the old key would fall off its own filter.
    expect(list.map((p) => p.line)).toEqual([...ACTIVITY_LINES]);
  });

  it('refuses an empty name rather than storing one', async () => {
    const done = await editPillar('bidder', { label: '   ' }, ACTOR);
    expect(done.ok).toBe(false);
    expect((await allPillars()).find((p) => p.line === 'bidder')?.label).toBe('BIDDER');
  });
});

describe('adding', () => {
  it('adds one that can be tagged but claims no revenue tile', async () => {
    const done = await addPillar('Seat lease', ACTOR);
    expect(done.ok).toBe(true);

    const added = (await allPillars()).find((p) => p.line === done.line);
    expect(added?.label).toBe('Seat lease');
    expect(added?.hasRevenue).toBe(false);
    // Last in the row, not first.
    expect((await pillarOptions()).at(-1)?.line).toBe(done.line);
  });

  it('turns the name into an ASCII key even when the name is not', async () => {
    const done = await addPillar('מחלקת תוכן', ACTOR);
    expect(done.ok).toBe(true);
    expect(done.line).toMatch(/^[a-z0-9_]+$/);
  });

  it('will not add a second pillar by the same name', async () => {
    await addPillar('Seat lease', ACTOR);
    const again = await addPillar('seat LEASE', ACTOR);
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/already/i);
  });

  it('gives two pillars with the same derived key different keys', async () => {
    const a = await addPillar('תוכן', ACTOR);
    const b = await addPillar('שיווק', ACTOR);
    expect(a.line).not.toBe(b.line);
  });
});

describe('hiding', () => {
  it('takes it off the boards and keeps it as a known key', async () => {
    await setPillarActive('ctv', false, ACTOR);

    expect((await livePillars()).map((p) => p.line)).not.toContain('ctv');
    // The tags already written stay valid: a saved card must not silently
    // lose a pillar because the pillar was taken off the chip row.
    expect(await knownLines()).toContain('ctv');
    expect(cleanLines(['ctv'], await knownLines())).toEqual(['ctv']);
  });

  it('brings everything back when it is switched on again', async () => {
    await setPillarActive('ctv', false, ACTOR);
    await setPillarActive('ctv', true, ACTOR);
    expect((await livePillars()).map((p) => p.line)).toContain('ctv');
  });

  it('never deletes a row', async () => {
    await setPillarActive('ctv', false, ACTOR);
    const rows = await db.select().from(pillars).where(eq(pillars.line, 'ctv'));
    expect(rows).toHaveLength(1);
  });
});

describe('ordering', () => {
  it('moves one place up and holds the rest still', async () => {
    const before = (await pillarOptions()).map((p) => p.line);
    const done = await movePillar(before[2]!, 'up', ACTOR);
    expect(done.ok).toBe(true);

    const after = (await pillarOptions()).map((p) => p.line);
    expect(after[1]).toBe(before[2]);
    expect(after[2]).toBe(before[1]);
    expect(after.slice(3)).toEqual(before.slice(3));
  });

  it('is a no-op at the top rather than an error', async () => {
    const before = (await pillarOptions()).map((p) => p.line);
    const done = await movePillar(before[0]!, 'up', ACTOR);
    expect(done.ok).toBe(true);
    expect((await pillarOptions()).map((p) => p.line)).toEqual(before);
  });
});

describe('what counts as a pillar', () => {
  it('keeps a value the list has never heard of off a card', () => {
    expect(cleanLines(['ctv', 'not_a_pillar'], [...ACTIVITY_LINES])).toEqual(['ctv']);
  });

  it('accepts one he added, once it is in the known list', async () => {
    const done = await addPillar('Seat lease', ACTOR);
    expect(cleanLines([done.line!], await knownLines())).toEqual([done.line]);
  });

  it('never returns an empty key from a name that reduces to nothing', () => {
    expect(lineKeyFor('•••')).not.toBe('');
    expect(lineKeyFor('  Exchange  CTV ')).toBe('exchange_ctv');
  });
});
