import { eq } from 'drizzle-orm';
import { db, opportunities, tasks } from '@/lib/db';
import { createClickUpAdapter } from '@/lib/integrations/clickup';
import { createGmailAdapter } from '@/lib/integrations/gmail';
import type { AttachmentRef } from '@/lib/integrations/types';

/**
 * The files hanging off a task or an opportunity.
 *
 * They are read when he asks for them rather than mirrored. Two reasons: a
 * mirror would carry every screenshot the team ever pasted into ClickUp, and a
 * signed URL copied at sync time is stale by the time he clicks it. Reading on
 * demand costs one API call at the moment he opens the row, which is the only
 * moment it matters.
 *
 * Nothing here trusts a URL from the browser. The caller names a task or a
 * conversation and the source system hands back the address — "fetch the URL
 * in this parameter" is how such an endpoint becomes an SSRF.
 */

export interface AttachmentItem extends AttachmentRef {
  /** What the page links to; served by this app, never by ClickUp or Google. */
  href: string;
  thumbnailHref: string | null;
  isImage: boolean;
  isPdf: boolean;
}

const decorate = (ref: AttachmentRef, href: string): AttachmentItem => ({
  ...ref,
  href,
  // The file itself is the thumbnail. ClickUp and Gmail both offer their own,
  // behind signatures that expire; this one is served by us and does not.
  thumbnailHref: ref.mimeType.startsWith('image/') ? href : null,
  isImage: ref.mimeType.startsWith('image/'),
  isPdf: ref.mimeType === 'application/pdf',
});

/**
 * A task's files.
 *
 * Only a mirrored task has any: a task he typed here has no ClickUp row to
 * hang a file on, and "none" is the honest answer for it rather than an error.
 */
export async function taskAttachments(taskId: string): Promise<AttachmentItem[]> {
  const [row] = await db
    .select({ clickupId: tasks.clickupId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!row?.clickupId) return [];

  const found = await createClickUpAdapter().listAttachments(row.clickupId);
  return found.map((a) =>
    decorate(
      a,
      `/api/attachments/clickup?task=${encodeURIComponent(taskId)}&id=${encodeURIComponent(a.id)}`,
    ),
  );
}

/** Every file in a mail conversation, by its Gmail thread id. */
export async function threadAttachments(threadId: string): Promise<AttachmentItem[]> {
  const found = await createGmailAdapter().listThreadAttachments(threadId);
  return found.map((a) =>
    decorate(
      a,
      `/api/attachments/mail?message=${encodeURIComponent(a.messageId ?? '')}`
        + `&id=${encodeURIComponent(a.id)}`,
    ),
  );
}

/**
 * An opportunity's files: the ones on the conversation it came from.
 *
 * An opportunity captured from a mail is usually captured *because* of what
 * was attached — the deck, the rate card, the draft agreement — and until now
 * the row carried a link out to Gmail and nothing he could open in place.
 */
export async function opportunityAttachments(id: string): Promise<AttachmentItem[]> {
  const [row] = await db
    .select({ source: opportunities.source, sourceRef: opportunities.sourceRef })
    .from(opportunities)
    .where(eq(opportunities.id, id))
    .limit(1);

  if (!row || row.source !== 'mail' || !row.sourceRef) return [];
  return threadAttachments(row.sourceRef);
}
