import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm';
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

// These write real rows, and a name that repeats across runs collides with the
// previous run's — which showed up as the create silently returning ok:false
// on the second run and passing on the first.
const unique = (name: string) => `${name} ${Date.now().toString(36)}`;

/*
 * And they stay in the database afterwards, where anything reading it for real
 * work finds them — the marketing agent looked for recently signed contracts
 * and found eighty of these. So the fixtures put themselves away when the run
 * ends. Archived, not deleted: nothing in this system deletes (CLAUDE.md §2),
 * and archived is what every screen and every agent already filters on.
 */
afterAll(async () => {
  const names = ['Undo Test %', 'Never Touched %', 'LinkTarget %'];
  const like = (column: Parameters<typeof ilike>[0]) => or(...names.map((n) => ilike(column, n)))!;
  const archivedAt = new Date();
  await db.update(contracts).set({ archivedAt }).where(and(like(contracts.counterpartyName), isNull(contracts.archivedAt)));
  await db.update(pipelineClients).set({ archivedAt }).where(and(like(pipelineClients.name), isNull(pipelineClients.archivedAt)));
  await db.update(opportunities).set({ archivedAt }).where(and(like(opportunities.counterparty), isNull(opportunities.archivedAt)));
});

beforeAll(async () => {
  const [row] = await db
    .insert(contracts)
    .values({
      counterpartyName: unique('Undo Test'),
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
        counterpartyName: unique('Never Touched'),
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
  const demandName = unique('LinkTarget Demand');
  const signedName = unique('LinkTarget Signed');

  it('creates an opportunity from the contract and links it both ways', async () => {
    const [row] = await db
      .insert(contracts)
      .values({
        counterpartyName: demandName,
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
    expect(created!.counterparty).toBe(demandName);
    // The contract says which side of the business this is.
    expect(created!.kind).toBe('demand');
    // A contract exists, so it is past "noticed".
    expect(created!.status).toBe('exploring');
  });

  it('creates a deal at a stage that matches the contract', async () => {
    const [row] = await db
      .insert(contracts)
      .values({
        counterpartyName: signedName,
        category: 'supply',
        categoryConfirmed: true,
        docType: 'Supply agreement',
        status: 'signed',
        source: 'manual',
      })
      .returning({ id: contracts.id });

    const result = await createLinkTarget(row!.id, 'deal', 'test@adnimation.com');
    expect(result.ok, result.ok ? '' : result.error).toBe(true);

    const [deal] = await db
      .select()
      .from(pipelineClients)
      .where(eq(pipelineClients.id, result.ok ? result.id : ''))
      .limit(1);
    expect(deal!.name).toBe(signedName);
    expect(deal!.clientType).toBe('supply');
    // Signed means the deal is being integrated, not still out for signature.
    expect(deal!.stage).toBe('integration');
  });

  it('links to the deal that already exists rather than making a second one', async () => {
    const [row] = await db
      .insert(contracts)
      .values({
        counterpartyName: signedName,
        category: 'supply',
        categoryConfirmed: true,
        docType: 'Addendum',
        status: 'signed',
        source: 'manual',
      })
      .returning({ id: contracts.id });

    // The deal was made by the previous test, from another contract with the
    // same counterparty. A second contract from them belongs to it, not to a
    // duplicate of it.
    const result = await createLinkTarget(row!.id, 'deal', 'test@adnimation.com');
    expect(result.ok, result.ok ? '' : result.error).toBe(true);

    const deals = await db
      .select({ id: pipelineClients.id })
      .from(pipelineClients)
      .where(eq(pipelineClients.name, signedName));
    expect(deals).toHaveLength(1);
    expect(result.ok ? result.id : null).toBe(deals[0]!.id);
  });

  it('writes down what the button did, and gives the new deal a next step', async () => {
    const name = unique('LinkTarget Audited');
    const [row] = await db
      .insert(contracts)
      .values({
        counterpartyName: name,
        category: 'demand',
        categoryConfirmed: true,
        docType: 'Demand agreement',
        status: 'in_review',
        source: 'manual',
      })
      .returning({ id: contracts.id });

    const result = await createLinkTarget(row!.id, 'deal', 'test@adnimation.com');
    expect(result.ok).toBe(true);
    const dealId = result.ok ? result.id : '';

    // The link is on the contract — the bug was a deal created and orphaned.
    const [after] = await db.select().from(contracts).where(eq(contracts.id, row!.id)).limit(1);
    expect(after!.pipelineClientId).toBe(dealId);

    // Audited, so "what did that click do" has an answer (CLAUDE.md §10).
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'contract'), eq(auditLog.entityId, row!.id)))
      .orderBy(desc(auditLog.id))
      .limit(1);
    expect(entry!.action).toBe('contract.create_deal');

    // An open deal carries a next step, whichever door it came in through.
    const [deal] = await db.select().from(pipelineClients).where(eq(pipelineClients.id, dealId)).limit(1);
    expect(deal!.stage).toBe('contract');
    expect(deal!.nextStep).toBeTruthy();
    expect(deal!.nextStepDate).toBeTruthy();
  });

  it('a classify that says nothing about the links leaves them alone', async () => {
    const name = unique('LinkTarget Keeps');
    const [row] = await db
      .insert(contracts)
      .values({
        counterpartyName: name,
        category: 'demand',
        categoryConfirmed: true,
        docType: 'Demand agreement',
        status: 'in_review',
        source: 'manual',
      })
      .returning({ id: contracts.id });
    const made = await createLinkTarget(row!.id, 'deal', 'test@adnimation.com');
    const dealId = made.ok ? made.id : '';

    // What "SAVE AND FILE IT" sends when the form carries no link field: the
    // status only. It used to arrive as pipelineClientId: null and unlink.
    await classifyContract(row!.id, { status: 'signed' }, 'test@adnimation.com');

    const [after] = await db.select().from(contracts).where(eq(contracts.id, row!.id)).limit(1);
    expect(after!.status).toBe('signed');
    expect(after!.pipelineClientId).toBe(dealId);
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
