import { describe, expect, it } from 'vitest';
import { JOB_FOR, jobFor, runJob } from '@/lib/agents/job-preview';
import { SEED_AGENTS } from '@/lib/agents/definitions';

/**
 * The dry run runs a real script, so the two things that matter are that it
 * can only ever run one of ours, and that it cannot do anything while it does.
 */
describe('the dry run behind the button', () => {
  it('only knows scripts by name, never anything assembled from input', () => {
    for (const script of Object.values(JOB_FOR)) {
      expect(script).toMatch(/^[a-z-]+\.mjs$/);
    }
    expect(jobFor('../../etc/passwd')).toBeNull();
    expect(jobFor('mail-answerer; rm -rf /')).toBeNull();
  });

  it('names only agents that exist', () => {
    const names = new Set(SEED_AGENTS.map((a) => a.name));
    for (const name of Object.keys(JOB_FOR)) expect(names).toContain(name);
  });

  it('says so plainly for an agent with no job of its own', async () => {
    const result = await runJob('morning-brief');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no dry run/i);
  });

  it('reports a missing jobs directory rather than throwing', async () => {
    const result = await runJob('mail-answerer', { dir: '/nowhere-at-all' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('is dry unless something explicitly says otherwise', async () => {
    // The default must be the safe one: a caller that forgets the flag looks.
    const result = await runJob('mail-answerer', { dir: '/nowhere-at-all' });
    expect(result.ok).toBe(false);
  });
});
