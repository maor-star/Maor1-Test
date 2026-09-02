import { NextResponse } from 'next/server';
import { and, eq, isNull, or, sql, isNotNull } from 'drizzle-orm';
import { agents, db } from '@/lib/db';
import { runById } from '@/lib/agents/module';
import { conditions } from '@/lib/agents/checks';

/**
 * The tick: run whichever in-app agents are due.
 *
 * Called by a systemd timer on the box, signed with a key that exists only in
 * the server's .env — never a browser, never a session. An agent is due when it
 * is on, not retired, has a check this runtime knows, and its interval has
 * passed since it last ran. The autopilot has an hour dial instead: it runs
 * once a day, in the hour he set.
 *
 * Every run goes through runById, so the kill switch, the rate limit, the
 * autonomy rules and the run log all apply exactly as they do to a click.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const KNOWN = new Set(Object.keys(conditions));

export async function POST(request: Request) {
  const key = process.env.INTERNAL_JOB_KEY;
  const given = request.headers.get('x-internal-key');
  if (!key || !given || given !== key) return new NextResponse('Not for you', { status: 401 });

  const now = new Date();
  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.enabled, true), isNull(agents.retiredAt), or(isNull(agents.lastRanAt), isNotNull(agents.lastRanAt))));

  const ran: { name: string; outcome: string; detail?: string }[] = [];
  for (const a of rows) {
    const checks = ((a.conditions ?? []) as { check: string }[]).map((c) => c.check);
    if (!checks.every((c) => KNOWN.has(c) || c === 'claude_configured')) continue; // a job agent, not ours

    const everyMinutes = a.runEveryMinutes ?? (a.name === 'autopilot' ? 24 * 60 : 6 * 60);
    const since = a.lastRanAt ? (now.getTime() - a.lastRanAt.getTime()) / 60_000 : Infinity;
    if (since < everyMinutes) continue;

    if (a.name === 'autopilot') {
      // Once a day, in the hour he set (Israel time).
      const hour = Number(((a.settings ?? {}) as { hour?: unknown }).hour ?? 6);
      const ilHour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Jerusalem' }).format(now));
      if (ilHour !== hour) continue;
    }

    await db.update(agents).set({ lastRanAt: now, runCount: sql`${agents.runCount} + 1` }).where(eq(agents.id, a.id));
    const report = await runById(a.id, { triggeredBy: 'schedule' });
    ran.push({
      name: a.name,
      outcome: report.outcome,
      detail: report.haltReason ?? report.actions.map((x) => x.detail).join(' ').slice(0, 300),
    });
  }

  return NextResponse.json({ at: now.toISOString(), ran });
}
