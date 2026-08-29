import Link from 'next/link';
import { Led } from './card';

/** Spec §4 — the module list. Numbered as the design does. */
const NAV = [
  { href: '/', label: 'COCKPIT', num: '01', ready: true },
  { href: '/revenue', label: 'REVENUE', num: '02', ready: true },
  { href: '/tasks', label: 'TASKS', num: '03', ready: true },
  { href: '/delegations', label: 'DELEGATIONS', num: '04', ready: true },
  { href: '/inbox', label: 'SIGNALS', num: '05', ready: false },
  { href: '/pipeline', label: 'PIPELINE', num: '06', ready: false },
  { href: '/partners', label: 'PARTNERS', num: '07', ready: false },
  { href: '/contracts', label: 'CONTRACTS', num: '08', ready: false },
  { href: '/agents', label: 'AGENTS', num: '09', ready: false },
] as const;

/** 22 decorative telemetry bars, deterministic so server and client agree. */
const BARS = Array.from({ length: 22 }, (_, i) => ({
  height: 30 + ((i * 37) % 60),
  duration: 1.6 + ((i * 13) % 15) / 10,
  delay: ((i * 7) % 11) / 10,
}));

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
    <aside
      className="sticky top-0 hidden h-dvh flex-col gap-[26px] overflow-hidden border-e border-divider py-6 text-paper lg:flex"
      style={{ background: 'linear-gradient(180deg, var(--rail-from) 0%, var(--rail-to) 100%)' }}
    >
      <div className="px-[18px]">
        <div className="font-cond text-[25px] font-semibold leading-none tracking-[0.2em]">
          ADNIMATION
        </div>
        <div className="mt-2 flex items-center gap-2 font-semi text-[10px] font-medium tracking-[0.3em] text-accent-300">
          <Led />
          CEO COCKPIT
        </div>
      </div>

      <nav className="flex flex-col">
        {NAV.map((item) =>
          item.ready ? (
            <Link
              key={item.href}
              href={item.href}
              className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-paper/[0.12] border-s-2 border-s-transparent px-[18px] py-[14px] font-semi text-[15px] tracking-[0.06em] text-paper hover:bg-paper/[0.14] hover:border-s-accent-300"
            >
              <span>{item.label}</span>
              <span className="font-cond text-[11px] tracking-[0.16em] opacity-45">{item.num}</span>
            </Link>
          ) : (
            <span
              key={item.href}
              title="Ships with a later milestone"
              className="grid cursor-not-allowed grid-cols-[1fr_auto] items-center gap-3 border-t border-paper/[0.12] border-s-2 border-s-transparent px-[18px] py-[14px] font-semi text-[15px] tracking-[0.06em] text-paper/35"
            >
              <span>{item.label}</span>
              <span className="font-cond text-[11px] tracking-[0.16em] opacity-45">{item.num}</span>
            </span>
          ),
        )}
      </nav>

      <div className="px-[18px]">
        <div className="font-semi text-[9px] font-medium tracking-[0.28em] text-accent-300">
          TELEMETRY
        </div>
        <div className="mt-2 flex h-[34px] items-end gap-[2px]" aria-hidden="true">
          {BARS.map((b, i) => (
            <div
              key={i}
              className="flex-1 animate-bar bg-accent-500"
              style={{
                height: `${b.height}%`,
                animationDuration: `${b.duration}s`,
                animationDelay: `${b.delay}s`,
              }}
            />
          ))}
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-[10px] px-[18px] font-semi text-[10px] tracking-[0.16em] text-accent-300">
        <div className="flex justify-between gap-2">
          <span>FEEDS</span>
          <span className="text-paper">ARS · CLICKUP · SLACK</span>
        </div>
        <div className="h-px bg-paper/[0.16]" />
        <div className="flex items-center gap-[10px]">
          <span className="inline-flex h-[30px] w-[30px] items-center justify-center border border-paper/30 font-cond text-[11px] tracking-[0.12em] text-paper">
            {userRole === 'owner' ? 'CEO' : 'COS'}
          </span>
          <span className="min-w-0 flex-1 truncate text-[10px] tracking-[0.18em] text-paper">
            {userName}
          </span>
          <form action={signOutAction}>
            <button
              type="submit"
              className="font-semi text-[10px] tracking-[0.16em] text-accent-300 hover:text-paper"
            >
              EXIT
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
