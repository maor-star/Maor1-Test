import { Suspense } from 'react';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db, integrationHealth } from '@/lib/db';
import { burningToday } from '@/lib/tasks/queries';
import { listOpenDelegations, daysStuck } from '@/lib/delegation/service';
import { daysOverdue } from '@/lib/scoring/heat-score';
import { todayInTz, relativeDays } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Num } from '@/components/num';
import { StaleStamp } from '@/components/stale-stamp';
import { HeatBar, OverdueChip, PriorityBadge, TaskTitleLink } from '@/components/task-bits';
import { QuickTaskActions } from '@/components/quick-task-actions';

export const dynamic = 'force-dynamic';

/**
 * Spec §5 — the whole point of the system: one screen, six strips, answering
 * "what did we earn, what is burning, what is about to fall over, what is
 * waiting on me".
 *
 * Milestone 1 ships strips 2 and 6 live against real data. The rest are marked
 * as arriving with their milestone rather than faked with sample numbers — a
 * plausible-looking fake figure on a CEO dashboard is worse than an empty slot.
 */
export default function CockpitPage() {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-base font-semibold">Cockpit</h1>
        <span className="text-2xs text-muted-foreground">
          <Num>{todayInTz()}</Num>
        </span>
      </div>

      <PendingStrip />

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<StripSkeleton title="מה בוער היום" />}>
            <BurningStrip />
          </Suspense>
        </div>
        <div className="space-y-3">
          <Suspense fallback={<StripSkeleton title="ממתין לי" />}>
            <WaitingOnMeStrip />
          </Suspense>
          <RiskRadarStrip />
        </div>
      </div>
    </div>
  );
}

/** Strip 1 — revenue. Lands with milestone 2. */
function PendingStrip() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>הכנסות אתמול</CardTitle>
        <Badge variant="outline">מגיע ב-Milestone 2</Badge>
      </CardHeader>
      <CardContent className="text-2xs text-muted-foreground">
        רצועת ההכנסות תתחבר למקור הדיווח (שאלה פתוחה 21.1) ותציג Net מול Gross, שבע כרטיסיות
        מחלקה ממוינות, ו-sparkline ל-30 יום.
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>מה בוער היום</CardTitle>
        <StaleStamp at={health?.lastSuccessAt ?? null} />
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-3 pb-3 text-2xs text-muted-foreground">
            אין משימות P0/P1 שפג תוקפן. מסך ריק זה מצב תקין.
          </p>
        ) : (
          <table className="cockpit-table">
            <thead>
              <tr>
                <th className="w-[38%]">משימה</th>
                <th>עדיפות</th>
                <th>מחלקה</th>
                <th>בעלים</th>
                <th>איחור</th>
                <th>Heat</th>
                <th className="text-left">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>
                    <TaskTitleLink id={t.id} title={t.title} clickupUrl={t.clickupUrl} />
                  </td>
                  <td><PriorityBadge priority={t.priority} /></td>
                  <td className="text-2xs text-muted-foreground">{t.deptNameHe ?? '—'}</td>
                  <td className="text-2xs text-muted-foreground">{t.ownerName ?? 'ללא בעלים'}</td>
                  <td><OverdueChip days={daysOverdue(t.dueDate, new Date())} /></td>
                  <td><HeatBar score={t.heatScore} /></td>
                  <td className="text-left">
                    <QuickTaskActions taskId={t.id} isMine={t.layer === 'mine'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {backlogCount > 0 ? (
          <div className="border-t px-3 py-1.5 text-2xs text-muted-foreground">
            עוד <Num>{backlogCount}</Num> משימות ברקע ·{' '}
            <Link href="/tasks" className="hover:underline">לכל המשימות</Link>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Strip 6 — waiting on me: what I handed off that has not moved. Live. */
async function WaitingOnMeStrip() {
  const delegations = await listOpenDelegations();
  const stuck = delegations.filter((d) => d.status === 'stale');

  return (
    <Card>
      <CardHeader>
        <CardTitle>האצלות פתוחות</CardTitle>
        {stuck.length > 0 ? (
          <Badge variant="warning">
            <Num>{stuck.length}</Num>
            <span className="ms-1">תקועות</span>
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {delegations.length === 0 ? (
          <p className="px-3 pb-3 text-2xs text-muted-foreground">אין האצלות פתוחות.</p>
        ) : (
          <ul className="divide-y">
            {delegations.slice(0, 6).map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{d.taskTitle ?? d.note ?? 'האצלה'}</p>
                  <p className="text-2xs text-muted-foreground">
                    {d.personName} · {relativeDays(daysStuck(d.lastMovementAt))}
                  </p>
                </div>
                {d.status === 'stale' ? <Badge variant="warning">תקוע</Badge> : null}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-3 py-1.5 text-2xs">
          <Link href="/delegations" className="text-muted-foreground hover:underline">
            Delegation Tracker
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/** Strip 3 — Risk Radar. Lands with milestone 3. */
function RiskRadarStrip() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Risk Radar</CardTitle>
        <Badge variant="outline">מגיע ב-Milestone 3</Badge>
      </CardHeader>
      <CardContent className="text-2xs text-muted-foreground">
        מטריצת דימנד / סאפליי / חוזים / אתרים עם ספירה בשלוש רמות חומרה.
      </CardContent>
    </Card>
  );
}

function StripSkeleton({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-16 animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}
