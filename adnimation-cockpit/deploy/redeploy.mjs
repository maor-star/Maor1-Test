/**
 * Ships the current build to the EC2 instance.
 *
 *   npm run build && node deploy/redeploy.mjs
 *
 * The instance has no inbound SSH (the security group opens 80 and 443 only),
 * so everything goes through SSM Run Command, and the bundle travels through a
 * private S3 object with a one-hour presigned URL rather than being pasted into
 * a shell command.
 *
 * The bundle must be assembled with `cp -a .next/standalone/.` — a plain
 * `cp -r .next/standalone/*` silently drops the hidden `.next` directory inside
 * it, and the server then starts and dies with "Could not find a production
 * build". That cost one broken deploy; it is why the script checks for
 * BUILD_ID on the instance before swapping anything.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';

const REGION = 'us-east-1';
const INSTANCE = 'i-09d6877e4c01aa149';
const BUCKET = 'adnimation-cockpit-deploy-2026';
const APP = '/opt/adnimation-cockpit';

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

async function ssmRun(commands, label) {
  const ssm = new SSMClient({ region: REGION });
  const sent = await ssm.send(new SendCommandCommand({
    InstanceIds: [INSTANCE],
    DocumentName: 'AWS-RunShellScript',
    Parameters: { commands, executionTimeout: ['900'] },
    TimeoutSeconds: 600,
  }));
  const CommandId = sent.Command.CommandId;

  for (let i = 0; i < 200; i += 1) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const inv = await ssm.send(new GetCommandInvocationCommand({ CommandId, InstanceId: INSTANCE }));
      if (['Success', 'Failed', 'Cancelled', 'TimedOut'].includes(inv.Status)) {
        console.log(`--- ${label}: ${inv.Status} ---`);
        if (inv.StandardOutputContent) console.log(inv.StandardOutputContent.trim());
        if (inv.StandardErrorContent) console.error(inv.StandardErrorContent.trim());
        if (inv.Status !== 'Success') process.exit(1);
        return inv;
      }
    } catch (e) {
      if (e.name !== 'InvocationDoesNotExist') throw e;
    }
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function main() {
  if (!existsSync('.next/standalone/server.js')) {
    console.error('No standalone build. Run `npm run build` first.');
    process.exit(1);
  }

  console.log('assembling bundle…');
  sh('rm', ['-rf', '/tmp/cockpit-bundle', '/tmp/cockpit-bundle.tar.gz']);
  sh('mkdir', ['-p', '/tmp/cockpit-bundle']);
  sh('cp', ['-a', '.next/standalone/.', '/tmp/cockpit-bundle/']);
  sh('cp', ['-a', '.next/static', '/tmp/cockpit-bundle/.next/static']);
  sh('cp', ['-a', 'db', '/tmp/cockpit-bundle/db']);
  // The standalone bundle has no importable modules, so the sync jobs travel
  // beside it as plain scripts and are installed into /opt/cockpit-jobs, which
  // carries their one dependency.
  sh('mkdir', ['-p', '/tmp/cockpit-bundle/jobs']);
  for (const job of [
    'clickup-sync.mjs', 'hubspot-sync.mjs', 'people-sync.mjs', 'mail-sync.mjs',
    'slack-check.mjs', 'gmail-check.mjs',
    // revenue-sync imports revenue-source, and revenue-seed fills a fresh
    // database from the checked-in snapshot. All three have to travel.
    'revenue-sync.mjs', 'revenue-source.mjs', 'revenue-seed.mjs',
    // opportunity-sweep imports the generated copy of the detection rules.
    'opportunity-sweep.mjs', 'opportunity-detect.mjs', 'slack-capture.mjs',
    // contract-sync imports the generated copy of the intake rules.
    'contract-sync.mjs', 'contract-intake.mjs', 'contract-folders.mjs', 'drive-find.mjs', 'gmail-send-check.mjs', 'claude-check.mjs', 'contract-backfill.mjs',
  ]) {
    if (existsSync(`deploy/${job}`)) sh('cp', ['-a', `deploy/${job}`, '/tmp/cockpit-bundle/jobs/']);
  }
  // revenue-seed reads the snapshot from disk, so it has to travel with the
  // jobs rather than only inside the compiled app bundle.
  if (existsSync('fixtures/company-daily.json')) {
    sh('cp', ['-a', 'fixtures/company-daily.json', '/tmp/cockpit-bundle/jobs/']);
  }
  if (existsSync('public')) sh('cp', ['-a', 'public', '/tmp/cockpit-bundle/public']);
  if (!existsSync('/tmp/cockpit-bundle/.next/BUILD_ID')) {
    console.error('Bundle has no .next/BUILD_ID — the standalone output did not copy.');
    process.exit(1);
  }
  sh('tar', ['czf', '/tmp/cockpit-bundle.tar.gz', '-C', '/tmp', 'cockpit-bundle']);

  console.log('uploading…');
  const s3 = new S3Client({ region: REGION });
  const key = `bundle-${Date.now()}.tar.gz`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: readFileSync('/tmp/cockpit-bundle.tar.gz'),
  }));
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: 3600,
  });

  console.log('deploying…');
  await ssmRun([
    'set -e',
    `curl -sSf -o /tmp/bundle.tar.gz "${url}"`,
    'rm -rf /tmp/cockpit-bundle && tar xzf /tmp/bundle.tar.gz -C /tmp',
    'test -f /tmp/cockpit-bundle/.next/BUILD_ID',
    'test -d /tmp/cockpit-bundle/.next/server',
    `echo "incoming build $(cat /tmp/cockpit-bundle/.next/BUILD_ID)"`,
    'systemctl stop cockpit || true',
    // The env file is the one thing that must survive the swap.
    `cp ${APP}/.env /tmp/cockpit.env`,
    `rm -rf ${APP}.old && mv ${APP} ${APP}.old`,
    `mv /tmp/cockpit-bundle ${APP}`,
    `cp /tmp/cockpit.env ${APP}/.env && chmod 600 ${APP}/.env && rm -f /tmp/cockpit.env`,
    `touch ${APP}/READY`,
    'mkdir -p /opt/cockpit-jobs',
    `cp ${APP}/jobs/*.mjs /opt/cockpit-jobs/ 2>/dev/null || true`,
    // revenue-seed reads the snapshot from beside itself.
    `cp ${APP}/jobs/*.json /opt/cockpit-jobs/ 2>/dev/null || true`,
    // Values in .env can contain spaces, so read the one key needed rather than
    // sourcing the file — `. .env` breaks on `OWNER_NAME=Maor Davidovich`.
    `DBURL=$(grep -m1 '^DATABASE_URL=' ${APP}/.env | cut -d= -f2-)`,
    `for f in ${APP}/db/migrations/*.sql; do echo "migration $(basename "$f")"; psql "$DBURL" -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done`,
    'systemctl start cockpit',
    'sleep 8',
    'systemctl is-active cockpit',
    'curl -s -o /dev/null -w "login=%{http_code}\\n" http://127.0.0.1:3000/login',
  ], 'deploy');

  console.log('live at https://cockpit.wonderfool.xyz');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
