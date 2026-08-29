import { Suspense } from 'react';
import Link from 'next/link';
import { loadCadence } from '@/lib/cadence/service';
import type { CadenceAction, CadenceItem } from '@/lib/cadence/engine';
import { fmtMoney } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { RevenueStrip } from '@/components/revenue/revenue-strip';

export const dynamic = 'force-dynamic';

/**
 * The cadence — the home screen is one ordered list of what to do next.
 *
 * Six panels of numbers leave the CEO to work out the order himself. This page
 * does that work: everything that can demand action becomes an item with a verb
 * and a position, the top five are what to do now, and the rest is what follows.
 */
export default function CockpitPage() {
  return (
    <div className="space-y-5">
      <PageHeader kicker="CADENCE / 01" title="Today" />

      <Suspense fallback={<Skeleton title="Now" index="Q01" />}>
        <CadenceQueue />
      </Suspense>

      <Suspense fallback={<Skeleton title="Revenue" index="R01" />}>
        <RevenueStrip />
      </Suspense>
    </div>
  );
}

const ACTION_TONE: Record<CadenceAction, 'critical' | 'warning' | 'watch' | 'accent' | 'outline'> = {
  CALL: 'accent',
  SIGN: 'critical',
  DECIDE: 'critical',
  RESOLVE: 'warning',
  CHASE: 'warning',
  REVIEW: 'watch',
  CLOSE: 'outline',
};

async function CadenceQueue() {
  const cadence = await loadCadence();
  const down = cadence.sources.filter((s) => !s.ok);

  if (cadence.items.length === 0) {
    return (
      <HudCard>
        <HudCardHeader title="Nothing is waiting" index="Q01" />
        <p className="font-semi text-[12px] leading-relaxed text-neutral-500">
          No open task, contract, renewal, delegation or revenue signal needs a decision right now.
          An empty cadence is a healthy state, not a missing feed.
        </p>
        <SourceLine sources={cadence.sources} />
      </HudCard>
    );
  }

  return (
    <div className="space-y-5">
      <HudCard className="gap-0 p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-2">
          <HudCardHeader
            title="Now"
            index="Q01"
            action={
              <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                <Num>{cadence.items.length}</Num> IN THE QUEUE
              </span>
            }
          />
        </div>
        <p className="px-[18px] pb-3 font-semi text-[11px] text-neutral-500">
          In order. Finish these and the day has moved.
        </p>

        <ol>
          {cadence.now.map((item, i) => (
            <NowRow key={item.id} item={item} position={i + 1} />
          ))}
        </ol>

        {down.length > 0 ? (
          <div className="border-t border-divider px-[18px] py-2 font-semi text-[10px] tracking-[0.12em] text-sev-warning">
            COULD NOT REACH: {down.map((s) => s.name.toUpperCase()).join(' · ')} — THIS LIST IS
            INCOMPLETE
          </div>
        ) : null}
      </HudCard>

      {cadence.next.length > 0 ? (
        <HudCard className="gap-0 p-0">
          <div className="flex items-baseline justify-between gap-3 p-[18px] pb-3">
            <HudCardHeader
              title="Next"
              index="Q02"
              action={
                cadence.laterCount > 0 ? (
                  <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                    <Num>{cadence.laterCount}</Num> MORE AFTER THESE
                  </span>
                ) : null
              }
            />
          </div>

          <div className="min-w-0 overflow-x-auto">
            <table className="cockpit-table">
              <thead>
                <tr>
                  <th>Do</th>
                  <th className="w-[44%]">What</th>
                  <th>Why</th>
                  <th>At stake</th>
                  <th className="text-end">Urgency</th>
                </tr>
              </thead>
              <tbody>
                {cadence.next.map((item) => (
                  <tr key={item.id}>
                    <td><Tag tone={ACTION_TONE[item.action]}>{item.action}</Tag></td>
                    <td className="whitespace-normal">
                      <Link href={item.href} className="font-cond text-[15px] text-neutral-900 hover:text-accent">
                        {item.title}
                      </Link>
                    </td>
                    <td className="text-[11px] text-neutral-500">{item.because}</td>
                    <td className="text-neutral-500">
                      <Num>{item.moneyAtStakeCents === null ? '—' : fmtMoney(item.moneyAtStakeCents)}</Num>
                    </td>
                    <td className="text-end">
                      <UrgencyBar score={item.urgency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SourceLine sources={cadence.sources} />
        </HudCard>
      ) : (
        <HudCard>
          <SourceLine sources={cadence.sources} />
        </HudCard>
      )}
    </div>
  );
}

/** The top of the queue gets a full row: verb, instruction, reason, stakes. */
function NowRow({ item, position }: { item: CadenceItem; position: number }) {
  return (
    <li className="border-t border-divider px-[18px] py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 font-cond text-[22px] leading-none text-accent-700">
            <Num>{String(position).padStart(2, '0')}</Num>
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone={ACTION_TONE[item.action]}>{item.action}</Tag>
              <Link href={item.href} className="font-cond text-[19px] text-neutral-900 hover:text-accent">
                {item.title}
              </Link>
            </div>
            <p className="mt-1 font-semi text-[11px] text-neutral-500">
              {item.because}
              {item.deptCode ? <> · {item.deptCode}</> : null}
              {item.delegable ? <> · CAN BE HANDED OFF</> : null}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {item.moneyAtStakeCents !== null ? (
            <div className="text-end">
              <span className="hud-label text-[9px]">AT STAKE</span>
              <p className="font-cond text-[19px] leading-none text-neutral-800">
                <Num>{fmtMoney(item.moneyAtStakeCents)}</Num>
              </p>
            </div>
          ) : null}
          <UrgencyBar score={item.urgency} />
        </div>
      </div>
    </li>
  );
}

function UrgencyBar({ score }: { score: number }) {
  const tone = score >= 75 ? 'bg-sev-critical' : score >= 50 ? 'bg-sev-warning' : 'bg-accent-500';
  return (
    <span className="inline-flex items-center gap-2" title={`Urgency ${score}/100`}>
      <span className="inline-block h-[6px] w-[54px] bg-neutral-200">
        <span className={`block h-full ${tone}`} style={{ width: `${Math.max(4, score)}%` }} />
      </span>
      <span className="font-cond text-[12px] text-neutral-500">
        <Num>{score}</Num>
      </span>
    </span>
  );
}

/** What the queue was built from — an empty list means nothing, without this. */
function SourceLine({ sources }: { sources: { name: string; ok: boolean; count: number }[] }) {
  return (
    <div className="border-t border-divider px-[18px] py-2 font-semi text-[10px] tracking-[0.12em] text-neutral-500">
      BUILT FROM{' '}
      {sources.map((s, i) => (
        <span key={s.name} className={s.ok ? '' : 'text-sev-warning'}>
          {i > 0 ? ' · ' : ''}
          {s.name.toUpperCase()} <Num>{s.ok ? s.count : 'UNREACHABLE'}</Num>
        </span>
      ))}
    </div>
  );
}

function Skeleton({ title, index }: { title: string; index: string }) {
  return (
    <HudCard>
      <HudCardHeader title={title} index={index} />
      <div className="h-16 animate-pulse bg-neutral-200/40" />
    </HudCard>
  );
}
