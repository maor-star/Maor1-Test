/**
 * Imports HubSpot records from JSON files already fetched elsewhere.
 *
 *   DATABASE_URL=... npx tsx scripts/import-hubspot-json.ts companies <file...>
 *   DATABASE_URL=... npx tsx scripts/import-hubspot-json.ts contacts  <file...>
 *
 * Each file is a HubSpot CRM search response: `{ "results": [ { id, properties } ] }`.
 * This exists because the cockpit's build environment cannot reach api.hubapi.com
 * directly, so the first load of the CRM was pulled through a connector and
 * written to disk. Once HUBSPOT_ACCESS_TOKEN is set, scripts/sync-hubspot.ts
 * does the same job continuously and this script is only a fallback.
 */
import { readFileSync } from 'node:fs';
import { normaliseCompany, normaliseContact } from '../lib/integrations/hubspot';
import { FakeHubSpotAdapter } from '../lib/integrations/hubspot';
import { crmCounts, mirrorHubSpot } from '../lib/sync/hubspot-mirror';

function load(files: string[], kind: 'companies' | 'contacts') {
  const rows = [];
  for (const file of files) {
    const body = JSON.parse(readFileSync(file, 'utf8')) as { results?: unknown[] };
    for (const raw of body.results ?? []) {
      const row = kind === 'companies' ? normaliseCompany(raw) : normaliseContact(raw);
      if (row) rows.push(row);
    }
  }
  return rows;
}

async function main() {
  const [kind, ...files] = process.argv.slice(2);
  if ((kind !== 'companies' && kind !== 'contacts') || files.length === 0) {
    console.error('Usage: import-hubspot-json.ts <companies|contacts> <file...>');
    process.exit(1);
  }

  const rows = load(files, kind);
  const adapter = new FakeHubSpotAdapter();
  adapter.seed(
    kind === 'companies'
      ? { companies: rows as never, contacts: [] }
      : { companies: [], contacts: rows as never },
  );

  const result = await mirrorHubSpot(adapter);
  const counts = await crmCounts();
  console.log(
    `Imported ${kind === 'companies' ? result.companies : result.contacts} ${kind} from ` +
      `${files.length} file(s). Cockpit holds ${counts.companies} companies, ` +
      `${counts.contacts} contacts.`,
  );
  process.exit(result.error ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
