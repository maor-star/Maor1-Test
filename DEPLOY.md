# 🚀 פריסה ל‑Google Cloud (Compute Engine)

מדריך צעד‑אחר‑צעד לפרסום אפליקציית ניהול המשרד על שרת וירטואלי (VM) בגוגל קלאוד.
הנתונים (SQLite) נשמרים על הדיסק הקבוע של השרת.

> **עלות משוערת:** מכונת `e2-micro` עולה בערך ‎$6–8‎ לחודש, ולעיתים נכללת ב‑[Free Tier](https://cloud.google.com/free) של גוגל (תלוי באזור). מספיק בשפע למשרד יחיד.

---

## שלב 0 — דרישות מקדימות

1. חשבון Google Cloud עם [פרויקט](https://console.cloud.google.com/projectcreate) וחיוב (Billing) מופעל.
2. מתקינים את ה‑CLI [`gcloud`](https://cloud.google.com/sdk/docs/install) במחשב שלך (אופציונלי — אפשר גם דרך ה‑Console בדפדפן).

---

## שלב 1 — יצירת השרת (VM)

**דרך הדפדפן (הכי פשוט):**
נכנסים ל‑[Compute Engine → VM instances](https://console.cloud.google.com/compute/instances) → **Create Instance**:
- **Name:** `office-app`
- **Machine type:** `e2-micro` (או `e2-small`)
- **Boot disk:** Debian 12
- **Firewall:** לסמן ✅ **Allow HTTP traffic**
- לוחצים **Create**

**או דרך שורת הפקודה:**
```bash
gcloud compute instances create office-app \
  --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --tags=http-server \
  --zone=me-west1-a
```
> `me-west1` = אזור תל אביב. אפשר לבחור אזור אחר.

אם יצרת דרך ה‑CLI, ודא שחוק ה‑Firewall לפורט 80 קיים (בדרך כלל קיים כברירת מחדל):
```bash
gcloud compute firewall-rules create default-allow-http \
  --allow=tcp:80 --target-tags=http-server 2>/dev/null || true
```

---

## שלב 2 — התחברות לשרת

מה‑Console: בשורת ה‑VM לוחצים על כפתור **SSH**.
או מהמחשב:
```bash
gcloud compute ssh office-app --zone=me-west1-a
```

---

## שלב 3 — הורדת הקוד והתקנה

בתוך השרת:

```bash
# מתקינים git
sudo apt-get update && sudo apt-get install -y git

# מורידים את הקוד לתיקייה /opt/office-app
sudo git clone https://github.com/maor-star/Maor1-Test.git /opt/office-app
sudo chown -R "$USER":"$USER" /opt/office-app
cd /opt/office-app

# מריצים את סקריפט ההתקנה — מתקין Node, תלויות, ומגדיר שירות אוטומטי
sudo bash deploy/setup.sh
```

> הריפו פרטי? לפני ה‑clone הפעל אימות, למשל עם [gh CLI](https://cli.github.com/) או Personal Access Token:
> `git clone https://<TOKEN>@github.com/maor-star/Maor1-Test.git /opt/office-app`

בסיום, הסקריפט ידפיס את הכתובת לגישה.

---

## שלב 4 — כניסה לאפליקציה

פותחים בדפדפן:
```
http://EXTERNAL_IP
```
(את כתובת ה‑IP החיצונית רואים בשורת ה‑VM ב‑Console, או מודפסת בסוף הסקריפט.)

זהו — האפליקציה חיה ונגישה מכל מקום. 🎉

---

## תחזוקה שוטפת

**עדכון לגרסה חדשה** (אחרי שינויים בקוד):
```bash
cd /opt/office-app
git pull
npm install --omit=dev
sudo systemctl restart office-app
```

**גיבוי הנתונים** — כל המידע נמצא בקובץ אחד:
```bash
# העתקה מקומית עם תאריך
cp /opt/office-app/data/office.db ~/office-backup-$(date +%F).db

# או הורדה למחשב שלך:
gcloud compute scp office-app:/opt/office-app/data/office.db ./ --zone=me-west1-a
```
מומלץ לתזמן גיבוי אוטומטי (למשל עם `cron`) ולהעלות ל‑Cloud Storage.

**בדיקת סטטוס ולוגים:**
```bash
sudo systemctl status office-app      # האם רץ
sudo journalctl -u office-app -f       # לוגים חיים
sudo systemctl restart office-app      # הפעלה מחדש
```

---

## שדרוגים אפשריים בהמשך

- **דומיין ו‑HTTPS** — לחבר דומיין משלך ולהוסיף אישור SSL (למשל עם Caddy או Nginx + Let's Encrypt) כדי לקבל `https://`.
- **גיבוי אוטומטי** ל‑Google Cloud Storage.
- **מסך התחברות ומשתמשים** — כשיהיו כמה עובדים שניגשים למערכת.

צריך עזרה עם אחד מאלה? פשוט תבקש.
