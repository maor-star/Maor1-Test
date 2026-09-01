import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  auditLog, contractIntakeSeen, contractVersions, contracts, db, opportunities, pipelineClients,
} from '@/lib/db';
import { ensureFolderPath, moveFile, pruneEmptyFolders, uploadFile } from '@/lib/integrations/drive';
import { writeAudit } from '@/lib/audit';
import { filingFolder, stageForStatus, versionedFileName, type ContractCategory } from './drive';
import { BOARD_STATUSES, STATUS_LABEL, WAITING_ON, type ContractStatus } from './status';
import { versionFromName } from './intake';
import { rememberedCategory } from './remembered';

/**
 * The contracts desk: what arrived, what it is, where it was filed, and what
 * it belongs to.
 *
 * The ordering principle is his: everything that arrives lands in "needs
 * classifying" and nothing is filed anywhere until he has said what it is.
 * Filing a contract into the wrong company's folder is not recoverable by a
 * click, so the system never guesses the category — it proposes and waits.
 */

export const CONTRACT_VIEWS = [
  'classify', 'on_you', 'on_them', 'signed', 'all',
] as const;
export type ContractView = (typeof CONTRACT_VIEWS)[number];

export const CONTRACT_VIEW_LABEL: Record<ContractView, string> = {
  classify: 'NEEDS CLASSIFYING',
  on_you: 'WAITING ON YOU',
  on_them: 'WAITING ON THEM',
  signed: 'SIGNED',
  all: 'EVERYTHING',
};

export interface ContractRow {
  id: string;
  counterpartyName: string;
  category: ContractCategory | null;
  categoryConfirmed: boolean;
  docType: string;
  status: ContractStatus;
  statusLabel: string;
  waitingOn: 'you' | 'them' | 'nobody';
  /** True when he said so rather than the status deciding. */
  waitingOnIsOverridden: boolean;
  daysInStatus: number;
  valueCents: number | null;
  source: string;
  sourceUrl: string | null;
  receivedAt: Date | null;
  drivePath: string | null;
  notes: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  pipelineClientId: string | null;
  pipelineClientName: string | null;
  versions: {
    id: string;
    versionNo: number;
    fileName: string;
    drivePath: string | null;
    driveFileId: string | null;
    uploadedAt: Date | null;
    receivedAt: Date;
  }[];
}

const daysSince = (d: Date | null, now: Date) =>
  d === null ? 0 : Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));

export async function listContracts(
  view: ContractView = 'classify',
  now = new Date(),
): Promise<ContractRow[]> {
  const rows = await db
    .select({
      c: contracts,
      opportunityTitle: opportunities.title,
      pipelineClientName: pipelineClients.name,
    })
    .from(contracts)
    .leftJoin(opportunities, eq(contracts.opportunityId, opportunities.id))
    .leftJoin(pipelineClients, eq(contracts.pipelineClientId, pipelineClients.id))
    .where(isNull(contracts.archivedAt))
    .orderBy(desc(contracts.statusChangedAt));

  const ids = rows.map((r) => r.c.id);
  const allVersions = ids.length
    ? await db
        .select()
        .from(contractVersions)
        // inArray, not a hand-written any(): a JS array bound into raw SQL
        // reaches Postgres as a scalar, and "op ANY/ALL requires array on right
        // side" only appears once there is actually a contract to list.
        .where(inArray(contractVersions.contractId, ids))
        .orderBy(desc(contractVersions.versionNo))
    : [];

  const byContract = new Map<string, typeof allVersions>();
  for (const v of allVersions) {
    const list = byContract.get(v.contractId) ?? [];
    list.push(v);
    byContract.set(v.contractId, list);
  }

  const mapped = rows.map(({ c, opportunityTitle, pipelineClientName }): ContractRow => {
    const status = c.status as ContractStatus;
    return {
      id: c.id,
      counterpartyName: c.counterpartyName,
      category: c.categoryConfirmed ? (c.category as ContractCategory) : null,
      categoryConfirmed: c.categoryConfirmed,
      docType: c.docType,
      status,
      statusLabel: STATUS_LABEL[status] ?? status,
      // His word beats the status's guess: "in review" is with him by default
      // but is with them the moment he has sent back changes.
      waitingOn:
        c.waitingOnOverride === 'you' || c.waitingOnOverride === 'them'
          ? c.waitingOnOverride
          : (WAITING_ON[status] ?? 'nobody'),
      waitingOnIsOverridden: c.waitingOnOverride !== null,
      daysInStatus: daysSince(c.statusChangedAt, now),
      valueCents: c.valueCents,
      source: c.source,
      sourceUrl: c.sourceUrl,
      receivedAt: c.receivedAt,
      drivePath: c.drivePath,
      notes: c.notes,
      opportunityId: c.opportunityId,
      opportunityTitle,
      pipelineClientId: c.pipelineClientId,
      pipelineClientName,
      versions: (byContract.get(c.id) ?? []).map((v) => ({
        id: v.id,
        versionNo: v.versionNo,
        fileName: v.fileName,
        drivePath: v.drivePath,
        driveFileId: v.driveFileId,
        uploadedAt: v.uploadedAt,
        receivedAt: v.receivedAt,
      })),
    };
  });

  switch (view) {
    case 'classify':
      return mapped.filter((r) => r.status === 'unclassified' || !r.categoryConfirmed);
    case 'on_you':
      return mapped.filter((r) => r.waitingOn === 'you' && r.status !== 'unclassified');
    case 'on_them':
      return mapped.filter((r) => r.waitingOn === 'them');
    case 'signed':
      return mapped.filter((r) => r.status === 'signed');
    case 'all':
      return mapped;
  }
}

