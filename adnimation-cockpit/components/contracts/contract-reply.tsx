'use client';

import { useState } from 'react';
import {
  redlineAction, rememberPositionAction, rewordAction,
} from '@/app/actions/contract-intake';
import { findMarks, splitByMarks } from '@/lib/contracts/highlight';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { Input } from '@/components/ui/input';
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
  const [full, setFull] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    { redline: Redline; versionNo?: number; usedBrief?: boolean; documentText?: string } | null
  >(null);
  const [copied, setCopied] = useState<string | null>(null);
  /** Which change is being looked at, so both columns scroll to the same one. */
  const [focused, setFocused] = useState<number | null>(null);
  /** His own wording, per change, once he has asked for it. */
  const [mine, setMine] = useState<Record<number, { proposed: string; why: string }>>({});
  const [asking, setAsking] = useState<number | null>(null);
  const [remembered, setRemembered] = useState<string | null>(null);

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
            ...('documentText' in r && r.documentText ? { documentText: r.documentText } : {}),
          });
          setMine({});
          setFocused(null);
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

  /*
   * Their draft with our problem passages marked in it.
   *
   * The marks are found on the text, not asked of the model a second time: a
   * highlight in the wrong place is worse than none, because he reads the
   * passage beside it as the one being changed.
   */
  const runs = (() => {
    if (!redline || !result?.documentText) return null;
    const marks = findMarks(result.documentText, redline.changes.map((c) => c.original));
    return splitByMarks(result.documentText, marks);
  })();

  const reword = (index: number, instruction: string) => {
    const change = redline?.changes[index];
    if (!change || instruction.trim() === '') return;
    setAsking(index);
    rewordAction({
      contractId,
      clause: change.clause,
      original: change.original,
      currentProposal: mine[index]?.proposed ?? change.proposed,
      instruction,
    })
      .then((r) => {
        if (r.ok && 'proposed' in r) {
          setMine((held) => ({ ...held, [index]: { proposed: r.proposed, why: r.why } }));
        } else {
          setError(('error' in r && r.error) || 'Could not redraft it');
        }
      })
      .catch(() => setError('Could not redraft it'))
      .finally(() => setAsking(null));
  };

  const remember = (position: string) => {
    const data = new FormData();
    data.set('position', position);
    rememberPositionAction(data)
      .then((r) => {
        setRemembered(r.ok ? 'Saved to the agent' : (('error' in r && r.error) || 'Could not save it'));
        setTimeout(() => setRemembered(null), 3000);
      })
      .catch(() => setRemembered('Could not save it'));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => (open && result ? setOpen(false) : run())}
        disabled={working}
        className="font-semi text-[11.5px] uppercase tracking-[0.14em] text-info hover:underline disabled:opacity-50"
      >
        {working ? 'Reading it…' : open && result ? 'Hide the reply' : 'Answer this one'}
      </button>

      {open ? (
        <div
          className={
            full
              ? 'fixed inset-0 z-50 flex flex-col overflow-auto bg-card'
              : 'mt-2 w-full border border-line'
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-2 py-1">
            <span className="hud-label text-[11px]">
              The reply to {fileName.toUpperCase()}
              {result?.versionNo ? ` · V${result.versionNo}` : ''}
              {result?.usedBrief === false ? ' · NO STANDING POSITIONS SET' : ''}
            </span>
            <div className="flex flex-wrap items-center gap-3">
              {/* Reading a contract in a strip inside a list is not reading it. */}
              <button
                type="button"
                onClick={() => setFull((v) => !v)}
                className="font-semi text-[11.5px] tracking-[0.14em] text-info hover:underline"
              >
                {full ? 'SHRINK' : 'FULL SCREEN'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFull(false);
                  setOpen(false);
                }}
                className="font-semi text-[11.5px] tracking-[0.14em] text-neutral-500 hover:text-accent"
              >
                Close
              </button>
            </div>
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

              {runs ? (
                <div className={full ? 'grid gap-3 lg:grid-cols-2' : 'grid gap-3'}>
                  <div className="border border-line">
                    <div className="border-b border-line px-2 py-1">
                      <span className="hud-label text-[11px]">
                        THEIR DRAFT · <Num>{redline.changes.length}</Num> Passages marked
                      </span>
                    </div>
                    <pre
                      className={`overflow-auto whitespace-pre-wrap px-2 py-2 text-[13px] leading-relaxed text-neutral-700 ${
                        full ? 'max-h-[70vh]' : 'max-h-96'
                      }`}
                    >
                      {runs.map((run, i) =>
                        run.index === null ? (
                          <span key={i}>{run.text}</span>
                        ) : (
                          <mark
                            key={i}
                            onClick={() => setFocused(run.index)}
                            className={`cursor-pointer ${
                              focused === run.index
                                ? 'bg-brand text-white'
                                : 'bg-sev-warning/25 text-neutral-900'
                            }`}
                            title="What we would send back instead"
                          >
                            {run.text}
                          </mark>
                        ),
                      )}
                    </pre>
                  </div>

                  <div className="border border-line">
                    <div className="border-b border-line px-2 py-1">
                      <span className="hud-label text-[11px]">What we send back</span>
                    </div>
                    <div
                      className={`overflow-auto px-2 py-2 ${full ? 'max-h-[70vh]' : 'max-h-96'}`}
                    >
                      {redline.changes.map((c, i) => (
                        <div
                          key={`${c.clause}-${i}`}
                          onClick={() => setFocused(i)}
                          className={`mb-2 cursor-pointer border-s-2 ps-2 ${
                            focused === i ? 'border-accent bg-accent/5' : 'border-line'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semi text-[12px] text-neutral-900">{c.clause}</span>
                            <Tag tone={SEVERITY_TONE[c.severity]}>{c.severity.toUpperCase()}</Tag>
                          </div>
                          <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-neutral-900">
                            {mine[i]?.proposed ?? c.proposed}
                          </p>
                          <p className="mt-0.5 text-[12px] text-neutral-500">
                            {mine[i]?.why ?? c.why}
                            {mine[i] ? ' · your wording' : ''}
                          </p>

                          <MyFix
                            busy={asking === i}
                            onAsk={(instruction) => reword(i, instruction)}
                            onRemember={(instruction) => remember(instruction)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {redline.changes.length > 0 ? (
                <div>
                  <span className="hud-label text-[11px]">
                    {runs ? 'EVERY CHANGE, CLAUSE BY CLAUSE' : 'WHAT TO CHANGE — THEIRS LEFT, OURS RIGHT'}
                  </span>
                  <ul className="mt-1 space-y-2">
                    {redline.changes.map((c, i) => (
                      <li key={`${c.clause}-${i}`} className="border border-line">
                        <div className="flex flex-wrap items-center gap-2 border-b border-line px-2 py-1">
                          <span className="font-semi text-[12px] text-neutral-900">{c.clause}</span>
                          <Tag tone={SEVERITY_TONE[c.severity]}>{c.severity.toUpperCase()}</Tag>
                          <span className="text-[12px] text-neutral-500">{c.why}</span>
                        </div>
                        <div className="grid gap-0 sm:grid-cols-2">
                          <div className="border-b border-line p-2 sm:border-b-0 sm:border-e">
                            <span className="hud-label text-[11px] text-neutral-500">As it stands</span>
                            <p className="mt-1 whitespace-pre-wrap text-[13px] text-neutral-600">
                              {c.original}
                            </p>
                          </div>
                          <div className="bg-accent/5 p-2">
                            <span className="hud-label text-[11px] text-info">
                              What we send back
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
                  <span className="hud-label text-[11px]">WHAT TO ADD</span>
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
                  <span className="hud-label text-[11px]">Worth asking rather than redrafting</span>
                  <ul className="mt-1 list-inside list-disc text-[13px] text-neutral-700">
                    {redline.questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="border border-line">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-2 py-1">
                  <span className="hud-label text-[11px]">
                    The email to {counterparty.toUpperCase()} — nothing is sent from here
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
                      className="border border-line px-2 py-1 font-semi text-[11.5px] uppercase tracking-[0.16em] text-info hover:border-accent hover:text-accent"
                    >
                      Open in Gmail ↗
                    </a>
                  </div>
                </div>
                <p className="px-2 py-1 font-semi text-[12px] text-neutral-900">
                  {redline.email.subject}
                </p>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-line px-2 py-2 text-[13px] leading-relaxed text-neutral-700">
                  {redline.email.body}
                </pre>
              </div>

              {remembered ? (
                <p className="font-semi text-[11.5px] tracking-[0.1em] text-info">
                  {remembered.toUpperCase()} — The next contract starts from it
                </p>
              ) : null}

              <p className="font-semi text-[11.5px] tracking-[0.1em] text-neutral-500">
                The document itself is not rewritten. a contract regenerated by a model cannot be
                diffed against the one they sent — these are the changes to make in their file, in
                their words.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * His own fix for one clause.
 *
 * Two different things, deliberately separate. "Redraft it" changes this
 * contract now. "Remember this" makes it a standing position, so the next
 * contract arrives with the point already taken — that is the agent being
 * configured by the corrections he actually makes, rather than by a form he
 * has to remember to fill in.
 */
function MyFix({
  busy,
  onAsk,
  onRemember,
}: {
  busy: boolean;
  onAsk: (instruction: string) => void;
  onRemember: (instruction: string) => void;
}) {
  const [instruction, setInstruction] = useState('');

  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <Input
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="What should it say instead? e.g. Net 45, cap at 12 months of fees"
        className="h-9 min-w-0 flex-1 text-[13.5px]"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onAsk(instruction);
          }
        }}
      />
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={busy || instruction.trim() === ''}
        onClick={() => onAsk(instruction)}
      >
        {busy ? 'DRAFTING…' : 'REDRAFT IT'}
      </Button>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        disabled={instruction.trim() === ''}
        title="Make this a standing position, so the next contract starts from it"
        onClick={() => onRemember(instruction)}
      >
        Always ask for this
      </Button>
    </div>
  );
}
