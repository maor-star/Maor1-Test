'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import {
  runById, seedAgents, setAgentEnabled, setAutonomy, setGlobalKill,
} from '@/lib/agents/module';

/**
 * The agents screen's controls.
 *
 * Every one of them is a safety control as much as a feature: switching an
 * agent off, turning its autonomy down, stopping everything at once. The
 * validation lives in the module, not here, so it holds however it is called.
 */

export interface AgentActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const idSchema = z.string().uuid();

export async function seedAgentsAction(): Promise<AgentActionResult> {
  const user = await requireUser();
  const { added } = await seedAgents(user.email);
  revalidatePath('/agents');
  return {
    ok: true,
    message:
      added.length === 0
        ? 'Nothing to add — every built-in agent is already here.'
        : `Added ${added.join(', ')}. All at level 1, and all but the contract reader switched off.`,
  };
}

export async function toggleAgentAction(formData: FormData): Promise<AgentActionResult> {
  const user = await requireUser();
  const id = idSchema.safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { ok: false, error: 'Not an agent' };

  const enabled = String(formData.get('enabled') ?? '') === '1';
  const result = await setAgentEnabled(id.data, enabled, user.email);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/agents');
  return { ok: true };
}

export async function setAutonomyAction(formData: FormData): Promise<AgentActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({ id: idSchema, level: z.coerce.number().int().min(1).max(4) })
    .safeParse({
      id: String(formData.get('id') ?? ''),
      level: String(formData.get('level') ?? ''),
    });
  if (!parsed.success) return { ok: false, error: 'Not a level' };

  const result = await setAutonomy(parsed.data.id, parsed.data.level, user.email);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/agents');
  return { ok: true };
}

/**
 * Run one now.
 *
 * Dry by default: the point of a dry run is that he can see exactly what an
 * agent would do before letting it, so that is the button that should be easy
 * to press by accident.
 */
export async function runAgentAction(formData: FormData): Promise<AgentActionResult> {
  const user = await requireUser();
  const id = idSchema.safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { ok: false, error: 'Not an agent' };

  const dryRun = String(formData.get('dryRun') ?? '1') === '1';
  const report = await runById(id.data, { dryRun, triggeredBy: user.email });

  revalidatePath('/agents');
  return {
    ok: report.outcome !== 'failed',
    ...(report.outcome === 'failed' ? { error: report.error ?? 'It failed' } : {}),
    message:
      report.outcome === 'halted'
        ? `Halted: ${report.haltReason}`
        : report.outcome === 'dry_run'
          ? `Dry run — would have: ${report.actions.map((a) => a.type).join(', ') || 'nothing'}`
          : 'Ran.',
  };
}

export async function killSwitchAction(formData: FormData): Promise<AgentActionResult> {
  const user = await requireUser();
  const on = String(formData.get('on') ?? '') === '1';
  await setGlobalKill(on, user.email);
  revalidatePath('/agents');
  return { ok: true, message: on ? 'Everything stopped.' : 'Agents may run again.' };
}
