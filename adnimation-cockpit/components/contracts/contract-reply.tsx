'use client';

import { useState } from 'react';
import { redlineAction } from '@/app/actions/contract-intake';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/hud/tag';
import type { Redline } from '@/lib/contracts/redline';

/**
 * Answering a contract, side by side.
 *
 * The left column is the clause as it stands, quoted from the document; the
 * right is what to send back. Side by side rather than a list of instructions,
 * because the question he is actually answering is "would I sign that instead
 * of this", and that is a comparison.
 *
 * The email is drafted here and sent by him. Nothing on this screen changes
 * the document or reaches the counterparty — §6.1 puts sending an external
 * document among the irreversible actions, and the point of showing the diff
 * first is that he sees it before anyone else does.
 */
const SEVERITY_TONE = {
  blocking: 'critical',
  important: 'watch',
  minor: 'neutral',
} as const;

export function ContractReply({
  contractId,
  versionId,
  fileName,
  counterparty,
}: {
  contractId: string;
  versionId: string;
  fileName: string;
  counterparty: string;
}) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    { redline: Redline; versionNo?: number; usedBrief?: boolean } | null
  >(null);
  const [copied, setCopied] = useState<string | null>(null);

  const run = () => {
    setWorking(true);
    setError(null);
    setOpen(true);
    redlineAction(contractId, versionId)
      .then((r) => {
        if (r.ok && 'redline' in r && r.redline) {
          setResult({
            redline: r.redline,
            ...('versionNo' in r ? { versionNo: r.versionNo } : {}),
            ...('usedBrief' in r ? { usedBrief: r.usedBrief } : {}),
          });
        } else {
          setError(('error' in r && r.error) || 'Could not prepare a reply');
        }
      })
      .catch(() => setError('Could not prepare a reply'))
      .finally(() => setWorking(false));
  };

  const copy = (what: string, text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(what);
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => setError('Could not copy it'));
  };

  const redline = result?.redline;

  return (
    <>
      <button
        type="button"
        onClick={() => (open && result ? setOpen(false) : run())}
        disabled={working}
        className="font-semi text-[10px] uppercase tracking-[0.14em] text-accent-700 hover:text-accent disabled:opacity-50"
      >
        {working ? 'Reading it…' : open && result ? 'Hide the reply' : 'Answer this one'}
      </button>

      {open ? (
        <div className="mt-2 w-full border border-divider">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-2 py-1">
            <span className="hud-label text-[9px]">
              THE REPLY TO {fileName.toUpperCase()}
              {result?.versionNo ? ` · V${result.versionNo}` : ''}
              {result?.usedBrief === false ? ' · NO STANDING POSITIONS SET' : ''}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-semi text-[10px] tracking-[0.14em] text-neutral-500 hover:text-accent"
            >
              CLOSE
            </button>
          </div>

          {working ? (
            <p className="px-2 py-3 text-[13px] text-neutral-600">
              Reading the document and drafting the reply. It takes a moment.
            </p>
          ) : error ? (
            <p className="px-2 py-3 text-[13px] text-sev-warning">{error}</p>
          ) : redline ? (
            <div className="space-y-3 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone={redline.signable ? 'ok' : 'watch'}>
                  {redline.signable ? 'CLOSE ENOUGH TO SIGN' : 'NEEDS CHANGES'}
                </Tag>
                <span className="text-[13px] text-neutral-700">{redline.verdict}</span>
              </div>

              {redline.changes.length > 0 ? (
                <div>
                  <span className="hud-label text-[9px]">
                    WHAT TO CHANGE — THEIRS ON THE LEFT, OURS ON THE RIGHT
                  </span>
                  <ul className="mt-1 space-y-2">
                    {redline.changes.map((c, i) => (
                      <li key={`${c.clause}-${i}`} className="border border-divider">
                        <div className="flex flex-wrap items-center gap-2 border-b border-divider px-2 py-1">
                          <span className="font-semi text-[12px] text-neutral-900">{c.clause}</span>
                          <Tag tone={SEVERITY_TONE[c.severity]}>{c.severity.toUpperCase()}</Tag>
                          <span className="text-[12px] text-neutral-500">{c.why}</span>
                        </div>
                        <div className="grid gap-0 sm:grid-cols-2">
                          <div className="border-b border-divider p-2 sm:border-b-0 sm:border-e">
                            <span className="hud-label text-[9px] text-neutral-500">AS IT STANDS</span>
                            <p className="mt-1 whitespace-pre-wrap text-[13px] text-neutral-600">
                              {c.original}
                            </p>
                          </div>
                          <div className="bg-accent/5 p-2">
                            <span className="hud-label text-[9px] text-accent-700">
                              WHAT WE SEND BACK
                            </span>
                            <p className="mt-1 whitespace-pre-wrap text-[13px] text-neutral-900">
                              {c.proposed}
                            </p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {redline.additions.length > 0 ? (
                <div>
                  <span className="hud-label text-[9px]">WHAT TO ADD</span>
                  <ul className="mt-1 space-y-1">
                    {redline.additions.map((a, i) => (
                      <li key={`${a.clause}-${i}`} className="border-s-2 border-accent ps-2">
                        <p className="text-[13px] text-neutral-900">
                          <span className="font-semi">{a.clause}</span> — {a.why}
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-neutral-600">
                          {a.text}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {redline.questions.length > 0 ? (
                <div>
                  <span className="hud-label text-[9px]">WORTH ASKING RATHER THAN REDRAFTING</span>
                  <ul className="mt-1 list-inside list-disc text-[13px] text-neutral-700">
                    {redline.questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="border border-divider">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-2 py-1">
                  <span className="hud-label text-[9px]">
                    THE EMAIL TO {counterparty.toUpperCase()} — NOTHING IS SENT FROM HERE
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => copy('subject', redline.email.subject)}
                    >
                      {copied === 'subject' ? 'COPIED' : 'COPY SUBJECT'}
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => copy('body', redline.email.body)}
                    >
                      {copied === 'body' ? 'COPIED' : 'COPY THE EMAIL'}
                    </Button>
                    <a
                      href={`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(
                        redline.email.subject,
                      )}&body=${encodeURIComponent(redline.email.body)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="border border-divider px-2 py-1 font-semi text-[10px] uppercase tracking-[0.16em] text-accent-700 hover:border-accent hover:text-accent"
                    >
                      Open in Gmail ↗
                    </a>
                  </div>
                </div>
                <p className="px-2 py-1 font-semi text-[12px] text-neutral-900">
                  {redline.email.subject}
                </p>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-divider px-2 py-2 text-[13px] leading-relaxed text-neutral-700">
                  {redline.email.body}
                </pre>
              </div>

              <p className="font-semi text-[10px] tracking-[0.1em] text-neutral-500">
                THE DOCUMENT ITSELF IS NOT REWRITTEN. A CONTRACT REGENERATED BY A MODEL CANNOT BE
                DIFFED AGAINST THE ONE THEY SENT — THESE ARE THE CHANGES TO MAKE IN THEIR FILE, IN
                THEIR WORDS.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
