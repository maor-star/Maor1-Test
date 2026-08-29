/**
 * Copies the whole HubSpot CRM into the cockpit.
 *
 *   DATABASE_URL=... HUBSPOT_ACCESS_TOKEN=... npx tsx scripts/sync-hubspot.ts
 *
 * The portal holds roughly 63,000 companies and 33,000 contacts, so a first run
 * takes a while — it pages at 100 records a call and upserts in batches of 200.
 * Re-running is cheap and idempotent: every record is keyed on its HubSpot id.
 */
import { createHubSpotAdapter } from '../lib/integrations/hubspot';
import { crmCounts, mirrorHubSpot } from '../lib/sync/hubspot-mirror';

async function main() {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    console.error(
      'HUBSPOT_ACCESS_TOKEN is not set. Create a HubSpot private app with CRM read scopes ' +
        '(crm.objects.companies.read, crm.objects.contacts.read, crm.objects.owners.read) ' +
        'and put its token in the environment.',
    );
    process.exit(1);
  }

  const started = Date.now();
  const result = await mirrorHubSpot(createHubSpotAdapter(), {
    onProgress: ({ companies, contacts }) => {
      if ((companies + contacts) % 2000 === 0) {
        console.log(`  … ${companies} companies, ${contacts} contacts`);
      }
    },
  });

  const counts = await crmCounts();
  console.log(
    `Copied ${result.companies} companies and ${result.contacts} contacts in ` +
      `${Math.round((Date.now() - started) / 1000)}s. ` +
      `Cockpit now holds ${counts.companies} companies and ${counts.contacts} contacts.`,
  );

  if (result.error) {
    console.error(`Stopped early: ${result.error}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
