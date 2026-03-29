import { NextResponse } from "next/server";
import {
  saveMappings,
  getMappingBySynthetic,
  saveLog,
  getCustomRules,
  isPolicyEnabled,
  recordRequest,
  recordPatternHit,
  saveAlert,
} from "@/lib/db";

// ── Synthetic data generators ────────────────────────────────────────────────
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function syntheticPhone() {
  const prefixes = ["050", "052", "053", "054", "055", "056", "057", "058"];
  const prefix = prefixes[randInt(0, prefixes.length - 1)];
  const num = String(randInt(1000000, 9999999));
  return `${prefix}-${num}`;
}

function syntheticLandline() {
  const areaCodes = ["02", "03", "04", "08", "09"];
  const area = areaCodes[randInt(0, areaCodes.length - 1)];
  const num = String(randInt(1000000, 9999999));
  return `${area}-${num}`;
}

function syntheticID() {
  return String(randInt(300000000, 399999999));
}

function syntheticEmail() {
  return `user_${randInt(100, 999)}@gmail.com`;
}

function syntheticCreditCard() {
  const g = () => String(randInt(1000, 9999));
  return `4${String(randInt(100, 999))} ${g()} ${g()} ${g()}`;
}

function syntheticIBAN() {
  const num = String(randInt(10, 99)) + String(randInt(100000000000000000, 999999999999999999));
  return `IL${num}`.slice(0, 23);
}

function syntheticIP() {
  return `${randInt(10, 199)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`;
}

function syntheticPassport() {
  return `${randInt(10000000, 39999999)}`;
}

function syntheticVehicle() {
  return `${randInt(10, 99)}-${randInt(100, 999)}-${randInt(10, 99)}`;
}

function syntheticBirthdate() {
  const d = String(randInt(1, 28)).padStart(2, "0");
  const m = String(randInt(1, 12)).padStart(2, "0");
  const y = randInt(1960, 2000);
  return `${d}/${m}/${y}`;
}

const KEYWORD_REPLACEMENTS = {
  "פרויקט סודי": ["פרויקט אלפא", "פרויקט בטא", "פרויקט גמא"],
  "דוח כספי": ["דוח רבעוני", "דוח שנתי", "דוח תקציבי"],
  "תוכנית אסטרטגית": ["תוכנית עבודה", "תוכנית פיתוח", "תוכנית שנתית"],
};

function syntheticKeyword(keyword) {
  const options = KEYWORD_REPLACEMENTS[keyword] || ["מידע פנימי"];
  return options[randInt(0, options.length - 1)];
}

function syntheticContextValue(type) {
  switch (type) {
    case "ADDRESS": return `רחוב הרצל ${randInt(1, 120)}, תל אביב`;
    case "FULL_NAME": return `ישראל ישראלי`;
    case "PASSWORD": return `P@ss${randInt(1000, 9999)}!`;
    case "BANK_ACCOUNT": return `${randInt(10, 99)}-${randInt(100000, 999999)}`;
    default: return `[REDACTED]`;
  }
}

