import Link from 'next/link';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { SearchBox } from '@/components/hud/search-box';
import { PageHeader } from '@/components/hud/page-header';
import { Num } from '@/components/num';
import { AddPipelineClient } from '@/components/pipeline/add-client';
import { PipelineClientRow } from '@/components/pipeline/client-row';
import {
  PIPELINE_SORTS, PIPELINE_SORT_LABEL, buildBoard, listOwners, listPipeline, recentTouches,
  type PipelineSort,
} from '@/lib/pipeline/service';
import {
  CLIENT_TYPES, CLIENT_TYPE_LABEL, QUIET_DAYS, STAGES, STAGE_LABEL,
  type ClientType, type Stage,
} from '@/lib/pipeline/types';
import { fmtMoney, fmtNumber } from '@/lib/utils';
import {
  captureLabelHealth, contractsForOpportunities, inboxOpportunities,
} from '@/lib/opportunities/module';
import { OpportunityCard } from '@/components/opportunities/opportunity-card';
import { SweepMail } from '@/components/opportunities/sweep-mail';
import { HowToCapture } from '@/components/opportunities/how-to-capture';

export const dynamic = 'force-dynamic';

interface SearchParams {
  stage?: string;
  type?: string;
  q?: string;
  attention?: string;
  sort?: string;
}

