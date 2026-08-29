import Link from 'next/link';
import type { TaskRow } from '@/lib/tasks/queries';
import { daysOverdue } from '@/lib/scoring/heat-score';
import { isZombie } from '@/lib/tasks/mutations';
import { fmtMoney } from '@/lib/utils';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { HeatBar, OverdueChip, PriorityBadge, StatusBadge, TaskTitleLink } from '@/components/task-bits';
import { QuickTaskActions } from '@/components/quick-task-actions';
import { DelegateButton } from '@/components/tasks/delegate-button';

/** Spec 6.4 — the list view, sorted by heat. Every row carries its actions. */
export function TaskListView({
  rows,
  people,
}: {
  rows: TaskRow[];
  people: { id: string; label: string }[];
}) {
  if (rows.length === 0) {
    return (
      <div className="hud-card hud-marks p-6 text-center font-semi text-[12px] text-neutral-500">
        No tasks match this filter.
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="hud-card hud-marks overflow-x-auto">
      <table className="cockpit-table">
        <thead>
          <tr>
            <th className="w-[30%]">Task</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Department</th>
            <th>Owner</th>
            <th>Due</th>
            <th>Impact</th>
            <th>Heat</th>
            <th className="text-end">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const late = daysOverdue(t.dueDate, now);
            return (
              <tr key={t.id}>
                <td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <TaskTitleLink id={t.id} title={t.title} clickupUrl={t.clickupUrl} />
                    {isZombie(t.snoozeCount) ? (
                      <Tag tone="watch" title={`Snoozed ${t.snoozeCount} times`}>Zombie</Tag>
                    ) : null}
                    {t.tags.map((tag) => (
                      <Tag key={tag} tone="outline">{tag}</Tag>
                    ))}
                  </div>
                </td>
                <td><PriorityBadge priority={t.priority} /></td>
                <td><StatusBadge status={t.status} /></td>
                <td className="text-neutral-500">{t.deptNameHe ?? '—'}</td>
                <td className="text-neutral-500">{t.ownerName ?? 'Unowned'}</td>
                <td>
                  {t.dueDate ? (
                    <span className="flex items-center gap-1">
                      <Num className="text-2xs">{t.dueDate}</Num>
                      <OverdueChip days={late} />
                    </span>
                  ) : (
                    <span className="text-neutral-500">—</span>
                  )}
                </td>
                <td>
                  <Num className="text-neutral-500">{fmtMoney(t.moneyImpactCents)}</Num>
                </td>
                <td><HeatBar score={t.heatScore} /></td>
                <td className="text-left">
                  <div className="flex items-center justify-end gap-1">
                    <QuickTaskActions taskId={t.id} isMine={t.layer === 'mine'} />
                    {t.layer === 'mine' ? (
                      <DelegateButton
                        sourceEntityId={t.id}
                        defaultTitle={t.title}
                        defaultPriority={t.priority}
                        defaultDueDate={t.dueDate}
                        people={people}
                      />
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-divider px-3 py-2 font-semi text-[11px] tracking-[0.1em] text-neutral-500">
        <Num>{rows.length}</Num> TASKS ·{' '}
        <Link href="/delegations" className="text-accent-700 hover:text-accent">Delegation Tracker</Link>
      </div>
    </div>
  );
}
