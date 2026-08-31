import { describe, expect, it } from 'vitest';
import { reportLine } from '@/lib/agents/notify';
import type { RunReport } from '@/lib/agents/types';

/**
 * He asked for a message about what an agent did, and nothing else.
 *
 * The failure this prevents is the one he actually hit: a Slack DM saying
 * "stopped: this agent is switched off" every time a timer fired. Three of
 * those and the one message that mattered gets skimmed past.
 */
const report = (over: Partial<RunReport>): RunReport => ({
  outcome: 'completed',
  conditions: [],
  actions: [],
  ...over,
});

describe('what an agent says in Slack', () => {
  it('says what it did, when it did something', () => {
    const text = reportLine(
      'mail-answerer',
      report({ actions: [{ type: 'draft_reply', performed: true, detail: 'answered Dana' }] }),
    );
    expect(text).toContain('answered Dana');
  });

  it('says nothing when it did nothing', () => {
    expect(reportLine('mail-answerer', report({ outcome: 'completed' }))).toBeNull();
  });

  it('says nothing when it halted, whatever the reason', () => {
    expect(
      reportLine('mail-answerer', report({ outcome: 'halted', haltReason: 'switched off' })),
    ).toBeNull();
    expect(
      reportLine('mail-answerer', report({ outcome: 'halted', haltReason: 'conditions not met' })),
    ).toBeNull();
  });

  it('says nothing when it failed, or when it was only a dry run', () => {
    expect(reportLine('x', report({ outcome: 'failed', error: 'boom' }))).toBeNull();
    expect(
      reportLine('x', report({ outcome: 'dry_run', actions: [{ type: 'a', performed: false, detail: 'd' }] })),
    ).toBeNull();
  });
});
