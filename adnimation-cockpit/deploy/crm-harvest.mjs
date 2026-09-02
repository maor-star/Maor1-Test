#!/usr/bin/env node
/**
 * Read the mailbox, and put the people in it into the CRM.
 *
 *   DATABASE_URL=… GOOGLE_SERVICE_ACCOUNT_KEY=… GMAIL_MAILBOX=… \
 *   ANTHROPIC_API_KEY=… node crm-harvest.mjs
 *
 * Every real conversation carries what a CRM asks for — who the person is,
 * their title, their company, their phone — sitting in a signature block
 * nobody has ever copied anywhere. This reads it off the mail instead.
 *
 * Three rules decide whether this is useful or a mess, and they are enforced
 * in crm-from-mail.mjs so the screen and this job agree:
 *
 *  · Only real people. No-reply addresses, newsletters and alerts outnumber
 *    the people, and one bad row teaches him not to trust the list.
 *  · Never our own domain. The team lives in `people`, not the CRM.
 *  · A field is only ever filled in, never overwritten — and a record he has
 *    edited is left entirely alone, exactly as the HubSpot sync leaves it.
 *
 * DAYS=365 covers the backfill; the timer runs it over a short window. DRY=1
 * reads and reports without writing.
 */
import { createSign } from 'node:crypto';
import postgres from 'postgres';
import {
  domainOf, fieldsToFill, isCompanyDomain, isHarvestable, linksInSignature, signatureBlock,
} from './crm-from-mail.mjs';

const DB = process.env.DATABASE_URL;
const RAW_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const MAILBOX = process.env.GMAIL_MAILBOX;
const CLAUDE = process.env.ANTHROPIC_API_KEY;
const DAYS = Number(process.env.DAYS ?? 30);
const MAX = Number(process.env.HARVEST_MAX ?? 400);
const BATCH = Number(process.env.HARVEST_BATCH ?? 12);
const DRY = process.env.DRY === '1';

if (!DB || !RAW_KEY || !MAILBOX) {
  console.error('DATABASE_URL, GOOGLE_SERVICE_ACCOUNT_KEY and GMAIL_MAILBOX are required.');
  process.exit(1);
}
if (!CLAUDE) {
  console.error('ANTHROPIC_API_KEY is required — the signatures have to be read.');
  process.exit(78);
}

const sql = postgres(DB, { max: 2, onnotice: () => {} });
const b64 = (i) =>
  Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const tokens = new Map();
