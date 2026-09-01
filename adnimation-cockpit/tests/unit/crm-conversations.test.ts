import { afterEach, describe, expect, it } from 'vitest';
import { like } from 'drizzle-orm';
import { db, mailThreads } from '@/lib/db';
import { conversationsFor } from '@/lib/crm/conversations';

/**
 * What he said to each person, on the CRM screen.
 *
 * The thing that would make this useless is a per-row query — four hundred
 * contacts on a page means four hundred round trips — so the shape under test
 * is "many contacts, one query", and the ordering that decides which three
 * conversations he actually sees.
 */
const MARK = `conv-${Date.now()}`;
const DANA = `dana-${MARK}@taboola.com`;

async function thread(subject: string, at: string, over: Partial<typeof mailThreads.$inferInsert> = {}) {
  await db.insert(mailThreads).values({
    threadId: `${MARK}-${subject}`,
    subject,
    snippet: 'about the integration',
    counterpartEmail: DANA,
    counterpartName: 'Dana',
    participants: [DANA],
    messageCount: 2,
    lastMessageAt: new Date(at),
    lastFromMe: false,
    labels: ['INBOX'],
    ...over,
  });
}

afterEach(async () => {
  await db.delete(mailThreads).where(like(mailThreads.threadId, `${MARK}%`));
});

describe('the conversations behind a contact', () => {
  it('gives the newest first, and counts them all', async () => {
    await thread('oldest', '2026-01-01T09:00:00Z');
    await thread('middle', '2026-04-01T09:00:00Z');
    await thread('newest', '2026-08-01T09:00:00Z');
    await thread('older still', '2025-12-01T09:00:00Z');

    const found = await conversationsFor([DANA], 3);
    const said = found.get(DANA);

    expect(said?.total).toBe(4);
    expect(said?.recent.map((t) => t.subject)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('matches the address however it is capitalised', async () => {
    await thread('one', '2026-08-01T09:00:00Z');
    const found = await conversationsFor([DANA.toUpperCase()]);
    expect(found.get(DANA)?.total).toBe(1);
  });

  it('says nothing about somebody he has never emailed', async () => {
    const found = await conversationsFor(['nobody@nowhere.com']);
    expect(found.size).toBe(0);
  });

  it('asks nothing of the database when there is nobody to ask about', async () => {
    expect((await conversationsFor([])).size).toBe(0);
    expect((await conversationsFor(['', '  '])).size).toBe(0);
  });

  it('carries whether the last word was his, which is the whole point', async () => {
    await thread('answered', '2026-08-01T09:00:00Z', { lastFromMe: true });
    expect((await conversationsFor([DANA]))?.get(DANA)?.recent[0]?.lastFromMe).toBe(true);
  });

  it('counts a thread for everyone on it, not only its counterpart', async () => {
    // Four people at one company wrote to him and three showed nothing: the
    // counterpart of a thread is one address, and the person he wants to read
    // about is often the one who was copied in.
    const colleague = `neel-${MARK}@taboola.com`;
    await thread('all three of us', '2026-08-01T09:00:00Z', {
      participants: [DANA, colleague],
    });

    const found = await conversationsFor([DANA, colleague]);
    expect(found.get(DANA)?.total).toBe(1);
    expect(found.get(colleague)?.total).toBe(1);
    expect(found.get(colleague)?.recent[0]?.subject).toBe('all three of us');
  });
});
