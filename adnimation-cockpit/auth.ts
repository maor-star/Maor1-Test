import NextAuth from 'next-auth';
import { eq } from 'drizzle-orm';
import { authConfig } from '@/auth.config';
import { roleForEmail } from '@/lib/auth/allowlist';

/**
 * Node-runtime Auth.js instance. Extends the edge-safe config in
 * `auth.config.ts` with the one callback that needs database access.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, profile }) {
      const email = (profile?.email ?? token.email)?.toLowerCase();
      if (!email) return token;
      token.email = email;
      token.role = roleForEmail(email, process.env.ALLOWED_EMAILS) ?? 'operator';

      // Reconcile the users row on first sign-in so audit rows and alert
      // acknowledgements have a real user id to point at.
      if (profile) {
        const { db, users } = await import('@/lib/db');
        const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (existing.length === 0) {
          const [created] = await db
            .insert(users)
            .values({ email, name: profile.name ?? email, role: token.role as string })
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
