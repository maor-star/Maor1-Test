import { daysStuck, listOpenDelegations } from '@/lib/delegation/service';
import { DELEGATION_STALE_DAYS } from '@/lib/tasks/types';
import { fmtDateTime } from '@/lib/utils';
import { HudCard } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { CheckReplies } from '@/components/delegations/check-replies';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  sent: 'SENT',
  acknowledged: 'ACKNOWLEDGED',
  in_progress: 'IN PROGRESS',
  stale: 'STUCK',
  done: 'DONE',
};

/**
 * Spec 6.4 — Delegation Tracker. What I gave, to whom, when, and how long it
 * has sat. This is the screen that stops handed-off work from falling.
 */
export default async function DelegationsPage() {
  const rows = await listOpenDelegations();
  const now = new Date();
  const stuck = rows.filter((r) => r.status === 'stale').length;
  const answered = rows.filter((r) => r.replyAt !== null).length;
  const waiting = rows.length - answered;

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="DELEGATIONS / 04"
        title="Delegation tracker"
        action={
          <span>
            STUCK AFTER <Num>{DELEGATION_STALE_DAYS}</Num> QUIET DAYS
          </span>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semi text-[11px] tracking-[0.12em] text-neutral-500">
          <Num>{answered}</Num> ANSWERED · <Num>{waiting}</Num> STILL WAITING · SLACK THREADS AND
          EMAIL ARE READ FOR THE ANSWER
        </p>
        <CheckReplies />
      </div>

      {stuck > 0 ? (
        <div className="border border-sev-warning/40 bg-sev-warning/10 px-4 py-2 font-semi text-[12px] tracking-[0.08em] text-sev-warning">
          <Num>{stuck}</Num> stuck delegations need follow-up.
        </div>
      ) : null}

      {rows.length === 0 ? (
        <HudCard>
          <p className="font-semi text-[12px] text-neutral-500">No open delegations.</p>
        </HudCard>
      ) : (
        <HudCard className="p-0">
          <div className="min-w-0 overflow-x-auto">
          <table className="cockpit-table">
            <thead>
              <tr>
                <th className="w-[30%]">What</th>
                <th>Who</th>
                <th>Status</th>
                <th>Days quiet</th>
                <th>Due</th>
                <th>Delegated</th>
                <th className="w-[22%]">Answer</th>
                <th className="text-end">Links</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const stuckDays = daysStuck(d.lastMovementAt, now);
                return (
                  <tr key={d.id}>
                    <td className="whitespace-normal font-cond text-[17px] text-neutral-900">{d.taskTitle ?? d.note ?? '—'}</td>
                    <td className="text-neutral-500">{d.personName}</td>
                    <td>
                      <Tag tone={d.status === 'stale' ? 'warning' : 'outline'}>
                        {STATUS_LABEL[d.status] ?? d.status}
                      </Tag>
                    </td>
                    <td>
                      <Num className={`font-cond text-[17px] ${stuckDays >= DELEGATION_STALE_DAYS ? 'text-sev-warning' : 'text-neutral-900'}`}>
                        {stuckDays}
                      </Num>
                    </td>
                    <td><Num className="text-neutral-500">{d.dueDate ?? '—'}</Num></td>
                    <td><Num className="text-neutral-500">{fmtDateTime(d.delegatedAt)}</Num></td>
                    <td className="whitespace-normal">
                      {d.replyAt ? (
                        <>
                          <span className="flex flex-wrap items-center gap-2">
                            <Tag tone="ok">{d.replyChannel === 'email' ? 'EMAIL' : 'SLACK'}</Tag>
                            <Num className="font-semi text-[10px] tracking-[0.1em] text-neutral-500">
                              {fmtDateTime(d.replyAt)}
                            </Num>
                          </span>
                          <span className="mt-1 block text-[12px] text-neutral-600">
                            {d.replyExcerpt ? (
                              d.replyUrl ? (
                                <a
                                  href={d.replyUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hover:text-accent"
                                >
                                  {d.replyExcerpt.slice(0, 140)}
                                </a>
                              ) : (
                                d.replyExcerpt.slice(0, 140)
                              )
                            ) : null}
                          </span>
                        </>
                      ) : (
                        <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                          {d.repliesCheckedAt ? (
                            <>
                              NO ANSWER · CHECKED <Num>{fmtDateTime(d.repliesCheckedAt)}</Num>
                            </>
                          ) : (
                            'NOT CHECKED YET'
                          )}
                        </span>
                      )}
                    </td>
                    <td className="text-end">
                      <span className="flex justify-end gap-3 font-semi text-[11px] tracking-[0.12em]">
                        {d.slackMessageUrl ? (
                          <a href={d.slackMessageUrl} target="_blank" rel="noreferrer" className="text-accent-700 hover:text-accent">
                            Slack ↗
                          </a>
                        ) : (
                          <span className="text-destructive" title="Message was not delivered">Slack ✕</span>
                        )}
                        {d.clickupTaskId ? (
                          <a
                            href={`https://app.clickup.com/t/${d.clickupTaskId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent-700 hover:text-accent"
                          >
                            ClickUp ↗
                          </a>
                        ) : (
                          <span className="text-destructive" title="Task was not created">ClickUp ✕</span>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </HudCard>
      )}
    </div>
  );
}