// ── Patterns (extended) ──────────────────────────────────────────────────────
const PATTERNS = [
  {
    id: "CREDIT_CARD",
    policyId: "credit_card",
    regex: /\b4\d{3}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b|\b(?:5[1-5]\d{2}|2[2-7]\d{2})[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b|\b3[47]\d{2}[ -]?\d{6}[ -]?\d{5}\b/g,
    label: "כרטיס אשראי",
    generate: syntheticCreditCard,
    riskScore: 40,
  },
  {
    id: "EMAIL",
    policyId: "email",
    regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    label: "אימייל",
    generate: syntheticEmail,
    riskScore: 15,
  },
  {
    id: "PHONE",
    policyId: "phone",
    regex: /\b05\d[- ]?\d{3}[- ]?\d{4}\b/g,
    label: "טלפון נייד",
    generate: syntheticPhone,
    riskScore: 20,
  },
  {
    id: "LANDLINE",
    policyId: "phone",
    regex: /\b0[2348][- ]?\d{3}[- ]?\d{4}\b|\b09[- ]?\d{3}[- ]?\d{4}\b/g,
    label: "טלפון נייח",
    generate: syntheticLandline,
    riskScore: 15,
  },
  {
    id: "IBAN",
    policyId: "iban",
    regex: /\bIL\d{2}[0-9]{4}[0-9]{4}[0-9]{4}[0-9]{4}[0-9]{2,4}\b/g,
    label: "IBAN",
    generate: syntheticIBAN,
    riskScore: 35,
  },
  {
    id: "IP_ADDRESS",
    policyId: "ip_address",
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    label: "כתובת IP",
    generate: syntheticIP,
    riskScore: 10,
  },
  {
    id: "PASSPORT",
    policyId: "passport",
    regex: /\b[1-3][0-9]{7}\b/g,
    label: "דרכון",
    generate: syntheticPassport,
    riskScore: 30,
  },
  {
    id: "VEHICLE",
    policyId: "vehicle",
    regex: /\b\d{2}-\d{3}-\d{2}\b|\b\d{3}-\d{2}-\d{3}\b/g,
    label: "מספר רכב",
    generate: syntheticVehicle,
    riskScore: 10,
  },
  {
    id: "BIRTHDATE",
    policyId: "birthdate",
    regex: /\b(0?[1-9]|[12]\d|3[01])[\/\-.](0?[1-9]|1[0-2])[\/\-.](19|20)\d{2}\b/g,
    label: "תאריך לידה",
    generate: syntheticBirthdate,
    riskScore: 20,
  },
  // ID last – wide pattern, only when >= 9 digits and doesn't overlap others
  {
    id: "ID",
    policyId: "israeli_id",
    regex: /\b\d{9}\b/g,
    label: "תעודת זהות",
    generate: syntheticID,
    riskScore: 30,
  },
];

const KEYWORDS = [
  { keyword: "פרויקט סודי",      category: "PROJECT",  label: "מילות מפתח", policyId: "keywords", generate: () => syntheticKeyword("פרויקט סודי"),      riskScore: 25 },
  { keyword: "דוח כספי",          category: "FINANCE",  label: "מילות מפתח", policyId: "keywords", generate: () => syntheticKeyword("דוח כספי"),          riskScore: 30 },
  { keyword: "תוכנית אסטרטגית",  category: "STRATEGY", label: "מילות מפתח", policyId: "keywords", generate: () => syntheticKeyword("תוכנית אסטרטגית"),  riskScore: 25 },
];

// ── Context-aware detection ───────────────────────────────────────────────────
const CONTEXT_PATTERNS = [
  { regex: /(?:הכתובת\s+שלי\s+היא|אני\s+גר\s+ב[ה]?|כתובת\s*:)\s*([^\n,\.]{5,60})/gi,    type: "ADDRESS",      label: "כתובת",       riskScore: 15 },
  { regex: /(?:שם\s+מלא\s*:|השם\s+שלי\s+הוא|שמי)\s*([^\n,\.]{3,40})/gi,                  type: "FULL_NAME",    label: "שם מלא",      riskScore: 20 },
  { regex: /(?:סיסמ[הא]\s*:|password\s*:|הסיסמ[הא]\s+שלי)\s*(\S{4,})/gi,                  type: "PASSWORD",     label: "סיסמה",       riskScore: 50 },
  { regex: /(?:מספר\s+חשבון|חשבון\s+בנק)\s*[:\-]?\s*(\d[\d\- ]{5,20})/gi,                  type: "BANK_ACCOUNT", label: "חשבון בנק",   riskScore: 35 },
];

function detectFromContext(text) {
  if (!isPolicyEnabled("context")) return [];
  const hits = [];
  for (const { regex, type, label, riskScore } of CONTEXT_PATTERNS) {
    let m;
    regex.lastIndex = 0;
    while ((m = regex.exec(text)) !== null) {
      const captured = m[1]?.trim();
      if (captured) {
        hits.push({ original: captured, fullMatch: m[0], type, label, riskScore });
      }
    }
  }
  return hits;
}

// ── Threat score calculator ───────────────────────────────────────────────────
function calcThreatScore(replacements) {
  if (!replacements.length) return 0;
  let score = 0;
  const seen = new Set();
  for (const r of replacements) {
    score += r.riskScore || 10;
    seen.add(r.category);
  }
  // multiplier for diversity
  if (seen.size >= 3) score = Math.round(score * 1.5);
  else if (seen.size === 2) score = Math.round(score * 1.2);
  return Math.min(100, score);
}

// ── Main POST handler ─────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    const body = await request.json();
    const { text, mode = "paste", source = "api" } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    recordRequest();

    let redactedText = text;
    const replacements = [];
    // consistency cache: original → synthetic (within this request)
    const cache = new Map();
    // track replaced ranges to avoid double-replacing
    const replacedRanges = [];

    function overlaps(start, end) {
      return replacedRanges.some(([rangeStart, rangeEnd]) => start < rangeEnd && end > rangeStart);
    }

    // ── 1. Regex-based patterns ──────────────────────────────────────────────
    for (const pattern of PATTERNS) {
      if (!isPolicyEnabled(pattern.policyId)) continue;

      // typing mode: skip short ambiguous numbers
      if (mode === "typing" && pattern.id === "ID") continue;

      const matches = [];
      let m;
      const re = new RegExp(pattern.regex.source, pattern.regex.flags);
      while ((m = re.exec(text)) !== null) {
        matches.push({ original: m[0], index: m.index });
      }

      for (const { original, index } of matches) {
        const end = index + original.length;
        if (overlaps(index, end)) continue;

        // consistency: same original → same synthetic
        let synthetic = cache.get(original);
        if (!synthetic) {
          synthetic = pattern.generate();
          cache.set(original, synthetic);
        }

        replacedRanges.push([index, end]);
        replacements.push({ original, synthetic, label: pattern.label, category: pattern.id, riskScore: pattern.riskScore, index, end });
        recordPatternHit(pattern.label);
      }
    }

    // ── 2. Keyword patterns ──────────────────────────────────────────────────
    if (isPolicyEnabled("keywords")) {
      for (const kw of KEYWORDS) {
        const re = new RegExp(kw.keyword, "gi");
        let m;
        while ((m = re.exec(text)) !== null) {
          const original = m[0];
          const index = m.index;
          const end = index + original.length;
          if (overlaps(index, end)) continue;

          let synthetic = cache.get(original.toLowerCase());
          if (!synthetic) {
            synthetic = kw.generate();
            cache.set(original.toLowerCase(), synthetic);
          }

          replacedRanges.push([index, end]);
          replacements.push({ original, synthetic, label: kw.label, category: kw.category, riskScore: kw.riskScore, index, end });
          recordPatternHit(kw.label);
        }
      }
    }

    // ── 3. Context-aware detection ───────────────────────────────────────────
    const contextHits = detectFromContext(text);
    for (const hit of contextHits) {
      const index = text.indexOf(hit.original);
      if (index === -1) continue;
      const end = index + hit.original.length;
      if (overlaps(index, end)) continue;

      let synthetic = cache.get(hit.original);
      if (!synthetic) {
        synthetic = syntheticContextValue(hit.type);
        cache.set(hit.original, synthetic);
      }

      replacedRanges.push([index, end]);
      replacements.push({ original: hit.original, synthetic, label: hit.label, category: hit.type, riskScore: hit.riskScore, index, end });
      recordPatternHit(hit.label);
    }

    // ── 4. Custom rules ──────────────────────────────────────────────────────
    if (isPolicyEnabled("custom")) {
      const customRules = getCustomRules();
      for (const rule of customRules) {
        const re = new RegExp(escapeRegex(rule.word), "gi");
        let m;
        while ((m = re.exec(text)) !== null) {
          const original = m[0];
          const index = m.index;
          const end = index + original.length;
          if (overlaps(index, end)) continue;

          const synthetic = rule.replacement || `[${rule.category}_CUSTOM]`;
          replacedRanges.push([index, end]);
          replacements.push({ original, synthetic, label: rule.word, category: "CUSTOM", riskScore: 20, index, end });
          recordPatternHit("כלל מותאם");
        }
      }
    }

    // ── 5. Apply replacements by building result from segments ───────────────
    if (replacements.length) {
      // sort by start position ascending
      const sorted = [...replacements].sort((a, b) => a.index - b.index);
      let result = "";
      let cursor = 0;
      for (const r of sorted) {
        if (r.index < cursor) continue; // skip overlapping (already covered)
        result += text.slice(cursor, r.index);
        result += r.synthetic;
        cursor = r.end;
      }
      result += text.slice(cursor);
      redactedText = result;
    }

    // ── 6. Compute threat score ───────────────────────────────────────────────
    const threatScore = calcThreatScore(replacements);

    // ── 7. Save to store ──────────────────────────────────────────────────────
    if (replacements.length) {
      saveMappings(
        replacements.map(r => ({
          synthetic: r.synthetic,
          original: r.original,
          category: r.category,
          label: r.label,
          timestamp: new Date().toISOString(),
          source,
        }))
      );

      for (const r of replacements) {
        saveLog({
          type: r.label,
          category: r.category,
          synthetic: r.synthetic,
          source,
          status: "blocked",
          threatScore,
        });
      }

      // high-threat alert
      if (threatScore >= 80) {
        saveAlert({
          type: "HIGH_RISK",
          message: `בקשה בסיכון גבוה זוהתה (ציון: ${threatScore}). ${replacements.length} פריטים נחסמו.`,
          severity: "high",
        });
      }
    }

    // ── 8. Build backward-compatible mapping object ───────────────────────────
    const mapping = {};
    for (const r of replacements) {
      mapping[r.synthetic] = r.original;
    }

    return NextResponse.json({
      safe: replacements.length === 0,
      redactedText,
      replacements: replacements.map(r => ({
        original: r.original,
        placeholder: r.synthetic,
        synthetic: r.synthetic,
        label: r.label,
        category: r.category,
      })),
      mapping,
      threatScore,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[check-text] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// ── GET: reverse lookup ───────────────────────────────────────────────────────
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const synthetic = searchParams.get("synthetic");

    if (!synthetic) {
      return NextResponse.json({ error: "synthetic parameter is required" }, { status: 400 });
    }

    const entry = getMappingBySynthetic(synthetic);
    if (!entry) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      synthetic: entry.synthetic,
      original: entry.original,
      category: entry.category,
      label: entry.label,
      timestamp: entry.timestamp,
    });
  } catch (err) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
