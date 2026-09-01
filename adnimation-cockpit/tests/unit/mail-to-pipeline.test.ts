import { afterEach, describe, expect, it } from 'vitest';
import { eq, like } from 'drizzle-orm';
import { db, mailThreads, pipelineClients } from '@/lib/db';
import { pipelineFromThread } from '@/lib/mail/service';

/**
 * A conversation becoming a deal.
 *
 * Nothing is written by this: the pipeline refuses a deal with no next step,
 * and inventing one is how a board fills with "follow up" against a date
 * nobody chose. What it must get right is the suggestion — the name he will
 * recognise on the board, and the warning when the deal already exists.
 */
const MARK = `topipe-${Date.now()}`;
const THREAD = `${MARK}-thread`;

async function seed(over: Partial<typeof mailThreads.$inferInsert> = {}) {
  await db.insert(mailThreads).values({
    threadId: THREAD,
    subject: 'Partnership with Markito',
    snippet: 'we would like to work together',
    counterpartName: 'Ravit Cohen',
    counterpartEmail: 'ravit@markito.com',
    knownCompany: null,
    messageCount: 1,
    lastMessageAt: new Date(),
    lastFromMe: false,
    labels: ['INBOX'],
    participants: ['ravit@markito.com'],
    ...over,
  });
}

afterEach(async () => {
  await db.delete(mailThreads).where(eq(mailThreads.threadId, THREAD));
  await db.delete(pipelineClients).where(like(pipelineClients.name, `${MARK}%`));
  await db.delete(pipelineClients).where(eq(pipelineClients.domain, 'markito.com'));
});

describe('a conversation into the pipeline', () => {
  it('names it after the company the mirror knows', async () => {
    await seed({ knownCompany: 'Markito' });
    const result = await pipelineFromThread(THREAD);
    expect(result.ok && result.suggestion.name).toBe('Markito');
    expect(result.ok && result.suggestion.domain).toBe('markito.com');
  });

  it('falls back to the person, then the domain — never to nothing', async () => {
    await seed();
    expect((await pipelineFromThread(THREAD)).ok).toBe(true);
    const person = await pipelineFromThread(THREAD);
    expect(person.ok && person.suggestion.name).toBe('Ravit Cohen');

    await db
      .update(mailThreads)
      .set({ counterpartName: null })
      .where(eq(mailThreads.threadId, THREAD));
    const domain = await pipelineFromThread(THREAD);
    expect(domain.ok && domain.suggestion.name).toBe('markito.com');
  });

  it('suggests replying when the last word was theirs, following up when it was his', async () => {
    await seed();
    const waiting = await pipelineFromThread(THREAD);
    expect(waiting.ok && waiting.suggestion.nextStep).toContain('Reply');

    await db.update(mailThreads).set({ lastFromMe: true }).where(eq(mailThreads.threadId, THREAD));
    const answered = await pipelineFromThread(THREAD);
    expect(answered.ok && answered.suggestion.nextStep).toContain('Follow up');
  });

  it('carries the subject and a way back to the thread', async () => {
    await seed();
    const result = await pipelineFromThread(THREAD);
    expect(result.ok && result.suggestion.notes).toContain('Partnership with Markito');
    expect(result.ok && result.suggestion.notes).toContain(THREAD);
  });

  it('says when the domain is already on the board, rather than making a second row', async () => {
    await seed();
    await db.insert(pipelineClients).values({
      name: `${MARK} Markito`,
      domain: 'markito.com',
      clientType: 'demand',
      stage: 'contact',
      nextStep: 'call',
      nextStepDate: '2026-12-01',
    });

    const result = await pipelineFromThread(THREAD);
    expect(result.ok && result.existingClientId).toBeTruthy();
  });

  it('refuses a thread the mirror does not have', async () => {
    expect((await pipelineFromThread('no-such-thread')).ok).toBe(false);
  });
});
