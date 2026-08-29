/**
 * Reads Slack and email for answers to open delegations.
 *
 *   DATABASE_URL=... SLACK_BOT_TOKEN=... npx tsx scripts/check-replies.ts
 *
 * Meant to run on a timer beside the ClickUp sync. Without a Slack token or a
 * Google service account it exits saying so rather than reporting a clean zero.
 */
import { checkForReplies } from '../lib/delegation/replies';

async function main() {
  const result = await checkForReplies();

  if (result.unavailable) {
    console.error(result.unavailable);
    process.exit(1);
  }

  console.log(`Checked ${result.checked} open delegations, found ${result.found} answered.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
