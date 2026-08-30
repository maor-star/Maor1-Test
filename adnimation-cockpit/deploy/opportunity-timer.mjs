/**
 * Installs the opportunity sweep as a systemd timer.
 *
 *   node deploy/opportunity-timer.mjs
 *
 * Hourly, offset from the mail mirror so it reads mail that has already
 * landed. It only ever proposes — nothing reaches his list without him
 * accepting it — so running it often costs nothing.
 */
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';

const REGION = 'us-east-1';
const INSTANCE = 'i-09d6877e4c01aa149';

const service = `[Unit]
Description=Read the mirrored mail for opportunities worth proposing
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/cockpit-jobs
EnvironmentFile=/opt/adnimation-cockpit/.env
ExecStart=/usr/bin/node /opt/cockpit-jobs/opportunity-sweep.mjs
TimeoutStartSec=600
`;

const timer = `[Unit]
Description=Opportunity sweep, hourly

[Timer]
OnBootSec=8min
OnUnitActiveSec=1h
RandomizedDelaySec=5min
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
`;

const commands = [
  'set -e',
  `cat > /etc/systemd/system/opportunity-sweep.service <<'UNIT'\n${service}UNIT`,
  `cat > /etc/systemd/system/opportunity-sweep.timer <<'UNIT'\n${timer}UNIT`,
  'systemctl daemon-reload',
  'systemctl enable --now opportunity-sweep.timer',
  'systemctl list-timers opportunity-sweep.timer --no-pager | head -2',
];

const ssm = new SSMClient({ region: REGION });
const sent = await ssm.send(
  new SendCommandCommand({
    InstanceIds: [INSTANCE],
    DocumentName: 'AWS-RunShellScript',
    Parameters: { commands, executionTimeout: ['300'] },
    TimeoutSeconds: 300,
  }),
);

for (let i = 0; i < 60; i += 1) {
  await new Promise((r) => setTimeout(r, 4000));
  try {
    const inv = await ssm.send(
      new GetCommandInvocationCommand({
        CommandId: sent.Command.CommandId,
        InstanceId: INSTANCE,
      }),
    );
    if (inv.Status === 'InProgress' || inv.Status === 'Pending') continue;
    console.log(inv.StandardOutputContent ?? '');
    if (inv.StandardErrorContent) console.error(inv.StandardErrorContent);
    process.exit(inv.Status === 'Success' ? 0 : 1);
  } catch (e) {
    if (e.name !== 'InvocationDoesNotExist') throw e;
  }
}
console.error('timed out waiting for SSM');
process.exit(1);
