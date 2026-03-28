// TODO: להחליף ב-Firebase Firestore בעתיד
import { NextResponse } from "next/server";

const STATS_DATA = {
  kpi: {
    totalBlocked: 1247,
    privacyScore: 94.7,
    topEntity: "כרטיס אשראי",
    activeUsers: 38,
  },
  dailyBlocks: [
    { day: "ראשון", blocks: 45 },
    { day: "שני", blocks: 62 },
    { day: "שלישי", blocks: 78 },
    { day: "רביעי", blocks: 91 },
    { day: "חמישי", blocks: 54 },
    { day: "שישי", blocks: 33 },
    { day: "שבת", blocks: 12 },
  ],
  categoryBreakdown: [
    { name: "כרטיס אשראי", value: 412, color: "#f43f5e" },
    { name: "תעודת זהות", value: 328, color: "#8b5cf6" },
    { name: "אימייל", value: 289, color: "#3b82f6" },
    { name: "טלפון נייד", value: 134, color: "#22c55e" },
    { name: "מילות מפתח", value: 84, color: "#f59e0b" },
  ],
  recentLogs: [
    { id: 1, timestamp: "2026-03-28T14:23:01Z", type: "כרטיס אשראי", placeholder: "[CREDIT_CARD_1]", source: "chat.openai.com", status: "blocked" },
    { id: 2, timestamp: "2026-03-28T14:21:45Z", type: "תעודת זהות", placeholder: "[ID_1]", source: "claude.ai", status: "blocked" },
    { id: 3, timestamp: "2026-03-28T14:19:30Z", type: "אימייל", placeholder: "[EMAIL_1]", source: "chat.openai.com", status: "blocked" },
    { id: 4, timestamp: "2026-03-28T14:15:12Z", type: "פרויקט סודי", placeholder: "[PROJECT_1]", source: "gemini.google.com", status: "blocked" },
    { id: 5, timestamp: "2026-03-28T14:10:55Z", type: "טלפון נייד", placeholder: "[PHONE_1]", source: "chat.openai.com", status: "blocked" },
    { id: 6, timestamp: "2026-03-28T13:58:20Z", type: "כרטיס אשראי", placeholder: "[CREDIT_CARD_2]", source: "claude.ai", status: "blocked" },
    { id: 7, timestamp: "2026-03-28T13:45:00Z", type: "דוח כספי", placeholder: "[FINANCE_1]", source: "chat.openai.com", status: "blocked" },
    { id: 8, timestamp: "2026-03-28T13:30:18Z", type: "תעודת זהות", placeholder: "[ID_2]", source: "gemini.google.com", status: "blocked" },
    { id: 9, timestamp: "2026-03-28T13:22:40Z", type: "אימייל", placeholder: "[EMAIL_2]", source: "chat.openai.com", status: "blocked" },
    { id: 10, timestamp: "2026-03-28T13:10:05Z", type: "כרטיס אשראי", placeholder: "[CREDIT_CARD_3]", source: "claude.ai", status: "blocked" },
  ],
  policySettings: [
    { id: "credit_card", label: "חסימת כרטיסי אשראי", description: "זיהוי וחסימה של מספרי כרטיסי אשראי (Luhn)", enabled: true, category: "PII" },
    { id: "israeli_id", label: "חסימת תעודות זהות", description: "זיהוי מספרי ת.ז. ישראליים (9 ספרות + ביקורת)", enabled: true, category: "PII" },
    { id: "email", label: "חסימת כתובות אימייל", description: "זיהוי וחסימה של כתובות דואר אלקטרוני", enabled: true, category: "PII" },
    { id: "phone", label: "חסימת מספרי טלפון", description: "זיהוי מספרי טלפון נייד ישראליים", enabled: false, category: "PII" },
    { id: "keywords", label: "חסימת מילות מפתח", description: "זיהוי ביטויים רגישים כמו 'פרויקט סודי', 'דוח כספי'", enabled: true, category: "KEYWORDS" },
    { id: "iban", label: "חסימת מספרי IBAN", description: "זיהוי מספרי חשבון בנק בינלאומיים", enabled: true, category: "PII" },
  ],
};

// טיפול בבקשות OPTIONS לתמיכה ב-CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function GET() {
  return NextResponse.json(STATS_DATA, {
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });
}
