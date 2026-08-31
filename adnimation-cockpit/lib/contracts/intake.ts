/**
 * Deciding whether an attachment is a contract, and who it is with.
 *
 * Pure, so both the screen and the job can use it and the tests can pin it
 * down. The bar is different from the opportunity detector's: a missed
 * contract is a document he never files, which is worse than a wrong guess he
 * dismisses in one click. So this leans towards proposing — but everything it
 * proposes lands in "needs classifying" and nothing is filed anywhere until he
 * says what it is.
 */

/** Document types we can actually file. A .png of a signature page is not one. */
const CONTRACT_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'application/vnd.oasis.opendocument.text',
]);

const CONTRACT_EXT = /\.(pdf|docx?|rtf|odt)$/i;

/** Words that mean "this is an agreement", in both languages his mail arrives in. */
const CONTRACT_WORDS = [
  /\b(contract|agreement|addendum|amendment|annex|appendix|sow|statement of work)\b/i,
  /\b(nda|non-?disclosure|mou|memorandum of understanding|loi|letter of intent)\b/i,
  /\b(io|insertion order|msa|master service|terms and conditions|t&cs?)\b/i,
  /\b(countersign|counter-?signed|fully executed|for signature|to sign|signature page)\b/i,
  /\b(docusign|dropbox ?sign|hellosign|adobe ?sign|pandadoc|signnow)\b/i,
  /(חוזה|הסכם|נספח|תוספת להסכם|מזכר הבנות|לחתימה|חתום)/,
];

/** Attachments that look like documents and never are. */
const NOT_CONTRACT = [
  /\b(invoice|receipt|statement|remittance|payslip|purchase order|quote)\b/i,
  /\b(report|analytics|dashboard|newsletter|deck|presentation|proposal deck)\b/i,
  /\b(cv|resume|curriculum vitae)\b/i,
  /(חשבונית|קבלה|דו"?ח|תלוש)/,
  /*
   * Seen against the real mailbox. Travel documents are PDFs from a company
   * with a real domain and read exactly like an agreement to a phrase matcher.
   */
  /\b(booking (confirmation|reference)|e-?ticket|itinerary|boarding pass|reservation)\b/i,
  /\b(deduction|credit note|self-?bill|payout statement|reconciliation)\b/i,
];

export interface AttachmentInput {
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  /** The subject and snippet of the mail, or the Slack message text. */
  context: string;
}

export interface ContractGuess {
  isContract: boolean;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

/** Below this it is a logo or a signature block, not an agreement. */
const MIN_BYTES = 8 * 1024;

export function looksLikeContract(input: AttachmentInput): ContractGuess {
  const reasons: string[] = [];
  const name = input.fileName ?? '';
  const haystack = `${name}\n${input.context ?? ''}`;

  const rightType =
    (input.mimeType !== null && CONTRACT_MIME.has(input.mimeType)) || CONTRACT_EXT.test(name);
  if (!rightType) return { isContract: false, confidence: 'low', reasons: [] };

  if (input.sizeBytes !== null && input.sizeBytes < MIN_BYTES) {
    return { isContract: false, confidence: 'low', reasons: ['too small to be a document'] };
  }

  if (NOT_CONTRACT.some((r) => r.test(haystack))) {
    return { isContract: false, confidence: 'low', reasons: ['reads as an invoice or a report'] };
  }

  const inName = CONTRACT_WORDS.filter((r) => r.test(name)).length;
  const inContext = CONTRACT_WORDS.filter((r) => r.test(input.context ?? '')).length;

  if (inName > 0) {
    reasons.push('the file name says so');
    if (inContext > 0) reasons.push('so does the message');
    return { isContract: true, confidence: 'high', reasons };
  }
  if (inContext > 0) {
    reasons.push('the message says so');
    return { isContract: true, confidence: 'medium', reasons };
  }

  // A PDF from someone we deal with, with nothing saying what it is. Worth
  // showing once rather than dropping — he classifies it in one click, and a
  // contract we never noticed is the expensive mistake.
  reasons.push('a document with no clue what it is');
  return { isContract: true, confidence: 'low', reasons };
}

/**
 * What version of an agreement this is.
 *
 * Counterparties name files in every possible way, and the number in the name
 * is the only signal about ordering that survives being forwarded around. When
 * there is none, the count of what we already hold decides.
 */
export function versionFromName(fileName: string, existingVersions: number): number {
  const explicit =
    /[_\-. (]v(?:er(?:sion)?)?[_\-. ]?(\d{1,2})\b/i.exec(fileName)?.[1] ??
    /\b(?:rev|revision|draft)[_\-. ]?(\d{1,2})\b/i.exec(fileName)?.[1];

  const parsed = explicit ? Number(explicit) : NaN;
  // A file called "v1" arriving when three versions are already held is a
  // re-send of the first, not a fourth — but it is still the newest thing we
  // have seen, so it never goes backwards.
  return Number.isFinite(parsed) && parsed > existingVersions ? parsed : existingVersions + 1;
}

/**
 * Who the contract is with, from an email address or a Slack author.
 *
 * The domain beats the display name: "Ravit" is not a counterparty and
 * "markito.com" is. Free-mail domains are skipped because they say nothing
 * about which company anyone is from.
 */
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com',
  'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'walla.co.il', 'walla.com',
]);

export function counterpartyFrom(opts: {
  email?: string | null;
  displayName?: string | null;
  knownCompany?: string | null;
  /** Our own domain — never a counterparty to ourselves. */
  ownDomain?: string | null;
}): string | null {
  const domain = (opts.email ?? '').split('@')[1]?.toLowerCase().replace(/^www\./, '');
  const own = opts.ownDomain?.toLowerCase().replace(/^www\./, '') ?? null;

  /*
   * Mail from our own people is not a contract with ourselves.
   *
   * Against the real mailbox this put fourteen unrelated documents under one
   * "Adnimation" contract, because every internal forward resolved to our own
   * domain. Where the thread names a company we deal with, that is the
   * counterparty; otherwise we do not know, and a colleague's name is a worse
   * answer than none.
   */
  if (own && domain === own) return opts.knownCompany ?? null;

  if (opts.knownCompany) return opts.knownCompany;

  if (domain && !FREE_MAIL.has(domain)) {
    // markito.co.il → Markito. The registrable part is the company.
    const label = domain.split('.')[0] ?? '';
    if (label.length > 1) return label.charAt(0).toUpperCase() + label.slice(1);
  }

  const name = opts.displayName?.trim();
  return name && name.length > 1 ? name : null;
}
