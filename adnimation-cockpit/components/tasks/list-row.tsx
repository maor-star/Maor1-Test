'use client';

import { useState } from 'react';
import type { TaskRow } from '@/lib/tasks/queries';
import { daysOverdue } from '@/lib/scoring/heat-score';
import { isZombie } from '@/lib/tasks/types';
import { fmtDate, fmtMoney } from '@/lib/utils';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { Button } from '@/components/ui/button';
import { HeatBar, OverdueChip, PriorityBadge, StatusBadge, TaskTitleLink } from '@/components/task-bits';
import { QuickTaskActions } from '@/components/quick-task-actions';
import { ClickUpStatus } from '@/components/tasks/clickup-status';
import { DelegateButton } from '@/components/tasks/delegate-button';
import { EditTaskForm } from '@/components/tasks/edit-task-form';

/**
 * One row of the list, and the whole task underneath it.
 *
 * Opening a task to change its due date meant losing the list he was working
 * through and coming back to the top of it. So the row opens in place: the
 * same editor as the task page, the same write path — a mirrored task still
 * goes to ClickUp first — but without leaving the screen or the scroll
 * position.
 */
export function TaskListRow({
  task,
  people,
  departments,
  now,
  columns,
}: {
  task: TaskRow;
  people: { id: string; label: string }[];
  departments: { id: string; label: string }[];
  now: Date;
  /** How wide the editor's row has to span to sit under the table. */
  columns: number;
}) {
  const [editing, setEditing] = useState(false);
  const t = task;
  const late = daysOverdue(t.dueDate, now);
  const mirrored = t.layer === 'company';

  return (
    <>
      <tr className={editing ? 'bg-accent/5' : undefined}>
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
          <Num className="text-2xs text-neutral-500">{fmtDate(t.createdAt)}</Num>
        </td>
        <td>
          <Num className="text-neutral-500">{fmtMoney(t.moneyImpactCents)}</Num>
        </td>
        <td><HeatBar score={t.heatScore} /></td>
        <td className="text-left">
          <div className="flex flex-wrap items-center justify-end gap-1">
            {/* A mirrored task is closed in ClickUp, not here — see
                app/actions/clickup-tasks.ts for why the write goes there
                first. */}
            {t.clickupUrl ? <ClickUpStatus taskId={t.id} status={t.status} compact /> : null}
            <QuickTaskActions taskId={t.id} isMine={!mirrored} status={t.status} />
            <Button
              type="button"
              size="xs"
              variant={editing ? 'default' : 'ghost'}
              onClick={() => setEditing((v) => !v)}
              title="Edit it here, without leaving the list"
            >
              {editing ? 'CLOSE' : 'EDIT'}
            </Button>
            {!mirrored ? (
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

      {editing ? (
        <tr className="bg-accent/5">
          <td colSpan={columns} className="px-3 pb-4 pt-1">
            <EditTaskForm
              mode={mirrored ? 'clickup' : 'mine'}
              task={{
                id: t.id,
                title: t.title,
                description: t.description,
                priority: t.priority,
                status: t.status,
                dueDate: t.dueDate,
                deptId: t.deptId,
                ownerPersonId: t.ownerPersonId,
                tags: t.tags,
                moneyImpactCents: t.moneyImpactCents,
              }}
              departments={departments}
              people={people}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}
