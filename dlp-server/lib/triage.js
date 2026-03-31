// ── מנוע טריאז' רב-שכבתי – GhostLayer Triage Engine ──
// L1: Fast Scan (מטרה: מתחת ל-1ms) – Regex + Bloom Filter
// L2: Semantic Hashing – חתימות hash מול MongoDB
// L3: AI Context Inference – ניתוח קרבה קשרית עברי

// ── L1 Fast Scan Patterns (Optimized Regex) ──
const L1_PATTERNS = [
  // טלפון נייד ישראלי
  { id: "PHONE",       regex: /\b05[0-9][- ]?\d{3}[- ]?\d{4}\b/g,                        severity: "high",     confidence: 0.95 },
  // טלפון נייח ישראלי
  { id: "LANDLINE",    regex: /\b0(?:2|3|4|8|9)[- ]?\d{3}[- ]?\d{4}\b/g,                  severity: "medium",   confidence: 0.90 },
  // כרטיס אשראי (13-16 ספרות)
  { id: "CREDIT_CARD", regex: /\b(?:4\d{3}|5[1-5]\d{2}|2[2-7]\d{2}|3[47]\d{2})[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b|\b3[47]\d{2}[ -]?\d{6}[ -]?\d{5}\b/g, severity: "critical", confidence: 0.98 },
  // אימייל
  { id: "EMAIL",       regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,          severity: "medium",   confidence: 0.99 },
  // ת.ז. ישראלי (9 ספרות)
  { id: "ID",          regex: /\b\d{9}\b/g,                                                 severity: "high",     confidence: 0.80 },
  // מפתח AWS
  { id: "AWS_KEY",     regex: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,                  severity: "critical", confidence: 1.00 },
  // מפתח OpenAI
  { id: "OPENAI_KEY",  regex: /\bsk-[a-zA-Z0-9]{20,}\b/g,                                  severity: "critical", confidence: 1.00 },
  // GitHub Tokens
  { id: "GITHUB_TOKEN", regex: /\b(?:ghp|gho|ghs)_[A-Za-z0-9]{36,}\b/g,                   severity: "critical", confidence: 1.00 },
  // Google API Key
  { id: "GOOGLE_KEY",  regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,                                severity: "critical", confidence: 1.00 },
  // JWT Token
  { id: "JWT",         regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, severity: "critical", confidence: 0.99 },
  // PEM Key
  { id: "PEM_KEY",     regex: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,               severity: "critical", confidence: 1.00 },
  // MongoDB Connection String
  { id: "MONGODB_CONN", regex: /mongodb(?:\+srv)?:\/\/[^\s"']{8,}/gi,                       severity: "critical", confidence: 1.00 },
  // PostgreSQL Connection String
  { id: "PG_CONN",     regex: /postgres(?:ql)?:\/\/[^\s"']{8,}/gi,                         severity: "critical", confidence: 1.00 },
  // כתובות IP פנימיות
  { id: "INTERNAL_IP", regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g, severity: "high", confidence: 0.95 },
];

// ── Bloom Filter פשוט למילות סוד ──
// מיועד לזיהוי מהיר של ביטויי מפתח ידועים מבלי לסרוק כל regex
const SECRET_KEYWORDS = new Set([
  "password", "passwd", "passphrase", "secret", "private_key", "api_key",
  "access_token", "auth_token", "bearer", "credential", "סיסמה", "סיסמא",
  "מפתח גישה", "אישורים", "קוד גישה", "token", "סוד",
]);

class SimpleBloomFilter {
  constructor(size = 1024) {
    this.bits = new Uint8Array(size);
    this.size = size;
  }

  _hash(str, seed) {
    let h = seed ^ 0xdeadbeef;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 0x9e3779b1);
    }
    return ((h >>> 0) % this.size);
  }

  add(str) {
    const lower = str.toLowerCase();
    this.bits[this._hash(lower, 1)] = 1;
    this.bits[this._hash(lower, 2)] = 1;
    this.bits[this._hash(lower, 3)] = 1;
  }

  mightContain(str) {
    const lower = str.toLowerCase();
    return (
      this.bits[this._hash(lower, 1)] === 1 &&
      this.bits[this._hash(lower, 2)] === 1 &&
      this.bits[this._hash(lower, 3)] === 1
    );
  }
}

// אתחול Bloom Filter עם מילות מפתח ידועות
const bloomFilter = new SimpleBloomFilter(2048);
for (const kw of SECRET_KEYWORDS) {
  bloomFilter.add(kw);
}

// ── L1: Fast Scan ──
export function l1FastScan(text) {
  const findings = [];
  const start = Date.now();

  // בדיקת Bloom Filter לביטויי מפתח
  const words = text.split(/\s+/);
  for (const word of words) {
    if (bloomFilter.mightContain(word)) {
      const wordIndex = text.indexOf(word);
      findings.push({
        level: "L1",
        id: "KEYWORD",
        confidence: 0.70,
        severity: "high",
        match: word,
        index: wordIndex,
      });
    }
  }

  // בדיקת Regex מהיר – כל המופעים (global flag)
  for (const { id, regex, severity, confidence } of L1_PATTERNS) {
    // איפוס lastIndex לפני שימוש חוזר בregex עם flag g
    const freshRegex = new RegExp(regex.source, regex.flags);
    const matches = [...text.matchAll(freshRegex)];
    for (const match of matches) {
      findings.push({
        level: "L1",
        id,
        confidence,
        severity,
        match: match[0],
        index: match.index,
      });
    }
  }

  const elapsed = Date.now() - start;

  return {
    level: "L1",
    findings,
    elapsed,
    hasHighConfidencePII: findings.some((f) => f.confidence >= 0.9 && f.severity !== "low"),
  };
}

// ── Simple Hash Function ──
function hashString(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ── L2: Semantic Hashing ──
// מנגנון: hash של מקטעי טקסט מול cache מקומי של hash-ים רגישים ידועים
const sensitiveHashCache = new Map(); // hash → { category, organizationId, addedAt }

export function l2SemanticHash(text, organizationId) {
  const findings = [];
  const start = Date.now();

  // חלוקה למקטעים של 4-8 מילים (sliding window)
  const words = text.split(/\s+/);
  const windowSizes = [4, 6, 8];

  for (const windowSize of windowSizes) {
    for (let i = 0; i <= words.length - windowSize; i++) {
      const segment = words.slice(i, i + windowSize).join(" ");
      const hash = hashString(segment.toLowerCase().trim());

      const cached = sensitiveHashCache.get(hash);
      if (cached && (cached.organizationId === organizationId || cached.organizationId === "global")) {
        findings.push({
          level: "L2",
          id: cached.category || "KNOWN_SENSITIVE",
          hash,
          segment,
          confidence: 0.85,
          severity: "high",
        });
      }
    }
  }

  const elapsed = Date.now() - start;
  return { level: "L2", findings, elapsed };
}

// הוספת hash רגיש למטמון
export function addSensitiveHash(text, category, organizationId) {
  const hash = hashString(text.toLowerCase().trim());
  sensitiveHashCache.set(hash, { category, organizationId: organizationId || "global", addedAt: new Date().toISOString() });
  return hash;
}

// ── L3: AI Context Inference (Hebrew NLP) ──
// ניתוח קרבה קשרית עברי עם ציון משוקלל
const HEBREW_SENSITIVE_TRIGGERS = [
  { pattern: /הסיסמה\s+שלי\s+(היא|:)\s*/i,    category: "PASSWORD",      weight: 0.9 },
  { pattern: /מספר\s+הכרטיס\s*(שלי)?\s*:?\s*/i, category: "CREDIT_CARD",   weight: 0.85 },
  { pattern: /ת\.?ז\.?\s+שלי\s*:?\s*/i,         category: "ID",            weight: 0.85 },
  { pattern: /האימייל\s+שלי\s*(הוא)?\s*/i,      category: "EMAIL",         weight: 0.80 },
  { pattern: /הטלפון\s+שלי\s*(הוא)?\s*/i,       category: "PHONE",         weight: 0.80 },
  { pattern: /הכתובת\s+שלי\s*(היא)?\s*/i,       category: "ADDRESS",       weight: 0.75 },
  { pattern: /חשבון\s+הבנק\s+שלי\s*/i,          category: "BANK_ACCOUNT",  weight: 0.85 },
  { pattern: /מפתח\s+ה[- ]?api\s*/i,             category: "API_SECRET",    weight: 0.90 },
  { pattern: /הדרכון\s+שלי\s*/i,                category: "PASSPORT",      weight: 0.80 },
];

// ביטויים שמרמזים על הקשר בנאלי (False Positive Prevention)
const BENIGN_CONTEXT_PATTERNS = [
  /לא\s+זוכר.{0,20}סיסמה/i,
  /שכחתי.{0,20}סיסמה/i,
  /איפוס\s+סיסמה/i,
  /כיצד\s+להגדיר/i,
  /למשל|לדוגמה|לדוגמא|example|for\s+example/i,
  /placeholder|dummy|test|fake|sample/i,
];

const L3_THRESHOLD = 0.6; // סף ציון לחיובי

export function l3ContextInference(text) {
  const findings = [];
  const start = Date.now();

  // בדיקת הקשר בנאלי
  const isBenign = BENIGN_CONTEXT_PATTERNS.some((p) => p.test(text));
  if (isBenign) {
    return { level: "L3", findings: [], elapsed: Date.now() - start, benignContext: true };
  }

  let totalScore = 0;

  for (const { pattern, category, weight } of HEBREW_SENSITIVE_TRIGGERS) {
    if (pattern.test(text)) {
      totalScore += weight;
      findings.push({
        level: "L3",
        id: category,
        triggerPattern: pattern.source,
        confidence: weight,
        severity: weight >= 0.85 ? "high" : "medium",
      });
    }
  }

  const elapsed = Date.now() - start;

  return {
    level: "L3",
    findings,
    elapsed,
    totalScore,
    triggered: totalScore >= L3_THRESHOLD,
  };
}

// ── Full Pipeline: הרצת שלושת שכבות ──
export function runTriage(text, organizationId) {
  const start = Date.now();

  // L1 – תמיד רץ
  const l1Result = l1FastScan(text);

  // אם L1 מצא PII בסמך גבוה – החזר מיד (מטרה: < 1ms)
  if (l1Result.hasHighConfidencePII && l1Result.elapsed < 2) {
    return {
      triggered: true,
      level: "L1",
      l1: l1Result,
      l2: null,
      l3: null,
      totalElapsed: Date.now() - start,
      findings: l1Result.findings,
    };
  }

  // L2 – Semantic Hashing
  const l2Result = l2SemanticHash(text, organizationId);

  // L3 – Hebrew NLP Context
  const l3Result = l3ContextInference(text);

  const allFindings = [
    ...l1Result.findings,
    ...l2Result.findings,
    ...l3Result.findings,
  ];

  const triggered =
    l1Result.findings.length > 0 ||
    l2Result.findings.length > 0 ||
    l3Result.triggered;

  return {
    triggered,
    level: triggered ? (l1Result.findings.length > 0 ? "L1" : l2Result.findings.length > 0 ? "L2" : "L3") : "CLEAN",
    l1: l1Result,
    l2: l2Result,
    l3: l3Result,
    totalElapsed: Date.now() - start,
    findings: allFindings,
  };
}

// ── סטטיסטיקות Triage ──
let triageStats = { l1Hits: 0, l2Hits: 0, l3Hits: 0, total: 0, clean: 0 };

export function recordTriageHit(level) {
  triageStats.total++;
  if (level === "L1") triageStats.l1Hits++;
  else if (level === "L2") triageStats.l2Hits++;
  else if (level === "L3") triageStats.l3Hits++;
  else triageStats.clean++;
}

export function getTriageStats() {
  const { l1Hits, l2Hits, l3Hits, total, clean } = triageStats;
  return {
    total,
    clean,
    l1Hits,
    l2Hits,
    l3Hits,
    l1Rate: total > 0 ? ((l1Hits / total) * 100).toFixed(1) + "%" : "0%",
    l2Rate: total > 0 ? ((l2Hits / total) * 100).toFixed(1) + "%" : "0%",
    l3Rate: total > 0 ? ((l3Hits / total) * 100).toFixed(1) + "%" : "0%",
  };
}
