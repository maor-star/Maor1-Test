'use client';

import { useState } from 'react';
import { opportunityForEditAction } from '@/app/actions/opportunities';
import { Button } from '@/components/ui/button';
import { OpportunityCard } from '@/components/opportunities/opportunity-card';
import type { OpportunityListItem } from '@/lib/opportunities/rules';

/**
 * The whole opportunity, from wherever it is listed.
 *
 * It opens the same card the opportunities screen uses — every field, the
 * status control, promoting it into the pipeline — rather than a second,
 * smaller editor that would drift out of step with the first one.
 */
export function InlineOpportunityEditor({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState<OpportunityListItem | null>(null);
  const [contracts, setContracts] = useState<
    { id: string; counterparty: string; status: string; waitingOn: string }[]
  >([]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (row) return;
    setLoading(true);
    opportunityForEditAction(id)
      .then((r) => {
        if (r.ok) {
          setRow(r.opportunity);
          setContracts(r.contracts);
        }
        else setError(r.error ?? 'Could not open it');
      })
      .catch(() => setError('Could not open it'))
      .finally(() => setLoading(false));
  };

  return (
    <>
      <Button type="button" size="xs" variant={open ? 'default' : 'ghost'} onClick={toggle}>
        {open ? 'CLOSE' : 'EDIT'}
      </Button>

      {open ? (
        <div className="mt-2 w-full border border-divider">
          {loading ? (
            <p className="px-2 py-2 text-[13px] text-neutral-500">Opening it…</p>
          ) : error ? (
            <p className="px-2 py-2 text-[13px] text-sev-warning">{error}</p>
          ) : row ? (
            <ul className="px-2">
              <OpportunityCard opportunity={row} contracts={contracts} />
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
