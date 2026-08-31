/**
 * GENERATED FROM lib/contracts/drive.ts — do not edit by hand.
 *
 * The jobs run as plain ESM outside the compiled app, so they need a
 * JavaScript copy of these rules. tests/unit/contract-folders-parity.test.ts
 * feeds both this file and the TypeScript original the same inputs and fails
 * if they ever disagree, so an edit to one without the other cannot ship.
 *
 * Regenerate with: node deploy/build-detect.mjs
 */
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

/**
 * `mutual` is a partner we both buy from and sell to, which is common enough
 * that forcing one of those agreements onto a single side files it where
 * nobody will look for it.
 *
 * `quote` is not an agreement at all but the document that precedes one, and
 * it carries its own question — is it still outstanding — so it keeps its own
 * pile rather than being buried among signed contracts.
 */
/**
 * Every category, in the order they are offered.
 *
 * One list, because three separate screens each hardcoded their own and two of
 * them silently kept offering the old three when `mutual` and `quote` were
 * added — a category you cannot pick may as well not exist.
 */
export const CONTRACT_CATEGORIES = [
  'demand', 'supply', 'mutual', 'quote', 'general',
];

export const CATEGORY_FOLDER = {
  demand: 'Demand',
  supply: 'Supply',
  mutual: 'Mutual',
  quote: 'Quotes',
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
export const STAGE_FOLDER = {
  unclassified: 'Needs classifying',
  in_review: 'In review',
  out_for_signature: 'Out for signature',
  awaiting_my_signature: 'Awaiting my signature',
  signed: 'Signed',
};

/** How a contract's status maps onto the folder it belongs in. */
export function stageForStatus(status) {
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
export function safeFolderName(name) {
  const cleaned = name
    .replace(/[/\\]/g, '-')
    // Control characters would be invisible in a folder name.
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : UNCLASSIFIED_FOLDER;
}

export function filingFolder(counterparty, category, stage = 'signed') {
  // A contract with no category has nowhere sensible to sit under Demand or
  // Supply, so it waits in _Unclassified rather than being guessed into one.
  const classified = category !== null;
  const segments = classified
    ? [CATEGORY_FOLDER[category], safeFolderName(counterparty), STAGE_FOLDER[stage]]
    : [UNCLASSIFIED_FOLDER, safeFolderName(counterparty)];
  return { segments, path: `/${[DRIVE_ROOT, ...segments].join('/')}`, classified };
}

/**
 * Versioned file name — spec 9.5 requires never overwriting, always versioning.
 *
 *   <Counterparty> - <Doc type> - v<N> - <YYYY-MM-DD>.<ext>
 */
export function versionedFileName(opts) {
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
export function categoriseCounterparty(signals) {
  const supplySide = signals.isSupplyPartner || signals.isPublisher;

  // Both sides is its own answer. Before `mutual` existed this fell through to
  // supply, which quietly filed every two-way agreement on one side.
  if (signals.isDemandPartner && supplySide) return 'mutual';
  if (signals.isDemandPartner) return 'demand';
  if (supplySide) return 'supply';

  const hint = signals.hint?.toLowerCase() ?? '';
  if (!hint) return null;

  // A quote names itself, and reading as a quote beats reading as a side: a
  // supply quote is still a quote.
  if (/\b(quote|quotation|price list|rate card|pricing proposal)\b/.test(hint)) return 'quote';
  if (/(הצעת מחיר|הצעה כספית)/.test(hint)) return 'quote';

  const saysDemand = /\b(dsp|demand|advertiser|buyer)\b/.test(hint);
  const saysSupply = /\b(ssp|supply|publisher|inventory|seller)\b/.test(hint);
  if (saysDemand && saysSupply) return 'mutual';
  if (/\b(mutual|two-?way|reciprocal|bi-?directional)\b/.test(hint)) return 'mutual';
  if (saysDemand) return 'demand';
  if (saysSupply) return 'supply';
  if (/\b(nda|office|lease|employment|vendor|insurance|bank)\b/.test(hint)) return 'general';
  return null;
}
