'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useUndo } from '@/components/ui/undo-bar';
import {
  archiveCrmRecordAction, saveCompanyAction, saveContactAction,
} from '@/app/actions/crm';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';

/**
 * Editing the CRM in place.
 *
 * HubSpot is going away, so every record has to be editable here — and a record
 * edited here is frozen against future syncs, which the caller says out loud
 * rather than leaving as a surprise.
 *
 * The stage list is passed in from the values the book actually holds, plus the
 * standard ones, so an existing category is never quietly dropped by an edit.
 */

export interface CompanyRecord {
  hubspotId: string;
  name: string;
  domain: string | null;
  lifecycleStage: string | null;
  ownerName: string | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  phone: string | null;
  notes: string | null;
}

export interface ContactRecord {
  hubspotId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  companyId: string | null;
  companyName: string | null;
  lifecycleStage: string | null;
  ownerName: string | null;
  notes: string | null;
}

interface Vocab {
  stages: { value: string; label: string }[];
  owners: string[];
}

function useSubmit(action: (data: FormData) => Promise<{
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}>, onDone?: () => void, reset = false) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const undo = useUndo();

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await action(formData);
      setErrors(result.fieldErrors ?? {});
      setFormError(result.ok ? null : (result.error ?? null));
      if (result.ok) {
        if (reset) formRef.current?.reset();
        undo.offer();
        router.refresh();
        onDone?.();
      }
    });
  };

  return { pending, errors, formError, formRef, submit };
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="mt-0.5 text-2xs text-destructive">{messages[0]}</p>;
}

