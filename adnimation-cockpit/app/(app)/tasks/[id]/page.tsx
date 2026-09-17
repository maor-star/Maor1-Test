import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSubtasks, getTask, listDepartments } from '@/lib/tasks/queries';
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
import { NudgeButton } from '@/components/tasks/nudge-button';
import { assigneesOf, chipsFor } from '@/lib/tasks/assignees';
import { lastNudges } from '@/lib/tasks/nudge';
import { peopleByUse } from '@/lib/tasks/people-order';
import { Attachments } from '@/components/attachments';
import { NewTaskForm } from '@/components/tasks/new-task-form';
import { DelegateButton } from '@/components/tasks/delegate-button';
import { requireUser } from '@/lib/auth/session';
import { canSeePrivate } from '@/lib/tasks/access';

export const dynamic = 'force-dynamic';

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireUser();
  const mine = canSeePrivate(viewer);

  /*
   * A private task 404s for everybody but him — the same answer a task that
   * does not exist gets, so this page is not a way to learn that one exists.
   */
  const task = await getTask(id, mine);
  if (!task) notFound();

  const [subtasks, comments, departments, ranked, assigned, nudged] = await Promise.all([
    getSubtasks(id, mine),
    listComments(id),
    listDepartments(),
    // Ordered by who he actually hands work to, not by the alphabet.
    peopleByUse(),
    assigneesOf(id),
    lastNudges([id]),
  ]);

  // A mirrored task has an owner and no picked assignees, so an empty list
  // means the lead alone — the same rule the board's rows use.
  const onIt = chipsFor(task, assigned);
  const isMirror = task.layer === 'company';
  /*
   * Every picker on this page takes the ranked list, not the alphabet — the
   * order he reaches for people in does not change because he opened a task
   * instead of the board.
   */
  const peopleOptions = ranked;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link href="/tasks" className="text-2xs text-muted-foreground hover:underline">
            ← ALL TASKS
          </Link>
          <h1 className="mt-0.5 text-base font-semibold">{task.title}</h1>
          {/* The same one button as on the board: a Slack DM to each person on
              it, in his name, asking what is happening. */}
          <div className="mt-1.5">
            <NudgeButton
              taskId={task.id}
              people={onIt}
              lastAsked={nudged.get(task.id)?.sentAt ?? null}
              timesAsked={nudged.get(task.id)?.times ?? 0}
            />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <PriorityBadge priority={task.priority} />
            <StatusBadge status={task.status} />
            {isMirror ? <Tag tone="outline">MIRRORED FROM CLICKUP</Tag> : null}
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
                  nextStep: task.nextStep,
                  nextStepDate: task.nextStepDate,
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
                    people={ranked}
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
                {/* Everyone on it, not only the first — the row on the board
                    says the same thing, and the two must not disagree. */}
                <Field
                  label={onIt.length > 1 ? 'On it' : 'Owner'}
                  value={onIt.length > 0 ? onIt.map((p) => p.name).join(', ') : 'Unowned'}
                />
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
