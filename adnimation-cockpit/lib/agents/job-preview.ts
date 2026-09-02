import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * A dry run that shows what would happen to each thing, not what kind of thing
 * would happen.
 *
 * "Would have: draft_reply, update_record" tells him nothing he needs. What he
 * needs is the list: this email would be answered and here is the reply, this
 * one would be filed and here is the line, this one would be left alone and
 * here is why. That list only exists inside the job, which reads the real
 * mailbox — so the dry run on the screen runs the real job with DRY=1 and
 * shows exactly what it printed.
 *
 * Running the job rather than reimplementing it in the app is the whole point:
 * a preview written separately from the thing it previews is a preview that
 * can be right while the job is wrong.
 */

/** Only these, by name. Nothing here is built from anything he typed. */
export const JOB_FOR: Record<string, string> = {
  'mail-answerer': 'mail-answer.mjs',
  'invoice-forwarder': 'invoice-forward.mjs',
  'contact-harvester': 'crm-harvest.mjs',
};

export function jobFor(agentName: string): string | null {
  return JOB_FOR[agentName] ?? null;
}

export interface JobPreview {
  ok: boolean;
  /** What the job printed, trimmed of the noise before its first decision. */
  output: string;
  reason?: string;
}

/**
 * Runs the agent's job and hands back what it printed.
 *
 * `dry` defaults to true and sets DRY=1 in the child's environment, so the
 * default can never send, file or trash anything however the box is
 * configured. A real run is only ever the explicit `dry: false`.
 */
export async function runJob(
  agentName: string,
  opts: { dir?: string; timeoutMs?: number; dry?: boolean } = {},
): Promise<JobPreview> {
  const dry = opts.dry !== false;
  const script = jobFor(agentName);
  if (!script) return { ok: false, output: '', reason: 'This agent has no dry run of its own yet.' };

  const dir = opts.dir ?? process.env.JOBS_DIR ?? '/opt/cockpit-jobs';

  try {
    const { stdout, stderr } = await run('node', [script], {
      cwd: dir,
      env: { ...process.env, DRY: dry ? '1' : '0', FORCE: '0' },
      timeout: opts.timeoutMs ?? 180_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const text = `${stdout}${stderr ? `\n${stderr}` : ''}`.trim();
    return { ok: true, output: text || 'It ran and printed nothing.' };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    // A job that failed still printed what it decided before it failed, and
    // that is usually the interesting part.
    const text = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
    return {
      ok: false,
      output: text,
      reason: err.killed ? 'It took too long and was stopped.' : (err.message ?? 'It failed.'),
    };
  }
}
