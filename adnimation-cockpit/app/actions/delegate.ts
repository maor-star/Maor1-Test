'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { delegate, delegateInputSchema } from '@/lib/delegation/service';
import { createClickUpAdapter } from '@/lib/integrations/clickup';
import { createSlackAdapter } from '@/lib/integrations/slack';
import type { ActionResult } from './tasks';

/**
 * Spec 6.1.3 — one button, two side effects: a Slack message and a ClickUp task.
 * The result reports each side independently so a half-delivered delegation is
 * visible rather than silently "sent".
 */
export async function delegateAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = delegateInputSchema.safeParse({
    sourceEntityType: formData.get('sourceEntityType') ?? 'task',
    sourceEntityId: formData.get('sourceEntityId'),
    delegatedTo: formData.get('delegatedTo'),
    title: formData.get('title'),
    note: formData.get('note'),
    dueDate: formData.get('dueDate') || null,
    priority: formData.get('priority') ?? 'P2',
    clickupListId: formData.get('clickupListId') || process.env.CLICKUP_DEFAULT_LIST_ID || '',
  });

  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const fieldErrors = flat.fieldErrors as Record<string, string[]>;
    // Surface the first field message rather than a generic one: the most
    // common cause is an unset CLICKUP_DEFAULT_LIST_ID, and "missing details"
    // sends the reader looking at the form instead of the configuration.
    const firstFieldError = Object.values(fieldErrors).flat()[0];
    return {
      ok: false,
      error: flat.formErrors[0] ?? firstFieldError ?? 'לא ניתן להאציל — חסרים פרטים',
      fieldErrors,
    };
  }

  const result = await delegate(parsed.data, {
    slack: createSlackAdapter(),
    clickup: createClickUpAdapter(),
    actor: user.email,
  });

  revalidatePath('/tasks');
  revalidatePath('/delegations');
  revalidatePath('/');

  if (!result.slack.ok || !result.clickup.ok) {
    const failed = [
      result.slack.ok ? null : `Slack (${result.slack.error})`,
      result.clickup.ok ? null : `ClickUp (${result.clickup.error})`,
    ].filter(Boolean);
    return {
      ok: true,
      id: result.delegationId,
      error: `ההאצלה נרשמה, אבל נכשלה השליחה ל: ${failed.join(', ')}`,
    };
  }

  return { ok: true, id: result.delegationId };
}
