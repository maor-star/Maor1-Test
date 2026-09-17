import { and, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db, mailThreads, people, taskAssignees, taskMail, taskMailRuns, tasks } from '@/lib/db';
import { othersOn, sweepMatches, type TaskSeed, type ThreadSeed } from './mail-match';

/**
 * The emails hanging off a task, and the sweep that finds them.
 *
 * The matching rules live in ./mail-match and have no database in them, so
 * they can be tested on made-up rows and shipped to the job as plain ESM. This
 * file is the part that reads the mirror, writes the links and remembers what
 * he threw away.
 */

export interface MailLink {
  threadId: string;
  subject: string;
  counterpart: string | null;
  lastMessageAt: Date | null;
  score: number;
  reasons: string[];
  /** Null for the matcher's own finds; his address when he attached it. */
  attachedBy: string | null;
  url: string;
}

const gmailUrl = (threadId: string) => `https://mail.google.com/mail/u/0/#all/${threadId}`;

function toLink(row: {
  threadId: string;
  subject: string | null;
  counterpart: string | null;
  lastMessageAt: Date | null;
  score: number;
  reasons: string[];
  matchedBy: string;
}): MailLink {
  return {
    threadId: row.threadId,
    subject: row.subject ?? '(no subject)',
    counterpart: row.counterpart,
    lastMessageAt: row.lastMessageAt,
    score: row.score,
    reasons: row.reasons,
    attachedBy: row.matchedBy === 'auto' ? null : row.matchedBy,
    url: gmailUrl(row.threadId),
  };
}

/** The mail on one task, best first. */
export async function mailForTask(taskId: string): Promise<MailLink[]> {
  const rows = await db
    .select()
    .from(taskMail)
    .where(and(eq(taskMail.taskId, taskId), isNull(taskMail.dismissedAt)))
    .orderBy(desc(taskMail.score), desc(taskMail.lastMessageAt));
  return rows.map(toLink);
}

/**
 * The mail on a whole board, in one query.
 *
 * Forty rows each asking for their own would be forty queries to tell
 * thirty-five of them they have nothing.
 */
export async function mailForMany(taskIds: string[]): Promise<Map<string, MailLink[]>> {
  const out = new Map<string, MailLink[]>();
  if (taskIds.length === 0) return out;

  const rows = await db
    .select()
    .from(taskMail)
    .where(and(inArray(taskMail.taskId, taskIds), isNull(taskMail.dismissedAt)))
    .orderBy(desc(taskMail.score), desc(taskMail.lastMessageAt));

  for (const row of rows) {
    const held = out.get(row.taskId) ?? [];
    held.push(toLink(row));
    out.set(row.taskId, held);
  }
  return out;
}

/**
 * Not this one.
 *
 * Kept as a row with a dismissal stamp rather than deleted, which is what
 * stops the next sweep proposing it again twenty minutes later.
 */
export async function dismissMail(taskId: string, threadId: string, actor: string): Promise<void> {
  await db
    .update(taskMail)
    .set({ dismissedAt: new Date(), dismissedBy: actor })
    .where(and(eq(taskMail.taskId, taskId), eq(taskMail.threadId, threadId)));
}

/** Put a dismissed one back. */
export async function restoreMail(taskId: string, threadId: string): Promise<void> {
  await db
    .update(taskMail)
    .set({ dismissedAt: null, dismissedBy: null })
    .where(and(eq(taskMail.taskId, taskId), eq(taskMail.threadId, threadId)));
}

/* --------------------------------------------------------------- the sweep */

/** How far back in the mirror a sweep looks. */
export const THREAD_WINDOW_DAYS = 120;
/** How many threads a task may carry. Beyond this it is a mailbox, not a task. */
export const PER_TASK = 5;

export interface SweepResult {
  tasksSeen: number;
  threadsSeen: number;
  linksAdded: number;
}

/**
 * Match every open task against every recent thread, and write what fits.
 *
 * Open tasks only: a finished task does not need this week's mail, and
 * sweeping the closed ones would mean the whole history every twenty minutes.
 *
 * Existing links are left alone apart from their score and reasons — a link he
 * has read, and one he has dismissed, both survive the next run.
 */
