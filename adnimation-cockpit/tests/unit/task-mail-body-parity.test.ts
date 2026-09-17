import { describe, expect, it } from 'vitest';
import { bodyToStore, normalise, withoutQuotes } from '@/lib/tasks/mail-body';
// @ts-expect-error — the generated job copy is plain ESM with no types.
import * as js from '@/deploy/task-mail-body.mjs';

/**
 * The job copies the mail in and the screen shows what it stored, so the two
 * halves have to agree about what an email is. A drift here would be invisible
 * until he opened a message and found half a conversation in it.
 */
const CASES = [
  'Plain first message with nothing quoted.',
  'The payment was approved today.\n\nOn Mon, 15 Sep 2026 at 10:04, R <r@x.com> wrote:\n> checking in',
  'אישרתי.\n\nבתאריך יום ב׳ מאת אסף <a@x.com> כתב:\n> מה קורה',
  'Approved.\r\n\r\n-----Original Message-----\r\nFrom: someone',
  'Yes.\n\n> are we doing this\n> this week?',
  '> one point\n\nThat one.',
  'Done.\n\n--\nSent from my iPhone',
  '‏שלום‎\r\n\r\n\r\n\r\nתודה',
  '',
  '   ',
];

describe('mail body parity', () => {
  it('cuts the quoting at the same place', () => {
    for (const text of CASES) {
      expect(js.withoutQuotes(text), JSON.stringify(text.slice(0, 30))).toBe(withoutQuotes(text));
    }
  });

  it('tidies identically', () => {
    for (const text of CASES) expect(js.normalise(text)).toBe(normalise(text));
  });

  it('stores and marks identically, at any cap', () => {
    for (const text of CASES) {
      for (const limit of [10, 200, 12_000]) {
        expect(js.bodyToStore(text, limit), text.slice(0, 20)).toEqual(bodyToStore(text, limit));
      }
    }
  });
});
