import Link from 'next/link';
import { NAV } from './nav-items';

/**
 * The rail, in the design package's language: a white column against the
 * gradient ground, one hairline separating it from the page, and the modules
 * as rounded rows that fill in on hover.
 *
 * Gone with the dark system: the telemetry bars, the numbered index beside
 * every module, the glowing dividers. The package's sidebar is a list of
 * places, and the only thing that carries colour is the brand mark and
 * whichever row he is on.
 */
export function Rail({
  userName,
  userRole,
  signOutAction,
}: {
  userName: string;
  userRole: 'owner' | 'operator';
  signOutAction: () => Promise<void>;
}) {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto border-e border-line bg-card py-6 lg:flex">
      <div className="flex items-center gap-3 px-5">
        <span
          className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-brand text-[17px] font-bold text-white"
          aria-hidden="true"
        >
          A
        </span>
        <div className="min-w-0">
          <div className="truncate text-[17px] font-bold leading-tight tracking-[-0.01em]">
            Adnimation
          </div>
          <div className="truncate text-[12.5px] text-muted">CEO Cockpit</div>
        </div>
      </div>

      <nav className="flex flex-col gap-[2px] px-3">
        {NAV.map((item) =>
          item.ready ? (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-[10px] px-3 py-[10px] text-[15px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-ink"
            >
              {label(item.label)}
            </Link>
          ) : (
            <span
              key={item.href}
              title="Ships with a later milestone"
              className="cursor-not-allowed rounded-[10px] px-3 py-[10px] text-[15px] font-semibold text-neutral-400"
            >
              {label(item.label)}
            </span>
          ),
        )}
      </nav>

      <div className="mt-auto flex flex-col gap-3 px-5">
        <div className="h-px bg-line" />
        <div className="flex items-center gap-3">
          <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full bg-neutral-200 text-[11.5px] font-bold text-neutral-700">
            {userRole === 'owner' ? 'CEO' : 'COS'}
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{userName}</span>
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-[9px] px-2 py-1 text-[13.5px] font-semibold text-muted hover:bg-neutral-100 hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

/**
 * The module names are stored uppercase from the old system, where every label
 * was set in tracked capitals. This design sets them as words, so they are
 * written back as words here rather than in fifteen places.
 */
function label(name: string): string {
  return name.charAt(0) + name.slice(1).toLowerCase();
}
