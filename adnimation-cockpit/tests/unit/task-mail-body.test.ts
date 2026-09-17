import { describe, expect, it } from 'vitest';
import { bodyToStore, normalise, withoutQuotes } from '@/lib/tasks/mail-body';

/**
 * What of an email is worth storing.
 *
 * The first live copy took Gmail's plain-text part as it came: 589 messages,
 * 522 of them carrying the quoted reply chain, one in three hitting the cap.
 * A thread of eight messages was the same conversation stored eight times, and
 * the newest message — the one he opened the task to read — was the likeliest
 * to be the one cut off.
 */

describe('cutting the quoted history off', () => {
  it('stops at Gmail’s marker', () => {
    const out = withoutQuotes(
      'The payment was approved today.\n\nOn Mon, 15 Sep 2026 at 10:04, Rodger Wells <r@x.com> wrote:\n> Checking in on this\n> past due balance',
    );
    expect(out).toBe('The payment was approved today.');
  });

  it('stops at the Hebrew one, because half this mailbox replies in Hebrew', () => {
    const out = withoutQuotes(
      'אישרתי, נשלח מחר.\n\nבתאריך יום ב׳, 15 בספט׳ 2026 מאת אסף <a@x.com> כתב:\n> מה קורה עם זה',
    );
    expect(out).toBe('אישרתי, נשלח מחר.');
  });

  it('stops at Outlook’s rule and at its From: block', () => {
    expect(withoutQuotes('Approved.\n\n-----Original Message-----\nFrom: someone')).toBe('Approved.');
    expect(withoutQuotes('Approved.\n\n____________________\nFrom: someone')).toBe('Approved.');
    expect(withoutQuotes('Approved.\n\nFrom: someone\nSent: Monday')).toBe('Approved.');
  });

  it('stops at a run of quoted lines with no marker at all', () => {
    expect(withoutQuotes('Yes, go ahead.\n\n> are we doing this\n> this week?')).toBe('Yes, go ahead.');
  });

  it('keeps a single quoted line, which is somebody quoting one point', () => {
    const out = withoutQuotes('> the second option\n\nThat one. Let us do that.');
    expect(out).toContain('That one');
    expect(out).toContain('the second option');
  });

  it('keeps a first message, which quotes nothing', () => {
    const text = 'Hi Rodger,\n\nHope all is well. Checking in on the balance.';
    expect(withoutQuotes(text)).toBe(text);
  });

  it('never empties a reply that is only a word above a quote', () => {
    // "He answered with one word" is information; losing it entirely is not.
    const out = withoutQuotes('On Mon, X wrote:\n> the whole thing\n\nThanks');
    expect(out).not.toBe('');
  });

  it('drops the sign-off rule and the phone’s footer', () => {
    expect(withoutQuotes('Done.\n\n--\nSent from my iPhone')).toBe('Done.');
  });
});

describe('tidying what is left', () => {
  it('turns carriage returns into line breaks', () => {
    expect(normalise('Hi,\r\n\r\nthanks\r')).toBe('Hi,\n\nthanks');
  });

  it('removes the invisible characters that arrive with Hebrew mail', () => {
    expect(normalise('‏שלום‎')).toBe('שלום');
  });

  it('collapses a run of blank lines', () => {
    expect(withoutQuotes('One.\n\n\n\n\nTwo.')).toBe('One.\n\nTwo.');
  });
});

describe('the cap', () => {
  it('leaves an ordinary message alone', () => {
    const { body, truncated } = bodyToStore('A short note.');
    expect(body).toBe('A short note.');
    expect(truncated).toBe(false);
  });

  it('marks a very long one rather than cutting it silently', () => {
    const { body, truncated } = bodyToStore('x'.repeat(500), 100);
    expect(body).toHaveLength(100);
    expect(truncated).toBe(true);
  });

  it('measures the message, not the thread it is quoting', () => {
    // The whole point: a one-line reply under a huge quote is one line.
    const reply = `Approved.\n\nOn Mon, X wrote:\n> ${'y'.repeat(5000)}`;
    const { body, truncated } = bodyToStore(reply, 200);
    expect(body).toBe('Approved.');
    expect(truncated).toBe(false);
  });
});
