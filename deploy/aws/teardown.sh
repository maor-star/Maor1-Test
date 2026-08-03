#!/usr/bin/env bash
# מחיקת כל משאבי ה-AWS של האפליקציה (מרוקן את ה-bucket ומוחק את ה-stack).
set -euo pipefail
STACK="${STACK:-home-management}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"

BUCKET="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text 2>/dev/null || true)"

if [ -n "${BUCKET:-}" ] && [ "$BUCKET" != "None" ]; then
  echo "🧹 מרוקן את s3://$BUCKET"
  aws s3 rm "s3://$BUCKET" --recursive --region "$REGION" || true
fi

echo "🗑️  מוחק את ה-stack: $STACK"
aws cloudformation delete-stack --stack-name "$STACK" --region "$REGION"
aws cloudformation wait stack-delete-complete --stack-name "$STACK" --region "$REGION" || true
echo "✅ נמחק."
