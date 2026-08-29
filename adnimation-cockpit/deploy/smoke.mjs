/**
 * Post-deploy smoke check, run from inside the instance over SSM.
 *
 * The build sandbox cannot reach the public hostname — its egress proxy denies
 * it — so "is it live" has to be asked from the box that serves it.
 *
 * Every app route is behind auth, so a healthy answer is 307 to the login page:
 * the route is registered, middleware ran, and the server did not fault. What
 * this catches is the failure that actually happens after a deploy — a 500 from
 * a missing fixture or a bad build — not whether the page renders, which the
 * browser pass before the deploy covers. It deliberately does not mint a
 * session cookie: that would put a live credential into AWS command history.
 */
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';

const REGION = 'us-east-1';
const INSTANCE = 'i-09d6877e4c01aa149';

const PATHS = [
  '/', '/trading', '/pipeline', '/crm', '/delegations',
  '/revenue', '/clients', '/seats/demand', '/seats/supply', '/tasks',
];

const script = [
  'cd /opt/adnimation-cockpit',
  'systemctl is-active cockpit.service',
  'test -f fixtures/trading.json && echo "trading fixture: $(wc -c < fixtures/trading.json) bytes"',
  ...PATHS.map(
    (p) =>
      `echo "${p} -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000${p})"`,
  ),
  'echo "login -> $(curl -s -o /dev/null -w \'%{http_code}\' http://127.0.0.1:3000/login)"',
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
