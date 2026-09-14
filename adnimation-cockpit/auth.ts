import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { eq } from 'drizzle-orm';
import { authConfig } from '@/auth.config';
import { isAllowedEmail, roleForEmail } from '@/lib/auth/allowlist';
import { verifyPassword } from '@/lib/auth/password';

/**
 * Node-runtime Auth.js instance. Extends the edge-safe config in
 * `auth.config.ts` with the parts that need database access.
 *
 * The password provider is one of them now. The edge copy accepts the owner
 * address and nothing else, which is all it can do without a database — and
 * that was the whole reason granting somebody access got them nowhere: the
 * grant stored, the middleware honoured it, and there was no way for them to
 * obtain a session, because Google OAuth is not configured on this server so
 * that button is not even drawn.
 *
 * This one accepts the owner OR somebody who took up an invitation and chose
 * their own password. Same provider id, so the sign-in form is unchanged, and
 * this definition is the one that runs: Auth.js authorises credentials in the
 * route handler, which is this instance and never the middleware.
 */
const password = Credentials({
  id: 'password',
  name: 'Password',
  credentials: {
    email: { label: 'Email', type: 'email' },
    password: { label: 'Password', type: 'password' },
  },
  async authorize(raw) {
    const email = String(raw?.email ?? '').trim().toLowerCase();
    const secret = String(raw?.password ?? '');
    if (!email || !secret) return null;

    const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
    if (owner && email === owner) {
      // The owner is still gated on the allowlist, so the two real accounts
      // never depend on a table being readable to get in.
      if (!isAllowedEmail(email, process.env.ALLOWED_EMAILS)) return null;
      if (!(await verifyPassword(secret, process.env.OWNER_PASSWORD_HASH))) return null;
      return { id: email, email, name: process.env.OWNER_NAME ?? email };
    }

    const { verifyCollaborator } = await import('@/lib/tasks/invite-service');
    const person = await verifyCollaborator(email, secret).catch(() => null);
    // A correct password is not a key on its own: signIn below still asks
    // whether they have a live grant, so revoking one shuts the door at once.
    return person ? { id: person.email, email: person.email, name: person.name } : null;
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [password, ...authConfig.providers.filter((p) => p.id !== 'password')],
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
