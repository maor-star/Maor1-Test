'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { agents, db } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';
import { todayInTz } from '@/lib/utils';
import { converse, createThread, setThreadProvider } from '@/lib/copilot/service';
import { decide, runAutopilot } from '@/lib/copilot/autopilot';
import { effectiveSettings } from '@/lib/agents/settings';

/**
 * The Copilot screen's controls: talk, review, approve, decline.
 *
 * Every write the model makes goes through the same mutations as a click,
 * under his identity, so the audit log reads "maor@ via copilot" and the undo
 * bar works on it.
 */

export interface CopilotActionResult {
  ok: boolean;
  error?: string;
  threadId?: string;
  reply?: string;
  provider?: string;
  toolCalls?: { name: string; args: Record<string, unknown>; output: string }[];
  message?: string;
}

const uuid = z.string().uuid();

export async function newThreadAction(provider = 'auto'): Promise<CopilotActionResult> {
  const user = await requireUser();
  const threadId = await createThread(user.email, ['auto', 'anthropic', 'gemini'].includes(provider) ? provider : 'auto');
  revalidatePath('/copilot');
  return { ok: true, threadId };
}

export async function sendMessageAction(formData: FormData): Promise<CopilotActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({ threadId: uuid.optional(), text: z.string().trim().min(1).max(8000), provider: z.string().optional() })
    .safeParse({
      threadId: String(formData.get('threadId') ?? '') || undefined,
      text: String(formData.get('text') ?? ''),
      provider: String(formData.get('provider') ?? '') || undefined,
    });
  if (!parsed.success) return { ok: false, error: 'Say something first.' };

  const threadId = parsed.data.threadId ?? (await createThread(user.email, parsed.data.provider ?? 'auto'));
  if (parsed.data.provider) await setThreadProvider(threadId, parsed.data.provider);

  const result = await converse(threadId, parsed.data.text, { actor: user.email, today: todayInTz() }, parsed.data.provider);
  revalidatePath('/copilot');
  for (const path of ['/', '/tasks', '/pipeline', '/agents']) revalidatePath(path);
  if (!result.ok) return { ok: false, error: result.error, threadId };
  return { ok: true, threadId, reply: result.reply, provider: result.provider, toolCalls: result.toolCalls };
}

/** Run the daily review now, under the autopilot agent's level and dials. */
export async function runReviewAction(): Promise<CopilotActionResult> {
  const user = await requireUser();
  const [agent] = await db.select().from(agents).where(eq(agents.name, 'autopilot')).limit(1);
  const settings = effectiveSettings('autopilot', agent?.settings ?? {});
  const result = await runAutopilot({
    actor: `${user.email} via autopilot`,
    settings,
    autonomyLevel: agent?.autonomyLevel ?? 1,
  });
  revalidatePath('/copilot');
  revalidatePath('/');
  return result.ok ? { ok: true, message: result.summary } : { ok: false, error: result.summary };
}

export async function decideAction(formData: FormData): Promise<CopilotActionResult> {
  const user = await requireUser();
  const id = uuid.safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { ok: false, error: 'Not a decision' };
  const approve = String(formData.get('approve') ?? '') === '1';
  const result = await decide(id.data, approve, user.email);
  revalidatePath('/copilot');
  for (const path of ['/', '/tasks', '/pipeline', '/agents']) revalidatePath(path);
  return result.ok ? { ok: true, message: result.detail } : { ok: false, error: result.error };
}
