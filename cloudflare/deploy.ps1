# פריסת אפליקציית ניהול המשרד ל-Cloudflare Workers + D1, מ-Windows PowerShell.
#
#   powershell -ExecutionPolicy Bypass -File .\deploy.ps1
#
# בטוח להרצה חוזרת: מזהה בסיס נתונים קיים ולא יוצר כפילות, ולא דורס נתונים.

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Say  { param($m) Write-Host "`n▶ $m" -ForegroundColor Cyan }
function Ok   { param($m) Write-Host "  $m" -ForegroundColor Green }
function Warn { param($m) Write-Host "  $m" -ForegroundColor Yellow }
function Die  { param($m) Write-Host "`n✖ $m" -ForegroundColor Red; exit 1 }

$DB_NAME = 'office-app-db'

# ---- 0. בדיקות מקדימות ----
Say 'בדיקות מקדימות'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die 'Node.js לא מותקן. התקן מ-https://nodejs.org' }
if (-not (Get-Command npm  -ErrorAction SilentlyContinue)) { Die 'npm לא נמצא.' }
$nodeMajor = ((node -v) -replace '^v','').Split('.')[0] -as [int]
if ($nodeMajor -lt 18) { Die "נדרש Node 18 ומעלה. מותקן: $(node -v)" }
Ok "Node $(node -v)"

# ---- 1. תלויות ----
Say 'מתקין תלויות'
npm install --no-audit --no-fund | Out-Null
if ($LASTEXITCODE -ne 0) { Die 'npm install נכשל.' }
Ok 'הותקנו'

# ---- 2. התחברות ל-Cloudflare ----
Say 'בודק התחברות ל-Cloudflare'
$who = (& npx wrangler whoami 2>&1 | Out-String)
if ($who -match 'not authenticated|You are not logged in|Not logged in') {
  Warn 'לא מחובר. נפתח דפדפן לאישור — אשר שם וחזור לחלון הזה.'
  & npx wrangler login
  if ($LASTEXITCODE -ne 0) { Die 'ההתחברות נכשלה.' }
  $who = (& npx wrangler whoami 2>&1 | Out-String)
}
$email = [regex]::Match($who, '[\w\.\-\+]+@[\w\.\-]+').Value
if ($email) { Ok "מחובר כ-$email" } else { Ok 'מחובר' }

# ---- 3. בסיס נתונים ----
Say "בסיס נתונים D1 ($DB_NAME)"
$uuidRx = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
$dbId = ''

$list = (& npx wrangler d1 list --json 2>&1 | Out-String)
try {
  $parsed = $list | ConvertFrom-Json
  $hit = $parsed | Where-Object { $_.name -eq $DB_NAME } | Select-Object -First 1
  if ($hit) { $dbId = $hit.uuid }
} catch { }

if ($dbId) {
  Ok "כבר קיים: $dbId"
} else {
  $created = (& npx wrangler d1 create $DB_NAME 2>&1 | Out-String)
  $dbId = [regex]::Match($created, $uuidRx).Value
  if (-not $dbId) {
    Write-Host $created
    Die 'לא הצלחתי לחלץ את מזהה בסיס הנתונים. העתק אותו מהפלט למעלה אל wrangler.jsonc ידנית, והרץ שוב.'
  }
  Ok "נוצר: $dbId"
}

# ---- 4. עדכון הקונפיג ----
Say 'מעדכן את wrangler.jsonc'
$cfgPath = Join-Path $PSScriptRoot 'wrangler.jsonc'
$cfg = Get-Content $cfgPath -Raw
if ($cfg -match 'REPLACE_AFTER_db:create') {
  ($cfg -replace 'REPLACE_AFTER_db:create', $dbId) | Set-Content $cfgPath -NoNewline -Encoding UTF8
  Ok 'המזהה הוזן'
  Warn 'הקובץ שונה מקומית. כדאי לעשות לו commit כדי שהפריסה הבאה תדלג על השלב הזה.'
} elseif ($cfg -match [regex]::Escape($dbId)) {
  Ok 'כבר מעודכן'
} else {
  Warn 'הקונפיג מכיל מזהה אחר מזה שנמצא. לא נגעתי בו — בדוק ידנית אם זה מכוון.'
}

# ---- 5. סכימה ----
Say 'מחיל את הסכימה'
& npx wrangler d1 execute $DB_NAME --remote --file=./schema.sql --yes | Out-Null
if ($LASTEXITCODE -ne 0) { Die 'החלת הסכימה נכשלה.' }
Ok 'הוחלה (CREATE TABLE IF NOT EXISTS — נתונים קיימים לא נפגעים)'

# ---- 6. סיסמה ----
Say 'מגדיר שם משתמש וסיסמה'
$appUser = if ($env:APP_USER) { $env:APP_USER } else { 'office' }
if ($env:APP_PASSWORD) {
  $appPass = $env:APP_PASSWORD
  $generated = $false
} else {
  $chars = (48..57) + (65..90) + (97..122)
  $appPass = -join ($chars | Get-Random -Count 20 | ForEach-Object { [char]$_ })
  $generated = $true
}

Write-Output $appUser | & npx wrangler secret put APP_USER     | Out-Null
Write-Output $appPass | & npx wrangler secret put APP_PASSWORD | Out-Null
Ok 'נשמרו כסודות מוצפנים ב-Cloudflare'

# ---- 7. פריסה ----
Say 'פורס'
$deployOut = (& npx wrangler deploy 2>&1 | Out-String)
Write-Host $deployOut
if ($LASTEXITCODE -ne 0) { Die 'הפריסה נכשלה. הפלט למעלה.' }

$url = [regex]::Match($deployOut, 'https://[^\s]+\.workers\.dev').Value

# ---- 8. סיכום ----
Write-Host ''
Write-Host '════════════════════════════════════════════' -ForegroundColor Green
Write-Host ' הפריסה הסתיימה' -ForegroundColor Green
Write-Host '════════════════════════════════════════════' -ForegroundColor Green
if ($url) { Write-Host "  כתובת:  $url" } else { Write-Host '  כתובת:  ראה בפלט למעלה' }
Write-Host "  משתמש:  $appUser"
Write-Host "  סיסמה:  $appPass"
if ($generated) { Write-Host '  (הסיסמה נוצרה אוטומטית ולא נשמרת בשום מקום אחר — העתק אותה עכשיו)' -ForegroundColor Yellow }
Write-Host ''
Write-Host '  לשינוי הסיסמה:  $env:APP_PASSWORD="..."; powershell -ExecutionPolicy Bypass -File .\deploy.ps1'
Write-Host '  לוגים חיים:      npx wrangler tail'
Write-Host '  גיבוי:           npx wrangler d1 export office-app-db --remote --output backup.sql'
Write-Host ''
