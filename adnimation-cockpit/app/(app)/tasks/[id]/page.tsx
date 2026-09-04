import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSubtasks, getTask, listDepartments, listPeople } from '@/lib/tasks/queries';
import { listComments, isZombie } from '@/lib/tasks/mutations';
import { daysOverdue } from '@/lib/scoring/heat-score';
import { fmtDateTime, fmtMoney } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { HeatBar, OverdueChip, PriorityBadge, StatusBadge, TaskTitleLink } from '@/components/task-bits';
import { CommentForm } from '@/components/tasks/comment-form';
import { EditTaskForm } from '@/components/tasks/edit-task-form';
import { ClickUpStatus } from '@/components/tasks/clickup-status';
import { Attachments } from '@/components/attachments';
import { NewTaskForm } from '@/components/tasks/new-task-form';
import { DelegateButton } from '@/components/tasks/delegate-button';

export const dynamic = 'force-dynamic';

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await getTask(id);
  if (!task) notFound();

  const [subtasks, comments, departments, people] = await Promise.all([
    getSubtasks(id),
    listComments(id),
    listDepartments(),
    listPeople(),
  ]);

  const isMirror = task.layer === 'company';
  const peopleOptions = people.map((p) => ({ id: p.id, label: p.name }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link href="/tasks" className="text-2xs text-muted-foreground hover:underline">
            ← ALL TASKS
          </Link>
          <h1 className="mt-0.5 text-base font-semibold">{task.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <PriorityBadge priority={task.priority} />
            <StatusBadge status={task.status} />
            {isMirror ? <Tag tone="outline">CLICKUP — READ ONLY</Tag> : null}
            {isZombie(task.snoozeCount) ? (
              <Tag tone="watch" title={`Snoozed ${task.snoozeCount} times`}>Zombie</Tag>
            ) : null}
            <OverdueChip days={daysOverdue(task.dueDate, new Date())} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HeatBar score={task.heatScore} />
          {!isMirror ? (
            <DelegateButton
              sourceEntityId={task.id}
              defaultTitle={task.title}
              defaultPriority={task.priority}
              defaultDueDate={task.dueDate}
              people={peopleOptions}
            />
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <HudCard>
            <div className="flex items-baseline justify-between gap-3">
              <HudCardHeader title={isMirror ? 'Details' : 'Edit'} index="T04" />
              {task.clickupUrl ? (
                <a href={task.clickupUrl} target="_blank" rel="noreferrer" className="text-2xs hover:underline">
                  OPEN IN CLICKUP ↗
                </a>
              ) : null}
            </div>
            <div>
              {isMirror ? (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                  <span className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
                    Status comes from this task&apos;s own ClickUp list
                  </span>
                  <ClickUpStatus taskId={task.id} status={task.status} />
                </div>
              ) : null}

              {/* The files the team hung on it in ClickUp, openable here. */}
              {isMirror ? (
                <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-line pb-2">
                  <Attachments kind="task" id={task.id} label="ATTACHED FILES" />
                </div>
              ) : null}

              <EditTaskForm
                mode={isMirror ? 'clickup' : 'mine'}
                task={{
                  id: task.id,
                  title: task.title,
                  description: task.description,
                  priority: task.priority,
                  status: task.status,
                  dueDate: task.dueDate,
                  startDate: task.startDate,
                  recurrenceRule: task.recurrenceRule,
                  deptId: task.deptId,
                  ownerPersonId: task.ownerPersonId,
                  tags: task.tags,
                  moneyImpactCents: task.moneyImpactCents,
                }}
                departments={departments.map((d) => ({ id: d.id, label: d.nameHe }))}
                people={peopleOptions}
              />
            </div>
          </HudCard>

          <HudCard>
            <div className="flex items-baseline justify-between gap-3">
              <HudCardHeader title="Subtasks" index="T05" />
              <Num className="text-2xs text-muted-foreground">{subtasks.length}</Num>
            </div>
            <div className="space-y-2">
              {subtasks.length === 0 ? (
                <p className="text-2xs text-muted-foreground">No subtasks.</p>
              ) : (
                <ul className="space-y-1">
                  {subtasks.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                      <TaskTitleLink id={s.id} title={s.title} />
                      <StatusBadge status={s.status} />
                    </li>
                  ))}
                </ul>
              )}
              {!isMirror ? (
                <div className="border-t pt-2">
                  <NewTaskForm
                    departments={departments.map((d) => ({ id: d.id, label: d.nameHe }))}
                    people={peopleOptions}
                    parentId={task.id}
                  />
                </div>
              ) : null}
            </div>
          </HudCard>
        </div>

        <div className="space-y-3">
          <HudCard>
            <div className="flex items-baseline justify-between gap-3">
              <HudCardHeader title="Metadata" index="T06" />
            </div>
            <div>
              <dl className="space-y-1.5 text-xs">
                <Field label="Department" value={task.deptNameHe ?? '—'} />
                <Field label="Owner" value={task.ownerName ?? 'Unowned'} />
                <Field label="Money impact" value={fmtMoney(task.moneyImpactCents)} ltr />
                <Field label="Source" value={task.source} ltr />
                <Field label="Snoozed" value={`${task.snoozeCount} times`} />
                <Field label="Created" value={fmtDateTime(task.createdAt)} ltr />
                <Field label="Updated" value={fmtDateTime(task.updatedAt)} ltr />
              </dl>
            </div>
          </HudCard>

          <HudCard>
            <div className="flex items-baseline justify-between gap-3">
              <HudCardHeader title="Comments" index="T07" />
            </div>
            <div className="space-y-2">
              {comments.length === 0 ? (
                <p className="text-2xs text-muted-foreground">No comments.</p>
              ) : (
                <ul className="space-y-2">
                  {comments.map((c) => (
                    <li key={c.id} className="rounded border p-1.5">
                      <p className="text-xs">{c.body}</p>
                      <p className="mt-0.5 text-2xs text-muted-foreground">
                        {c.author} · <Num>{fmtDateTime(c.createdAt)}</Num>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <CommentForm taskId={task.id} />
            </div>
          </HudCard>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      <dd className="text-xs">{ltr ? <Num>{value}</Num> : value}</dd>
    </div>
  );
}
