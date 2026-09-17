import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { db, pillars } from '@/lib/db';
import { ACTIVITY_LINES } from '@/lib/control/lines';
import { cleanLines, lineKeyFor, PILLAR_OPTIONS } from '@/lib/control/pillars';
import {
  addPillar, allPillars, deptForLines, editPillar, knownLines, lineForDept, livePillars,
  movePillar, pillarOptions, setPillarActive, SEEDED,
} from '@/lib/control/pillar-store';
import { eq, notInArray } from 'drizzle-orm';

const ACTOR = 'maor@adnimation.com';

/**
 * The pillar list is his to edit, and the things that must not break when he
 * does: the key never moves, nothing is deleted, and a pillar he adds himself
 * never claims a revenue tile it has no source for.
 */
/*
 * The list as this database actually has it, captured once.
 *
 * Restoring to the seven would be wrong: the merge migration put every
 * department on the list too, and a test that deletes them is a test that
 * quietly undoes a migration. Each case puts back what it found.
 */
let snapshot: (typeof pillars.$inferSelect)[] = [];

beforeAll(async () => {
  snapshot = await db.select().from(pillars);
  if (snapshot.length === 0) {
    await db.insert(pillars).values(SEEDED).onConflictDoNothing();
    snapshot = await db.select().from(pillars);
  }
});

beforeEach(async () => {
  await db.delete(pillars).where(notInArray(pillars.line, snapshot.map((p) => p.line)));
  for (const p of snapshot) {
    await db
      .insert(pillars)
      .values(p)
      .onConflictDoUpdate({
        target: pillars.line,
        set: {
          label: p.label, unit: p.unit, sourceNote: p.sourceNote,
          sortOrder: p.sortOrder, active: p.active, hasRevenue: p.hasRevenue,
        },
      });
  }
});

describe('the list as it ships', () => {
  it('opens with the seven revenue engines, in their order, before anything else', async () => {
    const list = await allPillars();
    const withRevenue = list.filter((p) => p.hasRevenue).map((p) => p.line);
    expect(withRevenue).toEqual([...ACTIVITY_LINES]);
    // They sort ahead of the departments that joined the list in 0056, so the
    // chip row still opens on the engines.
    expect(list.slice(0, ACTIVITY_LINES.length).map((p) => p.line)).toEqual([...ACTIVITY_LINES]);
  });

  it('still calls the seven what the compiled-in constant called them', async () => {
    const live = await pillarOptions();
    for (const p of PILLAR_OPTIONS) {
      expect(live.find((l) => l.line === p.line)?.label).toBe(p.label);
    }
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
    expect(list.map((p) => p.line).sort()).toEqual(snapshot.map((p) => p.line).sort());
  });

  it('refuses an empty name rather than storing one', async () => {
    const done = await editPillar('bidder', { label: '   ' }, ACTOR);
    expect(done.ok).toBe(false);
    expect((await allPillars()).find((p) => p.line === 'bidder')?.label).toBe('BIDDER');
  });
});

describe('adding', () => {
  it('adds one that can be tagged but claims no revenue tile', async () => {
    const done = await addPillar('Podcast network', ACTOR);
    expect(done.ok).toBe(true);

    const added = (await allPillars()).find((p) => p.line === done.line);
    expect(added?.label).toBe('Podcast network');
    expect(added?.hasRevenue).toBe(false);
    // Last in the row, not first — the engines keep the front of the chips.
    expect((await pillarOptions()).at(-1)?.line).toBe(done.line);
  });

  it('turns the name into an ASCII key even when the name is not', async () => {
    const done = await addPillar('מחלקת תוכן', ACTOR);
    expect(done.ok).toBe(true);
    expect(done.line).toMatch(/^[a-z0-9_]+$/);
  });

  it('will not add a second pillar by the same name', async () => {
    await addPillar('Podcast network', ACTOR);
    const again = await addPillar('podcast NETWORK', ACTOR);
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
    const done = await addPillar('Podcast network', ACTOR);
    expect(cleanLines([done.line!], await knownLines())).toEqual([done.line]);
  });

  it('never returns an empty key from a name that reduces to nothing', () => {
    expect(lineKeyFor('•••')).not.toBe('');
    expect(lineKeyFor('  Exchange  CTV ')).toBe('exchange_ctv');
  });
});

/**
 * One list, one control.
 *
 * Department and pillar were two pickers answering the same question, and he
 * said so. `tasks.dept_id` is still a single column that the ClickUp mirror,
 * the contracts screen and the reports all read, so the rule that turns a
 * multi-select into one department has to hold exactly.
 */
describe('a pillar is the department', () => {
  it('files a task under the first picked pillar that is one', async () => {
    const list = await allPillars();
    const withDept = list.filter((p) => p.deptId);
    // Nothing to assert on a database the merge has not reached.
    if (withDept.length < 2) return;

    const [first, second] = withDept;
    expect(await deptForLines([first!.line, second!.line])).toBe(first!.deptId);
    expect(await deptForLines([second!.line, first!.line])).toBe(second!.deptId);
  });

  it('skips a pillar with no department behind it rather than clearing the column', async () => {
    const list = await allPillars();
    const noDept = list.find((p) => !p.deptId);
    const withDept = list.find((p) => p.deptId);
    if (!noDept || !withDept) return;

    // Google CTV is a pillar with no department. Picking it must not un-file
    // the task; the department pillar next to it still decides.
    expect(await deptForLines([noDept.line, withDept.line])).toBe(withDept.deptId);
    // And picking only it leaves the column alone, which is not the same as
    // setting it to null.
    expect(await deptForLines([noDept.line])).toBeUndefined();
  });

  it('answers nothing for an empty pick, so a save cannot silently un-file', async () => {
    expect(await deptForLines([])).toBeUndefined();
  });

  it('finds the pillar that stands for a department, and none for none', async () => {
    const withDept = (await allPillars()).find((p) => p.deptId);
    if (!withDept) return;
    expect(await lineForDept(withDept.deptId)).toBe(withDept.line);
    expect(await lineForDept(null)).toBeNull();
  });
});