/** A select that keeps a value the list does not offer, rather than losing it. */
function StageSelect({
  id,
  value,
  stages,
}: {
  id: string;
  value: string | null;
  stages: { value: string; label: string }[];
}) {
  const known = stages.some((s) => s.value === value);
  return (
    <Select id={id} name="lifecycleStage" defaultValue={value ?? ''} className="w-full">
      <option value="">Unstaged</option>
      {!known && value ? <option value={value}>{value.toUpperCase()}</option> : null}
      {stages.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </Select>
  );
}

export function CompanyForm({
  company,
  vocab,
  onDone,
}: {
  company?: CompanyRecord;
  vocab: Vocab;
  onDone?: () => void;
}) {
  const key = company?.hubspotId ?? 'new';
  const { pending, errors, formError, formRef, submit } = useSubmit(
    saveCompanyAction,
    onDone,
    !company,
  );

  return (
    <form ref={formRef} action={submit} className="space-y-2">
      {company ? <input type="hidden" name="id" value={company.hubspotId} /> : null}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="sm:col-span-2">
          <Label htmlFor={`co-name-${key}`}>Company</Label>
          <Input id={`co-name-${key}`} name="name" required defaultValue={company?.name} />
          <FieldError messages={errors.name} />
        </div>

        <div>
          <Label htmlFor={`co-domain-${key}`}>Domain</Label>
          <Input id={`co-domain-${key}`} name="domain" defaultValue={company?.domain ?? ''} />
        </div>

        <div>
          <Label htmlFor={`co-stage-${key}`}>Type</Label>
          <StageSelect id={`co-stage-${key}`} value={company?.lifecycleStage ?? null} stages={vocab.stages} />
        </div>

        <div>
          <Label htmlFor={`co-owner-${key}`}>Owner</Label>
          <Input
            id={`co-owner-${key}`}
            name="ownerName"
            list={`owners-${key}`}
            defaultValue={company?.ownerName ?? ''}
          />
          <datalist id={`owners-${key}`}>
            {vocab.owners.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </div>

        <div>
          <Label htmlFor={`co-industry-${key}`}>Industry</Label>
          <Input id={`co-industry-${key}`} name="industry" defaultValue={company?.industry ?? ''} />
        </div>

        <div>
          <Label htmlFor={`co-country-${key}`}>Country</Label>
          <Input id={`co-country-${key}`} name="country" defaultValue={company?.country ?? ''} />
        </div>

        <div>
          <Label htmlFor={`co-city-${key}`}>City</Label>
          <Input id={`co-city-${key}`} name="city" defaultValue={company?.city ?? ''} />
        </div>

        <div>
          <Label htmlFor={`co-phone-${key}`}>Phone</Label>
          <Input id={`co-phone-${key}`} name="phone" dir="ltr" defaultValue={company?.phone ?? ''} />
        </div>

        <div className="sm:col-span-2 xl:col-span-4">
          <Label htmlFor={`co-notes-${key}`}>Notes</Label>
          <Textarea id={`co-notes-${key}`} name="notes" rows={2} defaultValue={company?.notes ?? ''} />
        </div>
      </div>

      <Actions
        pending={pending}
        formError={formError}
        editing={Boolean(company)}
        onDone={onDone}
        saveLabel="ADD COMPANY"
      />
    </form>
  );
}

export function ContactForm({
  contact,
  vocab,
  companies,
  onDone,
}: {
  contact?: ContactRecord;
  vocab: Vocab;
  companies: string[];
  onDone?: () => void;
}) {
  const key = contact?.hubspotId ?? 'new';
  const { pending, errors, formError, formRef, submit } = useSubmit(
    saveContactAction,
    onDone,
    !contact,
  );

  return (
    <form ref={formRef} action={submit} className="space-y-2">
      {contact ? <input type="hidden" name="id" value={contact.hubspotId} /> : null}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <Label htmlFor={`ct-first-${key}`}>First name</Label>
          <Input id={`ct-first-${key}`} name="firstName" defaultValue={contact?.firstName ?? ''} />
          <FieldError messages={errors.firstName} />
        </div>

        <div>
          <Label htmlFor={`ct-last-${key}`}>Last name</Label>
          <Input id={`ct-last-${key}`} name="lastName" defaultValue={contact?.lastName ?? ''} />
        </div>

        <div>
          <Label htmlFor={`ct-email-${key}`}>Email</Label>
          <Input
            id={`ct-email-${key}`}
            name="email"
            type="email"
            dir="ltr"
            defaultValue={contact?.email ?? ''}
          />
          <FieldError messages={errors.email} />
        </div>

        <div>
          <Label htmlFor={`ct-phone-${key}`}>Phone</Label>
          <Input id={`ct-phone-${key}`} name="phone" dir="ltr" defaultValue={contact?.phone ?? ''} />
        </div>

        <div>
          <Label htmlFor={`ct-title-${key}`}>Title</Label>
          <Input id={`ct-title-${key}`} name="jobTitle" defaultValue={contact?.jobTitle ?? ''} />
        </div>

        <div>
          <Label htmlFor={`ct-company-${key}`}>Company</Label>
          {/* Typed, not picked: the book holds sixty thousand companies. The
              suggestions are the ones that already have people; anything else
              is accepted and matched on the server, or kept as plain text. */}
          <Input
            id={`ct-company-${key}`}
            name="companyName"
            list={`companies-${key}`}
            defaultValue={contact?.companyName ?? ''}
            placeholder="Start typing a company"
          />
          <datalist id={`companies-${key}`}>
            {companies.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <input type="hidden" name="companyId" value={contact?.companyId ?? ''} />
        </div>

        <div>
          <Label htmlFor={`ct-stage-${key}`}>Type</Label>
          <StageSelect id={`ct-stage-${key}`} value={contact?.lifecycleStage ?? null} stages={vocab.stages} />
        </div>

        <div>
          <Label htmlFor={`ct-owner-${key}`}>Owner</Label>
          <Input
            id={`ct-owner-${key}`}
            name="ownerName"
            list={`ct-owners-${key}`}
            defaultValue={contact?.ownerName ?? ''}
          />
          <datalist id={`ct-owners-${key}`}>
            {vocab.owners.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </div>

        <div className="sm:col-span-2 xl:col-span-4">
          <Label htmlFor={`ct-notes-${key}`}>Notes</Label>
          <Textarea id={`ct-notes-${key}`} name="notes" rows={2} defaultValue={contact?.notes ?? ''} />
        </div>
      </div>

      <Actions
        pending={pending}
        formError={formError}
        editing={Boolean(contact)}
        onDone={onDone}
        saveLabel="ADD CONTACT"
      />
    </form>
  );
}

function Actions({
  pending,
  formError,
  editing,
  onDone,
  saveLabel,
}: {
  pending: boolean;
  formError: string | null;
  editing: boolean;
  onDone?: () => void;
  saveLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={pending}>
        {pending ? 'SAVING…' : editing ? 'SAVE' : saveLabel}
      </Button>
      {onDone ? (
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      ) : null}
      {editing ? (
        <span className="font-semi text-[11.5px] tracking-[0.1em] text-neutral-500">
          Saving marks this record as yours — no future sync will overwrite it
        </span>
      ) : null}
      {formError ? <span className="text-2xs text-destructive">{formError}</span> : null}
    </div>
  );
}

/** Retire a record, or bring it back. Never deletes. */
export function ArchiveButton({
  id,
  kind,
  archived,
}: {
  id: string;
  kind: 'company' | 'contact';
  archived: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const undo = useUndo();

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="xs"
        variant={archived ? 'outline' : 'ghost'}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const data = new FormData();
            data.set('id', id);
            data.set('kind', kind);
            if (archived) data.set('restore', '1');
            const result = await archiveCrmRecordAction(data);
            setError(result.ok ? null : (result.error ?? 'Could not do that'));
            if (result.ok) {
              undo.offer();
              router.refresh();
            }
          })
        }
      >
        {pending ? '…' : archived ? 'RESTORE' : 'ARCHIVE'}
      </Button>
      {error ? <span className="text-2xs text-destructive">{error}</span> : null}
    </span>
  );
}

/**
 * Opens a record's form in place.
 *
 * The record and its vocabulary are plain data, which is the point: a render
 * prop would be a function crossing the server boundary, and React refuses
 * those — the page 500s rather than degrading, so it has to be props.
 */
export function EditCompany({ company, vocab }: { company: CompanyRecord; vocab: Vocab }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" size="xs" variant="outline" onClick={() => setOpen(true)}>
        Edit
      </Button>
    );
  }

  return (
    <div className="mt-2 border border-line p-2">
      <CompanyForm company={company} vocab={vocab} onDone={() => setOpen(false)} />
    </div>
  );
}

export function EditContact({
  contact,
  vocab,
  companies,
}: {
  contact: ContactRecord;
  vocab: Vocab;
  companies: string[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" size="xs" variant="outline" onClick={() => setOpen(true)}>
        Edit
      </Button>
    );
  }

  return (
    <div className="mt-2 border border-line p-2">
      <ContactForm
        contact={contact}
        vocab={vocab}
        companies={companies}
        onDone={() => setOpen(false)}
      />
    </div>
  );
}
