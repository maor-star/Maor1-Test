import { requireUser } from '@/lib/auth/session';
import { signOut as signOutAction } from '@/auth';
import { Rail } from '@/components/hud/rail';
import { MobileNav } from '@/components/hud/mobile-nav';
import { TelemetryStrip } from '@/components/hud/telemetry-strip';
import { UndoProvider } from '@/components/ui/undo-bar';

// The telemetry strip is live operating data; nothing in this shell may be
// cached between requests or the ticker silently shows yesterday.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The shell: a 248px sticky rail beside the gradient ground, and one padded
 * column holding the Adnimation Total strip and the page.
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
    <UndoProvider>
      <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[248px_1fr]">
        <Rail userName={user.name} userRole={user.role} signOutAction={signOut} />

        <main className="min-w-0">
          <MobileNav userName={user.name} userRole={user.role} signOutAction={signOut} />
          <div className="mx-auto flex max-w-[1340px] flex-col gap-[22px] px-4 py-4 pb-16 sm:px-6 lg:px-[30px] lg:py-[26px]">
            <TelemetryStrip />
            {children}
          </div>
        </main>
      </div>
    </UndoProvider>
  );
}
