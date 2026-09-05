/**
 * Installs the one sync that pulls everything from the source.
 *
 *   node deploy/source-timer.mjs
 *
 * Every three hours. The source keeps revising a day for hours after it ends,
 * so this is not "fetch today once" — each run re-pulls a trailing window and
 * corrects the days that have since filled in.
 *
 * It replaces the revenue and control-panel timers, which went through the
 * Lovable API with a key that was never set and exited 78 every time. This one
 * reads the source directly and fills all four tables: the P&L, the seven
 * revenue engines, the accounts, and the demand and supply seats.
 *
 * RandomizedDelaySec keeps it off the exact hour, where every other job in the
 * account already is.
 */
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';

const REGION = 'us-east-1';
const INSTANCE = 'i-09d6877e4c01aa149';

const service = `[Unit]
Description=Pull the P&L, the revenue engines, the accounts and the seats from the source
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/cockpit-jobs
EnvironmentFile=/opt/adnimation-cockpit/.env
ExecStart=/usr/bin/node /opt/cockpit-jobs/source-sync.mjs
TimeoutStartSec=1800
# 78 is EX_CONFIG: the source sign-in is not configured yet. That is a known
# state, not a fault, and should not show the unit as failed.
SuccessExitStatus=0 78
`;

const timer = `[Unit]
Description=Full source sync every three hours

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
  `cat > /etc/systemd/system/source-sync.service <<'UNIT'\n${service}UNIT`,
  `cat > /etc/systemd/system/source-sync.timer <<'UNIT'\n${timer}UNIT`,
  'systemctl daemon-reload',
  'systemctl enable --now source-sync.timer',
  'systemctl list-timers source-sync.timer --no-pager | head -2',
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
