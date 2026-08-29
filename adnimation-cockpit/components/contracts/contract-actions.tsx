'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmCategoryAction, setContractStatusAction } from '@/app/actions/contracts';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { CATEGORY_FOLDER, type ContractCategory } from '@/lib/contracts/drive';
import { STATUS_LABEL, type ContractStatus } from '@/lib/contracts/status';

/**
 * The moves available on a contract row.
 *
 * Only forward moves are offered: a contract goes out, comes back, gets signed.
 * Reversing a status by hand would silently reset the chase clock, so that is
 * left to an explicit edit rather than a one-click control.
 */
const NEXT_MOVES: Partial<Record<ContractStatus, ContractStatus[]>> = {
  draft: ['negotiation', 'out_for_signature'],
  negotiation: ['out_for_signature', 'cancelled'],
  out_for_signature: ['awaiting_my_signature', 'signed', 'cancelled'],
  awaiting_my_signature: ['signed', 'cancelled'],
  signed: ['expired'],
};

export function ContractActions({ id, status }: { id: string; status: ContractStatus }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const moves = NEXT_MOVES[status] ?? [];

  if (moves.length === 0) return null;

  const move = (next: ContractStatus) => {
    const data = new FormData();
    data.set('id', id);
    data.set('status', next);
    startTransition(async () => {
      const result = await setContractStatusAction(data);
      setError(result.ok ? null : (result.error ?? 'Could not move the contract'));
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {moves.map((next) => (
        <Button
          key={next}
          type="button"
          size="xs"
          variant={next === 'signed' ? 'default' : 'outline'}
          disabled={pending}
          onClick={() => move(next)}
        >
          {STATUS_LABEL[next]}
        </Button>
      ))}
      {error ? <span className="text-2xs text-destructive">{error}</span> : null}
    </div>
  );
}

/** Clears the review flag by confirming — or correcting — where a contract is filed. */
export function ConfirmFiling({
  id,
  category,
}: {
  id: string;
  category: ContractCategory | null;
}) {
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<ContractCategory>(category ?? 'demand');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-1">
      <label className="sr-only" htmlFor={`filing-${id}`}>
        Drive category
      </label>
      <Select
        id={`filing-${id}`}
        value={choice}
        disabled={pending}
        onChange={(e) => setChoice(e.target.value as ContractCategory)}
        className="h-7 text-[12px]"
      >
        {(['demand', 'supply', 'general'] as const).map((c) => (
          <option key={c} value={c}>
            {CATEGORY_FOLDER[c]}
          </option>
        ))}
      </Select>
      <Button
        type="button"
        size="xs"
        disabled={pending}
        onClick={() => {
          const data = new FormData();
          data.set('id', id);
          data.set('category', choice);
          startTransition(async () => {
            const result = await confirmCategoryAction(data);
            setError(result.ok ? null : (result.error ?? 'Could not confirm the filing'));
            if (result.ok) router.refresh();
          });
        }}
      >
        {pending ? '…' : 'CONFIRM'}
      </Button>
      {error ? <span className="text-2xs text-destructive">{error}</span> : null}
    </div>
  );
}
