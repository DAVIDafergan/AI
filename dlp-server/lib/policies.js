// מודל ברירת המחדל של מדיניות DLP לכל ארגון
// כל מדיניות מכילה: id, label, description, enabled, category, severity

// ── רמות סיווג מידע ──
export const CLASSIFICATION_LEVELS = {
  PUBLIC:     { id: "PUBLIC",     label: "ציבורי",   action: "none",     description: "מידע ציבורי – ללא פעולה" },
  INTERNAL:   { id: "INTERNAL",   label: "פנימי",    action: "log",      description: "מידע פנימי – רישום בלבד (מצב ביקורת)" },
  SECRET:     { id: "SECRET",     label: "סודי",     action: "mask",     description: "מידע סודי – החלפה בנתונים סינתטיים" },
  TOP_SECRET: { id: "TOP_SECRET", label: "סודי ביותר", action: "block", description: "מידע סודי ביותר – חסימה מוחלטת + התראה למנהל" },
};

// ── מיפוי ברירת מחדל: קטגוריה → רמת סיווג ──
export const DEFAULT_CATEGORY_CLASSIFICATION = {
  credit_card:  "TOP_SECRET",
  israeli_id:   "SECRET",
  password:     "TOP_SECRET",
  bank_account: "TOP_SECRET",
  iban:         "TOP_SECRET",
  api_key:      "TOP_SECRET",
  phone:        "SECRET",
  landline:     "SECRET",
  email:        "INTERNAL",
  address:      "SECRET",
  full_name:    "INTERNAL",
  birthdate:    "SECRET",
  passport:     "SECRET",
  vehicle:      "INTERNAL",
  ip_address:   "INTERNAL",
  keywords:     "SECRET",
};

/**
 * Get the classification level for a given policy/category.
 * Falls back to SECRET if unknown.
 */
export function getClassification(policyId) {
  const levelId = DEFAULT_CATEGORY_CLASSIFICATION[policyId] || "SECRET";
  return CLASSIFICATION_LEVELS[levelId];
}

export const DEFAULT_POLICIES = [
  {
    id: "credit_card",
    label: "חסימת כרטיסי אשראי",
    description: "זיהוי וחסימה של מספרי כרטיסי אשראי (Visa, Mastercard, Amex)",
    enabled: true,
    category: "PII",
    severity: "critical",
  },
  {
    id: "israeli_id",
    label: "חסימת תעודות זהות",
    description: "זיהוי מספרי ת.ז. ישראליים (9 ספרות)",
    enabled: true,
    category: "PII",
    severity: "high",
  },
  {
    id: "email",
    label: "חסימת כתובות אימייל",
    description: "זיהוי וחסימה של כתובות דואר אלקטרוני",
    enabled: true,
    category: "PII",
    severity: "medium",
  },
  {
    id: "phone",
    label: "חסימת מספרי טלפון נייד",
    description: "זיהוי מספרי טלפון נייד ישראליים (05X)",
    enabled: true,
    category: "PII",
    severity: "medium",
  },
  {
    id: "landline",
    label: "חסימת מספרי טלפון נייח",
    description: "זיהוי מספרי טלפון נייח ישראליים (02-09)",
    enabled: true,
    category: "PII",
    severity: "medium",
  },
  {
    id: "keywords",
    label: "חסימת מילות מפתח",
    description: "זיהוי ביטויים רגישים כמו 'פרויקט סודי', 'דוח כספי'",
    enabled: true,
    category: "KEYWORDS",
    severity: "high",
  },
  {
    id: "iban",
    label: "חסימת מספרי IBAN",
    description: "זיהוי מספרי חשבון בנק בינלאומיים (IL + 23 ספרות)",
    enabled: true,
    category: "PII",
    severity: "critical",
  },
  {
    id: "ip_address",
    label: "חסימת כתובות IP",
    description: "זיהוי כתובות IPv4 בטקסט",
    enabled: false,
    category: "NETWORK",
    severity: "low",
  },
  {
    id: "api_key",
    label: "חסימת מפתחות API",
    description: "זיהוי מפתחות AWS, OpenAI ומפתחות API גנריים",
    enabled: true,
    category: "SECRETS",
    severity: "critical",
  },
  {
    id: "passport",
    label: "חסימת מספרי דרכון",
    description: "זיהוי מספרי דרכון ישראליים (8 ספרות בהקשר)",
    enabled: true,
    category: "PII",
    severity: "high",
  },
  {
    id: "vehicle",
    label: "חסימת מספרי רכב",
    description: "זיהוי מספרי לוחית רישוי ישראליים",
    enabled: false,
    category: "PII",
    severity: "low",
  },
  {
    id: "birthdate",
    label: "חסימת תאריכי לידה",
    description: "זיהוי תאריכים בפורמט DD/MM/YYYY",
    enabled: false,
    category: "PII",
    severity: "medium",
  },
  {
    id: "address",
    label: "חסימת כתובות מגורים",
    description: "זיהוי כתובות רחוב מהקשר ('הכתובת שלי היא...')",
    enabled: true,
    category: "PII",
    severity: "medium",
  },
  {
    id: "full_name",
    label: "חסימת שמות מלאים",
    description: "זיהוי שמות אנשים מהקשר ('השם שלי הוא...')",
    enabled: true,
    category: "PII",
    severity: "medium",
  },
  {
    id: "password",
    label: "חסימת סיסמאות",
    description: "זיהוי סיסמאות מהקשר ('הסיסמה שלי:', 'password:')",
    enabled: true,
    category: "SECRETS",
    severity: "critical",
  },
  {
    id: "bank_account",
    label: "חסימת מספרי חשבון בנק",
    description: "זיהוי מספרי חשבון בנק מהקשר ('מספר חשבון:', 'חשבון בנק')",
    enabled: true,
    category: "PII",
    severity: "critical",
  },
];

// החזרת ברירת מחדל עם organizationId מוצמד
export function getDefaultPolicies(organizationId) {
  return DEFAULT_POLICIES.map((p) => ({ ...p, organizationId }));
}

// מפת חומרה לציון איום
export const SEVERITY_SCORES = {
  critical: 30,
  high: 20,
  medium: 10,
  low: 5,
};
