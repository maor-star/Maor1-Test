import { describe, expect, it } from 'vitest';
import { bodyText, stripHtml, trimQuoted } from '@/lib/mail/read';
import type { MimePart } from '@/lib/integrations/gmail';

const text = (mimeType: string, body: string): MimePart => ({
  mimeType,
  body: { data: Buffer.from(body, 'utf8').toString('base64url') },
});

describe('reading a message body', () => {
  it('prefers the plain text part', () => {
    const payload: MimePart = {
      mimeType: 'multipart/alternative',
      parts: [text('text/plain', 'the real words'), text('text/html', '<p>the marked-up ones</p>')],
    };
    expect(bodyText(payload)).toBe('the real words');
  });

  it('falls back to the HTML when that is all there is', () => {
    expect(bodyText(text('text/html', '<p>Hi Maor</p><p>Can we meet?</p>'))).toBe(
      'Hi Maor\nCan we meet?',
    );
  });

  it('finds the text however deep it is nested', () => {
    const payload: MimePart = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'multipart/alternative', parts: [text('text/plain', 'buried but there')] },
        { mimeType: 'application/pdf', filename: 'nda.pdf', body: { attachmentId: 'a1' } },
      ],
    };
    expect(bodyText(payload)).toBe('buried but there');
  });

  it('returns nothing rather than throwing when there is no body', () => {
    expect(bodyText(undefined)).toBe('');
    expect(bodyText({ mimeType: 'multipart/mixed', parts: [] })).toBe('');
  });
});

describe('stripping HTML', () => {
  it('drops scripts and styles entirely, not just their tags', () => {
    expect(stripHtml('<style>p{color:red}</style><p>Hello</p>')).toBe('Hello');
    expect(stripHtml('<script>alert(1)</script><p>Hello</p>')).toBe('Hello');
  });

  it('puts entities back', () => {
    expect(stripHtml('<p>Tom &amp; Jerry &lt;3 &quot;quotes&quot;</p>')).toBe(
      'Tom & Jerry <3 "quotes"',
    );
  });
});

describe('cutting the quoted history', () => {
  it('keeps only what this message actually says', () => {
    const raw = [
      'Sounds good, Tuesday works.',
      '',
      'On Mon, 1 Sep 2026 at 10:00, Maor wrote:',
      '> Can you do Tuesday?',
    ].join('\n');
    expect(trimQuoted(raw)).toBe('Sounds good, Tuesday works.');
  });

  it('cuts a Hebrew quote header too', () => {
    const raw = ['בסדר גמור, נדבר מחר.', '', 'בתאריך יום ב׳, 1 בספט׳ 2026, מאור כתב:', '> מתי נוח לך?'].join(
      '\n',
    );
    expect(trimQuoted(raw)).toBe('בסדר גמור, נדבר מחר.');
  });

  it('leaves a message with no history alone', () => {
    expect(trimQuoted('Just this.')).toBe('Just this.');
  });

  it('cuts at the first marker, not the last', () => {
    const raw = ['New.', 'On A wrote:', '> old', 'On B wrote:', '> older'].join('\n');
    expect(trimQuoted(raw)).toBe('New.');
  });
});
