import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { contracts, db } from '@/lib/db';
import type { ContractCategory } from './drive';

/**
 * How a counterparty was filed last time.
 *
 * He classifies Taboola once. The next Taboola document should not arrive as
 * an unclassified pile waiting for the same decision — the answer is already
 * in the system, in the last contract he confirmed for that company.
 *
 * Reading history rather than keeping a separate table of rules is deliberate:
 * his corrections are the memory. Reclassify a counterparty and the next
 * document follows the new answer, with nothing to update and nothing to go
 * stale.
 *
 * Only a classification he confirmed counts. An auto-filed contract cannot
 * teach the next one, or a single wrong guess would compound quietly across
 * every document that company ever sends.
 */
export interface Remembered {
  category: ContractCategory;
  /** What that decision was made on, so the screen can say why. */
  fromCounterparty: string;
  at: Date | null;
}

export async function rememberedCategory(
  counterparty: string,
): Promise<Remembered | null> {
  const name = counterparty.trim();
  if (name === '') return null;

  const [row] = await db
    .select({
      category: contracts.category,
      counterpartyName: contracts.counterpartyName,
      at: contracts.statusChangedAt,
    })
    .from(contracts)
    .where(
      and(
        // Same company, however it was spelled: "Google Ireland Ltd." and
        // "google ireland" are the same counterparty and the same answer.
        sql`normalise_counterparty(${contracts.counterpartyName}) = normalise_counterparty(${name})`,
        eq(contracts.categoryConfirmed, true),
        isNull(contracts.archivedAt),
        // 'general' is where an undecided contract sits, not a decision.
        ne(contracts.category, 'general'),
      ),
    )
    .orderBy(desc(contracts.statusChangedAt))
    .limit(1);

  if (!row) return null;
  return {
    category: row.category as ContractCategory,
    fromCounterparty: row.counterpartyName,
    at: row.at,
  };
}
