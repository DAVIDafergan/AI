# DLP Shield Enterprise 🛡️

**מערכת הגנה על מידע (DLP) ברמת Enterprise – עם Multi-tenancy, Contextual NLP, Clipboard Shield ו-CISO Dashboard**

---

## English Summary

DLP Shield Enterprise is a production-grade Data Loss Prevention system built with Next.js 14. It detects and replaces sensitive PII (Personal Identifiable Information) with realistic synthetic data — so AI assistants process the redacted content without noticing any protection was applied. A full admin CISO dashboard provides real-time visibility into all detection events.

---

## תיאור המערכת

DLP Shield Enterprise מגנה על מידע רגיש שנשלח ל-AI חיצוני (ChatGPT, Claude, Gemini). המערכת מזהה PII בזמן אמת, מחליפה אותו בנתונים סינתטיים ריאליסטיים, ושומרת את המיפוי כך שניתן לשחזר את המידע המקורי בלוח הניהול.

---

## ארכיטקטורה

```
┌─────────────────────────────────────────────────────────────────┐
│                    DLP Shield Enterprise                         │
│                                                                   │
│  ┌─────────────────┐    ┌──────────────────┐                    │
│  │  Clipboard Agent│    │   Browser/API    │                    │
│  │  (desktop-      │    │   Client         │                    │
│  │   shield.js)    │    │                  │                    │
│  └────────┬────────┘    └────────┬─────────┘                    │
│           │                      │                               │
│           └──────────┬───────────┘                               │
│                      ▼                                            │
│         ┌────────────────────────┐                               │
│         │  POST /api/check-text  │                               │
│         │  - Auth Middleware     │                               │
│         │  - Pattern Detection   │                               │
│         │  - Context NLP         │                               │
│         │  - Custom Keywords     │                               │
│         │  - Synthetic Replace   │                               │
│         │  - Threat Scoring      │                               │
│         └────────────┬───────────┘                               │
│                      │                                            │
│         ┌────────────▼───────────┐                               │
│         │   In-Memory Store      │                               │
│         │  (lib/db.js)           │                               │
│         │  - Mappings            │                               │
│         │  - Logs                │                               │
│         │  - Policies            │                               │
│         │  - Alerts              │                               │
│         └────────────┬───────────┘                               │
│                      │                                            │
│         ┌────────────▼───────────┐                               │
│         │  CISO Admin Dashboard  │                               │
│         │  /admin                │                               │
│         │  - KPI Cards           │                               │
│         │  - Trend Analysis      │                               │
│         │  - Alerts Panel        │                               │
│         │  - Policy Management   │                               │
│         │  - Custom Keywords     │                               │
│         └────────────────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## דרישות מקדימות

- Node.js 18+
- npm 9+

---

## התקנה

```bash
cd dlp-server
npm install
```

---

## הגדרת סביבה

```bash
cp .env.example .env.local
# ערוך את .env.local לפי הצורך
```

### משתני סביבה

| משתנה | ברירת מחדל | תיאור |
|-------|-----------|-------|
| `DLP_SERVER_URL` | `http://localhost:3000` | כתובת שרת DLP |
| `DLP_DEFAULT_ORG` | `default-org` | ארגון ברירת מחדל |
| `DLP_ADMIN_SECRET` | - | סוד ניהולי (לשינוי בproduction) |
| `DLP_API_KEY` | `dev-api-key-12345` | מפתח API לסוכן ה-Clipboard |
| `DLP_POLLING_INTERVAL` | `500` | תדירות בדיקת לוח עריכה (ms) |
| `DLP_NOTIFICATIONS` | `true` | הפעלת התראות מערכת |
| `DLP_VERBOSE` | `false` | לוגים מפורטים |

---

## הפעלה

### שרת ה-DLP

```bash
npm run dev
# הדף ניהול זמין ב: http://localhost:3000/admin
```

### Clipboard Shield (סוכן שולחן עבודה)

```bash
npm run shield
```

הסוכן ינטר את לוח העריכה ויחליף PII בנתונים סינתטיים אוטומטית.

---

## תיעוד API

### POST /api/check-text

זיהוי והחלפת PII בטקסט.

**בקשה:**
```json
{
  "text": "הטלפון שלי הוא 0541112233",
  "source": "chat.openai.com",
  "mode": "paste"
}
```

**תשובה:**
```json
{
  "safe": false,
  "redactedText": "הטלפון שלי הוא 052-345-6789",
  "replacements": [
    {
      "synthetic": "052-345-6789",
      "label": "טלפון נייד",
      "category": "PHONE",
      "policyId": "phone"
    }
  ],
  "threatScore": 10,
  "detectionCount": 1,
  "timestamp": "2026-03-29T00:00:00.000Z",
  "organizationId": "default-org"
}
```

### GET /api/check-text?synthetic=VALUE

שחזור ערך מקורי לפי ערך סינתטי.

### GET /api/stats

סטטיסטיקות לוח הניהול (KPI, לוגים, גרפים, מדיניות).

### GET/PUT/POST /api/policies

ניהול מדיניות זיהוי לארגון.

### GET/POST/DELETE /api/custom-keywords

ניהול מילות מפתח מותאמות.

