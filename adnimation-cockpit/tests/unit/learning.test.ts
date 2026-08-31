import { afterEach, describe, expect, it } from 'vitest';
import { agentLearning, db } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getLearning, setProfile } from '@/lib/agents/learning';

/**
 * What he told an agent and what it read off his mail are different things.
 *
 * The failure this guards against is a retrain quietly replacing a correction
 * he wrote — he would not see it happen, and the next draft would be in the
 * voice it inferred rather than the one he asked for.
 */
const NAME = `test-agent-${Date.now()}`;

afterEach(async () => {
  await db.delete(agentLearning).where(eq(agentLearning.agentName, NAME));
});

describe('what an agent learned', () => {
  it('is nothing at all until it has read something', async () => {
    expect(await getLearning(NAME)).toBeNull();
  });

  it('is marked as his the moment he edits it, so training leaves it alone', async () => {
    await setProfile(NAME, 'Two lines, no greeting, sign off Maor.', 'maor@adnimation.com');
    const learned = await getLearning(NAME);
    expect(learned?.profile).toContain('Two lines');
    expect(learned?.editedByHim).toBe(true);
  });

  it('is his again to relearn when he clears it', async () => {
    await setProfile(NAME, 'something', 'maor@adnimation.com');
    await setProfile(NAME, '   ', 'maor@adnimation.com');
    const learned = await getLearning(NAME);
    expect(learned?.profile).toBeNull();
    expect(learned?.editedByHim).toBe(false);
  });

  it('refuses a profile longer than a profile should be', async () => {
    const result = await setProfile(NAME, 'x'.repeat(9000), 'maor@adnimation.com');
    expect(result.ok).toBe(false);
  });

  it('reports a run as finished once the result is newer than the start', async () => {
    const started = new Date(Date.now() - 60_000);
    await db.insert(agentLearning).values({ agentName: NAME, startedAt: started });
    expect((await getLearning(NAME))?.running).toBe(true);

    await db
      .update(agentLearning)
      .set({ learnedAt: new Date(), profile: 'done' })
      .where(eq(agentLearning.agentName, NAME));
    expect((await getLearning(NAME))?.running).toBe(false);
  });

  it('does not call a run from last week "running"', async () => {
    await db
      .insert(agentLearning)
      .values({ agentName: NAME, startedAt: new Date(Date.now() - 7 * 24 * 3600_000) });
    expect((await getLearning(NAME))?.running).toBe(false);
  });
});
