import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db, delegations, people } from '@/lib/db';

/**
 * Whether a thing has been handed over, for a whole screen at once.
 *
 * He asked for a DELEGATE TO column "so I know if I passed it on" — the
 * question a row could not answer before. A task he delegated on Tuesday
 * looked exactly like one he had not touched, so the only way to check was to
 * open the delegations screen and read down it.
 *
 * One query for the whole list rather than one per row, the same way the
 * pillars are fetched. A list of two hundred tasks is one round trip.
 */

export interface DelegationMark {
  delegationId: string;
  personName: string;
  /** sent · acknowledged · in_progress · stale · done */
  status: string;
  delegatedAt: Date;
  /** Set once they answered — the difference between sent and landed. */
  repliedAt: Date | null;
  slackMessageUrl: string | null;
}

/** What kind of thing a hand-over can hang off. */
export type DelegatableEntity = 'task' | 'contract' | 'deal' | 'alert' | 'partner';

/**
 * The latest live hand-over for each of these things.
 *
 * The latest, because something can be handed over twice — passed to one
 * person, taken back, passed to another — and what the row should say is where
 * it is now, not where it has been.
 *
 * Archived hand-overs are left out: an archived one is a decision he reversed,
 * and showing it would say a task is with somebody who is no longer holding it.
 */
export async function delegationsForMany(
  entityType: DelegatableEntity,
  ids: string[],
): Promise<Map<string, DelegationMark>> {
  const out = new Map<string, DelegationMark>();
  if (ids.length === 0) return out;

  const rows = await db
    .select({
      entityId: delegations.sourceEntityId,
      delegationId: delegations.id,
      status: delegations.status,
      delegatedAt: delegations.delegatedAt,
      repliedAt: delegations.replyAt,
      slackMessageUrl: delegations.slackMessageUrl,
      personName: people.name,
    })
    .from(delegations)
    .innerJoin(people, eq(people.id, delegations.delegatedTo))
    .where(
      and(
        eq(delegations.sourceEntityType, entityType),
        inArray(delegations.sourceEntityId, ids),
        isNull(delegations.archivedAt),
      ),
    )
    .orderBy(desc(delegations.delegatedAt));

  // Ordered newest first, so the first one seen for an id is the current one.
  for (const r of rows) {
    if (!r.entityId || out.has(r.entityId)) continue;
    out.set(r.entityId, {
      delegationId: r.delegationId,
      personName: r.personName,
      status: r.status,
      delegatedAt: r.delegatedAt,
      repliedAt: r.repliedAt,
      slackMessageUrl: r.slackMessageUrl,
    });
  }

  return out;
}
