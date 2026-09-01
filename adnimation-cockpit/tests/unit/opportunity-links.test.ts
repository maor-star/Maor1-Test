import { afterEach, describe, expect, it } from 'vitest';
import { like } from 'drizzle-orm';
import { contracts, db, opportunities } from '@/lib/db';
import { contractsForOpportunities } from '@/lib/opportunities/module';
import { suggestLinks } from '@/lib/contracts/intake-module';
import { KIND_TO_CLIENT_TYPE, OPPORTUNITY_KINDS } from '@/lib/opportunities/rules';

/**
 * Linking a contract to the opportunity it belongs to.
 *
 * Two failures, both of which he hit. The picker only offered opportunities
 * whose name contained the counterparty's, so when the names did not line up
 * there was nothing to choose. And the link, once made, showed only on the
 * contract — from the opportunity it was invisible, which reads exactly like
 * the link never saved.
 */
const MARK = `link-${Date.now()}`;

afterEach(async () => {
  await db.delete(contracts).where(like(contracts.counterpartyName, `${MARK}%`));
  await db.delete(opportunities).where(like(opportunities.title, `${MARK}%`));
});

async function seedOpportunity(title: string, counterparty: string | null = null) {
  const [row] = await db
    .insert(opportunities)
    .values({ title, kind: 'other', status: 'new', counterparty, source: 'manual' })
    .returning();
  return row!;
}

describe('what the link picker offers', () => {
  it('offers an opportunity whose name looks nothing like the counterparty', async () => {
    const op = await seedOpportunity(`${MARK} second site for the network`);
    const found = await suggestLinks(`${MARK} Markito Ltd`);
    expect(found.opportunities.map((o) => o.id)).toContain(op.id);
  });

  it('still puts the obvious match first', async () => {
    await seedOpportunity(`${MARK} something else entirely`);
    const match = await seedOpportunity(`${MARK} Markito expansion`, `${MARK} Markito`);
    const found = await suggestLinks(`${MARK} Markito`);
    expect(found.opportunities[0]?.id).toBe(match.id);
  });

  it('offers something even when he has typed no counterparty yet', async () => {
    await seedOpportunity(`${MARK} anything`);
    expect((await suggestLinks('')).opportunities.length).toBeGreaterThan(0);
  });
});

describe('seeing the link from the opportunity', () => {
  it('finds the contracts pointing at it', async () => {
    const op = await seedOpportunity(`${MARK} the deal`);
    await db.insert(contracts).values({
      counterpartyName: `${MARK} Markito`,
      category: 'demand',
      categoryConfirmed: true,
      docType: 'agreement',
      status: 'out_for_signature',
      source: 'mail',
      opportunityId: op.id,
    });

    const linked = await contractsForOpportunities([op.id]);
    const found = linked.get(op.id);
    expect(found).toHaveLength(1);
    expect(found?.[0]?.status).toBe('out_for_signature');
    // A contract that is out is waiting on them, and the card says so.
    expect(found?.[0]?.waitingOn).toBe('them');
  });

  it('says nothing for an opportunity with no contract, and asks nothing for none', async () => {
    const op = await seedOpportunity(`${MARK} untouched`);
    expect((await contractsForOpportunities([op.id])).size).toBe(0);
    expect((await contractsForOpportunities([])).size).toBe(0);
  });
});

describe('the kind an opportunity can be', () => {
  it('includes the partner who is both', () => {
    expect(OPPORTUNITY_KINDS).toContain('mutual');
  });

  it('maps every kind onto a pipeline client type', () => {
    for (const kind of OPPORTUNITY_KINDS) {
      expect(KIND_TO_CLIENT_TYPE[kind], kind).toBeTruthy();
    }
  });

  it('opens a mutual partner on the demand side, where the money starts', () => {
    expect(KIND_TO_CLIENT_TYPE.mutual).toBe('demand');
  });
});
