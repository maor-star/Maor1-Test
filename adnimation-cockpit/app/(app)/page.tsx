import { Suspense } from 'react';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db, integrationHealth } from '@/lib/db';
import { burningToday } from '@/lib/tasks/queries';
import { listOpenDelegations, daysStuck } from '@/lib/delegation/service';
import { daysOverdue } from '@/lib/scoring/heat-score';
import { todayInTz } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { StaleStamp } from '@/components/stale-stamp';
import { HeatBar, OverdueChip, PriorityBadge, TaskTitleLink } from '@/components/task-bits';
import { QuickTaskActions } from '@/components/quick-task-actions';
import { RevenueStrip } from '@/components/revenue/revenue-strip';

export const dynamic = 'force-dynamic';

/**
 * Spec §5 — one screen answering: what did we earn, what is burning, what is
 * about to fall over, what is waiting on me.
 *
 * Strips 1, 2 and 6 run live against real data. The Risk Radar is labelled with
 * the milestone that fills it rather than faked with sample numbers — a
 * plausible-looking fake figure on a CEO dashboard is worse than an empty slot.
 */
export default function CockpitPage() {
  return (
    <div className="space-y-5">
      <PageHeader kicker="DASHBOARD / 01" title="Cockpit" />

      <Suspense fallback={<StripSkeleton title="Revenue" index="R01" />}>
        <RevenueStrip />
      </Suspense>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Suspense fallback={<StripSkeleton title="Burning today" index="T01" />}>
            <BurningStrip />
          </Suspense>
        </div>
        <div className="space-y-5">
          <Suspense fallback={<StripSkeleton title="Delegations" index="D01" />}>
            <WaitingOnMeStrip />
          </Suspense>
          <RiskRadarStrip />
        </div>
      </div>
    </div>
  );
}

/** Strip 2 — what is burning today (spec §5). Live. */
async function BurningStrip() {
  const today = todayInTz();
  const { rows, backlogCount } = await burningToday(today);
  const [health] = await db
    .select()
    .from(integrationHealth)
    .where(eq(integrationHealth.system, 'clickup'))
    .limit(1);

  return (
    <HudCard className="gap-0 p-0">
      <div className="flex items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader title="Burning today" index="T01" />
        <StaleStamp at={health?.lastSuccessAt ?? null} />
      </div>

      {rows.length === 0 ? (
        <p className="px-[18px] pb-[18px] font-semi text-[12px] text-neutral-500">
          No P0/P1 tasks past due. An empty screen here is a healthy state.
        </p>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="cockpit-table">
            <thead>
              <tr>
                <th className="w-[42%]">Task</th>
                <th>Priority</th>
                <th>Owner</th>
                <th>Overdue</th>
                <th>Heat</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-normal">
                    <TaskTitleLink id={t.id} title={t.title} clickupUrl={t.clickupUrl} />
                    <p className="hud-label mt-0.5 text-[9px]">{t.deptNameHe ?? 'NO DEPARTMENT'}</p>
                  </td>
                  <td><PriorityBadge priority={t.priority} /></td>
                  <td className="text-[12px] text-neutral-500">{t.ownerName ?? 'Unowned'}</td>
                  <td><OverdueChip days={daysOverdue(t.dueDate, new Date())} /></td>
                  <td><HeatBar score={t.heatScore} /></td>
                  <td className="text-end">
                    <QuickTaskActions taskId={t.id} isMine={t.layer === 'mine'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {backlogCount > 0 ? (
        <div className="border-t border-divider px-[18px] py-2 font-semi text-[11px] tracking-[0.1em] text-neutral-500">
          <Num>{backlogCount}</Num> MORE IN THE BACKLOG ·{' '}
          <Link href="/tasks" className="text-accent-700 hover:text-accent">
            ALL TASKS
          </Link>
        </div>
      ) : null}
    </HudCard>
  );
}

/** Strip 6 — waiting on me: what I handed off that has not moved. Live. */
async function WaitingOnMeStrip() {
  const delegations = await listOpenDelegations();
  const stuck = delegations.filter((d) => d.status === 'stale');

  return (
    <HudCard className="gap-0 p-0">
      <div className="flex items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader
          title="Waiting on others"
          index="D01"
          action={
            stuck.length > 0 ? (
              <Tag tone="warning">
                <Num>{stuck.length}</Num>
                <span className="ms-1">STUCK</span>
              </Tag>
            ) : null
          }
        />
      </div>

      {delegations.length === 0 ? (
        <p className="px-[18px] pb-[18px] font-semi text-[12px] text-neutral-500">
          No open delegations.
        </p>
      ) : (
        <ul>
          {delegations.slice(0, 6).map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 border-t border-ink/[0.09] px-[18px] py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-cond text-[15px] text-neutral-800">
                  {d.taskTitle ?? d.note ?? 'Delegation'}
                </p>
                <p className="font-semi text-[11px] tracking-[0.1em] text-neutral-500">
                  {d.personName} · <Num>{daysStuck(d.lastMovementAt)}</Num> DAYS QUIET
                </p>
              </div>
              {d.status === 'stale' ? <Tag tone="warning">STUCK</Tag> : null}
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-divider px-[18px] py-2">
        <Link
          href="/delegations"
          className="font-semi text-[11px] tracking-[0.16em] text-accent-700 hover:text-accent"
        >
          DELEGATION TRACKER
        </Link>
      </div>
    </HudCard>
  );
}

/** Strip 3 — Risk Radar. Lands with milestone 3. */
function RiskRadarStrip() {
  return (
    <HudCard>
      <HudCardHeader
        title="Risk radar"
        index="R02"
        action={<Tag tone="outline">MILESTONE 3</Tag>}
      />
      <p className="font-semi text-[12px] leading-relaxed text-neutral-500">
        Demand · Supply · Contracts · Sites, each counted at three severities.
        Ships once partner health scoring lands.
      </p>
    </HudCard>
  );
}

function StripSkeleton({ title, index }: { title: string; index: string }) {
  return (
    <HudCard>
      <HudCardHeader title={title} index={index} />
      <div className="h-16 animate-pulse bg-neutral-200/40" />
    </HudCard>
  );
}
