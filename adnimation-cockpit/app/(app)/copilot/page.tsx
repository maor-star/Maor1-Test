import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { agents, db } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Figure } from '@/components/hud/figure';
import { Num } from '@/components/num';
import { CopilotChat } from '@/components/copilot/chat';
import { CopilotDesk } from '@/components/copilot/desk';
import { DecisionLog } from '@/components/copilot/decisions';
import { listThreads, threadMessages } from '@/lib/copilot/service';
import { collectDesk } from '@/lib/copilot/desk';
import { storedDrafts, type DeskDraft } from '@/lib/copilot/desk-draft';
import { draftIsCurrent } from '@/lib/copilot/desk-rules';
import { delegatableTeam } from '@/lib/delegation/module';
import { decisionCounts, lastReviewAt, recentDecisions } from '@/lib/copilot/autopilot';
import { loadProviderKeys, providerStatus } from '@/lib/copilot/provider';
import { slackReach, type SlackReach } from '@/lib/copilot/slack-view';
import { AUTONOMY_LABEL } from '@/lib/agents/types';
import { fmtDateTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * The Copilot — his desk.
 *
 * It used to be a chat and a log: two things he had to think of a question for
 * before either was any use. What he actually wanted was the opposite — the
 * screen thinks first, and he answers. So the desk comes first now: everything
 * owed, from every channel it is owed in, each card carrying the reply already
 * written in his voice and a contract already read and judged. What is left is
 * pressing send, doing it, or handing it to someone — and whichever he presses,
 * the follow-up is filed where he will see it again.
 *
 * The chat and the decision log stay underneath, for the questions the desk
 * does not answer and for what the autopilot did overnight.
 */
export default async function CopilotPage({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;

  const [threads, decisions, counts, reviewedAt, [autopilot], slack, desk, drafted, team] = await Promise.all([
    listThreads(),
    recentDecisions(40),
    decisionCounts(),
    lastReviewAt(),
    db.select().from(agents).where(eq(agents.name, 'autopilot')).limit(1),
    // Never let Slack being unreachable — or slow — hold the screen. Three
    // seconds is longer than Slack ever takes and shorter than he waits.
    Promise.race([
      slackReach(),
      new Promise<SlackReach>((resolve) =>
        setTimeout(() => resolve({ asUser: false, channels: null, why: 'Slack did not answer in time.' }), 3000),
      ),
    ]).catch((): SlackReach => ({ asUser: false, channels: null, why: 'Slack did not answer.' })),
    collectDesk().catch(() => ({ items: [], gaps: ['The desk could not be gathered.'] })),
    storedDrafts().catch(() => new Map()),
    delegatableTeam(user.email).catch(() => []),
  ]);

  /*
   * A draft written before their last message answers a conversation that has
   * moved on. It is still shown — his edit of a near-miss beats a blank box —
   * but the card says so, and "prepare answers" counts it as missing.
   */
  const drafts: Record<string, { draft: DeskDraft; stale: boolean }> = {};
  for (const item of desk.items) {
    const stored = drafted.get(item.id);
    if (!stored) continue;
    drafts[item.id] = { draft: stored.draft, stale: !draftIsCurrent(stored.fingerprint, item) };
  }
  await loadProviderKeys();
  const providers = providerStatus();
  const threadId = sp.thread && threads.some((t) => t.id === sp.thread) ? sp.thread : (threads[0]?.id ?? null);
  const messages = threadId ? await threadMessages(threadId) : [];
  const current = threads.find((t) => t.id === threadId);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="COPILOT / 00"
        title="Copilot"
        action={
          <span className="font-semi text-[11.5px] tracking-[0.14em] text-neutral-500">
            {providers.auto ? `ANSWERING WITH ${providers.auto === 'gemini' ? 'GEMINI' : 'CLAUDE'}` : 'NO MODEL CONNECTED'}
            {' · '}
            <Link href="/agents?q=autopilot" className="text-info hover:underline">
              AUTOPILOT {autopilot?.enabled ? 'ON' : 'OFF'} · LEVEL {autopilot?.autonomyLevel ?? 1}
            </Link>
          </span>
        }
      />

      <CopilotDesk
        items={desk.items}
        drafts={drafts}
        team={team.map((p) => ({ id: p.id, label: p.role ? `${p.name} — ${p.role}` : p.name }))}
      />

      {desk.gaps.length > 0 ? (
        <p className="hud-label whitespace-normal text-[11.5px] tracking-[0.1em]">
          {desk.gaps.join(' · ')}
        </p>
      ) : null}

      <HudCard>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <Figure label="WAITING FOR YOU" value={counts.proposed} big tone={counts.proposed > 0 ? 'warn' : undefined} />
          <Figure label="CARRIED OUT" value={counts.executed} />
          <Figure label="DECISIONS TODAY" value={counts.today} />
          <div className="min-w-0">
            <p className="hud-label text-[11px]">Last review</p>
            <p className="mt-1 font-cond text-[20px] leading-none text-neutral-800">
              {reviewedAt ? <Num>{fmtDateTime(reviewedAt)}</Num> : 'NEVER'}
            </p>
          </div>
        </div>
        {/* What it can see of Slack, said out loud: a chat that answers
            "nothing in Slack" because it was never invited anywhere is worse
            than one that says it cannot look. */}
        <p className="border-t border-line pt-3 font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
          SLACK —{' '}
          {slack.channels === null ? (
            <>
              Cannot read it yet. <Link href="/settings" className="text-info hover:underline">Paste a Slack user token on keys</Link>{' '}
              and it reads every channel you see. it always posts as the cockpit, never as you.
            </>
          ) : (
            <>
              READING {slack.asUser ? 'AS YOU' : 'AS THE COCKPIT BOT'} · <Num>{slack.channels}</Num> CHANNEL
              {slack.channels === 1 ? '' : 'S'}
              {slack.asUser ? '' : <> · <Link href="/settings" className="text-info hover:underline">Paste a user token on keys</Link> To read all of it</>}
            </>
          )}
        </p>
        <p className="border-t border-line pt-3 font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
          The autopilot is at level {autopilot?.autonomyLevel ?? 1} — {AUTONOMY_LABEL[autopilot?.autonomyLevel ?? 1]}.
          it can never send, sign, pay or touch anything outside the cockpit. what it may do on its own is set on its dials.
        </p>
      </HudCard>

      <div className="grid gap-5 xl:grid-cols-[1fr_minmax(0,1.2fr)]">
        <HudCard className="gap-0 p-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
            <HudCardHeader
              title={current ? current.title : 'Talk to it'}
              index="X01"
              action={
                <span className="flex flex-wrap items-center gap-3 font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
                  <Link href="/copilot?thread=new" className="text-info hover:underline">New</Link>
                  {threads.slice(0, 6).filter((t) => t.id !== threadId).map((t) => (
                    <Link key={t.id} href={`/copilot?thread=${t.id}`} className="max-w-[10rem] truncate hover:text-accent" title={t.title}>
                      {t.title}
                    </Link>
                  ))}
                </span>
              }
            />
          </div>
          <div className="border-t border-line">
            <CopilotChat
              threadId={sp.thread === 'new' ? null : threadId}
              messages={sp.thread === 'new' ? [] : messages}
              providers={providers}
              currentProvider={current?.provider ?? 'auto'}
            />
          </div>
        </HudCard>

        <HudCard className="gap-0 p-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
            <HudCardHeader
              title="What it decided"
              index="X02"
              action={
                <span className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
                  <Num>{decisions.length}</Num> Most recent
                </span>
              }
            />
          </div>
          <DecisionLog decisions={decisions} canReview={Boolean(providers.auto)} />
        </HudCard>
      </div>
    </div>
  );
}
