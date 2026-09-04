'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CompanyForm, ContactForm } from './record-forms';

/**
 * Adding a record that was never in HubSpot.
 *
 * Folded away by default — the page is for working the book, not filling it —
 * and it adds to whichever view is open, so the button never creates the wrong
 * kind of thing.
 */
export function AddCrmRecord({
  view,
  vocab,
  companies,
}: {
  view: 'companies' | 'contacts';
  vocab: { stages: { value: string; label: string }[]; owners: string[] };
  companies: string[];
}) {
  const [open, setOpen] = useState(false);
  const label = view === 'companies' ? 'ADD COMPANY' : 'ADD CONTACT';

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  return (
    <div className="border border-line p-3">
      {view === 'companies' ? (
        <CompanyForm vocab={vocab} onDone={() => setOpen(false)} />
      ) : (
        <ContactForm vocab={vocab} companies={companies} onDone={() => setOpen(false)} />
      )}
    </div>
  );
}
