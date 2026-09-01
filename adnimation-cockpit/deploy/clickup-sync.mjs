#!/usr/bin/env node
/**
 * ClickUp → cockpit mirror, as a standalone job on the server.
 *
 *   DATABASE_URL=... CLICKUP_API_TOKEN=... CLICKUP_TEAM_ID=... node clickup-sync.mjs
 *
 * The app itself carries this logic in lib/sync/clickup-mirror.ts, but the
 * deployed artefact is a compiled Next standalone bundle with no importable
 * modules, and Inngest Cloud is not wired up. So the same rules live here as a
 * plain script a systemd timer can run. The rules — and they must stay in step
 * with the TypeScript:
 *
 *  - the mirror shows OPEN work; a task ClickUp has closed is marked done and
 *    kept for thirty days, so one closed by mistake can be reopened;
 *  - a task tagged with everyone on TASK_MIRROR_SKIP_PAIR, and not with him,
 *    is theirs and is not mirrored at all;
 *  - the fields he has taken over on a task (its pinned_fields) are his, and
 *    are not overwritten from ClickUp;
 *  - the department is the ClickUp list the task sits in, unless he has said
 *    otherwise;
 *  - it never writes to ClickUp. The one write the cockpit makes goes through
 *    the app, which puts it in ClickUp first.
 */
import postgres from 'postgres';
import { shouldMirror } from './mirror-skip.mjs';

const TOKEN = process.env.CLICKUP_API_TOKEN;
const TEAM = process.env.CLICKUP_TEAM_ID;
const DB = process.env.DATABASE_URL;

if (!TOKEN || !TEAM || !DB) {
  console.error('CLICKUP_API_TOKEN, CLICKUP_TEAM_ID and DATABASE_URL are all required.');
  process.exit(1);
}

/** Mirrors lib/sync/departments.ts. */
const LIST_DEPTS = [
  ['901817617754', 'Core Publishers', 'CORE'],
  ['901817617598', 'Video', 'VID'],
  ['901817617759', 'Trading', 'TRADING'],
  ['901817617772', 'Seat Lease', 'SEAT'],
  ['901817703208', 'Bidder', 'BID'],
  ['901817617786', 'General', 'GENERAL'],
  ['901817957808', 'HR', 'HR'],
  ['901819118715', 'Demand', 'DEMAND'],
  ['901819118752', 'Marketing', 'MKT'],
  ['901819118774', 'Finance', 'FIN'],
  ['901819118787', 'Development', 'DEV'],
];

const deptForList = (id, name) => {
  const byId = LIST_DEPTS.find((l) => l[0] === id);
  if (byId) return byId[2];
  const wanted = (name ?? '').trim().toLowerCase();
  return LIST_DEPTS.find((l) => l[1].toLowerCase() === wanted)?.[2] ?? null;
};

/** Mirrors lib/sync/clickup-map.ts. */
const mapStatus = (status) => {
  const s = String(status ?? '').toLowerCase().trim();
  if (['complete', 'closed', 'done'].includes(s)) return 'done';
  if (['in progress', 'in-progress', 'doing', 'active'].includes(s)) return 'in_progress';
  if (['blocked', 'on hold', 'waiting'].includes(s)) return 'blocked';
  if (['open', 'to do', 'todo', 'backlog', 'new'].includes(s)) return 'open';
  return s.replace(/\s+/g, '_') || 'open';
};

const CLICKUP_TO_PRIORITY = { 1: 'P0', 2: 'P1', 3: 'P2', 4: 'P3' };
const PRIORITY_FACTOR = { P0: 1, P1: 0.7, P2: 0.35, P3: 0.1 };

const toMs = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const msToDate = (ms) => (ms === null ? null : new Date(ms).toISOString().slice(0, 10));

/** Mirrors lib/scoring/heat-score.ts for the terms a mirrored task can supply. */
function heat(priority, dueDate, hasOwner, now) {
  const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
  let overdue = 0;
  if (dueDate) {
    const days = Math.floor((now - new Date(`${dueDate}T00:00:00Z`)) / 86_400_000);
    overdue = clamp01(Math.max(0, days) / 14);
  }
  const soleOwner = hasOwner ? 0 : 1;
  return Math.round(40 * PRIORITY_FACTOR[priority] + 25 * overdue + 5 * soleOwner);
}

async function fetchAll() {
  const out = [];
  for (let page = 0; page < 60; page += 1) {
    const url = new URL(`https://api.clickup.com/api/v2/team/${TEAM}/task`);
    url.searchParams.set('subtasks', 'true');
    // Closed tasks are requested precisely so the mirror can drop them.
    url.searchParams.set('include_closed', 'true');
    url.searchParams.set('page', String(page));

    const res = await fetch(url, { headers: { Authorization: TOKEN } });
    if (!res.ok) throw new Error(`clickup list failed: http_${res.status}`);
    const body = await res.json();
    const tasks = body.tasks ?? [];
    out.push(...tasks);
    if (tasks.length === 0 || body.last_page) break;
  }
  return out;
}

