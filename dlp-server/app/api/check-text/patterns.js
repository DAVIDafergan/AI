// ── הגדרות תבניות PII (מידע מזהה אישי) ──
import { isValidLuhn, isValidIsraeliID } from "./luhn.js";

/**
 * רשימת תבניות Regex לזיהוי מידע רגיש.
 * כל תבנית כוללת:
 *   id       – מזהה ייחודי לתבנית
 *   regex    – ביטוי רגולרי לזיהוי מועמדים
 *   label    – תווית בעברית לתצוגה
 *   validate – פונקציית אימות אופציונלית (מחזירה true/false)
 */
export const PATTERNS = [
  {
    id: "ID",
    // תעודת זהות ישראלית – 9 ספרות
    regex: /\b\d{9}\b/g,
    label: "תעודת זהות",
    validate: isValidIsraeliID
  },
  {
    id: "CREDIT_CARD",
    // כרטיס אשראי – 13 עד 19 ספרות עם רווחים/מקפים אופציונליים
    regex: /\b(?:\d[ -]*){12,18}\d\b/g,
    label: "כרטיס אשראי",
    validate: isValidLuhn
  },
  {
    id: "EMAIL",
    // כתובת אימייל תקנית
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    label: "אימייל"
  },
  {
    id: "PHONE",
    // מספר טלפון נייד ישראלי: 05X-XXXXXXX
    regex: /\b05\d[-\s]?\d{3}[-\s]?\d{4}\b/g,
    label: "טלפון נייד"
  },
  {
    id: "IBAN",
    // IBAN ישראלי: IL + ספרות
    regex: /\bIL\d{2}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{3}\b/gi,
    label: "IBAN"
  }
];

/**
 * רשימת מילות מפתח לזיהוי מסמכים סודיים.
 * כל רשומה כוללת:
 *   keyword  – מחרוזת לחיפוש
 *   category – קטגוריה (משמשת כ-id ב-placeholder)
 *   label    – תווית בעברית לתצוגה
 */
export const KEYWORDS = [
  { keyword: "פרויקט סודי",       category: "PROJECT",   label: "פרויקט" },
  { keyword: "דוח כספי",          category: "FINANCE",   label: "דוח" },
  { keyword: "תוכנית אסטרטגית",   category: "STRATEGY",  label: "תוכנית" },
  { keyword: "סודי ביותר",        category: "SECRET",    label: "סודי" },
  { keyword: "תקציב פנימי",       category: "BUDGET",    label: "תקציב" },
  { keyword: "רשימת לקוחות",      category: "CUSTOMERS", label: "לקוחות" },
  { keyword: "נתוני משכורות",     category: "SALARIES",  label: "משכורות" },
  { keyword: "מסמך פנימי",        category: "INTERNAL",  label: "מסמך פנימי" }
];
