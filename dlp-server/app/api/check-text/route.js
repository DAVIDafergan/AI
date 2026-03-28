// ── נתיב API לבדיקת טקסט ורידוי מידע רגיש ──
import { NextResponse } from "next/server";
import { PATTERNS, KEYWORDS } from "./patterns.js";
import { redact } from "./redactor.js";
import { createSession } from "./store.js";

// כותרות CORS לאפשר גישה מהתוסף
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

// טיפול ב-CORS Preflight
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// בדיקת טקסט וצנזור
export async function POST(request) {
  try {
    const { text } = await request.json();

    if (typeof text !== "string") {
      return NextResponse.json(
        { error: "שדה 'text' חסר או אינו מחרוזת" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // ביצוע ה-redaction באמצעות המנוע המרכזי
    const { redactedText, replacements, mapping } = redact(text, PATTERNS, KEYWORDS);

    // שמירת המיפוי בסשן ייחודי
    const sessionId = createSession(mapping);

    // סטטיסטיקות
    const patternCount = replacements.filter(r =>
      PATTERNS.some(p => p.id === r.category)
    ).length;
    const keywordCount = replacements.length - patternCount;

    return NextResponse.json(
      {
        safe: replacements.length === 0,
        redactedText,
        replacements,
        sessionId,
        stats: {
          totalDetected: replacements.length,
          patterns: patternCount,
          keywords: keywordCount
        },
        timestamp: new Date().toISOString()
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "שגיאה פנימית בשרת" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}