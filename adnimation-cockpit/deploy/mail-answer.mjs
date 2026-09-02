#!/usr/bin/env node
/**
 * Answer the genuinely trivial mail, and nothing else.
 *
 *   DATABASE_URL=… GOOGLE_SERVICE_ACCOUNT_KEY=… GMAIL_MAILBOX=… \
 *   ANTHROPIC_API_KEY=… node mail-answer.mjs
 *
 * DRY=1 drafts and shows, and sends nothing. This is the agent that puts words
 * in his mouth to people outside the company, so a dry run is not a nicety —
 * it is how he decides whether to let it speak at all.
 *
 * Three gates, all of which must pass:
 *   1. Rules no model can argue past — nothing about money, contracts, legal,
 *      staff, or any commitment.
 *   2. The model's own veto, which may only narrow what the rules allowed.
 *   3. maySend, which is deliberately not the code that wanted to send.
 *
 * Three outcomes, not two. What it answers is filed under "Claude/Answered".
 * What is only information — nothing asked, nothing to do — is filed under
 * "Claude/Filed" without a word, because not every email needs a reply and
 * none of them need to sit in his inbox. Everything else stays exactly where
 * it is, for him.
 *
 * One Slack message per run, and only about what was answered: what came in,
 * and what went out. A run that answered nothing says nothing.
 */
import { createSign } from 'node:crypto';
import postgres from 'postgres';
import { mayFile, maySend, triage } from './autoreply-rules.mjs';
import { postAsBot } from './bot-post.mjs';
import { agentState, markRan, mayAct, recordRun, startLog } from './agent-brief.mjs';

const DB = process.env.DATABASE_URL;
const RAW_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const MAILBOX = process.env.GMAIL_MAILBOX;
const CLAUDE = process.env.ANTHROPIC_API_KEY;
const ANSWERED_LABEL = process.env.ANSWERED_LABEL ?? 'Claude/Answered';
const FILED_LABEL = process.env.FILED_LABEL ?? 'Claude/Filed';
const DRY = process.env.DRY === '1';
const MAX = Number(process.env.ANSWER_MAX ?? 25);
/*
 * What he has taught it, from the agent's own row — the same text the "TEACH
 * IT" box on the agents screen writes. The environment variable stays as an
 * override for a run by hand.
 */
let INSTRUCTIONS = process.env.ANSWER_INSTRUCTIONS ?? '';

/**
 * How he writes, read off a year of his own replies by mail-learn.mjs.
 *
 * Kept separate from his instructions all the way into the prompt: this says
 * how to sound, his instructions say what to do. Where they disagree, his
 * instructions win, because he wrote them on purpose and this was inferred.
 */
let STYLE = '';

