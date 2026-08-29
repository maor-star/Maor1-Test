'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PipelineClientForm } from './client-form';

/** The add form stays folded away — the page is for working the list, not filling it. */
export function AddPipelineClient({ owners }: { owners: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        ADD CLIENT
      </Button>
    );
  }

  return (
    <div className="w-full border border-divider p-3">
      <PipelineClientForm owners={owners} onDone={() => setOpen(false)} />
    </div>
  );
}
