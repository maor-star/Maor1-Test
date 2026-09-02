import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { agents, db } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Figure } from '@/components/hud/figure';
import { Num } from '@/components/num';
import { CopilotChat } from '@/components/copilot/chat';
import { DecisionLog } from '@/components/copilot/decisions';
import { listThreads, threadMessages } from '@/lib/copilot/service';
import { decisionCounts, lastReviewAt, recentDecisions } from '@/lib/copilot/autopilot';
import { loadProviderKeys, providerStatus } from '@/lib/copilot/provider';
import { AUTONOMY_LABEL } from '@/lib/agents/types';
import { fmtDateTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * The Copilot — the one screen where he talks to the model about the company
 * and reads what the autopilot decided overnight.
 *
 * Two halves. The chat answers from the cockpit's own tools and can act on
 * anything reversible inside it. The decision log is the autopilot agent's
 * daily review: what it saw, what it decided, what it did or wants to do. The
 * agent's level and dials — on the agents screen — are what decide whether a
 * decision here is done or only proposed.
 */
export default async function CopilotPage({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  await requireUser();
  const sp = await searchParams;

  const [threads, decisions, counts, reviewedAt, [autopilot]] = await Promise.all([
    listThreads(),
    recentDecisions(40),
    decisionCounts(),
    lastReviewAt(),
    db.select().from(agents).where(eq(agents.name, 'autopilot')).limit(1),
  ]);
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
          <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
            {providers.auto ? `ANSWERING WITH ${providers.auto === 'gemini' ? 'GEMINI' : 'CLAUDE'}` : 'NO MODEL CONNECTED'}
            {' · '}
            <Link href="/agents?q=autopilot" className="text-accent-700 hover:text-accent">
              AUTOPILOT {autopilot?.enabled ? 'ON' : 'OFF'} · LEVEL {autopilot?.autonomyLevel ?? 1}
            </Link>
          </span>
        }
      />

      <HudCard>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <Figure label="WAITING FOR YOU" value={counts.proposed} big tone={counts.proposed > 0 ? 'warn' : undefined} />
          <Figure label="CARRIED OUT" value={counts.executed} />
          <Figure label="DECISIONS TODAY" value={counts.today} />
          <div className="min-w-0">
            <p className="hud-label text-[9px]">LAST REVIEW</p>
            <p className="mt-1 font-cond text-[20px] leading-none text-neutral-800">
              {reviewedAt ? <Num>{fmtDateTime(reviewedAt)}</Num> : 'NEVER'}
            </p>
          </div>
        </div>
        <p className="border-t border-divider pt-3 font-semi text-[10px] tracking-[0.12em] text-neutral-500">
          THE AUTOPILOT IS AT LEVEL {autopilot?.autonomyLevel ?? 1} — {AUTONOMY_LABEL[autopilot?.autonomyLevel ?? 1]}.
          IT CAN NEVER SEND, SIGN, PAY OR TOUCH ANYTHING OUTSIDE THE COCKPIT. WHAT IT MAY DO ON ITS OWN IS SET ON ITS DIALS.
        </p>
      </HudCard>

      <div className="grid gap-5 xl:grid-cols-[1fr_minmax(0,1.2fr)]">
        <HudCard className="gap-0 p-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
            <HudCardHeader
              title={current ? current.title : 'Talk to it'}
              index="X01"
              action={
                <span className="flex flex-wrap items-center gap-3 font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                  <Link href="/copilot?thread=new" className="text-accent-700 hover:text-accent">NEW</Link>
                  {threads.slice(0, 6).filter((t) => t.id !== threadId).map((t) => (
                    <Link key={t.id} href={`/copilot?thread=${t.id}`} className="max-w-[10rem] truncate hover:text-accent" title={t.title}>
                      {t.title}
                    </Link>
                  ))}
                </span>
              }
            />
          </div>
          <div className="border-t border-divider">
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
                <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                  <Num>{decisions.length}</Num> MOST RECENT
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
