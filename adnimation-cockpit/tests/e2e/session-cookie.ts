import { encode } from '@auth/core/jwt';

/**
 * Mints the same session cookie Auth.js would issue after a successful Google
 * sign-in, so E2E tests can exercise authenticated pages without driving an
 * external OAuth flow.
 *
 * This is a test helper, not an application bypass: it signs a real token with
 * the deployment's AUTH_SECRET, and the app verifies it through the normal
 * middleware path. Without the secret it produces nothing usable.
 */
export async function mintSessionCookie(opts: {
  email: string;
  name: string;
  role: 'owner' | 'operator';
  uid?: string;
  secret?: string;
}): Promise<{ name: string; value: string }> {
  const secret = opts.secret ?? process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is required to mint a test session cookie');

  const value = await encode({
    token: { email: opts.email, name: opts.name, role: opts.role, uid: opts.uid ?? '' },
    secret,
    salt: 'authjs.session-token',
    maxAge: 60 * 60,
  });

  return { name: 'authjs.session-token', value };
}
