#!/usr/bin/env bash
# מחיקת כל משאבי AWS שנוצרו על ידי deploy.sh.
#
#   bash deploy/aws/teardown.sh
#
# ⚠ מוחק את המכונה ואיתה את בסיס הנתונים. גבה קודם:
#   ssh -i ~/.ssh/office-app-key.pem admin@<IP> 'sudo cat /opt/office-app/data/office.db' > office-backup.db

set -euo pipefail

REGION="${AWS_REGION:-eu-central-1}"
PROJECT="office-app"
KEY_NAME="${PROJECT}-key"
SG_NAME="${PROJECT}-sg"

say() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

command -v aws >/dev/null || { echo "AWS CLI לא מותקן."; exit 1; }

say "מה עומד להימחק (אזור $REGION)"
aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Project,Values=$PROJECT" "Name=instance-state-name,Values=running,stopped,pending" \
  --query 'Reservations[].Instances[].[InstanceId,InstanceType,PublicIpAddress]' --output table 2>/dev/null || true

echo
printf 'למחוק את הכול, כולל בסיס הנתונים? הקלד DELETE כדי לאשר: '
read -r CONFIRM
[ "$CONFIRM" = "DELETE" ] || { echo "בוטל."; exit 0; }

# ---- מכונות ----
say "מוחק מכונות"
IDS="$(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Project,Values=$PROJECT" "Name=instance-state-name,Values=running,stopped,pending" \
  --query 'Reservations[].Instances[].InstanceId' --output text)"
if [ -n "$IDS" ]; then
  # shellcheck disable=SC2086
  aws ec2 terminate-instances --region "$REGION" --instance-ids $IDS >/dev/null
  echo "    ממתין לסיום..."
  # shellcheck disable=SC2086
  aws ec2 wait instance-terminated --region "$REGION" --instance-ids $IDS
  echo "    נמחקו: $IDS"
else
  echo "    אין מכונות."
fi

# ---- Elastic IP ----
say "משחרר כתובות IP"
for ALLOC in $(aws ec2 describe-addresses --region "$REGION" \
  --filters "Name=tag:Project,Values=$PROJECT" \
  --query 'Addresses[].AllocationId' --output text); do
  aws ec2 release-address --region "$REGION" --allocation-id "$ALLOC" && echo "    שוחרר: $ALLOC"
done

# ---- Security Group ----
say "מוחק Security Group"
SG_ID="$(aws ec2 describe-security-groups --region "$REGION" \
  --filters "Name=group-name,Values=$SG_NAME" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo None)"
if [ "$SG_ID" != "None" ] && [ -n "$SG_ID" ]; then
  # לפעמים לוקח רגע עד שה-ENI של המכונה משתחרר
  for i in $(seq 1 12); do
    if aws ec2 delete-security-group --region "$REGION" --group-id "$SG_ID" 2>/dev/null; then
      echo "    נמחק: $SG_ID"; break
    fi
    [ "$i" -lt 12 ] || echo "    ⚠ לא הצלחתי למחוק את $SG_ID — נסה שוב בעוד דקה."
    sleep 5
  done
else
  echo "    אין Security Group."
fi

# ---- מפתח ----
say "מוחק מפתח SSH"
aws ec2 delete-key-pair --region "$REGION" --key-name "$KEY_NAME" 2>/dev/null \
  && echo "    נמחק מ-AWS: $KEY_NAME" || echo "    לא קיים ב-AWS."
echo "    הקובץ המקומי ~/.ssh/${KEY_NAME}.pem נשאר — מחק ידנית אם תרצה."

say "הסתיים"
