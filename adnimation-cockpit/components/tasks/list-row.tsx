'use client';

import { useState } from 'react';
import type { TaskRow } from '@/lib/tasks/queries';
import { daysOverdue } from '@/lib/scoring/heat-score';
import { isZombie } from '@/lib/tasks/types';
import { fmtDate, fmtMoney } from '@/lib/utils';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { Button } from '@/components/ui/button';
import { Attachments } from '@/components/attachments';
import { HeatBar, OverdueChip, PriorityBadge, StatusBadge, TaskTitleLink } from '@/components/task-bits';
import { QuickTaskActions } from '@/components/quick-task-actions';
import { ClickUpStatus } from '@/components/tasks/clickup-status';
import { DelegateButton } from '@/components/tasks/delegate-button';
import { EditTaskForm } from '@/components/tasks/edit-task-form';

/**
 * One task, in the shape the contracts screen uses: the thing itself and its
 * state on one line, the facts about it on the next, what happens next on the
 * one after, the actions under those, and the whole editor in place when he
 * opens it.
 *
 * It was a ten-column table. Department, owner, due, added, impact and heat
 * were each a column holding one word, and together they pushed the actions
 * off the right of the screen — he could not see the end of his own list.
 * They are facts about the task, not columns to line up, so they read as a
 * line.
 *
 * Opening a task to change its due date used to mean losing the list he was
 * working through and coming back to the top of it. The editor still opens in
 * place: the same one as the task page, the same write path — a mirrored task
 * still goes to ClickUp first — without leaving the screen or the scroll.
 */

/** Whole days since something happened. */
function daysSince(at: Date | null, now: Date): number | null {
  if (!at) return null;
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86_400_000));
}

export function TaskListRow({
  task,
  people,
  departments,
  now,
  search,
}: {
  task: TaskRow;
  people: { id: string; label: string }[];
  departments: { id: string; label: string }[];
  now: Date;
  /** The row's searchable text, folded — the list narrows on it as he types. */
  search?: string;
}) {
  const [editing, setEditing] = useState(false);
  const t = task;
  const late = daysOverdue(t.dueDate, now);
  const mirrored = t.layer === 'company';
  const quiet = daysSince(t.lastTouchAt, now);
  const stepLate = t.nextStepDate !== null && t.nextStepDate < now.toISOString().slice(0, 10);

  return (
    <li
      className={`border-t border-line px-[18px] py-3 ${editing ? 'bg-accent-100/40' : ''}`}
      data-search={search}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <TaskTitleLink id={t.id} title={t.title} clickupUrl={t.clickupUrl} />
            <PriorityBadge priority={t.priority} />
            <StatusBadge status={t.status} />
            {isZombie(t.snoozeCount) ? (
              <Tag tone="watch" title={`Snoozed ${t.snoozeCount} times`}>Zombie</Tag>
            ) : null}
            {t.tags.map((tag) => (
              <Tag key={tag} tone="outline">{tag}</Tag>
            ))}
          </div>

          <p className="mt-1 text-[12.5px] text-muted">
            {t.ownerName ?? 'Unowned'}
            {t.deptNameHe ? ` · ${t.deptNameHe}` : ''}
            {t.dueDate ? ' · due ' : ''}
            {t.dueDate ? <Num>{t.dueDate}</Num> : null}
            {t.dueDate ? <OverdueChip days={late} /> : null}
            {' · added '}
            <Num>{fmtDate(t.createdAt)}</Num>
            {t.moneyImpactCents ? (
              <>
                {' · worth '}
                <Num>{fmtMoney(t.moneyImpactCents)}</Num>
              </>
            ) : null}
          </p>

          {/*
            What he does next, which is a different question from when the whole
            thing is due — and the one he is answering as he reads down the list.
          */}
          <p className="mt-1.5 text-[13.5px] text-neutral-700">
            {t.nextStep ? (
              <>
                <span className="hud-label me-1.5 text-[11.5px]">Next</span>
                {t.nextStep}
                {t.nextStepDate ? (
                  <span className={stepLate ? 'ms-1.5 text-neg' : 'ms-1.5 text-muted'}>
                    <Num>{fmtDate(new Date(`${t.nextStepDate}T00:00:00Z`))}</Num>
                    {stepLate ? ' · due' : ''}
                  </span>
                ) : null}
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-[13.5px] text-muted hover:text-info hover:underline"
              >
                No next move set — say what happens next
              </button>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-start gap-5">
          <div className="text-end">
            <span className="hud-label block text-[11.5px]">Last touch</span>
            <span
              className={`font-mono text-[19px] font-semibold leading-none ${
                quiet === null || quiet >= 14 ? 'text-warn' : 'text-ink'
              }`}
            >
              <Num>{quiet === null ? 'never' : `${quiet}d`}</Num>
            </span>
          </div>

          <div className="text-end">
            <span className="hud-label block text-[11.5px]">Heat</span>
            <div className="mt-[6px] flex justify-end">
              <HeatBar score={t.heatScore} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {/* A mirrored task is closed in ClickUp, not here — see
            app/actions/clickup-tasks.ts for why the write goes there first. */}
        {t.clickupUrl ? <ClickUpStatus taskId={t.id} status={t.status} compact /> : null}
        <QuickTaskActions taskId={t.id} isMine={!mirrored} status={t.status} />
        {/* Only a mirrored task can have files: ClickUp is where the team
            attaches them. */}
        {mirrored ? <Attachments kind="task" id={t.id} /> : null}
        <Button
          type="button"
          size="xs"
          variant={editing ? 'default' : 'ghost'}
          onClick={() => setEditing((v) => !v)}
          title="Edit it here, without leaving the list"
        >
          {editing ? 'Close' : 'Edit everything'}
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

      {editing ? (
        <div className="mt-2 rounded-[12px] border border-line p-3">
          <EditTaskForm
            mode={mirrored ? 'clickup' : 'mine'}
            task={{
              id: t.id,
              title: t.title,
              description: t.description,
              priority: t.priority,
              status: t.status,
              dueDate: t.dueDate,
              startDate: t.startDate,
              nextStep: t.nextStep,
              nextStepDate: t.nextStepDate,
              recurrenceRule: t.recurrenceRule,
              deptId: t.deptId,
              ownerPersonId: t.ownerPersonId,
              tags: t.tags,
              moneyImpactCents: t.moneyImpactCents,
            }}
            departments={departments}
            people={people}
            onDone={() => setEditing(false)}
          />
        </div>
      ) : null}
    </li>
  );
}
