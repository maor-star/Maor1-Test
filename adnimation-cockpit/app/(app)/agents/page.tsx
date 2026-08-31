import { requireUser } from '@/lib/auth/session';
import { agentsOverview, listAgents } from '@/lib/agents/module';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Num } from '@/components/num';
import { AgentCard } from '@/components/agents/agent-card';
import { AgentControls } from '@/components/agents/agent-controls';
import { AGENT_BOT, botStatuses } from '@/lib/agents/slack-bots';

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
export default async function AgentsPage() {
  await requireUser();
  const [agents, overview] = await Promise.all([listAgents(), agentsOverview()]);
  const bots = botStatuses();

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="AGENTS / 14"
        title="Agents"
        action={
          <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
            EVERY AGENT STARTS AT LEVEL 1 — IT PROPOSES, YOU DECIDE
          </span>
        }
      />

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
          <Figure label="AGENTS" value={overview.total} big />
          <Figure label="SWITCHED ON" value={overview.enabled} big />
          <Figure
            label="CAN DO SOMETHING IRREVERSIBLE"
            value={overview.irreversible}
            tone={overview.irreversible > 0 ? 'warn' : undefined}
          />
          <div>
            <span className="hud-label block text-[9px]">CLAUDE</span>
            <span
              className={`font-cond text-[22px] leading-none ${
                overview.claudeConnected ? 'text-neutral-900' : 'text-sev-warning'
              }`}
            >
              {overview.claudeConnected ? 'CONNECTED' : 'NOT SET'}
            </span>
          </div>
        </div>

        <p className="border-t border-divider pt-3 font-semi text-[10px] tracking-[0.12em] text-neutral-500">
          LEVEL 4 IS SILENT EXECUTION AND IS REFUSED TO ANY AGENT THAT CAN SIGN, SEND OR COMMIT ·
          PROMOTION NEEDS <Num>20</Num> RUNS · EVERY RUN IS LOGGED AND THE LOG CANNOT BE REWRITTEN
        </p>
      </HudCard>

      <HudCard className="gap-0 p-0">
        <div className="p-[18px] pb-3">
          <HudCardHeader
            title="Who speaks in Slack"
            index="G02"
            action={
              <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                <Num>{bots.filter((b) => b.hasOwnToken).length}</Num> OF{' '}
                <Num>{bots.length}</Num> HAVE THEIR OWN APP
              </span>
            }
          />
        </div>

        <ul className="border-t border-divider">
          {bots.map((bot) => (
            <li
              key={bot.key}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-divider px-[18px] py-3 last:border-b-0"
            >
              <span className="font-cond text-[16px] leading-none text-neutral-900">
                {bot.username}
              </span>
              <span className="font-semi text-[11px] text-neutral-500">{bot.purpose}</span>
              <span className="ms-auto font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                <Num>{Object.values(AGENT_BOT).filter((k) => k === bot.key).length}</Num> AGENTS
              </span>
              {/*
                Three postures, named rather than blurred: its own app, another
                app's token under this name, or nothing configured. Only the
                first is genuinely a separate bot he can mute on its own.
              */}
              <span
                className={`font-semi text-[10px] tracking-[0.12em] ${
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
              <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                <Num>{agents.length}</Num> DEFINED
              </span>
            }
          />
        </div>

        {agents.length === 0 ? (
          <p className="border-t border-divider px-[18px] py-4 font-semi text-[12px] text-neutral-500">
            None yet. “Install the built-in agents” adds them all at level 1, with only the
            contract reader switched on — the rest wait until you have seen what they would do.
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

function Figure({
  label,
  value,
  big = false,
  tone,
}: {
  label: string;
  value: number;
  big?: boolean;
  tone?: 'warn';
}) {
  return (
    <div>
      <span className="hud-label block text-[9px]">{label}</span>
      <span
        className={`font-cond leading-none ${big ? 'text-[30px]' : 'text-[22px]'} ${
          tone === 'warn' ? 'text-sev-warning' : 'text-neutral-900'
        }`}
      >
        <Num>{value}</Num>
      </span>
    </div>
  );
}
