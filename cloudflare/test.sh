set -u
B="http://127.0.0.1:8787"
A=(-u office:test-local-pw)
pass=0; fail=0
chk() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; pass=$((pass+1))
  else echo "  ✗ $1 — expected [$2] got [$3]"; fail=$((fail+1)); fi
}

echo "== אימות =="
chk "ללא סיסמה → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' $B/api/employees)"
chk "סיסמה שגויה → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -u office:wrong $B/api/employees)"
chk "סיסמה נכונה → 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" $B/api/employees)"

echo "== עובדים =="
chk "רשימה ריקה" "[]" "$(curl -s "${A[@]}" $B/api/employees)"
EMP=$(curl -s "${A[@]}" -X POST $B/api/employees -H 'content-type: application/json' \
  -d '{"name":"דנה","role":"מפתחת","hourly_rate":120}')
EID=$(echo "$EMP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
chk "יצירה מחזירה שורה" "דנה" "$(echo "$EMP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["name"])')"
chk "hourly_rate נשמר" "120.0" "$(echo "$EMP" | python3 -c 'import sys,json;print(float(json.load(sys.stdin)["hourly_rate"]))')"
chk "שם ריק → 400" 400 "$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" -X POST $B/api/employees -H 'content-type: application/json' -d '{"name":"  "}')"
UPD=$(curl -s "${A[@]}" -X PUT $B/api/employees/$EID -H 'content-type: application/json' \
  -d '{"name":"דנה כהן","role":"מפתחת","hourly_rate":140}')
chk "עדכון" "דנה כהן" "$(echo "$UPD" | python3 -c 'import sys,json;print(json.load(sys.stdin)["name"])')"

echo "== שעות =="
curl -s "${A[@]}" -X POST $B/api/time-entries -H 'content-type: application/json' \
  -d "{\"employee_id\":$EID,\"work_date\":\"2026-08-10\",\"hours\":8,\"description\":\"פיתוח\"}" >/dev/null
TE=$(curl -s "${A[@]}" "$B/api/time-entries")
chk "JOIN מחזיר שם עובד" "דנה כהן" "$(echo "$TE" | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["employee_name"])')"
chk "עלות מחושבת 8*140" "1120.0" "$(echo "$TE" | python3 -c 'import sys,json;print(float(json.load(sys.stdin)[0]["cost"]))')"
chk "פילטר חודש תואם" 1 "$(curl -s "${A[@]}" "$B/api/time-entries?month=2026-08" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')"
chk "פילטר חודש אחר" 0 "$(curl -s "${A[@]}" "$B/api/time-entries?month=2026-07" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')"
chk "שעות שליליות → 400" 400 "$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" -X POST $B/api/time-entries -H 'content-type: application/json' -d "{\"employee_id\":$EID,\"work_date\":\"2026-08-10\",\"hours\":-1}")"

echo "== הוצאות והכנסות =="
curl -s "${A[@]}" -X POST $B/api/expenses -H 'content-type: application/json' \
  -d '{"expense_date":"2026-08-05","category":"ציוד","vendor":"ספק","amount":500}' >/dev/null
curl -s "${A[@]}" -X POST $B/api/expenses -H 'content-type: application/json' \
  -d '{"expense_date":"2026-08-06","amount":200}' >/dev/null
chk "קטגוריית ברירת מחדל" "אחר" "$(curl -s "${A[@]}" $B/api/expenses | python3 -c 'import sys,json;print([r for r in json.load(sys.stdin) if r["amount"]==200][0]["category"])')"
curl -s "${A[@]}" -X POST $B/api/income -H 'content-type: application/json' \
  -d '{"income_date":"2026-08-07","client":"לקוח","amount":9000}' >/dev/null
chk "הכנסה נוצרה" 1 "$(curl -s "${A[@]}" $B/api/income | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')"

echo "== דשבורד =="
D=$(curl -s "${A[@]}" $B/api/dashboard)
py() { echo "$D" | python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
chk "totalIncome" "9000.0" "$(py 'float(d["totalIncome"])')"
chk "totalExpenses" "700.0" "$(py 'float(d["totalExpenses"])')"
chk "laborCost" "1120.0" "$(py 'float(d["laborCost"])')"
chk "totalHours" "8.0" "$(py 'float(d["totalHours"])')"
chk "netProfit 9000-700-1120" "7180.0" "$(py 'float(d["netProfit"])')"
chk "byCategory שתי קטגוריות" 2 "$(py 'len(d["byCategory"])')"
chk "hoursByEmployee" 1 "$(py 'len(d["hoursByEmployee"])')"
chk "trend 6 חודשים" 6 "$(py 'len(d["trend"])')"

echo "== קבצים סטטיים ו-SPA =="
chk "/ מגיש HTML" 200 "$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" $B/)"
chk "/ ללא סיסמה → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' $B/)"
chk "styles.css" 200 "$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" $B/styles.css)"
chk "נתיב לא מוכר → index.html" 200 "$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" $B/some/spa/route)"

echo "== מחיקה ומחיקה מדורגת =="
chk "מחיקת עובד" '{"ok":true}' "$(curl -s "${A[@]}" -X DELETE $B/api/employees/$EID)"
chk "CASCADE מחק שעות" 0 "$(curl -s "${A[@]}" $B/api/time-entries | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')"

echo
echo "עברו: $pass | נכשלו: $fail"
