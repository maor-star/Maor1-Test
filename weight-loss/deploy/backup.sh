#!/bin/bash
# Backs the live database off the instance.
#
# The reason this exists: the database sits on the instance's root volume, which is
# deleted with the instance. A CloudFormation update that touches UserData replaces
# the instance, and every account, weigh-in and uploaded photo goes with it. This
# runs on a timer and puts a consistent copy in S3, which outlives the machine.
set -euo pipefail

APP_DIR=/opt/easy-weight-loss/weight-loss
DB="$APP_DIR/data/weightloss.db"
BUCKET="${EWL_BACKUP_BUCKET:?EWL_BACKUP_BUCKET is not set}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# VACUUM INTO takes a consistent snapshot through SQLite itself while the app keeps
# serving, so it captures the WAL too. Copying the .db file alone would miss it.
sqlite3 "$DB" "VACUUM INTO '$WORK/weightloss.db'"

# Uploaded photos live beside the database and matter just as much.
cp -r "$APP_DIR/data/uploads" "$WORK/uploads" 2>/dev/null || mkdir -p "$WORK/uploads"

tar -czf "$WORK/backup.tar.gz" -C "$WORK" weightloss.db uploads
aws s3 cp "$WORK/backup.tar.gz" "s3://$BUCKET/backups/ewl-$STAMP.tar.gz" --only-show-errors
aws s3 cp "$WORK/backup.tar.gz" "s3://$BUCKET/backups/latest.tar.gz" --only-show-errors

USERS=$(sqlite3 "$DB" "SELECT COUNT(*) FROM profiles")
echo "backup ok: $STAMP, $(stat -c%s "$WORK/backup.tar.gz") bytes, $USERS accounts"