async function token(scope) {
  const held = tokens.get(scope);
  if (held && held.expiresAt > Date.now() + 60_000) return held.value;

  const key = JSON.parse(
    RAW_KEY.trim().startsWith('{') ? RAW_KEY : Buffer.from(RAW_KEY, 'base64').toString('utf8'),
  );
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64(JSON.stringify({
    iss: key.client_email, sub: MAILBOX, scope,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${b64(signer.sign(key.private_key.replace(/\\n/g, '\n')))}`;

  const body = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  }).then((r) => r.json());

  if (!body.access_token) throw new Error(`${scope}: ${body.error}`);
  tokens.set(scope, {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}

const READ = 'https://www.googleapis.com/auth/gmail.readonly';

async function gmail(path) {
  const t = await token(READ);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(`gmail ${path}: http_${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const header = (hs, name) => hs.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

function plainText(part, out = []) {
  if (!part) return out;
  if (part.mimeType === 'text/plain' && part.body?.data) {
    out.push(Buffer.from(part.body.data, 'base64').toString('utf8'));
  }
  for (const child of part.parts ?? []) plainText(child, out);
  return out;
}

const parseFrom = (raw) => {
  const email = (/<([^>]+)>/.exec(raw)?.[1] ?? raw).trim().toLowerCase();
  const name = (/^(.*)</.exec(raw)?.[1] ?? '').trim().replace(/^"|"$/g, '');
  return { email, name: name || null };
};

/**
 * One signature per person, newest first.
 *
 * Newest wins because titles change and people move companies; reading the
 * oldest mail from someone would file them at a job they left.
 */
async function collect() {
  const found = new Map();
  let pageToken;

  while (found.size < MAX) {
    const page = await gmail(
      `/messages?maxResults=100&q=${encodeURIComponent(
        `newer_than:${DAYS}d -in:chats -in:spam -in:trash -from:me`,
      )}` + (pageToken ? `&pageToken=${pageToken}` : ''),
    );
    const refs = page.messages ?? [];
    if (refs.length === 0) break;

    for (const ref of refs) {
      if (found.size >= MAX) break;

      /*
       * Two passes over each message: the headers alone are enough to decide
       * whether this sender is worth reading, and most of them are not. A
       * year of mail is thousands of messages; fetching every body to throw
       * nearly all of them away is twenty minutes of nothing.
       */
      const head = await gmail(
        `/messages/${ref.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      ).catch(() => null);
      if (!head) continue;

      const from = parseFrom(header(head.payload?.headers ?? [], 'from') ?? '');
      if (!from.email || found.has(from.email)) continue;
      if (!isHarvestable({ email: from.email }).ok) continue;

      const message = await gmail(`/messages/${ref.id}?format=full`).catch(() => null);
      if (!message) continue;
      const hs = message.payload?.headers ?? [];

      const block = signatureBlock(plainText(message.payload).join('\n') || message.snippet || '');
      found.set(from.email, {
        email: from.email,
        fromName: from.name,
        signature: block.slice(0, 1200),
        subject: header(hs, 'subject') ?? '',
        // The conversation the signature came out of, so a detail on the
        // contact card can be traced back to the mail that supplied it.
        threadId: message.threadId ?? ref.threadId ?? null,
        at: new Date(Number(message.internalDate ?? Date.now())),
      });
    }

    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }

  return [...found.values()];
}

const SYSTEM = `You are reading email signatures to fill in a CRM.

For each message you are given the sender's address, the display name on the
message, and the last lines of what they wrote — which usually contains their
signature.

Report only what is actually there. An empty field is correct and useful; a
guess is not. In particular:

· Never infer a job title from the tone of the message or from the company.
· Never invent a company from the email domain alone — if the signature does
  not name the company and the domain is a generic mailbox, leave it null. If
  the domain plainly IS the company (dana@taboola.com with no signature), you
  may use the domain's obvious name.
· Take the phone numbers exactly as written, including the country code. When
  the signature gives two, the one marked M/Mobile/Cell/נייד is the mobile and
  the one marked T/O/Tel/Office/Direct is the phone. With only one number and
  no label, it is the phone.
· address is the postal address as written, on one line. Not a country on its
  own, not a building with no street — the address a letter could be sent to.
· Split the name into first and last as the signature gives it. Hebrew names
  stay in Hebrew.
· country and city only when the signature says so — an address line, not a
  time zone or a phone prefix.

Also judge, for each one, whether the ADDRESS belongs to a human being — not
whether this particular message was typed by hand. A real person sends calendar
invites, one-line replies and forwards with no signature; those are still that
person's mailbox and still belong in a CRM.

Set "isPerson" false only when the mailbox itself is not a person's: a role
account, a platform sender, a service that mails on somebody's behalf, a
notification or billing address. If the address looks like a name — first.last,
an initial and a surname, a personal free mailbox — it is a person, whatever
this one message happens to contain.

When you genuinely cannot tell, say true. The address patterns have already
removed the obvious machines, and dropping a real contact is the more expensive
mistake: he will never know the person was missed.`;

async function readSignatures(batch) {
  const prompt = [
    batch
      .map(
        (c, i) =>
          `--- ${i + 1} ---\nFrom: ${c.fromName ?? ''} <${c.email}>\nSubject: ${c.subject}\n` +
          `Last lines:\n${c.signature || '(nothing)'}`,
      )
      .join('\n\n'),
    '',
    'Answer as JSON: {"contacts":[{"email":"…","isPerson":true,"firstName":null,' +
      '"lastName":null,"jobTitle":null,"phone":null,"mobile":null,"companyName":null,' +
      '"address":null,"country":null,"city":null}]}',
    'One entry per message, in the same order, with the same email.',
  ].join('\n');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        /*
         * Room for the batch, not a fixed ceiling.
         *
         * One contact's answer is ~130 tokens and twelve short ones already
         * came to 1500 — a batch of real signatures, with addresses and long
         * company names, went past the old flat 2000 and was cut off. A cut
         * answer is not partial: the JSON no longer parses, so the catch below
         * returned an empty list and every contact in that batch silently kept
         * its empty fields.
         */
        max_tokens: Math.max(2000, batch.length * 400),
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (res.ok) {
      const body = await res.json();
      const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      if (body.stop_reason === 'max_tokens') {
        console.error(
          `  the answer for ${batch.length} signatures was cut off at ${body.usage?.output_tokens} tokens`,
        );
      }
      try {
        const parsed = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? text);
        const contacts = Array.isArray(parsed.contacts) ? parsed.contacts : [];
        // Silence here used to be indistinguishable from "found nothing".
        if (contacts.length < batch.length) {
          console.error(
            `  read ${contacts.length} of ${batch.length} signatures — ` +
              `${batch.length - contacts.length} left as they were`,
          );
        }
        return contacts;
      } catch (e) {
        console.error(
          `  could not read the answer for ${batch.length} signatures ` +
            `(${e.message}); they keep whatever they already had`,
        );
        return [];
      }
    }
    if (res.status !== 429 && res.status < 500) {
      throw new Error(`claude: http_${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error('claude: gave up after three attempts');
}

/** The company row for a contact, created only when there is one to create. */
async function companyFor(found, email, now) {
  const domain = domainOf(email);
  const name = (found.companyName ?? '').trim() || null;
  if (!domain || !isCompanyDomain(email)) {
    // A free mailbox is a person, not a company: only a named company counts.
    if (!name) return null;
  }

  const [existing] = await sql`
    select hubspot_id, name, domain, country, city, edited_at
      from crm_companies
     where archived_at is null
       and (
         (${domain}::text is not null and lower(domain) = ${domain})
         or (${name}::text is not null and lower(name) = lower(${name}))
       )
     order by case when source = 'hubspot' then 0 else 1 end
     limit 1
  `;

  if (existing) {
    if (existing.edited_at) return existing.hubspot_id;
    const patch = fieldsToFill(
      { name: existing.name, domain: existing.domain, country: existing.country, city: existing.city },
      {
        name,
        domain: isCompanyDomain(email) ? domain : null,
        country: found.country ?? null,
        city: found.city ?? null,
      },
    );
    // The name is never blanked, and never replaced — only filled if missing.
    delete patch.name;
    if (Object.keys(patch).length > 0 && !DRY) {
      await sql`
        update crm_companies
           set domain = coalesce(${patch.domain ?? null}, domain),
               country = coalesce(${patch.country ?? null}, country),
               city = coalesce(${patch.city ?? null}, city),
               synced_at = ${now}
         where hubspot_id = ${existing.hubspot_id}
      `;
    }
    return existing.hubspot_id;
  }

  const label = name ?? (domain ? domain.split('.')[0].replace(/^\w/, (c) => c.toUpperCase()) : null);
  if (!label) return null;

  const id = `mail:${domain ?? label.toLowerCase()}`;
  if (DRY) return id;

  await sql`
    insert into crm_companies (hubspot_id, name, domain, country, city, source, synced_at)
    values (${id}, ${label}, ${isCompanyDomain(email) ? domain : null},
            ${found.country ?? null}, ${found.city ?? null}, 'mail', ${now})
    on conflict (hubspot_id) do nothing
  `;
  return id;
}

/**
 * Archive the rows a tightened rule would no longer add.
 *
 * The filter is being sharpened against his real mailbox, and each round leaves
 * behind whatever the previous one let through — booking references, campaign
 * ids, per-message aliases. Archived, never deleted (CLAUDE.md §2): the row
 * disappears from every screen and survives if the rule was wrong.
 */
async function tidy(now) {
  const rows = await sql`
    select hubspot_id, email from crm_contacts
     where source = 'mail' and archived_at is null and edited_at is null and email is not null
  `;

  let archived = 0;
  for (const row of rows) {
    if (isHarvestable({ email: row.email }).ok) continue;
    archived += 1;
    console.log(`  ${DRY ? 'WOULD ARCHIVE' : 'archived'} ${row.email}: not a person after all`);
    if (!DRY) {
      await sql`
        update crm_contacts set archived_at = ${now}, synced_at = ${now}
         where hubspot_id = ${row.hubspot_id}
      `;
    }
  }
  console.log(`${archived} rows no longer pass the rule.`);
}

async function main() {
  const started = Date.now();

  if (process.env.TIDY === '1') {
    await tidy(new Date());
    await sql.end();
    process.exit(0);
  }
  console.log(`reading the last ${DAYS} days for people${DRY ? ' (dry run)' : ''}…`);

  const candidates = await collect();
  console.log(`${candidates.length} people wrote to you`);
  if (candidates.length === 0) {
    await sql.end();
    process.exit(0);
  }

  let created = 0;
  let enriched = 0;
  let untouched = 0;
  let machines = 0;
  const now = new Date();

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const read = await readSignatures(batch).catch((e) => {
      console.error(`  batch ${Math.floor(i / BATCH) + 1} failed: ${e.message}`);
      return [];
    });
    const byEmail = new Map(
      read.filter((r) => typeof r?.email === 'string').map((r) => [r.email.toLowerCase(), r]),
    );

    for (const candidate of batch) {
      const found = byEmail.get(candidate.email) ?? {};

      /*
       * The model's own veto, over what the address patterns allowed. It can
       * only ever narrow: it never adds somebody the rules refused. A missing
       * answer counts as a person, because the rules already had their say and
       * a failed batch must not quietly empty the CRM.
       */
      if (found.isPerson === false) {
        machines += 1;
        console.log(`  skipped ${candidate.email}: automated mail, not a person`);
        continue;
      }
      const [existing] = await sql`
        select hubspot_id, first_name, last_name, phone, mobile, job_title, company_name,
               company_id, linkedin_url, website, address, country, city, signature,
               edited_at, last_activity_at
          from crm_contacts
         where archived_at is null and lower(email) = ${candidate.email}
         order by case when source = 'hubspot' then 0 else 1 end
         limit 1
      `;

      // A record he has edited is his. The sync leaves those alone; so does this.
      if (existing?.edited_at) {
        untouched += 1;
        continue;
      }

      const companyId = await companyFor(found, candidate.email, now);

      const nameFromHeader = (candidate.fromName ?? '').trim();
      const [headerFirst, ...headerRest] = nameFromHeader.split(/\s+/);

      /*
       * The links come from the block itself, not from the model: a URL is
       * either in the text or it is not, so reading it here costs nothing and
       * cannot be imagined.
       */
      const links = linksInSignature(candidate.signature ?? '');

      /*
       * One number is one number.
       *
       * Told to read a phone and a mobile, the model puts an unlabelled single
       * number in both — which reads on the card as two ways to reach someone
       * who gave one. Only a number the signature actually distinguished
       * survives as a mobile.
       */
      const sameNumber = (a, b) =>
        a && b && String(a).replace(/\D/g, '') === String(b).replace(/\D/g, '');
      if (sameNumber(found.phone, found.mobile)) found.mobile = null;

      const wanted = {
        first_name: found.firstName ?? (headerFirst || null),
        last_name: found.lastName ?? (headerRest.join(' ') || null),
        job_title: found.jobTitle ?? null,
        phone: found.phone ?? null,
        mobile: found.mobile ?? null,
        company_name: found.companyName ?? null,
        company_id: companyId,
        linkedin_url: links.linkedinUrl,
        website: links.website,
        address: found.address ?? null,
        country: found.country ?? null,
        city: found.city ?? null,
      };

      // The block itself is kept whole. Every field above is a reading of it;
      // this is the thing that was read, and it settles any argument later.
      const block = (candidate.signature ?? '').trim() || null;

      if (existing) {
        const patch = fieldsToFill(
          {
            first_name: existing.first_name,
            last_name: existing.last_name,
            job_title: existing.job_title,
            phone: existing.phone,
            mobile: existing.mobile,
            company_name: existing.company_name,
            company_id: existing.company_id,
            linkedin_url: existing.linkedin_url,
            website: existing.website,
            address: existing.address,
            country: existing.country,
            city: existing.city,
          },
          wanted,
        );
        const newer = !existing.last_activity_at || existing.last_activity_at < candidate.at;
        if (Object.keys(patch).length === 0 && !newer) {
          untouched += 1;
          continue;
        }
        enriched += 1;
        console.log(
          `  ${DRY ? 'WOULD FILL' : 'filled'} ${candidate.email}: ` +
            `${Object.keys(patch).join(', ') || 'last seen'}`,
        );
        if (!DRY) {
          await sql`
            update crm_contacts
               set first_name = coalesce(first_name, ${patch.first_name ?? null}),
                   last_name = coalesce(last_name, ${patch.last_name ?? null}),
                   job_title = coalesce(job_title, ${patch.job_title ?? null}),
                   phone = coalesce(phone, ${patch.phone ?? null}),
                   mobile = coalesce(mobile, ${patch.mobile ?? null}),
                   company_name = coalesce(company_name, ${patch.company_name ?? null}),
                   company_id = coalesce(company_id, ${patch.company_id ?? null}),
                   linkedin_url = coalesce(linkedin_url, ${patch.linkedin_url ?? null}),
                   website = coalesce(website, ${patch.website ?? null}),
                   address = coalesce(address, ${patch.address ?? null}),
                   country = coalesce(country, ${patch.country ?? null}),
                   city = coalesce(city, ${patch.city ?? null}),
                   -- The newest signature wins: a person changes title and
                   -- number, and the block he last sent is the current one.
                   signature = case when ${block}::text is not null
                     and (signature_at is null or signature_at < ${candidate.at})
                     then ${block} else signature end,
                   signature_at = case when ${block}::text is not null
                     and (signature_at is null or signature_at < ${candidate.at})
                     then ${candidate.at} else signature_at end,
                   source_thread_id = coalesce(source_thread_id, ${candidate.threadId ?? null}),
                   last_activity_at = greatest(coalesce(last_activity_at, ${candidate.at}), ${candidate.at}),
                   synced_at = ${now}
             where hubspot_id = ${existing.hubspot_id}
          `;
        }
        continue;
      }

      created += 1;
      console.log(
        `  ${DRY ? 'WOULD ADD' : 'added'} ${candidate.email}` +
          `${wanted.job_title ? ` — ${wanted.job_title}` : ''}` +
          `${wanted.company_name ? ` at ${wanted.company_name}` : ''}`,
      );
      if (!DRY) {
        await sql`
          insert into crm_contacts
            (hubspot_id, first_name, last_name, email, phone, mobile, job_title, company_name,
             company_id, linkedin_url, website, address, country, city, signature, signature_at,
             source_thread_id, last_activity_at, source, synced_at)
          values (${`mail:${candidate.email}`}, ${wanted.first_name}, ${wanted.last_name},
                  ${candidate.email}, ${wanted.phone}, ${wanted.mobile}, ${wanted.job_title},
                  ${wanted.company_name}, ${wanted.company_id}, ${wanted.linkedin_url},
                  ${wanted.website}, ${wanted.address}, ${wanted.country}, ${wanted.city},
                  ${block}, ${block ? candidate.at : null}, ${candidate.threadId ?? null},
                  ${candidate.at}, 'mail', ${now})
          on conflict (hubspot_id) do nothing
        `;
      }
    }

    console.log(`  read ${Math.min(i + BATCH, candidates.length)}/${candidates.length}`);
  }

  if (!DRY) {
    // The count under a company has to follow the contacts now hanging off it.
    await sql`
      update crm_companies c
         set contact_count = (
           select count(*)::int from crm_contacts k
            where k.company_id = c.hubspot_id and k.archived_at is null
         )
       where c.archived_at is null
    `;
  }

  console.log(
    `${created} added, ${enriched} filled in, ${untouched} left alone, ` +
      `${machines} were automated mail, in ${Math.round((Date.now() - started) / 1000)}s.`,
  );

  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
