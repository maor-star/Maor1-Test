/**
 * Installs the in-app agent tick as a systemd timer.
 *
 *   node deploy/agents-tick-timer.mjs
 *
 * The in-app agents — activity-watch, core-client-guardian, deal-mover,
 * task-hygiene, systems-watch, the autopilot — run inside the Next.js server,
 * where the cockpit's own modules are. A timer cannot import those, so it asks
 * the server to run whatever is due: one POST to an internal route, signed with
 * a key that lives only in the server's .env. The route decides what is due
 * from each agent's switch and interval; this only knocks.
 */
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';

const REGION = 'us-east-1';
const INSTANCE = 'i-09d6877e4c01aa149';

const service = `[Unit]
Description=Ask the cockpit to run whichever in-app agents are due
After=network-online.target cockpit.service

[Service]
Type=oneshot
EnvironmentFile=/opt/adnimation-cockpit/.env
ExecStart=/bin/sh -c 'curl -sS -m 600 -X POST -H "x-internal-key: $INTERNAL_JOB_KEY" http://127.0.0.1:3000/api/internal/tick'
`;

const timer = `[Unit]
Description=In-app agent tick every 20 minutes

[Timer]
OnBootSec=6min
OnUnitActiveSec=20min
RandomizedDelaySec=2min
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
`;

const commands = [
  'set -e',
  // The key is minted once, on the box, and never leaves it.
  `grep -q '^INTERNAL_JOB_KEY=' /opt/adnimation-cockpit/.env || echo "INTERNAL_JOB_KEY=$(openssl rand -hex 32)" >> /opt/adnimation-cockpit/.env`,
  `cat > /etc/systemd/system/agents-tick.service <<'UNIT'\n${service}UNIT`,
  `cat > /etc/systemd/system/agents-tick.timer <<'UNIT'\n${timer}UNIT`,
  'systemctl daemon-reload',
  'systemctl enable --now agents-tick.timer',
  // The app reads .env at start; a key it has not seen yet needs a restart.
  'systemctl restart cockpit',
  'systemctl list-timers agents-tick.timer --no-pager | head -2',
];

const ssm = new SSMClient({ region: REGION });
const sent = await ssm.send(
  new SendCommandCommand({
    InstanceIds: [INSTANCE],
    DocumentName: 'AWS-RunShellScript',
    Parameters: { commands },
  }),
);
const id = sent.Command?.CommandId;
for (let i = 0; i < 60; i += 1) {
  await new Promise((r) => setTimeout(r, 2000));
  const inv = await ssm.send(new GetCommandInvocationCommand({ CommandId: id, InstanceId: INSTANCE }));
  if (inv.Status === 'Success' || inv.Status === 'Failed') {
    console.log(inv.StandardOutputContent ?? '');
    if (inv.StandardErrorContent) console.error(inv.StandardErrorContent);
    process.exit(inv.Status === 'Success' ? 0 : 1);
  }
}
console.error('timed out waiting for SSM');
process.exit(1);
