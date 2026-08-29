import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSubtasks, getTask, listDepartments, listPeople } from '@/lib/tasks/queries';
import { listComments, isZombie } from '@/lib/tasks/mutations';
import { daysOverdue } from '@/lib/scoring/heat-score';
import { fmtDateTime, fmtMoney } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Num } from '@/components/num';
import { HeatBar, OverdueChip, PriorityBadge, StatusBadge, TaskTitleLink } from '@/components/task-bits';
import { CommentForm } from '@/components/tasks/comment-form';
import { EditTaskForm } from '@/components/tasks/edit-task-form';
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
            ← כל המשימות
          </Link>
          <h1 className="mt-0.5 text-base font-semibold">{task.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <PriorityBadge priority={task.priority} />
            <StatusBadge status={task.status} />
            {isMirror ? <Badge variant="outline">ClickUp — קריאה בלבד</Badge> : null}
            {isZombie(task.snoozeCount) ? (
              <Badge variant="watch" title={`נדחתה ${task.snoozeCount} פעמים`}>Zombie</Badge>
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
          <Card>
            <CardHeader>
              <CardTitle>{isMirror ? 'פרטים' : 'עריכה'}</CardTitle>
              {task.clickupUrl ? (
                <a href={task.clickupUrl} target="_blank" rel="noreferrer" className="text-2xs hover:underline">
                  פתיחה ב-ClickUp ↗
                </a>
              ) : null}
            </CardHeader>
            <CardContent>
              {isMirror ? (
                <dl className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
                  <Field label="תיאור" value={task.description ?? '—'} />
                  <Field label="מחלקה" value={task.deptNameHe ?? '—'} />
                  <Field label="בעלים" value={task.ownerName ?? '—'} />
                  <Field label="תאריך יעד" value={task.dueDate ?? '—'} ltr />
                </dl>
              ) : (
                <EditTaskForm
                  task={{
                    id: task.id,
                    title: task.title,
                    description: task.description,
                    priority: task.priority,
                    status: task.status,
                    dueDate: task.dueDate,
                    deptId: null,
                    ownerPersonId: null,
                    tags: task.tags,
                    moneyImpactCents: task.moneyImpactCents,
                  }}
                  departments={departments.map((d) => ({ id: d.id, label: d.nameHe }))}
                  people={peopleOptions}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>תת־משימות</CardTitle>
              <Num className="text-2xs text-muted-foreground">{subtasks.length}</Num>
            </CardHeader>
            <CardContent className="space-y-2">
              {subtasks.length === 0 ? (
                <p className="text-2xs text-muted-foreground">אין תת־משימות.</p>
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
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>מטא</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-1.5 text-xs">
                <Field label="מחלקה" value={task.deptNameHe ?? '—'} />
                <Field label="בעלים" value={task.ownerName ?? 'ללא בעלים'} />
                <Field label="השפעה כספית" value={fmtMoney(task.moneyImpactCents)} ltr />
                <Field label="מקור" value={task.source} ltr />
                <Field label="נדחתה" value={`${task.snoozeCount} פעמים`} />
                <Field label="נוצרה" value={fmtDateTime(task.createdAt)} ltr />
                <Field label="עודכנה" value={fmtDateTime(task.updatedAt)} ltr />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>הערות</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {comments.length === 0 ? (
                <p className="text-2xs text-muted-foreground">אין הערות.</p>
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
            </CardContent>
          </Card>
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
