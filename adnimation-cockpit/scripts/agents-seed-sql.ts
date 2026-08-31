/**
 * Print the built-in agent definitions as idempotent SQL.
 *
 *   npx tsx scripts/agents-seed-sql.ts > /tmp/agents.sql
 *
 * The app installs missing agents itself when the agents page is opened. This
 * is the same list for the times that is not soon enough — a server that has
 * agents in its code and not in its database, where waiting for a page load
 * means an agent nobody can find.
 *
 * Every statement inserts only what is absent. An agent he switched off, a
 * level he set or a brief he wrote is never touched.
 */
import { SEED_AGENTS } from '../lib/agents/definitions';
import { isIrreversible } from '../lib/agents/types';

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const j = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;

for (const a of SEED_AGENTS) {
  console.log(
    `insert into agents (name, description, trigger_type, trigger_config, conditions, actions, ` +
      `autonomy_level, has_irreversible_action, max_runs_per_hour, enabled)\n` +
      `select ${q(a.name)}, ${a.description ? q(a.description) : 'null'}, ${q(a.triggerType)}, ` +
      `${j(a.triggerConfig)}, ${j(a.conditions)}, ${j(a.actions)}, 1, ` +
      `${a.actions.some((x) => isIrreversible(x.type))}, ${a.maxRunsPerHour}, ${a.enabled}\n` +
      `where not exists (select 1 from agents where name = ${q(a.name)});`,
  );
}
