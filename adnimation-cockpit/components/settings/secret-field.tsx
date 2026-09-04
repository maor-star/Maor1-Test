'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setSecretAction } from '@/app/actions/secrets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { fmtDateTime } from '@/lib/utils';
import type { SecretSpec } from '@/lib/secrets/catalogue';
import type { SecretStatus } from '@/lib/secrets/store';

/**
 * One credential.
 *
 * The value is never sent back here — the field starts empty whether or not a
 * key is set, and what he sees instead is whether it is set, when, and its
 * last four characters. That is enough to tell two keys apart and not enough
 * to use one, which is the whole design.
 *
 * A key the deploy set in the environment is shown as such and cannot be
 * overwritten from here: it was put there on purpose, and a browser is not
 * where that decision gets reversed.
 */
export function SecretField({ spec, status }: { spec: SecretSpec; status: SecretStatus }) {
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  const fromEnv = status.from === 'environment';

  const save = (next: string) => {
    const data = new FormData();
    data.set('key', spec.key);
    data.set('value', next);
    startTransition(async () => {
      const result = await setSecretAction(data);
      setMessage(result.ok ? (result.message ?? 'Saved') : (result.error ?? 'That did not work'));
      if (result.ok) {
        setValue('');
        router.refresh();
      }
    });
  };

  return (
    <li className="border-t border-line px-[22px] py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[16px] font-semibold leading-none text-ink">{spec.label}</p>
        <span className="flex flex-wrap items-center gap-2">
          {fromEnv ? (
            <Tag tone="outline" title="Set on the server by a deploy — not editable here">
              Set on the server
            </Tag>
          ) : status.set ? (
            <Tag tone="ok">
              SET{status.hint ? ` · ${status.hint}` : ''}
            </Tag>
          ) : (
            <Tag tone="watch">Not set</Tag>
          )}
          {status.updatedAt ? (
            <span className="hud-label text-[11px]">
              <Num>{fmtDateTime(status.updatedAt)}</Num>
            </span>
          ) : null}
        </span>
      </div>

      <p className="mt-2 text-[14px] leading-relaxed text-neutral-700">{spec.unlocks}</p>
      <p className="hud-label mt-1 whitespace-normal text-[11px]">WHERE: {spec.where}</p>

      {fromEnv ? null : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            type={spec.public ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={status.set ? 'Paste a new value to replace it' : (spec.placeholder ?? 'Paste it here')}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            className="min-w-[18rem] flex-1 font-mono text-[13.5px]"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim()) save(value);
            }}
          />
          <Button type="button" size="sm" disabled={pending || !value.trim()} onClick={() => save(value)}>
            {pending ? 'SAVING…' : status.set ? 'REPLACE IT' : 'SAVE IT'}
          </Button>
          {status.set ? (
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => save('')}>
              Remove
            </Button>
          ) : null}
          {message ? (
            <span className="font-semi text-[11.5px] tracking-[0.1em] text-info">{message}</span>
          ) : null}
        </div>
      )}
    </li>
  );
}
