/**
 * What an invitation says.
 *
 * In English, because the people he hands work to do not all read Hebrew and
 * an invitation is the one message that has to be understood by someone who
 * has never seen this system — everything else on the board is for him.
 *
 * The task travels inside it. An invitation on its own is an errand: sign up,
 * find the thing, work out why you were asked. With the task in the mail the
 * person already knows what it is about before they click anything, and the
 * link is how they reply rather than how they find out.
 *
 * No database here, so the wording is tested directly.
 */

export interface InviteTask {
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  nextStep: string | null;
  description: string | null;
  /** Everyone on it, so they can see who they are working with. */
  people: string[];
}

export interface InviteLetter {
  subject: string;
  body: string;
}

const PRIORITY_WORD: Record<string, string> = {
  P0: 'P0 — burning',
  P1: 'P1 — critical',
  P2: 'P2 — important',
  P3: 'P3 — tracking',
};

/** A status slug, as a person reads it. */
const readable = (status: string) => status.replace(/_/g, ' ').toUpperCase();

/** Long text is quoted, not retyped — but a whole brief does not belong in a mail. */
function trimmed(text: string, limit = 600): string {
  const clean = text.trim().replace(/\r\n/g, '\n');
  return clean.length <= limit ? clean : `${clean.slice(0, limit).trimEnd()}…`;
}

export function inviteLetter(input: {
  inviterName: string;
  inviteeName?: string | null;
  link: string;
  expiresAt: Date;
  level: 'view' | 'edit';
  note?: string | null;
  task?: InviteTask | null;
}): InviteLetter {
  const { inviterName, link, expiresAt, level, note, task } = input;

  const subject = task
    ? `${inviterName} shared a task with you: ${task.title}`
    : `${inviterName} invited you to the Adnimation task board`;

  const lines: string[] = [];
  lines.push(input.inviteeName?.trim() ? `Hi ${input.inviteeName.trim()},` : 'Hi,');
  lines.push('');
  lines.push(
    task
      ? `${inviterName} has shared a task with you on the Adnimation task board, and given you access to it.`
      : `${inviterName} has given you access to the Adnimation task board.`,
  );

  if (task) {
    lines.push('');
    lines.push('--------------------------------------------------');
    lines.push(`THE TASK: ${task.title}`);
    lines.push('--------------------------------------------------');

    const facts: string[] = [`Status: ${readable(task.status)}`];
    facts.push(`Priority: ${PRIORITY_WORD[task.priority] ?? task.priority}`);
    if (task.dueDate) facts.push(`Due: ${task.dueDate}`);
    lines.push(facts.join('   ·   '));

    if (task.people.length > 0) lines.push(`On it: ${task.people.join(', ')}`);
    if (task.nextStep?.trim()) lines.push(`Next step: ${task.nextStep.trim()}`);

    if (task.description?.trim()) {
      lines.push('');
      lines.push(trimmed(task.description));
    }
    lines.push('--------------------------------------------------');
  }

  if (note?.trim()) {
    lines.push('');
    lines.push(note.trim());
  }

  lines.push('');
  lines.push('To see it, set up your access here — you choose your own password:');
  lines.push(link);
  lines.push('');
  lines.push(
    `This link is for you alone, works once, and expires on ${expiresAt.toISOString().slice(0, 10)}.`,
  );
  lines.push(
    level === 'edit'
      ? 'You will be able to see and update the tasks on that board — and nothing else in the system.'
      : 'You will be able to see the tasks on that board — and nothing else in the system.',
  );
  lines.push('');
  lines.push(inviterName);
  lines.push('Adnimation');

  return { subject, body: lines.join('\n') };
}
