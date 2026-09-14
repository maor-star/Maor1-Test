import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, people, taskAccess } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { isAccessLevel, normaliseEmail, type AccessLevel, type Grant } from '@/lib/tasks/access';

/**
 * Reading and writing who may see his tasks.
 *
 * The rules themselves are in access.ts with no database in the way. This is
 * only the storage, and the one thing it has to get right is that a revoked
 * grant is gone for every purpose except the record that it existed.
 */

/** The live grant for one address, or nothing. */
export async function grantFor(email: string): Promise<{ level: AccessLevel } | null> {
  const clean = normaliseEmail(email);
  const [row] = await db
    .select({ level: taskAccess.level })
    .from(taskAccess)
    .where(and(sql`lower(${taskAccess.email}) = ${clean}`, isNull(taskAccess.revokedAt)))
    .limit(1);

  // A level the table somehow holds but the code does not know is treated as
  // the narrower one rather than trusted.
  if (!row) return null;
  return { level: isAccessLevel(row.level) ? row.level : 'view' };
}

/** Everyone who can reach the board today, newest grant first. */
export async function listGrants(): Promise<Grant[]> {
  const rows = await db
    .select({
      id: taskAccess.id,
      email: taskAccess.email,
      level: taskAccess.level,
      grantedBy: taskAccess.grantedBy,
      grantedAt: taskAccess.grantedAt,
      personName: people.name,
    })
    .from(taskAccess)
    .leftJoin(people, eq(people.id, taskAccess.personId))
    .where(isNull(taskAccess.revokedAt))
    .orderBy(desc(taskAccess.grantedAt));

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    personName: r.personName,
    level: isAccessLevel(r.level) ? r.level : 'view',
    grantedBy: r.grantedBy,
    grantedAt: r.grantedAt,
  }));
}

/**
 * Let somebody in, or change the level of somebody already in.
 *
 * Re-granting an address that already has a live grant moves that grant rather
 * than adding a second one — two live rows for one person would leave the
 * sign-in gate reading whichever came back first.
 */
export async function grantAccess(
  email: string,
  level: AccessLevel,
  actor: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = normaliseEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
    return { ok: false, error: 'That does not look like an email address' };
  }

  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(sql`lower(${people.email}) = ${clean}`)
    .limit(1);

  const existing = await grantFor(clean);
  if (existing) {
    await db
      .update(taskAccess)
      .set({ level, grantedBy: actor, grantedAt: new Date() })
      .where(and(sql`lower(${taskAccess.email}) = ${clean}`, isNull(taskAccess.revokedAt)));
  } else {
    await db.insert(taskAccess).values({
      email: clean,
      personId: person?.id ?? null,
      level,
      grantedBy: actor,
    });
  }

  await writeAudit({
    actor,
    action: 'task_access.grant',
    entityType: 'task_access',
    entityId: clean,
    before: existing ? { level: existing.level } : null,
    after: { email: clean, level },
  });
  return { ok: true };
}

/**
 * Take it back.
 *
 * Marked revoked rather than deleted (CLAUDE.md §2). Who had access to the
 * board, and when it was taken away, is exactly the history worth keeping.
 */
export async function revokeAccess(
  email: string,
  actor: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = normaliseEmail(email);
  const existing = await grantFor(clean);
  if (!existing) return { ok: false, error: 'They do not have access' };

  await db
    .update(taskAccess)
    .set({ revokedAt: new Date(), revokedBy: actor })
    .where(and(sql`lower(${taskAccess.email}) = ${clean}`, isNull(taskAccess.revokedAt)));

  await writeAudit({
    actor,
    action: 'task_access.revoke',
    entityType: 'task_access',
    entityId: clean,
    before: { level: existing.level },
    after: null,
  });
  return { ok: true };
}
