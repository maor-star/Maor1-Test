import { describe, expect, it } from 'vitest';
import {
  assertInternalRecipients, isInternalAddress, looksLikeInvoice, type InvoiceInput,
} from '@/lib/agents/internal-mail';

/**
 * The one agent allowed to send mail can only send it inside the company.
 *
 * That is the property the whole design rests on: an agent holding this action
 * cannot reach a counterparty however it is configured, whatever level it runs
 * at, and whatever ends up in its config. So these test the boundary the way
 * someone trying to cross it would.
 */
const DOMAINS = ['adnimation.com'];

describe('internal mail — the boundary', () => {
  it('accepts an address inside the company', () => {
    expect(isInternalAddress('finance@adnimation.com', DOMAINS)).toBe(true);
    expect(isInternalAddress('  Finance@Adnimation.COM  ', DOMAINS)).toBe(true);
  });

  it('accepts a subdomain of it', () => {
    expect(isInternalAddress('ap@billing.adnimation.com', DOMAINS)).toBe(true);
  });

  it.each([
    ['a plain outsider', 'ravit@markito.com'],
    ['a lookalike domain', 'finance@notadnimation.com'],
    ['a suffix attack', 'finance@evil-adnimation.com'],
    ['our name on their domain', 'adnimation.com@evil.com'],
    ['a subdomain the other way round', 'x@adnimation.com.evil.com'],
  ])('refuses %s', (_label, address) => {
    expect(isInternalAddress(address, DOMAINS)).toBe(false);
  });

  it('refuses a display name smuggling a second address', () => {
    // "x@evil.com <finance@adnimation.com>" passes a naive contains check.
    expect(isInternalAddress('x@evil.com <finance@adnimation.com>', DOMAINS)).toBe(false);
    expect(isInternalAddress('Finance <finance@adnimation.com>', DOMAINS)).toBe(false);
  });

  it('refuses the whole send when one recipient is outside', () => {
    const result = assertInternalRecipients(
      ['finance@adnimation.com', 'ravit@markito.com'],
      DOMAINS,
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/markito/);
  });

  it('refuses a send with no recipient at all', () => {
    expect(assertInternalRecipients([], DOMAINS).ok).toBe(false);
  });

  it('normalises the recipients it accepts', () => {
    const result = assertInternalRecipients([' Finance@Adnimation.com '], DOMAINS);
    expect(result.ok && result.recipients).toEqual(['finance@adnimation.com']);
  });
});

function mail(over: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    subject: 'Invoice 4821 for August',
    snippet: 'Please find attached our invoice, payment due net 30.',
    fromEmail: 'billing@vendor.com',
    attachmentNames: ['invoice-4821.pdf'],
    // Overridden per case; the defaults above are a real invoice.
    ...over,
  };
}

/**
 * Invoices, where the asymmetry runs the opposite way from contracts: a missed
 * one he forwards by hand, a wrong one has finance chasing a payment that does
 * not exist.
 */
describe('internal mail — spotting an invoice', () => {
  it('takes a mail that says invoice and carries one', () => {
    expect(looksLikeInvoice(mail()).isInvoice).toBe(true);
  });

  it('reads Hebrew', () => {
    expect(
      looksLikeInvoice(mail({ subject: 'חשבונית מס 221', snippet: 'לתשלום', attachmentNames: ['221.pdf'] }))
        .isInvoice,
    ).toBe(true);
  });

  it('refuses the word without a document — that is a chase, not an invoice', () => {
    expect(looksLikeInvoice(mail({ attachmentNames: [] })).isInvoice).toBe(false);
    expect(looksLikeInvoice(mail({ attachmentNames: ['logo.png'] })).isInvoice).toBe(false);
  });

  it('refuses a document without the word — that is anything at all', () => {
    expect(
      looksLikeInvoice(
        mail({
          subject: 'The deck from today',
          snippet: 'as discussed',
          // The file name counts as evidence too, so it has to be neutral here
          // or the test is asserting nothing.
          attachmentNames: ['deck.pdf'],
        }),
      ).isInvoice,
    ).toBe(false);
  });

  it('takes the file name alone as the word, since that is where it usually is', () => {
    expect(
      looksLikeInvoice(
        mail({ subject: 'From us', snippet: 'attached', attachmentNames: ['invoice-4821.pdf'] }),
      ).isInvoice,
    ).toBe(true);
  });

  it.each([
    ['a quote', 'Quotation for Q4', 'our quote attached'],
    ['a request that we invoice them', 'Please send us your invoice', 'so we can pay you'],
    ['a purchase order', 'Purchase order 88', 'PO attached'],
    ['a quote in Hebrew', 'הצעת מחיר', 'מצורף'],
    // Both of these were proposed for forwarding against the real mailbox,
    // because "please find" matched. It appears in every second email.
    ['a signed contract', 'Re: Adnimation / LoopMe contracts', 'Please find the signed MSA'],
    ['an IVT report', 'URGENT - PGAM - IVT report 2026', 'Please find the report attached'],
  ])('refuses %s', (_label, subject, snippet) => {
    expect(looksLikeInvoice(mail({ subject, snippet })).isInvoice).toBe(false);
  });

  it('says nothing about an empty mail', () => {
    expect(
      looksLikeInvoice({ subject: null, snippet: null, fromEmail: null, attachmentNames: [] })
        .isInvoice,
    ).toBe(false);
  });
});
