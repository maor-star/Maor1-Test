import { describe, expect, it } from 'vitest';
import { inviteLetter } from '@/lib/tasks/invite-message';
// @ts-expect-error — the generated job copy is plain ESM with no types.
import * as js from '@/deploy/invite-message.mjs';

/**
 * The screen and the job must word an invitation identically.
 *
 * They both send one, to the same person, about the same task — so a drift
 * between them is two different mails from one system, and the one he did not
 * look at is the one that goes out wrong.
 */
const CASES = [
  {
    inviterName: 'Maor Davidovich',
    inviteeName: 'Assaf',
    link: 'https://cockpit.example/join/abc',
    expiresAt: new Date('2026-09-29T00:00:00Z'),
    level: 'edit' as const,
    note: 'אתה מכיר אותם הכי טוב',
    task: {
      title: 'ZetaGlobal — connect as demand',
      status: 'make_it_happened',
      priority: 'P1',
      dueDate: '2026-10-05',
      nextStep: 'send the seat terms',
      description: 'They want in-app inventory.',
      people: ['Maor Davidovich', 'Tomer Treves'],
    },
  },
  {
    inviterName: 'Maor Davidovich',
    link: 'https://cockpit.example/join/xyz',
    expiresAt: new Date('2026-10-01T00:00:00Z'),
    level: 'view' as const,
  },
];

describe('invite wording parity', () => {
  it('produces the same subject and body on both sides', () => {
    for (const input of CASES) {
      expect(js.inviteLetter(input)).toEqual(inviteLetter(input));
    }
  });
});
