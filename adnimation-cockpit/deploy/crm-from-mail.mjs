/**
 * GENERATED FROM lib/crm/from-mail.ts — do not edit by hand.
 *
 * The jobs run as plain ESM outside the compiled app, so they need a
 * JavaScript copy of these rules. tests/unit/crm-from-mail-parity.test.ts
 * feeds both this file and the TypeScript original the same inputs and fails
 * if they ever disagree, so an edit to one without the other cannot ship.
 *
 * Regenerate with: node deploy/build-detect.mjs
 */
/**
 * Turning the mailbox into CRM records.
 *
 * Every real conversation he has carries the things a CRM asks for: who the
 * person is, what they do, which company they are at, their phone number —
 * usually sitting in a signature block nobody has ever copied anywhere. So
 * they are read off the mail instead of typed in.
 *
 * The rules here are the ones that decide whether this is useful or a mess:
 *
 *  · Only real people. Newsletters, no-reply addresses, alerts and receipts
 *    outnumber the people, and one bad row teaches him not to trust the list.
 *  · Never our own domain. The team is in `people`, not the CRM.
 *  · A field is only ever filled in, never overwritten. What HubSpot holds and
 *    what he typed both outrank a guess read out of a footer.
 *  · A record he has edited is left entirely alone, exactly as the HubSpot
 *    sync leaves it (lib/crm/mutations.ts).
 */

/** Addresses that are never a person worth a CRM record. */
const NOT_A_PERSON = [
  /^(no-?reply|do-?not-?reply|noreply)/i,
  /^(info|support|help|hello|contact|sales|billing|accounts?|invoices?|admin|team)@/i,
  /^(notifications?|alerts?|updates?|news|newsletter|digest|mailer|bounce|postmaster)/i,
  /^(security|abuse|privacy|legal|compliance)@/i,
  /^(jobs|careers|recruiting|hr)@/i,
  /@(.*\.)?(mailchimp|sendgrid|mailgun|hubspot|salesforce|intercom|zendesk|calendly)\./i,
  /^[a-z0-9._-]*(bot|daemon|automated|system)[a-z0-9._-]*@/i,
];

/** Free mailboxes: a person, but their domain is not a company. */
export const FREE_MAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com',
  'aol.com', 'walla.co.il', 'walla.com',
];

export function domainOf(email) {
  const at = email.lastIndexOf('@');
  if (at === -1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain === '' ? null : domain;
}

export function isHarvestable(candidate, ownDomains = ['adnimation.com']) {
  const email = candidate.email.trim().toLowerCase();
  if (!email.includes('@') || email.includes(' ')) return { ok: false, why: 'not an address' };

  const domain = domainOf(email);
  if (!domain) return { ok: false, why: 'no domain' };
  if (ownDomains.some((own) => domain === own || domain.endsWith(`.${own}`))) {
    return { ok: false, why: 'one of ours' };
  }
  for (const pattern of NOT_A_PERSON) {
    if (pattern.test(email)) return { ok: false, why: 'not a person' };
  }
  return { ok: true, why: 'a person at another company' };
}

/** True when the address's domain is a company rather than a free mailbox. */
export function isCompanyDomain(email) {
  const domain = domainOf(email);
  return domain !== null && !FREE_MAIL_DOMAINS.includes(domain);
}

/**
 * The tail of a message, where a signature lives.
 *
 * Quoted history is cut first: the signature at the bottom of a forwarded
 * thread belongs to whoever wrote it three replies ago, and attaching their
 * title to this sender is the kind of error nobody catches.
 */
export function signatureBlock(body, lines = 18) {
  const cut = body.search(
    /^(On .+ wrote:|-{2,} ?Original Message|_{5,}|From: |ב.+ בשעה .+ מאת|-{3,} ?Forwarded message)/m,
  );
  const own = (cut > 0 ? body.slice(0, cut) : body)
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('>'));

  return own.slice(-lines).join('\n').trim();
}

/**
 * What we keep from what was read.
 *
 * Everything is optional: a signature that only gives a phone number is still
 * worth having, and inventing the rest to fill the shape is how a CRM becomes
 * a list of plausible-looking wrong facts.
 */
/** Only fills what is empty. Returns the fields that would actually change. */
export function fieldsToFill(existing, found) {
  const patch = {};
  for (const [key, value] of Object.entries(found)) {
    if (value === null || value === undefined || value === '') continue;
    const current = existing[key];
    if (current === null || current === undefined || current === '') patch[key] = value;
  }
  return patch;
}
