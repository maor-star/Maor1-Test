import NextAuth from 'next-auth';
import { eq } from 'drizzle-orm';
import { authConfig } from '@/auth.config';
import { isAllowedEmail, roleForEmail } from '@/lib/auth/allowlist';

/**
 * Node-runtime Auth.js instance. Extends the edge-safe config in
 * `auth.config.ts` with the one callback that needs database access.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,

    /**
     * The gate, widened by exactly one thing: a live grant to the tasks board.
     *
     * The edge copy of this callback can only read the env allowlist, because
     * the middleware has no database. This one runs in the Node runtime during
     * the sign-in itself, which is where a grant can actually be looked up, so
     * it replaces it.
     *
     * Order matters. The allowlist is checked first and on its own, so the two
     * real accounts never depend on a table being readable to get in.
     */
    async signIn({ user, profile }) {
      const email = (profile?.email ?? user?.email)?.toLowerCase();
      if (!email) return false;
      if (isAllowedEmail(email, process.env.ALLOWED_EMAILS)) return true;

      const { grantFor } = await import('@/lib/tasks/access-service');
      // A failure to read the grants is a closed door, never an open one.
      const grant = await grantFor(email).catch(() => null);
      return grant !== null;
    },

    async jwt({ token, profile, user }) {
      const email = (profile?.email ?? user?.email ?? token.email)?.toLowerCase();
      if (!email) return token;
      token.email = email;

      /*
       * An account role, or a collaborator, or nothing.
       *
       * This used to fall back to 'operator' for any address that reached it,
       * which was safe while only two addresses could ever sign in. It is not
       * safe now: an address that is on neither list must not land on the role
       * that reads the whole cockpit.
       */
      const accountRole = roleForEmail(email, process.env.ALLOWED_EMAILS);
      if (accountRole) {
        token.role = accountRole;
        token.taskLevel = undefined;
      } else {
        const { grantFor } = await import('@/lib/tasks/access-service');
        const grant = await grantFor(email).catch(() => null);
        token.role = 'collaborator';
        token.taskLevel = grant?.level ?? 'view';
      }

      // Reconcile the users row on first sign-in so audit rows and alert
      // acknowledgements have a real user id to point at.
      if (profile || user) {
        const { db, users } = await import('@/lib/db');
        const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (existing.length === 0) {
          const [created] = await db
            .insert(users)
            .values({ email, name: profile?.name ?? user?.name ?? email, role: token.role as string })
            .returning();
          token.uid = created?.id;
        } else {
          token.uid = existing[0]?.id;
        }
      }
      return token;
    },
  },
});
