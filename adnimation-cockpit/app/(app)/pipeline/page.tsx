import Link from 'next/link';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { SearchBox } from '@/components/hud/search-box';
import { PageHeader } from '@/components/hud/page-header';
import { Num } from '@/components/num';
import { AddPipelineClient } from '@/components/pipeline/add-client';
import { PipelineClientRow } from '@/components/pipeline/client-row';
import {
  PIPELINE_SORTS, PIPELINE_SORT_LABEL, buildBoard, closedCount, listOwners, listPipeline,
  recentTouches, type PipelineSort,
} from '@/lib/pipeline/service';
import {
  CLIENT_TYPES, CLIENT_TYPE_LABEL, QUIET_DAYS, STAGES, STAGE_LABEL,
  type ClientType, type Stage,
} from '@/lib/pipeline/types';
import { fmtMoney, fmtNumber } from '@/lib/utils';
import {
  captureLabelHealth, contractsForOpportunities, inboxOpportunities,
} from '@/lib/opportunities/module';
import { PipelineFilterBar, type FilterGroup } from '@/components/pipeline/filter-bar';
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
  /** '1' shows the finished ones instead of the live board. */
  closed?: string;
  /** '1' shows what has been suggested and not yet accepted. */
  suggested?: string;
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
  const closed = sp.closed === '1';
  const suggested = sp.suggested === '1';
  const sort: PipelineSort = PIPELINE_SORTS.includes(sp.sort as PipelineSort)
    ? (sp.sort as PipelineSort)
    : 'newest';

  const gmailLabels = (process.env.GMAIL_OPPORTUNITY_LABEL ?? 'Opportunity')
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

  const [rows, everything, owners, inbox, labelHealth, finished] = await Promise.all([
    listPipeline({ stage, clientType, q: sp.q, attention, sort, closed }),
    // The whole book, for the counts on the bar: a count that moved with the
    // filter would read zero on every chip he had not chosen.
    listPipeline({ closed }),
    listOwners(),
    inboxOpportunities(),
    captureLabelHealth(gmailLabels).catch(() => []),
    closedCount(),
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
      stage: sp.stage, type: sp.type, q: sp.q, attention: sp.attention, sort: sp.sort,
      closed: sp.closed, suggested: sp.suggested, ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const qs = next.toString();
    return qs ? `/pipeline?${qs}` : '/pipeline';
  };

  const countBy = <K extends string>(key: (r: (typeof everything)[number]) => K) => {
    const out = new Map<K, number>();
    for (const r of everything) out.set(key(r), (out.get(key(r)) ?? 0) + 1);
    return out;
  };
  const byStage = countBy((r) => r.stage);
  const byType = countBy((r) => r.clientType);
  const needsAttention = everything.filter(
    (r) => r.stepOverdue || r.quietDays === null || r.quietDays >= QUIET_DAYS,
  ).length;

  /*
   * The bar. Three rows, and the third is the one he asked for: the
   * suggestions sit beside the other views rather than in a card of their own
   * above the board, so nothing takes the top of the screen until he asks it to.
   */
  const groups: FilterGroup[] = [
    {
      label: 'STAGE',
      chips: [
        { key: 'all', label: 'All', href: href({ stage: undefined, suggested: undefined }), active: !stage && !suggested, count: everything.length },
        ...STAGES.map((s) => ({
          key: s,
          label: STAGE_LABEL[s],
          href: href({ stage: s, suggested: undefined }),
          active: stage === s && !suggested,
          count: byStage.get(s) ?? 0,
        })),
      ],
    },
    {
      label: 'TYPE',
      chips: [
        { key: 'all', label: 'All', href: href({ type: undefined, suggested: undefined }), active: !clientType && !suggested, count: everything.length },
        ...CLIENT_TYPES.map((t) => ({
          key: t,
          label: CLIENT_TYPE_LABEL[t],
          href: href({ type: t, suggested: undefined }),
          active: clientType === t && !suggested,
          count: byType.get(t) ?? 0,
        })),
      ],
    },
    {
      label: 'VIEW',
      chips: [
        {
          key: 'suggested',
          label: 'Suggested',
          href: href({ suggested: suggested ? undefined : '1' }),
          active: suggested,
          count: inbox.length,
          tone: 'warn' as const,
          title: 'Proposed from your mail, Slack and the Gmail label — not deals until you say so',
        },
        {
          key: 'attention',
          label: 'Needs attention',
          href: href({ attention: attention ? undefined : '1', suggested: undefined }),
          active: attention && !suggested,
          count: needsAttention,
          tone: 'warn' as const,
          title: `An overdue next step, or no logged conversation in ${QUIET_DAYS} days`,
        },
        {
          key: 'closed',
          label: 'Finished',
          href: href({ closed: closed ? undefined : '1', suggested: undefined }),
          active: closed && !suggested,
          count: finished,
          title: 'Won or lost — off the board, still on the record',
        },
      ],
    },
    {
      label: 'ORDER',
      chips: PIPELINE_SORTS.map((s) => ({
        key: s,
        label: PIPELINE_SORT_LABEL[s],
        href: href({ sort: s }),
        active: sort === s,
        count: null,
      })),
    },
  ];

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
      </HudCard>

      <PipelineFilterBar groups={groups} />

      {/*
        The inbox: what the mail detector proposed, what he labelled in Gmail,
        what was sent to the Slack bot. None of it is a deal until he says so —
        one click makes it one in its first stage, one click makes it go away.
        Behind its own chip on the bar rather than always open above the board:
        the count on the chip is what keeps a suggestion nobody looked at from
        becoming the same silence as a deal nobody moved.
      */}
      {suggested ? (
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
      ) : null}

      {sp.q ? (
        <p className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
          FILTERED BY “{sp.q}” ·{' '}
          <Link href={href({ q: undefined })} className="text-accent-700 hover:text-accent">
            CLEAR
          </Link>
        </p>
      ) : null}

      {suggested ? null : board.byStage.length === 0 ? (
        <HudCard>
          <p className="font-semi text-[12px] text-neutral-500">
            {board.totals.clients === 0 && !stage && !clientType && !sp.q && !attention
              ? closed
                ? 'Nothing finished yet. A deal you close — won or lost — lands here.'
                : 'No deals yet. Add the first one above, or accept a suggestion.'
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
        QUIET = NO LOGGED CONVERSATION IN <Num>{QUIET_DAYS}</Num> DAYS. EVERY OPEN DEAL CARRIES A
        NEXT STEP AND A DATE — ONE IS FILLED IN FOR YOU IF YOU LEAVE THEM EMPTY.
      </p>
    </div>
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