async function main() {
  const sql = postgres(DB, { max: 4, onnotice: () => {} });
  const now = new Date();

  try {
    const raw = await fetchAll();
    console.log(`fetched ${raw.length} tasks from ClickUp`);

    const people = await sql`select id, lower(email) as email from people where email is not null`;
    const personByEmail = new Map(people.map((p) => [p.email, p.id]));
    const depts = await sql`select id, code from departments`;
    const deptByCode = new Map(depts.map((d) => [d.code, d.id]));

    let upserted = 0;
    const finished = [];
    const notHis = [];

    for (const t of raw) {
      /*
       * The pair's own work never enters the mirror — only tasks where BOTH
       * Mor and Tomer are tagged and he is not. One of them alone is usually
       * work he wrote and handed over, which is exactly what he wants to see.
       * See mirror-skip.mjs.
       */
      const assignees = (t.assignees ?? []).map((a) => a.email).filter(Boolean);
      if (!shouldMirror(assignees)) {
        notHis.push(String(t.id));
        continue;
      }

      const status = mapStatus(t.status?.status);
      const closed = toMs(t.date_closed) !== null || status === 'done';
      if (closed) {
        finished.push(String(t.id));
        continue;
      }

      const priority = CLICKUP_TO_PRIORITY[toMs(t.priority?.id)] ?? 'P2';
      const dueDate = msToDate(toMs(t.due_date));
      const email = (t.assignees ?? []).map((a) => a.email).filter(Boolean)[0] ?? null;
      const ownerPersonId = email ? (personByEmail.get(email.toLowerCase()) ?? null) : null;
      const deptCode = deptForList(t.list?.id ?? null, t.list?.name ?? null);
      const deptId = deptCode ? (deptByCode.get(deptCode) ?? null) : null;
      const tags = (t.tags ?? []).map((x) => x.name);

      await sql`
        insert into tasks (layer, clickup_id, clickup_url, title, description, status, priority,
                           due_date, start_date, tags, owner_person_id, dept_id, heat_score,
                           source, updated_at, last_synced_at)
        values ('company', ${String(t.id)}, ${t.url ?? `https://app.clickup.com/t/${t.id}`},
                ${t.name ?? 'Untitled'}, ${t.description ?? null}, ${status}, ${priority},
                ${dueDate}, ${msToDate(toMs(t.start_date))}, ${tags}, ${ownerPersonId}, ${deptId},
                ${heat(priority, dueDate, ownerPersonId !== null, now)}, 'manual', ${now}, ${now})
        on conflict (clickup_id) do update set
          clickup_url = excluded.clickup_url, title = excluded.title,
          description = excluded.description, status = excluded.status,
          priority = excluded.priority, due_date = excluded.due_date,
          start_date = excluded.start_date,
          /*
           * What he has taken over stays his.
           *
           * A department he filed the task under, an owner he assigned here or
           * a tag he added exists nowhere in ClickUp — so writing ClickUp's
           * version back over his would clear it at the next poll, five
           * minutes after he set it, with nothing on screen to say why. The
           * row names which of its fields the cockpit owns.
           */
          tags = case when 'tags' = any(tasks.pinned_fields)
                      then tasks.tags else excluded.tags end,
          owner_person_id = case when 'ownerPersonId' = any(tasks.pinned_fields)
                                 then tasks.owner_person_id else excluded.owner_person_id end,
          dept_id = case when 'deptId' = any(tasks.pinned_fields)
                         then tasks.dept_id else excluded.dept_id end,
          heat_score = excluded.heat_score, updated_at = excluded.updated_at,
          last_synced_at = excluded.last_synced_at
      `;
      upserted += 1;
    }

    /*
     * A task ClickUp has closed is marked done here and kept, not deleted.
     *
     * Deleting made the list right and reopening impossible: a task closed by
     * mistake was simply gone from the cockpit, with no row to put back. The
     * default view hides done, so keeping it costs nothing on screen.
     */
    let removed = 0;
    if (finished.length > 0) {
      const closed = await sql`
        update tasks set status = 'done', updated_at = ${now}, last_synced_at = ${now}
         where layer = 'company' and clickup_id = any(${finished}) and status <> 'done'
        returning id
      `;
      removed = closed.length;
    }

    // Anything already here that is now somebody else's — the list changed, or
    // a task was reassigned. Dropped rather than marked done: it is not
    // finished work, it was never his.
    let dropped = 0;
    if (notHis.length > 0) {
      const gone = await sql`
        delete from tasks
         where layer = 'company' and clickup_id = any(${notHis})
        returning id
      `;
      dropped = gone.length;
    }

    // Long-finished tasks nobody is going to reopen. Thirty days, because a
    // task closed by mistake is noticed in a day or two, not a month.
    const swept = await sql`
      delete from tasks
       where layer = 'company' and clickup_id is not null and status = 'done'
         and updated_at < now() - interval '30 days'
      returning id
    `;

    await sql`
      insert into integration_health (system, last_success_at, last_attempt_at, consecutive_errors)
      values ('clickup', ${now}, ${now}, 0)
      on conflict (system) do update set
        last_success_at = excluded.last_success_at,
        last_attempt_at = excluded.last_attempt_at,
        consecutive_errors = 0, last_error = null
    `;

    const [{ count }] = await sql`select count(*)::int as count from tasks where layer = 'company'`;
    console.log(
      `open mirrored: ${upserted}; theirs: ${notHis.length} (${dropped} removed); ` +
        `closed: ${removed}; long-done cleared: ${swept.length}; ` +
        `mirror now holds ${count} company tasks`,
    );
  } catch (e) {
    await sql`
      insert into integration_health (system, last_attempt_at, consecutive_errors, last_error)
      values ('clickup', ${now}, 1, ${String(e.message ?? e)})
      on conflict (system) do update set
        last_attempt_at = excluded.last_attempt_at,
        consecutive_errors = integration_health.consecutive_errors + 1,
        last_error = excluded.last_error
    `;
    console.error('sync failed:', e.message ?? e);
    await sql.end();
    process.exit(1);
  }

  await sql.end();
  process.exit(0);
}

main();
