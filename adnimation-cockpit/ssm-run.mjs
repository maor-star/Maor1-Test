import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';
import { readFileSync } from 'node:fs';

const ssm = new SSMClient({ region: 'eu-central-1' });
const INSTANCE = 'i-0babf124bd21755d5';

export async function run(commands, label = 'command') {
  const sent = await ssm.send(new SendCommandCommand({
    InstanceIds: [INSTANCE],
    DocumentName: 'AWS-RunShellScript',
    Parameters: { commands, executionTimeout: ['600'] },
    TimeoutSeconds: 600,
  }));
  const id = sent.Command.CommandId;
  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const inv = await ssm.send(new GetCommandInvocationCommand({ CommandId: id, InstanceId: INSTANCE }));
      if (['Success', 'Failed', 'Cancelled', 'TimedOut'].includes(inv.Status)) {
        console.log(`--- ${label}: ${inv.Status} ---`);
        if (inv.StandardOutputContent) console.log(inv.StandardOutputContent.trim());
        if (inv.StandardErrorContent) console.log('STDERR:', inv.StandardErrorContent.trim().slice(0, 3000));
        return inv;
      }
    } catch (e) {
      if (e.name !== 'InvocationDoesNotExist') throw e;
    }
  }
  throw new Error('timed out waiting for ' + label);
}

if (process.argv[1].endsWith('ssm-run.mjs')) {
  const seed = readFileSync('/tmp/seed-fixed.sql', 'utf8');
  await run([
    'set -e',
    'systemctl is-active cockpit || true',
    'systemctl is-active nginx || true',
    "cat > /tmp/seed-fixed.sql <<'SEEDEOF'\n" + seed + '\nSEEDEOF',
    'set -a; . /opt/cockpit/.env; set +a',
    'PGPASSWORD=$(echo "$DATABASE_URL" | sed -E "s|.*://cockpit:([^@]+)@.*|\\1|") psql -h 127.0.0.1 -U cockpit -d cockpit -v ON_ERROR_STOP=1 -f /tmp/seed-fixed.sql',
    'PGPASSWORD=$(echo "$DATABASE_URL" | sed -E "s|.*://cockpit:([^@]+)@.*|\\1|") psql -h 127.0.0.1 -U cockpit -d cockpit -t -c "select \'tasks=\'||count(*) from tasks; select \'depts=\'||count(*) from departments; select \'delegations=\'||count(*) from delegations;"',
    'systemctl restart cockpit',
    'sleep 4',
    'echo "--- local app ---"; curl -s -o /dev/null -w "app:%{http_code}\\n" http://127.0.0.1:3000/login',
    'echo "--- through nginx ---"; curl -sk -o /dev/null -w "https:%{http_code}\\n" https://127.0.0.1/login -H "Host: 63-186-30-215.sslip.io"',
  ], 'seed + verify');
}
