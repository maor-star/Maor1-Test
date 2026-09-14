/**
 * The one number the sign-up form and the server both need.
 *
 * Its own module with nothing under it: the form is a client component, and a
 * client component that reaches lib/db — which invite-service.ts does — fails
 * the build with "Can't resolve 'net'".
 */
export const MIN_PASSWORD = 10;

/** How long an invitation link is worth anything. */
export const INVITE_DAYS = 14;
