#!/usr/bin/env node
/**
 * Read the mirrored mail for opportunities worth proposing.
 *
 *   DATABASE_URL=… node opportunity-sweep.mjs
 *
 * This runs after the mail mirror, on the same data the screen shows, so it
 * needs nothing from Gmail. It only ever files `suggested` rows — never his
 * list — and the unique index on (source, source_ref) means a conversation he
 * already declined is never proposed twice.
 *
 * The detection rules are the ones in lib/opportunities/detect.ts, kept in step
 * by the test suite. They are duplicated here rather than imported because the
 * jobs are plain ESM that runs outside the compiled app; opportunities.test.ts
 * covers the TypeScript original, and detect-parity.test.ts checks the two
 * agree on the same inputs.
 */
import postgres from 'postgres';
import { detectOpportunity } from './opportunity-detect.mjs';

const DB = process.env.DATABASE_URL;
const DAYS = Number(process.env.OPPORTUNITY_LOOKBACK_DAYS ?? 30);
/*
 * The label he applies in Gmail.
 *
 * This is the capture path that actually fits how he works: he answers mail
 * from Gmail, not from the cockpit, so a button on the cockpit's mail screen
 * is a button he is never looking at. A label is one click in the place he
 * already is, and applying it is his judgement — so a labelled thread is filed
 * as his, not proposed.
 */
const CAPTURE_LABELS = (process.env.GMAIL_OPPORTUNITY_LABEL ?? 'Opportunity,הזדמנות')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MAX = Number(process.env.OPPORTUNITY_SCAN_MAX ?? 300);

if (!DB) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const sql = postgres(DB, { max: 2 });

async function main() {
  const started = Date.now();

  const threads = await sql`
    select thread_id, subject, snippet, counterpart_name, counterpart_email,
           known_contact, known_company, last_from_me, last_message_at, labels
    from mail_threads
    where last_message_at >= now() - ${`${DAYS} days`}::interval
    order by last_message_at desc
    limit ${MAX}
  `;

  let proposed = 0;
  let matched = 0;
  let labelled = 0;

  for (const t of threads) {
    // A label he applied himself outranks anything the detector thinks. It
    // also applies to threads he has already replied to, which the detector
    // deliberately ignores — he can label a conversation he is in the middle of.
    const hasLabel = (t.labels ?? []).some((l) => CAPTURE_LABELS.includes(l));
    if (hasLabel) {
      const inserted = await sql`
        insert into opportunities
          (title, kind, status, counterparty, source, source_ref, source_url,
           source_excerpt, source_at, detect_reasons, created_by)
        values (
          ${t.subject ?? 'Untitled opportunity'},
          'other',
          'new',
          ${t.known_company ?? t.counterpart_name ?? t.counterpart_email},
          'mail',
          ${t.thread_id},
          ${`https://mail.google.com/mail/u/0/#all/${t.thread_id}`},
          ${t.snippet},
          ${t.last_message_at},
          ${['labelled in Gmail']},
          'gmail-label'
        )
        on conflict (source, source_ref) where source_ref is not null
        do update set status = case
          -- A label promotes a pending suggestion, but never reopens something
          -- he has already decided or archived.
          when opportunities.status = 'suggested' then 'new'
          else opportunities.status
        end
        returning id
      `;
      if (inserted.length > 0) labelled += 1;
      continue;
    }

    const detection = detectOpportunity({
      subject: t.subject,
      snippet: t.snippet,
      counterpartEmail: t.counterpart_email,
      counterpartName: t.counterpart_name,
      knownContact: t.known_contact,
      knownCompany: t.known_company,
      lastFromMe: t.last_from_me,
    });
    if (!detection.isOpportunity) continue;
    matched += 1;

    const inserted = await sql`
      insert into opportunities
        (title, kind, status, counterparty, source, source_ref, source_url,
         source_excerpt, source_at, detect_reasons, detect_score, created_by)
      values (
        ${t.subject ?? 'Untitled opportunity'},
        ${detection.kind},
        'suggested',
        ${t.known_company ?? t.counterpart_name ?? t.counterpart_email},
        'mail',
        ${t.thread_id},
        ${`https://mail.google.com/mail/u/0/#all/${t.thread_id}`},
        ${t.snippet},
        ${t.last_message_at},
        ${detection.reasons},
        ${detection.score},
        'mail-detector'
      )
      on conflict (source, source_ref) where source_ref is not null do nothing
      returning id
    `;
    if (inserted.length > 0) proposed += 1;
  }

  const [counts] = await sql`
    select
      count(*) filter (where status = 'suggested' and archived_at is null) as waiting,
      count(*) filter (where status in ('new','exploring') and archived_at is null) as open
    from opportunities
  `;

  console.log(
    `read ${threads.length} conversations in ${Math.round((Date.now() - started) / 1000)}s. ` +
      `${labelled} carried the "${CAPTURE_LABELS.join('" or "')}" label and were filed directly. ` +
      `${matched} others looked like opportunities, ${proposed} of those were new. ` +
      `${counts.waiting} awaiting his judgement, ${counts.open} open.`,
  );

  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
