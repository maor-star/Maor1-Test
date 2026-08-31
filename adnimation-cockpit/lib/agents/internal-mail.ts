/**
 * Sending mail that cannot leave the company.
 *
 * Forwarding an invoice to finance is a send, and the spec treats sending as
 * irreversible for good reason — you cannot unsend. But the risk in a send is
 * almost entirely about who receives it: a misrouted invoice inside Adnimation
 * is an awkward minute, and the same mail to a counterparty is a different
 * kind of day.
 *
 * So this is a narrower action than `send_external_email`, and the narrowness
 * is enforced rather than intended: every recipient is checked against the
 * allowed internal domains, and an address outside them is refused before
 * anything is sent. An agent holding only this action cannot mail the outside
 * world however it is configured, whatever level it is set to, and whatever a
 * model decides to put in the config.
 */

/** Domains a forward may reach. Everything else is an external send. */
export const INTERNAL_DOMAINS = (process.env.INTERNAL_MAIL_DOMAINS ?? 'adnimation.com')
  .split(',')
  .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);

export function isInternalAddress(address: string, domains = INTERNAL_DOMAINS): boolean {
  const email = address.trim().toLowerCase();
  // A display name wrapper would let "x@evil.com <finance@adnimation.com>"
  // through a naive check, so only a bare address is accepted here.
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(email)) return false;

  const domain = email.split('@')[1];
  if (!domain) return false;
  // Exact domain or a subdomain of it — never a suffix match, which would let
  // "notadnimation.com" pass.
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function assertInternalRecipients(
  recipients: string[],
  domains = INTERNAL_DOMAINS,
): { ok: true; recipients: string[] } | { ok: false; error: string } {
  if (recipients.length === 0) return { ok: false, error: 'No recipient' };

  const outside = recipients.filter((r) => !isInternalAddress(r, domains));
  if (outside.length > 0) {
    return {
      ok: false,
      error:
        `Refusing to send outside the company: ${outside.join(', ')}. ` +
        `This action may only reach ${domains.join(', ')}.`,
    };
  }
  return { ok: true, recipients: recipients.map((r) => r.trim().toLowerCase()) };
}

/**
 * Whether a mail carries an invoice.
 *
 * The cost is asymmetric in the opposite direction from contracts: a missed
 * invoice is one he forwards by hand, and a wrongly forwarded one is finance
 * chasing a payment that does not exist. So this wants the word AND a document
 * — either alone is not enough.
 */
const INVOICE_WORDS = [
  /\b(invoice|inv\.?\s?#|bill(ing)? statement|receipt|remittance|credit note|proforma)\b/i,
  /*
   * NOT "please find". Against the real mailbox that phrase pulled in an IVT
   * report and a signed MSA — it appears in every second email and says
   * nothing about invoices.
   */
  /\b(payment (due|request|advice)|amount due|please remit|remittance advice|net ?\d{2}\b)\b/i,
  /(חשבונית|חשבונית מס|קבלה|דרישת תשלום|לתשלום)/,
];

/** Things that mention invoices and are not one. */
const NOT_AN_INVOICE = [
  /\b(quote|quotation|estimate|proposal|purchase order)\b/i,
  // Documents that arrive alongside invoices and are not one.
  /\b(msa|agreement|contract|addendum|amendment|nda|sow)\b/i,
  /\b(ivt|traffic|performance|analytics) report\b/i,
  /\b(reminder to invoice|please invoice us|send us your invoice)\b/i,
  /\b(newsletter|webinar|unsubscribe)\b/i,
  /(הצעת מחיר|הזמנת רכש)/,
];

const DOCUMENT = /\.(pdf|docx?|xlsx?|csv)$/i;

export interface InvoiceInput {
  subject: string | null;
  snippet: string | null;
  fromEmail: string | null;
  attachmentNames: string[];
}

export interface InvoiceGuess {
  isInvoice: boolean;
  reasons: string[];
}

export function looksLikeInvoice(input: InvoiceInput): InvoiceGuess {
  const text = `${input.subject ?? ''}\n${input.snippet ?? ''}\n${input.attachmentNames.join(' ')}`;
  if (text.trim() === '') return { isInvoice: false, reasons: [] };

  if (NOT_AN_INVOICE.some((r) => r.test(text))) {
    return { isInvoice: false, reasons: ['reads as a quote or a request to invoice'] };
  }

  const reasons: string[] = [];
  const worded = INVOICE_WORDS.some((r) => r.test(text));
  if (worded) reasons.push('says invoice');

  const documents = input.attachmentNames.filter((n) => DOCUMENT.test(n));
  if (documents.length > 0) reasons.push(`carries ${documents.join(', ')}`);

  // Both, always. An invoice with no document is a chase, and a document with
  // no word is anything at all.
  return { isInvoice: worded && documents.length > 0, reasons };
}
