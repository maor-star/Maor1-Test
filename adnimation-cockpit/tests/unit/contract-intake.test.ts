import { describe, expect, it } from 'vitest';
import {
  counterpartyFrom, looksLikeContract, versionFromName, type AttachmentInput,
} from '@/lib/contracts/intake';
import {
  CATEGORY_FOLDER, CONTRACT_CATEGORIES, STAGE_FOLDER, categoriseCounterparty, filingFolder,
  stageForStatus, versionedFileName,
} from '@/lib/contracts/drive';
import { BOARD_STATUSES, WAITING_ON } from '@/lib/contracts/status';

function attachment(over: Partial<AttachmentInput> = {}): AttachmentInput {
  return {
    fileName: 'Adnimation - Markito - Agreement.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 240_000,
    context: 'Please find the signed agreement attached.',
    ...over,
  };
}

/**
 * Deciding what is a contract.
 *
 * The asymmetry matters here and is the opposite of the opportunity
 * detector's: a contract nobody noticed is a document that never gets filed,
 * which is expensive; a wrong guess costs one click. So these check that it
 * leans towards proposing, while still refusing the documents that are
 * definitely something else.
 */
describe('contracts — spotting one in an attachment', () => {
  it('takes a document that says what it is', () => {
    const g = looksLikeContract(attachment());
    expect(g.isContract).toBe(true);
    expect(g.confidence).toBe('high');
  });

  it('takes one where only the message says so', () => {
    const g = looksLikeContract(
      attachment({ fileName: 'scan_0012.pdf', context: 'Here is the NDA for signature.' }),
    );
    expect(g.isContract).toBe(true);
    expect(g.confidence).toBe('medium');
  });

  it('reads Hebrew', () => {
    const g = looksLikeContract(attachment({ fileName: 'הסכם שיתוף פעולה.pdf', context: 'לחתימה' }));
    expect(g.isContract).toBe(true);
  });

  it('still shows an unexplained document, at low confidence', () => {
    const g = looksLikeContract(attachment({ fileName: 'doc1.pdf', context: 'see attached' }));
    expect(g.isContract).toBe(true);
    expect(g.confidence).toBe('low');
  });

  it.each([
    ['a spreadsheet', 'numbers.xlsx', 'application/vnd.ms-excel'],
    ['an image', 'signature.png', 'image/png'],
    ['a calendar file', 'invite.ics', 'text/calendar'],
  ])('ignores %s', (_label, fileName, mimeType) => {
    expect(looksLikeContract(attachment({ fileName, mimeType })).isContract).toBe(false);
  });

  it.each([
    ['an invoice', 'Invoice 4821.pdf', 'Payment due'],
    ['a report', 'August report.pdf', 'Monthly analytics report'],
    ['a CV', 'Dana CV.pdf', 'Applying for the ad ops role'],
    ['an invoice in Hebrew', 'חשבונית 221.pdf', 'לתשלום'],
    ['a flight booking', 'EL AL booking.pdf', 'Your EL AL Booking Confirmation'],
    ['a payout statement', 'August.pdf', 'Pubmatic deduction reconciliation'],
  ])('refuses %s', (_label, fileName, context) => {
    expect(looksLikeContract(attachment({ fileName, context })).isContract).toBe(false);
  });

  it('refuses something far too small to be an agreement', () => {
    expect(looksLikeContract(attachment({ sizeBytes: 900 })).isContract).toBe(false);
  });

  it('copes with an unknown mime type by reading the extension', () => {
    expect(looksLikeContract(attachment({ mimeType: null })).isContract).toBe(true);
  });
});

describe('contracts — which version this is', () => {
  it.each([
    ['Markito Agreement v3.pdf', 0, 3],
    ['Markito_Agreement_V2.docx', 1, 2],
    ['agreement rev 4.pdf', 2, 4],
    ['MSA-v10.pdf', 3, 10],
  ])('reads the number out of %s', (name, existing, expected) => {
    expect(versionFromName(name, existing)).toBe(expected);
  });

  it('counts on from what we hold when the name says nothing', () => {
    expect(versionFromName('agreement.pdf', 2)).toBe(3);
    expect(versionFromName('agreement.pdf', 0)).toBe(1);
  });

  it('never goes backwards when an old version is re-sent', () => {
    // "v1" arriving after three versions is a resend, not a fourth — but it is
    // still the newest thing we have seen, so it must not overwrite v1.
    expect(versionFromName('agreement v1.pdf', 3)).toBe(4);
  });

  it('is not fooled by a year or a date in the name', () => {
    expect(versionFromName('Agreement 2026-08-31.pdf', 1)).toBe(2);
  });
});

