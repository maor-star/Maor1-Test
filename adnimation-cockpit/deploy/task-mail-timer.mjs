/**
 * Installs the task-mail sweep as a systemd timer.
 *
 *   node deploy/task-mail-timer.mjs
 *
 * Every thirty minutes, which is the cadence he asked for when he said it
 * should be pulling the relevant mail all the time. The mailbox mirror runs on
 * its own timer ahead of this; this reads what the mirror has.
 *
 * Thirty rather than twenty because half the run is model calls, and a task
 * that acquires its email half an hour after the thread arrived is a task he
 * finds with the email on it either way.
 */
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';

const REGION = 'us-east-1';
const INSTANCE = 'i-09d6877e4c01aa149';

const service = `[Unit]
Description=Match the mailbox to the open tasks
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/cockpit-jobs
EnvironmentFile=/opt/adnimation-cockpit/.env
ExecStart=/usr/bin/node /opt/cockpit-jobs/task-mail.mjs
TimeoutStartSec=900
SuccessExitStatus=0 78
`;

const timer = `[Unit]
Description=Task mail sweep every thirty minutes

[Timer]
OnBootSec=9min
OnUnitActiveSec=30min
RandomizedDelaySec=3min
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
`;

const commands = [
  'set -e',
  `cat > /etc/systemd/system/task-mail.service <<'UNIT'\n${service}UNIT`,
  `cat > /etc/systemd/system/task-mail.timer <<'UNIT'\n${timer}UNIT`,
  'systemctl daemon-reload',
  'systemctl enable --now task-mail.timer',
  'systemctl list-timers task-mail.timer --no-pager',
];

const ssm = new SSMClient({ region: REGION });
const sent = await ssm.send(new SendCommandCommand({
  InstanceIds: [INSTANCE],
  DocumentName: 'AWS-RunShellScript',
  Parameters: { commands, executionTimeout: ['600'] },
  TimeoutSeconds: 600,
}));
const CommandId = sent.Command.CommandId;

for (let i = 0; i < 100; i += 1) {
  await new Promise((r) => setTimeout(r, 2000));
  const out = await ssm
    .send(new GetCommandInvocationCommand({ CommandId, InstanceId: INSTANCE }))
    .catch(() => null);
  if (!out || out.Status === 'InProgress' || out.Status === 'Pending') continue;
  console.log(out.StandardOutputContent ?? '');
  if (out.StandardErrorContent) console.error(out.StandardErrorContent);
  process.exit(out.Status === 'Success' ? 0 : 1);
}
console.error('timed out waiting for SSM');
process.exit(1);