if (!DB || !RAW_KEY || !MAILBOX) {
  console.error('DATABASE_URL, GOOGLE_SERVICE_ACCOUNT_KEY and GMAIL_MAILBOX are required.');
  process.exit(1);
}
if (!CLAUDE) {
  console.error('ANTHROPIC_API_KEY is required — this agent cannot work without it.');
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

  if (!body.access_token) {
    const hint = body.error === 'unauthorized_client' ? ` — grant ${scope}` : '';
    throw new Error(`${scope}: ${body.error}${hint}`);
  }
  tokens.set(scope, {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}

const READ = 'https://www.googleapis.com/auth/gmail.readonly';
const SEND = 'https://www.googleapis.com/auth/gmail.send';
const MODIFY = 'https://www.googleapis.com/auth/gmail.modify';

async function gmail(path, scope = READ, init) {
  const t = await token(scope);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${t}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) throw new Error(`gmail ${path}: http_${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const header = (hs, name) => hs.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

/** Plain text out of a MIME tree, which is what the model should read. */
function plainText(part, out = []) {
  if (!part) return out;
  if (part.mimeType === 'text/plain' && part.body?.data) {
    out.push(Buffer.from(part.body.data, 'base64').toString('utf8'));
  }
  for (const child of part.parts ?? []) plainText(child, out);
  return out;
}

const SYSTEM = `You are drafting a short reply on behalf of Maor Davidovich, CEO
of Adnimation, an Israeli ad-tech company.

You are answering only the mail that is genuinely trivial: an acknowledgement, a
scheduling question, a request for something we can simply point at, or a "who
should I speak to". Everything else you decline.

Decline — set shouldReply false — whenever any of these is true, and say which:
· it needs a fact you do not have
· it touches money, pricing, contracts, legal, staff, or a commitment of any kind
· it could reasonably be read as him agreeing to something
· the sender is upset, or the thread is a negotiation
· you would be guessing at what he thinks
· you are anything less than confident

Declining costs him one email to write himself. A wrong reply commits him, in
writing, to someone who will hold him to it. Those are not comparable, so when
in doubt, decline.

When you do reply: two or three sentences, plain, no pleasantries beyond a
greeting, no promises, no dates he has not given you, and never a figure. Write
in the language the sender wrote in. Sign off as Maor.

Separately, set "informational" true when the message is only telling him
something — a report, a notice, a status update, a newsletter — and nothing is
being asked of him and nothing needs doing. Set it false whenever there is a
question, a request, a decision, a deadline, an invitation, or anything he
would want to act on. In "summary", say in one line what it tells him; that
line is all he will read.`;

async function draft(candidate) {
  const thread = candidate.messages
    .map((m) => `${m.fromMe ? 'Maor' : candidate.fromName}: ${m.text.slice(0, 4000)}`)
    .join('\n\n---\n\n');

  const prompt = [
    `From: ${candidate.fromName} <${candidate.fromEmail}>`,
    candidate.knownCompany ? `They are: ${candidate.knownCompany}` : 'They are not a known contact.',
    `Subject: ${candidate.subject}`,
    '',
    'The thread, oldest first:',
    thread,
    '',
    STYLE.trim()
      ? `How he writes, learned from a year of his own replies. Match this voice:\n${STYLE.trim()}`
      : '',
    INSTRUCTIONS.trim()
      ? `Additional standing instructions from Maor, which override everything above where they are stricter:\n${INSTRUCTIONS.trim()}`
      : '',
    '',
    'Answer as JSON: {"shouldReply": boolean, "reasoning": "one line", "reply": "the text", ' +
      '"confidence": "high|medium|low", "informational": boolean, "summary": "one line saying what it says"}',
  ].filter(Boolean).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1200,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`claude: http_${res.status} ${(await res.text()).slice(0, 200)}`);

  const body = await res.json();
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const json = /\{[\s\S]*\}/.exec(text)?.[0] ?? text;
  return JSON.parse(json);
}

/*
 * The last gate — whether a drafted reply is actually sent — is imported from
 * the generated copy of lib/agents/autoreply.ts rather than written again
 * here. It was written twice, and the two agreed only because nobody had
 * changed either yet: a gate that decides whether mail leaves the building is
 * the last thing that should exist in two versions.
 */

async function labelId(name) {
  const { labels } = await gmail('/labels');
  const found = labels?.find((l) => l.name === name);
  if (found) return found.id;
  if (DRY) return null;
  const created = await gmail('/labels', MODIFY, {
    method: 'POST',
    body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
  });
  console.log(`created the label "${name}"`);
  return created.id;
}

async function send(candidate, replyText) {
  const subject = candidate.subject.toLowerCase().startsWith('re:')
    ? candidate.subject
    : `Re: ${candidate.subject}`;
  const encoded = /^[\x00-\x7F]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;

  const mime = [
    `To: ${candidate.fromEmail}`,
    `Subject: ${encoded}`,
    ...(candidate.messageId ? [`In-Reply-To: ${candidate.messageId}`, `References: ${candidate.messageId}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(replyText, 'utf8').toString('base64'),
  ].join('\r\n');

  return gmail('/messages/send', SEND, {
    method: 'POST',
    body: JSON.stringify({ raw: b64(mime), threadId: candidate.threadId }),
  });
}

async function tellHim(lines, notify) {
  if (lines.length === 0) return;
  if (!notify) {
    console.log('slack notifications are off for this agent, so nothing was sent.');
    return;
  }
  const text = [
    `:envelope: *${lines.length === 1 ? 'A mail was' : `${lines.length} mails were`} answered for you*`,
    '',
    ...lines,
  ].join('\n');
  const sent = await postAsBot('mail', text);
  if (!sent.ok) console.error(`could not tell him in Slack: ${sent.reason}`);
}

async function main() {
  const started = Date.now();
  const log = startLog();

  /*
   * The switch on the screen decides whether this runs. A job that reads only
   * its own environment is a job whose OFF button does nothing.
   */
  const state = await agentState(sql, 'mail-answerer');
  const gate = mayAct(state, { dry: DRY, force: process.env.FORCE === '1' });
  if (!gate.act && !DRY) {
    console.log(`not answering anything: ${gate.why}.`);
    await recordRun(sql, 'mail-answerer', {
      dry: DRY,
      output: log.text(),
      summary: { skipped: gate.why },
      startedAt: new Date(started),
    });
    await sql.end();
    process.exit(0);
  }
  if (!DRY) await markRan(sql, 'mail-answerer');
  /*
   * The brief and the playbook are both his, and both are standing
   * instruction: the brief is the correction, the playbook is how the job is
   * done. They go in together, playbook first, because the corrections should
   * read as amendments to it.
   */
  const written = [
    state.playbook ? `HOW THIS JOB IS DONE\n${state.playbook}` : '',
    state.brief ? `WHAT YOU HAVE TOLD IT\n${state.brief}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  if (written && !process.env.ANSWER_INSTRUCTIONS) {
    INSTRUCTIONS = written;
    console.log(
      `using what you wrote it (${written.length} chars` +
        `${state.playbook ? `, playbook ${state.playbook.length}` : ''}).`,
    );
  } else if (!written) {
    console.log('nothing written for it yet — the built-in rules alone decide.');
  }

  const [learned] = await sql`
    select profile, threads_read from agent_learning where agent_name = 'mail-answerer'
  `.catch(() => []);
  if (learned?.profile) {
    STYLE = learned.profile;
    console.log(`writing in your voice, learned from ${learned.threads_read} of your replies.`);
  } else {
    console.log('not trained on your mail yet — drafts will be correct but generic.');
  }

  await sql`
    create table if not exists mail_answers (
      thread_id  text primary key,
      subject    text,
      to_email   text,
      reply      text,
      answered_at timestamptz not null default now()
    )
  `.catch(() => {});
  // Two outcomes share this table: what it answered, and what it only showed
  // him. Both must be remembered, or the next run does it again.
  await sql`
    alter table mail_answers add column if not exists outcome text not null default 'answered'
  `.catch(() => {});

  const answeredLabel = await labelId(ANSWERED_LABEL);
  const filedLabel = await labelId(FILED_LABEL);

  const { messages } = await gmail(
    `/messages?maxResults=${MAX}&q=${encodeURIComponent('in:inbox -from:me')}`,
  );
  const refs = messages ?? [];
  console.log(`${refs.length} in the inbox${DRY ? ' (dry run)' : ''}`);

  const told = [];
  let answered = 0;
  let filedOnly = 0;
  let declined = 0;

  for (const ref of refs) {
    const message = await gmail(`/messages/${ref.id}?format=full`);
    const hs = message.payload?.headers ?? [];
    const from = header(hs, 'from') ?? '';
    const fromEmail = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
    const subject = header(hs, 'subject') ?? '(no subject)';

    const [already] = await sql`select thread_id from mail_answers where thread_id = ${message.threadId}`;
    if (already) continue;

    const thread = await gmail(`/threads/${message.threadId}?format=full`);
    const messages_ = (thread.messages ?? []).map((m) => ({
      fromMe: (header(m.payload?.headers ?? [], 'from') ?? '').includes(MAILBOX),
      text: plainText(m.payload).join('\n').slice(0, 6000) || m.snippet || '',
    }));

    const [known] = await sql`
      select known_company from mail_threads where thread_id = ${message.threadId}
    `;

    const candidate = {
      subject,
      snippet: message.snippet ?? '',
      fromEmail,
      fromName: (/^(.*)</.exec(from)?.[1] ?? from).trim().replace(/^"|"$/g, ''),
      messages: messages_,
      knownCompany: known?.known_company ?? null,
      threadId: message.threadId,
      messageId: header(hs, 'message-id'),
    };

    const triaged = triage(candidate);

    /*
     * Not everything that arrives is a question. Where the rules cleared it of
     * anything sensitive but it is not something to answer, it may still be
     * worth showing him — one line in Slack, out of the inbox, filed. That is
     * decided below, by the model, and only for the cases mayFile allows.
     */
    const filable = mayFile(triaged);
    if (!triaged.answerable && !filable.consider) {
      declined += 1;
      console.log(`  LEFT FOR YOU: ${subject}`);
      console.log(`      from ${from}`);
      console.log(`      because: ${triaged.reason}`);
      continue;
    }

    const d = await draft(candidate).catch((e) => ({ shouldReply: false, reasoning: e.message, reply: '', confidence: 'low' }));
    const verdict = maySend(triaged, d);

    if (!verdict.send) {
      /*
       * The file-only path. It sends nothing, so it is judged less harshly
       * than a reply — but it still takes something out of his inbox, so it
       * needs the model to say plainly that nothing is being asked, and it
       * never applies to mail the rules held back.
       */
      const justInformation = filable.consider && d.informational === true && d.confidence !== 'low';
      if (!justInformation) {
        declined += 1;
        console.log(`  LEFT FOR YOU: ${subject}`);
        console.log(`      from ${from}`);
        console.log(`      because: ${verdict.why}`);
        continue;
      }

      const line = (d.summary ?? '').trim() || (message.snippet ?? '').slice(0, 200);
      console.log(`  ${DRY ? 'WOULD FILE, NO REPLY' : 'FILED, NO REPLY'}: ${subject}`);
      console.log(`      from ${from}`);
      console.log(`      what it says: ${line}`);
      console.log('      nothing is being asked of you, so it would not answer');
      if (DRY) continue;

      if (filedLabel) {
        await gmail(`/messages/${ref.id}/modify`, MODIFY, {
          method: 'POST',
          body: JSON.stringify({ addLabelIds: [filedLabel], removeLabelIds: ['INBOX'] }),
        }).catch((e) => console.log(`      could not file it: ${e.message}`));
      }
      await sql`
        insert into mail_answers (thread_id, subject, to_email, reply, outcome)
        values (${message.threadId}, ${subject}, ${fromEmail}, ${line}, 'filed')
        on conflict (thread_id) do nothing
      `;

      /*
       * Filed, and deliberately not reported. He asked for a message about
       * what was answered and nothing else — what needed no reply is in
       * Claude/Filed if he wants it, and one more line here is one more thing
       * to skim past on the way to the message that mattered.
       */
      filedOnly += 1;
      continue;
    }

    const theyWrote = (candidate.messages.at(-1)?.text ?? message.snippet ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    console.log(`  ${DRY ? 'WOULD ANSWER' : 'ANSWERED'}: ${subject}`);
    console.log(`      from ${from}`);
    console.log(`      they wrote: ${theyWrote.slice(0, 400)}`);
    console.log(`      because: ${triaged.reason}`);
    // The whole reply, never truncated: deciding whether to trust this agent
    // means reading what it would actually send, not the first line of it.
    console.log(`      the reply:\n${d.reply.split('\n').map((l) => `        ${l}`).join('\n')}`);

    if (DRY) continue;

    await send(candidate, d.reply);
    await sql`
      insert into mail_answers (thread_id, subject, to_email, reply, outcome)
      values (${message.threadId}, ${subject}, ${fromEmail}, ${d.reply}, 'answered')
      on conflict (thread_id) do nothing
    `;

    if (answeredLabel) {
      await gmail(`/messages/${ref.id}/modify`, MODIFY, {
        method: 'POST',
        body: JSON.stringify({ addLabelIds: [answeredLabel], removeLabelIds: ['INBOX'] }),
      }).catch((e) => console.log(`      could not file it: ${e.message}`));
    }

    answered += 1;
    told.push(
      `*${subject}*\n> from ${from}\n> _they said:_ ${(candidate.messages.at(-1)?.text ?? '').replace(/\n+/g, ' ').slice(0, 200)}\n> _I replied:_ ${d.reply.replace(/\n+/g, ' ').slice(0, 300)}`,
    );
  }

  await tellHim(told, state.notify);

  console.log(
    `${answered} answered, ${filedOnly} filed without a reply, ${declined} left for you, ` +
      `in ${Math.round((Date.now() - started) / 1000)}s.`,
  );

  await recordRun(sql, 'mail-answerer', {
    dry: DRY,
    output: log.text(),
    summary: { read: refs.length, answered, filed: filedOnly, left: declined },
    startedAt: new Date(started),
  });

  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
