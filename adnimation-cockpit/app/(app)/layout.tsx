import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { signOut } from '@/auth';
import { Button } from '@/components/ui/button';

/** Spec §4 — the module list. Milestone 1 lights up Cockpit and Tasks. */
const NAV = [
  { href: '/', label: 'Cockpit' },
  { href: '/tasks', label: 'משימות' },
  { href: '/delegations', label: 'האצלות' },
  { href: '/inbox', label: 'התראות', soon: true },
  { href: '/revenue', label: 'הכנסות', soon: true },
  { href: '/pipeline', label: 'פייפליין', soon: true },
  { href: '/partners', label: 'שותפים', soon: true },
  { href: '/contracts', label: 'חוזים', soon: true },
  { href: '/agents', label: 'סוכנים', soon: true },
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-2">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Adnimation <span className="text-muted-foreground">Cockpit</span>
          </Link>

          <nav className="flex flex-1 flex-wrap items-center gap-0.5">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-disabled={'soon' in item && item.soon ? true : undefined}
                className={
                  'soon' in item && item.soon
                    ? 'pointer-events-none rounded px-2 py-1 text-xs text-muted-foreground/50'
                    : 'rounded px-2 py-1 text-xs hover:bg-accent'
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <span className="text-2xs text-muted-foreground">
              {user.name}
              {user.role === 'operator' ? ' · מפעילה' : ''}
            </span>
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/login' });
              }}
            >
              <Button type="submit" variant="ghost" size="xs">
                יציאה
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-4">{children}</main>
    </div>
  );
}
