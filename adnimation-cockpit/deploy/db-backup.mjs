/**
 * Installs a nightly database dump on the instance.
 *
 *   node deploy/db-backup.mjs
 *
 * The cockpit's Postgres runs on the instance itself, so until this existed
 * there was no copy of anything: one bad migration, one dropped table, and the
 * CRM the company is moving into would be gone. This gives a fourteen-day
 * rolling window of dumps on the instance's own disk.
 *
 * It does NOT protect against losing the instance — the dumps sit on the same
 * volume as the database. Off-instance copies need somewhere to put them, which
 * is the account owner's call, not this script's.
 *
 * Idempotent: re-running rewrites the unit files.
 */
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';

const REGION = 'us-east-1';
const INSTANCE = 'i-09d6877e4c01aa149';

const script = `#!/bin/bash
# Nightly dump of the cockpit database. Custom format, so a single table can be
# restored without replaying the whole thing.
set -euo pipefail

DIR=/var/backups/cockpit
STAMP=$(date -u +%Y%m%d-%H%M)
DBURL=$(grep -m1 '^DATABASE_URL=' /opt/adnimation-cockpit/.env | cut -d= -f2-)

mkdir -p "$DIR"
pg_dump "$DBURL" --format=custom --file="$DIR/cockpit-$STAMP.dump.partial"
mv "$DIR/cockpit-$STAMP.dump.partial" "$DIR/cockpit-$STAMP.dump"

# Prove the dump is readable rather than trusting that pg_dump exited zero.
pg_restore --list "$DIR/cockpit-$STAMP.dump" > /dev/null

find "$DIR" -name 'cockpit-*.dump' -mtime +14 -delete
find "$DIR" -name '*.partial' -mtime +1 -delete

echo "$(date -u +%FT%TZ) ok $(du -h "$DIR/cockpit-$STAMP.dump" | cut -f1)" >> "$DIR/history.log"
`;

const service = `[Unit]
Description=Dump the cockpit database
After=postgresql.service

[Service]
Type=oneshot
User=root
ExecStart=/usr/local/bin/cockpit-backup.sh
TimeoutStartSec=1800
`;

const timer = `[Unit]
Description=Nightly cockpit database dump

[Timer]
OnCalendar=*-*-* 01:40:00
Persistent=true

[Install]
WantedBy=timers.target
`;

const commands = [
  'set -e',
  `cat > /usr/local/bin/cockpit-backup.sh <<'SCRIPT'\n${script}SCRIPT`,
  'chmod 700 /usr/local/bin/cockpit-backup.sh',
  `cat > /etc/systemd/system/cockpit-backup.service <<'UNIT'\n${service}UNIT`,
  `cat > /etc/systemd/system/cockpit-backup.timer <<'UNIT'\n${timer}UNIT`,
  'systemctl daemon-reload',
  'systemctl enable --now cockpit-backup.timer',
  // Take one now, so there is a copy before anyone relies on the schedule.
  'systemctl start cockpit-backup.service',
  'ls -lh /var/backups/cockpit/',
  'cat /var/backups/cockpit/history.log',
  'systemctl list-timers cockpit-backup.timer --no-pager | head -2',
];

const ssm = new SSMClient({ region: REGION });
const sent = await ssm.send(
  new SendCommandCommand({
    InstanceIds: [INSTANCE],
    DocumentName: 'AWS-RunShellScript',
    Parameters: { commands, executionTimeout: ['1800'] },
    TimeoutSeconds: 1800,
  }),
);

for (let i = 0; i < 400; i += 1) {
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
