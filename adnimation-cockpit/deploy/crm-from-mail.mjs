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

/**
 * Addresses that are never a person worth a CRM record.
 *
 * Anchoring these to the start of the address was the first mistake: real
 * senders look like `admanager-noreply@google.com` and
 * `defendercloudnoreply@microsoft.com`, where the tell is in the middle. So
 * the words are matched anywhere in the local part, and the bulk-mail
 * subdomains — mail.x.com, em.x.com — are matched on the domain.
 */
const NOT_A_PERSON = [
  // Anywhere in the local part: the giveaway is rarely at the front.
  /^[^@]*(no-?reply|donotreply|do-not-reply|unsubscribe|mailer-daemon|postmaster)[^@]*@/i,
  /^[^@]*(notification|alert|reminder|digest|newsletter|bulletin|announce)[^@]*@/i,
  /^[^@]*(invoice|billing|receipt|statement|payment|renewal|confirmation|subscription)[^@]*@/i,
  /^(info|support|help|helpdesk|hello|contact|sales|accounts?|admin|team|office|service)@/i,
  /^(marketing|press|media|pr|partners?|partnerships?|bizdev|events?|community|webinars?|feedback|care|welcome|orders?|shop|store)@/i,
  /^(security|abuse|privacy|legal|compliance|policy|dmarc|dpo)@/i,
  /^[^@]*(servicemessage|service-message|servicedesk|customercare|customerservice)[^@]*@/i,
  /^(jobs|careers|recruiting|recruitment|hr|talent)@/i,
  /^(wordpress|webmaster|hostmaster|root|cron|backup|monitor|status)@/i,
  /^[^@]*(bot|daemon|automated|autoresponder|system)[^@]*@/i,
  // Plus-addressed machine mail: invoice+statements@…
  /^[^@]*\+[^@]*@/,
  // The sending infrastructure of bulk mail, whoever it is sent on behalf of.
  /@(mail|email|em|mailer|mailing|send|sender|news|alerts?|notifications?|noreply|updates?|smtp|bounces?|ma)\./i,
  /@(.*\.)?(mailchimp|sendgrid|mailgun|beehiiv|substack|hubspot|salesforce|intercom|zendesk|calendly|sendinblue|klaviyo|constantcontact)\./i,
  /@(.*\.)?(microsoftonline|accountprotection)\.com$/i,
  /*
   * Machine-generated addresses that read like nothing at all: a booking
   * reference, a campaign id, a per-message alias. People do not have six
   * digits in a row in their address, and no signature will ever make one of
   * these worth calling.
   */
  /[0-9]{6,}/,
  /^[^@]{26,}@/,
  /@(support|property|reservations?|booking)\./i,
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
/**
 * The links a signature carries, read without asking a model.
 *
 * A URL is the one thing in a signature that cannot be misread: it is either
 * there or it is not. Reading it here rather than in the prompt means it costs
 * nothing, never hallucinates, and is right even when the block is in Hebrew,
 * a language the pattern does not care about.
 */
const LINKEDIN = /\bhttps?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|company)\/[A-Za-z0-9._%-]+\/?/i;
const URL_ANY = /\bhttps?:\/\/[^\s<>()\[\]"']+/gi;

/** Hosts that appear in a signature but are never the person's own site. */
const NOT_A_SITE =
  /(linkedin|twitter|x\.com|facebook|instagram|youtube|calendly|zoom\.us|teams\.microsoft|meet\.google|wa\.me|whatsapp|bit\.ly|goo\.gl|docs\.google|drive\.google|mailto)/i;

export function linksInSignature(block) {
  const linkedinUrl = block.match(LINKEDIN)?.[0] ?? null;
  const website =
    (block.match(URL_ANY) ?? [])
      .map((u) => u.replace(/[.,;:]+$/, ''))
      .find((u) => !NOT_A_SITE.test(u)) ?? null;
  return { linkedinUrl, website };
}

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
