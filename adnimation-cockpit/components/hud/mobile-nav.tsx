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
      <div
        className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-divider px-4 py-3 text-paper"
        style={{ background: 'linear-gradient(180deg, var(--rail-from) 0%, var(--rail-to) 100%)' }}
      >
        <div className="min-w-0">
          <div className="font-cond text-[17px] font-semibold leading-none tracking-[0.18em]">
            ADNIMATION
          </div>
          <div className="mt-1 truncate font-semi text-[9px] tracking-[0.24em] text-accent-300">
            {current?.label ?? 'CEO COCKPIT'}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav-sheet"
          className="border border-paper/30 px-3 py-2 font-semi text-[10px] tracking-[0.16em] text-paper"
        >
          {open ? 'CLOSE' : 'MENU'}
        </button>
      </div>

      {open ? (
        <nav
          id="mobile-nav-sheet"
          className="sticky top-[57px] z-30 border-b border-divider text-paper"
          style={{ background: 'var(--rail-to)' }}
        >
          <ul className="grid grid-cols-2">
            {NAV.map((item) =>
              item.ready ? (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center justify-between gap-2 border-b border-paper/[0.12] px-4 py-3 font-semi text-[13px] tracking-[0.06em] ${
                      item.href === pathname ? 'bg-paper/[0.16] text-accent-300' : 'text-paper'
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className="font-cond text-[10px] tracking-[0.16em] opacity-45">
                      {item.num}
                    </span>
                  </Link>
                </li>
              ) : (
                <li key={item.href}>
                  <span
                    title="Ships with a later milestone"
                    className="flex items-center justify-between gap-2 border-b border-paper/[0.12] px-4 py-3 font-semi text-[13px] tracking-[0.06em] text-paper/35"
                  >
                    <span>{item.label}</span>
                    <span className="font-cond text-[10px] tracking-[0.16em] opacity-45">
                      {item.num}
                    </span>
                  </span>
                </li>
              ),
            )}
          </ul>

          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="flex items-center gap-2 font-semi text-[10px] tracking-[0.16em] text-accent-300">
              <span className="inline-flex h-[26px] w-[26px] items-center justify-center border border-paper/30 font-cond text-[10px] text-paper">
                {userRole === 'owner' ? 'CEO' : 'COS'}
              </span>
              <span className="truncate text-paper">{userName}</span>
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="font-semi text-[10px] tracking-[0.16em] text-accent-300"
              >
                EXIT
              </button>
            </form>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
