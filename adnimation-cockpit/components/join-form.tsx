'use client';

import { useState, useTransition } from 'react';
import { signIn } from 'next-auth/react';
import { acceptInviteAction } from '@/app/actions/invite';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MIN_PASSWORD } from '@/lib/tasks/invite-limits';

/**
 * Choosing a name and a password behind an invitation link.
 *
 * It signs them in straight afterwards rather than sending them to the login
 * page to type what they have just typed. A person who has already proved they
 * hold the link and has just set the password does not need to prove it twice
 * in the same minute, and the round trip is where people give up.
 */
export function JoinForm({
  token,
  email,
  name,
  returning,
}: {
  token: string;
  email: string;
  name: string | null;
  /** True when this address already set a password once — this one replaces it. */
  returning: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="mt-6 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        data.set('token', token);
        const password = String(data.get('password') ?? '');
        setError(null);
        startTransition(async () => {
          const result = await acceptInviteAction(data);
          if (!result.ok) {
            setError(result.error ?? 'That did not work');
            return;
          }
          // Straight in, rather than back to a login form to retype this.
          const signedIn = await signIn('password', {
            email: result.email,
            password,
            redirect: false,
          });
          window.location.href = signedIn?.error ? '/login' : '/tasks';
        });
      }}
    >
      <label className="block space-y-1">
        <span className="hud-label block text-[10.5px]">Your email</span>
        <Input value={email} readOnly disabled />
      </label>

      <label className="block space-y-1">
        <span className="hud-label block text-[10.5px]">Your name</span>
        <Input name="name" defaultValue={name ?? ''} required minLength={2} maxLength={120} />
      </label>

      <label className="block space-y-1">
        <span className="hud-label block text-[10.5px]">
          {returning ? 'Choose a new password' : 'Choose a password'}
        </span>
        <Input
          name="password"
          type="password"
          required
          minLength={MIN_PASSWORD}
          autoComplete="new-password"
        />
      </label>

      <label className="block space-y-1">
        <span className="hud-label block text-[10.5px]">And again</span>
        <Input name="confirm" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" />
      </label>

      <p className="text-[12px] text-muted">At least {MIN_PASSWORD} characters.</p>

      {error ? <p className="text-[13px] text-neg">{error}</p> : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'SETTING UP…' : returning ? 'SET NEW PASSWORD' : 'CREATE MY ACCESS'}
      </Button>
    </form>
  );
}
