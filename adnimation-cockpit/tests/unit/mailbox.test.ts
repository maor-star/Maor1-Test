import { describe, expect, it } from 'vitest';
import {
  CLAUDE_LABEL, CODE_EXPIRY_HOURS, PROMO_LABEL, isSpentAuthCode, looksPromotional,
  mayLeaveInbox, type MailFacts,
} from '@/lib/agents/mailbox';

/**
 * Moving mail out of the inbox.
 *
 * Both of these are destructive in the way that matters — a mail he no longer
 * sees is a mail he did not read — so what these test is mostly what must NOT
 * happen. Promotional mail left in the inbox costs him a glance; a client's
 * message filed as marketing costs him the client.
 */
function mail(over: Partial<MailFacts> = {}): MailFacts {
  return {
    subject: 'Join our webinar on programmatic trends',
    snippet: 'Register now for our free webinar. Unsubscribe here.',
    fromEmail: 'marketing@vendor.com',
    fromName: 'Vendor Marketing',
    labels: ['CATEGORY_PROMOTIONS'],
    knownContact: false,
    everReplied: false,
    ageHours: 5,
    ...over,
  };
}

describe('mailbox — filing sales and marketing', () => {
  it('files an obvious piece of marketing', () => {
    expect(looksPromotional(mail()).isPromo).toBe(true);
  });

  it('reads Hebrew marketing', () => {
    expect(
      looksPromotional(
        mail({ subject: 'וובינר חינם', snippet: 'הרשמה כאן. להסרה מרשימת התפוצה לחצו כאן' }),
      ).isPromo,
    ).toBe(true);
  });

  it('never files mail from someone we deal with, however it reads', () => {
    // A client's newsletter is still a client's mail.
    expect(looksPromotional(mail({ knownContact: true })).isPromo).toBe(false);
  });

  it('never files someone he has replied to before', () => {
    expect(looksPromotional(mail({ everReplied: true })).isPromo).toBe(false);
  });

  it('never files a reply or a forward — that is a conversation', () => {
    expect(looksPromotional(mail({ subject: 'Re: our webinar slot' })).isPromo).toBe(false);
    expect(looksPromotional(mail({ subject: 'Fwd: newsletter draft' })).isPromo).toBe(false);
  });

  it('never files anything mentioning money or a contract', () => {
    for (const subject of ['Invoice for the webinar', 'Contract for the newsletter sponsorship']) {
      expect(looksPromotional(mail({ subject })).isPromo).toBe(false);
    }
  });

  it('does not act on Gmail’s own guess alone', () => {
    // CATEGORY_PROMOTIONS is wrong often enough that it cannot be the reason.
    const only = looksPromotional(
      mail({ subject: 'Quick question', snippet: 'Are you around Thursday?', fromEmail: 'dana@x.com' }),
    );
    expect(only.isPromo).toBe(false);
  });

  it('says nothing about empty mail', () => {
    expect(looksPromotional(mail({ subject: null, snippet: null })).isPromo).toBe(false);
  });
});

function code(over: Partial<MailFacts> = {}): MailFacts {
  return {
    subject: 'Your verification code',
    snippet: '284913 is your one-time code. It expires in 10 minutes.',
    fromEmail: 'no-reply@service.com',
    fromName: 'Service',
    labels: [],
    knownContact: false,
    everReplied: false,
    ageHours: 5,
    ...over,
  };
}

describe('mailbox — throwing out spent one-time codes', () => {
  it('throws out a code that has long expired', () => {
    expect(isSpentAuthCode(code()).isExpiredCode).toBe(true);
  });

  it('reads Hebrew codes', () => {
    expect(
      isSpentAuthCode(code({ subject: 'קוד אימות', snippet: 'הקוד שלך הוא 429183' })).isExpiredCode,
    ).toBe(true);
  });

  it('leaves a code that might still work', () => {
    // The entire justification for removing these is that they no longer work.
    expect(isSpentAuthCode(code({ ageHours: CODE_EXPIRY_HOURS - 0.5 })).isExpiredCode).toBe(false);
  });

  it.each([
    ['a security alert', 'Unusual sign-in from a new device'],
    ['a breach notice', 'Your account was accessed from Brazil'],
    ['a password change record', 'Your password has been changed'],
    ['a receipt', 'Your receipt and verification code for order 12'],
  ])('never throws out %s', (_label, subject) => {
    // These share almost all their vocabulary with codes, and one of them is
    // how somebody finds out their account was taken.
    expect(isSpentAuthCode(code({ subject })).isExpiredCode).toBe(false);
  });

  it('ignores ordinary mail entirely', () => {
    expect(
      isSpentAuthCode(code({ subject: 'Lunch Thursday?', snippet: 'Does 1pm work' })).isExpiredCode,
    ).toBe(false);
  });
});

/**
 * His first rule about his own mailbox, and the only one with no exception:
 * nothing leaves the inbox except into a folder under Claude/.
 *
 * He reads those folders. Mail an agent moved anywhere else is mail he has to
 * know is missing before he can go looking for it — and the job that trashed
 * spent login codes was written before the rule existed, which is exactly why
 * the rule is a function and not a habit.
 */
describe('what may take mail out of his inbox', () => {
  it('allows the Claude folders and their children', () => {
    expect(mayLeaveInbox('Claude/Meetings').ok).toBe(true);
    expect(mayLeaveInbox('Claude/Answered').ok).toBe(true);
    expect(mayLeaveInbox('Claude/Sent to Finance').ok).toBe(true);
    expect(mayLeaveInbox(CLAUDE_LABEL).ok).toBe(true);
  });

  it('every folder the agents actually file into is one of them', () => {
    expect(mayLeaveInbox(PROMO_LABEL).ok).toBe(true);
  });

  it('refuses a folder of his own, however sensible', () => {
    expect(mayLeaveInbox('Sales & Marketing').ok).toBe(false);
    expect(mayLeaveInbox('Archive').ok).toBe(false);
    expect(mayLeaveInbox('Claude-ish').ok).toBe(false);
  });

  it('refuses the trash and the absence of a folder', () => {
    expect(mayLeaveInbox('TRASH').ok).toBe(false);
    expect(mayLeaveInbox('').ok).toBe(false);
    expect(mayLeaveInbox(null).ok).toBe(false);
    expect(mayLeaveInbox(undefined).ok).toBe(false);
  });

  it('says why, in words he would use', () => {
    expect(mayLeaveInbox('Archive').why).toContain('not under Claude/');
    expect(mayLeaveInbox('').why).toContain('without a folder to go to');
  });
});
