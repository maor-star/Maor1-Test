'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setContractStatusAction, confirmCategoryAction } from '@/app/actions/contracts';
import { CONTRACT_CATEGORIES } from '@/lib/contracts/drive';
import { CONTRACT_STATUSES, STATUS_LABEL } from '@/lib/contracts/status';
import {
  GROUP_COLOR, groupContracts, toneForContractStatus,
  type ContractGroup, type ContractGroupBy, type GroupableContract,
} from '@/lib/contracts/grouping';
import { DelegateCell } from '@/components/hud/delegate-cell';
import type { DelegationMark } from '@/lib/delegation/for-many';
import { InstantFilter } from '@/components/hud/instant-filter';
import { Num } from '@/components/num';
import { fmtMoney } from '@/lib/utils';
import { foldForSearch } from '@/lib/search';

/**
 * Every contract, in groups, the way the tasks table reads.
 *
 * He liked that screen and asked for this one to match it, so the shape and
 * the colours are the same ones — the group bar, the band showing how the
 * statuses divide up, cells that write themselves.
 *
 * What is different is what the groups can be cut by, because the question a
 * contract screen answers is not the one a task screen answers: "waiting on
 * whom" comes first, and HOW LONG groups by the chase ladder rather than by
 * round numbers, so a group heading and the chase it implies are the same
 * thing.
 */

/** Counterparty · status · filing · value · age · who has it. */
const COLS = 'minmax(0,1fr) 11rem 9.5rem 7.5rem 6rem 9rem';

/** One row, as this table needs it — the card view carries the rest. */
export interface ContractTableRow extends GroupableContract {
  statusLabel: string;
  categoryConfirmed: boolean;
  valueCents: number | null;
  drivePath: string | null;
  notes: string | null;
}

export function ContractGroupedView({
  rows,
  groupBy,
  people,
  delegated,
}: {
  rows: ContractTableRow[];
  groupBy: ContractGroupBy;
  people: { id: string; label: string }[];
  /** Contract id → who is holding it, fetched for the whole list at once. */
  delegated: Map<string, DelegationMark>;
}) {
  if (rows.length === 0) {
    return (
      <div className="hud-card p-6 text-center text-[14.5px] text-muted">
        No contracts match this filter.
      </div>
    );
  }

  const groups = groupContracts(rows, groupBy);

  return (
    <div className="space-y-3" id="contract-table">
      <InstantFilter scope="contract-table" />
      {groups.map((g) => (
        <Group key={g.key} group={g} people={people} delegated={delegated} />
      ))}
      <p className="px-1 text-[12.5px] text-muted">
        <Num>{rows.length}</Num> contracts in <Num>{groups.length}</Num> groups
      </p>
    </div>
  );
}

