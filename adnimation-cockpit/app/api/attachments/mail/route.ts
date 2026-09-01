import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { createGmailAdapter } from '@/lib/integrations/gmail';

/**
 * One mail attachment, served by us.
 *
 * Gmail scopes an attachment id to its message, so both are named. Neither is
 * a URL: the only address this route ever fetches is Gmail's own API, with the
 * cockpit's service-account token, which is why a stolen link is worth nothing
 * without a session.
 */

export const dynamic = 'force-dynamic';

const query = z.object({
  message: z.string().min(1).max(120),
  id: z.string().min(1).max(400),
});

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.email) return new NextResponse('Not signed in', { status: 401 });

  const url = new URL(request.url);
  const parsed = query.safeParse({
    message: url.searchParams.get('message') ?? '',
    id: url.searchParams.get('id') ?? '',
  });
  if (!parsed.success) return new NextResponse('Bad request', { status: 400 });

  const file = await createGmailAdapter()
    .readAttachment(parsed.data.message, parsed.data.id)
    .catch(() => null);
  if (!file) return new NextResponse('No such attachment', { status: 404 });

  return new NextResponse(new Uint8Array(file.body), {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
