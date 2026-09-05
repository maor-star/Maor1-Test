/**
 * Installs the delegation watch as a systemd timer.
 *
 *   node deploy/delegation-timer.mjs
 *
 * Every twenty minutes, because "did they answer" is a question with a short
 * useful life: an answer he learns about two days late is one he has already
 * chased for.
 *
 * This is what he asked for when he said to scan the replies all the time. The
 * check used to run only when he opened the screen and pressed the button, and
 * the three-day stale check was an Inngest function on a box with no Inngest,
 * so it had never run at all.
 */
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';

const REGION = 'us-east-1';
const INSTANCE = 'i-09d6877e4c01aa149';

const service = `[Unit]
Description=Find answers to what was handed over, and mark what has gone quiet
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/cockpit-jobs
EnvironmentFile=/opt/adnimation-cockpit/.env
ExecStart=/usr/bin/node /opt/cockpit-jobs/delegation-watch.mjs
TimeoutStartSec=600
SuccessExitStatus=0 78
`;

const timer = `[Unit]
Description=Delegation watch every twenty minutes

[Timer]
OnBootSec=4min
OnUnitActiveSec=20min
RandomizedDelaySec=2min
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
`;

const commands = [
  'set -e',
  `cat > /etc/systemd/system/delegation-watch.service <<'UNIT'\n${service}UNIT`,
  `cat > /etc/systemd/system/delegation-watch.timer <<'UNIT'\n${timer}UNIT`,
  'systemctl daemon-reload',
  'systemctl enable --now delegation-watch.timer',
  'systemctl list-timers delegation-watch.timer --no-pager | head -2',
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
