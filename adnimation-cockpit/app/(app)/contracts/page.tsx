import { contractBoard, listContracts, listDepartments } from '@/lib/contracts/service';
import {
  LANE_LABEL, LANE_NOTE, filingTree, type ContractView, type Lane,
} from '@/lib/contracts/board';
import { DRIVE_ROOT } from '@/lib/contracts/drive';
import { ESCALATION_DAYS, RENEWAL_NOTICE_DAYS, STATUS_LABEL } from '@/lib/contracts/status';
import { fmtMoney } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Figure } from '@/components/hud/figure';
import { SearchBox } from '@/components/hud/search-box';
import { InstantFilter } from '@/components/hud/instant-filter';
import { filterByQuery, foldForSearch } from '@/lib/search';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { ConfirmFiling, ContractActions } from '@/components/contracts/contract-actions';
import { NewContractForm } from '@/components/contracts/new-contract-form';
import Link from 'next/link';
import {
  CONTRACT_VIEWS, CONTRACT_VIEW_LABEL, contractCounts,
  listContracts as listIntake, type ContractView as IntakeView,
} from '@/lib/contracts/intake-module';
import { ContractCard } from '@/components/contracts/contract-card';
import { driveStatus } from '@/lib/integrations/drive';

export const dynamic = 'force-dynamic';

/**
 * Spec §9 — contracts, arranged by who is holding things up.
 *
 * The lane a contract sits in is the answer to "what is waiting". The chase
 * ladder turns silence into a dated obligation, and every row carries the Drive
 * folder it belongs in so filing is never a separate question.
 */
