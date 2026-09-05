import { and, eq, inArray } from 'drizzle-orm';
import { db, lineTargets } from '@/lib/db';
import { ACTIVITY_LINES, type ActivityLine } from './lines';
import {
  actualFor, attainment, daysInMonth, gapCents, judgedDays, monthOf, proRatedTarget, verdict,
  type LineTarget, type TargetBasis, type TargetVerdict,
} from './target-rules';

/**
 * What each pillar is meant to earn, and whether it is earning it.
 *
 * The target is monthly and the screen is not: he reads the company over a
 * week, a month, a quarter. So the stored figure is the month's, and what a
 * tile is judged against is that figure pro-rated to the days on screen.
 *
 * A target he typed and a target pulled from the planning system are the same
 * row with a different `source`, so the day the planning system is wired in,
 * nothing on the screen changes shape — the numbers just stop needing typing.
 */

export interface LineTargetView {
  line: ActivityLine;
  /** The month's figure, or null when nothing has been set for this line. */
  monthlyCents: number | null;
  basis: TargetBasis;
  source: 'manual' | 'feed';
  /** The share of it the window on screen should have earned. */
  expectedCents: number | null;
  /** What the line actually earned on the basis the target is set against. */
  actualCents: number;
  attainment: number | null;
  gapCents: number | null;
  verdict: TargetVerdict;
  updatedAt: Date | null;
}

/** Every line's target for the month a date falls in. */
export async function targetsFor(month: string): Promise<Map<string, LineTarget>> {
  const rows = await db
    .select()
    .from(lineTargets)
    .where(eq(lineTargets.month, monthOf(month)));

  const out = new Map<string, LineTarget>();
  for (const r of rows) {
    out.set(r.line, {
      line: r.line,
      month: r.month,
      targetCents: r.targetCents,
      basis: r.basis === 'net' ? 'net' : 'gross',
      source: r.source === 'feed' ? 'feed' : 'manual',
      updatedAt: r.updatedAt,
    });
  }
  return out;
}

/**
 * The most recent target on each line, whenever it was set.
 *
 * A target set in January is still the target in March until he changes it —
 * the alternative is every tile going grey on the first of the month, which
 * would teach him to ignore the colour.
 */
export async function currentTargets(): Promise<Map<string, LineTarget>> {
  const rows = await db
    .select()
    .from(lineTargets)
    .where(inArray(lineTargets.line, [...ACTIVITY_LINES]));

  const out = new Map<string, LineTarget>();
  for (const r of rows) {
    const held = out.get(r.line);
    if (held && held.month >= r.month) continue;
    out.set(r.line, {
      line: r.line,
      month: r.month,
      targetCents: r.targetCents,
      basis: r.basis === 'net' ? 'net' : 'gross',
      source: r.source === 'feed' ? 'feed' : 'manual',
      updatedAt: r.updatedAt,
    });
  }
  return out;
}

/** One line, judged against its target over the window on screen. */
export function judge(
  line: ActivityLine,
  target: LineTarget | undefined,
  figures: { grossCents: number; profitCents: number },
  window: { days: number; from: string; daysReported: number },
): LineTargetView {
  const basis: TargetBasis = target?.basis ?? 'gross';
  const actualCents = actualFor(basis, figures);

  if (!target) {
    return {
      line,
      monthlyCents: null,
      basis,
      source: 'manual',
      expectedCents: null,
      actualCents,
      attainment: null,
      gapCents: null,
      verdict: 'unset',
      updatedAt: null,
    };
  }

  // Judged over the days the source delivered. A feed with a hole in it is not
  // a line that missed its target, and a line with no days at all is nothing
  // to judge — expected stays null and the tile stays neutral.
  const days = judgedDays(window.daysReported, window.days);
  const expectedCents =
    days === 0 ? null : proRatedTarget(target.targetCents, days, daysInMonth(window.from));

  return {
    line,
    monthlyCents: target.targetCents,
    basis,
    source: target.source,
    expectedCents,
    actualCents,
    attainment: attainment(actualCents, expectedCents),
    gapCents: gapCents(actualCents, expectedCents),
    verdict: verdict(actualCents, expectedCents),
    updatedAt: target.updatedAt,
  };
}

/** Set — or clear — one line's target for a month. */
export async function setTarget(
  input: {
    line: ActivityLine;
    month: string;
    targetCents: number | null;
    basis: TargetBasis;
    source?: 'manual' | 'feed';
  },
  actor: string,
): Promise<void> {
  const month = monthOf(input.month);

  // Clearing takes out this line's figure for this month only. Wiping every
  // month would rewrite what earlier months were judged against.
  if (input.targetCents === null || input.targetCents <= 0) {
    await db
      .delete(lineTargets)
      .where(and(eq(lineTargets.line, input.line), eq(lineTargets.month, month)));
    return;
  }

  await db
    .insert(lineTargets)
    .values({
      line: input.line,
      month,
      targetCents: input.targetCents,
      basis: input.basis,
      source: input.source ?? 'manual',
      updatedBy: actor,
    })
    .onConflictDoUpdate({
      target: [lineTargets.line, lineTargets.month],
      set: {
        targetCents: input.targetCents,
        basis: input.basis,
        source: input.source ?? 'manual',
        updatedAt: new Date(),
        updatedBy: actor,
      },
    });
}
