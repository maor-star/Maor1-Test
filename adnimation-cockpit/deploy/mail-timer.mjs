/**
 * Installs the mail mirror as a systemd timer.
 *
 *   node deploy/mail-timer.mjs
 *
 * Every fifteen minutes. Mail is the one source where a delay is felt directly:
 * "waiting on you" that is an hour behind is a screen he stops trusting.
 */
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';

const REGION = 'us-east-1';
const INSTANCE = 'i-09d6877e4c01aa149';

const service = `[Unit]
Description=Mirror the mailbox into the cockpit
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/cockpit-jobs
EnvironmentFile=/opt/adnimation-cockpit/.env
ExecStart=/usr/bin/node /opt/cockpit-jobs/mail-sync.mjs
TimeoutStartSec=900
`;

const timer = `[Unit]
Description=Mail mirror every fifteen minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=15min
AccuracySec=1min

[Install]
WantedBy=timers.target
`;

const commands = [
  'set -e',
  `cat > /etc/systemd/system/mail-sync.service <<'UNIT'\n${service}UNIT`,
  `cat > /etc/systemd/system/mail-sync.timer <<'UNIT'\n${timer}UNIT`,
  'systemctl daemon-reload',
  'systemctl enable --now mail-sync.timer',
  'systemctl list-timers mail-sync.timer --no-pager | head -2',
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
      new GetCommandInvocationCommand({ CommandId: sent.Command.CommandId, InstanceId: INSTANCE }),
    );
    if (['Success', 'Failed', 'Cancelled', 'TimedOut'].includes(inv.Status)) {
      if (inv.StandardOutputContent) console.log(inv.StandardOutputContent.trim());
      if (inv.StandardErrorContent) console.error(inv.StandardErrorContent.trim());
      process.exit(inv.Status === 'Success' ? 0 : 1);
    }
  } catch (e) {
    if (e.name !== 'InvocationDoesNotExist') throw e;
  }
}
