import { and, eq, inArray } from 'drizzle-orm';
import { db, entityLines } from '@/lib/db';
import type { ActivityLine } from './lines';
import { cleanLines, type Taggable } from './pillars';

/**
 * Tagging work to the pillars it belongs to.
 *
 * He asked to be able to see the whole company by department: a task, a deal
 * or a contract carries one or more of the revenue engines, and every screen can
 * then be read one pillar at a time. The pillar is the same key the revenue
 * source reports against, so "Exchange CTV" on the overview tile and "Exchange
 * CTV" on a contract are the same thing — not two taxonomies that drift.
 *
 * More than one on purpose. A contract with a publisher who runs display and
 * CTV belongs to both, and forcing a choice would make the filter lie about
 * half the board.
 */

/** The pillars on one thing. */
export async function linesFor(type: Taggable, id: string): Promise<ActivityLine[]> {
  const rows = await db
    .select({ line: entityLines.line })
    .from(entityLines)
    .where(and(eq(entityLines.entityType, type), eq(entityLines.entityId, id)));
  return cleanLines(rows.map((r) => r.line));
}

/**
 * The pillars on many things at once.
 *
 * One query for a whole list. A board of forty contracts asking for its own
 * tags is forty queries for six words each, which is how a screen that was
 * fast becomes a screen he waits for.
 */
export async function linesForMany(
  type: Taggable,
  ids: string[],
): Promise<Map<string, ActivityLine[]>> {
  const out = new Map<string, ActivityLine[]>();
  if (ids.length === 0) return out;

  const rows = await db
    .select({ id: entityLines.entityId, line: entityLines.line })
    .from(entityLines)
    .where(and(eq(entityLines.entityType, type), inArray(entityLines.entityId, ids)));

  const gathered = new Map<string, string[]>();
  for (const r of rows) {
    const list = gathered.get(r.id) ?? [];
    list.push(r.line);
    gathered.set(r.id, list);
  }
  for (const [id, list] of gathered) out.set(id, cleanLines(list));
  return out;
}

/** Set the pillars on one thing to exactly this set. */
export async function setLines(
  type: Taggable,
  id: string,
  lines: readonly string[],
  actor: string,
): Promise<ActivityLine[]> {
  const wanted = cleanLines(lines);

  await db
    .delete(entityLines)
    .where(and(eq(entityLines.entityType, type), eq(entityLines.entityId, id)));

  if (wanted.length > 0) {
    await db
      .insert(entityLines)
      .values(wanted.map((line) => ({ entityType: type, entityId: id, line, taggedBy: actor })))
      .onConflictDoNothing();
  }

  return wanted;
}

/** The things of one kind carrying a pillar, for a filtered screen. */
export async function idsOnLine(type: Taggable, line: string): Promise<string[]> {
  const rows = await db
    .select({ id: entityLines.entityId })
    .from(entityLines)
    .where(and(eq(entityLines.entityType, type), eq(entityLines.line, line)));
  return rows.map((r) => r.id);
}

/** How much work sits on each pillar, for the count on its tile. */
export async function workPerLine(): Promise<Map<string, Record<Taggable, number>>> {
  const rows = await db
    .select({ line: entityLines.line, type: entityLines.entityType })
    .from(entityLines);

  const out = new Map<string, Record<Taggable, number>>();
  for (const r of rows) {
    const held = out.get(r.line) ?? { task: 0, deal: 0, contract: 0 };
    if (r.type === 'task' || r.type === 'deal' || r.type === 'contract') held[r.type] += 1;
    out.set(r.line, held);
  }
  return out;
}

// The browser-safe half — the seven, their labels, and what a form may send —
// lives in ./pillars, and is re-exported so server callers have one import.
export { cleanLines, PILLAR_OPTIONS, TAGGABLE, type Taggable } from './pillars';
