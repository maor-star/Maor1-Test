import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClickUpAdapter } from '@/lib/integrations/clickup';
import { syncSingleTask } from '@/lib/sync/clickup-mirror';
import { recordDelegationMovement } from '@/lib/delegation/service';
import { alreadyHandled, idempotencyKey, verifyHmacSignature } from '@/lib/webhooks/idempotency';

export const runtime = 'nodejs';

const payloadSchema = z.object({
  event: z.string(),
  task_id: z.string().optional(),
  history_items: z.array(z.unknown()).optional(),
});

/** ClickUp events that mean the delegated work actually moved. */
const MOVEMENT_EVENTS = new Set([
  'taskStatusUpdated', 'taskCommentPosted', 'taskUpdated', 'taskAssigneeUpdated',
]);

export async function POST(request: Request) {
  const raw = await request.text();

  // ClickUp signs the raw body with the secret shown when the webhook is created.
  if (!verifyHmacSignature(raw, request.headers.get('x-signature'), process.env.CLICKUP_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  if (alreadyHandled(idempotencyKey('clickup', raw))) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  const parsed = payloadSchema.safeParse(JSON.parse(raw || '{}'));
  if (!parsed.success || !parsed.data.task_id) {
    // Acknowledge anyway: a 4xx makes ClickUp retry a payload we will never like.
    return NextResponse.json({ ok: true, ignored: true });
  }

  const { event, task_id: taskId } = parsed.data;
  const adapter = createClickUpAdapter();
  const result = await syncSingleTask(adapter, taskId);

  if (MOVEMENT_EVENTS.has(event)) {
    const status = event === 'taskStatusUpdated' ? 'in_progress' : 'acknowledged';
    await recordDelegationMovement(taskId, status);
  }

  return NextResponse.json({ ok: true, result });
}
