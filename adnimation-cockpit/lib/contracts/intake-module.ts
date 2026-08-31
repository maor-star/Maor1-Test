import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import {
  contractIntakeSeen, contractVersions, contracts, db, opportunities, pipelineClients,
} from '@/lib/db';
import { ensureFolderPath, moveFile, uploadFile } from '@/lib/integrations/drive';
import { filingFolder, stageForStatus, versionedFileName, type ContractCategory } from './drive';
import { BOARD_STATUSES, STATUS_LABEL, WAITING_ON, type ContractStatus } from './status';
import { versionFromName } from './intake';

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
        .where(sql`${contractVersions.contractId} = any(${ids})`)
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
      waitingOn: WAITING_ON[status] ?? 'nobody',
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

  for (const version of versions) {
    if (version.driveFileId) {
      // Already in Drive: a status change is a move, never a second copy.
      await moveFile(version.driveFileId, folder.folderId).catch(() => ({ ok: false }));
      await db
        .update(contractVersions)
        .set({ drivePath: target.path })
        .where(eq(contractVersions.id, version.id));
    }
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
      const [created] = await db
        .insert(contracts)
        .values({
          counterpartyName: input.counterpartyName,
          category: 'general',
          categoryConfirmed: false,
          docType: input.docType,
          status: 'unclassified',
          source: input.source,
          sourceRef: input.sourceRef,
          sourceUrl: input.sourceUrl,
          receivedAt: input.receivedAt,
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

export async function archiveContract(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await db.update(contracts).set({ archivedAt: new Date() }).where(eq(contracts.id, id));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not archive it' };
  }
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
