import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import {
  COLD_AFTER_DAYS, OPPORTUNITY_VIEWS, VIEW_LABEL, captureLabelHealth,
  contractsForOpportunities, listOpportunities, opportunityCounts, type OpportunityView,
} from '@/lib/opportunities/module';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Figure } from '@/components/hud/figure';
import { SearchBox } from '@/components/hud/search-box';
import { filterByQuery } from '@/lib/search';
import { Num } from '@/components/num';
import { NewOpportunity } from '@/components/opportunities/new-opportunity';
import { OpportunityCard } from '@/components/opportunities/opportunity-card';
import { SweepMail } from '@/components/opportunities/sweep-mail';
import { HowToCapture } from '@/components/opportunities/how-to-capture';
import { fmtMoney } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Opportunities — the things he noticed and has not acted on.
 *
 * Not the pipeline. The pipeline holds deals that are already moving; this
 * holds the stage before that, where something is still only worth doing and
 * nobody has decided anything. Those never fail loudly — they just stop being
 * mentioned — so the default view leads with the ones that have gone quiet
 * rather than the ones most recently added.
 */
export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const view: OpportunityView = OPPORTUNITY_VIEWS.includes(sp.view as OpportunityView)
    ? (sp.view as OpportunityView)
    : 'open';
  const q = sp.q ?? '';

  await requireUser();
  const gmailLabels = (process.env.GMAIL_OPPORTUNITY_LABEL ?? 'Opportunity')
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

  const [all, counts, labelHealth] = await Promise.all([
    listOpportunities(view),
    opportunityCounts(),
    captureLabelHealth(gmailLabels).catch(() => []),
  ]);

  // The numbers at the top are the way into what they count; the search
  // narrows whichever view is open. Both live in the URL.
  const to = (v: OpportunityView) => {
    const params = new URLSearchParams();
    if (v !== 'open') params.set('view', v);
    if (q) params.set('q', q);
    const query = params.toString();
    return query ? `/opportunities?${query}` : '/opportunities';
  };
  const linkedContracts = await contractsForOpportunities(all.map((o) => o.id));

  const rows = filterByQuery(all, q, (o) => [
    o.title,
    o.note,
    o.counterparty,
    o.kind,
    o.status,
    o.nextStep,
    o.source,
    o.sourceExcerpt,
    o.valueCents == null ? null : o.valueCents / 100,
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="OPPORTUNITIES / 05"
        title="What you have not acted on"
        action={
          <span>
            COLD AFTER <Num>{COLD_AFTER_DAYS}</Num> QUIET DAYS
          </span>
        }
      />

      <HudCard>
        <HudCardHeader title="On the table" index="O01" action={<NewOpportunity />} />

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-5">
          <Figure label="OPEN" value={counts.open} big href={to('open')} active={view === 'open'} />
          <Figure
            label="GONE COLD"
            value={counts.cold}
            big
            tone={counts.cold > 0 ? 'warn' : undefined}
            href={to('cold')}
            active={view === 'cold'}
          />
          <Figure
            label="SUGGESTED"
            value={counts.suggested}
            href={to('inbox')}
            active={view === 'inbox'}
          />
          <Figure
            label="PARKED"
            value={counts.parked}
            href={to('parked')}
            active={view === 'parked'}
          />
          <div>
            <span className="hud-label block text-[9px]">OPEN VALUE</span>
            <span className="font-cond text-[22px] leading-none text-neutral-900">
              <Num>{fmtMoney(counts.openValueCents)}</Num>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-divider pt-3">
          <SweepMail />
        </div>
      </HudCard>

      <HowToCapture gmailLabels={gmailLabels} labelHealth={labelHealth} />

      <nav className="flex flex-wrap border border-divider">
        {OPPORTUNITY_VIEWS.map((v) => (
          <Link
            key={v}
            href={to(v)}
            className={`px-3 py-1 font-semi text-[11px] uppercase tracking-[0.16em] ${
              v === view ? 'bg-accent text-ground' : 'text-neutral-500 hover:text-accent'
            }`}
          >
            {VIEW_LABEL[v]}
            {v === 'inbox' && counts.suggested > 0 ? ` (${counts.suggested})` : ''}
            {v === 'cold' && counts.cold > 0 ? ` (${counts.cold})` : ''}
          </Link>
        ))}
      </nav>

      <HudCard className="gap-0 p-0">
        <div className="p-[18px] pb-3">
          <HudCardHeader
            title={VIEW_LABEL[view]}
            index="O02"
            action={
              <div className="flex flex-wrap items-center gap-3">
                <SearchBox placeholder="Find an opportunity" />
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
              : counts.open === 0 && counts.decided === 0 && counts.suggested === 0
              ? 'Nothing here yet. Write one down above, paste a Slack message link, or press “scan mail now” to see what the mailbox suggests.'
              : 'Nothing in this view.'}
          </p>
        ) : (
          <ul>
            {rows.map((o) => (
              <OpportunityCard
                key={o.id}
                opportunity={o}
                contracts={linkedContracts.get(o.id) ?? []}
              />
            ))}
          </ul>
        )}
      </HudCard>
    </div>
  );
}

