/**
 * Installs the control panel sync as a systemd timer.
 *
 *   node deploy/activity-timer.mjs
 *
 * Every three hours. The source keeps revising a day for hours after it ends,
 * so this is not "fetch today once" — each run re-pulls a trailing window and
 * corrects the days that have since filled in.
 *
 * RandomizedDelaySec keeps it off the exact hour, where every other job in the
 * account already is.
 */
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';

const REGION = 'us-east-1';
const INSTANCE = 'i-09d6877e4c01aa149';

const service = `[Unit]
Description=Pull the control panel lines from the Ad Ops Architect source
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/cockpit-jobs
EnvironmentFile=/opt/adnimation-cockpit/.env
ExecStart=/usr/bin/node /opt/cockpit-jobs/activity-sync.mjs
TimeoutStartSec=900
# 78 is EX_CONFIG: the Lovable credential is not set yet. That is a known
# state, not a fault, and should not show the unit as failed.
SuccessExitStatus=0 78
`;

const timer = `[Unit]
Description=Control panel sync every three hours

[Timer]
OnBootSec=8min
OnUnitActiveSec=3h
RandomizedDelaySec=6min
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
`;

const commands = [
  'set -e',
  `cat > /etc/systemd/system/activity-sync.service <<'UNIT'\n${service}UNIT`,
  `cat > /etc/systemd/system/activity-sync.timer <<'UNIT'\n${timer}UNIT`,
  'systemctl daemon-reload',
  'systemctl enable --now activity-sync.timer',
  'systemctl list-timers activity-sync.timer --no-pager | head -2',
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
