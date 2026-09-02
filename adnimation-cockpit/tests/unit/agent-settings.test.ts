import { describe, expect, it } from 'vitest';
import {
  AGENT_SETTINGS, RETIRED_AGENTS, defaultSettings, effectiveSettings, settingsFromForm,
} from '@/lib/agents/settings';
import { SEED_AGENTS } from '@/lib/agents/definitions';

/**
 * The dials on each agent.
 *
 * Two promises: a value he never touched is the declared default, so a new
 * dial is live everywhere the moment it ships; and a stored value is trusted no
 * further than its type, so a select holding an option that no longer exists
 * cannot reach the code that reads it.
 */

describe('the roster and its settings agree', () => {
  it('declares settings for every seeded agent', () => {
    for (const a of SEED_AGENTS) expect(Object.keys(AGENT_SETTINGS), a.name).toContain(a.name);
  });
  it('seeds none of the retired ones', () => {
    const names = SEED_AGENTS.map((a) => a.name);
    for (const r of RETIRED_AGENTS) expect(names).not.toContain(r);
  });
  it('every default is a valid value of its own field', () => {
    for (const [name, fields] of Object.entries(AGENT_SETTINGS)) {
      const eff = effectiveSettings(name, {});
      for (const f of fields) expect(eff[f.key], `${name}.${f.key}`).toEqual(f.default);
    }
  });
});

describe('what he set, over the defaults', () => {
  it('keeps a valid number and drops one outside its bounds', () => {
    expect(effectiveSettings('activity-watch', { dropPct: 35 }).dropPct).toBe(35);
    expect(effectiveSettings('activity-watch', { dropPct: 500 }).dropPct).toBe(20);
    expect(effectiveSettings('activity-watch', { dropPct: 'lots' }).dropPct).toBe(20);
  });
  it('drops a select value that is no longer an option', () => {
    expect(effectiveSettings('mail-answerer', { tone: 'sarcastic' }).tone).toBe('direct');
    expect(effectiveSettings('mail-answerer', { tone: 'warm' }).tone).toBe('warm');
  });
  it('keeps only known members of a multi-select', () => {
    expect(effectiveSettings('activity-watch', { lines: ['video', 'nonsense'] }).lines).toEqual(['video']);
  });
  it('ignores keys the agent does not declare', () => {
    expect(effectiveSettings('task-hygiene', { launchNukes: true })).not.toHaveProperty('launchNukes');
  });
});

describe('from the form to the row', () => {
  it('stores only what differs from the default', () => {
    const stored = settingsFromForm('deal-mover', {
      overdueDays: '2', quietDays: '30', draftFollowUp: 'on', proposeStage: '',
      stages: ['negotiation'], language: 'match', tone: 'direct', maxItems: '10',
    });
    expect(stored).toEqual({ quietDays: 30, proposeStage: false, stages: ['negotiation'] });
  });
  it('treats an absent checkbox as off', () => {
    expect(settingsFromForm('renewal-warner', { warnDays: '45' })).toEqual({ createTask: false });
  });
  it('round-trips through effectiveSettings to a complete object', () => {
    // A real form posts every field it shows; a multi-select with nothing
    // ticked is genuinely empty, so the full form is what round-trips.
    const stored = settingsFromForm('systems-watch', {
      staleHours: '12', failedRuns: '2', watch: ['syncs', 'timers', 'agents', 'source'], channel: 'slack',
    });
    expect(stored).toEqual({ staleHours: 12 });
    expect(effectiveSettings('systems-watch', stored)).toEqual({ ...defaultSettings('systems-watch'), staleHours: 12 });
  });
});
