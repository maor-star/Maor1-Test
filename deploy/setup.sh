#!/usr/bin/env bash
#
# סקריפט התקנה לאפליקציית ניהול משרד על שרת Google Compute Engine (Debian/Ubuntu).
# מריצים אותו פעם אחת על השרת, מתוך תיקיית הפרויקט, עם הרשאות root:
#
#     sudo bash deploy/setup.sh
#
# הסקריפט: מתקין Node.js אם חסר, מתקין תלויות, ומגדיר שירות systemd
# שמריץ את האפליקציה אוטומטית (כולל הרמה מחדש אחרי אתחול או קריסה).

set -euo pipefail

PORT="${PORT:-80}"
NODE_MAJOR="${NODE_MAJOR:-20}"
SERVICE_NAME="office-app"

# תיקיית האפליקציה = תיקיית האב של deploy/
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# המשתמש שיריץ את השירות (מי שהריץ עם sudo, ולא root)
RUN_USER="${SUDO_USER:-$(whoami)}"

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

# ודא שתיקיית הנתונים קיימת ובבעלות המשתמש הנכון
mkdir -p "$APP_DIR/data"
chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR/data"

# ---- שירות systemd ----
echo "▶ מגדיר שירות systemd: $SERVICE_NAME ..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=Office Management App
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}
Environment=PORT=${PORT}
Environment=NODE_ENV=production
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
  echo "    http://${IP}${PORT:+$([ "$PORT" = 80 ] && echo '' || echo ":$PORT")}"
else
  echo "✖ השירות לא עלה. בדוק לוגים:  sudo journalctl -u ${SERVICE_NAME} -n 50"
fi
echo "───────────────────────────────────────────────"
echo "פקודות שימושיות:"
echo "  סטטוס:   sudo systemctl status ${SERVICE_NAME}"
echo "  לוגים:   sudo journalctl -u ${SERVICE_NAME} -f"
echo "  הפעלה:   sudo systemctl restart ${SERVICE_NAME}"
