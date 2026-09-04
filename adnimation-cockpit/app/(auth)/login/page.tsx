import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SignInForm } from '@/components/sign-in-form';

/**
 * One account signs in here (spec §2). Anyone else gets a clean rejection — no
 * hint about who is allowed, no retry loop, no support address to work on.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string; callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect('/');

  const { error } = await searchParams;
  const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  return (
    <main className="hud-ground flex min-h-dvh items-center justify-center p-6">
      <div className="hud-card hud-marks w-full max-w-sm p-8">
        <div className="font-cond text-[25px] font-semibold leading-none tracking-[0.2em] text-neutral-900">
          Adnimation
        </div>
        <div className="mt-2 hud-kicker">CEO COCKPIT</div>

        <SignInForm googleEnabled={googleEnabled} initialError={error} />
      </div>
    </main>
  );
}
