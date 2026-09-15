import { describe, expect, it } from 'vitest';
import { authConfig } from '@/auth.config';

/**
 * Where a signed-in person lands.
 *
 * Assaf took up his invitation, set a password, saved it, and reported back
 * that the cockpit would not recognise it. It did: `last_login_at` recorded
 * every attempt. What happened next is the bug — the sign-in form sends
 * everybody to `/`, a collaborator may not reach `/`, so the middleware
 * answered "sign in" to somebody who just had, and he read that as the
 * password being refused.
 *
 * "Sign in" is the wrong answer to a person holding a valid session. The right
 * one is the page they can actually reach.
 */
const authorized = authConfig.callbacks!.authorized!;

const ask = (pathname: string, role?: 'owner' | 'operator' | 'collaborator') =>
  authorized({
    request: { nextUrl: new URL(`https://cockpit.example${pathname}`) },
    auth: role ? { user: { email: 'assaf@adnimation.com', role } } : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

describe('where a signed-in person lands', () => {
  it('sends a collaborator who hit the home page to the tasks board', async () => {
    const answer = await ask('/', 'collaborator');

    // Not `false` — that means "sign in", which is a lie to somebody who has.
    expect(answer).not.toBe(false);
    expect(answer).toBeInstanceOf(Response);
    expect((answer as Response).headers.get('location')).toContain('/tasks');
  });

  it('does the same for every other screen they cannot reach', async () => {
    for (const page of ['/pipeline', '/contracts', '/mail', '/settings', '/copilot']) {
      const answer = await ask(page, 'collaborator');
      expect((answer as Response).headers.get('location'), page).toContain('/tasks');
    }
  });

  it('leaves them alone on the board itself', async () => {
    expect(await ask('/tasks', 'collaborator')).toBe(true);
    expect(await ask('/tasks/abc-123', 'collaborator')).toBe(true);
  });

  it('still lets the two real accounts go anywhere', async () => {
    expect(await ask('/', 'owner')).toBe(true);
    expect(await ask('/contracts', 'operator')).toBe(true);
  });

  it('still asks somebody with no session to sign in', async () => {
    expect(await ask('/tasks')).toBe(false);
    expect(await ask('/')).toBe(false);
  });

  it('lets an invitation link through without a session — that is the point of it', async () => {
    expect(await ask('/join/abc')).toBe(true);
    expect(await ask('/login')).toBe(true);
  });
});
