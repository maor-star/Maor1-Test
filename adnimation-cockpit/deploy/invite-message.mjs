/**
 * GENERATED FROM lib/tasks/invite-message.ts — do not edit by hand.
 *
 * The jobs run as plain ESM outside the compiled app, so they need a
 * JavaScript copy of these rules. tests/unit/invite-message-parity.test.ts
 * feeds both this file and the TypeScript original the same inputs and fails
 * if they ever disagree, so an edit to one without the other cannot ship.
 *
 * Regenerate with: node deploy/build-detect.mjs
 */
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

const PRIORITY_WORD = {
  P0: 'P0 — burning',
  P1: 'P1 — critical',
  P2: 'P2 — important',
  P3: 'P3 — tracking',
};

/** A status slug, as a person reads it. */
const readable = (status) => status.replace(/_/g, ' ').toUpperCase();

/** Long text is quoted, not retyped — but a whole brief does not belong in a mail. */
function trimmed(text, limit = 600) {
  const clean = text.trim().replace(/\r\n/g, '\n');
  return clean.length <= limit ? clean : `${clean.slice(0, limit).trimEnd()}…`;
}

export function inviteLetter(input) {
  const { inviterName, link, expiresAt, level, note, task } = input;

  const subject = task
    ? `${inviterName} shared a task with you: ${task.title}`
    : `${inviterName} invited you to the Adnimation task board`;

  const lines = [];
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

    const facts = [`Status: ${readable(task.status)}`];
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
