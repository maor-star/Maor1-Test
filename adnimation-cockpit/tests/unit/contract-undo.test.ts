import { beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { auditLog, contracts, db, opportunities, pipelineClients } from '@/lib/db';
import {
  classifyContract, createLinkTarget, setWaitingOn, undoLastChange,
} from '@/lib/contracts/intake-module';

/**
 * Undoing a click.
 *
 * Every control on the contract card is a single click and several of them
 * move files in Drive, so the question after a mis-click — "what did that do
 * and can I take it back" — has to have an answer. That needs two things the
 * module did not have: an audit row for every mutation, and a way to read the
 * last one back.
 */
let id: string;

beforeAll(async () => {
  const [row] = await db
    .insert(contracts)
    .values({
      counterpartyName: 'Undo Test Ltd',
      category: 'general',
      categoryConfirmed: false,
      docType: 'Test agreement',
      status: 'unclassified',
      source: 'manual',
    })
    .returning({ id: contracts.id });
  id = row!.id;
});

const current = async () => {
  const [row] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
  return row!;
};

describe('contracts — taking a change back', () => {
  it('writes an audit row for a classification, with what it was before', async () => {
    await classifyContract(id, { category: 'demand', status: 'in_review' }, 'test@adnimation.com');

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'contract'), eq(auditLog.entityId, id)))
      .orderBy(desc(auditLog.id))
      .limit(1);

    expect(entry?.action).toBe('contract.classify');
    expect((entry?.before as { status?: string })?.status).toBe('unclassified');
    expect((entry?.after as { status?: string })?.status).toBe('in_review');
  });

  it('restores the previous state', async () => {
    expect((await current()).status).toBe('in_review');

    const result = await undoLastChange(id, 'test@adnimation.com');
    expect(result.ok).toBe(true);

    const after = await current();
    expect(after.status).toBe('unclassified');
    expect(after.categoryConfirmed).toBe(false);
  });

  it('refuses to undo an undo, so history cannot be walked backwards for ever', async () => {
    const again = await undoLastChange(id, 'test@adnimation.com');
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/already undone/i);
  });

  it('takes back a whose-move override too', async () => {
    await setWaitingOn(id, 'them', 'test@adnimation.com');
    expect((await current()).waitingOnOverride).toBe('them');

    await undoLastChange(id, 'test@adnimation.com');
    expect((await current()).waitingOnOverride).toBeNull();
  });

  it('says so plainly when there is nothing recorded', async () => {
    const [fresh] = await db
      .insert(contracts)
      .values({
        counterpartyName: 'Never Touched Ltd',
        category: 'general',
        categoryConfirmed: false,
        docType: 'Test',
        status: 'unclassified',
        source: 'manual',
      })
      .returning({ id: contracts.id });

    const result = await undoLastChange(fresh!.id, 'test@adnimation.com');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nothing recorded/i);
  });
});

/**
 * Creating what a contract belongs to, from the contract.
 *
 * The counterparty on a contract is often the first the cockpit has heard of
 * them — the agreement arrives before anyone captured an opportunity. Making
 * the record exist first means leaving the screen, which is how contracts end
 * up linked to nothing.
 */
describe('contracts — creating the thing it belongs to', () => {
  it('creates an opportunity from the contract and links it both ways', async () => {
    const [row] = await db
      .insert(contracts)
      .values({
        counterpartyName: 'LinkTarget Demand Ltd',
        category: 'demand',
        categoryConfirmed: true,
        docType: 'Demand agreement',
        status: 'in_review',
        source: 'manual',
      })
      .returning({ id: contracts.id });

    const result = await createLinkTarget(row!.id, 'opportunity', 'test@adnimation.com');
    expect(result.ok).toBe(true);

    const [after] = await db.select().from(contracts).where(eq(contracts.id, row!.id)).limit(1);
    expect(after!.opportunityId).toBe(result.ok ? result.id : null);

    const [created] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, result.ok ? result.id : ''))
      .limit(1);
    expect(created!.counterparty).toBe('LinkTarget Demand Ltd');
    // The contract says which side of the business this is.
    expect(created!.kind).toBe('demand');
    // A contract exists, so it is past "noticed".
    expect(created!.status).toBe('exploring');
  });

  it('creates a deal at a stage that matches the contract', async () => {
    const [row] = await db
      .insert(contracts)
      .values({
        counterpartyName: 'LinkTarget Signed Ltd',
        category: 'supply',
        categoryConfirmed: true,
        docType: 'Supply agreement',
        status: 'signed',
        source: 'manual',
      })
      .returning({ id: contracts.id });

    const result = await createLinkTarget(row!.id, 'deal', 'test@adnimation.com');
    expect(result.ok).toBe(true);

    const [deal] = await db
      .select()
      .from(pipelineClients)
      .where(eq(pipelineClients.id, result.ok ? result.id : ''))
      .limit(1);
    expect(deal!.name).toBe('LinkTarget Signed Ltd');
    expect(deal!.clientType).toBe('supply');
    // Signed means the deal is being integrated, not still out for signature.
    expect(deal!.stage).toBe('integration');
  });

  it('refuses without a counterparty, which is the name it would file under', async () => {
    const [row] = await db
      .insert(contracts)
      .values({
        counterpartyName: '   ',
        category: 'general',
        categoryConfirmed: false,
        docType: 'Test',
        status: 'unclassified',
        source: 'manual',
      })
      .returning({ id: contracts.id });

    const result = await createLinkTarget(row!.id, 'opportunity', 'test@adnimation.com');
    expect(result.ok).toBe(false);
  });
});
