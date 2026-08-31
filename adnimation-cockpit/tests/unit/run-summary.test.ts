import { describe, expect, it } from 'vitest';
import { summarise } from '@/lib/agents/summarise-run';

/**
 * The line he reads before deciding whether to open a run.
 *
 * It has to be honest about a run that did nothing — "nothing to report" is
 * information; a blank line reads like a bug — and it must never describe a
 * dry run in the past tense, which would tell him mail went out when none did.
 */
describe('the one line about a run', () => {
  it('says what a real run did', () => {
    expect(summarise({ dry: false, summary: { read: 9, answered: 2, left: 7 } })).toBe(
      '9 read · 2 answered · 7 left for you',
    );
  });

  it('never says a dry run answered anything', () => {
    const line = summarise({ dry: true, summary: { read: 9, answered: 2 } });
    expect(line).toContain('would be answered');
    expect(line).not.toMatch(/\b2 answered\b/);
  });

  it('says why nothing happened, when that is the whole story', () => {
    expect(summarise({ dry: false, summary: { skipped: 'this agent is switched off' } })).toBe(
      'this agent is switched off',
    );
  });

  it('says something rather than nothing for an empty run', () => {
    expect(summarise({ dry: false, summary: {} })).toBe('nothing to report');
    expect(summarise({ dry: false, summary: { read: 0, answered: 0 } })).toBe('nothing to report');
  });

  it('reports what a brief held back, which is the number he will ask about', () => {
    expect(summarise({ dry: false, summary: { found: 3, sent: 2, held: 1 } })).toContain(
      '1 held back by your brief',
    );
  });
});
