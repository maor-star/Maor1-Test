import { describe, expect, it } from 'vitest';
import {
  DELEGATION_TARGETS, HANDOVER_BODY, TARGET_LABEL, handoverMessage, handoverTitle,
} from '@/lib/delegation/rules';

/**
 * The words a hand-over goes out in.
 *
 * He wrote them himself, so they are not ours to improve: "לטיפולך בבקשה
 * ועדכן. תודה, מאור". A message that reads like the cockpit talking instead of
 * him is a message the person on the other end can tell was automated, and the
 * whole point of handing something over in his name is that it is his.
 */

describe('what the message says', () => {
  it('is his words, exactly', () => {
    expect(HANDOVER_BODY).toBe('לטיפולך בבקשה ועדכן.\n\nתודה,\nמאור');
  });

  it('signs off as him and asks for the update', () => {
    const message = handoverMessage('החוזה של מאשוב');
    expect(message).toContain('לטיפולך בבקשה ועדכן');
    expect(message).toContain('מאור');
  });

  it('leads with what it is about', () => {
    expect(handoverMessage('החוזה של מאשוב').startsWith('*החוזה של מאשוב*')).toBe(true);
  });

  it('carries what he added, and nothing when he added nothing', () => {
    expect(handoverMessage('X', 'צריך לבדוק מול פיננסים')).toContain('צריך לבדוק מול פיננסים');
    // No empty lines where a note would have been.
    expect(handoverMessage('X')).not.toMatch(/\n\n\n/);
  });

  it('says the date in his language when there is one', () => {
    expect(handoverMessage('X', null, '2026-09-30')).toContain('עד:');
    expect(handoverMessage('X', null, null)).not.toContain('עד:');
  });
});

describe('what it is tracked under', () => {
  it('says it is waiting for an update, and on what', () => {
    // Most of the team has no ClickUp, so the title is the only thing that
    // says what the tracked item is about.
    expect(handoverTitle('החוזה של מאשוב')).toBe('מחכה לעדכון בנושא: החוזה של מאשוב');
  });

  it('trims what he typed', () => {
    expect(handoverTitle('  הפגישה עם רווית  ')).toBe('מחכה לעדכון בנושא: הפגישה עם רווית');
  });

  it('never runs past what the column holds', () => {
    expect(handoverTitle('x'.repeat(500)).length).toBeLessThanOrEqual(300);
  });

  it('survives nothing at all rather than throwing', () => {
    // The form requires a subject, so this is the defensive case, not a real
    // one — it only has to not blow up.
    expect(handoverTitle('')).toBe('מחכה לעדכון בנושא: ');
  });
});

describe('how it reaches them', () => {
  it('offers the three ways', () => {
    expect([...DELEGATION_TARGETS]).toEqual(['person', 'channel', 'email']);
  });

  it('names each one in his terms', () => {
    for (const t of DELEGATION_TARGETS) expect(TARGET_LABEL[t]).toBeTruthy();
    expect(TARGET_LABEL.email).toMatch(/EMAIL/i);
    expect(TARGET_LABEL.channel).toMatch(/CHANNEL/i);
  });
});
