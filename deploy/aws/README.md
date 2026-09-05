# 🚀 פריסה ל-AWS (S3 + CloudFront + CloudFormation)

פריסת אפליקציית **ניהול הבית** כאתר סטטי על **S3 פרטי** מאחורי **CloudFront** (HTTPS), באמצעות **CloudFormation** ו-**AWS CLI**.

האפליקציה כולה רצה בדפדפן (הנתונים נשמרים ב-`localStorage` של המשתמש), כך שאין צורך בשרת — S3 + CloudFront מספיקים.

## דרישות מקדימות

1. חשבון AWS.
2. [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) מותקן.
3. הרשאות (`aws configure`) עם משתמש/תפקיד שיכול ליצור: CloudFormation, S3, CloudFront, IAM policy ל-bucket.

## פריסה בפקודה אחת

```bash
bash deploy/aws/deploy.sh
```

הסקריפט:
1. מוודא זהות (`aws sts get-caller-identity`).
2. פורס/מעדכן את ה-stack מ-`cloudformation.yaml` (יוצר S3 bucket פרטי, Origin Access Control, ו-CloudFront distribution).
3. מעלה את `web/index.html` ל-bucket.
4. מרוקן את מטמון ה-CloudFront (invalidation).
5. מדפיס את **כתובת האתר החיה**.

משתני סביבה אופציונליים:

```bash
STACK=home-management AWS_REGION=us-east-1 bash deploy/aws/deploy.sh
```

> בפריסה ראשונה CloudFront מתפרס תוך ~5–15 דקות עד שהכתובת פעילה במלואה.

## עדכון האפליקציה

אחרי שינוי ב-`web/index.html`, פשוט הריצו שוב:

```bash
bash deploy/aws/deploy.sh
```

(ה-stack כבר קיים — יעודכן רק מה שהשתנה, הקובץ יועלה מחדש והמטמון ירוקן.)

## מחיקה מלאה

```bash
bash deploy/aws/teardown.sh
```

מרוקן את ה-bucket ומוחק את כל משאבי ה-stack.

## הארכיטקטורה

```
דפדפן ──HTTPS──▶ CloudFront ──(OAC, פרטי)──▶ S3 bucket (index.html)
```

- ה-bucket **פרטי לחלוטין** (Public Access Block מלא); רק ה-CloudFront distribution הספציפי יכול לקרוא ממנו, דרך Origin Access Control ו-bucket policy עם תנאי `AWS:SourceArn`.
- CloudFront כופה HTTPS (`redirect-to-https`), דוחס תוכן, ומגיש `index.html` כברירת מחדל.
- `PriceClass_100` (ארה"ב/אירופה) לעלות מינימלית; ניתן לשנות ב-`cloudformation.yaml`.

## עלות משוערת

לאתר יחיד בתעבורה נמוכה — בדרך כלל **סנטים בודדים עד דולר בחודש** (לרוב בתוך ה-Free Tier של S3/CloudFront).
