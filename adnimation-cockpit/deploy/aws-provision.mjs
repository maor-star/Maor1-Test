/**
 * Provisions the cockpit on EC2: a private S3 bucket for the build bundle, a
 * security group, and one instance that installs Node, PostgreSQL, nginx and a
 * Let's Encrypt certificate on boot.
 *
 * Deliberately small: two users, an internal console. No RDS, no load balancer,
 * no autoscaling — those cost money and solve problems this system does not have.
 *
 *   node deploy/aws-provision.mjs
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  EC2Client, AllocateAddressCommand, AssociateAddressCommand, AuthorizeSecurityGroupIngressCommand,
  CreateSecurityGroupCommand, CreateTagsCommand, DescribeInstancesCommand, DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand, DescribeVpcsCommand, RunInstancesCommand,
} from '@aws-sdk/client-ec2';
import { S3Client, CreateBucketCommand, PutObjectCommand, PutPublicAccessBlockCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const REGION = process.env.AWS_DEFAULT_REGION || 'eu-central-1';
const NAME = 'adnimation-cockpit';
const ALLOWED_EMAILS = process.env.ALLOWED_EMAILS || 'maor@adnimation.com,mor@adnimation.com';
const BUNDLE = process.env.BUNDLE_PATH || '/tmp/cockpit-bundle.tar.gz';
const INSTANCE_TYPE = process.env.INSTANCE_TYPE || 't3.small';

const ec2 = new EC2Client({ region: REGION });
const s3 = new S3Client({ region: REGION });
const ssm = new SSMClient({ region: REGION });

const log = (...a) => console.log('·', ...a);
const secret = (n = 32) => randomBytes(n).toString('base64url');

async function main() {
  const stamp = Date.now().toString(36);
  const bucket = `${NAME}-deploy-${stamp}`;

  // ---- 1. private bucket for the build bundle ----
  await s3.send(new CreateBucketCommand({
    Bucket: bucket,
    CreateBucketConfiguration: REGION === 'us-east-1' ? undefined : { LocationConstraint: REGION },
  }));
  await s3.send(new PutPublicAccessBlockCommand({
    Bucket: bucket,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true, IgnorePublicAcls: true,
      BlockPublicPolicy: true, RestrictPublicBuckets: true,
    },
  }));
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  log('bucket', bucket, '(private, public access blocked)');

  await s3.send(new PutObjectCommand({
    Bucket: bucket, Key: 'bundle.tar.gz', Body: readFileSync(BUNDLE),
  }));
  log('uploaded bundle');

  // A presigned URL avoids giving the instance an IAM role just to fetch one file.
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const signed = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: 'bundle.tar.gz' }), { expiresIn: 6 * 3600 });
  log('presigned bundle URL (6h)');

  // ---- 2. network ----
  const vpcs = await ec2.send(new DescribeVpcsCommand({ Filters: [{ Name: 'isDefault', Values: ['true'] }] }));
  const vpcId = vpcs.Vpcs?.[0]?.VpcId;
  if (!vpcId) throw new Error('no default VPC in ' + REGION);
  const subnets = await ec2.send(new DescribeSubnetsCommand({ Filters: [{ Name: 'vpc-id', Values: [vpcId] }] }));
  // Not every availability zone offers every instance type — us-east-1e has no
  // t3, and the default subnet list is not ordered by usefulness.
  const { DescribeInstanceTypeOfferingsCommand } = await import('@aws-sdk/client-ec2');
  const offerings = await ec2.send(new DescribeInstanceTypeOfferingsCommand({
    LocationType: 'availability-zone',
    Filters: [{ Name: 'instance-type', Values: [INSTANCE_TYPE] }],
  }));
  const usableAzs = new Set(offerings.InstanceTypeOfferings.map((o) => o.Location));
  const subnet = subnets.Subnets
    ?.filter((s) => usableAzs.has(s.AvailabilityZone))
    .sort((a, b) => Number(b.MapPublicIpOnLaunch) - Number(a.MapPublicIpOnLaunch))[0];
  if (!subnet) throw new Error(`no subnet in an AZ offering ${INSTANCE_TYPE}`);
  const subnetId = subnet.SubnetId;
  log('vpc', vpcId, 'subnet', subnetId, `(${subnet.AvailabilityZone})`);

  let sgId;
  const existing = await ec2.send(new DescribeSecurityGroupsCommand({
    Filters: [{ Name: 'group-name', Values: [NAME] }, { Name: 'vpc-id', Values: [vpcId] }],
  })).catch(() => null);
  if (existing?.SecurityGroups?.length) {
    sgId = existing.SecurityGroups[0].GroupId;
    log('reusing security group', sgId);
  } else {
    const sg = await ec2.send(new CreateSecurityGroupCommand({
      GroupName: NAME, Description: 'Adnimation CEO Cockpit - HTTP and HTTPS only', VpcId: vpcId,
    }));
    sgId = sg.GroupId;
    // 80 is needed for the ACME challenge and redirects to 443. No SSH: the box
    // is reachable through SSM if it ever needs hands on it.
    await ec2.send(new AuthorizeSecurityGroupIngressCommand({
      GroupId: sgId,
      IpPermissions: [80, 443].map((p) => ({
        IpProtocol: 'tcp', FromPort: p, ToPort: p,
        IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'public web' }],
      })),
    }));
    log('security group', sgId, '(80, 443 only — no SSH)');
  }

  // ---- 3. a stable address, so the link survives a reboot ----
  // Reuse an existing allocation when one is supplied; the DNS record and the
  // issued certificate are both tied to it.
  let allocationId = process.env.EIP_ALLOCATION_ID;
  let ip = process.env.EIP_ADDRESS;
  if (!allocationId) {
    const eip = await ec2.send(new AllocateAddressCommand({ Domain: 'vpc' }));
    allocationId = eip.AllocationId;
    ip = eip.PublicIp;
  }
  const host = process.env.DEPLOY_HOST || `${ip.replace(/\./g, '-')}.sslip.io`;
  log('address', ip, '->', host);

  // ---- 4. boot script ----
  const dbPassword = secret(18);
  const authSecret = secret(32);
  const env = {
    NODE_ENV: 'production',
    PORT: '3000',
    HOSTNAME: '127.0.0.1',
    DATABASE_URL: `postgres://cockpit:${dbPassword}@127.0.0.1:5432/cockpit`,
    AUTH_SECRET: authSecret,
    AUTH_URL: `https://${host}`,
    AUTH_TRUST_HOST: 'true',
    ALLOWED_EMAILS,
    USE_FAKE_INTEGRATIONS: '1',
    CLICKUP_DEFAULT_LIST_ID: 'preview-list',
  };

  const userData = `#!/bin/bash
set -euxo pipefail
exec > >(tee /var/log/cockpit-boot.log) 2>&1
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y curl ca-certificates gnupg postgresql nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# ---- app bundle ----
mkdir -p /opt/adnimation-cockpit
curl -fsSL --retry 5 --retry-delay 5 "${signed}" -o /tmp/bundle.tar.gz
tar xzf /tmp/bundle.tar.gz -C /opt/adnimation-cockpit --strip-components=1
rm -f /tmp/bundle.tar.gz

# ---- database ----
systemctl enable --now postgresql
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE cockpit LOGIN PASSWORD '${dbPassword}';"
sudo -u postgres createdb -O cockpit cockpit
export PGPASSWORD='${dbPassword}'
psql -h 127.0.0.1 -U cockpit -d cockpit -v ON_ERROR_STOP=1 -f /opt/adnimation-cockpit/db/schema.sql
psql -h 127.0.0.1 -U cockpit -d cockpit -f /opt/adnimation-cockpit/db/seed-data.sql || true

# ---- environment ----
cat > /opt/adnimation-cockpit/.env <<'ENVEOF'
${Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')}
ENVEOF
chmod 600 /opt/adnimation-cockpit/.env

# Helper so the Google OAuth client can be added without redeploying.
cat > /usr/local/bin/set-google-oauth <<'OAUTHEOF'
#!/bin/bash
set -euo pipefail
if [ $# -ne 2 ]; then echo "usage: set-google-oauth <CLIENT_ID> <CLIENT_SECRET>"; exit 1; fi
sed -i '/^AUTH_GOOGLE_/d' /opt/adnimation-cockpit/.env
printf 'AUTH_GOOGLE_ID=%s\nAUTH_GOOGLE_SECRET=%s\n' "$1" "$2" >> /opt/adnimation-cockpit/.env
systemctl restart cockpit
echo "Google sign-in enabled; service restarted."
OAUTHEOF
chmod 755 /usr/local/bin/set-google-oauth

# ---- service ----
cat > /etc/systemd/system/cockpit.service <<'SVCEOF'
[Unit]
Description=Adnimation CEO Cockpit
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/adnimation-cockpit
EnvironmentFile=/opt/adnimation-cockpit/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
SVCEOF
systemctl daemon-reload
systemctl enable --now cockpit

# ---- nginx ----
cat > /etc/nginx/sites-available/cockpit <<'NGXEOF'
server {
  listen 80;
  server_name ${host};
  client_max_body_size 4m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
NGXEOF
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/cockpit /etc/nginx/sites-enabled/cockpit
nginx -t && systemctl restart nginx

# ---- TLS: wait for the elastic IP to be attached, then issue ----
for i in $(seq 1 60); do
  TOKEN=$(curl -sX PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300" || true)
  MYIP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4 || true)
  [ "$MYIP" = "${ip}" ] && break
  sleep 5
done

for i in 1 2 3 4 5; do
  if certbot --nginx -d ${host} --non-interactive --agree-tos \
       --register-unsafely-without-email --redirect; then
    break
  fi
  sleep 20
done

systemctl reload nginx
touch /opt/adnimation-cockpit/READY
echo "cockpit boot complete"
`;

  // ---- 5. instance ----
  const ami = await ssm.send(new GetParameterCommand({
    Name: '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id',
  }));
  const imageId = ami.Parameter.Value;
  log('ami', imageId, '(ubuntu 24.04)');

  const run = await ec2.send(new RunInstancesCommand({
    ImageId: imageId,
    InstanceType: INSTANCE_TYPE,
    MinCount: 1, MaxCount: 1,
    SubnetId: subnetId,
    SecurityGroupIds: [sgId],
    UserData: Buffer.from(userData).toString('base64'),
    MetadataOptions: { HttpTokens: 'required', HttpEndpoint: 'enabled' },
    IamInstanceProfile: process.env.INSTANCE_PROFILE ? { Name: process.env.INSTANCE_PROFILE } : undefined,
    BlockDeviceMappings: [{ DeviceName: '/dev/sda1', Ebs: { VolumeSize: 20, VolumeType: 'gp3', DeleteOnTermination: true, Encrypted: true } }],
    TagSpecifications: [{ ResourceType: 'instance', Tags: [{ Key: 'Name', Value: NAME }, { Key: 'app', Value: NAME }] }],
  }));
  const instanceId = run.Instances[0].InstanceId;
  log('instance', instanceId, 'launching');

  // Wait for it to be running before attaching the address. RunInstances is
  // eventually consistent, so a Describe straight after can still 404.
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const d = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
      if (d.Reservations[0].Instances[0].State.Name === 'running') break;
    } catch (e) {
      if (e.name !== 'InvalidInstanceID.NotFound') throw e;
    }
  }
  await ec2.send(new AssociateAddressCommand({ InstanceId: instanceId, AllocationId: allocationId, AllowReassociation: true }));
  log('elastic ip associated');

  console.log('\n=== DEPLOYMENT ===');
  console.log(JSON.stringify({
    url: `https://${host}`,
    ip, host, instanceId, securityGroupId: sgId, bucket,
    allocationId, region: REGION,
  }, null, 2));
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
