'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Num } from '@/components/num';
import { fmtDate } from '@/lib/utils';
import { ACCESS_LEVELS, LEVEL_LABEL, type Grant } from '@/lib/tasks/access';
import { grantTaskAccessAction, revokeTaskAccessAction } from '@/app/actions/task-access';

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
  people,
}: {
  grants: Grant[];
  people: { id: string; label: string; email: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (action: (d: FormData) => Promise<{ ok: boolean; error?: string }>, data: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await action(data);
      if (!result.ok) setError(result.error ?? 'That did not work');
      else router.refresh();
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
            <Button type="submit" size="sm" disabled={pending}>
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
