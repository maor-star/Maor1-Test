import { describe, expect, it } from 'vitest';
import { FakeClickUpAdapter } from '@/lib/integrations/clickup';
import {
  FakeGmailAdapter, dedupeKey, walkParts, worthShowing, type MimePart,
} from '@/lib/integrations/gmail';

/**
 * Attachments, at the seam that actually breaks.
 *
 * The interesting parts are not the fetches — those are one call each — but
 * the two decisions made around them: which MIME parts in a mail count as a
 * file worth showing him, and what a file is called and typed when the source
 * system says nothing useful.
 */

describe('the adapters agree on a shape', () => {
  it('a mailbox with nothing configured has no files rather than an error', async () => {
    const gmail = new FakeGmailAdapter();
    expect(await gmail.listThreadAttachments('t1')).toEqual([]);
    expect(await gmail.readAttachment('m1', 'a1')).toBeNull();
  });

  it('a ClickUp workspace with nothing configured behaves the same', async () => {
    const clickup = new FakeClickUpAdapter();
    expect(await clickup.listAttachments('t1')).toEqual([]);
    expect(await clickup.readAttachment('t1', 'a1')).toBeNull();
  });

  it('carries what the screen needs through the fake', async () => {
    const gmail = new FakeGmailAdapter();
    gmail.attachments = [
      { id: 'a1', name: 'rate-card.pdf', mimeType: 'application/pdf', sizeBytes: 90_000, messageId: 'm1' },
    ];
    const [file] = await gmail.listThreadAttachments('t1');
    expect(file?.name).toBe('rate-card.pdf');
    // Gmail scopes an attachment id to its message, so the id alone is not
    // enough to fetch one — the message has to travel with it.
    expect(file?.messageId).toBe('m1');
  });
});


describe('which MIME parts are files', () => {
  const attachment = (over: Partial<MimePart> = {}): MimePart => ({
    filename: 'deck.pdf',
    mimeType: 'application/pdf',
    body: { attachmentId: 'a1', size: 400_000 },
    ...over,
  });

  it('finds one attached at the top level', () => {
    const found = walkParts({ parts: [attachment()] });
    expect(found.map((p) => p.filename)).toEqual(['deck.pdf']);
  });

  it('finds one nested inside a forwarded mail', () => {
    const found = walkParts({
      parts: [
        { mimeType: 'text/plain' },
        { mimeType: 'message/rfc822', parts: [{ parts: [attachment({ filename: 'inner.png' })] }] },
      ],
    });
    expect(found.map((p) => p.filename)).toEqual(['inner.png']);
  });

  it('ignores a body part, which has no attachment id', () => {
    expect(walkParts({ parts: [{ filename: '', mimeType: 'text/html', body: { size: 900 } }] }))
      .toEqual([]);
  });

  it('shows a real image and skips a signature logo', () => {
    expect(worthShowing(attachment({ mimeType: 'image/png', body: { attachmentId: 'a', size: 300_000 } }))).toBe(true);
    expect(worthShowing(attachment({ mimeType: 'image/gif', body: { attachmentId: 'a', size: 700 } }))).toBe(false);
  });

  it('never hides a document for being small — a one-page PDF is still the point', () => {
    expect(worthShowing(attachment({ body: { attachmentId: 'a', size: 900 } }))).toBe(true);
  });
});


describe('the same file, quoted down a thread', () => {
  const part = (filename: string, size: number, mimeType = 'application/pdf'): MimePart => ({
    filename, mimeType, body: { attachmentId: 'a', size },
  });

  it('matches a file whose name a mail client rewrote in the forward', () => {
    // Real case: "All In Consulting + Admination SSP Agreement.pdf" came back
    // from the reply with the plus turned into spaces, and the list showed the
    // same agreement four times.
    expect(dedupeKey(part('A + B.pdf', 683_149))).toBe(dedupeKey(part('A   B.pdf', 683_149)));
  });

  it('keeps two genuinely different files apart', () => {
    expect(dedupeKey(part('one.pdf', 683_149))).not.toBe(dedupeKey(part('two.pdf', 619_513)));
  });

  it('falls back to the name when Gmail reports no size', () => {
    expect(dedupeKey(part('one.pdf', 0))).toBe('name:one.pdf');
    expect(dedupeKey(part('one.pdf', 0))).not.toBe(dedupeKey(part('two.pdf', 0)));
  });

  it('does not confuse a PDF with an image of the same size', () => {
    expect(dedupeKey(part('a.pdf', 1000))).not.toBe(dedupeKey(part('a.png', 1000, 'image/png')));
  });
});
