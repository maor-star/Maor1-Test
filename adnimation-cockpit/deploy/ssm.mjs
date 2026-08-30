/**
 * Runs a shell command on the cockpit instance and prints what it said.
 *
 *   node deploy/ssm.mjs 'systemctl status cockpit'
 *
 * The build sandbox has no inbound SSH and its egress proxy blocks the app's
 * own hostname, so anything that has to be asked of the running server is asked
 * through SSM. Never pass a secret as an argument — it is kept in AWS command
 * history for thirty days. Use deploy/set-secret.mjs for those.
 */
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';

const REGION = 'us-east-1';
const INSTANCE = 'i-09d6877e4c01aa149';

const commands = process.argv.slice(2);
if (commands.length === 0) {
  console.error("Usage: node deploy/ssm.mjs '<command>' ['<command>' …]");
  process.exit(1);
}

const ssm = new SSMClient({ region: REGION });
const sent = await ssm.send(
  new SendCommandCommand({
    InstanceIds: [INSTANCE],
    DocumentName: 'AWS-RunShellScript',
    Parameters: { commands, executionTimeout: ['3600'] },
    TimeoutSeconds: 3600,
  }),
);

for (let i = 0; i < 900; i += 1) {
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
