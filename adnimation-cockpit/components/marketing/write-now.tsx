'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { writeDraftsAction } from '@/app/actions/marketing';
import { Button } from '@/components/ui/button';

/**
 * "Write what is worth posting" — the same run the agent does on its schedule,
 * on demand. It reads the wins, writes the drafts, and stops there.
 */
export function WriteNow() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await writeDraftsAction();
            setMessage(result.ok ? (result.message ?? 'Done') : (result.error ?? 'That did not work'));
            router.refresh();
          })
        }
      >
        {pending ? 'READING WHAT WENT RIGHT…' : 'WRITE WHAT IS WORTH POSTING'}
      </Button>
      {message ? (
        <span className="font-semi text-[11px] tracking-[0.06em] text-neutral-600">{message}</span>
      ) : null}
    </div>
  );
}
