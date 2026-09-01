import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/auth';
import { db, tasks } from '@/lib/db';
import { createClickUpAdapter } from '@/lib/integrations/clickup';

/**
 * One ClickUp attachment, served by us.
 *
 * The browser never sees ClickUp's signed URL: it names a task in the cockpit
 * and a file id, this resolves the task to its ClickUp id, asks ClickUp for
 * the task, and follows the address ClickUp itself returns. A route that
 * fetched a URL from the query string would be an open proxy.
 *
 * Behind auth like every other surface — an attachment is company material.
 */

export const dynamic = 'force-dynamic';

const query = z.object({ task: z.string().uuid(), id: z.string().min(1).max(120) });

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.email) return new NextResponse('Not signed in', { status: 401 });

  const url = new URL(request.url);
  const parsed = query.safeParse({
    task: url.searchParams.get('task') ?? '',
    id: url.searchParams.get('id') ?? '',
  });
  if (!parsed.success) return new NextResponse('Bad request', { status: 400 });

  const [row] = await db
    .select({ clickupId: tasks.clickupId })
    .from(tasks)
    .where(eq(tasks.id, parsed.data.task))
    .limit(1);
  if (!row?.clickupId) return new NextResponse('No such attachment', { status: 404 });

  const file = await createClickUpAdapter()
    .readAttachment(row.clickupId, parsed.data.id)
    .catch(() => null);
  if (!file) return new NextResponse('No such attachment', { status: 404 });

  return new NextResponse(new Uint8Array(file.body), {
    headers: {
      'Content-Type': file.mimeType,
      // Inline: a screenshot he clicked should appear, not land in Downloads.
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
