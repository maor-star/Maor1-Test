'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { eq } from 'drizzle-orm';
import { agents, db } from '@/lib/db';
import {
  runById, seedAgents, setAgentEnabled, setAutonomy, setGlobalKill, setInstructions,
  setNotifySlack, setRunEvery, setSettings,
} from '@/lib/agents/module';
import { settingsFromForm } from '@/lib/agents/settings';
import { jobFor, runJob } from '@/lib/agents/job-preview';
import { setProfile, startTraining } from '@/lib/agents/learning';

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
  /** What a dry run would have done, message by message. */
  preview?: string;
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
  const [row] = await db.select().from(agents).where(eq(agents.id, id.data)).limit(1);

  /*
   * Some agents do their work in a job, because the job is what can reach the
   * mailbox. For those, both buttons run that job — DRY=1 for a dry run, for
   * real otherwise — and hand back what it printed, message by message with
   * the reason for each. Running the engine over them instead produced
   * "conditions not met" for conditions that decide nothing, which is worse
   * than useless: it reads like a refusal.
   */
  if (row && jobFor(row.name)) {
    const result = await runJob(row.name, { dry: dryRun });
    const preview = [result.output, result.ok ? '' : `\n(${result.reason})`]
      .filter(Boolean)
      .join('');
    revalidatePath('/agents');
    return {
      ok: result.ok,
      ...(result.ok ? {} : { error: result.reason ?? 'It failed' }),
      ...(preview ? { preview } : {}),
      message: dryRun
        ? 'Dry run — nothing was touched. What it would have done is below.'
        : 'It ran. What it did is below.',
    };
  }

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

/** Teach an agent something, in his own words. */
export async function setInstructionsAction(formData: FormData): Promise<AgentActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({ id: idSchema, instructions: z.string().max(20_000) })
    .safeParse({
      id: String(formData.get('id') ?? ''),
      instructions: String(formData.get('instructions') ?? ''),
    });
  if (!parsed.success) return { ok: false, error: 'Could not save that' };

  const result = await setInstructions(parsed.data.id, parsed.data.instructions, user.email);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/agents');
  return { ok: true, message: 'Saved. It will use this from the next run.' };
}

/** Whether this agent tells him what it did, in Slack. */
export async function setNotifyAction(formData: FormData): Promise<AgentActionResult> {
  const user = await requireUser();
  const id = idSchema.safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { ok: false, error: 'Not an agent' };

  const on = String(formData.get('on') ?? '') === '1';
  const result = await setNotifySlack(id.data, on, user.email);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/agents');
  return {
    ok: true,
    message: on ? 'It will tell you in Slack.' : 'It will stay quiet unless it halts.',
  };
}

export async function killSwitchAction(formData: FormData): Promise<AgentActionResult> {
  const user = await requireUser();
  const on = String(formData.get('on') ?? '') === '1';
  await setGlobalKill(on, user.email);
  revalidatePath('/agents');
  return { ok: true, message: on ? 'Everything stopped.' : 'Agents may run again.' };
}

/** How often it runs — his to set, without a deploy. */
export async function setScheduleAction(formData: FormData): Promise<AgentActionResult> {
  const user = await requireUser();
  const id = idSchema.safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { ok: false, error: 'Not an agent' };

  const raw = String(formData.get('minutes') ?? '');
  const minutes = raw === '' || raw === 'null' ? null : Number(raw);
  if (minutes !== null && !Number.isFinite(minutes)) return { ok: false, error: 'Not an interval' };

  const result = await setRunEvery(id.data, minutes, user.email);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/agents');
  return { ok: true, message: 'Saved.' };
}

/** Read a year of his mail and learn how he writes. Runs in the background. */
export async function trainAgentAction(formData: FormData): Promise<AgentActionResult> {
  const user = await requireUser();
  const id = idSchema.safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { ok: false, error: 'Not an agent' };

  const [row] = await db.select().from(agents).where(eq(agents.id, id.data)).limit(1);
  if (!row) return { ok: false, error: 'No such agent' };

  const days = Number(formData.get('days') ?? 365);
  const result = await startTraining(row.name, user.email, {
    days: Number.isFinite(days) && days > 0 && days <= 730 ? days : 365,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/agents');
  return {
    ok: true,
    message: 'Reading your mail. It takes a few minutes — this page will show what it learned.',
  };
}

/** Correct what it learned, in his own words. */
export async function setProfileAction(formData: FormData): Promise<AgentActionResult> {
  const user = await requireUser();
  const id = idSchema.safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { ok: false, error: 'Not an agent' };

  const [row] = await db.select().from(agents).where(eq(agents.id, id.data)).limit(1);
  if (!row) return { ok: false, error: 'No such agent' };

  const result = await setProfile(row.name, String(formData.get('profile') ?? ''), user.email);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/agents');
  return { ok: true, message: 'Saved. It is yours now, so training will leave it alone.' };
}

/**
 * His dials for one agent, from the customise form.
 *
 * The form posts every field it shows; the settings module keeps only what the
 * agent declares and only what differs from the default.
 */
export async function setSettingsAction(formData: FormData): Promise<AgentActionResult> {
  const user = await requireUser();
  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return { ok: false, error: 'Not an agent' };

  const [row] = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, id.data)).limit(1);
  if (!row) return { ok: false, error: 'No such agent' };

  const form: Record<string, string | string[]> = {};
  for (const [key, value] of formData.entries()) {
    if (key === 'id' || typeof value !== 'string') continue;
    const held = form[key];
    form[key] = held === undefined ? value : Array.isArray(held) ? [...held, value] : [held, value];
  }

  const result = await setSettings(id.data, settingsFromForm(row.name, form), user.email);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath('/agents');
  return { ok: true, message: 'Saved. The next run reads these.' };
}
