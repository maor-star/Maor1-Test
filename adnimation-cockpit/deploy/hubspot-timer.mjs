/**
 * Installs the nightly HubSpot import as a systemd timer.
 *
 *   node deploy/hubspot-timer.mjs
 *
 * Runs once a day rather than every few minutes: the import reads ninety-six
 * thousand records and HubSpot is on its way out, so there is nothing to gain
 * from being quicker. The job never overwrites a record edited or archived in
 * the cockpit, so it stays safe to leave running while the book moves here.
 *
 * Idempotent — re-running it just rewrites the unit files.
 */
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';

const REGION = 'us-east-1';
const INSTANCE = 'i-09d6877e4c01aa149';

const service = `[Unit]
Description=Import HubSpot into the cockpit CRM
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/cockpit-jobs
EnvironmentFile=/opt/adnimation-cockpit/.env
ExecStart=/usr/bin/node /opt/cockpit-jobs/hubspot-sync.mjs
TimeoutStartSec=3600
`;

const timer = `[Unit]
Description=Nightly HubSpot import

[Timer]
OnCalendar=*-*-* 02:20:00
Persistent=true

[Install]
WantedBy=timers.target
`;

const script = [
  'set -e',
  `cat > /etc/systemd/system/hubspot-sync.service <<'UNIT'\n${service}UNIT`,
  `cat > /etc/systemd/system/hubspot-sync.timer <<'UNIT'\n${timer}UNIT`,
  'systemctl daemon-reload',
  'systemctl enable --now hubspot-sync.timer',
  'systemctl list-timers hubspot-sync.timer --no-pager | head -3',
];

const ssm = new SSMClient({ region: REGION });
const sent = await ssm.send(
  new SendCommandCommand({
    InstanceIds: [INSTANCE],
    DocumentName: 'AWS-RunShellScript',
    Parameters: { commands: script, executionTimeout: ['300'] },
    TimeoutSeconds: 300,
  }),
);

for (let i = 0; i < 60; i += 1) {
  await new Promise((r) => setTimeout(r, 4000));
  try {
    const inv = await ssm.send(
      new GetCommandInvocationCommand({ CommandId: sent.Command.CommandId, InstanceId: INSTANCE }),
    );
    if (['Success', 'Failed', 'Cancelled', 'TimedOut'].includes(inv.Status)) {
      console.log(inv.StandardOutputContent?.trim() ?? '');
      if (inv.StandardErrorContent) console.error(inv.StandardErrorContent.trim());
      process.exit(inv.Status === 'Success' ? 0 : 1);
    }
  } catch (e) {
    if (e.name !== 'InvocationDoesNotExist') throw e;
  }
}
