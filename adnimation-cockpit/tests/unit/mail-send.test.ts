import { describe, expect, it } from 'vitest';
import { buildReply } from '@/lib/mail/send';

/**
 * The reply's envelope.
 *
 * Two things here are worth being sure about, because both fail invisibly:
 * a reply that starts a new conversation instead of continuing the existing
 * one, and a Hebrew subject that arrives as mojibake in the recipient's
 * client. Neither shows up as an error on our side — the send succeeds either
 * way and only the recipient sees the damage.
 */
describe('replying to a thread', () => {
  const base = {
    to: 'ravit@markito.com',
    subject: 'Partnership opportunity',
    body: 'Sounds good — let us set up a call.',
  };

  it('keeps the reply inside the conversation', () => {
    const raw = buildReply({
      ...base,
      inReplyTo: '<abc@mail.gmail.com>',
      references: '<first@x> <abc@mail.gmail.com>',
    });
    expect(raw).toContain('In-Reply-To: <abc@mail.gmail.com>');
    expect(raw).toContain('References: <first@x> <abc@mail.gmail.com>');
  });

  it('prefixes Re: once, not twice', () => {
    expect(buildReply(base)).toContain('Subject: Re: Partnership opportunity');
    const already = buildReply({ ...base, subject: 'Re: Partnership opportunity' });
    expect(already).toContain('Subject: Re: Partnership opportunity');
    expect(already).not.toContain('Re: Re:');
  });

  it('encodes a Hebrew subject so it does not arrive as mojibake', () => {
    const raw = buildReply({ ...base, subject: 'הצעה עסקית' });
    const line = raw.split('\r\n').find((l) => l.startsWith('Subject:'));
    expect(line).toMatch(/^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    // And it round-trips back to the words he sent.
    const encoded = /=\?UTF-8\?B\?([^?]+)\?=/.exec(line ?? '')?.[1] ?? '';
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe('Re: הצעה עסקית');
  });

  it('leaves a plain ASCII subject alone', () => {
    expect(buildReply(base)).not.toContain('=?UTF-8?B?');
  });

  it('sends the body as UTF-8 base64, so Hebrew text survives', () => {
    const raw = buildReply({ ...base, body: 'תודה רבה, נדבר מחר.' });
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(raw).toContain('Content-Transfer-Encoding: base64');
    const body = raw.split('\r\n\r\n')[1] ?? '';
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('תודה רבה, נדבר מחר.');
  });

  it('omits the threading headers when there are none to give', () => {
    const raw = buildReply(base);
    expect(raw).not.toContain('In-Reply-To:');
    expect(raw).not.toContain('References:');
  });
});
