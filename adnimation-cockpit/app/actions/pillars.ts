'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/session';
import { addPillar, editPillar, movePillar, setPillarActive } from '@/lib/control/pillar-store';

/**
 * Editing the pillar list itself.
 *
 * The seven names on the chip row were a constant in the source until now, so
 * renaming one was a deploy and adding one was not possible. These four
 * actions are the whole editor: add, rename, show or hide, and move.
 *
 * Owner only. A pillar is a company-wide taxonomy — every board, every tag and
 * every target reads it — and the people he grants the tasks board to have no
 * business rewriting it.
 *
 * Nothing here deletes. Hiding a pillar takes it off the chip rows and leaves
 * every tag on the work that carries it, so switching it back on restores the
 * lot (CLAUDE.md §2: archive only, everywhere).
 */

export interface PillarResult {
  ok: boolean;
  error?: string;
  notice?: string;
}

/** Every screen that shows a chip row, so a rename lands everywhere at once. */
function refreshEverywhere(): void {
  for (const path of ['/settings/pillars', '/tasks', '/pipeline', '/contracts', '/']) {
    revalidatePath(path);
  }
}

export async function addPillarAction(formData: FormData): Promise<PillarResult> {
  const user = await requireOwner();
  const label = String(formData.get('label') ?? '');

  const done = await addPillar(label, user.email);
  if (!done.ok) return { ok: false, error: done.error };

  refreshEverywhere();
  return {
    ok: true,
    notice:
      'Added. You can tag work with it and filter by it now — it has no tile on the overview, ' +
      'because no revenue source reports against it.',
  };
}

export async function renamePillarAction(formData: FormData): Promise<PillarResult> {
  const user = await requireOwner();
  const line = String(formData.get('line') ?? '');
  const label = String(formData.get('label') ?? '');
  const unit = formData.has('unit') ? String(formData.get('unit') ?? '') : undefined;
  const sourceNote = formData.has('sourceNote') ? String(formData.get('sourceNote') ?? '') : undefined;

  const done = await editPillar(line, { label, unit, sourceNote }, user.email);
  if (!done.ok) return { ok: false, error: done.error };

  refreshEverywhere();
  return { ok: true, notice: 'Saved' };
}

export async function togglePillarAction(formData: FormData): Promise<PillarResult> {
  const user = await requireOwner();
  const line = String(formData.get('line') ?? '');
  const active = String(formData.get('active') ?? '') === 'true';

  const done = await setPillarActive(line, active, user.email);
  if (!done.ok) return { ok: false, error: done.error };

  refreshEverywhere();
  return {
    ok: true,
    notice: active
      ? 'Back on the boards'
      : 'Hidden. The work already tagged with it keeps the tag — switch it back on and they return.',
  };
}

export async function movePillarAction(formData: FormData): Promise<PillarResult> {
  const user = await requireOwner();
  const line = String(formData.get('line') ?? '');
  const direction = String(formData.get('direction') ?? '') === 'up' ? 'up' : 'down';

  const done = await movePillar(line, direction, user.email);
  if (!done.ok) return { ok: false, error: done.error };

  refreshEverywhere();
  return { ok: true };
}
