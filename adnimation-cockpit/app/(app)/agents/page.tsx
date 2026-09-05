import { requireUser } from '@/lib/auth/session';
import { agentsOverview, listAgents, seedAgents } from '@/lib/agents/module';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Figure } from '@/components/hud/figure';
import { SearchBox } from '@/components/hud/search-box';
import { Num } from '@/components/num';
import { filterByQuery } from '@/lib/search';
import { AgentCard } from '@/components/agents/agent-card';
import { AgentControls } from '@/components/agents/agent-controls';
import Link from 'next/link';
import { AGENT_BOT, botFor, botStatuses } from '@/lib/agents/slack-bots';
import { isIrreversible } from '@/lib/agents/types';

export const dynamic = 'force-dynamic';

/**
 * Spec §6א — the agents that do work on his behalf.
 *
 * The page is arranged around what can go wrong rather than what the agents
 * do: the kill switch and the count of agents holding an irreversible action
 * are the first things on it, and every agent shows the level it is at and
 * what that level means. An agent screen that reads like a feature list is a
 * screen that makes it easy to switch something on without noticing what it
 * can now do.
 */
const SHOWS = ['all', 'on', 'off', 'irreversible'] as const;
type Show = (typeof SHOWS)[number];

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; q?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const show: Show = SHOWS.includes(sp.show as Show) ? (sp.show as Show) : 'all';
  const q = sp.q ?? '';

  /*
   * Install whatever built-in agents are not here yet, on the way in.
   *
   * It only ever adds: an agent he switched off stays off, a level he set
   * stays set, a brief he wrote stays written. Without this, an agent that
   * exists in the code is invisible until he happens to press a button —
   * which is exactly what happened to the mail answerer, and the symptom was
   * him asking where it was.
   */
  const installed = await seedAgents(user.email);
  const [allAgents, overview] = await Promise.all([listAgents(), agentsOverview()]);
  const bots = botStatuses();

  /*
   * The strip at the top is the way in, not a read-out: clicking a number
   * shows what it counted. The filter and the search compose, and both live in
   * the URL, so a narrowed screen survives a reload and can be sent to someone.
   */
  const byShow = allAgents.filter((a) => {
    if (show === 'on') return a.enabled;
    if (show === 'off') return !a.enabled;
    if (show === 'irreversible') return a.actions.some((x) => isIrreversible(x.type));
    return true;
  });
  const agents = filterByQuery(byShow, q, (a) => [
    a.name,
    a.description,
    a.rationale,
    a.instructions,
    a.triggerType,
    botFor(a.name).username,
    ...a.actions.map((x) => x.type),
    ...a.conditions.map((c) => c.name),
    a.enabled ? 'on enabled' : 'off disabled',
  ]);

  const link = (patch: { show?: Show; q?: string }) => {
    const params = new URLSearchParams();
    const merged = { show, q, ...patch };
    if (merged.show && merged.show !== 'all') params.set('show', merged.show);
    if (merged.q) params.set('q', merged.q);
    const query = params.toString();
    return query ? `/agents?${query}` : '/agents';
  };

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="AGENTS / 11"
        title="Agents"
        action={
          <span className="font-semi text-[11.5px] tracking-[0.14em] text-neutral-500">
            Every agent starts at level 1 — it proposes, you decide
          </span>
        }
      />

      {installed.added.length > 0 ? (
        <div className="border border-line bg-accent/5 px-4 py-3 font-semi text-[12px] tracking-[0.06em] text-neutral-700">
          Added <Num>{installed.added.length}</Num> agents that were not installed yet:{' '}
          {installed.added.join(', ')}. All at level 1 and all switched off.
        </div>
      ) : null}

      {overview.killed ? (
        <div className="border border-sev-critical/40 bg-sev-critical/10 px-4 py-3 font-semi text-[12px] tracking-[0.06em] text-sev-critical">
          THE KILL SWITCH IS ON. No agent will run, at any level, however it is triggered.
        </div>
      ) : null}

      {!overview.claudeConnected ? (
        <div className="border border-sev-warning/40 bg-sev-warning/10 px-4 py-3 font-semi text-[12px] tracking-[0.06em] text-sev-warning">
          Claude is not connected, so the agents that read and draft cannot run —{' '}
          {overview.claudeReason}. Everything else on this page works; those agents will halt with
          that reason recorded rather than doing half a job.
        </div>
      ) : null}

      <HudCard>
        <HudCardHeader title="What is running" index="G01" action={<AgentControls killed={overview.killed} />} />

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <Figure
            label="AGENTS"
            value={overview.total}
            big
            href={link({ show: 'all' })}
            active={show === 'all'}
          />
          <Figure
            label="SWITCHED ON"
            value={overview.enabled}
            big
            href={link({ show: 'on' })}
            active={show === 'on'}
          />
          <Figure
            label="CAN DO SOMETHING IRREVERSIBLE"
            value={overview.irreversible}
            tone={overview.irreversible > 0 ? 'warn' : undefined}
            href={link({ show: 'irreversible' })}
            active={show === 'irreversible'}
          />
          <div>
            <span className="hud-label block text-[11px]">Claude</span>
            <span
              className={`font-cond text-[22px] leading-none ${
                overview.claudeConnected ? 'text-neutral-900' : 'text-sev-warning'
              }`}
            >
              {overview.claudeConnected ? 'CONNECTED' : 'NOT SET'}
            </span>
          </div>
        </div>

        <p className="border-t border-line pt-3 font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
          Level 4 is silent execution and is refused to any agent that can sign, send or commit ·
          promotion needs <Num>20</Num> runs · every run is logged and the log cannot be rewritten
        </p>
      </HudCard>

      <HudCard className="gap-0 p-0">
        <div className="p-[18px] pb-3">
          <HudCardHeader
            title="Who speaks in Slack"
            index="G02"
            action={
              <span className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
                <Num>{bots.filter((b) => b.hasOwnToken).length}</Num> OF{' '}
                <Num>{bots.length}</Num> have their own app
              </span>
            }
          />
        </div>

        <ul className="border-t border-line">
          {bots.map((bot) => (
            <li
              key={bot.key}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-[18px] py-3 last:border-b-0"
            >
              <span className="font-cond text-[16px] leading-none text-neutral-900">
                {bot.username}
              </span>
              <span className="font-semi text-[11px] text-neutral-500">{bot.purpose}</span>
              <span className="ms-auto font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
                <Num>{Object.values(AGENT_BOT).filter((k) => k === bot.key).length}</Num> Agents
              </span>
              {/*
                Three postures, named rather than blurred: its own app, another
                app's token under this name, or nothing configured. Only the
                first is genuinely a separate bot he can mute on its own.
              */}
              <span
                className={`font-semi text-[11.5px] tracking-[0.12em] ${
                  bot.hasOwnToken
                    ? 'text-sev-ok'
                    : bot.postsAs
                      ? 'text-neutral-500'
                      : 'text-sev-warning'
                }`}
              >
                {bot.hasOwnToken
                  ? 'OWN APP'
                  : bot.postsAs
                    ? `VIA ${bot.postsAs.toUpperCase()}`
                    : `NEEDS ${bot.tokenEnv}`}
              </span>
            </li>
          ))}
        </ul>
      </HudCard>

      <HudCard className="gap-0 p-0">
        <div className="p-[18px] pb-3">
          <HudCardHeader
            title="The agents"
            index="G03"
            action={
              <div className="flex flex-wrap items-center gap-3">
                <SearchBox placeholder="Find an agent" />
                <span className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
                  <Num>{agents.length}</Num>
                  {agents.length === allAgents.length ? ' DEFINED' : ` OF ${allAgents.length}`}
                </span>
              </div>
            }
          />
          {show !== 'all' || q ? (
            <p className="mt-2 font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
              SHOWING {show === 'on' ? 'THE ONES THAT ARE ON' : show === 'off' ? 'THE ONES THAT ARE OFF' : show === 'irreversible' ? 'THE ONES THAT CAN DO SOMETHING IRREVERSIBLE' : 'ALL'}
              {q ? ` MATCHING “${q}”` : ''} ·{' '}
              <Link href="/agents" className="text-info underline">
                Show everything
              </Link>
            </p>
          ) : null}
        </div>

        {agents.length === 0 && allAgents.length > 0 ? (
          <p className="border-t border-line px-[18px] py-4 font-semi text-[12px] text-neutral-500">
            Nothing here matches. <Link href="/agents" className="text-info underline">Show everything</Link>.
          </p>
        ) : agents.length === 0 ? (
          <p className="border-t border-line px-[18px] py-4 font-semi text-[12px] text-neutral-500">
            None yet. They install themselves when this page opens — all at level 1 and all
            switched off, so nothing runs until you have seen what it would do.
          </p>
        ) : (
          <ul>
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </ul>
        )}
      </HudCard>
    </div>
  );
}
