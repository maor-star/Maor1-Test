'use client';

import { useState, useTransition } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

/**
 * Email and password for the owner account. Google appears only when an OAuth
 * client is configured on the server, so there is never a button that cannot work.
 */
export function SignInForm({
  googleEnabled,
  initialError,
}: {
  googleEnabled: boolean;
  initialError?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(
    initialError === 'AccessDenied'
      ? 'That account does not have access to this system.'
      : initialError
        ? 'Sign-in failed. Please try again.'
        : null,
  );

  return (
    <>
      <p className="mt-6 text-[13px] leading-[1.5] text-neutral-700">
        Sign in to continue.
      </p>

      <form
        className="mt-5 flex flex-col gap-3"
        action={(formData) => {
          startTransition(async () => {
            setError(null);
            const res = await signIn('password', {
              email: String(formData.get('email') ?? ''),
              password: String(formData.get('password') ?? ''),
              redirect: false,
            });
            if (res?.error) {
              // Deliberately does not say which of the two was wrong.
              setError('Incorrect email or password.');
              return;
            }
            window.location.assign('/');
          });
        }}
      >
        <div>
          <Label htmlFor="signin-email">Email</Label>
          <Input
            id="signin-email"
            name="email"
            type="email"
            autoComplete="username"
            required
            dir="ltr"
            placeholder="you@adnimation.com"
          />
        </div>

        <div>
          <Label htmlFor="signin-password">Password</Label>
          <Input
            id="signin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            dir="ltr"
          />
        </div>

        {error ? <p className="text-[12px] text-sev-critical">{error}</p> : null}

        <Button type="submit" disabled={pending} className="mt-1 w-full">
          {pending ? 'SIGNING IN…' : 'SIGN IN'}
        </Button>
      </form>

      {googleEnabled ? (
        <>
          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="hud-label text-[11px]">OR</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => signIn('google', { callbackUrl: '/' })}
          >
            Sign in with Google
          </Button>
        </>
      ) : null}
    </>
  );
}
