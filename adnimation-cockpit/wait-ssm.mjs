import { SSMClient, DescribeInstanceInformationCommand } from '@aws-sdk/client-ssm';
const ssm = new SSMClient({ region: 'eu-central-1' });
for (let i = 0; i < 30; i++) {
  const r = await ssm.send(new DescribeInstanceInformationCommand({
    Filters: [{ Key: 'InstanceIds', Values: ['i-0babf124bd21755d5'] }],
  }));
  const info = r.InstanceInformationList?.[0];
  if (info) { console.log('SSM registered:', info.PingStatus, '| agent', info.AgentVersion, '| platform', info.PlatformName); process.exit(0); }
  process.stdout.write('.');
  await new Promise(r => setTimeout(r, 10000));
}
console.log('\nnot registered after 5 minutes');
process.exit(1);
