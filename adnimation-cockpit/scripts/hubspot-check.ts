/**
 * Says whether the HubSpot credential works, and what it can reach.
 *
 *   npx tsx scripts/hubspot-check.ts
 *
 * Prints the portal, the granted scopes, and one page of each object type. It
 * never prints the credential — the point is to answer "will the sync work"
 * without putting a token into a log.
 */
import { createHubSpotAdapter } from '../lib/integrations/hubspot';

async function main() {
  const adapter = createHubSpotAdapter();

  if (adapter.name !== 'hubspot' || 'seed' in adapter) {
    console.error('No HubSpot credential is set — the fake adapter is in use.');
    process.exit(1);
  }

  const withIdentity = adapter as typeof adapter & {
    identity?: () => Promise<{ portalId: string | null; scopes: string[] }>;
  };

  if (withIdentity.identity) {
    const id = await withIdentity.identity();
    console.log(`portal: ${id.portalId ?? 'unknown'}`);
    console.log(`scopes: ${id.scopes.length > 0 ? id.scopes.join(' ') : 'not reported'}`);
  }

  for (const [label, read] of [
    ['companies', () => adapter.listCompanies(null, 1)],
    ['contacts', () => adapter.listContacts(null, 1)],
  ] as const) {
    try {
      const page = await read();
      console.log(`${label}: ok, first row "${page.rows[0]?.hubspotId ?? 'none'}"`);
    } catch (e) {
      console.log(`${label}: FAILED — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    const owners = await adapter.listOwners();
    console.log(`owners: ok, ${owners.length} of them`);
  } catch (e) {
    console.log(`owners: FAILED — ${e instanceof Error ? e.message : String(e)}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
