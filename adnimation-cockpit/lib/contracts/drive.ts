/**
 * Where a contract is filed in Drive — spec 9.5.
 *
 *   /Adnimation Contracts/<Demand|Supply|General>/<Counterparty>/<Signed|In Progress>/
 *
 * Filing is by counterparty inside a category, so every version of one
 * agreement sits together and a renewal lands beside the original.
 *
 * Pure string building, kept apart from the Drive API so the naming rules can
 * be tested without a network call — and so a wrong path is caught here rather
 * than after a file has been written into someone's Drive.
 */

export const DRIVE_ROOT = 'Adnimation Contracts';

export type ContractCategory = 'demand' | 'supply' | 'general';

export const CATEGORY_FOLDER: Record<ContractCategory, string> = {
  demand: 'Demand',
  supply: 'Supply',
  general: 'General',
};

/**
 * Where a contract lives inside its counterparty's folder.
 *
 * The status is a folder, not just a field, so opening Drive answers "what is
 * stuck" without opening the cockpit. The cost is that a file moves when its
 * status changes — Drive keeps the file id across a move, so any link already
 * shared stays valid.
 */
export type FilingStage =
  | 'unclassified'
  | 'in_review'
  | 'out_for_signature'
  | 'awaiting_my_signature'
  | 'signed';

export const STAGE_FOLDER: Record<FilingStage, string> = {
  unclassified: 'Needs classifying',
  in_review: 'In review',
  out_for_signature: 'Out for signature',
  awaiting_my_signature: 'Awaiting my signature',
  signed: 'Signed',
};

/** How a contract's status maps onto the folder it belongs in. */
export function stageForStatus(status: string): FilingStage {
  switch (status) {
    case 'signed':
      return 'signed';
    case 'awaiting_my_signature':
      return 'awaiting_my_signature';
    case 'out_for_signature':
    case 'negotiation':
      return 'out_for_signature';
    case 'unclassified':
      return 'unclassified';
    default:
      return 'in_review';
  }
}

/** Counterparties whose category could not be determined go here, never guessed. */
export const UNCLASSIFIED_FOLDER = '_Unclassified';

/**
 * Drive treats `/` as a path separator and trims surrounding whitespace, so a
 * counterparty name has to be made safe before it becomes a folder.
 */
export function safeFolderName(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, '-')
    // Control characters would be invisible in a folder name.
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : UNCLASSIFIED_FOLDER;
}

export interface FilingTarget {
  /** Folder names from the root down, ready to create or resolve one by one. */
  segments: string[];
  /** Human-readable path, for display and for the audit row. */
  path: string;
  classified: boolean;
}

export function filingFolder(
  counterparty: string,
  category: ContractCategory | null,
  stage: FilingStage = 'signed',
): FilingTarget {
  // A contract with no category has nowhere sensible to sit under Demand or
  // Supply, so it waits in _Unclassified rather than being guessed into one.
  const classified = category !== null;
  const segments = classified
    ? [DRIVE_ROOT, CATEGORY_FOLDER[category], safeFolderName(counterparty), STAGE_FOLDER[stage]]
    : [DRIVE_ROOT, UNCLASSIFIED_FOLDER, safeFolderName(counterparty)];
  return { segments, path: `/${segments.join('/')}`, classified };
}

/**
 * Versioned file name — spec 9.5 requires never overwriting, always versioning.
 *
 *   <Counterparty> - <Doc type> - v<N> - <YYYY-MM-DD>.<ext>
 */
export function versionedFileName(opts: {
  counterparty: string;
  docType: string;
  version: number;
  date: string;
  extension?: string;
}): string {
  const ext = (opts.extension ?? 'pdf').replace(/^\./, '').toLowerCase();
  const parts = [
    safeFolderName(opts.counterparty),
    opts.docType.trim() || 'Agreement',
    `v${Math.max(1, Math.floor(opts.version))}`,
    opts.date,
  ];
  return `${parts.join(' - ')}.${ext}`;
}

/**
 * Categorises a counterparty from how it earns or costs money.
 *
 * Returns null rather than guessing: an unclassified contract goes to
 * `_Unclassified` and raises an alert, which is recoverable. A contract filed
 * under the wrong counterparty is not.
 */
export function categoriseCounterparty(signals: {
  isDemandPartner?: boolean;
  isSupplyPartner?: boolean;
  isPublisher?: boolean;
  hint?: string | null;
}): ContractCategory | null {
  if (signals.isDemandPartner && !signals.isSupplyPartner) return 'demand';
  if (signals.isSupplyPartner || signals.isPublisher) return 'supply';

  const hint = signals.hint?.toLowerCase() ?? '';
  if (!hint) return null;
  if (/\b(dsp|demand|advertiser|buyer)\b/.test(hint)) return 'demand';
  if (/\b(ssp|supply|publisher|inventory|seller)\b/.test(hint)) return 'supply';
  if (/\b(nda|office|lease|employment|vendor|insurance|bank)\b/.test(hint)) return 'general';
  return null;
}
