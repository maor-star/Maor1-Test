import { describe, expect, it } from 'vitest';
import { buildBoard, type PipelineRow } from '@/lib/pipeline/board';
import { OPEN_STAGES, QUIET_DAYS, pipelineInputSchema } from '@/lib/pipeline/types';

/**
 * The pipeline's two rules.
 *
 * Spec §8 milestone 3 is explicit that a deal cannot be saved without a next
 * step and a date for it, and that the rule is enforced on the server rather
 * than only in the form — so it is tested against the schema, which is what the
 * server action actually runs.
 */

const row = (over: Partial<PipelineRow> = {}): PipelineRow => ({
  id: crypto.randomUUID(),
  name: 'Acme',
  domain: null,
  clientType: 'demand',
  stage: 'open_new',
  temperature: 'warm',
  ownerName: null,
  ownerPersonId: null,
  nextStep: 'Call them',
  nextStepDate: '2026-09-01',
  valueCents: 100_000,
  probability: 50,
  source: null,
  notes: null,
  lastContactAt: new Date(),
  quietDays: 1,
  stepOverdue: false,
  touches: 1,
  ...over,
});

describe('pipeline validation', () => {
  it('rejects an open deal with no next step', () => {
    const result = pipelineInputSchema.safeParse({ name: 'Acme', stage: 'negotiation' });
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('nextStep');
    expect(paths).toContain('nextStepDate');
  });

  it('rejects an open deal with a step but no date for it', () => {
    const result = pipelineInputSchema.safeParse({
      name: 'Acme',
      stage: 'negotiation',
      nextStep: 'Chase the signature',
    });
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(['nextStepDate']);
  });

  it('holds the rule for every open stage, and for none of the closed ones', () => {
    for (const stage of OPEN_STAGES) {
      expect(pipelineInputSchema.safeParse({ name: 'Acme', stage }).success).toBe(false);
    }
    for (const stage of ['live', 'lost'] as const) {
      expect(pipelineInputSchema.safeParse({ name: 'Acme', stage }).success).toBe(true);
    }
  });

  it('accepts an open deal that has both', () => {
    const result = pipelineInputSchema.safeParse({
      name: 'Acme',
      stage: 'open_existing',
      nextStep: 'Send the deck',
      nextStepDate: '2026-09-04',
    });
    expect(result.success).toBe(true);
  });

  it('treats an empty string as absent rather than as a value', () => {
    const parsed = pipelineInputSchema.parse({
      name: 'Acme',
      stage: 'live',
      domain: '',
      probability: '',
      valueCents: '',
    });
    expect(parsed.domain).toBeNull();
    expect(parsed.probability).toBeNull();
    expect(parsed.valueCents).toBeNull();
  });

  it('rejects a probability outside 0-100', () => {
    expect(
      pipelineInputSchema.safeParse({ name: 'Acme', stage: 'live', probability: 140 }).success,
    ).toBe(false);
  });
});

describe('pipeline board', () => {
  it('counts open value from open stages only', () => {
    const board = buildBoard([
      row({ stage: 'negotiation', valueCents: 100_000 }),
      row({ stage: 'live', valueCents: 900_000 }),
      row({ stage: 'lost', valueCents: 500_000 }),
    ]);

    expect(board.totals.clients).toBe(3);
    expect(board.totals.openValueCents).toBe(100_000);
  });

  it('weights by the probability set, and counts an unset one as nothing', () => {
    const board = buildBoard([
      row({ stage: 'negotiation', valueCents: 200_000, probability: 25 }),
      row({ stage: 'negotiation', valueCents: 200_000, probability: null }),
    ]);

    expect(board.totals.weightedValueCents).toBe(50_000);
  });

  it('counts a client with no logged conversation as quiet', () => {
    const board = buildBoard([
      row({ quietDays: null }),
      row({ quietDays: QUIET_DAYS }),
      row({ quietDays: 1 }),
    ]);
    expect(board.totals.quiet).toBe(2);
  });

  it('drops empty stages so the board shows only what exists', () => {
    const board = buildBoard([row({ stage: 'open_new' }), row({ stage: 'open_new' })]);
    expect(board.byStage.map((s) => s.stage)).toEqual(['open_new']);
    expect(board.byStage[0]!.rows).toHaveLength(2);
  });

  it('groups clients by type, biggest group first', () => {
    const board = buildBoard([
      row({ clientType: 'demand' }),
      row({ clientType: 'demand' }),
      row({ clientType: 'supply' }),
    ]);
    expect(board.totals.byType[0]).toEqual({ clientType: 'demand', n: 2 });
  });
});