export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const intakeView: IntakeView = CONTRACT_VIEWS.includes(sp.view as IntakeView)
    ? (sp.view as IntakeView)
    : 'classify';
  const q = sp.q ?? '';

  const [board, departments, intake, counts, drive] = await Promise.all([
    contractBoard(),
    listDepartments(),
    listIntake(intakeView),
    contractCounts(),
    driveStatus().catch(() => ({ configured: false, authorised: false, reason: 'unknown' })),
  ]);
  const all = await listContracts();
  const tree = filingTree(all);

  /*
   * The numbers at the top are the way into the list they count, and the
   * search narrows whichever list he is looking at. Both live in the URL, so a
   * narrowed screen survives a reload.
   */
  const view = (v: IntakeView) => {
    const params = new URLSearchParams();
    if (v !== 'classify') params.set('view', v);
    if (q) params.set('q', q);
    const query = params.toString();
    return query ? `/contracts?${query}` : '/contracts';
  };
  /*
   * The fields a row can be found by, in one place: the server filters on
   * them, and each row carries the same text folded into `data-search` so the
   * list can narrow in the browser before the server has been asked. Two
   * copies of a search that disagreed would be worse than one that is slow.
   */
  const searchable = (c: (typeof intake)[number]) => [
    c.counterpartyName,
    c.docType,
    c.category,
    c.statusLabel,
    c.status,
    c.notes,
    c.drivePath,
    c.source,
    c.opportunityTitle,
    c.pipelineClientName,
    c.valueCents == null ? null : c.valueCents / 100,
    c.receivedAt,
    // The file names are printed on the row, so they are things he will type.
    ...c.versions.map((v) => v.fileName),
  ];
  const rows = filterByQuery(intake, q, searchable);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="CONTRACTS / 08"
        title="Contracts"
        action={
          <span className="font-semi text-[11.5px] tracking-[0.14em] text-neutral-500">
            <Num>{board.totals.open}</Num> Open · <Num>{fmtMoney(board.totals.openValueCents)}</Num> AT
            STAKE
          </span>
        }
      />

      {/*
        The intake sits above everything else because it is the only part that
        needs him: a contract nobody has classified is filed nowhere, linked to
        nothing, and invisible to every other view.
      */}
      <HudCard>
        <HudCardHeader
          title="Arriving from mail and Slack"
          index="C00"
          action={
            <span className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
              Classify it and it is filed
            </span>
          }
        />

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-5">
          <Figure
            label="NEEDS CLASSIFYING"
            value={counts.needsClassifying}
            big
            tone={counts.needsClassifying > 0 ? 'warn' : undefined}
            href={view('classify')}
            active={intakeView === 'classify'}
          />
          <Figure
            label="WAITING ON YOU"
            value={counts.onYou}
            big
            href={view('on_you')}
            active={intakeView === 'on_you'}
          />
          <Figure
            label="WAITING ON THEM"
            value={counts.onThem}
            href={view('on_them')}
            active={intakeView === 'on_them'}
          />
          <Figure
            label="SIGNED"
            value={counts.signed}
            href={view('signed')}
            active={intakeView === 'signed'}
          />
          <Figure
            label="NOT IN DRIVE"
            value={counts.notFiled}
            tone={counts.notFiled > 0 ? 'warn' : undefined}
            href={view('all')}
            active={intakeView === 'all'}
          />
        </div>

        {!drive.authorised ? (
          <div className="border border-sev-warning/40 bg-sev-warning/10 px-3 py-2 font-semi text-[11px] tracking-[0.06em] text-sev-warning">
            Drive is not authorised, so contracts are recorded here with their versions and links
            but the files are not filed yet. Add{' '}
            <span className="text-info">https://www.googleapis.com/auth/drive</span> to the
            service account under domain-wide delegation and set{' '}
            <span className="text-info">DRIVE_CONTRACTS_ROOT_ID</span>. Nothing is lost in the
            meantime — press “file to Drive” once it is on.
          </div>
        ) : null}
      </HudCard>

      <nav className="segmented flex-wrap">
        {CONTRACT_VIEWS.map((v) => (
          <Link
            key={v}
            href={view(v)}
            aria-current={v === intakeView ? 'page' : undefined}
          >
            {CONTRACT_VIEW_LABEL[v]}
            {v === 'classify' && counts.needsClassifying > 0 ? ` (${counts.needsClassifying})` : ''}
          </Link>
        ))}
      </nav>

      <HudCard className="gap-0 p-0">
        <div className="p-[18px] pb-3">
          <HudCardHeader
            title={CONTRACT_VIEW_LABEL[intakeView]}
            index="C01"
            action={
              <div className="flex flex-wrap items-center gap-3">
                <SearchBox placeholder="Find a contract" />
                <span className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
                  <Num>{rows.length}</Num>
                  {rows.length === intake.length
                    ? ` ${intake.length === 1 ? 'CONTRACT' : 'CONTRACTS'}`
                    : ` OF ${intake.length}`}
                </span>
              </div>
            }
          />
        </div>

        {rows.length === 0 ? (
          <p className="border-t border-line px-[18px] py-4 text-[14.5px] text-muted">
            {q
              ? `Nothing in this view matches “${q}”.`
              : intakeView === 'classify'
                ? 'Nothing waiting to be classified. Contracts arriving by mail or Slack land here.'
                : 'Nothing in this view.'}
          </p>
        ) : (
          <ul id="contract-list">
            <InstantFilter scope="contract-list" />
            {rows.map((c) => (
              <ContractCard key={c.id} contract={c} search={foldForSearch(...searchable(c))} />
            ))}
          </ul>
        )}
      </HudCard>

      <HudCard>
        <HudCardHeader
          title="New contract"
          index="C00"
          action={
            <span className="font-semi text-[11.5px] tracking-[0.14em] text-neutral-500">
              Filed to <Num>/{DRIVE_ROOT}</Num>
            </span>
          }
        />
        <NewContractForm
          departments={departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.nameHe}` }))}
        />
      </HudCard>

      <div className="grid gap-5 xl:grid-cols-3">
        {board.lanes.map((lane, i) => (
          <LaneCard key={lane.lane} lane={lane.lane} items={lane.items} index={`C0${i + 1}`} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <RenewalsCard items={board.renewals} />
        <FilingCard tree={tree} unconfirmed={board.unconfirmed} />
      </div>
    </div>
  );
}

/** One of the three lanes: on me, on them, on us. */
function LaneCard({ lane, items, index }: { lane: Lane; items: ContractView[]; index: string }) {
  const chasing = items.filter((c) => c.escalation.level > 0).length;

  return (
    <HudCard className="gap-0 p-0">
      <div className="flex items-baseline justify-between gap-3 p-[18px] pb-2">
        <HudCardHeader
          title={LANE_LABEL[lane]}
          index={index}
          action={
            <Tag tone={lane === 'on_me' ? 'critical' : chasing > 0 ? 'warning' : 'outline'}>
              <Num>{items.length}</Num>
            </Tag>
          }
        />
      </div>
      <p className="px-[18px] pb-3 font-semi text-[11px] leading-relaxed text-neutral-500">
        {LANE_NOTE[lane]}
      </p>

      {items.length === 0 ? (
        <p className="border-t border-line px-[18px] py-3 font-semi text-[12px] text-neutral-500">
          Nothing here.
        </p>
      ) : (
        <ul>
          {items.map((c) => (
            <li key={c.id} id={c.id} className="border-t border-line px-[18px] py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-cond text-[17px] text-neutral-900">{c.counterparty}</p>
                  <p className="hud-label mt-0.5 text-[11px]">
                    {c.docTypeLabel} · {STATUS_LABEL[c.status]} ·{' '}
                    <Num>{c.daysInStatus}</Num> DAYS
                    {c.deptCode ? <> · {c.deptCode}</> : null}
                  </p>
                </div>
                <span className="font-cond text-[15px] text-neutral-700">
                  <Num>{fmtMoney(c.valueCents)}</Num>
                </span>
              </div>

              {c.escalation.level > 0 ? (
                <p className="mt-2 flex flex-wrap items-center gap-2">
                  <Tag
                    tone={
                      c.escalation.severity === 'critical'
                        ? 'critical'
                        : c.escalation.severity === 'warning'
                          ? 'warning'
                          : 'watch'
                    }
                  >
                    {c.escalation.label}
                  </Tag>
                  <span className="font-semi text-[11px] text-neutral-600">
                    {c.escalation.action}
                  </span>
                </p>
              ) : null}

              <p className="mt-2 truncate font-semi text-[11.5px] tracking-[0.1em] text-neutral-500">
                <Num>{c.filing.path}</Num>
              </p>

              {c.needsReview ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Tag tone="watch">Filing unconfirmed</Tag>
                  <ConfirmFiling id={c.id} category={c.category} />
                </div>
              ) : null}

              <div className="mt-2">
                <ContractActions id={c.id} status={c.status} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {lane === 'on_them' ? (
        <div className="border-t border-line px-[18px] py-2 font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
          Ladder: <Num>{ESCALATION_DAYS.join(' / ')}</Num> Days
        </div>
      ) : null}
    </HudCard>
  );
}

/** Spec 9.4 — signed contracts that have entered a notice window. */
function RenewalsCard({ items }: { items: ContractView[] }) {
  return (
    <HudCard className="gap-0 p-0">
      <div className="flex items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader
          title="Renewals ahead"
          index="C04"
          action={
            <span className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
              Notice at <Num>{RENEWAL_NOTICE_DAYS.join(' / ')}</Num> Days
            </span>
          }
        />
      </div>

      {items.length === 0 ? (
        <p className="px-[18px] pb-[18px] font-semi text-[12px] text-neutral-500">
          No signed contract is inside a notice window.
        </p>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="cockpit-table">
            <thead>
              <tr>
                <th>Counterparty</th>
                <th>Ends</th>
                <th>Days left</th>
                <th>Value</th>
                <th className="text-end">State</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-normal">
                    <span className="font-cond text-[15px] text-neutral-900">{c.counterparty}</span>
                    <p className="hud-label mt-0.5 text-[11px]">{c.docTypeLabel}</p>
                  </td>
                  <td><Num>{c.endDate ?? '—'}</Num></td>
                  <td><Num>{c.renewal.daysToExpiry ?? '—'}</Num></td>
                  <td><Num>{fmtMoney(c.valueCents)}</Num></td>
                  <td className="text-end">
                    {c.renewal.noticeDeadlinePassed ? (
                      <Tag tone="critical" title="The window to cancel has closed — it renews unless decided now">
                        Auto-renews
                      </Tag>
                    ) : (
                      <Tag tone="outline">
                        <Num>{c.renewal.noticeWindow}</Num>
                        <span className="ms-1">Day notice</span>
                      </Tag>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </HudCard>
  );
}

/** Spec 9.5 — the Drive tree these contracts file into. */
function FilingCard({
  tree,
  unconfirmed,
}: {
  tree: ReturnType<typeof filingTree>;
  unconfirmed: ContractView[];
}) {
  return (
    <HudCard className="gap-0 p-0">
      <div className="flex items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader
          title="Drive filing"
          index="C05"
          action={
            unconfirmed.length > 0 ? (
              <Tag tone="watch">
                <Num>{unconfirmed.length}</Num>
                <span className="ms-1">To confirm</span>
              </Tag>
            ) : (
              <Tag tone="ok">All confirmed</Tag>
            )
          }
        />
      </div>

      <p className="px-[18px] pb-3 font-semi text-[11px] leading-relaxed text-neutral-500">
        Every contract files to{' '}
        <Num>/{DRIVE_ROOT}/&lt;category&gt;/&lt;counterparty&gt;/&lt;stage&gt;</Num>, versioned, never
        overwritten. A category nobody has confirmed goes to <Num>_Unclassified</Num> rather than
        being guessed into the wrong folder.
      </p>

      {tree.length === 0 ? (
        <p className="border-t border-line px-[18px] py-3 font-semi text-[12px] text-neutral-500">
          No contracts filed yet.
        </p>
      ) : (
        <ul className="border-t border-line">
          {tree.map((node) => (
            <li key={node.label} className="border-b border-line px-[18px] py-3 last:border-b-0">
              <p className="font-semi text-[11px] tracking-[0.16em] text-info">
                <Num>/{node.label}</Num>
              </p>
              <ul className="mt-1 space-y-0.5">
                {node.counterparties.map((c) => (
                  <li
                    key={c.name}
                    className="flex items-baseline justify-between gap-3 font-semi text-[12px] text-neutral-600"
                  >
                    <span className="truncate">
                      <Num>{c.path}</Num>
                    </span>
                    <span className="shrink-0 text-[11.5px] tracking-[0.12em] text-neutral-500">
                      <Num>{c.count}</Num> DOC{c.count === 1 ? '' : 'S'}
                      {c.confirmed ? '' : ' · UNCONFIRMED'}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </HudCard>
  );
}

