'use client';

import { useState } from 'react';
import { attachmentsAction } from '@/app/actions/attachments';
import type { AttachmentItem } from '@/lib/attachments/service';
import { Button } from '@/components/ui/button';

/**
 * The files on a task, an opportunity or a conversation.
 *
 * The row used to say a file existed and give him nowhere to click: the
 * screenshot the team attached to a ClickUp task, the deck that made an
 * opportunity worth capturing. Both live in systems he would have to leave the
 * cockpit to open, so they are served through it instead — an image opens in
 * place, everything else opens in a tab, and neither needs a second login.
 *
 * They are fetched when he opens the list, not with the row: a page of forty
 * tasks would otherwise make forty ClickUp calls to tell him thirty-eight of
 * them have nothing.
 */

const KB = 1024;

function size(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < KB) return `${bytes} B`;
  if (bytes < KB * KB) return `${Math.round(bytes / KB)} KB`;
  return `${(bytes / (KB * KB)).toFixed(1)} MB`;
}

export function Attachments({
  kind,
  id,
  label = 'FILES',
}: {
  kind: 'task' | 'opportunity' | 'thread';
  id: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<AttachmentItem[] | null>(null);
  const [showing, setShowing] = useState<AttachmentItem | null>(null);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (items) return;
    setLoading(true);
    setError(null);
    attachmentsAction(kind, id)
      .then((r) => {
        if (r.ok) setItems(r.items);
        else setError(r.error);
      })
      .catch(() => setError('Could not read the attachments'))
      .finally(() => setLoading(false));
  };

  return (
    <>
      <Button
        type="button"
        size="xs"
        variant={open ? 'default' : 'ghost'}
        onClick={toggle}
        title="Documents and images attached to this"
      >
        {open ? 'HIDE FILES' : label}
      </Button>

      {open ? (
        <div className="mt-1.5 w-full border border-divider p-2">
          {loading ? (
            <p className="text-[13px] text-neutral-500">Looking for attachments…</p>
          ) : error ? (
            <p className="text-[13px] text-sev-warning">{error}</p>
          ) : !items || items.length === 0 ? (
            <p className="text-[13px] text-neutral-500">Nothing attached.</p>
          ) : (
            <ul className="space-y-1.5">
              {items.map((a) => (
                <li key={`${a.messageId ?? ''}${a.id}`} className="flex items-start gap-2">
                  {a.thumbnailHref ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.thumbnailHref}
                      alt={a.name}
                      className="h-12 w-12 cursor-zoom-in border border-divider object-cover"
                      onClick={() => setShowing(a)}
                    />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center border border-divider text-[10px] uppercase text-neutral-500">
                      {(a.name.split('.').pop() ?? 'file').slice(0, 4)}
                    </span>
                  )}

                  <span className="min-w-0 flex-1">
                    <a
                      href={a.href}
                      target="_blank"
                      rel="noreferrer"
                      className="block break-all text-[13px] text-accent-700 hover:text-accent"
                    >
                      {a.name}
                    </a>
                    <span className="text-[11px] text-neutral-500">
                      {size(a.sizeBytes)}
                      {a.sizeBytes !== null ? ' · ' : ''}
                      {a.mimeType}
                    </span>
                    {a.isImage ? (
                      <button
                        type="button"
                        onClick={() => setShowing(showing === a ? null : a)}
                        className="ms-2 font-semi text-[10px] uppercase tracking-[0.14em] text-accent-700 hover:text-accent"
                      >
                        {showing === a ? 'Close' : 'View'}
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/*
            Big enough to actually read. A 48px thumbnail answers "is there a
            picture"; it does not answer "what does it say", which is the
            question that made him click.
          */}
          {showing ? (
            <div className="mt-2 border border-divider">
              <div className="flex items-center justify-between border-b border-divider px-2 py-1">
                <span className="hud-label text-[9px] break-all">{showing.name}</span>
                <button
                  type="button"
                  onClick={() => setShowing(null)}
                  className="font-semi text-[10px] uppercase tracking-[0.14em] text-neutral-500 hover:text-accent"
                >
                  Close
                </button>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={showing.href} alt={showing.name} className="max-h-[70vh] w-full object-contain" />
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