### GET/POST /api/alerts

ניהול התראות אבטחה.

### GET/POST/PUT /api/organizations

ניהול ארגונים (Multi-tenancy).

### GET /api/trend-data

נתוני מגמה ל-30 ימים.

### GET /api/export-report?format=json|csv

ייצוא דוח אבטחה מלא.

---

## לוח הניהול (CISO Dashboard)

גש ל: `http://localhost:3000/admin`

### טאבים

| טאב | תוכן |
|-----|------|
| **סקירה כללית** | KPI, גרפים, טבלת לוגים עם חיפוש ופילטור |
| **מגמות** | גרף קו – 30 ימים, השוואות שבועיות/חודשיות |
| **התראות** | התראות אבטחה בזמן אמת עם ניהול קריאה |
| **הגדרות** | ניהול מדיניות עם תגי חומרה |
| **מילים מותאמות** | הוספה/מחיקה של מילות מפתח רגישות |

---

## Multi-tenancy

כל ארגון מבודד לחלוטין מאחרים:

```bash
# יצירת ארגון חדש
curl -X POST http://localhost:3000/api/organizations \
  -H "Content-Type: application/json" \
  -d '{"name": "חברת ABC"}'

# שימוש במפתח API
curl -X POST http://localhost:3000/api/check-text \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"text": "מספר ת.ז. שלי 123456789"}'
```

---

## שיקולי אבטחה

- **In-Memory Store**: כל הנתונים נשמרים בזיכרון בלבד – לא מוצפים לדיסק
- **API Keys**: מפתחות API נוצרים אקראית ומאפשרים בידוד בין ארגונים
- **CORS**: הגדרת CORS מאפשרת גישה מכל מקור – הגבל בproduction
- **TODO Production**: הוסף HTTPS, Rate Limiting, ואימות JWT בסביבת ייצור
- **TODO DB**: החלף את ה-in-memory store ב-MongoDB או Redis בsession persistence

---

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## גרסה

**3.0.0** – Enterprise Edition עם Multi-tenancy, Contextual NLP, Clipboard Shield, CISO Dashboard

---

## הוספת לקוח חדש (Client Onboarding)

### דרך ה-Dashboard (מומלץ)
1. עבור לטאב **"ניהול לקוחות"** ב-Admin Dashboard (`/admin`)
2. לחץ על **"+ הוסף לקוח חדש"**
3. מלא את האשף בשלושה שלבים:
   - **שלב 1** – פרטי הארגון (שם, אימייל, חבילה, הערות)
   - **שלב 2** – הגדרת מדיניות ראשונית (סוגי PII + רמת חומרה)
   - **שלב 3** – קבלת API Key + הוראות חיבור מפורטות

### דרך דף ה-Onboarding הציבורי
גש לכתובת `/onboarding` וקבל מפתח API מיידי.

### דרך ה-API ישירות

#### יצירת לקוח חדש
```bash
curl -X POST http://localhost:3000/api/clients \
  -H "Content-Type: application/json" \
  -d '{
    "name": "חברת טכנולוגיות בע\"מ",
    "contactEmail": "admin@company.com",
    "plan": "enterprise",
    "notes": "לקוח חשוב"
  }'
```

תשובה:
```json
{
  "success": true,
  "organization": { "id": "...", "name": "...", "plan": "enterprise" },
  "apiKey": "key-...",
  "organizationId": "...",
  "instructions": {
    "browserExtension": [...],
    "desktopShield": "...",
    "curlExample": "...",
    "sdkExample": "..."
  }
}
```

#### רשימת כל הלקוחות
```bash
curl http://localhost:3000/api/clients
```

#### מחיקת לקוח
```bash
curl -X DELETE "http://localhost:3000/api/clients?id=ORG_ID"
```

---

## API Routes – עדכון מלא

| Method | Route | תיאור |
|--------|-------|-------|
| GET | `/api/clients` | רשימת כל הלקוחות עם סטטיסטיקות |
| POST | `/api/clients` | יצירת לקוח חדש + מפתח API |
| DELETE | `/api/clients?id=ORG_ID` | מחיקת לקוח ונתוניו |
| GET | `/api/organizations` | פרטי ארגון נוכחי |
| POST | `/api/organizations` | יצירת ארגון (Legacy) |
| PUT | `/api/organizations` | עדכון ארגון |

### הוראות חיבור (לכל לקוח)

**א. תוסף דפדפן:**
1. התקן את התוסף מ-Chrome Web Store
2. הזן את כתובת השרת בהגדרות
3. הזן את מפתח ה-API

**ב. Desktop Shield:**
```bash
export DLP_SERVER_URL="http://localhost:3000"
export DLP_API_KEY="YOUR_API_KEY"
npm run shield
```

**ג. REST API:**
```bash
curl -X POST http://localhost:3000/api/check-text \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "הטקסט לבדיקה", "source": "api"}'
```

**ד. JavaScript:**
```javascript
const response = await fetch('http://localhost:3000/api/check-text', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': 'YOUR_API_KEY' },
  body: JSON.stringify({ text: 'הטקסט לבדיקה', source: 'sdk' })
});
const { safe, redactedText } = await response.json();
```
