import { afterEach, describe, expect, it } from 'vitest';
import { eq, like } from 'drizzle-orm';
import { contracts, db } from '@/lib/db';
import { rememberedCategory } from '@/lib/contracts/remembered';

/**
 * Classifying a company once should be enough.
 *
 * The risk in remembering is the opposite of the risk in forgetting: a guess
 * that teaches the next guess turns one mistake into a filing rule. So only a
 * classification he confirmed is ever remembered, and an unconfirmed or
 * undecided one teaches nothing.
 */
const MARK = `remembered-${Date.now()}`;

async function seed(over: Partial<typeof contracts.$inferInsert>) {
  await db.insert(contracts).values({
    counterpartyName: `${MARK} Taboola Ltd.`,
    category: 'demand',
    categoryConfirmed: true,
    docType: 'agreement',
    status: 'signed',
    source: 'mail',
    ...over,
  });
}

afterEach(async () => {
  await db.delete(contracts).where(like(contracts.counterpartyName, `${MARK}%`));
});

describe('how a counterparty was filed last time', () => {
  it('remembers a confirmed classification, however the name is spelled', async () => {
    await seed({});
    const remembered = await rememberedCategory(`${MARK} taboola`);
    expect(remembered?.category).toBe('demand');
  });

  it('remembers nothing from a classification he has not confirmed', async () => {
    await seed({ categoryConfirmed: false, category: 'supply' });
    expect(await rememberedCategory(`${MARK} Taboola Ltd.`)).toBeNull();
  });

  it('does not treat "general" as a decision — it is where undecided sits', async () => {
    await seed({ category: 'general' });
    expect(await rememberedCategory(`${MARK} Taboola Ltd.`)).toBeNull();
  });

  it('follows the most recent decision when he changes his mind', async () => {
    await seed({ category: 'demand', statusChangedAt: new Date('2026-01-01T00:00:00Z') });
    await seed({ category: 'mutual', statusChangedAt: new Date('2026-06-01T00:00:00Z') });
    expect((await rememberedCategory(`${MARK} Taboola`))?.category).toBe('mutual');
  });

  it('ignores an archived contract', async () => {
    await seed({ archivedAt: new Date() });
    expect(await rememberedCategory(`${MARK} Taboola Ltd.`)).toBeNull();
  });

  it('says nothing about a company it has never seen', async () => {
    expect(await rememberedCategory(`${MARK} Someone New`)).toBeNull();
    expect(await rememberedCategory('   ')).toBeNull();
  });

  it('remembers the new consulting category like any other', async () => {
    await seed({ category: 'consulting' });
    expect((await rememberedCategory(`${MARK} Taboola`))?.category).toBe('consulting');
  });
});
