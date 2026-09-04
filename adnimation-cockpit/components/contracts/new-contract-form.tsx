'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createContractAction } from '@/app/actions/contracts';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { CATEGORY_FOLDER, CONTRACT_CATEGORIES } from '@/lib/contracts/drive';
import { CONTRACT_STATUSES, STATUS_LABEL } from '@/lib/contracts/status';

const DOC_TYPES = ['IO', 'MSA', 'NDA', 'Amendment', 'Renewal', 'SOW'];

/** Statuses a contract can be created in — you cannot file one straight to expired. */
const OPENING_STATUSES = CONTRACT_STATUSES.filter(
  (s) => s !== 'expired' && s !== 'cancelled',
);

/**
 * Spec 9.2 — the contract record. Kept to one row of fields plus an optional
 * second, because a contract usually gets entered between two other things.
 */
export function NewContractForm({ departments }: { departments: { id: string; label: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={formRef}
      className="space-y-2"
      action={(formData) => {
        startTransition(async () => {
          const result = await createContractAction(formData);
          setErrors(result.fieldErrors ?? {});
          setFormError(result.ok ? null : (result.error ?? null));
          if (result.ok) {
            formRef.current?.reset();
            setExpanded(false);
            router.refresh();
          }
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-52 flex-1">
          <Label htmlFor="new-contract-counterparty">Counterparty</Label>
          <Input
            id="new-contract-counterparty"
            name="counterparty"
            required
            placeholder="PubMatic"
          />
          {errors.counterparty ? (
            <p className="mt-0.5 text-2xs text-destructive">{errors.counterparty[0]}</p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="new-contract-category">Drive category</Label>
          <Select id="new-contract-category" name="category" defaultValue="demand">
            {CONTRACT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_FOLDER[c]}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="new-contract-doctype">Document</Label>
          <Select id="new-contract-doctype" name="docType" defaultValue="IO">
            {DOC_TYPES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="new-contract-status">Status</Label>
          <Select id="new-contract-status" name="status" defaultValue="draft">
            {OPENING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="new-contract-value">Value (USD)</Label>
          <Input id="new-contract-value" name="value" type="number" min="0" step="1" dir="ltr" />
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? 'SAVING…' : 'ADD CONTRACT'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'FEWER FIELDS' : 'TERM & RENEWAL'}
        </Button>
      </div>

      {expanded ? (
        <div className="grid gap-2 border-t border-line pt-2 md:grid-cols-3 xl:grid-cols-6">
          <div>
            <Label htmlFor="new-contract-dept">Department</Label>
            <Select id="new-contract-dept" name="deptId" defaultValue="" className="w-full">
              <option value="">None</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="new-contract-start">Start date</Label>
            <Input id="new-contract-start" name="startDate" type="date" />
          </div>
          <div>
            <Label htmlFor="new-contract-end">End date</Label>
            <Input id="new-contract-end" name="endDate" type="date" />
          </div>
          <div>
            <Label htmlFor="new-contract-renewal">Renewal</Label>
            <Select id="new-contract-renewal" name="renewal" defaultValue="" className="w-full">
              <option value="">Unknown</option>
              <option value="auto">Auto-renews</option>
              <option value="manual">Manual</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="new-contract-notice">Notice period (days)</Label>
            <Input
              id="new-contract-notice"
              name="noticePeriodDays"
              type="number"
              min="0"
              max="365"
              dir="ltr"
            />
          </div>
          <div>
            <Label htmlFor="new-contract-owner">Legal owner</Label>
            <Input id="new-contract-owner" name="legalOwner" placeholder="Ravit" />
          </div>
        </div>
      ) : null}

      {formError ? <p className="text-2xs text-destructive">{formError}</p> : null}
    </form>
  );
}
