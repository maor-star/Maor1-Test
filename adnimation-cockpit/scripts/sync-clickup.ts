/**
 * One-off full ClickUp sync. Pulls every task the workspace has, keeps the open
 * ones, and drops any finished task the mirror is still carrying.
 *
 *   DATABASE_URL=... CLICKUP_API_TOKEN=... CLICKUP_TEAM_ID=... npx tsx scripts/sync-clickup.ts
 *
 * The five-minute Inngest poll does the same thing incrementally; this exists
 * for the first run, and for after a token change, where there is no "since"
 * to poll from.
 */
import { createClickUpAdapter } from '../lib/integrations/clickup';
import { purgeFinishedMirror, syncClickUpTasks } from '../lib/sync/clickup-mirror';

async function main() {
  if (process.env.USE_FAKE_INTEGRATIONS === '1') {
    console.error('USE_FAKE_INTEGRATIONS=1 — refusing to run: this would sync from the fake.');
    process.exit(1);
  }
  if (!process.env.CLICKUP_API_TOKEN || !process.env.CLICKUP_TEAM_ID) {
    console.error('CLICKUP_API_TOKEN and CLICKUP_TEAM_ID must both be set.');
    process.exit(1);
  }

  const adapter = createClickUpAdapter();
  // Since the beginning: a full pull, not a delta.
  const result = await syncClickUpTasks(adapter, 0);

  if (result.error) {
    console.error(`Sync failed: ${result.error}`);
    process.exit(1);
  }

  // Belt and braces: clears anything that finished before this sync existed.
  const alsoPurged = await purgeFinishedMirror();

  console.log(
    `Fetched ${result.fetched}, mirrored ${result.upserted} open, removed ${
      result.removed + alsoPurged
    } finished.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
