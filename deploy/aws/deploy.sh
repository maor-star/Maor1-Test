#!/usr/bin/env bash
# פריסת אפליקציית ניהול המשרד ל-AWS EC2.
# רץ מהמחשב שלך (מק/לינוקס), לא על השרת.
#
#   bash deploy/aws/deploy.sh
#
# הסקריפט יוצר: Security Group, מפתח SSH, מכונת EC2, וכתובת IP קבועה (Elastic IP).
# אחר כך מעלה את האפליקציה ומריץ עליה את provision.sh.
# הרצה חוזרת מעדכנת את האפליקציה על המכונה הקיימת ולא יוצרת מכונה חדשה.

set -euo pipefail

# ---------------------------------------------------------------------------
# הגדרות — שנה כאן אם צריך
# ---------------------------------------------------------------------------
REGION="${AWS_REGION:-eu-central-1}"   # פרנקפורט. השהיה נמוכה יחסית מישראל, אזור ותיק.
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.micro}"
PROJECT="office-app"
KEY_NAME="${PROJECT}-key"
KEY_FILE="${HOME}/.ssh/${KEY_NAME}.pem"
SG_NAME="${PROJECT}-sg"
DOMAIN="${DOMAIN:-}"                   # לדוגמה: maor-office.duckdns.org. ריק = גישה ב-HTTP לפי IP בלבד.
APP_USER="${APP_USER:-office}"         # שם משתמש לכניסה לאפליקציה
APP_PASSWORD="${APP_PASSWORD:-}"       # ריק = ייווצר אוטומטית ויודפס בסוף
# ---------------------------------------------------------------------------

say() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# ---- 0. בדיקות מקדימות ----
say "בדיקות מקדימות"
command -v aws >/dev/null || die "AWS CLI לא מותקן. הרץ: brew install awscli"
aws sts get-caller-identity --output text >/dev/null 2>&1 \
  || die "AWS CLI לא מאומת. הרץ: aws configure"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
CALLER="$(aws sts get-caller-identity --query Arn --output text)"
echo "    חשבון: $ACCOUNT"
echo "    זהות:  $CALLER"
echo "    אזור:  $REGION"

[ -f server.js ] && [ -f package.json ] || die "לא נמצאו server.js / package.json. הרץ מתוך תיקיית הריפו."

MY_IP="$(curl -s --max-time 10 https://checkip.amazonaws.com || true)"
[ -n "$MY_IP" ] || die "לא הצלחתי לזהות את כתובת ה-IP שלך. בדוק חיבור אינטרנט."
echo "    ה-IP שלך: $MY_IP (יורשה ל-SSH בלבד)"

if [ -z "$APP_PASSWORD" ]; then
  APP_PASSWORD="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)"
  GENERATED_PASSWORD=1
fi

# ---- 1. מפתח SSH ----
say "מפתח SSH"
if aws ec2 describe-key-pairs --region "$REGION" --key-names "$KEY_NAME" >/dev/null 2>&1; then
  echo "    כבר קיים: $KEY_NAME"
  [ -f "$KEY_FILE" ] || die "המפתח $KEY_NAME קיים ב-AWS אבל הקובץ $KEY_FILE חסר. מחק את המפתח ב-AWS והרץ שוב, או שחזר את הקובץ."
else
  mkdir -p "$(dirname "$KEY_FILE")"
  aws ec2 create-key-pair --region "$REGION" --key-name "$KEY_NAME" \
    --query KeyMaterial --output text > "$KEY_FILE"
  chmod 400 "$KEY_FILE"
  echo "    נוצר ונשמר: $KEY_FILE"
fi

# ---- 2. Security Group ----
say "Security Group"
VPC_ID="$(aws ec2 describe-vpcs --region "$REGION" \
  --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
[ "$VPC_ID" != "None" ] || die "לא נמצא VPC ברירת מחדל באזור $REGION."

SG_ID="$(aws ec2 describe-security-groups --region "$REGION" \
  --filters "Name=group-name,Values=$SG_NAME" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo None)"

if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  SG_ID="$(aws ec2 create-security-group --region "$REGION" \
    --group-name "$SG_NAME" --description "office-app" --vpc-id "$VPC_ID" \
    --query GroupId --output text)"
  aws ec2 create-tags --region "$REGION" --resources "$SG_ID" --tags "Key=Project,Value=$PROJECT"
  echo "    נוצר: $SG_ID"
else
  echo "    כבר קיים: $SG_ID"
fi

# 80 ו-443 פתוחים לכולם — נדרש כדי ש-Let's Encrypt יוכל לאמת את הדומיין.
# ההגנה על האפליקציה עצמה היא הסיסמה ב-Caddy, לא חסימת פורטים.
for PORT in 80 443; do
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
    --protocol tcp --port "$PORT" --cidr 0.0.0.0/0 >/dev/null 2>&1 || true
done
# SSH רק מהכתובת שלך
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
  --protocol tcp --port 22 --cidr "${MY_IP}/32" >/dev/null 2>&1 || true
echo "    פורטים: 80/443 לכולם, 22 רק מ-${MY_IP}"

# ---- 3. מכונה ----
say "מכונת EC2"
INSTANCE_ID="$(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Project,Values=$PROJECT" "Name=instance-state-name,Values=running,pending" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || echo None)"

