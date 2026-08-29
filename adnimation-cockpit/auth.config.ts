import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import { isAllowedEmail, roleForEmail } from '@/lib/auth/allowlist';

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

export const authConfig = {
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Google Workspace SSO; 2FA is enforced on the Workspace account (spec 2.2).
      authorization: { params: { prompt: 'select_account', hd: 'adnimation.com' } },
    }),
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

    // The allowlist gate. Nothing downstream re-checks membership, so this must
    // be the single place a session can be born (spec §2).
    signIn({ profile }) {
      return isAllowedEmail(profile?.email, process.env.ALLOWED_EMAILS);
    },

    jwt({ token, profile }) {
      const email = (profile?.email ?? token.email)?.toLowerCase();
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
