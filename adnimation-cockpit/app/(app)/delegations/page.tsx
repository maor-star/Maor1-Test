import { daysStuck, listOpenDelegations } from '@/lib/delegation/service';
import { DELEGATION_STALE_DAYS } from '@/lib/tasks/types';
import { fmtDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Num } from '@/components/num';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  sent: 'נשלח',
  acknowledged: 'אושר',
  in_progress: 'בעבודה',
  stale: 'תקוע',
  done: 'הושלם',
};

/**
 * Spec 6.4 — Delegation Tracker. What I gave, to whom, when, and how long it
 * has sat. This is the screen that stops handed-off work from falling.
 */
export default async function DelegationsPage() {
  const rows = await listOpenDelegations();
  const now = new Date();
  const stuck = rows.filter((r) => r.status === 'stale').length;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-base font-semibold">Delegation Tracker</h1>
        <p className="text-2xs text-muted-foreground">
          האצלה שלא זזה <Num>{DELEGATION_STALE_DAYS}</Num> ימים מסומנת כתקועה
        </p>
      </div>

      {stuck > 0 ? (
        <div className="rounded-lg border border-sev-warning/40 bg-sev-warning/10 px-3 py-2 text-xs">
          <Num>{stuck}</Num> האצלות תקועות דורשות מעקב.
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          אין האצלות פתוחות.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="cockpit-table">
            <thead>
              <tr>
                <th className="w-[30%]">מה</th>
                <th>למי</th>
                <th>סטטוס</th>
                <th>ימים ללא תזוזה</th>
                <th>יעד</th>
                <th>הואצל</th>
                <th className="text-left">קישורים</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const stuckDays = daysStuck(d.lastMovementAt, now);
                return (
                  <tr key={d.id}>
                    <td className="font-medium">{d.taskTitle ?? d.note ?? '—'}</td>
                    <td className="text-2xs text-muted-foreground">{d.personName}</td>
                    <td>
                      <Badge variant={d.status === 'stale' ? 'warning' : 'outline'}>
                        {STATUS_LABEL[d.status] ?? d.status}
                      </Badge>
                    </td>
                    <td>
                      <Num className={stuckDays >= DELEGATION_STALE_DAYS ? 'text-sev-warning' : ''}>
                        {stuckDays}
                      </Num>
                    </td>
                    <td><Num className="text-2xs">{d.dueDate ?? '—'}</Num></td>
                    <td><Num className="text-2xs text-muted-foreground">{fmtDateTime(d.delegatedAt)}</Num></td>
                    <td className="text-left">
                      <span className="flex justify-end gap-2 text-2xs">
                        {d.slackMessageUrl ? (
                          <a href={d.slackMessageUrl} target="_blank" rel="noreferrer" className="hover:underline">
                            Slack ↗
                          </a>
                        ) : (
                          <span className="text-destructive" title="ההודעה לא נשלחה">Slack ✕</span>
                        )}
                        {d.clickupTaskId ? (
                          <a
                            href={`https://app.clickup.com/t/${d.clickupTaskId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            ClickUp ↗
                          </a>
                        ) : (
                          <span className="text-destructive" title="המשימה לא נוצרה">ClickUp ✕</span>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
