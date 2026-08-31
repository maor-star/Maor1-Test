'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { killSwitchAction, seedAgentsAction } from '@/app/actions/agents';
import { Button } from '@/components/ui/button';

/**
 * The two controls that apply to everything: install the built-in agents, and
 * stop them all.
 *
 * The kill switch is the one control on this page that must work when
 * everything else is going wrong, so it is a single button with no
 * confirmation — hesitating in front of a dialog is not what anyone wants from
 * a stop button.
 */
export function AgentControls({ killed }: { killed: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  const run = (
    action: (f: FormData) => Promise<{ ok: boolean; error?: string; message?: string }>,
    data: FormData,
  ) =>
    startTransition(async () => {
      const result = await action(data);
      setMessage(result.ok ? (result.message ?? null) : (result.error ?? 'That did not work'));
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => startTransition(async () => {
          const result = await seedAgentsAction();
          setMessage(result.message ?? null);
          router.refresh();
        })}
      >
        INSTALL THE BUILT-IN AGENTS
      </Button>

      <Button
        type="button"
        size="sm"
        variant={killed ? 'default' : 'ghost'}
        disabled={pending}
        onClick={() => {
          const data = new FormData();
          data.set('on', killed ? '0' : '1');
          run(killSwitchAction, data);
        }}
        title={killed ? 'Let agents run again' : 'Stop every agent immediately'}
      >
        {killed ? 'RESUME ALL AGENTS' : 'STOP EVERYTHING'}
      </Button>

      {message ? (
        <span className="font-semi text-[10px] tracking-[0.1em] text-neutral-500">{message}</span>
      ) : null}
    </div>
  );
}
