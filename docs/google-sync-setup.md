# סנכרון ליומן גוגל — הגדרה חד־פעמית

מה זה עושה: כל שמירה של הרצאה, מחיקה, הזזה או סימון "תואם" באפליקציה מעדכנת תוך שנייה יומן גוגל נפרד בשם **פרקטיקום**.
הרצאה שהוזזה זזה גם בגוגל (לא נוצרת כפולה), הרצאה שבוטלה נמחקת, ו"לתאם" שסומן תואם נעלם.
היומן הראשי שלך ואירועים שיצרת בעצמך לא נקראים ולא משתנים.

## 1. חשבון שירות בגוגל (פעם אחת, כ־5 דקות)
1. https://console.cloud.google.com → בראש הדף: **Select a project → New project** → שם: `practicum-sync` → Create.
2. בתפריט: **APIs & Services → Library** → לחפש **Google Calendar API** → **Enable**.
3. בתפריט: **IAM & Admin → Service Accounts → Create service account** → שם: `practicum-sync` → **Done**.
4. ללחוץ על החשבון שנוצר → לשונית **Keys → Add key → Create new key → JSON**. קובץ JSON יורד למחשב (בדרך כלל ל־Downloads).
   ⚠ זה מפתח פרטי — לא לשלוח אותו לאף אחד ולא להעלות ל־GitHub.
5. להעתיק את כתובת החשבון (נראית כך: `practicum-sync@….iam.gserviceaccount.com`).

## 2. יומן "פרקטיקום" בגוגל
1. https://calendar.google.com → בצד: **יומנים אחרים ＋ → יצירת יומן חדש** → שם: `פרקטיקום` → יצירה.
2. בהגדרות של היומן החדש → **שיתוף עם אנשים ספציפיים** → להוסיף את כתובת חשבון השירות מסעיף 1.5 → הרשאה: **ביצוע שינויים באירועים**.
3. באותו מסך, למטה ב־**שילוב יומן**: להעתיק את **מזהה היומן** (Calendar ID).

## 3. בטרמינל (שורה אחת — להחליף את שני הערכים)
```bash
cd ~/Code/practicum-v2 && git pull origin main && npx supabase secrets set GCAL_CALENDAR_ID="מזהה-היומן" GCAL_SA_KEY="$(cat ~/Downloads/שם-הקובץ.json)" --project-ref vpqgmcmavnszcnakhiat && npx supabase functions deploy gcal-sync --project-ref vpqgmcmavnszcnakhiat
```

## 4. פריסת האתר
```bash
cd ~/Code/practicum-v2 && node scripts/deploy-gate.mjs --offline && SHIP_GATE_PASSED=i-ran-the-gate-myself npm run deploy
```

## 5. סנכרון ראשון
בלוח השנה באפליקציה → **↻ סנכרן לגוגל**. ההודעה אומרת כמה אירועים נוספו. מעכשיו זה קורה לבד אחרי כל שמירה.

## מה נכנס לגוגל
- הרצאות אורח: ✓ מאושרת (ירוק), ⏳ ממתין (כתום). בוטלה — נמחקת.
- ⚠ לתאם — 14 יום לפני הרצאה שלא אושרה, ותזכורות החלפת שיעור. סימון "תואם" באפליקציה מוחק.
- 🏖 ימי חופשה שלך.
- הלוח האקדמי (קורסים, חגים, בחינות) כבר נמצא ביומן הראשי שלך מ־22.9 ולא משוכפל.

## עוד לא
- סימון "תואם" **מתוך גוגל** לא חוזר לאפליקציה (כיוון אחד בינתיים).
