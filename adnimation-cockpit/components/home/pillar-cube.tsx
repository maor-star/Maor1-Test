'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { Sparkline } from '@/components/revenue/sparkline';
import { setLineTargetAction } from '@/app/actions/targets';
import { fmtMoney, fmtNumber } from '@/lib/utils';
import { BASIS_LABEL, TARGET_BASES } from '@/lib/control/target-rules';
import { notStartedYet, type LinePeriodSummary } from '@/lib/control/lines';
import type { LineTargetView } from '@/lib/control/targets';

/**
 * One revenue engine: what it earned, what it was meant to earn, and which of
 * those is bigger.
 *
 * Green or red across the whole tile, because the question he asks a wall of
 * these is not "how is the bidder doing" but "which of the seven needs me
 * today" — and that has to be answerable from across the room. An engine with
 * no target set stays neutral rather than guessing: red is a judgement, and
 * judging a line against a number nobody set is how a colour stops meaning
 * anything.
 *
 * The target is edited on the tile. It lives per month and is pro-rated to
 * whatever window the page is showing, so the same figure reads correctly over
 * seven days and over a quarter.
 */

const SKIN = {
  hit: {
    card: 'border-pos/45 bg-pos-tint',
    figure: 'text-[#157a45]',
    tag: 'ok' as const,
    word: 'On target',
  },
  missed: {
    card: 'border-neg/45 bg-neg/[0.06]',
    figure: 'text-neg',
    tag: 'critical' as const,
    word: 'Under target',
  },
  unset: {
    card: 'border-line bg-card',
    figure: 'text-ink',
    tag: 'outline' as const,
    word: 'No target set',
  },
};

export function PillarCube({
  line,
  target,
  month,
}: {
  line: LinePeriodSummary;
  target: LineTargetView;
  /** The month a target typed here applies to, as YYYY-MM-DD. */
  month: string;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const skin = SKIN[target.verdict];
  const pct = target.attainment === null ? null : Math.round(target.attainment * 100);

  /*
   * Neutral covers two different states, and calling both of them "no target
   * set" would be a lie about half of them: a pillar he has never given a
   * number to, and one he has, whose source has not reported a day yet.
   */
  const word =
    target.verdict === 'unset' && target.monthlyCents !== null
      ? 'Nothing to judge yet'
      : skin.word;

  /*
   * A line that is a plan rather than a business yet.
   *
   * Exchange CTV took two dollars in the last week of August. Without this it
   * shows a zero beside six real numbers, and a zero on this wall means
   * something broke — so he goes looking for a fault that is really a line he
   * has not launched. Said out loud instead, it costs him nothing.
   */
  const notStarted = notStartedYet(line);

  return (
    <div className={`min-w-0 rounded-[12px] border p-[15px] ${skin.card}`}>
      {/*
        The name on its own line, the state under it. Side by side, two tags
        and a name shared one row and the name lost — "EXCHANGE DISPLAY" came
        out as "EXCHANG…", which is not a wall he can read from across the
        room.
      */}
      <p className="hud-label whitespace-normal text-[11.5px] leading-tight" title={line.source}>
        {line.label}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {/* Both, not one instead of the other: a line can be ahead of target
            and have stopped reporting, and he needs to know both things. */}
        <Tag tone={notStarted && target.verdict === 'unset' ? 'outline' : skin.tag}>
          {notStarted && target.verdict === 'unset' ? 'Not started yet' : word}
        </Tag>
        {/* Not on a line that has not started: it has no days to be late with,
            and two greyed-out tags say less than one. */}
        {line.stale && !notStarted ? <Tag tone="warning">Quiet</Tag> : null}
      </div>

      {line.daysReported === 0 ? (
        <p className="mt-2 text-[13px] text-muted">
          {line.lastDay ? `Nothing in this window. Last day ${line.lastDay}.` : 'Nothing from the source yet.'}
        </p>
      ) : (
        <>
          <p className={`mt-2 font-mono text-[23px] font-semibold leading-none ${skin.figure}`}>
            <Num>{fmtMoney(target.actualCents)}</Num>
          </p>

          <p className="mt-1.5 text-[12px] text-muted">
            {BASIS_LABEL[target.basis].toLowerCase()}
            {target.expectedCents !== null ? (
              <>
                {' of '}
                <Num>{fmtMoney(target.expectedCents)}</Num>
                {pct !== null ? (
                  <>
                    {' · '}
                    <span className={target.verdict === 'missed' ? 'text-neg' : 'text-pos'}>
                      <Num>{`${pct}%`}</Num>
                    </span>
                  </>
                ) : null}
              </>
            ) : null}
          </p>

          {/* How far off, in money — the figure he acts on. A percentage says
              how bad it is; the gap says what has to be found. */}
          {target.gapCents !== null ? (
            <p className="mt-1 text-[12px] text-muted">
              {target.gapCents >= 0 ? 'ahead by ' : 'short by '}
              <Num>{fmtMoney(Math.abs(target.gapCents))}</Num>
            </p>
          ) : null}

          <Sparkline values={line.series} className="mt-2 h-7 w-full text-info" />

          <p className="mt-1.5 truncate text-[12px] text-muted">
            <Num>{line.daysReported}</Num>/<Num>{line.range.days}</Num> days
            {line.impressions > 0 ? (
              <> · <Num>{fmtNumber(line.impressions)}</Num> imp</>
            ) : null}
          </p>
        </>
      )}

      {editing ? (
        <form
          className="mt-2 border-t border-line pt-2"
          action={(formData) =>
            startTransition(async () => {
              const result = await setLineTargetAction(formData);
              setError(result.ok ? null : (result.error ?? 'That did not save'));
              if (result.ok) {
                setEditing(false);
                router.refresh();
              }
            })
          }
        >
          <input type="hidden" name="line" value={line.line} />
          <input type="hidden" name="month" value={month} />

          <label htmlFor={`tg-${line.line}`} className="hud-label block text-[11px]">
            Target for the month (USD)
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Input
              id={`tg-${line.line}`}
              name="target"
              dir="ltr"
              inputMode="decimal"
              placeholder="Empty clears it"
              defaultValue={target.monthlyCents === null ? '' : String(target.monthlyCents / 100)}
              className="h-8 w-28 text-[13px]"
            />
            <Select
              name="basis"
              defaultValue={target.basis}
              aria-label="Measured on"
              className="h-8 text-[13px]"
            >
              {TARGET_BASES.map((b) => (
                <option key={b} value={b}>
                  {BASIS_LABEL[b]}
                </option>
              ))}
            </Select>
            <Button type="submit" size="xs" disabled={pending}>
              {pending ? 'SAVING…' : 'SAVE'}
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {error ? <p className="mt-1 text-[12px] text-neg">{error}</p> : null}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="hud-label mt-2 text-[11px] text-info hover:underline"
        >
          {target.monthlyCents === null ? (
            '+ Set a target'
          ) : (
            <>
              Target <Num>{fmtMoney(target.monthlyCents)}</Num>/mo
              {target.source === 'feed' ? ' · from the plan' : ''}
            </>
          )}
        </button>
      )}
    </div>
  );
}
