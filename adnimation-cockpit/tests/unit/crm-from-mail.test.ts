import { describe, expect, it } from 'vitest';
import {
  domainOf, fieldsToFill, isCompanyDomain, isHarvestable, signatureBlock,
} from '@/lib/crm/from-mail';

/**
 * Reading contacts off the mailbox.
 *
 * The failure that matters is a CRM full of newsletters and no-reply
 * addresses: one bad row and he stops trusting the list, which is worse than
 * an empty one. The second is attaching the wrong person's title to a sender,
 * which happens when a signature is read out of quoted history.
 */
describe('who is worth a CRM record', () => {
  it('takes a person at another company', () => {
    expect(isHarvestable({ email: 'dana@taboola.com' }).ok).toBe(true);
  });

  it('never takes our own people — they are in the team list, not the CRM', () => {
    expect(isHarvestable({ email: 'amir@adnimation.com' }).ok).toBe(false);
    expect(isHarvestable({ email: 'x@mail.adnimation.com' }).ok).toBe(false);
  });

  it.each([
    // Every one of these actually arrived in his mailbox, and every one got
    // through the first version of this rule because the giveaway was not at
    // the front of the address.
    'admanager-noreply@google.com',
    'defendercloudnoreply@microsoft.com',
    'confirmations@altshul.co.il',
    'renewals@godaddy.com',
    'invoice+statements@mail.anthropic.com',
    'wordpress@yahasim.com',
    'databeat@mail.beehiiv.com',
    'msonlineservicesteam@microsoftonline.com',
    'publisher-policy-noreply@google.com',
    // Machine addresses that got through the second version and into the CRM.
    '6098587006-jjjd.6thw.9bcr.8ep6@property.booking.com',
    '24-24585605686_172314932ca79483@support.booking.com',
    'yeynawine@193862610.mailchimpapp.com',
    'no-reply@stripe.com',
    'noreply@linkedin.com',
    'do-not-reply@aws.amazon.com',
    'info@vendor.com',
    'billing@vendor.com',
    'careers@vendor.com',
    'notifications@github.com',
    'newsletter@digiday.com',
    'security@google.com',
    'bounce@mailer.com',
    'someone@em.mailchimp.com',
  ])('leaves %s alone', (email) => {
    expect(isHarvestable({ email }).ok).toBe(false);
  });

  it('still keeps the real people who wrote in the same fortnight', () => {
    for (const email of [
      'akkerman@digitalturbine.com',
      'zenda.laqui@verve.com',
      'jstover@fusemedia.com',
      'nayana.k@dollarbirdinc.com',
      'korren6@gmail.com',
      // A long name with a hyphen is still a person, and must survive the
      // length and digit rules aimed at reference numbers.
      'jean-philippe.deschamps@publicismedia.fr',
    ]) {
      expect(isHarvestable({ email }).ok, email).toBe(true);
    }
  });

  it('rejects anything that is not an address at all', () => {
    expect(isHarvestable({ email: 'not an email' }).ok).toBe(false);
    expect(isHarvestable({ email: 'missing-at-sign' }).ok).toBe(false);
  });

  it('knows a company domain from a free mailbox', () => {
    expect(isCompanyDomain('dana@taboola.com')).toBe(true);
    expect(isCompanyDomain('dana@gmail.com')).toBe(false);
    expect(isCompanyDomain('dana@walla.co.il')).toBe(false);
    expect(domainOf('Dana@Taboola.com')).toBe('taboola.com');
  });
});

describe('finding the signature', () => {
  it('takes the tail of what this person wrote', () => {
    const body = [
      'Hi Maor,',
      'Sounds good, see you Tuesday.',
      '',
      'Dana Levi',
      'VP Partnerships | Taboola',
      '+972-50-1234567',
    ].join('\n');
    expect(signatureBlock(body)).toContain('VP Partnerships');
  });

  it('never reads a signature out of quoted history', () => {
    const body = [
      'Yes, agreed.',
      '',
      'Dana Levi',
      'Taboola',
      '',
      'On Mon, 1 Sep 2026 at 09:00, Someone Else <other@elsewhere.com> wrote:',
      '> Regards,',
      '> Yossi Cohen',
      '> CTO, Elsewhere Ltd',
    ].join('\n');
    const block = signatureBlock(body);
    expect(block).toContain('Dana Levi');
    expect(block).not.toContain('Yossi Cohen');
  });

  it('handles a Hebrew quote marker too', () => {
    const body = 'תודה!\n\nדנה לוי\nטאבולה\n\nבתאריך 1 בספט׳ 2026 בשעה 9:00 מאת Someone <a@b.com>:\n> חתימה אחרת';
    expect(signatureBlock(body)).not.toContain('חתימה אחרת');
  });
});

describe('what gets written', () => {
  it('fills what is empty and never overwrites what is there', () => {
    const existing: Record<string, string | null> = { jobTitle: 'CEO', phone: null, companyName: '' };
    const patch = fieldsToFill(existing, {
      jobTitle: 'Chief Executive',
      phone: '+972-50-1234567',
      companyName: 'Taboola',
    });
    expect(patch).toEqual({ phone: '+972-50-1234567', companyName: 'Taboola' });
  });

  it('ignores empty findings rather than blanking a field with them', () => {
    const held: Record<string, string | null> = { phone: '+1' };
    const empty: Record<string, string | null> = { phone: null };
    expect(fieldsToFill(held, { phone: null })).toEqual({});
    expect(fieldsToFill(empty, { phone: '' })).toEqual({});
  });
});
