// ── מאגר מיפויים בזיכרון (In-Memory Session Store) ──
import { randomUUID } from "crypto";

// מפה: sessionId → { mapping, createdAt }
const sessions = new Map();

// זמן תפוגה: שעה אחת במילישניות
const SESSION_TTL_MS = 60 * 60 * 1000;

// ניקוי אוטומטי של סשנים שפגו מדי 10 דקות
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, CLEANUP_INTERVAL_MS);

/**
 * יוצר סשן חדש עם המיפוי הנתון.
 * @param {Object} mapping - מיפוי placeholder → ערך מקורי
 * @returns {string} - מזהה הסשן החדש
 */
export function createSession(mapping) {
  const sessionId = randomUUID();
  sessions.set(sessionId, {
    mapping: { ...mapping },
    createdAt: Date.now()
  });
  return sessionId;
}

/**
 * מחזיר את המיפוי של סשן קיים.
 * @param {string} sessionId
 * @returns {Object|null} - המיפוי, או null אם הסשן לא קיים / פג תוקפו
 */
export function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  // בדיקת תוקף
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }

  return session.mapping;
}

/**
 * מחזיר את הערך המקורי עבור placeholder בסשן נתון.
 * @param {string} sessionId
 * @param {string} placeholder - לדוגמה: "[ID_1]"
 * @returns {string|null} - הערך המקורי, או null אם לא נמצא
 */
export function resolveToken(sessionId, placeholder) {
  const mapping = getSession(sessionId);
  if (!mapping) return null;
  return mapping[placeholder] ?? null;
}
