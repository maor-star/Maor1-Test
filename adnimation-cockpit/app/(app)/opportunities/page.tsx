import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import {
  COLD_AFTER_DAYS, OPPORTUNITY_VIEWS, VIEW_LABEL, listOpportunities, opportunityCounts,
  type OpportunityView,
} from '@/lib/opportunities/module';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Num } from '@/components/num';
import { NewOpportunity } from '@/components/opportunities/new-opportunity';
import { OpportunityCard } from '@/components/opportunities/opportunity-card';
import { SweepMail } from '@/components/opportunities/sweep-mail';
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
  searchParams: Promise<{ view?: string }>;
}) {
  const sp = await searchParams;
  const view: OpportunityView = OPPORTUNITY_VIEWS.includes(sp.view as OpportunityView)
    ? (sp.view as OpportunityView)
    : 'open';

  await requireUser();
  const [rows, counts] = await Promise.all([listOpportunities(view), opportunityCounts()]);

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
          <Figure label="OPEN" value={counts.open} big />
          <Figure
            label="GONE COLD"
            value={counts.cold}
            big
            tone={counts.cold > 0 ? 'warn' : undefined}
          />
          <Figure label="SUGGESTED" value={counts.suggested} />
          <Figure label="PARKED" value={counts.parked} />
          <div>
            <span className="hud-label block text-[9px]">OPEN VALUE</span>
            <span className="font-cond text-[22px] leading-none text-neutral-900">
              <Num>{fmtMoney(counts.openValueCents)}</Num>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-3">
          <p className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
            MAIL IS READ FOR CANDIDATES · SLACK IS CAPTURED BY MESSAGE LINK
          </p>
          <SweepMail />
        </div>
      </HudCard>

      <nav className="flex flex-wrap border border-divider">
        {OPPORTUNITY_VIEWS.map((v) => (
          <Link
            key={v}
            href={`/opportunities?view=${v}`}
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
              <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                <Num>{rows.length}</Num> {rows.length === 1 ? 'ITEM' : 'ITEMS'}
              </span>
            }
          />
        </div>

        {rows.length === 0 ? (
          <p className="border-t border-divider px-[18px] py-4 font-semi text-[12px] text-neutral-500">
            {counts.open === 0 && counts.decided === 0 && counts.suggested === 0
              ? 'Nothing here yet. Write one down above, paste a Slack message link, or press “scan mail now” to see what the mailbox suggests.'
              : 'Nothing in this view.'}
          </p>
        ) : (
          <ul>
            {rows.map((o) => (
              <OpportunityCard key={o.id} opportunity={o} />
            ))}
          </ul>
        )}
      </HudCard>
    </div>
  );
}

function Figure({
  label,
  value,
  big = false,
  tone,
}: {
  label: string;
  value: number;
  big?: boolean;
  tone?: 'warn';
}) {
  return (
    <div>
      <span className="hud-label block text-[9px]">{label}</span>
      <span
        className={`font-cond leading-none ${big ? 'text-[30px]' : 'text-[22px]'} ${
          tone === 'warn' ? 'text-sev-warning' : 'text-neutral-900'
        }`}
      >
        <Num>{value}</Num>
      </span>
    </div>
  );
}
