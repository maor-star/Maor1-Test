import Link from 'next/link';
import type { TaskRow } from '@/lib/tasks/queries';
import { daysOverdue } from '@/lib/scoring/heat-score';
import { isZombie } from '@/lib/tasks/mutations';
import { fmtMoney } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
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
      <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
        אין משימות שתואמות את הסינון.
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="cockpit-table">
        <thead>
          <tr>
            <th className="w-[32%]">משימה</th>
            <th>עדיפות</th>
            <th>סטטוס</th>
            <th>מחלקה</th>
            <th>בעלים</th>
            <th>יעד</th>
            <th>השפעה</th>
            <th>Heat</th>
            <th className="text-left">פעולות</th>
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
                      <Badge variant="watch" title={`נדחתה ${t.snoozeCount} פעמים`}>Zombie</Badge>
                    ) : null}
                    {t.tags.map((tag) => (
                      <Badge key={tag} variant="outline">{tag}</Badge>
                    ))}
                  </div>
                </td>
                <td><PriorityBadge priority={t.priority} /></td>
                <td><StatusBadge status={t.status} /></td>
                <td className="text-2xs text-muted-foreground">{t.deptNameHe ?? '—'}</td>
                <td className="text-2xs text-muted-foreground">{t.ownerName ?? 'ללא בעלים'}</td>
                <td>
                  {t.dueDate ? (
                    <span className="flex items-center gap-1">
                      <Num className="text-2xs">{t.dueDate}</Num>
                      <OverdueChip days={late} />
                    </span>
                  ) : (
                    <span className="text-2xs text-muted-foreground">—</span>
                  )}
                </td>
                <td>
                  <Num className="text-2xs text-muted-foreground">{fmtMoney(t.moneyImpactCents)}</Num>
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
      <div className="border-t px-3 py-1.5 text-2xs text-muted-foreground">
        <Num>{rows.length}</Num> משימות ·{' '}
        <Link href="/delegations" className="hover:underline">Delegation Tracker</Link>
      </div>
    </div>
  );
}