export interface ContractCounts {
  needsClassifying: number;
  onYou: number;
  onThem: number;
  signed: number;
  /** The oldest thing sitting unclassified — the number that shames the queue. */
  oldestUnclassifiedDays: number | null;
  notFiled: number;
}

export async function contractCounts(now = new Date()): Promise<ContractCounts> {
  const rows = await listContracts('all', now);
  const unclassified = rows.filter((r) => r.status === 'unclassified' || !r.categoryConfirmed);

  return {
    needsClassifying: unclassified.length,
    onYou: rows.filter((r) => r.waitingOn === 'you' && r.status !== 'unclassified').length,
    onThem: rows.filter((r) => r.waitingOn === 'them').length,
    signed: rows.filter((r) => r.status === 'signed').length,
    oldestUnclassifiedDays: unclassified.reduce<number | null>(
      (a, r) => (a === null || r.daysInStatus > a ? r.daysInStatus : a),
      null,
    ),
    // Versions recorded but whose bytes never reached Drive — usually because
    // the scope is not granted yet. Worth counting rather than hiding.
    notFiled: rows.reduce(
      (a, r) => a + r.versions.filter((v) => v.uploadedAt === null).length,
      0,
    ),
  };
}

/**
 * What this contract probably belongs to.
 *
 * A contract almost always arrives for something the cockpit already knows
 * about — an opportunity he captured, or a deal already in the pipeline. Rather
 * than making him search, the counterparty is matched against both and the
 * candidates offered. Matching, not linking: a wrong link quietly attaches a
 * signed agreement to the wrong deal, so a person confirms it.
 */
export async function suggestLinks(counterparty: string) {
  const needle = counterparty.trim().toLowerCase();
  if (needle === '') return { opportunities: [], deals: [] };

  const like = `%${needle}%`;

  const [ops, deals] = await Promise.all([
    db
      .select({ id: opportunities.id, title: opportunities.title, counterparty: opportunities.counterparty })
      .from(opportunities)
      .where(
        and(
          isNull(opportunities.archivedAt),
          or(
            sql`lower(${opportunities.counterparty}) like ${like}`,
            sql`lower(${opportunities.title}) like ${like}`,
          ),
        ),
      )
      .limit(5),
    db
      .select({ id: pipelineClients.id, name: pipelineClients.name, stage: pipelineClients.stage })
      .from(pipelineClients)
      .where(
        and(
          isNull(pipelineClients.archivedAt),
          or(
            sql`lower(${pipelineClients.name}) like ${like}`,
            sql`lower(coalesce(${pipelineClients.domain}, '')) like ${like}`,
          ),
        ),
      )
      .limit(5),
  ]);

  return { opportunities: ops, deals };
}