if [ "$INSTANCE_ID" = "None" ] || [ -z "$INSTANCE_ID" ]; then
  # Debian 12, אותה מערכת הפעלה כמו בהוראות ל-Google Cloud
  AMI_ID="$(aws ec2 describe-images --region "$REGION" --owners 136693071363 \
    --filters 'Name=name,Values=debian-12-amd64-*' 'Name=state,Values=available' \
    --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text)"
  [ "$AMI_ID" != "None" ] || die "לא נמצאה תמונת Debian 12 באזור $REGION."
  echo "    AMI: $AMI_ID"

  INSTANCE_ID="$(aws ec2 run-instances --region "$REGION" \
    --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" --security-group-ids "$SG_ID" \
    --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=20,VolumeType=gp3,DeleteOnTermination=true}' \
    --tag-specifications \
      "ResourceType=instance,Tags=[{Key=Project,Value=$PROJECT},{Key=Name,Value=$PROJECT}]" \
    --query 'Instances[0].InstanceId' --output text)"
  echo "    נוצרה: $INSTANCE_ID — ממתין להפעלה..."
  aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"
else
  echo "    כבר קיימת: $INSTANCE_ID (עדכון בלבד, לא נוצרת מכונה חדשה)"
fi

# ---- 4. כתובת IP קבועה ----
say "כתובת IP קבועה"
ALLOC_ID="$(aws ec2 describe-addresses --region "$REGION" \
  --filters "Name=tag:Project,Values=$PROJECT" \
  --query 'Addresses[0].AllocationId' --output text 2>/dev/null || echo None)"

if [ "$ALLOC_ID" = "None" ] || [ -z "$ALLOC_ID" ]; then
  ALLOC_ID="$(aws ec2 allocate-address --region "$REGION" --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Project,Value=$PROJECT}]" \
    --query AllocationId --output text)"
  echo "    הוקצתה: $ALLOC_ID"
fi
aws ec2 associate-address --region "$REGION" \
  --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" >/dev/null
IP="$(aws ec2 describe-addresses --region "$REGION" --allocation-ids "$ALLOC_ID" \
  --query 'Addresses[0].PublicIp' --output text)"
echo "    כתובת: $IP"

# ---- 5. המתנה ל-SSH ----
say "ממתין ל-SSH (עד 3 דקות)"
SSH_OPTS=(-i "$KEY_FILE" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
          -o LogLevel=ERROR -o ConnectTimeout=10)
for i in $(seq 1 36); do
  if ssh "${SSH_OPTS[@]}" "admin@$IP" true 2>/dev/null; then
    echo "    מחובר."
    break
  fi
  [ "$i" -lt 36 ] || die "אין תגובה ב-SSH מ-$IP. בדוק ש-$MY_IP עדיין ה-IP שלך (ייתכן שהשתנה)."
  sleep 5
done

# ---- 6. העלאת האפליקציה ----
say "מעלה את האפליקציה"
# נשלחים רק קבצי האפליקציה. data/ לא נכלל בכוונה, כדי שהרצה חוזרת
# לא תדרוס את בסיס הנתונים החי שעל השרת.
tar czf - ./server.js ./db.js ./package.json ./package-lock.json ./public \
  | ssh "${SSH_OPTS[@]}" "admin@$IP" \
      'sudo mkdir -p /opt/office-app && sudo tar xzf - -C /opt/office-app'
scp "${SSH_OPTS[@]}" deploy/aws/provision.sh "admin@$IP:/tmp/provision.sh"
echo "    הועלה."

# ---- 7. התקנה על השרת ----
say "מתקין על השרת (כמה דקות בפעם הראשונה)"
ssh "${SSH_OPTS[@]}" "admin@$IP" \
  "sudo DOMAIN='$DOMAIN' APP_USER='$APP_USER' APP_PASSWORD='$APP_PASSWORD' bash /tmp/provision.sh"

# ---- 8. סיכום ----
say "הפריסה הסתיימה"
echo
if [ -n "$DOMAIN" ]; then
  echo "    כתובת:  https://$DOMAIN"
  echo
  echo "    ⚠ אם עוד לא כיוונת את הדומיין — היכנס ל-duckdns.org (או לספק ה-DNS שלך)"
  echo "      והצבע את $DOMAIN לכתובת $IP."
  echo "      Caddy ינסה שוב להנפיק תעודת SSL אוטומטית תוך כמה דקות."
else
  echo "    כתובת:  http://$IP"
  echo
  echo "    ⚠ אין דומיין, ולכן אין HTTPS — הסיסמה והנתונים עוברים בטקסט גלוי."
  echo "      להוספת HTTPS: צור שם חינמי ב-duckdns.org שמצביע ל-$IP, ואז הרץ שוב עם"
  echo "      DOMAIN=your-name.duckdns.org bash deploy/aws/deploy.sh"
fi
echo
echo "    משתמש:  $APP_USER"
echo "    סיסמה:  $APP_PASSWORD"
[ -n "${GENERATED_PASSWORD:-}" ] && echo "    (נוצרה אוטומטית — שמור אותה, היא לא נשמרת בשום מקום)"
echo
echo "    התחברות לשרת:  ssh -i $KEY_FILE admin@$IP"
echo "    לוגים:          ssh -i $KEY_FILE admin@$IP 'sudo journalctl -u office-app -f'"
echo "    מחיקת הכול:     bash deploy/aws/teardown.sh"
echo
