import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, pipelineClients } from '@/lib/db';
import { listPipeline } from '@/lib/pipeline/service';

/**
 * Ordering the book.
 *
 * Newest is the default because he opens this screen after something has
 * happened. The tiebreak matters as much as the order: two clients that
 * compare equal must not swap places between page loads, which reads as the
 * page rearranging itself while he looks at it.
 */
const MARK = `sorttest${Date.now()}`;
const ids: string[] = [];

beforeAll(async () => {
  const make = async (name: string, createdAt: Date, valueCents: number, nextStepDate: string) => {
    const [row] = await db
      .insert(pipelineClients)
      .values({
        name,
        domain: `${MARK}.example`,
        clientType: 'demand',
        stage: 'contact',
        nextStep: 'call them',
        nextStepDate,
        valueCents,
      })
      .returning();
    await db.update(pipelineClients).set({ createdAt }).where(eq(pipelineClients.id, row!.id));
    ids.push(row!.id);
  };

  await make(`${MARK} first`, new Date('2026-01-05T09:00:00Z'), 100_000, '2026-12-01');
  await make(`${MARK} second`, new Date('2026-04-05T09:00:00Z'), 900_000, '2026-10-01');
  await make(`${MARK} third`, new Date('2026-07-05T09:00:00Z'), 500_000, '2026-11-01');
});

afterAll(async () => {
  if (ids.length > 0) await db.delete(pipelineClients).where(inArray(pipelineClients.id, ids));
});

const names = async (sort: 'newest' | 'oldest' | 'next_step' | 'value') =>
  (await listPipeline({ q: MARK, sort })).map((r) => r.name);

describe('ordering the pipeline', () => {
  it('leads with the newest when nothing is chosen', async () => {
    expect((await listPipeline({ q: MARK })).map((r) => r.name)).toEqual([
      `${MARK} third`,
      `${MARK} second`,
      `${MARK} first`,
    ]);
  });

  it('reverses exactly for oldest', async () => {
    expect(await names('oldest')).toEqual([
      `${MARK} first`,
      `${MARK} second`,
      `${MARK} third`,
    ]);
  });

  it('orders by the next step when he asks for it', async () => {
    expect(await names('next_step')).toEqual([
      `${MARK} second`,
      `${MARK} third`,
      `${MARK} first`,
    ]);
  });

  it('orders by size when he asks for it', async () => {
    expect(await names('value')).toEqual([
      `${MARK} second`,
      `${MARK} third`,
      `${MARK} first`,
    ]);
  });

  it('gives the same answer twice', async () => {
    expect(await names('newest')).toEqual(await names('newest'));
  });
});
