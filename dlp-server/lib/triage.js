// ── מנוע Triage רב-שכבתי לזיהוי PII ──
// L1: סריקה מהירה עם Regex + Bloom Filter
// L2: Hash signatures מול מטמון מקומי
// L3: ניתוח קונטקסטואלי עברי (NER-style)

// ─────────────────────────────────────────────
// עזרים כלליים
// ─────────────────────────────────────────────

/** Luhn validation for credit card numbers */
function luhnCheck(num) {
  const digits = num.replace(/\D/g, "");
  let sum = 0;
  let isOdd = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (isOdd) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    isOdd = !isOdd;
  }
  return sum % 10 === 0;
}

/** Simple Luhn-like check for Israeli ID (9 digits) */
function israeliIdCheck(num) {
  const digits = num.replace(/\D/g, "");
  if (digits.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    let v = parseInt(digits[i], 10) * (i % 2 === 0 ? 1 : 2);
    if (v > 9) v -= 9;
    sum += v;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(digits[8], 10);
}

// ─────────────────────────────────────────────
// Bloom Filter – זיהוי מהיר של מילות מפתח רגישות
// ─────────────────────────────────────────────
const BLOOM_SIZE = 2048; // bits
const BLOOM_HASH_COUNT = 3;

function bloomHash(str, seed) {
  let h = seed ^ 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x9e3779b9);
    h ^= h >>> 16;
  }
  return Math.abs(h) % BLOOM_SIZE;
}

function buildBloomFilter(words) {
  const bits = new Uint8Array(Math.ceil(BLOOM_SIZE / 8));
  for (const w of words) {
    const lower = w.toLowerCase();
    for (let s = 0; s < BLOOM_HASH_COUNT; s++) {
      const bit = bloomHash(lower, s * 31);
      bits[Math.floor(bit / 8)] |= 1 << (bit % 8);
    }
  }
  return bits;
}

function bloomContains(bits, word) {
  const lower = word.toLowerCase();
  for (let s = 0; s < BLOOM_HASH_COUNT; s++) {
    const bit = bloomHash(lower, s * 31);
    if (!(bits[Math.floor(bit / 8)] & (1 << (bit % 8)))) return false;
  }
  return true;
}

// מילות מפתח רגישות ידועות
const KNOWN_SENSITIVE_KEYWORDS = [
  "password", "passwd", "secret", "api_key", "apikey", "access_token",
  "private_key", "credential", "token", "auth", "bearer",
  "סיסמה", "סיסמא", "מפתח", "אסור", "סודי", "פרטי", "אישי",
  "credit", "card", "cvv", "ssn", "social security",
];

const BLOOM_FILTER = buildBloomFilter(KNOWN_SENSITIVE_KEYWORDS);

