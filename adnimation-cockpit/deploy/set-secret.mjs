/**
 * Puts one secret into the instance's .env without writing it anywhere it can
 * be read back.
 *
 *   HUBSPOT_ACCESS_TOKEN=… node deploy/set-secret.mjs HUBSPOT_ACCESS_TOKEN
 *
 * The obvious way — passing the value in an SSM Run Command — leaves it in AWS
 * command history for thirty days, readable by anyone with SSM access to the
 * account. So the value goes to S3 encrypted at rest, the instance fetches it
 * through a presigned URL that expires in two minutes, and the object is
 * deleted immediately afterwards. What lands in the command log is a signature,
 * not a credential.
 *
 * The value is read from the environment rather than an argument, because
 * arguments show up in `ps` and in shell history.
 */
import { randomBytes } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';

const REGION = 'us-east-1';
const INSTANCE = 'i-09d6877e4c01aa149';
const BUCKET = 'adnimation-cockpit-deploy-2026';
const APP = '/opt/adnimation-cockpit';

const name = process.argv[2];
const value = process.env[name ?? ''];

if (!name || !value) {
  console.error('Usage: <NAME>=<value> node deploy/set-secret.mjs <NAME>');
  process.exit(1);
}
if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
  console.error('The name must be an environment variable name.');
  process.exit(1);
}

async function ssmRun(commands, label) {
  const ssm = new SSMClient({ region: REGION });
  const sent = await ssm.send(
    new SendCommandCommand({
      InstanceIds: [INSTANCE],
      DocumentName: 'AWS-RunShellScript',
      Parameters: { commands, executionTimeout: ['600'] },
      TimeoutSeconds: 600,
    }),
  );

  for (let i = 0; i < 150; i += 1) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const inv = await ssm.send(
        new GetCommandInvocationCommand({ CommandId: sent.Command.CommandId, InstanceId: INSTANCE }),
      );
      if (['Success', 'Failed', 'Cancelled', 'TimedOut'].includes(inv.Status)) {
        console.log(`--- ${label}: ${inv.Status} ---`);
        if (inv.StandardOutputContent) console.log(inv.StandardOutputContent.trim());
        if (inv.StandardErrorContent) console.error(inv.StandardErrorContent.trim());
        return inv.Status === 'Success';
      }
    } catch (e) {
      if (e.name !== 'InvocationDoesNotExist') throw e;
    }
  }
  throw new Error(`timed out waiting for ${label}`);
}

const s3 = new S3Client({ region: REGION });
const key = `secrets/${randomBytes(16).toString('hex')}`;

await s3.send(
  new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: `${name}=${value}\n`,
    ServerSideEncryption: 'AES256',
  }),
);

try {
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: 120,
  });

  const ok = await ssmRun(
    [
      'set -e',
      `curl -sSf -o /tmp/secret.env "${url}"`,
      // Replace the key if it is already there, append it if it is not. The
      // rest of .env must survive untouched — it holds the database URL.
      `grep -v '^${name}=' ${APP}/.env > /tmp/env.new || true`,
      'cat /tmp/secret.env >> /tmp/env.new',
      `mv /tmp/env.new ${APP}/.env && chmod 600 ${APP}/.env`,
      'shred -u /tmp/secret.env 2>/dev/null || rm -f /tmp/secret.env',
      // Report that the key is present and how long it is. Never the value.
      `echo "${name} set, $(grep -c '^${name}=' ${APP}/.env) entry, $(grep '^${name}=' ${APP}/.env | cut -d= -f2- | wc -c) chars"`,
    ],
    `set ${name}`,
  );
  process.exitCode = ok ? 0 : 1;
} finally {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  console.log('temporary object deleted');
}
