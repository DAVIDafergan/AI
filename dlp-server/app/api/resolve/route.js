// ── נתיב API לפענוח placeholder לערך המקורי ──
import { NextResponse } from "next/server";
import { resolveToken } from "../check-text/store.js";

// כותרות CORS לאפשר גישה מהתוסף
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

// טיפול ב-CORS Preflight
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/resolve?session=SESSION_ID&token=[ID_1]
 * מחזיר את הערך המקורי עבור placeholder בסשן נתון
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session");
  const token = searchParams.get("token");

  // בדיקת פרמטרים חובה
  if (!sessionId || !token) {
    return NextResponse.json(
      { error: "פרמטרים חסרים: נדרשים 'session' ו-'token'" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // חיפוש הערך המקורי במאגר
  const original = resolveToken(sessionId, token);

  if (original === null) {
    return NextResponse.json(
      { error: "סשן לא נמצא או שה-placeholder אינו קיים" },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    { original, placeholder: token },
    { headers: CORS_HEADERS }
  );
}
