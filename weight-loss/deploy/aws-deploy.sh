#!/usr/bin/env bash
#
# פריסת "הדרך הקלה לירידה במשקל" ל-AWS כ-CloudFormation stack חדש.
#
#     bash deploy/aws-deploy.sh                       # HTTP בלבד, על כתובת IP
#     DOMAIN=app.example.com bash deploy/aws-deploy.sh # HTTPS אוטומטי
#
# דרוש: AWS CLI מוגדר עם הרשאות ל-CloudFormation, EC2 ו-IAM.

set -euo pipefail

STACK="${STACK:-easy-weight-loss}"
REGION="${REGION:-${AWS_REGION:-eu-central-1}}"
DOMAIN="${DOMAIN:-}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.micro}"
BRANCH="${BRANCH:-claude/build-website-1sxtoe}"
TEMPLATE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/aws-cloudformation.yaml"

command -v aws >/dev/null || { echo "✖ AWS CLI לא מותקן" >&2; exit 1; }

echo "▶ stack:    $STACK"
echo "▶ region:   $REGION"
echo "▶ instance: $INSTANCE_TYPE"
echo "▶ domain:   ${DOMAIN:-<ללא — HTTP בלבד>}"
echo

if ! aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1; then
  echo "✖ אין קרדנציאלס תקפים ל-AWS. הרץ 'aws configure' תחילה." >&2
  exit 1
fi

if aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" >/dev/null 2>&1; then
  echo "✖ כבר קיים stack בשם '$STACK' באזור $REGION." >&2
  echo "  לפריסה חדשה: STACK=<שם-אחר> bash deploy/aws-deploy.sh" >&2
  echo "  למחיקת הקיים: aws cloudformation delete-stack --stack-name $STACK --region $REGION" >&2
  exit 1
fi

echo "▶ יוצר stack — לוקח בערך 5 דקות (ה-stack מסתיים רק כשהאפליקציה עונה)..."
aws cloudformation create-stack \
  --stack-name "$STACK" \
  --region "$REGION" \
  --template-body "file://$TEMPLATE" \
  --capabilities CAPABILITY_IAM \
  --on-failure DELETE \
  --parameters \
    "ParameterKey=DomainName,ParameterValue=$DOMAIN" \
    "ParameterKey=InstanceType,ParameterValue=$INSTANCE_TYPE" \
    "ParameterKey=RepoBranch,ParameterValue=$BRANCH" \
  >/dev/null

aws cloudformation wait stack-create-complete --stack-name "$STACK" --region "$REGION"

echo
echo "───────────────────────────────────────────────"
aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query 'Stacks[0].Outputs[].{מפתח:OutputKey,ערך:OutputValue}' --output table
echo "───────────────────────────────────────────────"

if [ -n "$DOMAIN" ]; then
  echo "כדי שה-HTTPS יונפק, ודא שרשומת ה-A של $DOMAIN מצביעה לכתובת שלמעלה."
  echo "התעודה מונפקת אוטומטית תוך כדקה מרגע שה-DNS מתעדכן."
else
  echo "האתר מוגש ב-HTTP בלבד. להצפנה: מחק את ה-stack והרץ שוב עם DOMAIN=..."
fi
echo
echo "מחיקה מלאה (כולל השרת והנתונים):"
echo "  aws cloudformation delete-stack --stack-name $STACK --region $REGION"
