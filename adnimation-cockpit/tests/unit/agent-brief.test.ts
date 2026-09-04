import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — the jobs are plain ESM with no types.
import { agentState, briefVeto, mayAct } from '@/deploy/agent-brief.mjs';

/**
 * The switch on the screen has to mean something in the job.
 *
 * Every one of these is a way an agent could act when he believed it was off,
 * which is the failure that matters here: he judges the agents by what they do
 * while he is watching a dry run, and then trusts the OFF button.
 */
type Row = Record<string, unknown>;

/** A postgres-shaped tag function: answers by which table the query names. */
function fakeSql(rows: { flag?: Row[]; agent?: Row[] }, fail = false) {
  return (strings: TemplateStringsArray) => {
    const text = strings.join(' ');
    if (fail) return Promise.reject(new Error('no database'));
    if (text.includes('system_flags')) return Promise.resolve(rows.flag ?? []);
    return Promise.resolve(rows.agent ?? []);
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENTS_GLOBAL_KILL;
});

describe('the agent gate', () => {
  it('reads the switch and the brief from the agent’s own row', async () => {
    const state = await agentState(
      fakeSql({
        flag: [{ value: 'false' }],
        agent: [{ enabled: true, instructions: '  be careful  ', notify_slack: true }],
      }),
      'mail-answerer',
    );
    expect(state).toEqual({
      exists: true,
      enabled: true,
      notify: true,
      brief: 'be careful',
      // The document behind it, empty when he has not written one.
      playbook: '',
      // The dials from its card. Empty means every one is at its default.
      settings: {},
      everyMinutes: null,
      lastRanAt: null,
      killed: false,
    });
  });

  it('reads the Slack switch too, so an agent set to work silently does', async () => {
    const state = await agentState(
      fakeSql({ flag: [{ value: 'false' }], agent: [{ enabled: true, notify_slack: false }] }),
      'mail-answerer',
    );
    expect(state.notify).toBe(false);
  });

  it('treats an unreadable kill switch as a stop, not as permission', async () => {
    const state = await agentState(fakeSql({}, true), 'mail-answerer');
    expect(state.killed).toBe(true);
  });

  it('refuses when the kill switch is on, whatever the agent says', () => {
    expect(mayAct({ exists: true, enabled: true, killed: true }).act).toBe(false);
  });

  it('refuses a switched-off agent, and one that is not installed', () => {
    expect(mayAct({ exists: true, enabled: false, killed: false }).act).toBe(false);
    expect(mayAct({ exists: false, enabled: false, killed: false }).act).toBe(false);
  });

  it('lets a dry run through whatever the switches say — that is what it is for', () => {
    const gate = mayAct({ exists: false, enabled: false, killed: true }, { dry: true });
    expect(gate.act).toBe(false);
    expect(gate.dryRun).toBe(true);
  });

  it('waits for the interval he set, and runs once it has passed', () => {
    const now = new Date('2026-08-31T12:00:00Z');
    const base = { exists: true, enabled: true, killed: false, everyMinutes: 120 };

    const early = mayAct(
      { ...base, lastRanAt: new Date('2026-08-31T11:00:00Z') },
      { now },
    );
    expect(early.act).toBe(false);
    expect(early.why).toContain('120');

    expect(mayAct({ ...base, lastRanAt: new Date('2026-08-31T09:00:00Z') }, { now }).act).toBe(true);
    // Never run before means run now, not never.
    expect(mayAct({ ...base, lastRanAt: null }, { now }).act).toBe(true);
    // No interval set is "whenever the timer fires", which is what it did before.
    expect(
      mayAct({ ...base, everyMinutes: null, lastRanAt: new Date('2026-08-31T11:59:00Z') }, { now }).act,
    ).toBe(true);
  });

  it('lets a hand-run through with FORCE, but never past the kill switch', () => {
    expect(mayAct({ exists: true, enabled: false, killed: false }, { force: true }).act).toBe(true);
    expect(mayAct({ exists: true, enabled: false, killed: true }, { force: true }).act).toBe(false);
  });
});

describe('the brief', () => {
  const item = { subject: 'Invoice 4471', from: 'billing@vendor.com' };

  it('does nothing when he has not written one', async () => {
    const veto = await briefVeto({ brief: '', agent: 'x', what: 'forward it', item });
    expect(veto.go).toBe(true);
  });

  it('holds an item back when his brief covers it', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '{"holdBack": true, "why": "gym receipts are personal"}' }],
      }),
    }));
    const veto = await briefVeto({ brief: 'gym receipts are mine', agent: 'x', what: 'forward it', item, apiKey: 'k' });
    expect(veto.go).toBe(false);
    expect(veto.why).toContain('gym');
  });

  it('goes ahead when his brief does not cover it', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '{"holdBack": false, "why": ""}' }] }),
    }));
    const veto = await briefVeto({ brief: 'gym receipts are mine', agent: 'x', what: 'forward it', item, apiKey: 'k' });
    expect(veto.go).toBe(true);
  });

  it('holds back rather than guessing when it cannot ask', async () => {
    // He wrote instructions; acting without reading them is the worst outcome.
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect((await briefVeto({ brief: 'careful', agent: 'x', what: 'forward it', item, apiKey: 'k' })).go).toBe(false);

    vi.stubGlobal('fetch', async () => { throw new Error('network'); });
    expect((await briefVeto({ brief: 'careful', agent: 'x', what: 'forward it', item, apiKey: 'k' })).go).toBe(false);

    expect((await briefVeto({ brief: 'careful', agent: 'x', what: 'forward it', item, apiKey: undefined })).go).toBe(false);
  });
});


describe('the playbook, alongside the brief', () => {
  it('reads the document he wrote for the agent', async () => {
    const state = await agentState(
      fakeSql({
        flag: [{ value: 'false' }],
        agent: [{ enabled: true, instructions: 'be careful', playbook: '  HOW THIS JOB IS DONE\nnever on Fridays  ', notify_slack: true }],
      }),
      'mail-answerer',
    );
    expect(state.playbook).toBe('HOW THIS JOB IS DONE\nnever on Fridays');
  });

  it('lets an agent with only a playbook be checked against it', async () => {
    // The veto used to wave everything through when the brief was empty, which
    // would have made a playbook-only agent unconstrained.
    const verdict = await briefVeto({ brief: '', playbook: '', agent: 'x', what: 'file it', item: {} });
    expect(verdict.go).toBe(true);

    const held = await briefVeto({
      brief: '',
      playbook: 'never touch anything from Google',
      agent: 'x',
      what: 'file it',
      item: {},
      apiKey: '',
    });
    expect(held.go).toBe(false);
  });
});
