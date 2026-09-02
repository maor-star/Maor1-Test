import { OPEN_STAGES, QUIET_DAYS, STAGES, type ClientType, type Stage } from './types';
import type { CloseOutcome, IntegrationProgress } from './integration';

/**
 * The pipeline's shape and its arithmetic, with no database underneath.
 *
 * Kept apart from the queries so the rules that decide what "open value" and
 * "quiet" mean can be tested directly, without a connection string.
 */

export interface PipelineRow {
  id: string;
  name: string;
  domain: string | null;
  clientType: ClientType;
  stage: Stage;
  temperature: 'hot' | 'warm' | 'cold';
  ownerName: string | null;
  ownerPersonId: string | null;
  nextStep: string | null;
  nextStepDate: string | null;
  valueCents: number | null;
  probability: number | null;
  source: string | null;
  notes: string | null;
  lastContactAt: Date | null;
  /** Days since the last logged touch, or null when there has never been one. */
  quietDays: number | null;
  /** True when the next step's date has passed. */
  stepOverdue: boolean;
  touches: number;
  /** How far into going live it is. */
  integration: IntegrationProgress;
  closedAt: Date | null;
  closeOutcome: CloseOutcome | null;
  closeNote: string | null;
}

export interface PipelineBoard {
  byStage: { stage: Stage; rows: PipelineRow[]; valueCents: number }[];
  totals: {
    clients: number;
    openValueCents: number;
    weightedValueCents: number;
    overdueSteps: number;
    quiet: number;
    byType: { clientType: ClientType; n: number }[];
  };
}

export function buildBoard(rows: PipelineRow[]): PipelineBoard {
  const byStage = STAGES.map((stage) => {
    const inStage = rows.filter((r) => r.stage === stage);
    return {
      stage,
      rows: inStage,
      valueCents: inStage.reduce((a, r) => a + (r.valueCents ?? 0), 0),
    };
  }).filter((s) => s.rows.length > 0);

  const open = rows.filter((r) => OPEN_STAGES.includes(r.stage));
  const types = new Map<ClientType, number>();
  for (const r of rows) types.set(r.clientType, (types.get(r.clientType) ?? 0) + 1);

  return {
    byStage,
    totals: {
      clients: rows.length,
      openValueCents: open.reduce((a, r) => a + (r.valueCents ?? 0), 0),
      // Weighted by the probability the CEO set — an unset probability counts
      // as nothing rather than as certain.
      weightedValueCents: open.reduce(
        (a, r) => a + Math.round(((r.valueCents ?? 0) * (r.probability ?? 0)) / 100),
        0,
      ),
      overdueSteps: rows.filter((r) => r.stepOverdue).length,
      quiet: rows.filter((r) => r.quietDays === null || r.quietDays >= QUIET_DAYS).length,
      byType: [...types.entries()]
        .map(([clientType, n]) => ({ clientType, n }))
        .sort((a, b) => b.n - a.n),
    },
  };
}

