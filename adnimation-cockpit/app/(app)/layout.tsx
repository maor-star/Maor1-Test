import { requireUser } from '@/lib/auth/session';
import { signOut as signOutAction } from '@/auth';
import { Rail } from '@/components/hud/rail';
import { MobileNav } from '@/components/hud/mobile-nav';
import { TelemetryStrip } from '@/components/hud/telemetry-strip';

/**
 * The console shell from the design handoff: a 248px sticky rail beside the
 * blueprint ground, a top bar, and the full-width telemetry strip.
 *
 * Below `lg` the rail is replaced by a top bar and a menu sheet — a phone has
 * no room for a 248px column, and the pages are read on one daily.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const signOut = async () => {
    'use server';
    await signOutAction({ redirectTo: '/login' });
  };

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[248px_1fr]">
      <Rail
        userName={user.name}
        userRole={user.role}
        signOutAction={signOut}
      />

      <main className="hud-ground min-w-0">
        <MobileNav userName={user.name} userRole={user.role} signOutAction={signOut} />
        <TelemetryStrip />
        <div className="px-4 py-4 pb-14 sm:px-6 lg:px-[30px] lg:py-[22px]">{children}</div>
      </main>
    </div>
  );
}
