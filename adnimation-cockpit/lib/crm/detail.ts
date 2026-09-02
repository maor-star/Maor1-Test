import { and, arrayOverlaps, desc, eq, isNull, or, sql } from 'drizzle-orm';
import {
  contracts, crmCompanies, crmContacts, db, mailThreads, pipelineClients,
} from '@/lib/db';
import type { Conversation } from './conversations';

/**
 * One company, or one person, whole.
 *
 * The list answers "who is there"; these answer the question he actually opens
 * a name to ask — what do I know about them, and what have we said. That is
 * three joins the list deliberately does not do for four hundred rows at once,
 * and can happily do for one.
 */

export interface ContactDetail {
  contact: typeof crmContacts.$inferSelect;
  company: typeof crmCompanies.$inferSelect | null;
  /** Everyone else at the same company. */
  colleagues: { hubspotId: string; name: string; jobTitle: string | null; email: string | null }[];
  conversations: Conversation[];
  conversationCount: number;
}

const nameOf = (c: { firstName: string | null; lastName: string | null; email: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.email || 'Unnamed';

/** Every conversation these addresses were on, newest first. */
export async function conversationsWith(emails: string[], limit = 100): Promise<{ rows: Conversation[]; total: number }> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (wanted.length === 0) return { rows: [], total: 0 };

  const rows = await db
    .select({
      threadId: mailThreads.threadId,
      subject: mailThreads.subject,
      snippet: mailThreads.snippet,
      lastMessageAt: mailThreads.lastMessageAt,
      messageCount: mailThreads.messageCount,
      lastFromMe: mailThreads.lastFromMe,
    })
    .from(mailThreads)
    .where(arrayOverlaps(mailThreads.participants, wanted))
    .orderBy(desc(mailThreads.lastMessageAt))
    .limit(limit);

  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mailThreads)
    .where(arrayOverlaps(mailThreads.participants, wanted));

  return {
    rows: rows.map((r) => ({ ...r, url: `https://mail.google.com/mail/u/0/#all/${r.threadId}` })),
    total: count?.n ?? 0,
  };
}

export async function getContact(id: string): Promise<ContactDetail | null> {
  const [contact] = await db.select().from(crmContacts).where(eq(crmContacts.hubspotId, id)).limit(1);
  if (!contact) return null;

  const [company] = contact.companyId
    ? await db.select().from(crmCompanies).where(eq(crmCompanies.hubspotId, contact.companyId)).limit(1)
    : [];

  const colleagues = contact.companyId
    ? (
        await db
          .select()
          .from(crmContacts)
          .where(and(eq(crmContacts.companyId, contact.companyId), isNull(crmContacts.archivedAt)))
          .orderBy(crmContacts.firstName)
          .limit(50)
      )
        .filter((c) => c.hubspotId !== contact.hubspotId)
        .map((c) => ({ hubspotId: c.hubspotId, name: nameOf(c), jobTitle: c.jobTitle, email: c.email }))
    : [];

  const talk = await conversationsWith(contact.email ? [contact.email] : []);

  return {
    contact,
    company: company ?? null,
    colleagues,
    conversations: talk.rows,
    conversationCount: talk.total,
  };
}

export interface CompanyDetail {
  company: typeof crmCompanies.$inferSelect;
  contacts: (typeof crmContacts.$inferSelect)[];
  /** Everything anyone at the company has been on, not just one person's mail. */
  conversations: Conversation[];
  conversationCount: number;
  deals: { id: string; name: string; stage: string; nextStep: string | null; valueCents: number | null }[];
  contracts: { id: string; counterparty: string; status: string; docType: string | null }[];
}

export async function getCompany(id: string): Promise<CompanyDetail | null> {
  const [company] = await db.select().from(crmCompanies).where(eq(crmCompanies.hubspotId, id)).limit(1);
  if (!company) return null;

  const people = await db
    .select()
    .from(crmContacts)
    .where(and(eq(crmContacts.companyId, id), isNull(crmContacts.archivedAt)))
    .orderBy(desc(crmContacts.lastActivityAt))
    .limit(200);

  const talk = await conversationsWith(people.map((p) => p.email ?? '').filter(Boolean));

  /*
   * The deal and the contract are matched on the domain, not on a foreign key.
   * Nothing links a CRM company to the board today, and asking him to link
   * them by hand is asking him to do the join himself — the domain is the fact
   * both sides already carry.
   */
  const domain = company.domain?.trim().toLowerCase() ?? null;
  const deals = domain
    ? await db
        .select({
          id: pipelineClients.id,
          name: pipelineClients.name,
          stage: pipelineClients.stage,
          nextStep: pipelineClients.nextStep,
          valueCents: pipelineClients.valueCents,
        })
        .from(pipelineClients)
        .where(and(isNull(pipelineClients.archivedAt), eq(pipelineClients.domain, domain)))
        .limit(10)
    : [];

  const linked = await db
    .select({
      id: contracts.id,
      counterparty: contracts.counterpartyName,
      status: contracts.status,
      docType: contracts.docType,
    })
    .from(contracts)
    .where(
      and(
        isNull(contracts.archivedAt),
        or(
          sql`lower(${contracts.counterpartyName}) = ${company.name.toLowerCase()}`,
          deals.length > 0 ? sql`${contracts.pipelineClientId} = ${deals[0]!.id}` : sql`false`,
        ),
      ),
    )
    .limit(10);

  return {
    company,
    contacts: people,
    conversations: talk.rows,
    conversationCount: talk.total,
    deals,
    contracts: linked,
  };
}

export { nameOf };
