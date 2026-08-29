import { requireUser } from '@/lib/auth/session';
import { signOut } from '@/auth';
import { Rail } from '@/components/hud/rail';
import { TelemetryStrip } from '@/components/hud/telemetry-strip';

/**
 * The console shell from the design handoff: a 248px sticky rail beside the
 * blueprint ground, a top bar, and the full-width telemetry strip.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[248px_1fr]">
      <Rail
        userName={user.name}
        userRole={user.role}
        signOutAction={async () => {
          'use server';
          await signOut({ redirectTo: '/login' });
        }}
      />

      <main className="hud-ground min-w-0">
        <TelemetryStrip />
        <div className="px-[30px] py-[22px] pb-14">{children}</div>
      </main>
    </div>
  );
}
