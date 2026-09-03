import { describe, expect, it } from 'vitest';
import { buildBoard, type PipelineRow } from '@/lib/pipeline/board';
import {
  DEFAULT_NEXT_STEP, OPEN_STAGES, QUIET_DAYS, defaultNextStepDate, pipelineInputSchema,
} from '@/lib/pipeline/types';
import { progressFor } from '@/lib/pipeline/integration';

/**
 * The pipeline's two rules.
 *
 * Spec §8 milestone 3 asks that no open deal be without a next step and a date
 * for it, enforced on the server rather than only in the form. It is enforced
 * here — in the schema the server action actually runs — by filling the pair
 * in rather than refusing the save: rejecting it meant a deal he typed by hand
 * simply did not appear, while deals arriving from the mail path were written
 * without a next step anyway. The invariant is what matters; the refusal was
 * only ever felt by the person typing.
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
  integration: progressFor('demand', {}),
  closedAt: null,
  closeOutcome: null,
  closeNote: null,
  touches: 1,
  ...over,
});

describe('pipeline validation', () => {
  it('saves a deal that is only a name, and gives it a next step', () => {
    const parsed = pipelineInputSchema.parse({ name: 'Acme', stage: 'negotiation' });
    expect(parsed.nextStep).toBe(DEFAULT_NEXT_STEP);
    expect(parsed.nextStepDate).toBe(defaultNextStepDate());
  });

  it('fills in only the half he left out', () => {
    const parsed = pipelineInputSchema.parse({
      name: 'Acme',
      stage: 'negotiation',
      nextStep: 'Chase the signature',
    });
    expect(parsed.nextStep).toBe('Chase the signature');
    expect(parsed.nextStepDate).toBe(defaultNextStepDate());
  });

  it('dates the placeholder tomorrow, so an untouched deal surfaces at once', () => {
    expect(defaultNextStepDate('2026-09-03')).toBe('2026-09-04');
    // Month and year ends included, because that is where date arithmetic goes wrong.
    expect(defaultNextStepDate('2026-09-30')).toBe('2026-10-01');
    expect(defaultNextStepDate('2026-12-31')).toBe('2027-01-01');
  });

  it('holds the invariant for every open stage, and imposes nothing on the closed ones', () => {
    for (const stage of OPEN_STAGES) {
      const parsed = pipelineInputSchema.parse({ name: 'Acme', stage });
      expect(parsed.nextStep, stage).toBeTruthy();
      expect(parsed.nextStepDate, stage).toBeTruthy();
    }
    for (const stage of ['live', 'lost'] as const) {
      const parsed = pipelineInputSchema.parse({ name: 'Acme', stage });
      expect(parsed.nextStep ?? null, stage).toBeNull();
      expect(parsed.nextStepDate ?? null, stage).toBeNull();
    }
  });

  it('still refuses a deal with no name — that one is not a placeholder', () => {
    expect(pipelineInputSchema.safeParse({ name: '   ', stage: 'live' }).success).toBe(false);
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
