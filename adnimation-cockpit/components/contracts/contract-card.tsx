'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useUndo } from '@/components/ui/undo-bar';
import {
  archiveContractAction, classifyAction, createLinkAction, refileAction, setContractStatusAction,
  setLinkAction, setWaitingOnAction, suggestLinksAction, summariseAction, undoAction,
} from '@/app/actions/contract-intake';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { EditorActions, EditorField, EditorGrid } from '@/components/hud/editor-panel';
import { PillarPicker, PillarTags } from '@/components/hud/pillar-picker';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { BOARD_STATUSES, STATUS_LABEL } from '@/lib/contracts/status';
import { CONTRACT_CATEGORIES } from '@/lib/contracts/drive';
import { ContractReply } from '@/components/contracts/contract-reply';
import type { ContractRow } from '@/lib/contracts/intake-module';
import type { ContractSummary } from '@/lib/contracts/summarise';
import { fmtDateTime, fmtMoney } from '@/lib/utils';

/** English only, everywhere: one label per category and no second language. */
const CATEGORY_LABEL: Record<string, string> = {
  demand: 'DEMAND',
  supply: 'SUPPLY',
  mutual: 'MUTUAL — BOTH DEMAND AND SUPPLY',
  quote: 'QUOTE',
  consulting: 'CONSULTING',
  general: 'GENERAL',
};

/** The short form, for the tag on a classified contract. */
const CATEGORY_TAG: Record<string, string> = {
  demand: 'DEMAND',
  supply: 'SUPPLY',
  mutual: 'MUTUAL',
  quote: 'QUOTE',
  consulting: 'CONSULTING',
  general: 'GENERAL',
};

/**
 * One contract: what arrived, what it is, and what it belongs to.
 *
 * Classifying is one form rather than a sequence of decisions, because the
 * whole point is that it takes less effort than leaving it in the queue.
 * Linking candidates are fetched when he opens it, not for every row — a
 * board of thirty contracts would otherwise be sixty queries for links nobody
 * is looking at.
 */
