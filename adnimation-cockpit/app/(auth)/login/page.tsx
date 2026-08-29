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
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6">
        <h1 className="text-lg font-semibold">Adnimation CEO Cockpit</h1>

        {rejected ? (
          <>
            <p className="mt-3 text-sm text-destructive">אין לך גישה למערכת הזו.</p>
            <p className="mt-1 text-2xs text-muted-foreground">
              המערכת פרטית ומשרתת שני חשבונות בלבד.
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            כניסה עם חשבון Google Workspace של החברה.
          </p>
        )}

        <form
          className="mt-5"
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/' });
          }}
        >
          <Button type="submit" className="w-full">
            כניסה עם Google
          </Button>
        </form>
      </div>
    </main>
  );
}
