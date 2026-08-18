#!/usr/bin/env bash
# רץ על השרת עצמו, מועלה ומופעל אוטומטית על ידי deploy.sh.
# לא להריץ ידנית מהמחשב.

set -euo pipefail

DOMAIN="${DOMAIN:-}"
APP_USER="${APP_USER:-office}"
APP_PASSWORD="${APP_PASSWORD:?APP_PASSWORD חסר}"
APP_DIR="/opt/office-app"
APP_PORT=3000
NODE_MAJOR=22

say() { printf '\n\033[1m  ▸ %s\033[0m\n' "$*"; }

export DEBIAN_FRONTEND=noninteractive

# ---- 1. חבילות בסיס ----
say "מתקין חבילות בסיס"
apt-get update -qq
# build-essential ו-python3 נדרשים ל-better-sqlite3 אם אין בינארי מוכן לגרסת ה-Node הזאת
apt-get install -y -qq curl ca-certificates gnupg build-essential python3 debian-keyring debian-archive-keyring apt-transport-https

# ---- 2. Node.js ----
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 18 ]; then
  say "מתקין Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
echo "    Node: $(node -v)"

# ---- 3. תלויות האפליקציה ----
say "מתקין תלויות"
mkdir -p "$APP_DIR/data"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund

# ---- 4. שירות systemd ----
say "מגדיר שירות"
cat > /etc/systemd/system/office-app.service <<UNIT
[Unit]
Description=Office Management App
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node ${APP_DIR}/server.js
Environment=NODE_ENV=production
Environment=PORT=${APP_PORT}
Environment=DB_PATH=${APP_DIR}/data/office.db
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable office-app >/dev/null 2>&1
systemctl restart office-app

# ---- 5. Caddy ----
if ! command -v caddy >/dev/null 2>&1; then
  say "מתקין Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi

# ---- 6. סיסמה ----
say "מגדיר סיסמה"
HASH="$(caddy hash-password --plaintext "$APP_PASSWORD")"

# ---- 7. הגדרת Caddy ----
say "מגדיר את Caddy"
if [ -n "$DOMAIN" ]; then
  SITE="$DOMAIN"          # Caddy ינפיק תעודת SSL אוטומטית ברגע שה-DNS יצביע לכאן
else
  SITE=":80"              # ללא דומיין — HTTP בלבד
fi

cat > /etc/caddy/Caddyfile <<CADDY
${SITE} {
    encode gzip

    basic_auth {
        ${APP_USER} ${HASH}
    }

    reverse_proxy localhost:${APP_PORT}
}
CADDY

systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy

# ---- 8. בדיקה ----
say "בודק"
sleep 3
systemctl is-active --quiet office-app || {
  echo "    ✖ האפליקציה לא רצה. הלוג האחרון:"
  journalctl -u office-app -n 30 --no-pager
  exit 1
}
systemctl is-active --quiet caddy || {
  echo "    ✖ Caddy לא רץ. הלוג האחרון:"
  journalctl -u caddy -n 30 --no-pager
  exit 1
}

# הבקשה אמורה לחזור 401 — כלומר האפליקציה חיה והסיסמה נדרשת
CODE="$(curl -s -o /dev/null -w '%{http_code}' http://localhost/ || echo 000)"
echo "    תגובה מקומית: HTTP $CODE (401 = תקין, הסיסמה נדרשת)"
echo "    האפליקציה והפרוקסי רצים."
