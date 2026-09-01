import { describe, expect, it } from 'vitest';
import {
  domainOf, fieldsToFill, isCompanyDomain, isHarvestable, signatureBlock,
} from '@/lib/crm/from-mail';
// @ts-expect-error — the generated job copy is plain ESM with no types.
import * as js from '@/deploy/crm-from-mail.mjs';

/**
 * The backfill and the screen must agree about who belongs in the CRM.
 *
 * The job writes the rows; anything the app decides differently would show as
 * a contact it refuses to explain, or one it keeps proposing to add.
 */
const ADDRESSES = [
  'dana@taboola.com',
  'amir@adnimation.com',
  'x@mail.adnimation.com',
  'no-reply@stripe.com',
  'info@vendor.com',
  'dana@gmail.com',
  'someone@em.mailchimp.com',
  'not an email',
];

const BODIES = [
  'Thanks!\n\nDana Levi\nVP Partnerships | Taboola\n+972-50-1234567',
  'Yes.\n\nDana\n\nOn Mon wrote:\n> Yossi\n> CTO',
  'שלום\n\nדנה\n\nבתאריך 1 בספט׳ 2026 בשעה 9:00 מאת A <a@b.com>:\n> אחר',
  '',
];

describe('crm harvest parity', () => {
  it('agrees about who is worth a record', () => {
    for (const email of ADDRESSES) {
      expect(js.isHarvestable({ email }), email).toEqual(isHarvestable({ email }));
      expect(js.domainOf(email), email).toBe(domainOf(email));
      expect(js.isCompanyDomain(email), email).toBe(isCompanyDomain(email));
    }
  });

  it('agrees about where the signature is', () => {
    for (const body of BODIES) {
      expect(js.signatureBlock(body)).toBe(signatureBlock(body));
    }
  });

  it('agrees about what may be written', () => {
    const existing: Record<string, string | null> = { jobTitle: 'CEO', phone: null, companyName: '' };
    const found = { jobTitle: 'Chief Executive', phone: '+972-50-1', companyName: 'Taboola' };
    expect(js.fieldsToFill(existing, found)).toEqual(fieldsToFill(existing, found));
  });
});
