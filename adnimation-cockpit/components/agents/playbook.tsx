'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPlaybookAction } from '@/app/actions/agents';
import { Button } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/input';
import { Num } from '@/components/num';
import { useUndo } from '@/components/ui/undo-bar';
import { fmtDateTime } from '@/lib/utils';

/**
 * The document behind an agent.
 *
 * It already had two kinds of instruction and neither was the right place for
 * this. The dials are named, bounded values the code reads directly. The brief
 * is a note — the handful of corrections nobody could have anticipated. What
 * was missing is the thing in between and longer than both: how this job is
 * actually done. What counts and what never does, how to word it, who to ask,
 * the examples worth copying.
 *
 * Typed or dropped in as a file. Either way what is kept is the words: the
 * agent reads them at the top of every run, before anything is decided, and
 * the filename is only a label so he can see which document is loaded.
 */
const READABLE = /\.(txt|md|markdown|csv|json|ya?ml|log)$/i;

export function AgentPlaybook({
  agentId,
  playbook,
  playbookName,
  updatedAt,
  hint,
  onClose,
}: {
  agentId: string;
  playbook: string | null;
  playbookName: string | null;
  updatedAt: Date | null;
  /** What a good playbook for this particular agent would say. */
  hint: string;
  onClose: () => void;
}) {
  const [text, setText] = useState(playbook ?? '');
  const [name, setName] = useState(playbookName ?? '');
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const undo = useUndo();

  const save = (body: string, label: string) => {
    const data = new FormData();
    data.set('id', agentId);
    data.set('playbook', body);
    data.set('name', label);
    startTransition(async () => {
      const result = await setPlaybookAction(data);
      setMessage(result.ok ? (result.message ?? 'Saved') : (result.error ?? 'That did not work'));
      if (result.ok) {
        undo.offer();
        router.refresh();
      }
    });
  };

  const load = async (file: File) => {
    if (!READABLE.test(file.name)) {
      setMessage(`${file.name} is not a text document. Paste the words in instead.`);
      return;
    }
    const body = await file.text();
    setText(body);
    setName(file.name);
    setMessage(`Loaded ${file.name}. Read it, then save it.`);
  };

  return (
    <div className="mt-2 border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="hud-label text-[11px]">
          ITS PLAYBOOK — READ AT THE TOP OF EVERY RUN
          {playbookName ? ` · ${playbookName}` : ''}
          {updatedAt ? (
            <>
              {' · '}
              <Num>{fmtDateTime(updatedAt)}</Num>
            </>
          ) : null}
        </p>
        <span className="font-semi text-[11.5px] tracking-[0.1em] text-neutral-500">
          <Num>{text.length}</Num> Characters
        </span>
      </div>

      <Label htmlFor={`pb-${agentId}`} className="mt-2 block">
        How this job is done — the whole of it, in your words
      </Label>
      <Textarea
        id={`pb-${agentId}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={16}
        placeholder={hint}
        className="mt-1 w-full font-mono text-[12px] leading-relaxed"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => save(text, name)}>
          {pending ? 'SAVING…' : 'SAVE THE PLAYBOOK'}
        </Button>

        {/* A document he already wrote is a document he should not retype. */}
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.markdown,.csv,.json,.yaml,.yml,.log,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void load(file);
            e.target.value = '';
          }}
        />
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => fileRef.current?.click()}>
          Load a document
        </Button>

        {playbook ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setText('');
              setName('');
              save('', '');
            }}
          >
            Remove it
          </Button>
        ) : null}

        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>

        {message ? (
          <span className="font-semi text-[11.5px] tracking-[0.1em] text-info">{message}</span>
        ) : null}
      </div>

      <p className="mt-2 font-semi text-[11.5px] leading-relaxed tracking-[0.06em] text-neutral-500">
        The dials are values the code obeys. the brief is your corrections. this is the job itself —
        it goes into every run, so say what matters and leave out what does not.
      </p>
    </div>
  );
}