describe('contracts — who it is with', () => {
  it('prefers a company we already know', () => {
    expect(
      counterpartyFrom({ email: 'r@markito.com', displayName: 'Ravit', knownCompany: 'Markito Ltd' }),
    ).toBe('Markito Ltd');
  });

  it('takes the company from the domain, not the person', () => {
    expect(counterpartyFrom({ email: 'ravit@markito.co.il', displayName: 'Ravit' })).toBe('Markito');
  });

  it('falls back to the name for a free-mail address', () => {
    // A gmail address says nothing about which company anyone is from.
    expect(counterpartyFrom({ email: 'ravit@gmail.com', displayName: 'Ravit Cohen' })).toBe(
      'Ravit Cohen',
    );
  });

  it('returns nothing rather than a guess', () => {
    expect(counterpartyFrom({ email: null, displayName: null })).toBeNull();
  });

  it('is never ourselves', () => {
    // Every internal forward resolved to our own domain and piled fourteen
    // unrelated documents into one "Adnimation" contract.
    expect(
      counterpartyFrom({
        email: 'amir@adnimation.com',
        displayName: 'Amir',
        ownDomain: 'adnimation.com',
      }),
    ).toBeNull();
  });

  it('uses the company the thread is with when the sender is one of ours', () => {
    expect(
      counterpartyFrom({
        email: 'maor@adnimation.com',
        displayName: 'Maor',
        knownCompany: 'Taboola',
        ownDomain: 'adnimation.com',
      }),
    ).toBe('Taboola');
  });
});

/**
 * Where the file ends up. The folder shape he chose puts the status inside the
 * counterparty's folder, so Drive alone answers "what is stuck".
 */
describe('contracts — where it is filed', () => {
  it('files a demand contract under the counterparty and its status', () => {
    const target = filingFolder('Google', 'demand', 'awaiting_my_signature');
    expect(target.path).toBe('/Adnimation Contracts/Demand/Google/Awaiting my signature');
    expect(target.classified).toBe(true);
  });

  it('holds an unclassified one apart rather than guessing a category', () => {
    const target = filingFolder('Google', null);
    expect(target.path).toBe('/Adnimation Contracts/_Unclassified/Google');
    expect(target.classified).toBe(false);
  });

  it('gives every board status a folder', () => {
    for (const status of BOARD_STATUSES) {
      expect(STAGE_FOLDER[stageForStatus(status)]).toBeTruthy();
    }
  });

  it('knows whose move each status is', () => {
    expect(WAITING_ON.unclassified).toBe('you');
    expect(WAITING_ON.awaiting_my_signature).toBe('you');
    expect(WAITING_ON.out_for_signature).toBe('them');
    expect(WAITING_ON.signed).toBe('nobody');
  });

  it('gives mutual and quote their own folders, apart from the two sides', () => {
    expect(filingFolder('Vidazoo', 'mutual', 'signed').path).toBe(
      '/Adnimation Contracts/Mutual/Vidazoo/Signed',
    );
    expect(filingFolder('Vidazoo', 'quote', 'in_review').path).toBe(
      '/Adnimation Contracts/Quotes/Vidazoo/In review',
    );
  });

  it('has a folder for every category on offer, and offers every one it can file', () => {
    // The two must not drift: a category with no folder cannot be filed, and a
    // folder with no option cannot be chosen.
    for (const category of CONTRACT_CATEGORIES) {
      expect(CATEGORY_FOLDER[category], `no folder for ${category}`).toBeTruthy();
    }
    expect(new Set(CONTRACT_CATEGORIES)).toEqual(
      new Set(Object.keys(CATEGORY_FOLDER)),
    );
  });

  it('names versions so they sort and never collide', () => {
    const v1 = versionedFileName({
      counterparty: 'Google', docType: 'Demand agreement', version: 1, date: '2026-05-02',
    });
    const v2 = versionedFileName({
      counterparty: 'Google', docType: 'Demand agreement', version: 2, date: '2026-08-31',
    });
    expect(v1).not.toBe(v2);
    expect(v2).toContain('v2');
    expect(v2).toContain('2026-08-31');
  });
});

/**
 * Categorising a counterparty automatically.
 *
 * The interesting case is a partner on both sides, which before `mutual`
 * existed fell through to supply — so every two-way agreement was quietly
 * filed on one side of the business.
 */
describe('contracts — categorising the counterparty', () => {
  it('calls a partner on both sides mutual, not whichever side wins a tie', () => {
    expect(categoriseCounterparty({ isDemandPartner: true, isSupplyPartner: true })).toBe('mutual');
    expect(categoriseCounterparty({ isDemandPartner: true, isPublisher: true })).toBe('mutual');
  });

  it('still calls a one-sided partner by its side', () => {
    expect(categoriseCounterparty({ isDemandPartner: true })).toBe('demand');
    expect(categoriseCounterparty({ isSupplyPartner: true })).toBe('supply');
    expect(categoriseCounterparty({ isPublisher: true })).toBe('supply');
  });

  it('reads both sides out of the text as mutual', () => {
    expect(categoriseCounterparty({ hint: 'DSP and SSP integration agreement' })).toBe('mutual');
    expect(categoriseCounterparty({ hint: 'a mutual agreement' })).toBe('mutual');
  });

  it('recognises a quote, in either language, before it picks a side', () => {
    // A supply quote is still a quote — the pile it belongs in is quotes.
    expect(categoriseCounterparty({ hint: 'supply rate card and quotation' })).toBe('quote');
    expect(categoriseCounterparty({ hint: 'הצעת מחיר לשירותי דימנד' })).toBe('quote');
  });

  it('says nothing rather than guessing', () => {
    expect(categoriseCounterparty({ hint: 'hello' })).toBeNull();
    expect(categoriseCounterparty({})).toBeNull();
  });
});