/**
 * The sales system the CEO works himself.
 *
 * Everyone he is in conversation with, classified on the two axes that matter
 * — what kind of client this would be, and how far the conversation has got —
 * and sorted by what he owes them next. The CRM page mirrors HubSpot and is
 * read-only; this is his own working state, and a CRM sync never touches it.
 */
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const stage = STAGES.includes(sp.stage as Stage) ? (sp.stage as Stage) : undefined;
  const clientType = CLIENT_TYPES.includes(sp.type as ClientType)
    ? (sp.type as ClientType)
    : undefined;
  const attention = sp.attention === '1';
  const sort: PipelineSort = PIPELINE_SORTS.includes(sp.sort as PipelineSort)
    ? (sp.sort as PipelineSort)
    : 'newest';

  const gmailLabels = (process.env.GMAIL_OPPORTUNITY_LABEL ?? 'Opportunity')
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

  const [rows, owners, inbox, labelHealth] = await Promise.all([
    listPipeline({ stage, clientType, q: sp.q, attention, sort }),
    listOwners(),
    inboxOpportunities(),
    captureLabelHealth(gmailLabels).catch(() => []),
  ]);
  const board = buildBoard(rows);
  const [touches, inboxContracts] = await Promise.all([
    recentTouches(rows.map((r) => r.id)),
    contractsForOpportunities(inbox.map((o) => o.id)),
  ]);

  // Keep the current filters when only one of them changes — working the list
  // means narrowing it repeatedly, not starting over each time.
  const href = (patch: Partial<SearchParams>) => {
    const next = new URLSearchParams();
    const merged = {
      stage: sp.stage, type: sp.type, q: sp.q, attention: sp.attention, sort: sp.sort, ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const qs = next.toString();
    return qs ? `/pipeline?${qs}` : '/pipeline';
  };

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="DEALS / 05"
        title="DEALS"
        action={
          <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
            FROM FIRST MENTION TO LIVE · MY OWN BOOK, NOT SYNCED FROM HUBSPOT
          </span>
        }
      />

      {/*
        The search, where he reaches for it: at the top, big enough to type
        into without aiming. The stage and type filters sit further down,
        because they are chosen occasionally and this is used constantly.
      */}
      <SearchBox size="lg" placeholder="Find a client — name or domain" className="max-w-xl" />

      <HudCard>
        <HudCardHeader
          title="The book"
          index="P01"
          action={<AddPipelineClient owners={owners} />}
        />

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <Figure label="CLIENTS" value={fmtNumber(board.totals.clients)} big />
          <Figure label="OPEN VALUE / MO" value={fmtMoney(board.totals.openValueCents)} big />
          <Figure label="WEIGHTED" value={fmtMoney(board.totals.weightedValueCents)} />
          <Figure
            label="NEEDS ATTENTION"
            value={`${board.totals.overdueSteps} / ${board.totals.quiet}`}
            hint="OVERDUE STEP / QUIET"
          />
        </div>

        {board.totals.byType.length > 0 ? (
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-divider pt-3">
            {board.totals.byType.map((t) => (
              <Link key={t.clientType} href={href({ type: t.clientType })} className="group">
                <span className="hud-label block text-[9px] group-hover:text-accent">
                  {CLIENT_TYPE_LABEL[t.clientType]}
                </span>
                <span className="font-cond text-[20px] leading-none text-neutral-800 group-hover:text-accent">
                  <Num>{fmtNumber(t.n)}</Num>
                </span>
              </Link>
            ))}
          </div>
        ) : null}
      </HudCard>

      {/*
        The inbox: what the mail detector proposed, what he labelled in Gmail,
        what was sent to the Slack bot. None of it is a deal until he says so —
        one click makes it one in its first stage, one click makes it go away.
        It sits above the board because a suggestion nobody looked at is the
        same kind of silence as a deal nobody moved.
      */}
      <HudCard id="inbox" className="gap-0 p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
          <HudCardHeader
            title="Suggested — not yet deals"
            index="P02"
            action={
              <div className="flex flex-wrap items-center gap-3">
                <SweepMail />
                <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                  <Num>{inbox.length}</Num> WAITING
                </span>
              </div>
            }
          />
        </div>
        {inbox.length === 0 ? (
          <div className="border-t border-divider px-[18px] py-3">
            <p className="mb-3 font-semi text-[12px] text-neutral-500">
              Nothing proposed that you have not already decided on.
            </p>
            <HowToCapture gmailLabels={gmailLabels} labelHealth={labelHealth} />
          </div>
        ) : (
          <ul>
            {inbox.map((o) => (
              <OpportunityCard
                key={o.id}
                opportunity={o}
                contracts={inboxContracts.get(o.id) ?? []}
              />
            ))}
          </ul>
        )}
      </HudCard>

      <div className="flex flex-wrap items-center gap-3">
        <nav className="flex flex-wrap border border-divider">
          <FilterLink href={href({ stage: undefined })} active={!stage}>
            ALL STAGES
          </FilterLink>
          {STAGES.map((s) => (
            <FilterLink key={s} href={href({ stage: s })} active={stage === s}>
              {STAGE_LABEL[s]}
            </FilterLink>
          ))}
        </nav>

        <nav className="flex flex-wrap border border-divider">
          <FilterLink href={href({ type: undefined })} active={!clientType}>
            ALL TYPES
          </FilterLink>
          {CLIENT_TYPES.map((t) => (
            <FilterLink key={t} href={href({ type: t })} active={clientType === t}>
              {CLIENT_TYPE_LABEL[t]}
            </FilterLink>
          ))}
        </nav>

        <FilterLink
          href={href({ attention: attention ? undefined : '1' })}
          active={attention}
          className="border border-divider"
        >
          NEEDS ATTENTION
        </FilterLink>

        <nav className="flex flex-wrap border border-divider">
          {PIPELINE_SORTS.map((s) => (
            <FilterLink key={s} href={href({ sort: s })} active={sort === s}>
              {PIPELINE_SORT_LABEL[s]}
            </FilterLink>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          {sp.q ? (
            <Link
              href={href({ q: undefined })}
              className="font-semi text-[10px] uppercase tracking-[0.16em] text-accent-700 hover:text-accent"
            >
              Clear
            </Link>
          ) : null}
        </div>
      </div>

      {board.byStage.length === 0 ? (
        <HudCard>
          <p className="font-semi text-[12px] text-neutral-500">
            {board.totals.clients === 0 && !stage && !clientType && !sp.q && !attention
              ? 'No deals yet. Add the first one above, or accept a suggestion.'
              : 'Nothing matches these filters.'}
          </p>
        </HudCard>
      ) : (
        board.byStage.map((group, i) => (
          <HudCard key={group.stage} className="gap-0 p-0">
            <div className="p-[18px] pb-3">
              <HudCardHeader
                title={STAGE_LABEL[group.stage]}
                index={`P${String(i + 3).padStart(2, '0')}`}
                action={
                  <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                    <Num>{fmtNumber(group.rows.length)}</Num> ·{' '}
                    <Num>{fmtMoney(group.valueCents)}</Num> / MO
                  </span>
                }
              />
            </div>
            <ul>
              {group.rows.map((c) => (
                <PipelineClientRow
                  key={c.id}
                  client={c}
                  owners={owners}
                  touches={touches.get(c.id) ?? []}
                />
              ))}
            </ul>
          </HudCard>
        ))
      )}

      <p className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
        QUIET = NO LOGGED CONVERSATION IN <Num>{QUIET_DAYS}</Num> DAYS. AN OPEN DEAL CANNOT BE SAVED
        WITHOUT A NEXT STEP AND A DATE FOR IT.
      </p>
    </div>
  );
}

function FilterLink({
  href,
  active,
  children,
  className,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1 font-semi text-[11px] uppercase tracking-[0.16em] ${
        active ? 'bg-accent text-ground' : 'text-neutral-500 hover:text-accent'
      } ${className ?? ''}`}
    >
      {children}
    </Link>
  );
}

function Figure({
  label,
  value,
  hint,
  big = false,
}: {
  label: string;
  value: string;
  hint?: string;
  big?: boolean;
}) {
  return (
    <div>
      <span className="hud-label block text-[9px]">{label}</span>
      <span
        className={`font-cond leading-none text-neutral-900 ${big ? 'text-[30px]' : 'text-[22px]'}`}
      >
        <Num>{value}</Num>
      </span>
      {hint ? (
        <span className="mt-0.5 block font-semi text-[9px] tracking-[0.12em] text-neutral-500">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
