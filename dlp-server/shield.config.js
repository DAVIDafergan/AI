// קונפיגורציה לסוכן ה-Clipboard Shield
// ⚠️  אזהרה: DLP_API_KEY חייב להיות מוגדר בסביבת Production!
//     "dev-api-key-12345" מיועד לפיתוח מקומי בלבד.

// בסביבת Production: הגדר DLP_API_KEY כמשתנה סביבה
if (process.env.NODE_ENV === "production" && !process.env.DLP_API_KEY) {
  console.warn("[DLP Shield] WARNING: DLP_API_KEY not set – using development key in production is insecure!");
}

const config = {
  // כתובת שרת ה-DLP
  serverUrl: process.env.DLP_SERVER_URL || "http://localhost:3000",

  // מפתח API – חובה להגדיר DLP_API_KEY בסביבת Production
  apiKey: process.env.DLP_API_KEY || "dev-api-key-12345",

  // קצב בדיקת לוח העריכה (מילישניות)
  pollingInterval: parseInt(process.env.DLP_POLLING_INTERVAL || "500"),

  // timeout לבקשות HTTP (מילישניות) – ניתן לשינוי דרך DLP_REQUEST_TIMEOUT
  requestTimeout: parseInt(process.env.DLP_REQUEST_TIMEOUT || "5000"),

  // הצגת הודעות מערכת
  notifications: {
    enabled: process.env.DLP_NOTIFICATIONS !== "false",
    sound: false,
  },

  // לוגים בקונסול
  verbose: process.env.DLP_VERBOSE === "true",
};

module.exports = config;
