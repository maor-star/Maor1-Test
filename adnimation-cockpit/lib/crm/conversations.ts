import { desc, inArray, sql } from 'drizzle-orm';
import { db, mailThreads } from '@/lib/db';

/**
 * What he has actually discussed with a person.
 *
 * A CRM row is a name and a phone number; what he needs before picking up that
 * phone is the last thing they said to each other. The mail mirror already
 * holds it, keyed by the same address the contact is keyed on, so this is a
 * join rather than anything new to maintain.
 *
 * Threads are read for many contacts at once. One query per row would be four
 * hundred queries on the contacts screen, which is how a page that reads
 * beautifully in review becomes one nobody opens.
 */
export interface Conversation {
  threadId: string;
  subject: string | null;
  snippet: string | null;
  lastMessageAt: Date;
  messageCount: number;
  /** True when the last word was his — so "waiting on them" is visible. */
  lastFromMe: boolean;
  url: string;
}

export async function conversationsFor(
  emails: string[],
  perContact = 3,
): Promise<Map<string, { recent: Conversation[]; total: number }>> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const out = new Map<string, { recent: Conversation[]; total: number }>();
  if (wanted.length === 0) return out;

  const rows = await db
    .select({
      threadId: mailThreads.threadId,
      subject: mailThreads.subject,
      snippet: mailThreads.snippet,
      lastMessageAt: mailThreads.lastMessageAt,
      messageCount: mailThreads.messageCount,
      lastFromMe: mailThreads.lastFromMe,
      email: sql<string>`lower(${mailThreads.counterpartEmail})`,
    })
    .from(mailThreads)
    .where(inArray(sql`lower(${mailThreads.counterpartEmail})`, wanted))
    .orderBy(desc(mailThreads.lastMessageAt));

  for (const row of rows) {
    const held = out.get(row.email) ?? { recent: [], total: 0 };
    held.total += 1;
    if (held.recent.length < perContact) {
      held.recent.push({
        threadId: row.threadId,
        subject: row.subject,
        snippet: row.snippet,
        lastMessageAt: row.lastMessageAt,
        messageCount: row.messageCount,
        lastFromMe: row.lastFromMe,
        url: `https://mail.google.com/mail/u/0/#all/${row.threadId}`,
      });
    }
    out.set(row.email, held);
  }

  return out;
}