export function ContractCard({
  contract,
  /**
   * The row's searchable text, folded. It sits on the row itself rather than
   * on a wrapper because a <ul> may only hold <li>, and the instant filter
   * hides rows by this attribute while he types.
   */
  search,
  lines = [],
}: {
  contract: ContractRow;
  search?: string;
  /** The pillars it already belongs to. */
  lines?: readonly string[];
}) {
  const c = contract;
  const [open, setOpen] = useState(c.status === 'unclassified' && !c.categoryConfirmed);
  const [links, setLinks] = useState<{
    opportunities: { id: string; title: string; counterparty: string | null }[];
    deals: { id: string; name: string; stage: string }[];
  } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [summary, setSummary] = useState<
    { summary: ContractSummary; versionNo?: number; fileName?: string } | null
  >(null);
  const [summarising, setSummarising] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /*
   * The deal this contract belongs to, held in state rather than read off the
   * select's defaultValue.
   *
   * An uncontrolled select keeps whatever it was rendered with, so creating
   * the deal from inside the open editor left it showing "— none —" — and the
   * save that followed sent that back and unlinked what had just been made.
   */
  const [dealLink, setDealLink] = useState(c.pipelineClientId ?? '');
  useEffect(() => setDealLink(c.pipelineClientId ?? ''), [c.pipelineClientId]);
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const router = useRouter();
  const undo = useUndo();

  /*
   * The things this contract could belong to, fetched once, when he first
   * reaches for one — opening the editor or touching a link picker. Forty
   * candidates per contract on a page of twenty is a query nobody asked for.
   */
  const loadLinks = useCallback(() => {
    if (links !== null) return;
    suggestLinksAction(c.counterpartyName)
      .then(setLinks)
      .catch(() => setLinks({ opportunities: [], deals: [] }));
  }, [links, c.counterpartyName]);

  useEffect(() => {
    if (!open) return;
    loadLinks();
  }, [open, loadLinks]);

  const run = (
    action: (f: FormData) => Promise<{ ok: boolean; error?: string; warning?: string }>,
    data: FormData,
  ) =>
    startTransition(async () => {
      const result = await action(data);
      setMessage(result.ok ? null : (result.error ?? 'That did not work'));
      setWarning(result.warning ?? null);
      if (result.ok) {
        setLinks(null);
        undo.offer();
        router.refresh();
        if (!result.warning) setOpen(false);
      }
    });

  const needsClassifying = c.status === 'unclassified' || !c.categoryConfirmed;
  const unfiled = c.versions.filter((v) => v.uploadedAt === null).length;

  return (
    <li className="border-t border-line px-[18px] py-3" data-search={search}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-cond text-[17px] leading-none text-neutral-900">
              {c.counterpartyName}
            </p>
            <Tag
              tone={
                c.status === 'signed' ? 'ok' : needsClassifying ? 'warning' : 'outline'
              }
            >
              {c.statusLabel}
            </Tag>
            {c.categoryConfirmed ? (
              <Tag tone="accent">{CATEGORY_TAG[c.category ?? 'general']}</Tag>
            ) : (
              <Tag tone="warning">No category yet</Tag>
            )}
            {c.waitingOn === 'you' && c.status !== 'unclassified' ? (
              <Tag tone="critical">Your move</Tag>
            ) : null}
            {c.waitingOn === 'them' ? <Tag tone="outline">With them</Tag> : null}
            <Tag tone="neutral">FROM {c.source.toUpperCase()}</Tag>
            <PillarTags lines={lines} />
            {unfiled > 0 ? (
              <Tag tone="warning" title="Recorded here, but the file is not in Drive yet">
                <Num>{unfiled}</Num> NOT IN DRIVE
              </Tag>
            ) : null}
          </div>

          <p className="hud-label mt-1 whitespace-normal text-[11px]">
            {c.docType}
            {c.receivedAt ? (
              <>
                {' '}· ARRIVED <Num>{fmtDateTime(c.receivedAt)}</Num>
              </>
            ) : null}
            {' '}· <Num>{c.versions.length}</Num>{' '}
            {c.versions.length === 1 ? 'VERSION' : 'VERSIONS'}
            {c.drivePath ? (
              <>
                {' '}· <span className="text-info">{c.drivePath}</span>
              </>
            ) : null}
          </p>

          {c.opportunityTitle || c.pipelineClientName ? (
            <p className="hud-label mt-1 whitespace-normal text-[11px] text-info">
              LINKED TO {c.opportunityTitle ? `SUGGESTION: ${c.opportunityTitle}` : ''}
              {c.opportunityTitle && c.pipelineClientName ? ' · ' : ''}
              {c.pipelineClientName ? `DEAL: ${c.pipelineClientName}` : ''}
            </p>
          ) : null}

          {c.notes ? <p className="mt-1 text-[13px] text-neutral-600">{c.notes}</p> : null}

          {/*
            Classifying a contract you cannot read is guesswork, so every
            version is openable from here: read it inline without leaving the
            page, or open it in Drive if he wants the full viewer.
          */}
          {c.versions.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5">
              {c.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 text-[12px] text-neutral-500">
                  <span className="font-semi text-info">v{v.versionNo}</span>
                  <span className="min-w-0 break-all">{v.fileName}</span>
                  {v.driveFileId ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setPreview((current) =>
                            current === v.driveFileId ? null : v.driveFileId,
                          )
                        }
                        className="font-semi text-[11.5px] uppercase tracking-[0.14em] text-info hover:underline"
                      >
                        {preview === v.driveFileId ? 'Hide' : 'Read it'}
                      </button>
                      {/*
                        A summary per document. Several files arrive at once —
                        the agreement, an addendum, a redraft — and "summarise
                        the contract" answered a question about only the newest
                        of them.
                      */}
                      <button
                        type="button"
                        disabled={summarising}
                        onClick={() => {
                          setSummarising(true);
                          setSummaryError(null);
                          setSummary(null);
                          summariseAction(c.id, v.id)
                            .then((r) => {
                              if (r.ok && 'summary' in r && r.summary) {
                                setSummary({
                                  summary: r.summary,
                                  ...('versionNo' in r ? { versionNo: r.versionNo } : {}),
                                  ...('fileName' in r ? { fileName: r.fileName } : {}),
                                });
                              } else {
                                setSummaryError(('error' in r && r.error) || 'Could not read it');
                              }
                            })
                            .catch(() => setSummaryError('Could not read it'))
                            .finally(() => setSummarising(false));
                        }}
                        className="font-semi text-[11.5px] uppercase tracking-[0.14em] text-info hover:underline disabled:opacity-50"
                      >
                        {summarising ? 'Reading…' : 'Summarise it'}
                      </button>
                      <ContractReply
                        contractId={c.id}
                        versionId={v.id}
                        fileName={v.fileName}
                        counterparty={c.counterpartyName}
                      />
                      <a
                        href={`https://drive.google.com/file/d/${v.driveFileId}/view`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semi text-[11.5px] uppercase tracking-[0.14em] text-info hover:underline"
                      >
                        Drive ↗
                      </a>
                    </>
                  ) : (
                    <span className="text-sev-warning">not in Drive yet</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {preview ? (
            <div className="mt-2 border border-line">
              <div className="flex items-center justify-between border-b border-line px-2 py-1">
                <span className="hud-label text-[11px]">Reading the document</span>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="font-semi text-[11.5px] uppercase tracking-[0.14em] text-neutral-500 hover:text-accent"
                >
                  Close
                </button>
              </div>
              {/*
                Drive's own viewer, so a PDF and a Word document both render
                and neither has to be converted here. It needs his Google
                session, which he has — the file is in his own Drive.
              */}
              <iframe
                src={`https://drive.google.com/file/d/${preview}/preview`}
                title="Contract"
                className="h-[70vh] w-full bg-white"
                allow="autoplay"
              />
              <p className="border-t border-line px-2 py-1 font-semi text-[11px] tracking-[0.1em] text-neutral-500">
                If this is blank, open it with “DRIVE ↗” — the viewer needs you signed in to the
                same Google account.
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-start gap-5">
          {c.valueCents !== null ? (
            <div className="text-end">
              <span className="hud-label block text-[11px]">Value</span>
              <span className="font-cond text-[19px] leading-none text-neutral-900">
                <Num>{fmtMoney(c.valueCents)}</Num>
              </span>
            </div>
          ) : null}
          <div className="text-end">
            <span className="hud-label block text-[11px]">In this state</span>
            <span
              className={`font-cond text-[19px] leading-none ${
                needsClassifying && c.daysInStatus >= 2
                  ? 'text-sev-warning'
                  : 'text-neutral-900'
              }`}
            >
              <Num>{c.daysInStatus}d</Num>
            </span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="xs" variant={needsClassifying ? 'default' : 'outline'} onClick={() => setOpen((v) => !v)}>
          {open ? 'CLOSE' : needsClassifying ? 'CLASSIFY IT' : 'EDIT'}
        </Button>

        {!needsClassifying ? (
          <>
            <label className="sr-only" htmlFor={`cs-${c.id}`}>
              Status
            </label>
            <Select
              id={`cs-${c.id}`}
              value={c.status}
              disabled={pending}
              className="h-9 text-[13.5px]"
              onChange={(e) => {
                const data = new FormData();
                data.set('id', c.id);
                data.set('status', e.target.value);
                run(setContractStatusAction, data);
              }}
            >
              {BOARD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </>
        ) : null}

        {/*
          Whose move it is, as a control rather than a consequence. "Sent back
          with changes" and "waiting for a signature" are both with them, and
          only one of those is a status.
        */}
        {!needsClassifying && c.status !== 'signed' ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={pending}
            title={
              c.waitingOnIsOverridden
                ? 'You set this. Click again to let the status decide.'
                : 'Set whose move it is'
            }
            onClick={() => {
              const data = new FormData();
              data.set('id', c.id);
              // you → them → back to following the status.
              data.set(
                'who',
                c.waitingOn === 'you' ? 'them' : c.waitingOnIsOverridden ? 'auto' : 'you',
              );
              run(setWaitingOnAction, data);
            }}
          >
            {c.waitingOn === 'you'
              ? '→ WAITING ON THEM'
              : c.waitingOnIsOverridden
                ? '→ FOLLOW THE STATUS'
                : '→ WAITING ON ME'}
          </Button>
        ) : null}

        {/*
          Linking, on the card rather than inside the editor.
          
          It used to mean opening the classify form and saving the whole thing
          to record one connection he had just noticed — so contracts stayed
          linked to nothing. These save on change.
        */}
        <span className="inline-flex flex-wrap items-center gap-1">
          <label className="sr-only" htmlFor={`ldl-${c.id}`}>
            Deal
          </label>
          <Select
            id={`ldl-${c.id}`}
            value={c.pipelineClientId ?? ''}
            disabled={pending}
            className="h-9 max-w-[14rem] text-[13.5px]"
            onFocus={() => loadLinks()}
            onChange={(e) => {
              const data = new FormData();
              data.set('id', c.id);
              data.set('what', 'deal');
              data.set('target', e.target.value);
              run(setLinkAction, data);
            }}
          >
            <option value="">— no deal —</option>
            {c.pipelineClientId && !(links?.deals ?? []).some((d) => d.id === c.pipelineClientId) ? (
              <option value={c.pipelineClientId}>{c.pipelineClientName ?? 'Linked deal'}</option>
            ) : null}
            {(links?.deals ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {d.stage}
              </option>
            ))}
          </Select>

          {!c.pipelineClientId ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={pending}
              title={`Start a deal for ${c.counterpartyName}`}
              onClick={() => {
                const data = new FormData();
                data.set('id', c.id);
                data.set('what', 'deal');
                run(createLinkAction, data);
              }}
            >
              + deal
            </Button>
          ) : null}
        </span>

        {c.versions.some((v) => v.driveFileId) ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={summarising}
            title="Read it and list what it commits us to"
            onClick={() => {
              if (summary) { setSummary(null); return; }
              setSummarising(true);
              setSummaryError(null);
              summariseAction(c.id)
                .then((r) => {
                  if (r.ok && 'summary' in r && r.summary) {
                    setSummary({
                      summary: r.summary,
                      ...('versionNo' in r ? { versionNo: r.versionNo } : {}),
                      ...('fileName' in r ? { fileName: r.fileName } : {}),
                    });
                  } else {
                    setSummaryError(('error' in r && r.error) || 'Could not read it');
                  }
                })
                .catch(() => setSummaryError('Could not read it'))
                .finally(() => setSummarising(false));
            }}
          >
            {summarising ? 'READING IT…' : summary ? 'HIDE SUMMARY' : 'WHAT DOES IT SAY?'}
          </Button>
        ) : null}

        {c.sourceUrl ? (
          <a
            href={c.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="font-semi text-[11.5px] uppercase tracking-[0.14em] text-info hover:underline"
          >
            {c.source === 'mail' ? 'Open in Gmail ↗' : 'Open in Slack ↗'}
          </a>
        ) : null}

        {unfiled > 0 ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              const data = new FormData();
              data.set('id', c.id);
              run(refileAction, data);
            }}
          >
            FILE TO DRIVE
          </Button>
        ) : null}

        {/*
          Undo, because every control here is one click and several of them
          move files in Drive. "Be careful" is not a feature.
        */}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={pending}
          title="Put it back the way it was before the last change"
          onClick={() => {
            const data = new FormData();
            data.set('id', c.id);
            run(undoAction, data);
          }}
        >
          Undo
        </Button>

        {/* Archive is the one that makes a row disappear, so it asks first. */}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Archive the ${c.counterpartyName} contract? It leaves every list.`)) return;
            const data = new FormData();
            data.set('id', c.id);
            run(archiveContractAction, data);
          }}
        >
          Archive
        </Button>

        {message ? <span className="text-2xs text-destructive">{message}</span> : null}
        {warning ? <span className="text-2xs text-sev-warning">{warning}</span> : null}
      </div>

      {summaryError ? (
        <p className="mt-2 border border-sev-warning/40 bg-sev-warning/10 px-3 py-2 font-semi text-[11px] text-sev-warning">
          {summaryError}
        </p>
      ) : null}

      {summary ? (
        <div className="mt-2 border border-line p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
            <span className="hud-label text-[11px]">
              WHAT THIS CONTRACT SAYS
              {summary.versionNo ? (
                <>
                  {' '}· V<Num>{summary.versionNo}</Num>
                </>
              ) : null}
            </span>
            {/*
              Said plainly. A summary that is trusted as the contract is worse
              than no summary, and this one is read by a model from the newest
              version in Drive.
            */}
            <span className="font-semi text-[11px] tracking-[0.1em] text-neutral-500">
              Read by Claude · not legal advice · check anything you act on
            </span>
          </div>

          <p className="mt-2 text-[14px] text-neutral-900">{summary.summary.whatItIs}</p>
          <p className="mt-0.5 text-[13px] text-neutral-600">{summary.summary.parties}</p>

          {summary.summary.watchOut.length > 0 ? (
            <div className="mt-3 border-s-2 border-sev-warning ps-2">
              <span className="hud-label text-[11px] text-sev-warning">Worth arguing about</span>
              <ul className="mt-1 space-y-1">
                {summary.summary.watchOut.map((w) => (
                  <li key={w.clause} className="text-[13px] text-neutral-700">
                    <span className="font-semi">{w.clause}</span> — {w.why}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <SummaryList label="WE PROVIDE" items={summary.summary.weProvide} />
            <SummaryList label="THEY PROVIDE" items={summary.summary.theyProvide} />
            <SummaryList label="COMMERCIALS" items={summary.summary.commercials} />
            <SummaryList label="TERM" items={[summary.summary.term]} />
            <SummaryList label="HOW IT ENDS" items={[summary.summary.termination]} />
            {summary.summary.missing.length > 0 ? (
              <SummaryList label="NOT SETTLED" items={summary.summary.missing} />
            ) : null}
          </div>
        </div>
      ) : null}

      {open ? (
        <form
          className="mt-2 rounded-[12px] border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            data.set('id', c.id);
            run(classifyAction, data);
          }}
        >
          <EditorGrid>
            <EditorField label="Who it is with" htmlFor={`cp-${c.id}`}>
              <Input
                id={`cp-${c.id}`}
                name="counterpartyName"
                defaultValue={c.counterpartyName}
                required
              />
            </EditorField>

            <EditorField label="Category" htmlFor={`cat-${c.id}`}>
              <Select
                id={`cat-${c.id}`}
                name="category"
                defaultValue={c.categoryConfirmed ? (c.category ?? 'general') : ''}
                required
                className="w-full"
              >
                <option value="" disabled>
                  Pick one
                </option>
                {CONTRACT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_LABEL[cat] ?? cat}
                  </option>
                ))}
              </Select>
            </EditorField>

            <EditorField label="What kind of document" htmlFor={`dt-${c.id}`}>
              <Input
                id={`dt-${c.id}`}
                name="docType"
                defaultValue={c.docType}
                placeholder="Demand agreement, NDA, addendum"
              />
            </EditorField>

            <EditorField label="Status" htmlFor={`st-${c.id}`}>
              <Select
                id={`st-${c.id}`}
                name="status"
                defaultValue={c.status === 'unclassified' ? 'in_review' : c.status}
                className="w-full"
              >
                {BOARD_STATUSES.filter((s) => s !== 'unclassified').map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </EditorField>

            <EditorField label="Belongs to a deal" htmlFor={`dl-${c.id}`}>
              <Select
                id={`dl-${c.id}`}
                name="pipelineClientId"
                value={dealLink}
                onChange={(e) => setDealLink(e.target.value)}
                className="w-full"
              >
                <option value="">— none —</option>
                {/* The linked deal may not be among the suggestions — a name
                    that no longer matches, or one just created. */}
                {dealLink && !(links?.deals ?? []).some((d) => d.id === dealLink) ? (
                  <option value={dealLink}>{c.pipelineClientName ?? 'Linked deal'}</option>
                ) : null}
                {(links?.deals ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} — {d.stage}
                  </option>
                ))}
              </Select>
              {!dealLink ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    const data = new FormData();
                    data.set('id', c.id);
                    data.set('what', 'deal');
                    startTransition(async () => {
                      const result = await createLinkAction(data);
                      setMessage(result.ok ? null : (result.error ?? 'That did not work'));
                      setWarning(result.warning ?? null);
                      if (result.ok) {
                        // Selected here and now, so the save that follows keeps it.
                        if (result.id) setDealLink(result.id);
                        setLinks(null);
                        router.refresh();
                      }
                    });
                  }}
                  className="hud-label mt-1 text-[11.5px] text-info hover:underline"
                >
                  + Create a deal for {c.counterpartyName}
                </button>
              ) : null}
            </EditorField>

            <EditorField
              label="Which parts of the company"
              htmlFor={`pl-${c.id}-core_clients`}
              span="full"
              hint="Tag it to as many pillars as it touches"
            >
              <PillarPicker id={`pl-${c.id}`} selected={lines} />
            </EditorField>

            <EditorField label="Notes" htmlFor={`nt-${c.id}`} span="full">
              <Textarea id={`nt-${c.id}`} name="notes" rows={3} defaultValue={c.notes ?? ''} />
            </EditorField>
          </EditorGrid>

          <EditorActions
            hint={
              (links === null
                ? 'LOOKING FOR WHAT THIS BELONGS TO…'
                : links.deals.length === 0
                  ? 'NO DEAL MATCHING THIS COUNTERPARTY ON THE BOARD'
                  : `${links.deals.length} POSSIBLE MATCH${links.deals.length === 1 ? '' : 'ES'} FOUND`) +
              ' · MARKING IT SIGNED MOVES THE LINKED DEAL TO INTEGRATION'
            }
          >
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'FILING…' : 'SAVE AND FILE IT'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </EditorActions>
        </form>
      ) : null}
    </li>
  );
}

function SummaryList({ label, items }: { label: string; items: string[] }) {
  const real = items.filter((i) => i && i.trim() !== '');
  if (real.length === 0) return null;
  return (
    <div>
      <span className="hud-label block text-[11px]">{label}</span>
      <ul className="mt-1 space-y-0.5">
        {real.map((item) => (
          <li key={item} className="text-[13px] leading-snug text-neutral-700">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
