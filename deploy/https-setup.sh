#!/usr/bin/env bash
#
# הוספת HTTPS + כתובת יפה לאפליקציית ניהול המשרד, באמצעות Caddy.
# Caddy מנפיק אישור SSL (Let's Encrypt) אוטומטית ומחדש אותו לבד.
#
# שימוש (על השרת, עם root):
#
#     sudo bash deploy/https-setup.sh <הדומיין-שלך>
#     # לדוגמה:
#     sudo bash deploy/https-setup.sh maor-test.duckdns.org
#
# דרישה מוקדמת: הדומיין כבר מכוון (רשומת A) לכתובת ה-IP של השרת,
# ופורטים 80 ו-443 פתוחים ב-Firewall.

set -euo pipefail

DOMAIN="${1:-}"
APP_PORT="${APP_PORT:-3000}"
SERVICE_UNIT="/etc/systemd/system/office-app.service"

if [ -z "$DOMAIN" ]; then
  echo "✖ חסר דומיין. שימוש:  sudo bash deploy/https-setup.sh maor-test.duckdns.org" >&2
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "✖ צריך להריץ עם sudo (root)." >&2
  exit 1
fi

echo "▶ דומיין: $DOMAIN"
echo "▶ האפליקציה תאזין פנימית על פורט $APP_PORT, ו-Caddy יעביר אליה תעבורה מ-443/80."

# ---- 1. התקנת Caddy ----
if ! command -v caddy >/dev/null 2>&1; then
  echo "▶ מתקין Caddy ..."
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
else
  echo "▶ Caddy כבר מותקן: $(caddy version)"
fi

# ---- 2. העברת האפליקציה לפורט פנימי (כדי לפנות את 80/443 ל-Caddy) ----
if [ -f "$SERVICE_UNIT" ]; then
  echo "▶ מעדכן את שירות האפליקציה להאזין על פורט $APP_PORT ..."
  if grep -q '^Environment=PORT=' "$SERVICE_UNIT"; then
    sed -i "s/^Environment=PORT=.*/Environment=PORT=${APP_PORT}/" "$SERVICE_UNIT"
  else
    sed -i "/^\[Service\]/a Environment=PORT=${APP_PORT}" "$SERVICE_UNIT"
  fi
  systemctl daemon-reload
  systemctl restart office-app
else
  echo "⚠ לא נמצא $SERVICE_UNIT — ודא שהרצת קודם את deploy/setup.sh." >&2
fi

# ---- 3. הגדרת Caddy ----
echo "▶ כותב /etc/caddy/Caddyfile ..."
cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
    encode gzip
    reverse_proxy localhost:${APP_PORT}
}
CADDY

echo "▶ מפעיל מחדש את Caddy (הנפקת אישור SSL עשויה לקחת מספר שניות) ..."
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy

sleep 4
echo ""
echo "───────────────────────────────────────────────"
if systemctl is-active --quiet caddy; then
  echo "✔ מוכן! גש לאפליקציה בכתובת המאובטחת:"
  echo "    https://${DOMAIN}"
  echo ""
  echo "אם הדפדפן מציג שגיאת אישור, המתן דקה (Caddy עדיין מנפיק את ה-SSL)"
  echo "וודא שרשומת ה-A של הדומיין מצביעה על כתובת ה-IP של השרת."
else
  echo "✖ Caddy לא עלה. בדוק לוגים:  sudo journalctl -u caddy -n 50"
fi
echo "───────────────────────────────────────────────"
echo "לוגים חיים של Caddy:  sudo journalctl -u caddy -f"
