#!/usr/bin/env node
/**
 * What the screen says about an agent, as the job sees it.
 *
 * The switches, the levels and the briefs live in the database because the
 * screen writes them there. A job that reads its own environment instead is a
 * job whose OFF button does nothing — so every job that does an agent's work
 * asks here first, and asks by the agent's name.
 *
 * Two things come back:
 *
 *   state   whether it may run at all, and whether it may speak in Slack — the kill switch, then the agent's own
 *           switch. A dry run is always allowed: seeing what it would do is
 *           how he decides whether to switch it on.
 *   brief   what he has taught it, in his words.
 *
 * The brief may only ever NARROW what the rules already allowed. It cannot
 * make an agent do something its rules refused — that would put the decision
 * in free text, where a sentence written for one case quietly widens every
 * other one.
 */

export async function agentState(sql, name) {
  const [flag] = await sql`select value from system_flags where key = 'agents_global_kill' limit 1`
    .catch(() => [{ value: 'true' }]); // a flag we cannot read is not permission to run
  const killed = flag?.value === 'true' || process.env.AGENTS_GLOBAL_KILL === 'true';

  // A row we cannot read is not permission to run either.
  const [row] = await sql`
    select enabled, instructions, playbook, notify_slack, run_every_minutes, last_ran_at, settings
    from agents where name = ${name} limit 1
  `.catch(() => []);

  return {
    exists: Boolean(row),
    enabled: Boolean(row?.enabled),
    // The per-agent Slack switch on the screen. Off means it works silently.
    notify: Boolean(row?.notify_slack),
    brief: (row?.instructions ?? '').trim(),
    /**
     * The document behind the agent: how this job is actually done. Longer
     * than the brief and read the same way — before anything is decided.
     */
    playbook: (row?.playbook ?? '').trim(),
    /**
     * The dials from the agent's card — lib/agents/settings.ts names them and
     * carries their defaults, so what is stored here is only what he changed.
     * A job reads them directly, which is what makes them binding rather than
     * advisory the way the brief is.
     */
    settings: row?.settings ?? {},
    /** Minutes he asked it to wait between runs. Null: every timer firing. */
    everyMinutes: row?.run_every_minutes ?? null,
    lastRanAt: row?.last_ran_at ? new Date(row.last_ran_at) : null,
    killed,
  };
}

/**
 * May this job act now? `dry` runs are always allowed and change nothing.
 * FORCE=1 is for a run he has asked for by hand, and says so in the log.
 */
export function mayAct(state, { dry = false, force = false, now = new Date() } = {}) {
  if (dry) return { act: false, dryRun: true, why: 'dry run — nothing will be touched' };
  if (state.killed) return { act: false, why: 'the global kill switch is on' };
  if (force) return { act: true, why: 'FORCE=1 — a run you asked for by hand' };
  if (!state.exists) return { act: false, why: 'this agent is not installed' };
  if (!state.enabled) return { act: false, why: 'this agent is switched off' };

  /*
   * His rhythm, from the screen. The timer fires more often than any agent
   * needs so that changing this is a click rather than a deploy; a firing
   * that arrives early costs one query and stops here.
   */
  if (state.everyMinutes && state.lastRanAt) {
    const dueAt = new Date(state.lastRanAt.getTime() + state.everyMinutes * 60_000);
    if (now < dueAt) {
      return { act: false, why: `not due yet — set to every ${state.everyMinutes} minutes` };
    }
  }

  return { act: true };
}

/** Remember that it ran, so the interval above means something. */
export async function markRan(sql, name, now = new Date()) {
  await sql`update agents set last_ran_at = ${now} where name = ${name}`.catch(() => {});
}

/**
 * The brief, applied to one thing the rules already accepted.
 *
 * Returns whether to go ahead, and why not when it says no. It can only veto.
 *
 * Fails closed on purpose: if he has taught it something and we cannot ask
 * whether this case is covered, the safe answer is to leave the item alone and
 * say so. Not acting is reversible; a forwarded email is not.
 */
export async function briefVeto({
  brief,
  // The document behind the agent, when there is one. It is standing
  // instruction exactly as the brief is, and read the same way.
  playbook = '',
  agent,
  what,
  item,
  apiKey = process.env.ANTHROPIC_API_KEY,
}) {
  if (!brief && !playbook) return { go: true };
  if (!apiKey) return { go: false, why: 'you have taught it something, but Claude is not connected' };

  const system =
    `You are checking one item against standing instructions the CEO wrote for an agent ` +
    `called "${agent}". The agent's own rules have already decided this item qualifies.\n\n` +
    `Your only job is to say whether his instructions tell it to LEAVE THIS ONE ALONE. ` +
    `You may only hold it back. You may never say to act on something, and you may never ` +
    `add a reason of your own — if his instructions do not cover this case, it goes ahead.\n\n` +
    `His instructions, verbatim:\n${brief}` +
    (playbook ? `\n\nAnd the playbook he wrote for it, verbatim:\n${playbook}` : '');

  const prompt =
    `The agent is about to: ${what}\n\n` +
    `The item:\n${Object.entries(item).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n` +
    `Answer as JSON: {"holdBack": boolean, "why": "the instruction that covers it, or empty"}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 400,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return { go: false, why: `could not check it against your brief (http_${res.status})` };

    const body = await res.json();
    const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const parsed = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? text);
    return parsed.holdBack
      ? { go: false, why: parsed.why || 'your brief says to leave this one' }
      : { go: true };
  } catch (e) {
    return { go: false, why: `could not check it against your brief (${e.message})` };
  }
}

/**
 * Keep everything a job printed, and file it under the run.
 *
 * Jobs are started two ways — a button on the screen and a timer on the box —
 * and until now only the first showed him anything, and only in the tab that
 * started it. Teeing the console into a buffer means one recording path for
 * both, with no job having to learn to report itself.
 */
export function startLog() {
  const lines = [];
  const keep = (stream) => (...args) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    stream(...args);
  };
  const originals = { log: console.log, error: console.error };
  console.log = keep(originals.log);
  console.error = keep(originals.error);

  return {
    text: () => lines.join('\n'),
    stop: () => {
      console.log = originals.log;
      console.error = originals.error;
    },
  };
}

/**
 * One row per run, insert-only. Never throws: a run that did its work and
 * failed to write its diary still did its work.
 */
export async function recordRun(sql, name, { dry, output, summary = {}, ok = true, startedAt }) {
  await sql`
    insert into agent_job_runs (agent_name, dry, started_at, finished_at, ok, output, summary)
    values (
      ${name}, ${Boolean(dry)}, ${startedAt ?? new Date()}, now(), ${ok},
      ${(output ?? '').slice(0, 100_000)}, ${sql.json(summary)}
    )
  `.catch((e) => console.error(`could not record the run: ${e.message}`));
}