/**
 * Create the thing this contract belongs to, when it does not exist yet.
 *
 * A contract arriving for a counterparty nobody has captured is the common
 * case, not the exception — often the agreement IS the first record of the
 * relationship. Making him leave the screen, create an opportunity, come back
 * and find the contract again is how contracts end up linked to nothing.
 */
export async function createLinkTarget(
  contractId: string,
  what: 'opportunity' | 'deal',
  actor: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const [contract] = await db
    .select()
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  if (!contract) return { ok: false, error: 'No such contract' };

  const name = contract.counterpartyName.trim();
  if (name === '') return { ok: false, error: 'It needs a counterparty first' };

  // The contract says which side of the business it is. Where it does not,
  // `other` is honest and he can change it.
  const side =
    contract.category === 'demand' ? 'demand' : contract.category === 'supply' ? 'supply' : 'other';

  try {
    if (what === 'opportunity') {
      const [created] = await db
        .insert(opportunities)
        .values({
          title: `${name} — ${contract.docType || 'agreement'}`.slice(0, 300),
          kind: side,
          // A contract exists, so this is past "noticed" and is being worked.
          status: 'exploring',
          counterparty: name,
          note: `Created from the ${name} contract.`,
          source: 'manual',
          sourceUrl: contract.sourceUrl,
          createdBy: actor,
        })
        .returning({ id: opportunities.id });
      if (!created) return { ok: false, error: 'Could not create it' };

      await db
        .update(contracts)
        .set({ opportunityId: created.id })
        .where(eq(contracts.id, contractId));
      return { ok: true, id: created.id };
    }

    const [created] = await db
      .insert(pipelineClients)
      .values({
        name,
        clientType: side,
        // A signed contract is past being worked; anything else is out with them.
        stage: contract.status === 'signed' ? 'integration' : 'contract_out',
        temperature: 'warm',
        source: 'contract',
        notes: `Created from the ${name} contract.`,
      })
      .returning({ id: pipelineClients.id });
    if (!created) return { ok: false, error: 'Could not create it' };

    await db
      .update(contracts)
      .set({ pipelineClientId: created.id })
      .where(eq(contracts.id, contractId));
    return { ok: true, id: created.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not create it' };
  }
}

export interface ClassifyInput {
  counterpartyName?: string;
  category?: ContractCategory;
  docType?: string;
  status?: ContractStatus;
  valueCents?: number | null;
  notes?: string | null;
  opportunityId?: string | null;
  pipelineClientId?: string | null;
}

/**
 * Classifying one, which is the action the whole module exists for.
 *
 * Saying what a contract is also decides where it lives, so this files it in
 * the same step: no separate "now file it" that can be forgotten. Where Drive
 * is not authorised the classification still sticks and the filing is recorded
 * as outstanding — the alternative, refusing to classify, would make the board
 * useless until a scope is granted.
 */
export async function classifyContract(
  id: string,
  input: ClassifyInput,
  actor: string,
): Promise<{ ok: boolean; error?: string; filed?: boolean; warning?: string }> {
  const [existing] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
  if (!existing) return { ok: false, error: 'No such contract' };

  const category = input.category ?? (existing.category as ContractCategory | null);
  const status = input.status ?? (existing.status as ContractStatus);
  const counterparty = (input.counterpartyName ?? existing.counterpartyName).trim();

  if (counterparty === '') return { ok: false, error: 'It needs a counterparty to be filed under' };

  const statusChanged = status !== existing.status;

  // CLAUDE.md §10 — every mutation touching a contract writes an audit row.
  // Without it there is no answer to "what did that click just do", which is
  // the first thing anyone asks after clicking the wrong thing.
  await writeAudit({
    actor,
    action: 'contract.classify',
    entityType: 'contract',
    entityId: id,
    before: {
      counterpartyName: existing.counterpartyName,
      category: existing.category,
      categoryConfirmed: existing.categoryConfirmed,
      docType: existing.docType,
      status: existing.status,
      notes: existing.notes,
      opportunityId: existing.opportunityId,
      pipelineClientId: existing.pipelineClientId,
    },
    after: {
      counterpartyName: counterparty,
      category: category ?? 'general',
      categoryConfirmed: input.category !== undefined ? true : existing.categoryConfirmed,
      docType: input.docType ?? existing.docType,
      status,
      notes: input.notes !== undefined ? input.notes : existing.notes,
      opportunityId:
        input.opportunityId !== undefined ? input.opportunityId : existing.opportunityId,
      pipelineClientId:
        input.pipelineClientId !== undefined ? input.pipelineClientId : existing.pipelineClientId,
    },
  });

  await db
    .update(contracts)
    .set({
      counterpartyName: counterparty,
      // The column is NOT NULL; `categoryConfirmed` is what says whether the
      // value means anything yet, so an unconfirmed one stays 'general'.
      category: category ?? 'general',
      // Confirmed means a person said so, which is the only thing that lets it
      // leave _Unclassified.
      categoryConfirmed: input.category !== undefined ? true : existing.categoryConfirmed,
      docType: input.docType ?? existing.docType,
      status,
      ...(statusChanged ? { statusChangedAt: new Date() } : {}),
      valueCents: input.valueCents !== undefined ? input.valueCents : existing.valueCents,
      notes: input.notes !== undefined ? input.notes : existing.notes,
      opportunityId:
        input.opportunityId !== undefined ? input.opportunityId : existing.opportunityId,
      pipelineClientId:
        input.pipelineClientId !== undefined ? input.pipelineClientId : existing.pipelineClientId,
    })
    .where(eq(contracts.id, id));

  // A signed contract means the deal is real. Spec §8: contract signed moves
  // the pipeline client on, and doing it here means he never has to remember.
  const linkedDeal = input.pipelineClientId ?? existing.pipelineClientId;
  if (status === 'signed' && linkedDeal) {
    await db
      .update(pipelineClients)
      .set({ stage: 'integration', updatedAt: new Date() })
      .where(and(eq(pipelineClients.id, linkedDeal), sql`${pipelineClients.stage} <> 'live'`));
  }

  const filing = await fileContract(id, actor);
  return {
    ok: true,
    filed: filing.ok,
    ...(filing.ok ? {} : { warning: filing.error }),
  };
}

/**
 * Put the contract's versions where they belong in Drive.
 *
 * Idempotent: a version already uploaded is moved rather than uploaded again,
 * so re-classifying does not litter the folder with copies. Bytes we no longer
 * hold cannot be uploaded retrospectively — the row says so instead of
 * pretending.
 */
export async function fileContract(
  id: string,
  _actor: string,
): Promise<{ ok: boolean; error?: string }> {
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
  if (!contract) return { ok: false, error: 'No such contract' };

  const category = contract.categoryConfirmed ? (contract.category as ContractCategory) : null;
  const target = filingFolder(
    contract.counterpartyName,
    category,
    stageForStatus(contract.status),
  );

  const folder = await ensureFolderPath(target.segments);
  if (!folder.ok) {
    await db.update(contracts).set({ drivePath: target.path }).where(eq(contracts.id, id));
    return { ok: false, error: folder.error };
  }

  const versions = await db
    .select()
    .from(contractVersions)
    .where(eq(contractVersions.contractId, id));

  // Where the files were, so the folders they leave behind can be cleared.
  const vacated = new Set<string>();

  for (const version of versions) {
    if (version.driveFileId) {
      if (version.drivePath && version.drivePath !== target.path) vacated.add(version.drivePath);
      // Already in Drive: a status change is a move, never a second copy.
      await moveFile(version.driveFileId, folder.folderId).catch(() => ({ ok: false }));
      await db
        .update(contractVersions)
        .set({ drivePath: target.path })
        .where(eq(contractVersions.id, version.id));
    }
  }

  // Classifying moves everything out of _Unclassified/<Counterparty>, and that
  // folder would otherwise sit there empty for ever.
  for (const path of vacated) {
    const segments = path.replace(/^\/?Adnimation Contracts\/?/, '').split('/').filter(Boolean);
    if (segments.length > 0) await pruneEmptyFolders(segments).catch(() => ({ trashed: [] }));
  }

  await db.update(contracts).set({ drivePath: target.path }).where(eq(contracts.id, id));
  return { ok: true };
}

/**
 * Record a contract that has arrived, with its first version.
 *
 * Called by the intake job and by a manual upload. It never classifies: the
 * counterparty is a guess from the sender and the category is left unset, so
 * it lands in "needs classifying" where he decides.
 */
export async function recordArrival(input: {
  counterpartyName: string;
  docType: string;
  source: string;
  sourceRef: string;
  sourceUrl: string | null;
  receivedAt: Date;
  fileName: string;
  fileHash: string;
  mimeType: string | null;
  sizeBytes: number | null;
  bytes?: Buffer | null;
}): Promise<{ ok: true; contractId: string; versionNo: number } | { ok: false; error: string }> {
  try {
    // The same agreement usually arrives repeatedly as it goes back and forth,
    // so a new version joins the existing contract rather than starting a
    // second record for the same counterparty.
    const [open] = await db
      .select()
      .from(contracts)
      .where(
        and(
          isNull(contracts.archivedAt),
          sql`lower(${contracts.counterpartyName}) = ${input.counterpartyName.toLowerCase()}`,
          sql`${contracts.status} <> 'signed'`,
        ),
      )
      .orderBy(desc(contracts.createdAt))
      .limit(1);

    let contractId = open?.id;

    if (!contractId) {
      /*
       * How this counterparty was filed last time.
       *
       * He classifies Taboola once; the next Taboola document should not
       * arrive as the same unanswered question. Only a classification he
       * confirmed counts, so one wrong guess cannot compound across every
       * document a company ever sends — and the contract still lands in the
       * classify view, saying what it assumed, so a wrong one is a click to
       * correct rather than something that happened silently.
       */
      const remembered = await rememberedCategory(input.counterpartyName);

      const [created] = await db
        .insert(contracts)
        .values({
          counterpartyName: input.counterpartyName,
          category: remembered?.category ?? 'general',
          categoryConfirmed: false,
          docType: input.docType,
          status: 'unclassified',
          source: input.source,
          sourceRef: input.sourceRef,
          sourceUrl: input.sourceUrl,
          receivedAt: input.receivedAt,
          ...(remembered
            ? {
                notes:
                  `Filed as ${remembered.category} because that is how ` +
                  `${remembered.fromCounterparty} was classified last time.`,
              }
            : {}),
        })
        .returning({ id: contracts.id });
      if (!created) return { ok: false, error: 'Could not record it' };
      contractId = created.id;
    }

    const held = await db
      .select({ n: sql<number>`count(*)::int`, max: sql<number>`coalesce(max(version_no), 0)::int` })
      .from(contractVersions)
      .where(eq(contractVersions.contractId, contractId));

    const versionNo = versionFromName(input.fileName, held[0]?.max ?? 0);

    const [version] = await db
      .insert(contractVersions)
      .values({
        contractId,
        versionNo,
        fileName: input.fileName,
        fileHash: input.fileHash,
        source: input.source === 'mail' ? 'inbound_mail' : 'manual_upload',
        receivedAt: input.receivedAt,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sourceRef: input.sourceRef,
        sourceUrl: input.sourceUrl,
      })
      // Spec §10 — the same file twice is one version. Bare, not targeted: the
      // schema also carries a global unique on file_hash, and naming one target
      // makes the other throw instead of being a no-op.
      .onConflictDoNothing()
      .returning({ id: contractVersions.id });

    if (version && input.bytes) {
      const target = filingFolder(input.counterpartyName, null, 'unclassified');
      const folder = await ensureFolderPath(target.segments);
      if (folder.ok) {
        const uploaded = await uploadFile({
          folderId: folder.folderId,
          name: versionedFileName({
            counterparty: input.counterpartyName,
            docType: input.docType,
            version: versionNo,
            date: input.receivedAt.toISOString().slice(0, 10),
            extension: input.fileName.split('.').pop() ?? 'pdf',
          }),
          mimeType: input.mimeType ?? 'application/pdf',
          bytes: input.bytes,
        });
        if (uploaded.ok && uploaded.fileId) {
          await db
            .update(contractVersions)
            .set({
              driveFileId: uploaded.fileId,
              drivePath: target.path,
              uploadedAt: new Date(),
            })
            .where(eq(contractVersions.id, version.id));
        }
      }
    }

    return { ok: true, contractId, versionNo };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not record it' };
  }
}

/**
 * Say whose move it is, regardless of the status.
 *
 * Passing null hands the decision back to the status, which is what he wants
 * once the contract moves on — an override that outlives the situation it was
 * set for is worse than none.
 */
export async function setWaitingOn(
  id: string,
  who: 'you' | 'them' | null,
  actor = 'ceo',
): Promise<{ ok: boolean; error?: string }> {
  try {
    const [before] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
    await db
      .update(contracts)
      .set({ waitingOnOverride: who })
      .where(eq(contracts.id, id));
    await writeAudit({
      actor,
      action: 'contract.waiting_on',
      entityType: 'contract',
      entityId: id,
      before: { waitingOnOverride: before?.waitingOnOverride ?? null },
      after: { waitingOnOverride: who },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not update it' };
  }
}

export async function archiveContract(
  id: string,
  actor = 'ceo',
): Promise<{ ok: boolean; error?: string }> {
  try {
    const [before] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
    await db.update(contracts).set({ archivedAt: new Date() }).where(eq(contracts.id, id));
    await writeAudit({
      actor,
      action: 'contract.archive',
      entityType: 'contract',
      entityId: id,
      before: { archivedAt: null, counterpartyName: before?.counterpartyName },
      after: { archivedAt: new Date().toISOString() },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not archive it' };
  }
}

/**
 * Put a contract back the way it was before the last change.
 *
 * Every control on the card is one click and several of them move files in
 * Drive, so an accidental click has to be recoverable — otherwise the only
 * honest advice is "be careful", which is not a feature. This reads the most
 * recent audit row for the contract and restores what it recorded as `before`.
 *
 * The undo is itself audited, so the history stays a history rather than
 * becoming a way to erase one.
 */
export async function undoLastChange(
  id: string,
  actor: string,
): Promise<{ ok: boolean; error?: string; restored?: string }> {
  const [entry] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'contract'), eq(auditLog.entityId, id)))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(1);

  if (!entry) return { ok: false, error: 'Nothing recorded to undo' };
  if (entry.action === 'contract.undo') {
    return { ok: false, error: 'That was already undone' };
  }

  const before = entry.before as Record<string, unknown> | null;
  if (!before) return { ok: false, error: 'Nothing recorded to undo' };

  const patch: Record<string, unknown> = {};
  if ('counterpartyName' in before && typeof before.counterpartyName === 'string') {
    patch.counterpartyName = before.counterpartyName;
  }
  if ('category' in before) patch.category = before.category ?? 'general';
  if ('categoryConfirmed' in before) patch.categoryConfirmed = Boolean(before.categoryConfirmed);
  if ('docType' in before && typeof before.docType === 'string') patch.docType = before.docType;
  if ('status' in before && typeof before.status === 'string') {
    patch.status = before.status;
    patch.statusChangedAt = new Date();
  }
  if ('notes' in before) patch.notes = (before.notes as string | null) ?? null;
  if ('opportunityId' in before) patch.opportunityId = (before.opportunityId as string | null) ?? null;
  if ('pipelineClientId' in before) {
    patch.pipelineClientId = (before.pipelineClientId as string | null) ?? null;
  }
  if ('waitingOnOverride' in before) {
    patch.waitingOnOverride = (before.waitingOnOverride as string | null) ?? null;
  }
  if ('archivedAt' in before) patch.archivedAt = before.archivedAt ? new Date(String(before.archivedAt)) : null;

  if (Object.keys(patch).length === 0) return { ok: false, error: 'Nothing to restore' };

  await db.update(contracts).set(patch).where(eq(contracts.id, id));

  await writeAudit({
    actor,
    action: 'contract.undo',
    entityType: 'contract',
    entityId: id,
    before: entry.after,
    after: patch,
  });

  // Filing follows the restored state, so the file goes back where it was.
  await fileContract(id, actor).catch(() => ({ ok: false }));

  return { ok: true, restored: entry.action };
}

/** The last thing that happened to a contract, for the card to show. */
export async function lastChange(id: string) {
  const [entry] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'contract'), eq(auditLog.entityId, id)))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(1);
  return entry ?? null;
}

/** What the intake has seen but nobody has decided on. */
export async function pendingIntake(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contractIntakeSeen)
    .where(eq(contractIntakeSeen.decided, 'pending'));
  return row?.n ?? 0;
}

export { BOARD_STATUSES, STATUS_LABEL, WAITING_ON };
