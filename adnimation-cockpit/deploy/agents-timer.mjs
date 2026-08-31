/**
 * Installs the agent jobs as systemd timers.
 *
 *   node deploy/agents-timer.mjs
 *
 * An agent he switches on has to actually run, or the switch is decoration.
 * The timers are always installed and always fire; what decides whether
 * anything happens is the switch on the screen, read at the top of every run
 * (deploy/agent-brief.mjs). So a timer firing for an agent that is off costs
 * one database query and prints one line saying why it did nothing.
 *
 * That is the safer arrangement than installing a timer when he flips a
 * switch: nothing about his decision depends on a deploy, and switching an
 * agent off stops it immediately rather than at the next deploy.
 */
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';

const REGION = 'us-east-1';
const INSTANCE = 'i-09d6877e4c01aa149';

/** Each job, how often it fires, and what it is for. */
const JOBS = [
  {
    name: 'mail-answer',
    script: 'mail-answer.mjs',
    description: 'Answer the trivial mail, file what only needs showing',
    // The timer fires often and cheaply; how often the agent actually runs is
    // set on the screen and read at the top of every run.
    every: '30min',
    boot: '10min',
  },
  {
    name: 'mailbox-tidy',
    script: 'mailbox-tidy.mjs',
    description: 'File the sales mail and clear spent one-time codes',
    every: '1h',
    boot: '15min',
  },
  {
    name: 'invoice-forward',
    script: 'invoice-forward.mjs',
    description: 'Send invoices on to finance',
    every: '1h',
    boot: '20min',
  },
];

const commands = ['set -e'];
for (const job of JOBS) {
  const service = `[Unit]
Description=${job.description}
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/cockpit-jobs
EnvironmentFile=/opt/adnimation-cockpit/.env
ExecStart=/usr/bin/node /opt/cockpit-jobs/${job.script}
TimeoutStartSec=900
`;

  const timer = `[Unit]
Description=${job.description}, every ${job.every}

[Timer]
OnBootSec=${job.boot}
OnUnitActiveSec=${job.every}
AccuracySec=2min

[Install]
WantedBy=timers.target
`;

  commands.push(
    `cat > /etc/systemd/system/${job.name}.service <<'UNIT'\n${service}UNIT`,
    `cat > /etc/systemd/system/${job.name}.timer <<'UNIT'\n${timer}UNIT`,
  );
}
commands.push(
  'systemctl daemon-reload',
  ...JOBS.map((j) => `systemctl enable --now ${j.name}.timer`),
  `systemctl list-timers ${JOBS.map((j) => `${j.name}.timer`).join(' ')} --no-pager`,
);

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
      if (inv.StandardOutputContent) console.log(inv.StandardOutputContent.trimEnd());
      if (inv.StandardErrorContent) console.error(inv.StandardErrorContent.trimEnd());
      process.exit(inv.Status === 'Success' ? 0 : 1);
    }
  } catch (e) {
    if (e.name !== 'InvocationDoesNotExist') throw e;
  }
}
console.error('timed out waiting for the command');
process.exit(1);
