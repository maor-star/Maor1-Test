import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

/**
 * Session verification happens here, before any page renders.
 *
 * `NextAuth(...).auth` decodes and verifies the session cookie and applies the
 * `authorized` callback. An unverifiable cookie is redirected at the edge, so
 * no Server Component ever runs — and no data ever reaches the response body.
 */
export const { auth: middleware } = NextAuth(authConfig);
export default middleware;

export const config = {
  // Skip Next internals and static assets; everything else is checked.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)'],
};
