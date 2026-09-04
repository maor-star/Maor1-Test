'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sweepMailAction } from '@/app/actions/opportunities';
import { Button } from '@/components/ui/button';

/**
 * Read the mirrored mail for things worth proposing, now.
 *
 * The same sweep runs on a timer; this is for when he wants to see the effect
 * of mail that has just arrived rather than wait for the next run.
 */
export function SweepMail() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await sweepMailAction();
            setMessage(result.ok ? (result.warning ?? 'Done') : (result.error ?? 'That did not work'));
            if (result.ok) router.refresh();
          })
        }
      >
        {pending ? 'READING THE MAIL…' : 'SCAN MAIL NOW'}
      </Button>
      {message ? (
        <span className="font-semi text-[11.5px] tracking-[0.1em] text-neutral-500">{message}</span>
      ) : null}
    </div>
  );
}
