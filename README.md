# Synthetic Data Lab — Static Demo

דמו עצמאי, חד-קובצי (`index.html`), רץ כולו בדפדפן — **אין שרת, אין Postgres, אין קריאות רשת**. נבדק בפועל בדפדפן Chromium אמיתי (Playwright) לפני שנשלח: generate → search (name/id/phone) → profile + family graph SVG → Entity Resolution demo, כולם עברו בלי שגיאות JS.

## איך זה שונה מהפרויקט המלא

זהו **לא** אותו שרת/DB שנבנה קודם (Node.js + Postgres + Redis) — אלה לא יכולים לרוץ כקבצים סטטיים ב-GitHub Pages. זו גרסה מקבילה, קטנה יותר, שמממשת את אותה לוגיקת ליבה (הגנרטור, RelationshipEngine, SearchService, EntityResolutionService) ב-JavaScript טהור שרץ בדפדפן של המשתמש בלבד:

- כל הנתונים נוצרים אקראית (`mulberry32`, seeded PRNG) בלחיצת כפתור — שום דבר לא נשמר בשרת, שום דבר לא נטען מבחוץ.
- אלגוריתם האחים זהה: `father_id` **וגם** `mother_id` תואמים ⇒ CONFIRMED; הורה אחד ידוע בלבד ⇒ POSSIBLE_RELATION.
- Entity Resolution: משווה שתי רשומות עם טעות כתיב מכוונת ומדגים Conflict Detection על מספר טלפון.

## איך להעלות ל-GitHub Pages

1. צור repository חדש (או השתמש בקיים) והעלה את `index.html` לשורש שלו (או לתיקיית `/docs`).
2. ב-repository: **Settings → Pages → Source** → בחר את ה-branch (בד"כ `main`) והתיקייה (`/root` או `/docs`).
3. שמור. אחרי דקה-שתיים הדף יהיה זמין בכתובת `https://<username>.github.io/<repo-name>/`.

אין build step, אין `npm install`, אין תלויות — זה קובץ HTML יחיד עם CSS+JS מוטמעים.

## הרצה מקומית

פשוט פתח את `index.html` בכל דפדפן (double-click / drag לתוך חלון דפדפן). אין צורך בשרת מקומי.
