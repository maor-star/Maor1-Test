import { redirect } from 'next/navigation';
import { auth, signIn } from '@/auth';
import { Button } from '@/components/ui/button';

/**
 * Two accounts exist (spec §2). Anyone else gets a clean rejection — no hint
 * about who is allowed, no retry loop, no support address to socially engineer.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect('/');

  const { error } = await searchParams;
  const rejected = error === 'AccessDenied';

  return (
    <main className="hud-ground flex min-h-dvh items-center justify-center p-6">
      <div className="hud-card hud-marks w-full max-w-sm p-8">
        <div className="font-cond text-[25px] font-semibold leading-none tracking-[0.2em] text-neutral-900">
          ADNIMATION
        </div>
        <div className="mt-2 hud-kicker">CEO COCKPIT</div>

        {rejected ? (
          <>
            <p className="mt-6 text-[13px] text-sev-critical">You do not have access to this system.</p>
            <p className="mt-1 font-semi text-[11px] tracking-[0.1em] text-neutral-500">
              This console is private and serves two accounts.
            </p>
          </>
        ) : (
          <p className="mt-6 text-[13px] leading-[1.5] text-neutral-700">
            Sign in with your company Google Workspace account.
          </p>
        )}

        <form
          className="mt-6"
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/' });
          }}
        >
          <Button type="submit" className="w-full">
            SIGN IN WITH GOOGLE
          </Button>
        </form>
      </div>
    </main>
  );
}
