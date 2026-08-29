import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { isAllowedEmail, roleForEmail } from '@/lib/auth/allowlist';
import { verifyPassword } from '@/lib/auth/password';

/**
 * Edge-safe half of the Auth.js config.
 *
 * The middleware runs on the Edge runtime, so anything it imports must avoid
 * Node-only modules — no database here. `auth.ts` extends this with the
 * db-touching jwt callback for the Node runtime.
 *
 * This split matters for more than tidiness: the middleware must *decode and
 * verify* the session cookie, not merely notice one exists. Checking presence
 * alone lets a request carrying any junk cookie through to a render, and a
 * redirect thrown inside a layout does not stop the page's Server Components
 * from streaming their data into the response body.
 */

/** Public surfaces: auth endpoints, webhooks and the Inngest handler. */
const PUBLIC_PREFIXES = ['/login', '/api/auth', '/api/webhooks', '/api/inngest'];

/**
 * Password sign-in for the owner account.
 *
 * One account, named explicitly by `OWNER_EMAIL`, with a PBKDF2 hash in
 * `OWNER_PASSWORD_HASH`. There is no registration: an account exists because it
 * is configured on the server, not because someone signed up. Both env vars
 * must be set or the provider rejects everything.
 */
const ownerPassword = Credentials({
  id: 'password',
  name: 'Password',
  credentials: {
    email: { label: 'Email', type: 'email' },
    password: { label: 'Password', type: 'password' },
  },
  async authorize(raw) {
    const email = String(raw?.email ?? '').trim().toLowerCase();
    const password = String(raw?.password ?? '');
    if (!email || !password) return null;

    const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
    if (!owner || email !== owner) return null;

    // Still subject to the allowlist: the owner address must also be listed.
    if (!isAllowedEmail(email, process.env.ALLOWED_EMAILS)) return null;

    if (!(await verifyPassword(password, process.env.OWNER_PASSWORD_HASH))) return null;

    return { id: email, email, name: process.env.OWNER_NAME ?? email };
  },
});

/** Google is only offered when an OAuth client is actually configured. */
const googleConfigured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const authConfig = {
  providers: [
    ownerPassword,
    ...(googleConfigured
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
            authorization: { params: { prompt: 'select_account', hd: 'adnimation.com' } },
          }),
        ]
      : []),
  ],
  session: {
    strategy: 'jwt',
    // Spec 2.2 — automatic disconnect after inactivity.
    maxAge: 12 * 60 * 60,
    updateAge: 30 * 60,
  },
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    /** Runs in middleware on every request. A false return redirects to /login. */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
      // A session only exists here if the cookie decoded and verified.
      return Boolean(auth?.user?.email);
    },

    /**
     * The allowlist gate, applied to every provider. The password provider has
     * already checked it; this covers Google and anything added later, so no
     * provider can mint a session for an address outside the list.
     */
    signIn({ user, profile }) {
      const email = profile?.email ?? user?.email;
      return isAllowedEmail(email, process.env.ALLOWED_EMAILS);
    },

    jwt({ token, profile, user }) {
      const email = (profile?.email ?? user?.email ?? token.email)?.toLowerCase();
      if (!email) return token;
      token.email = email;
      token.role = roleForEmail(email, process.env.ALLOWED_EMAILS) ?? 'operator';
      return token;
    },

    session({ session, token }) {
      if (session.user) {
        session.user.id = (token.uid as string | undefined) ?? '';
        session.user.role = (token.role as 'owner' | 'operator') ?? 'operator';
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
