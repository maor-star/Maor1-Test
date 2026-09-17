import { asc, eq, sql } from 'drizzle-orm';
import { db, pillars } from '@/lib/db';
import { ACTIVITY_LINES, LINE_LABEL, LINE_SOURCE, LINE_UNIT } from './lines';
import { lineKeyFor, type PillarOption } from './pillars';

/**
 * The pillar list, read from the table he edits.
 *
 * Every screen that shows the chip row reads this rather than the constant in
 * ./lines, so renaming EXCHANGE DISPLAY renames it on Tasks, Pipeline,
 * Contracts and the overview at once and without a deploy.
 *
 * The constant has not gone: it is what the table is seeded with, and it is
 * what these functions answer with if the table has not been created yet — a
 * fresh database or a checkout whose migrations have not run should show the
 * seven, not an empty filter row.
 */

export interface Pillar {
  line: string;
  label: string;
  unit: string | null;
  sourceNote: string | null;
  sortOrder: number;
  active: boolean;
  /** True for the seven the activity sync reports figures against. */
  hasRevenue: boolean;
  /**
   * The department this pillar is, when it is one.
   *
   * One list, because he said they were the same question asked twice. What he
   * picks is the pillar; this is what still sets `tasks.dept_id` underneath.
   */
  deptId: string | null;
}

/** The built-in seven, in the shape the table stores them. */
export const SEEDED: Pillar[] = ACTIVITY_LINES.map((line, i) => ({
  line,
  label: LINE_LABEL[line],
  unit: LINE_UNIT[line],
  sourceNote: LINE_SOURCE[line],
  sortOrder: (i + 1) * 10,
  active: true,
  hasRevenue: true,
  deptId: null,
}));

async function rows(): Promise<Pillar[]> {
  try {
    const found = await db
      .select()
      .from(pillars)
      .orderBy(asc(pillars.sortOrder), asc(pillars.label));
    // An empty table is the same situation as no table: show the seven.
    if (found.length === 0) return SEEDED;
    return found.map((r) => ({
      line: r.line,
      label: r.label,
      unit: r.unit,
      sourceNote: r.sourceNote,
      sortOrder: r.sortOrder,
      active: r.active,
      hasRevenue: r.hasRevenue,
      deptId: r.deptId,
    }));
  } catch {
    // The table arrives in migration 0053. Until it has run, the app still works.
    return SEEDED;
  }
}

/** Every pillar, hidden ones included — the editor's list. */
export async function allPillars(): Promise<Pillar[]> {
  return rows();
}

/** The pillars that show on the boards. */
export async function livePillars(): Promise<Pillar[]> {
  return (await rows()).filter((p) => p.active);
}

/** The chip row, as a filter or a picker needs it. */
export async function pillarOptions(): Promise<PillarOption[]> {
  return (await livePillars()).map((p) => ({ line: p.line, label: p.label }));
}

/**
 * Every key that has ever been a pillar, hidden ones included.
 *
 * This is what a saved tag is checked against, not the visible list: hiding a
 * pillar takes it off the chip row, and must not strip it off the forty
 * contracts already carrying it the next time one of them is saved.
 */
export async function knownLines(): Promise<string[]> {
  return (await rows()).map((p) => p.line);
}

/** One pillar by key, for a screen that has only the key. */
export async function pillarLabels(): Promise<Map<string, string>> {
  return new Map((await rows()).map((p) => [p.line, p.label]));
}

/**
 * Which department a set of picked pillars means.
 *
 * `tasks.dept_id` is a single column and the picker is a multi-select, so the
 * rule has to be stated rather than assumed: the FIRST picked pillar that is a
 * department wins, in the order he ticked them. Tagging a task Exchange CTV and
 * Finance files it under CTV and tags it Finance, which is what picking them in
 * that order means.
 *
 * Returns undefined when none of the picked pillars is a department — that is
 * "leave the column alone", not "clear it", because Google CTV is a pillar with
 * no department behind it and picking it must not un-file the task.
 */
export async function deptForLines(lines: readonly string[]): Promise<string | undefined> {
  if (lines.length === 0) return undefined;
  const byLine = new Map((await allPillars()).map((p) => [p.line, p.deptId]));
  for (const line of lines) {
    const deptId = byLine.get(line);
    if (deptId) return deptId;
  }
  return undefined;
}

/** The pillar that stands for a department, for filling the picker from one. */
export async function lineForDept(deptId: string | null): Promise<string | null> {
  if (!deptId) return null;
  return (await allPillars()).find((p) => p.deptId === deptId)?.line ?? null;
}

/* ---------------------------------------------------------------- writing */

export interface SaveResult {
  ok: boolean;
  error?: string;
  line?: string;
}

