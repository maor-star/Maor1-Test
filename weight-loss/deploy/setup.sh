#!/usr/bin/env bash
#
# סקריפט התקנה לאפליקציית "הדרך הקלה לרדת במשקל" על שרת (Debian/Ubuntu).
# מריצים אותו פעם אחת על השרת, מתוך תיקיית weight-loss, עם הרשאות root:
#
#     sudo bash deploy/setup.sh
#
# הסקריפט: מתקין Node.js אם חסר, מתקין תלויות, מייצר SESSION_SECRET אקראי,
# ומגדיר שירות systemd שמריץ את האפליקציה אוטומטית (כולל הרמה מחדש אחרי אתחול או קריסה).

set -euo pipefail

PORT="${PORT:-80}"
NODE_MAJOR="${NODE_MAJOR:-20}"
SERVICE_NAME="easy-weight-loss"
APP_TZ="${APP_TZ:-Asia/Jerusalem}"

# תיקיית האפליקציה = תיקיית האב של deploy/
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(whoami)}"
ENV_FILE="/etc/${SERVICE_NAME}.env"

echo "▶ תיקיית אפליקציה: $APP_DIR"
echo "▶ משתמש הרצה:      $RUN_USER"
echo "▶ פורט:            $PORT"

if [ "$(id -u)" -ne 0 ]; then
  echo "✖ צריך להריץ עם sudo (root). נסה: sudo bash deploy/setup.sh" >&2
  exit 1
fi

# ---- Node.js ----
if ! command -v node >/dev/null 2>&1; then
  echo "▶ מתקין Node.js ${NODE_MAJOR}.x ..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
else
  echo "▶ Node.js כבר מותקן: $(node -v)"
fi

# כלי בנייה עבור better-sqlite3 (למקרה שאין binary מוכן)
apt-get install -y python3 make g++ >/dev/null 2>&1 || true

# ---- תלויות האפליקציה ----
echo "▶ מתקין תלויות (npm install) ..."
cd "$APP_DIR"
sudo -u "$RUN_USER" npm install --omit=dev

mkdir -p "$APP_DIR/data"
chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR/data"

# ---- סודות ----
# נוצרים פעם אחת ונשמרים מחוץ ל-git. מחיקת הקובץ תנתק את כל המשתמשים המחוברים.
if [ ! -f "$ENV_FILE" ]; then
  echo "▶ מייצר סודות ב-$ENV_FILE ..."
  ADMIN_PASSWORD="$(head -c 12 /dev/urandom | base64 | tr -d '/+=' | head -c 14)"
  cat > "$ENV_FILE" <<ENV
SESSION_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '/+=')
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@easyweightloss.local}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_NAME=${ADMIN_NAME:-המאמן}
ENV
  chmod 600 "$ENV_FILE"
  NEW_ADMIN=1
else
  echo "▶ קובץ הסודות כבר קיים: $ENV_FILE"
  NEW_ADMIN=0
fi

# ---- שירות systemd ----
echo "▶ מגדיר שירות systemd: $SERVICE_NAME ..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=Easy Weight Loss App
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
Environment=PORT=${PORT}
Environment=NODE_ENV=production
Environment=APP_TZ=${APP_TZ}
ExecStart=/usr/bin/node ${APP_DIR}/server.js
Restart=always
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

sleep 2
echo ""
echo "───────────────────────────────────────────────"
if systemctl is-active --quiet "$SERVICE_NAME"; then
  IP="$(curl -s -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip 2>/dev/null || echo '<כתובת-ה-IP-החיצונית>')"
  echo "✔ האפליקציה רצה!  גש אליה בדפדפן:"
  echo "    http://${IP}$([ "$PORT" = 80 ] && echo '' || echo ":$PORT")"
  if [ "$NEW_ADMIN" = 1 ]; then
    echo ""
    echo "פרטי ההתחברות של המנהל (נשמרים ב-$ENV_FILE):"
    grep -E '^ADMIN_(EMAIL|PASSWORD)=' "$ENV_FILE" | sed 's/^/    /'
    echo "מומלץ להחליף סיסמה מיד אחרי ההתחברות הראשונה (מסך \"החשבון שלי\")."
  fi
else
  echo "✖ השירות לא עלה. בדוק לוגים:  sudo journalctl -u ${SERVICE_NAME} -n 50"
fi
echo "───────────────────────────────────────────────"
echo "פקודות שימושיות:"
echo "  סטטוס:   sudo systemctl status ${SERVICE_NAME}"
echo "  לוגים:   sudo journalctl -u ${SERVICE_NAME} -f"
echo "  הפעלה:   sudo systemctl restart ${SERVICE_NAME}"
