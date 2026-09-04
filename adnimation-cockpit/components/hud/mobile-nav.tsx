'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from './nav-items';

/**
 * Navigation on a phone.
 *
 * The rail is a 248px column, which a phone does not have, so below `lg` it is
 * replaced by this: a fixed bar carrying the wordmark and the current section,
 * and a sheet with the same module list. Without it a phone had the pages but
 * no way to move between them.
 */
export function MobileNav({
  userName,
  userRole,
  signOutAction,
}: {
  userName: string;
  userRole: 'owner' | 'operator';
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const current = NAV.find((n) => n.href === pathname) ?? NAV.find((n) => n.href === '/');

  return (
    <div className="lg:hidden">
      <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-line bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-[10px] bg-brand text-[15px] font-bold text-white"
            aria-hidden="true"
          >
            A
          </span>
          <div className="min-w-0">
            <div className="truncate text-[15.5px] font-bold leading-tight">Adnimation</div>
            <div className="truncate text-[12.5px] text-muted">{word(current?.label)}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav-sheet"
          className="rounded-[10px] border border-line px-3 py-2 text-[13.5px] font-semibold text-neutral-800"
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </div>

      {open ? (
        <nav id="mobile-nav-sheet" className="sticky top-[61px] z-30 border-b border-line bg-card">
          <ul className="grid grid-cols-2">
            {NAV.map((item) =>
              item.ready ? (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-2 border-b border-line px-4 py-3 text-[14.5px] font-semibold ${
                      item.href === pathname ? 'bg-accent-100 text-accent-800' : 'text-neutral-800'
                    }`}
                  >
                    <span>{word(item.label)}</span>
                  </Link>
                </li>
              ) : (
                <li key={item.href}>
                  <span
                    title="Ships with a later milestone"
                    className="flex items-center gap-2 border-b border-line px-4 py-3 text-[14.5px] font-semibold text-neutral-400"
                  >
                    <span>{word(item.label)}</span>
                  </span>
                </li>
              ),
            )}
          </ul>

          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-neutral-200 text-[11px] font-bold text-neutral-700">
                {userRole === 'owner' ? 'CEO' : 'COS'}
              </span>
              <span className="truncate text-[14px] font-semibold">{userName}</span>
            </span>
            <form action={signOutAction}>
              <button type="submit" className="text-[13.5px] font-semibold text-muted">
                Sign out
              </button>
            </form>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

/** The module names are stored uppercase; this design sets them as words. */
function word(name?: string): string {
  if (!name) return 'CEO Cockpit';
  return name.charAt(0) + name.slice(1).toLowerCase();
}