const MAX_LABEL = 40;

function checkLabel(label: string): string | null {
  const name = label.trim();
  if (name.length === 0) return 'A pillar needs a name';
  if (name.length > MAX_LABEL) return `Keep the name under ${MAX_LABEL} characters`;
  return null;
}

/**
 * Make sure the seven are in the table before writing to it.
 *
 * The migration seeds them, but a rename arriving against a table that somehow
 * has no rows would otherwise write one row and leave the other six to the
 * fallback — which is a list of one. Seeding on the way in costs one statement
 * and removes that whole class of half-state.
 */
async function ensureSeeded(): Promise<void> {
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(pillars);
  if (n > 0) return;
  await db
    .insert(pillars)
    .values(SEEDED.map((p) => ({ ...p })))
    .onConflictDoNothing();
}

/** Rename a pillar, or change what its tile says. The key never moves. */
export async function editPillar(
  line: string,
  patch: { label?: string; unit?: string | null; sourceNote?: string | null },
  actor: string,
): Promise<SaveResult> {
  await ensureSeeded();
  const update: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actor };

  if (patch.label !== undefined) {
    const bad = checkLabel(patch.label);
    if (bad) return { ok: false, error: bad };
    update.label = patch.label.trim();
  }
  if (patch.unit !== undefined) update.unit = patch.unit?.trim() || null;
  if (patch.sourceNote !== undefined) update.sourceNote = patch.sourceNote?.trim() || null;

  const done = await db.update(pillars).set(update).where(eq(pillars.line, line)).returning();
  if (done.length === 0) return { ok: false, error: 'No such pillar' };
  return { ok: true, line };
}

/**
 * Add a pillar.
 *
 * It can be tagged, filtered and counted from the moment it is saved. It gets
 * no tile on the overview: the tiles read the activity sync, the sync reports
 * against the seven it knows, and a tile with nothing behind it would show a
 * zero that reads like a collapse. `hasRevenue` stays false and says so.
 */
export async function addPillar(label: string, actor: string): Promise<SaveResult> {
  await ensureSeeded();
  const bad = checkLabel(label);
  if (bad) return { ok: false, error: bad };

  const name = label.trim();
  const existing = await rows();
  if (existing.some((p) => p.label.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: 'There is already a pillar by that name' };
  }

  // The key is derived from the name, then made unique — two pillars named in
  // Hebrew both reduce to the same stamped key otherwise.
  const base = lineKeyFor(name);
  const taken = new Set(existing.map((p) => p.line));
  let key = base;
  for (let i = 2; taken.has(key); i += 1) key = `${base}_${i}`;

  const last = existing.reduce((m, p) => Math.max(m, p.sortOrder), 0);
  await db
    .insert(pillars)
    .values({
      line: key,
      label: name,
      sortOrder: last + 10,
      active: true,
      hasRevenue: false,
      updatedBy: actor,
    })
    .onConflictDoNothing();

  return { ok: true, line: key };
}

/** Show or hide a pillar. Nothing is deleted, and no tag is touched. */
export async function setPillarActive(
  line: string,
  active: boolean,
  actor: string,
): Promise<SaveResult> {
  await ensureSeeded();
  const done = await db
    .update(pillars)
    .set({ active, updatedAt: new Date(), updatedBy: actor })
    .where(eq(pillars.line, line))
    .returning();
  if (done.length === 0) return { ok: false, error: 'No such pillar' };
  return { ok: true, line };
}

/**
 * Move a pillar one place up or down the row.
 *
 * Swapping the two sort values rather than renumbering the list, so two people
 * moving different pillars cannot renumber each other's.
 */
export async function movePillar(
  line: string,
  direction: 'up' | 'down',
  actor: string,
): Promise<SaveResult> {
  await ensureSeeded();
  const list = await rows();
  const at = list.findIndex((p) => p.line === line);
  if (at === -1) return { ok: false, error: 'No such pillar' };

  const mine = list[at];
  const swapWith = direction === 'up' ? list[at - 1] : list[at + 1];
  // Already at the end of the row, which is not a failure — there is simply
  // nowhere further to go.
  if (!mine || !swapWith) return { ok: true, line };
  // Equal sort values would make the swap a no-op; give them distinct ones.
  const a = mine.sortOrder;
  const b = swapWith.sortOrder === a ? a + (direction === 'up' ? 1 : -1) : swapWith.sortOrder;

  await db.update(pillars).set({ sortOrder: b, updatedAt: new Date(), updatedBy: actor })
    .where(eq(pillars.line, mine.line));
  await db.update(pillars).set({ sortOrder: a, updatedAt: new Date(), updatedBy: actor })
    .where(eq(pillars.line, swapWith.line));

  return { ok: true, line };
}
