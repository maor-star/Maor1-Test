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
    select enabled, instructions, notify_slack from agents where name = ${name} limit 1
  `.catch(() => []);

  return {
    exists: Boolean(row),
    enabled: Boolean(row?.enabled),
    // The per-agent Slack switch on the screen. Off means it works silently.
    notify: Boolean(row?.notify_slack),
    brief: (row?.instructions ?? '').trim(),
    killed,
  };
}

/**
 * May this job act now? `dry` runs are always allowed and change nothing.
 * FORCE=1 is for a run he has asked for by hand, and says so in the log.
 */
export function mayAct(state, { dry = false, force = false } = {}) {
  if (dry) return { act: false, dryRun: true, why: 'dry run — nothing will be touched' };
  if (state.killed) return { act: false, why: 'the global kill switch is on' };
  if (force) return { act: true, why: 'FORCE=1 — a run you asked for by hand' };
  if (!state.exists) return { act: false, why: 'this agent is not installed' };
  if (!state.enabled) return { act: false, why: 'this agent is switched off' };
  return { act: true };
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
export async function briefVeto({ brief, agent, what, item, apiKey = process.env.ANTHROPIC_API_KEY }) {
  if (!brief) return { go: true };
  if (!apiKey) return { go: false, why: 'you have taught it something, but Claude is not connected' };

  const system =
    `You are checking one item against standing instructions the CEO wrote for an agent ` +
    `called "${agent}". The agent's own rules have already decided this item qualifies.\n\n` +
    `Your only job is to say whether his instructions tell it to LEAVE THIS ONE ALONE. ` +
    `You may only hold it back. You may never say to act on something, and you may never ` +
    `add a reason of your own — if his instructions do not cover this case, it goes ahead.\n\n` +
    `His instructions, verbatim:\n${brief}`;

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
