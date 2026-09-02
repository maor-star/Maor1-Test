import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { imageOf } from '@/lib/marketing/service';

/**
 * The picture on a draft, for the marketing screen and nothing else.
 *
 * Behind the same login as every page. An image that may end up public is
 * still private until he publishes it, and a draft he declined stays private
 * for good.
 */
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 });

  const image = await imageOf(id);
  if (!image) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.mime,
      'Cache-Control': 'private, max-age=60',
      'Content-Length': String(image.bytes.length),
    },
  });
}
