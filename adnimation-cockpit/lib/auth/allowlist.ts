/**
 * Two accounts, total (spec §2). Everyone else is rejected at the OAuth
 * callback — before a session is ever issued.
 */
export function parseAllowedEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export function isAllowedEmail(email: string | null | undefined, raw: string | undefined): boolean {
  if (!email) return false;
  const allowed = parseAllowedEmails(raw);
  // An empty allowlist locks everyone out. That is the safe direction: a
  // missing env var must never open the system up.
  if (allowed.length === 0) return false;
  return allowed.includes(email.trim().toLowerCase());
}

/** The owner is the first address in ALLOWED_EMAILS; the second is the operator. */
export function roleForEmail(
  email: string,
  raw: string | undefined,
): 'owner' | 'operator' | null {
  const allowed = parseAllowedEmails(raw);
  const index = allowed.indexOf(email.trim().toLowerCase());
  if (index === -1) return null;
  return index === 0 ? 'owner' : 'operator';
}
