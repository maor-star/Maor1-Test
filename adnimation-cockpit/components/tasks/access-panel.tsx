'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Num } from '@/components/num';
import { fmtDate } from '@/lib/utils';
import { ACCESS_LEVELS, LEVEL_LABEL, type Grant } from '@/lib/tasks/access';
import { grantTaskAccessAction, revokeTaskAccessAction } from '@/app/actions/task-access';
import { inviteToTasksAction, revokeInviteAction } from '@/app/actions/invite';
import type { PendingInvite } from '@/lib/tasks/invite-service';

/**
 * Who he has let into the tasks board — the gear at the top of the screen.
 *
 * Shut by default, because the answer is usually "nobody new since last time"
 * and a permanent list of people takes room from the work. Open, it is the
 * whole answer: who, at what level, who let them in and when.
 *
 * It says out loud what a grant does and does not reach. "Access to tasks"
 * could reasonably be read as access to the cockpit, and somebody handing out
 * permissions should not have to infer the blast radius.
 */
export function TaskAccessPanel({
  grants,
  invites,
  people,
}: {
  grants: Grant[];
  /** Invitations sent and not yet taken up. */
  invites: PendingInvite[];
  people: { id: string; label: string; email: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (
    action: (d: FormData) => Promise<{ ok: boolean; error?: string; link?: string }>,
    data: FormData,
    saying?: string,
  ) => {
    setError(null);
    setSaid(null);
    setFallbackLink(null);
    startTransition(async () => {
      const result = await action(data);
      if (!result.ok) {
        setError(result.error ?? 'That did not work');
        // A mail that did not go out still leaves a working link, and handing
        // it over beats leaving him with an invitation nobody received.
        if (result.link) setFallbackLink(result.link);
        return;
      }
      if (saying) setSaid(saying);
      router.refresh();
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Who can see these tasks — ${grants.length} ${grants.length === 1 ? 'person' : 'people'}`}
        title="Who can see these tasks"
        className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-neutral-100"
      >
        <span aria-hidden className="text-[14px] leading-none">⚙</span>
        <Num>{grants.length}</Num>
      </button>

      {open ? (
        <div className="absolute end-0 z-20 mt-2 w-[min(26rem,calc(100vw-2rem))] rounded-[12px] border border-line bg-card p-4 shadow-lg">
          <p className="hud-label text-[11.5px]">Who can see these tasks</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
            They get this board and nothing else in the cockpit — not the revenue, the contracts,
            the mail or the pipeline. A task you have starred stays yours and never appears for
            them.
          </p>

          {/*
            Inviting is the one that actually gets somebody in.
            Access on its own is half a door: there is no Google sign-in on this
            server, so a person with a grant and no password has no way to
            obtain a session at all. The invitation mails them a one-time link,
            they choose their own password behind it, and that is what they
            sign in with from then on.
          */}
          <form
            className="mt-3 space-y-2 rounded-[10px] border border-accent/40 bg-accent/5 p-2.5"
            action={(data) => run(inviteToTasksAction, data, 'Invitation sent.')}
          >
            <p className="hud-label text-[10.5px] text-accent">Invite by email</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[11rem] flex-1">
                <span className="hud-label block text-[10.5px]">Their email</span>
                <Input
                  name="email"
                  type="email"
                  dir="ltr"
                  placeholder="name@company.com"
                  className="mt-1 h-9 w-full text-[13px]"
                  required
                />
              </label>
              <label className="min-w-[7rem]">
                <span className="hud-label block text-[10.5px]">Their name</span>
                <Input name="name" className="mt-1 h-9 w-full text-[13px]" />
              </label>
              <label>
                <span className="hud-label block text-[10.5px]">Level</span>
                <Select name="level" defaultValue="view" className="mt-1 h-9 text-[13px]">
                  {ACCESS_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {LEVEL_LABEL[l]}
                    </option>
                  ))}
                </Select>
              </label>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? 'SENDING…' : 'SEND INVITE'}
              </Button>
            </div>
            <p className="text-[11.5px] text-muted">
              They get a mail in English with a link, choose their own password, and land on this
              board. To send them a specific task, use the invite button on the task row instead.
            </p>
          </form>

          {said ? <p className="mt-2 text-[12px] text-pos">{said}</p> : null}
          {fallbackLink ? (
            <p className="mt-1 break-all text-[11.5px] text-muted" dir="ltr">
              {fallbackLink}
            </p>
          ) : null}

          {invites.length > 0 ? (
            <ul className="mt-3 border-t border-line pt-2">
              <li className="hud-label pb-1 text-[10.5px]">Waiting to be taken up</li>
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink" dir="ltr">
                      {i.email}
                    </span>
                    <span className="block truncate text-[11px] text-muted">
                      {i.sendError
                        ? `Mail failed: ${i.sendError}`
                        : `Sent · expires ${fmtDate(i.expiresAt)}`}
                      {i.taskTitle ? ` · ${i.taskTitle}` : ''}
                    </span>
                  </span>
                  <form action={(data) => run(revokeInviteAction, data)}>
                    <input type="hidden" name="id" value={i.id} />
                    <Button type="submit" size="xs" variant="ghost" disabled={pending}>
                      Cancel
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="mt-3 hud-label text-[10.5px]">Or give access without a mail</p>

          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            action={(data) => run(grantTaskAccessAction, data)}
          >
            <label className="min-w-[12rem] flex-1">
              <span className="hud-label block text-[11px]">Person</span>
              {people.length > 0 ? (
                <Select name="email" className="mt-1 h-9 w-full text-[13px]" required>
                  <option value="">Pick somebody…</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.email}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input name="email" type="email" placeholder="name@adnimation.com" className="mt-1 h-9 w-full text-[13px]" required />
              )}
            </label>
            <label>
              <span className="hud-label block text-[11px]">Level</span>
              <Select name="level" defaultValue="view" className="mt-1 h-9 text-[13px]">
                {ACCESS_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {LEVEL_LABEL[l]}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {pending ? 'SAVING…' : 'GIVE ACCESS'}
            </Button>
          </form>

          {error ? <p className="mt-2 text-[12px] text-neg">{error}</p> : null}

          <ul className="mt-3 border-t border-line pt-2">
            {grants.length === 0 ? (
              <li className="py-2 text-[13px] text-muted">
                Nobody yet — these tasks are yours alone.
              </li>
            ) : (
              grants.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-2 border-b border-line py-2 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-ink">
                      {g.personName ?? g.email}
                    </span>
                    <span className="block truncate text-[11.5px] text-muted" dir="ltr">
                      {g.email} · {LEVEL_LABEL[g.level]} · by {g.grantedBy} ·{' '}
                      <Num>{fmtDate(g.grantedAt)}</Num>
                    </span>
                  </span>
                  <form action={(data) => run(revokeTaskAccessAction, data)}>
                    <input type="hidden" name="email" value={g.email} />
                    <Button type="submit" size="xs" variant="ghost" disabled={pending}>
                      Remove
                    </Button>
                  </form>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
