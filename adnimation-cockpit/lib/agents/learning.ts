import { eq } from 'drizzle-orm';
import { spawn } from 'node:child_process';
import { agentLearning, db } from '@/lib/db';
import { writeAudit } from '@/lib/audit';

/**
 * What an agent learned from his mail, and how he corrects it.
 *
 * Two things are deliberately separate here and in the prompt: what he told an
 * agent (agents.instructions) and what it read off his own replies (this).
 * Retraining must never overwrite a sentence he wrote, and rewriting that
 * sentence must never mean retraining — so the two never share a field.
 *
 * A profile he has edited belongs to him. Training leaves it alone and says
 * so, rather than replacing his words with a fresh inference.
 */

export interface Learning {
  profile: string | null;
  examples: { subject: string; theirs: string; mine: string }[];
  facts: {
    replies?: number;
    hebrewShare?: number;
    medianLength?: number;
    windowDays?: number;
  };
  threadsRead: number;
  startedAt: Date | null;
  learnedAt: Date | null;
  error: string | null;
  editedByHim: boolean;
  /** True while a training run is in flight. */
  running: boolean;
}

export async function getLearning(agentName: string): Promise<Learning | null> {
  const [row] = await db
    .select()
    .from(agentLearning)
    .where(eq(agentLearning.agentName, agentName))
    .limit(1);
  if (!row) return null;

  // Started and not finished since, and not so long ago that it must have died.
  const running =
    row.startedAt !== null &&
    (row.learnedAt === null || row.learnedAt < row.startedAt) &&
    Date.now() - row.startedAt.getTime() < 30 * 60_000 &&
    row.error === null;

  return {
    profile: row.profile,
    examples: (row.examples ?? []) as Learning['examples'],
    facts: (row.facts ?? {}) as Learning['facts'],
    threadsRead: row.threadsRead,
    startedAt: row.startedAt,
    learnedAt: row.learnedAt,
    error: row.error,
    editedByHim: row.editedByHim,
    running,
  };
}

/** His own words replace what was inferred, and are marked as his. */
export async function setProfile(
  agentName: string,
  profile: string | null,
  actor: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = (profile ?? '').trim();
  if (text.length > 8000) return { ok: false, error: 'That is longer than a profile should be' };

  await db
    .insert(agentLearning)
    .values({
      agentName,
      profile: text || null,
      editedByHim: text.length > 0,
      learnedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: agentLearning.agentName,
      set: { profile: text || null, editedByHim: text.length > 0 },
    });

  await writeAudit({
    actor,
    action: 'agent.profile',
    entityType: 'agent',
    entityId: agentName,
    after: { length: text.length, cleared: text.length === 0 },
  });
  return { ok: true };
}

/**
 * Start a training run and return immediately.
 *
 * It reads hundreds of threads and calls the model twenty times, which is
 * minutes rather than seconds — far longer than a click should wait. So it is
 * detached, writes its own progress to the row above, and the screen shows
 * where it got to.
 */
export async function startTraining(
  agentName: string,
  actor: string,
  opts: { dir?: string; days?: number; max?: number } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await getLearning(agentName);
  if (existing?.running) return { ok: false, error: 'It is already reading your mail' };

  const dir = opts.dir ?? process.env.JOBS_DIR ?? '/opt/cockpit-jobs';

  try {
    const child = spawn('node', ['mail-learn.mjs'], {
      cwd: dir,
      env: {
        ...process.env,
        LEARN_AGENT: agentName,
        ...(opts.days ? { DAYS: String(opts.days) } : {}),
        ...(opts.max ? { LEARN_MAX: String(opts.max) } : {}),
        DRY: '0',
      },
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not start it' };
  }

  // The job stamps started_at itself, but a row here means the screen can say
  // "reading your mail" from the moment he clicks rather than after the first
  // database write.
  await db
    .insert(agentLearning)
    .values({ agentName, startedAt: new Date(), error: null })
    .onConflictDoUpdate({
      target: agentLearning.agentName,
      set: { startedAt: new Date(), error: null },
    });

  await writeAudit({
    actor,
    action: 'agent.train',
    entityType: 'agent',
    entityId: agentName,
    after: { days: opts.days ?? 365 },
  });
  return { ok: true };
}
