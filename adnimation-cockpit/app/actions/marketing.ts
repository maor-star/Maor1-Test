'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/session';
import { declineDraft, draftFromWins, drawImage, editDraft, publishDraft, removeImage } from '@/lib/marketing/service';

/**
 * The marketing screen's four buttons.
 *
 * Owner only, all of them. Drafting reads his mail and his contracts;
 * publishing speaks in his name on the public internet. Neither is the Chief
 * of Staff's to do.
 */
export interface MarketingResult {
  ok: boolean;
  error?: string;
  message?: string;
  url?: string | null;
}

export async function writeDraftsAction(): Promise<MarketingResult> {
  const user = await requireOwner();
  const result = await draftFromWins({ actor: user.email });
  revalidatePath('/marketing');
  return result.ok ? { ok: true, message: result.detail } : { ok: false, error: result.detail };
}

export async function editDraftAction(formData: FormData): Promise<MarketingResult> {
  const user = await requireOwner();
  const result = await editDraft(String(formData.get('id') ?? ''), String(formData.get('body') ?? ''), user.email);
  revalidatePath('/marketing');
  return result.ok ? { ok: true, message: 'Saved.' } : { ok: false, error: result.error };
}

export async function declineDraftAction(formData: FormData): Promise<MarketingResult> {
  const user = await requireOwner();
  const result = await declineDraft(String(formData.get('id') ?? ''), user.email);
  revalidatePath('/marketing');
  return result.ok ? { ok: true, message: 'Put away. The next draft is written knowing you said no to this one.' } : { ok: false, error: result.error };
}

/**
 * The one action in the cockpit that speaks to the outside world.
 *
 * It publishes exactly the text on the screen — his edit if he made one — and
 * it happens only here, only on his click. No agent can reach it.
 */
export async function publishDraftAction(formData: FormData): Promise<MarketingResult> {
  const user = await requireOwner();
  const id = String(formData.get('id') ?? '');

  // What is on his screen is what gets published, edited or not — saved first,
  // in the same call, so there is no window where the two disagree.
  const body = String(formData.get('body') ?? '');
  if (body.trim()) {
    const saved = await editDraft(id, body, user.email);
    if (!saved.ok) return { ok: false, error: saved.error };
  }

  const result = await publishDraft(id, user.email);
  revalidatePath('/marketing');
  return result.ok
    ? { ok: true, message: 'Published on LinkedIn.', url: result.url }
    : { ok: false, error: result.error };
}

/**
 * A picture for the draft — from his prompt, or from the post when the prompt
 * box is empty. Gemini draws; nothing is published.
 */
export async function drawImageAction(formData: FormData): Promise<MarketingResult> {
  const user = await requireOwner();
  const prompt = String(formData.get('prompt') ?? '').slice(0, 2000);
  const result = await drawImage(String(formData.get('id') ?? ''), prompt || null, user.email);
  revalidatePath('/marketing');
  return result.ok ? { ok: true, message: 'Drawn.' } : { ok: false, error: result.error };
}

export async function removeImageAction(formData: FormData): Promise<MarketingResult> {
  const user = await requireOwner();
  const result = await removeImage(String(formData.get('id') ?? ''), user.email);
  revalidatePath('/marketing');
  return result.ok ? { ok: true, message: 'Removed. The post goes out as words only.' } : { ok: false, error: result.error };
}