// ─────────────────────────────────────────────
// L1 – Fast Scan (<1ms)
// ─────────────────────────────────────────────
const L1_PATTERNS = [
  {
    id: "PHONE",
    regex: /\b05\d[- ]?\d{3}[- ]?\d{4}\b/g,
    label: "טלפון נייד",
    confidence: "high",
  },
  {
    id: "LANDLINE",
    regex: /\b0(?:2|3|4|8|9)[- ]?\d{3}[- ]?\d{4}\b/g,
    label: "טלפון נייח",
    confidence: "high",
  },
  {
    id: "ID",
    regex: /\b\d{9}\b/g,
    label: "תעודת זהות",
    confidence: "medium",
    validate: israeliIdCheck,
  },
  {
    id: "CREDIT_CARD",
    regex: /\b(?:4\d{3}|5[1-5]\d{2}|2[2-7]\d{2}|3[47]\d{2})[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b|\b3[47]\d{2}[ -]?\d{6}[ -]?\d{5}\b/g,
    label: "כרטיס אשראי",
    confidence: "high",
    validate: (m) => luhnCheck(m),
  },
  {
    id: "EMAIL",
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    label: "אימייל",
    confidence: "high",
  },
  {
    id: "AWS_KEY",
    regex: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,
    label: "מפתח AWS",
    confidence: "high",
  },
  {
    id: "OPENAI_KEY",
    regex: /\bsk-[a-zA-Z0-9]{20,}\b/g,
    label: "מפתח OpenAI",
    confidence: "high",
  },
  {
    id: "GITHUB_TOKEN",
    regex: /\b(?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{36,}\b/g,
    label: "GitHub Token",
    confidence: "high",
  },
  {
    id: "GOOGLE_API_KEY",
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
    label: "Google API Key",
    confidence: "high",
  },
  {
    id: "JWT",
    regex: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    label: "JWT Token",
    confidence: "high",
  },
  {
    id: "INTERNAL_IP",
    regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g,
    label: "כתובת IP פנימית",
    confidence: "medium",
  },
  {
    id: "MONGODB_URI",
    regex: /mongodb(?:\+srv)?:\/\/[^\s]+/g,
    label: "MongoDB Connection String",
    confidence: "high",
  },
  {
    id: "POSTGRES_URI",
    regex: /postgres(?:ql)?:\/\/[^\s]+/g,
    label: "PostgreSQL Connection String",
    confidence: "high",
  },
  {
    id: "PEM_KEY",
    regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
    label: "Private Key (PEM)",
    confidence: "high",
  },
];

/**
 * L1: Fast Regex Scan + Bloom Filter
 * @param {string} text
 * @returns {{ found: boolean, matches: Array, bloomHit: boolean, duration: number }}
 */
export function triageL1(text) {
  const start = Date.now();
  const matches = [];

  // Quick bloom filter check on words
  let bloomHit = false;
  const words = text.split(/\s+/);
  for (const word of words) {
    if (word.length >= 4 && bloomContains(BLOOM_FILTER, word)) {
      bloomHit = true;
      break;
    }
  }

  // Regex patterns
  for (const { id, regex, label, confidence, validate } of L1_PATTERNS) {
    const freshRegex = new RegExp(regex.source, regex.flags);
    const found = [...text.matchAll(freshRegex)];
    for (const m of found) {
      const match = m[0];
      if (validate && !validate(match)) continue;
      matches.push({ id, label, match, confidence, index: m.index });
    }
  }

  return {
    found: matches.length > 0 || bloomHit,
    matches,
    bloomHit,
    duration: Date.now() - start,
  };
}

// ─────────────────────────────────────────────
// L2 – Semantic Hashing (local in-memory cache)
// ─────────────────────────────────────────────

// Simple djb2-like hash for text segments
function hashText(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // unsigned 32-bit
  }
  return hash.toString(16).padStart(8, "0");
}

// In-memory sensitive hash cache (simulates MongoDB sensitiveHashes collection)
const sensitiveHashCache = new Map(); // hash → { hash, category, label, addedAt }

/**
 * Add a known sensitive text hash to the L2 cache.
 * @param {string} text - The sensitive text to hash and store
 * @param {string} category - PII category
 * @param {string} label - Human-readable label
 */
export function addSensitiveHash(text, category, label = "") {
  const hash = hashText(text.trim().toLowerCase());
  sensitiveHashCache.set(hash, {
    hash,
    category,
    label,
    addedAt: new Date().toISOString(),
  });
  return hash;
}

/**
 * L2: Semantic Hash Scan
 * Splits text into segments and checks each against known hash cache.
 * @param {string} text
 * @returns {{ found: boolean, matches: Array, duration: number }}
 */
export function triageL2(text) {
  const start = Date.now();
  const matches = [];

  // Check full text hash
  const fullHash = hashText(text.trim().toLowerCase());
  if (sensitiveHashCache.has(fullHash)) {
    matches.push({ type: "full", ...sensitiveHashCache.get(fullHash) });
  }

  // Check word n-grams (2-5 words)
  const words = text.trim().split(/\s+/);
  for (let size = 2; size <= 5; size++) {
    for (let i = 0; i <= words.length - size; i++) {
      const segment = words.slice(i, i + size).join(" ");
      const hash = hashText(segment.toLowerCase());
      if (sensitiveHashCache.has(hash)) {
        matches.push({ type: "segment", segment, ...sensitiveHashCache.get(hash) });
      }
    }
  }

  return {
    found: matches.length > 0,
    matches,
    duration: Date.now() - start,
  };
}

// ─────────────────────────────────────────────
// L3 – Hebrew-aware Contextual Analysis (NLP)
// ─────────────────────────────────────────────

// Hebrew-aware sensitive context triggers
const HEBREW_CONTEXT_PATTERNS = [
  {
    trigger: /הסיסמה\s+שלי\s+(היא|הוא|:)?\s*(\S{4,32})/gi,
    category: "PASSWORD",
    label: "סיסמה (עברית)",
    weight: 40,
  },
  {
    trigger: /מספר\s+הכרטיס\s+(שלי\s+)?(הוא|:)?\s*([\d\s-]{13,19})/gi,
    category: "CREDIT_CARD",
    label: "כרטיס אשראי (עברית)",
    weight: 40,
  },
  {
    trigger: /ת\.?ז\.?\s+(שלי\s+)?(הוא|היא|:)?\s*(\d{9})/gi,
    category: "ID",
    label: "תעודת זהות (עברית)",
    weight: 40,
  },
  {
    trigger: /הטלפון\s+(שלי\s+)?(הוא|:)?\s*(0\d[\d\s-]{7,10})/gi,
    category: "PHONE",
    label: "טלפון (עברית)",
    weight: 35,
  },
  {
    trigger: /כתובת\s+(המייל\s+)?(שלי\s+)?(היא|:)?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
    category: "EMAIL",
    label: "אימייל (עברית)",
    weight: 35,
  },
  {
    trigger: /מפתח\s+ה?-?api\s*(שלי\s+)?(הוא|:)?\s*(\S{8,64})/gi,
    category: "API_SECRET",
    label: "מפתח API (עברית)",
    weight: 35,
  },
  {
    trigger: /חשבון\s+הבנק\s+(שלי\s+)?(הוא|:)?\s*([\d\-]{5,20})/gi,
    category: "BANK_ACCOUNT",
    label: "חשבון בנק (עברית)",
    weight: 40,
  },
];

// Generic keyword proximity scoring
const PROXIMITY_SIGNALS = [
  { pattern: /\b(סודי|confidential|private|secret)\b/gi, weight: 10 },
  { pattern: /\b(password|passwd|סיסמה)\b/gi, weight: 15 },
  { pattern: /\b(token|מפתח|api.?key)\b/gi, weight: 15 },
  { pattern: /\b(credit.?card|כרטיס.?אשראי)\b/gi, weight: 20 },
  { pattern: /\b(account|חשבון|social.?security|ת\.?ז)\b/gi, weight: 15 },
];

/**
 * L3: Contextual NLP analysis (Hebrew-aware)
 * @param {string} text
 * @returns {{ found: boolean, matches: Array, score: number, duration: number }}
 */
export function triageL3(text) {
  const start = Date.now();
  const matches = [];
  let score = 0;

  // Hebrew context pattern matching
  for (const { trigger, category, label, weight } of HEBREW_CONTEXT_PATTERNS) {
    const freshTrigger = new RegExp(trigger.source, trigger.flags);
    const found = [...text.matchAll(freshTrigger)];
    for (const m of found) {
      matches.push({
        category,
        label,
        match: m[0],
        capturedValue: m[m.length - 1]?.trim(),
        weight,
      });
      score += weight;
    }
  }

  // Proximity keyword scoring
  for (const { pattern, weight } of PROXIMITY_SIGNALS) {
    const freshPattern = new RegExp(pattern.source, pattern.flags);
    const count = [...text.matchAll(freshPattern)].length;
    score += count * weight;
  }

  // Context: distinguish benign vs sensitive
  // e.g. "התפוח שלי ירוק" should NOT trigger, "הסיסמה שלי היא תפוח" SHOULD
  const BENIGN_PATTERNS = [
    /\b(תפוח|עץ|ירוק|כחול|אדום|שמיים|מזג.?אוויר)\b/gi,
  ];
  const hasBenign = BENIGN_PATTERNS.some((p) => p.test(text));
  if (hasBenign && score < 20) {
    // Reduce score for clearly benign context
    score = Math.max(0, score - 15);
  }

  const THRESHOLD = 25;

  return {
    found: score >= THRESHOLD || matches.length > 0,
    matches,
    score,
    duration: Date.now() - start,
  };
}

// ─────────────────────────────────────────────
// Full Pipeline: run L1 → L2 → L3 as needed
// ─────────────────────────────────────────────

/**
 * Run the full triage pipeline on a text input.
 * Returns an aggregated result with all detected items and timing.
 *
 * @param {string} text
 * @returns {{
 *   safe: boolean,
 *   level: "l1"|"l2"|"l3"|"none",
 *   matches: Array,
 *   score: number,
 *   timing: { l1: number, l2: number|null, l3: number|null, total: number }
 * }}
 */
export function runTriage(text) {
  const totalStart = Date.now();

  // L1 – always run
  const l1 = triageL1(text);

  if (l1.found && l1.matches.length > 0) {
    // High-confidence L1 hit → return immediately
    const highConf = l1.matches.filter((m) => m.confidence === "high");
    if (highConf.length > 0) {
      return {
        safe: false,
        level: "l1",
        matches: l1.matches,
        score: highConf.length * 30,
        timing: { l1: l1.duration, l2: null, l3: null, total: Date.now() - totalStart },
      };
    }
  }

  // L2 – hash-based check
  const l2 = triageL2(text);
  if (l2.found) {
    return {
      safe: false,
      level: "l2",
      matches: [...l1.matches, ...l2.matches],
      score: l2.matches.length * 25 + l1.matches.length * 15,
      timing: { l1: l1.duration, l2: l2.duration, l3: null, total: Date.now() - totalStart },
    };
  }

  // L3 – only for "suspicious" text (bloom hit or medium-confidence L1)
  const suspicious = l1.bloomHit || l1.matches.length > 0;
  if (suspicious) {
    const l3 = triageL3(text);
    const allMatches = [...l1.matches, ...l3.matches];
    return {
      safe: !l3.found && l1.matches.length === 0,
      level: "l3",
      matches: allMatches,
      score: l3.score + l1.matches.length * 10,
      timing: { l1: l1.duration, l2: l2.duration, l3: l3.duration, total: Date.now() - totalStart },
    };
  }

  return {
    safe: true,
    level: "none",
    matches: [],
    score: 0,
    timing: { l1: l1.duration, l2: l2.duration, l3: null, total: Date.now() - totalStart },
  };
}

// ─────────────────────────────────────────────
// Triage statistics (for admin dashboard)
// ─────────────────────────────────────────────
const triageStats = {
  l1Hits: 0,
  l2Hits: 0,
  l3Hits: 0,
  totalRuns: 0,
  totalUnsafe: 0,
};

/**
 * Run triage and record stats.
 * @param {string} text
 */
export function runTriageWithStats(text) {
  const result = runTriage(text);
  triageStats.totalRuns++;
  if (!result.safe) {
    triageStats.totalUnsafe++;
    if (result.level === "l1") triageStats.l1Hits++;
    else if (result.level === "l2") triageStats.l2Hits++;
    else if (result.level === "l3") triageStats.l3Hits++;
  }
  return result;
}

/**
 * Get triage statistics for admin dashboard.
 */
export function getTriageStats() {
  const total = triageStats.totalUnsafe || 1; // avoid division by zero
  return {
    ...triageStats,
    l1HitRate: ((triageStats.l1Hits / total) * 100).toFixed(1),
    l2HitRate: ((triageStats.l2Hits / total) * 100).toFixed(1),
    l3HitRate: ((triageStats.l3Hits / total) * 100).toFixed(1),
  };
}