function Group({
  group,
  people,
  delegated,
}: {
  group: ContractGroup<ContractTableRow>;
  people: { id: string; label: string }[];
  delegated: Map<string, DelegationMark>;
}) {
  const [open, setOpen] = useState(true);
  const colour = GROUP_COLOR[group.tone];

  return (
    <section className="hud-card overflow-hidden p-0">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-[14px] py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 text-start"
        >
          <span
            aria-hidden
            className="inline-block h-[18px] w-[4px] shrink-0 rounded-full"
            style={{ background: colour }}
          />
          <span className="hud-label truncate text-[12.5px]" style={{ color: colour }}>
            {group.label}
          </span>
          <span className="text-[12px] text-muted">
            <Num>{group.rows.length}</Num>
          </span>
          <span aria-hidden className="text-[11px] text-muted">
            {open ? '▾' : '▸'}
          </span>
        </button>

        <span className="flex min-w-[9rem] flex-1 items-center gap-2">
          <span className="flex h-[8px] flex-1 overflow-hidden rounded-full bg-neutral-200">
            {group.mix.map((m) => (
              <span
                key={m.key}
                title={`${m.label}: ${m.count}`}
                style={{ width: `${m.share * 100}%`, background: GROUP_COLOR[m.tone] }}
              />
            ))}
          </span>
          <span
            className="shrink-0 font-mono text-[11.5px] text-muted"
            title="Signed, as a share of this group"
          >
            <Num>{`${Math.round(group.doneShare * 100)}%`}</Num>
          </span>
        </span>
      </header>

      {open ? (
        <>
          <div
            className="hidden border-b border-line px-[14px] py-1.5 md:grid"
            style={{ gridTemplateColumns: COLS }}
          >
            {['COUNTERPARTY', 'STATUS', 'FILING', 'VALUE', 'IN STATUS', 'DELEGATED TO'].map((h, i) => (
              <span
                key={h}
                className={`hud-label text-[10.5px] ${i === 0 ? 'text-start' : 'text-center'}`}
              >
                {h}
              </span>
            ))}
          </div>
          <ul>
            {group.rows.map((c) => (
              <Row key={c.id} contract={c} people={people} mark={delegated.get(c.id)} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function Row({
  contract,
  people,
  mark,
}: {
  contract: ContractTableRow;
  people: { id: string; label: string }[];
  mark: DelegationMark | undefined;
}) {
  const statusColour = GROUP_COLOR[toneForContractStatus(contract.status)];

  return (
    <li
      data-search={foldForSearch(
        contract.counterpartyName,
        contract.statusLabel,
        contract.category,
        contract.notes,
        contract.drivePath,
        // So searching a colleague's name finds what he handed them.
        mark?.personName,
      )}
      className="grid items-center gap-x-2 gap-y-1 border-b border-line px-[14px] py-1.5 last:border-b-0 hover:bg-neutral-50 md:gap-y-0"
      style={{ gridTemplateColumns: COLS }}
    >
      <span className="col-span-full min-w-0 md:col-span-1">
        <Link
          href={`/contracts/${contract.id}`}
          className="block truncate font-cond text-[15px] text-neutral-900 hover:text-accent"
          title={contract.counterpartyName}
        >
          {contract.counterpartyName}
        </Link>
        {contract.drivePath ? (
          <span className="block truncate text-[11.5px] text-muted" title={contract.drivePath}>
            {contract.drivePath}
          </span>
        ) : null}
      </span>

      <CellAction
        id={contract.id}
        field="status"
        value={contract.status}
        options={CONTRACT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
        action={setContractStatusAction}
        title="Status"
        className="rounded-[6px] text-white"
        style={{ background: statusColour }}
      />

      {/* Filing. An unconfirmed guess is marked, because the machine's guess
          and his decision are not the same thing and the Drive folder follows
          the second one. */}
      <CellAction
        id={contract.id}
        field="category"
        value={contract.category ?? ''}
        options={[
          ...(contract.category ? [] : [{ value: '', label: 'NEEDS CLASSIFYING' }]),
          ...CONTRACT_CATEGORIES.map((c) => ({ value: c, label: c.toUpperCase() })),
        ]}
        action={confirmCategoryAction}
        title={contract.categoryConfirmed ? 'Filing category' : 'A guess — pick to confirm it'}
        className={`text-[11.5px] text-ink ${contract.categoryConfirmed ? '' : 'italic opacity-70'}`}
      />

      <span className="text-center font-mono text-[12.5px] text-ink">
        {contract.valueCents === null ? (
          <span className="text-muted">—</span>
        ) : (
          <Num>{fmtMoney(contract.valueCents)}</Num>
        )}
      </span>

      <span className="text-center font-mono text-[12.5px] text-muted">
        <Num>{`${contract.daysInStatus}d`}</Num>
      </span>

      {/* Whether he passed it on, and to whom — the same cell the tasks table
          uses, so the colour means the same thing on both screens. */}
      <DelegateCell
        mark={mark}
        entityId={contract.id}
        entityType="contract"
        title={contract.counterpartyName}
        people={people}
      />
    </li>
  );
}

/**
 * A cell that writes itself through one of the contract actions.
 *
 * Same rule as the tasks table: saving on change rather than on a button,
 * because there is no button in a Monday cell and adding one would make the
 * row a form to fill in rather than a thing to nudge. A save that fails leaves
 * the old value showing — a row that reads as changed while the contract was
 * not is worse than one that plainly refused.
 */
function CellAction({
  id,
  field,
  value,
  options,
  action,
  title,
  className,
  style,
}: {
  id: string;
  field: 'status' | 'category';
  value: string;
  options: { value: string; label: string }[];
  action: (data: FormData) => Promise<{ ok: boolean; error?: string }>;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <select
      aria-label={title ?? field}
      title={error ?? title}
      disabled={pending}
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        if (!next) return;
        const data = new FormData();
        data.set('id', id);
        data.set(field, next);
        setError(null);
        startTransition(async () => {
          const result = await action(data);
          setError(result.ok ? null : (result.error ?? 'That did not save'));
          router.refresh();
        });
      }}
      className={`w-full cursor-pointer appearance-none border-0 bg-transparent px-2 py-1.5 text-center text-[12px] font-bold uppercase tracking-[0.06em] outline-none focus-visible:ring-2 focus-visible:ring-info ${
        pending ? 'opacity-60' : ''
      } ${error ? 'ring-2 ring-neg' : ''} ${className ?? ''}`}
      style={style}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-card text-ink">
          {o.label}
        </option>
      ))}
    </select>
  );
}
