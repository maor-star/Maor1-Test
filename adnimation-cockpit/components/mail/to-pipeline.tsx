'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { pipelineSuggestionAction } from '@/app/actions/mail';
import { savePipelineClientAction } from '@/app/actions/pipeline';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { CLIENT_TYPES, CLIENT_TYPE_LABEL, STAGES, STAGE_LABEL } from '@/lib/pipeline/types';

/**
 * A conversation into the pipeline, from the mail screen.
 *
 * The path used to be two screens — capture it as an opportunity, go to
 * opportunities, promote it — which is right for something he noticed and has
 * not acted on, and wrong for a mail that IS the deal starting.
 *
 * The one thing the thread cannot supply is the next step, and the pipeline
 * refuses a deal without one, so the form opens filled in from the mail with
 * the next step suggested and the date defaulted. He confirms rather than
 * types, and nothing is written until he does.
 */
export function ToPipeline({ threadId }: { threadId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [seed, setSeed] = useState<{
    name: string;
    domain: string;
    nextStep: string;
    notes: string;
    source: string;
  } | null>(null);
  const router = useRouter();

  const inThreeDays = () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  };

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (seed) return;
    setLoading(true);
    pipelineSuggestionAction(threadId)
      .then((r) => {
        if (r.ok) {
          setSeed(r.suggestion);
          setExisting(r.existingClientId);
        } else {
          setError(r.error ?? 'Could not read the conversation');
        }
      })
      .catch(() => setError('Could not read the conversation'))
      .finally(() => setLoading(false));
  };

  if (saved) {
    return (
      <Link
        href="/pipeline"
        className="font-semi text-[10px] uppercase tracking-[0.14em] text-accent-700 hover:text-accent"
      >
        In the pipeline ↗
      </Link>
    );
  }

  return (
    <>
      <Button type="button" size="xs" variant="ghost" onClick={toggle} title="Start a deal from this conversation">
        {open ? 'CLOSE' : '→ PIPELINE'}
      </Button>

      {open ? (
        <div className="mt-2 w-full border border-divider p-2">
          {loading ? (
            <p className="text-[13px] text-neutral-500">Reading the conversation…</p>
          ) : error ? (
            <p className="text-[13px] text-sev-warning">{error}</p>
          ) : seed ? (
            <form
              action={(formData) => {
                savePipelineClientAction(formData)
                  .then((r) => {
                    if (r.ok) {
                      setSaved(true);
                      router.refresh();
                    } else {
                      setError(r.error ?? 'Could not save it');
                    }
                  })
                  .catch(() => setError('Could not save it'));
              }}
            >
              {/*
                Already on the board under the same domain: this is a
                conversation with a deal he already has, and a second row for
                it is worse than none.
              */}
              {existing ? (
                <p className="mb-2 text-[12px] text-sev-warning">
                  There is already a deal for this domain.{' '}
                  <Link href="/pipeline" className="underline">
                    Open the pipeline
                  </Link>{' '}
                  — saving this makes a second one.
                </p>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <div>
                  <Label htmlFor={`p-name-${threadId}`}>Client</Label>
                  <Input id={`p-name-${threadId}`} name="name" defaultValue={seed.name} required />
                </div>
                <div>
                  <Label htmlFor={`p-domain-${threadId}`}>Domain</Label>
                  <Input id={`p-domain-${threadId}`} name="domain" defaultValue={seed.domain} />
                </div>
                <div>
                  <Label htmlFor={`p-type-${threadId}`}>What kind</Label>
                  <Select id={`p-type-${threadId}`} name="clientType" defaultValue="demand" className="w-full">
                    {CLIENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {CLIENT_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor={`p-stage-${threadId}`}>Stage</Label>
                  <Select id={`p-stage-${threadId}`} name="stage" defaultValue="contact" className="w-full">
                    {STAGES.map((st) => (
                      <option key={st} value={st}>
                        {STAGE_LABEL[st]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor={`p-next-${threadId}`}>Next step</Label>
                  <Input id={`p-next-${threadId}`} name="nextStep" defaultValue={seed.nextStep} required />
                </div>
                <div>
                  <Label htmlFor={`p-date-${threadId}`}>By when</Label>
                  <Input
                    id={`p-date-${threadId}`}
                    name="nextStepDate"
                    type="date"
                    defaultValue={inThreeDays()}
                    required
                  />
                </div>
              </div>

              <input type="hidden" name="source" value={seed.source} />
              <input type="hidden" name="notes" value={seed.notes} />

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button type="submit" size="sm">
                  ADD TO THE PIPELINE
                </Button>
                <span className="font-semi text-[10px] tracking-[0.1em] text-neutral-500">
                  THE SUBJECT AND A LINK BACK TO THE THREAD GO IN WITH IT
                </span>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
