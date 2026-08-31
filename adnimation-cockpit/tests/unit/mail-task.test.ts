import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, mailThreads, tasks } from '@/lib/db';
import { taskFromThread } from '@/lib/mail/service';

/**
 * The mail that means work is the mail that gets forgotten, so this path has
 * to work on the first click and carry enough to act on later — the sender and
 * the link back, not just a subject line out of context.
 */
const THREAD = `test-thread-${Date.now()}`;

afterEach(async () => {
  await db.delete(tasks).where(eq(tasks.sourceRef, THREAD));
  await db.delete(mailThreads).where(eq(mailThreads.threadId, THREAD));
});

async function seed(over: Partial<typeof mailThreads.$inferInsert> = {}) {
  await db.insert(mailThreads).values({
    threadId: THREAD,
    subject: 'Bidder integration for Gulf News',
    snippet: 'Can we get the tag live before the weekend?',
    counterpartName: 'Dana Levi',
    counterpartEmail: 'dana@gulfnews.com',
    messageCount: 2,
    lastMessageAt: new Date(),
    lastFromMe: false,
    labels: ['INBOX'],
    ...over,
  });
}

describe('a task out of a conversation', () => {
  it('takes the subject, and keeps the sender and a way back', async () => {
    await seed();
    const result = await taskFromThread(THREAD, 'maor@adnimation.com');
    expect(result.ok).toBe(true);

    const [task] = await db.select().from(tasks).where(eq(tasks.sourceRef, THREAD));
    expect(task?.title).toBe('Bidder integration for Gulf News');
    expect(task?.description).toContain('Dana Levi');
    expect(task?.description).toContain(THREAD);
    expect(task?.source).toBe('email');
    // It has to appear where he works, not in the mirrored company layer.
    expect(task?.layer).toBe('mine');
    expect(task?.status).toBe('open');
  });

  it('still makes something usable when the mail has no subject', async () => {
    await seed({ subject: null });
    const result = await taskFromThread(THREAD, 'maor@adnimation.com');
    expect(result.ok).toBe(true);
    const [task] = await db.select().from(tasks).where(eq(tasks.sourceRef, THREAD));
    expect(task?.title).toContain('Dana Levi');
  });

  it('says so rather than making an empty task for a thread it does not have', async () => {
    const result = await taskFromThread('no-such-thread', 'maor@adnimation.com');
    expect(result.ok).toBe(false);
  });
});