export async function sweepTaskMail(now = new Date()): Promise<SweepResult> {
  const since = new Date(now.getTime() - THREAD_WINDOW_DAYS * 86_400_000);

  const [taskRows, threadRows, assigneeRows] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        nextStep: tasks.nextStep,
        tags: tasks.tags,
        createdAt: tasks.createdAt,
        ownerEmail: people.email,
      })
      .from(tasks)
      .leftJoin(people, eq(people.id, tasks.ownerPersonId))
      .where(and(isNull(tasks.archivedAt), ne(tasks.status, 'done'))),
    db
      .select()
      .from(mailThreads)
      .where(gte(mailThreads.lastMessageAt, since))
      .orderBy(desc(mailThreads.lastMessageAt)),
    db
      .select({ taskId: taskAssignees.taskId, email: people.email })
      .from(taskAssignees)
      .innerJoin(people, eq(people.id, taskAssignees.personId)),
  ]);

  const peopleOn = new Map<string, string[]>();
  for (const row of assigneeRows) {
    const held = peopleOn.get(row.taskId) ?? [];
    held.push(row.email);
    peopleOn.set(row.taskId, held);
  }

  const threads: ThreadSeed[] = threadRows.map((t) => ({
    threadId: t.threadId,
    subject: t.subject,
    snippet: t.snippet,
    counterpartName: t.counterpartName,
    counterpartEmail: t.counterpartEmail,
    participants: t.participants,
    labels: t.labels,
    lastMessageAt: t.lastMessageAt.toISOString(),
  }));

  const byThread = new Map(threadRows.map((t) => [t.threadId, t]));
  let linksAdded = 0;

  const seeds: TaskSeed[] = taskRows.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    nextStep: task.nextStep,
    tags: task.tags,
    // His own address is in every thread in his own mailbox, so it is never
    // evidence about a particular task — see othersOn in ./mail-match.
    people: othersOn(
      [task.ownerEmail, ...(peopleOn.get(task.id) ?? [])].filter(
        (e): e is string => typeof e === 'string' && e.length > 0,
      ),
    ),
    createdAt: task.createdAt.toISOString(),
  }));

  /*
   * The whole board at once, so the digests can be recognised.
   *
   * A thread that matches half the board — the cockpit's own daily summary,
   * which lists his tasks — is a perfect match to each of them one at a time
   * and belongs to none of them. Only a pass that sees every task can tell.
   */
  const matched = sweepMatches(seeds, threads, PER_TASK);

  for (const task of taskRows) {
    const found = matched.get(task.id) ?? [];
    if (found.length === 0) continue;

    for (const hit of found) {
      const thread = byThread.get(hit.threadId);
      const done = await db
        .insert(taskMail)
        .values({
          taskId: task.id,
          threadId: hit.threadId,
          score: hit.score,
          reasons: hit.reasons,
          subject: thread?.subject ?? null,
          counterpart: thread?.counterpartName ?? thread?.counterpartEmail ?? null,
          lastMessageAt: thread?.lastMessageAt ?? null,
          matchedBy: 'auto',
        })
        .onConflictDoUpdate({
          target: [taskMail.taskId, taskMail.threadId],
          /*
           * The score and the words move as the thread and the task do; who
           * attached it and whether he threw it away do not. Overwriting
           * `dismissedAt` here would make every dismissal last twenty minutes.
           */
          set: {
            score: hit.score,
            reasons: hit.reasons,
            subject: thread?.subject ?? null,
            counterpart: thread?.counterpartName ?? thread?.counterpartEmail ?? null,
            lastMessageAt: thread?.lastMessageAt ?? null,
          },
        })
        .returning({ matchedAt: taskMail.matchedAt });
      if (done.length > 0) linksAdded += 1;
    }
  }

  const result = {
    tasksSeen: taskRows.length,
    threadsSeen: threads.length,
    linksAdded,
  };
  await db.insert(taskMailRuns).values(result);
  return result;
}

/** When the sweep last ran, so a screen can say how fresh this is. */
export async function lastSweep(): Promise<Date | null> {
  const [row] = await db
    .select({ ranAt: sql<Date | null>`max(ran_at)` })
    .from(taskMailRuns);
  return row?.ranAt ? new Date(row.ranAt) : null;
}
