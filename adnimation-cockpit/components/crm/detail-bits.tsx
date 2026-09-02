import Link from 'next/link';
import { Num } from '@/components/num';
import { fmtDate } from '@/lib/utils';
import type { Conversation } from '@/lib/crm/conversations';

/**
 * The pieces both detail screens share.
 *
 * A field that is empty is left out rather than shown blank: a card of eight
 * dashes reads as "we know nothing", which is not the same as "he did not put
 * his fax number in his signature".
 */

export function Field({
  label,
  value,
  href,
  ltr = false,
}: {
  label: string;
  value: string | null | undefined;
  href?: string | null;
  ltr?: boolean;
}) {
  if (!value) return null;
  const body = ltr ? <Num>{value}</Num> : value;
  return (
    <div className="min-w-0">
      <p className="hud-label text-[9px]">{label}</p>
      <p className="mt-0.5 break-words text-[13px] text-neutral-800">
        {href ? (
          <a
            href={href}
            target={href.startsWith('http') ? '_blank' : undefined}
            rel="noreferrer"
            className="text-accent-700 hover:text-accent"
          >
            {body}
          </a>
        ) : (
          body
        )}
      </p>
    </div>
  );
}

/**
 * Every conversation with a person or a company, newest first.
 *
 * This is what he opened the name to see. Each row says what it was about,
 * when, how long it ran, and — the part no mail client tells him at a glance —
 * whether the ball is with him or with them.
 */
export function Conversations({
  conversations,
  total,
  emptyNote,
}: {
  conversations: Conversation[];
  total: number;
  emptyNote: string;
}) {
  if (conversations.length === 0) {
    return (
      <p className="border-t border-divider px-[18px] py-3 font-semi text-[12px] text-neutral-500">
        {emptyNote}
      </p>
    );
  }

  return (
    <ul>
      {conversations.map((t) => (
        <li key={t.threadId} className="border-t border-divider px-[18px] py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <a
              href={t.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 font-cond text-[15px] leading-tight text-neutral-900 hover:text-accent"
            >
              {t.subject || '(no subject)'}
            </a>
            <span className="shrink-0 font-semi text-[10px] tracking-[0.1em] text-neutral-500">
              <Num>{fmtDate(t.lastMessageAt)}</Num>
              {t.messageCount > 1 ? (
                <>
                  {' · '}
                  <Num>{t.messageCount}</Num> MESSAGES
                </>
              ) : null}
              {t.lastFromMe ? ' · YOU ANSWERED' : ' · WAITING ON YOU'}
            </span>
          </div>
          {t.snippet ? (
            <p className="mt-0.5 line-clamp-2 text-[12px] text-neutral-500">{t.snippet}</p>
          ) : null}
        </li>
      ))}
      {total > conversations.length ? (
        <li className="border-t border-divider px-[18px] py-2 font-semi text-[10px] tracking-[0.12em] text-neutral-500">
          SHOWING <Num>{conversations.length}</Num> OF <Num>{total}</Num>
        </li>
      ) : null}
    </ul>
  );
}

/** The way back, and the way to the other record. */
export function CrumbLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-semi text-[10px] tracking-[0.14em] text-accent-700 hover:text-accent">
      {children}
    </Link>
  );
}
