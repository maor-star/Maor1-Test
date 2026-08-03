#!/usr/bin/env bash
# פריסת "ניהול הבית" ל-AWS: CloudFormation (S3 + CloudFront) ואז העלאת האפליקציה.
# דרישות: AWS CLI מותקן ומוגדר (aws configure) עם הרשאות ל-CloudFormation/S3/CloudFront.
#
# שימוש:
#   bash deploy/aws/deploy.sh
# משתני סביבה אופציונליים:
#   STACK=home-management   שם ה-stack
#   AWS_REGION=us-east-1     אזור
set -euo pipefail

STACK="${STACK:-home-management}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/../../web/index.html"
TEMPLATE="$DIR/cloudformation.yaml"

command -v aws >/dev/null || { echo "❌ AWS CLI לא מותקן. ראו https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"; exit 1; }
[ -f "$SRC" ] || { echo "❌ הקובץ $SRC לא נמצא"; exit 1; }

echo "🔐 בודק זהות AWS…"
aws sts get-caller-identity --output table || { echo "❌ אין הרשאות AWS תקינות. הריצו 'aws configure' עם Access Key אמיתי."; exit 1; }

echo "☁️  פורס/מעדכן CloudFormation stack: $STACK  (region: $REGION)"
aws cloudformation deploy \
  --stack-name "$STACK" \
  --template-file "$TEMPLATE" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$REGION"

get_out() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
BUCKET="$(get_out BucketName)"
DIST="$(get_out DistributionId)"
URL="$(get_out URL)"

echo "⬆️  מעלה את האפליקציה ל-s3://$BUCKET/index.html"
aws s3 cp "$SRC" "s3://$BUCKET/index.html" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "no-cache, max-age=0" \
  --region "$REGION"

echo "♻️  מרוקן את מטמון ה-CloudFront"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" \
  --query 'Invalidation.Id' --output text >/dev/null

echo ""
echo "✅ הפריסה הושלמה! האפליקציה חיה בכתובת:"
echo "   $URL"
echo ""
echo "ℹ️  ל-CloudFront לוקח 5–15 דקות בפריסה ראשונה עד שהכתובת פעילה במלואה."
echo "   לעדכון עתידי (אחרי שינוי ב-web/index.html): הריצו שוב את הסקריפט הזה."
