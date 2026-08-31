import { describe, expect, it } from 'vitest';
import { isSpentAuthCode, looksPromotional, type MailFacts } from '@/lib/agents/mailbox';
// @ts-expect-error — the generated job copy is plain ESM with no types.
import * as js from '@/deploy/mailbox-rules.mjs';

/**
 * The screen and the job must agree about what leaves the inbox.
 *
 * This pair decides what he stops seeing, so a disagreement between them is
 * the worst kind: the timer files something the screen would have kept, and
 * nothing says so.
 */
const CASES: MailFacts[] = [
  {
    subject: 'Join our webinar', snippet: 'Register now. Unsubscribe here.',
    fromEmail: 'marketing@vendor.com', fromName: 'V', labels: ['CATEGORY_PROMOTIONS'],
    knownContact: false, everReplied: false, ageHours: 5,
  },
  {
    subject: 'Join our webinar', snippet: 'Register now. Unsubscribe here.',
    fromEmail: 'ravit@markito.com', fromName: 'Ravit', labels: ['CATEGORY_PROMOTIONS'],
    knownContact: true, everReplied: false, ageHours: 5,
  },
  {
    subject: 'Re: our webinar slot', snippet: 'unsubscribe',
    fromEmail: 'x@y.com', fromName: null, labels: [], knownContact: false,
    everReplied: false, ageHours: 5,
  },
  {
    subject: 'Your verification code', snippet: '284913 is your one-time code.',
    fromEmail: 'no-reply@service.com', fromName: null, labels: [], knownContact: false,
    everReplied: false, ageHours: 5,
  },
  {
    subject: 'Your verification code', snippet: '284913 is your one-time code.',
    fromEmail: 'no-reply@service.com', fromName: null, labels: [], knownContact: false,
    everReplied: false, ageHours: 0.2,
  },
  {
    subject: 'Unusual sign-in from a new device', snippet: 'code 123456 was used',
    fromEmail: 'security@service.com', fromName: null, labels: [], knownContact: false,
    everReplied: false, ageHours: 40,
  },
  {
    subject: 'וובינר חינם', snippet: 'הרשמה כאן. להסרה מרשימת התפוצה',
    fromEmail: 'promo@v.co.il', fromName: null, labels: [], knownContact: false,
    everReplied: false, ageHours: 8,
  },
];

describe('the screen and the mailbox job agree', () => {
  it.each(CASES.map((c, i) => [i, c] as const))('agrees on filing case %i', (_i, mail) => {
    expect(js.looksPromotional(mail)).toEqual(looksPromotional(mail));
  });

  it.each(CASES.map((c, i) => [i, c] as const))('agrees on discarding case %i', (_i, mail) => {
    expect(js.isSpentAuthCode(mail)).toEqual(isSpentAuthCode(mail));
  });
});
