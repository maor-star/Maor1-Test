'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { checkRepliesAction } from '@/app/actions/delegations';
import { Button } from '@/components/ui/button';

/**
 * Reads Slack and email for answers to what was handed off.
 *
 * On demand rather than on load: it costs an API call per open delegation, and
 * the result is reported plainly — including "nothing is connected", which is
 * the honest reason for a zero that would otherwise look like silence.
 */
export function CheckReplies() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const router = useRouter();

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await checkRepliesAction();
            setFailed(!result.ok);
            setMessage(
              result.ok
                ? `Checked ${result.checked}, ${result.found} answered.`
                : (result.error ?? 'Could not check for replies'),
            );
            if (result.ok) router.refresh();
          })
        }
      >
        {pending ? 'READING…' : 'CHECK FOR REPLIES'}
      </Button>
      {message ? (
        <span
          className={`font-semi text-[10px] tracking-[0.1em] ${
            failed ? 'text-sev-warning' : 'text-neutral-500'
          }`}
        >
          {message}
        </span>
      ) : null}
    </span>
  );
}
