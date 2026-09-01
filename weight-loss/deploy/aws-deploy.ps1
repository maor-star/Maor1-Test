<#
.SYNOPSIS
    פריסת "הדרך הקלה לירידה במשקל" ל-AWS כ-CloudFormation stack חדש, מתוך PowerShell.

.DESCRIPTION
    גרסת PowerShell של deploy/aws-deploy.sh, לשימוש בווינדוס בלי Git Bash או WSL.
    אם התבנית אינה נמצאת לצד הסקריפט, היא נמשכת ישירות מ-GitHub — כך שאפשר
    להוריד את הקובץ הזה לבדו ולהריץ אותו.

    דרוש: AWS CLI מותקן ומוגדר (aws configure).

.EXAMPLE
    .\aws-deploy.ps1 -Domain app.example.com

.EXAMPLE
    .\aws-deploy.ps1 -Region eu-central-1 -InstanceType t3.small
#>

[CmdletBinding()]
param(
    [string]$Domain = '',
    [string]$Stack = 'easy-weight-loss',
    [string]$Region = $(if ($env:AWS_REGION) { $env:AWS_REGION } else { 'eu-central-1' }),
    [ValidateSet('t3.micro', 't3.small', 't3.medium', 't3.large')]
    [string]$InstanceType = 't3.micro',
    [string]$Branch = 'claude/build-website-1sxtoe'
)

$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$Text) Write-Host "* $Text" -ForegroundColor Cyan }
function Write-Fail { param([string]$Text) Write-Host "x $Text" -ForegroundColor Red }

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Fail 'AWS CLI is not installed. Get it from https://aws.amazon.com/cli/'
    exit 1
}

Write-Step "stack:    $Stack"
Write-Step "region:   $Region"
Write-Step "instance: $InstanceType"
Write-Step ("domain:   " + $(if ($Domain) { $Domain } else { '<none - HTTP only>' }))
Write-Host ''

# --- credentials ---
aws sts get-caller-identity --region $Region --output text 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Fail 'No valid AWS credentials. Run "aws configure" first.'
    exit 1
}

# --- refuse to touch an existing stack ---
aws cloudformation describe-stacks --stack-name $Stack --region $Region 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Fail "A stack named '$Stack' already exists in $Region."
    Write-Host "  For a new one:  .\aws-deploy.ps1 -Stack another-name"
    Write-Host "  To delete it:   aws cloudformation delete-stack --stack-name $Stack --region $Region"
    exit 1
}

# --- template: next to this script, or fetched from GitHub ---
$templatePath = Join-Path $PSScriptRoot 'aws-cloudformation.yaml'
if (-not (Test-Path $templatePath)) {
    $templatePath = Join-Path ([System.IO.Path]::GetTempPath()) 'ewl-aws-cloudformation.yaml'
    $url = "https://raw.githubusercontent.com/maor-star/Maor1-Test/$Branch/weight-loss/deploy/aws-cloudformation.yaml"
    Write-Step 'fetching the template from GitHub...'
    Invoke-WebRequest -Uri $url -OutFile $templatePath -UseBasicParsing
}

Write-Step 'creating the stack - about 5 minutes (it completes only once the app answers)...'
aws cloudformation create-stack `
    --stack-name $Stack `
    --region $Region `
    --template-body "file://$templatePath" `
    --capabilities CAPABILITY_IAM `
    --on-failure DELETE `
    --parameters "ParameterKey=DomainName,ParameterValue=$Domain" `
                 "ParameterKey=InstanceType,ParameterValue=$InstanceType" `
                 "ParameterKey=RepoBranch,ParameterValue=$Branch" `
    --output text | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Fail 'create-stack failed.'; exit 1 }

aws cloudformation wait stack-create-complete --stack-name $Stack --region $Region
if ($LASTEXITCODE -ne 0) {
    Write-Fail 'The stack did not finish successfully. Recent events:'
    aws cloudformation describe-stack-events --stack-name $Stack --region $Region `
        --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' `
        --output table
    exit 1
}

Write-Host ''
Write-Host ('-' * 60)
aws cloudformation describe-stacks --stack-name $Stack --region $Region `
    --query 'Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}' --output table
Write-Host ('-' * 60)

if ($Domain) {
    Write-Host "Point the A record for $Domain at the IP above; HTTPS is issued within a minute of DNS updating."
} else {
    Write-Host 'Served over plain HTTP. For TLS: delete the stack and rerun with -Domain <your-domain>.'
}
Write-Host ''
Write-Host "To remove everything (server and data):"
Write-Host "  aws cloudformation delete-stack --stack-name $Stack --region $Region"
