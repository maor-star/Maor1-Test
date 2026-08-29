'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { logTouchAction } from '@/app/actions/pipeline';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { TOUCH_KINDS } from '@/lib/pipeline/types';

/**
 * Logging a conversation. One line, inline — the friction of a modal is the
 * reason CRM contact histories end up empty.
 */
export function TouchForm({ clientId, onDone }: { clientId: string; onDone?: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={formRef}
      className="flex flex-wrap items-center gap-2"
      action={(formData) => {
        startTransition(async () => {
          const result = await logTouchAction(formData);
          setError(result.ok ? null : (result.error ?? 'Could not log it'));
          if (result.ok) {
            formRef.current?.reset();
            router.refresh();
            onDone?.();
          }
        });
      }}
    >
      <input type="hidden" name="clientId" value={clientId} />
      <label className="sr-only" htmlFor={`touch-kind-${clientId}`}>
        Kind
      </label>
      <Select id={`touch-kind-${clientId}`} name="kind" defaultValue="call" className="h-8">
        {TOUCH_KINDS.map((k) => (
          <option key={k} value={k}>
            {k.toUpperCase()}
          </option>
        ))}
      </Select>
      <label className="sr-only" htmlFor={`touch-summary-${clientId}`}>
        What happened
      </label>
      <Input
        id={`touch-summary-${clientId}`}
        name="summary"
        required
        placeholder="What was said, and what it changes"
        className="min-w-0 flex-1 sm:w-72"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'LOGGING…' : 'LOG'}
      </Button>
      {error ? <span className="text-2xs text-destructive">{error}</span> : null}
    </form>
  );
}
