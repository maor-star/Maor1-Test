import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import {
  DELEGATION_VIEWS, VIEW_LABEL, delegatableTeam, delegationCounts, listDelegations,
  type DelegationView,
} from '@/lib/delegation/module';
import { DELEGATION_STALE_DAYS } from '@/lib/tasks/types';
import { slackCanShareThreads } from '@/lib/integrations/slack';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Figure } from '@/components/hud/figure';
import { SearchBox } from '@/components/hud/search-box';
import { filterByQuery } from '@/lib/search';
import { Num } from '@/components/num';
import { CheckReplies } from '@/components/delegations/check-replies';
import { DelegationCard } from '@/components/delegations/delegation-card';
import { NewDelegation } from '@/components/delegations/new-delegation';

export const dynamic = 'force-dynamic';

/**
 * Spec 6.4 — the delegation tracker, as somewhere work is actually run.
 *
 * What I gave, to whom, what came back, and what I did about it. The
 * conversation lives in Slack and is read from there, so a reply typed in
 * Slack and a reply typed here are the same conversation.
 */
export default async function DelegationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const view: DelegationView = DELEGATION_VIEWS.includes(sp.view as DelegationView)
    ? (sp.view as DelegationView)
    : 'open';
  const q = sp.q ?? '';

  const user = await requireUser();
  const [all, counts, team, sharedThreads] = await Promise.all([
    listDelegations(view),
    delegationCounts(),
    delegatableTeam(user.email),
    slackCanShareThreads(),
  ]);

  // The numbers at the top open what they count; the search narrows the view.
  const to = (v: DelegationView) => {
    const params = new URLSearchParams();
    if (v !== 'open') params.set('view', v);
    if (q) params.set('q', q);
    const query = params.toString();
    return query ? `/delegations?${query}` : '/delegations';
  };
  const rows = filterByQuery(all, q, (d) => [
    d.title,
    d.note,
    d.personName,
    d.personEmail,
    d.status,
    d.priority,
    d.dueDate,
  ]);

  const unreachable = team.filter((p) => !p.slackId);

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

      <HudCard>
        <HudCardHeader title="Handed over" index="D01" action={<NewDelegation team={team} sharedThreads={sharedThreads} />} />

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-5">
          <Figure label="OPEN" value={counts.open} big href={to('open')} active={view === 'open'} />
          <Figure
            label="WAITING ON THEM"
            value={counts.waiting}
            big
            href={to('waiting')}
            active={view === 'waiting'}
          />
          <Figure
            label="ANSWERED"
            value={counts.answered}
            href={to('answered')}
            active={view === 'answered'}
          />
          <Figure
            label="STUCK"
            value={counts.stuck}
            tone={counts.stuck > 0 ? 'warn' : undefined}
            href={to('stuck')}
            active={view === 'stuck'}
          />
          <Figure label="DONE" value={counts.done} href={to('done')} active={view === 'done'} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-3">
          <p className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
            SLACK THREADS AND EMAIL ARE READ FOR THE ANSWER
          </p>
          <CheckReplies />
        </div>
      </HudCard>

      {!sharedThreads ? (
        <div className="border border-divider px-4 py-2 font-semi text-[11px] tracking-[0.06em] text-neutral-500">
          Hand-offs go out as a Slack DM from the bot to the person, so they do not appear in your
          own Slack — read and answer them under “conversation” below. To have them arrive in your
          Slack too, add the <span className="text-accent-700">mpim:write</span> and{' '}
          <span className="text-accent-700">mpim:history</span> scopes to the Slack app and
          reinstall it; the cockpit will start using a shared thread on its own.
        </div>
      ) : null}

      {unreachable.length > 0 ? (
        <div className="border border-sev-warning/40 bg-sev-warning/10 px-4 py-2 font-semi text-[12px] tracking-[0.06em] text-sev-warning">
          {unreachable.map((p) => p.name).join(', ')} — no Slack id on record, so nothing can be
          delivered to them. Everyone else can be reached.
        </div>
      ) : null}

      <nav className="flex flex-wrap border border-divider">
        {DELEGATION_VIEWS.map((v) => (
          <Link
            key={v}
            href={to(v)}
            className={`px-3 py-1 font-semi text-[11px] uppercase tracking-[0.16em] ${
              v === view ? 'bg-accent text-ground' : 'text-neutral-500 hover:text-accent'
            }`}
          >
            {VIEW_LABEL[v]}
          </Link>
        ))}
      </nav>

      <HudCard className="gap-0 p-0">
        <div className="p-[18px] pb-3">
          <HudCardHeader
            title={VIEW_LABEL[view]}
            index="D02"
            action={
              <div className="flex flex-wrap items-center gap-3">
                <SearchBox placeholder="Find a hand-off" />
                <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                  <Num>{rows.length}</Num>
                  {rows.length === all.length ? (rows.length === 1 ? ' ITEM' : ' ITEMS') : ` OF ${all.length}`}
                </span>
              </div>
            }
          />
        </div>

        {rows.length === 0 ? (
          <p className="border-t border-divider px-[18px] py-4 font-semi text-[12px] text-neutral-500">
            {q
              ? `Nothing in this view matches “${q}”.`
              : counts.open === 0 && counts.done === 0
              ? 'Nothing handed over yet. Use “hand something over” above — it goes to their Slack, and their reply comes back here.'
              : 'Nothing in this view.'}
          </p>
        ) : (
          <ul>
            {rows.map((d) => (
              <DelegationCard key={d.id} delegation={d} />
            ))}
          </ul>
        )}
      </HudCard>
    </div>
  );
}

