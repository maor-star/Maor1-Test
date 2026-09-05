<#
  פריסת "ניהול הבית" ל-AWS דרך PowerShell (S3 + CloudFront + CloudFormation).
  דרישות: AWS CLI מותקן ומוגדר (aws configure) עם הרשאות ל-CloudFormation/S3/CloudFront.

  שימוש:
    pwsh deploy/aws/deploy.ps1
    pwsh deploy/aws/deploy.ps1 -Stack home-management -Region us-east-1
#>
[CmdletBinding()]
param(
  [string]$Stack  = $(if ($env:STACK) { $env:STACK } else { "home-management" }),
  [string]$Region = $(if ($env:AWS_REGION) { $env:AWS_REGION } elseif ($env:AWS_DEFAULT_REGION) { $env:AWS_DEFAULT_REGION } else { "us-east-1" })
)

$ErrorActionPreference = "Stop"
$Dir      = Split-Path -Parent $MyInvocation.MyCommand.Path
$Src      = Join-Path $Dir "..\..\web\index.html"
$Template = Join-Path $Dir "cloudformation.yaml"

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  Write-Error "AWS CLI לא מותקן. ראו https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"; exit 1
}
if (-not (Test-Path $Src)) { Write-Error "הקובץ $Src לא נמצא"; exit 1 }

Write-Host "בודק זהות AWS..." -ForegroundColor Cyan
aws sts get-caller-identity --output table
if ($LASTEXITCODE -ne 0) { Write-Error "אין הרשאות AWS תקינות. הריצו 'aws configure' עם Access Key אמיתי."; exit 1 }

Write-Host "פורס/מעדכן CloudFormation stack: $Stack ($Region)" -ForegroundColor Cyan
aws cloudformation deploy --stack-name $Stack --template-file $Template --capabilities CAPABILITY_NAMED_IAM --region $Region
if ($LASTEXITCODE -ne 0) { Write-Error "פריסת ה-stack נכשלה"; exit 1 }

function Get-Output($key) {
  aws cloudformation describe-stacks --stack-name $Stack --region $Region `
    --query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue" --output text
}
$Bucket = Get-Output "BucketName"
$Dist   = Get-Output "DistributionId"
$Url    = Get-Output "URL"

Write-Host "מעלה את האפליקציה ל-s3://$Bucket/index.html" -ForegroundColor Cyan
aws s3 cp $Src "s3://$Bucket/index.html" --content-type "text/html; charset=utf-8" --cache-control "no-cache, max-age=0" --region $Region

Write-Host "מרוקן את מטמון ה-CloudFront" -ForegroundColor Cyan
aws cloudfront create-invalidation --distribution-id $Dist --paths "/*" --query "Invalidation.Id" --output text | Out-Null

Write-Host ""
Write-Host "✅ הפריסה הושלמה! האפליקציה חיה בכתובת:" -ForegroundColor Green
Write-Host "   $Url" -ForegroundColor Green
Write-Host ""
Write-Host "ל-CloudFront לוקח 5-15 דקות בפריסה ראשונה. לעדכון עתידי — הריצו שוב את הסקריפט." -ForegroundColor DarkGray
