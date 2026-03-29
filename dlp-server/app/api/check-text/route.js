// ── מנוע זיהוי PII מתקדם עם נתונים סינתטיים וזיהוי קונטקסטואלי ──
import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../lib/middleware.js";
import { generateSynthetic } from "../../../lib/synthetic.js";
import {
  saveMappings,
  getMappingByTag,
  saveLog,
  getPolicies,
  getCustomKeywords,
  getStats,
  saveAlert,
  trackRequest,
  recordUserActivity,
} from "../../../lib/db.js";
import { getDefaultPolicies, SEVERITY_SCORES } from "../../../lib/policies.js";

// ── תבניות Regex לזיהוי PII ──
const ALL_PATTERNS = [
  { id: "PHONE",          regex: /\b05\d[- ]?\d{3}[- ]?\d{4}\b/g,                                              label: "טלפון נייד",     policyId: "phone"     },
  { id: "LANDLINE",       regex: /\b0(?:2|3|4|8|9)[- ]?\d{3}[- ]?\d{4}\b/g,                                     label: "טלפון נייח",     policyId: "landline"  },
  { id: "CREDIT_CARD",    regex: /\b(?:4\d{3}|5[1-5]\d{2}|2[2-7]\d{2}|3[47]\d{2})[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b|\b3[47]\d{2}[ -]?\d{6}[ -]?\d{5}\b/g, label: "כרטיס אשראי",    policyId: "credit_card"},
  { id: "EMAIL",          regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,                           label: "אימייל",          policyId: "email"     },
  { id: "ID",             regex: /\b\d{9}\b/g,                                                                   label: "תעודת זהות",     policyId: "israeli_id"},
  { id: "IBAN",           regex: /\bIL\d{2}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{2,4}\b/gi,        label: "IBAN",            policyId: "iban"      },
  { id: "IP_ADDRESS",     regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g, label: "כתובת IP",    policyId: "ip_address"},
  { id: "VEHICLE",        regex: /\b\d{2,3}[- ]\d{2,3}[- ]\d{2,3}\b/g,                                         label: "מלוחית",         policyId: "vehicle"   },
  { id: "BIRTHDATE",      regex: /\b(?:0[1-9]|[12]\d|3[01])[\/.\-](?:0[1-9]|1[0-2])[\/.\-](?:19|20)\d{2}\b/g, label: "תאריך לידה",    policyId: "birthdate" },
  { id: "AWS_KEY",        regex: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,                                    label: "מפתח AWS",       policyId: "api_key"   },
  { id: "OPENAI_KEY",     regex: /\bsk-[a-zA-Z0-9]{20,}\b/g,                                                    label: "מפתח OpenAI",    policyId: "api_key"   },
];

// מילות מפתח ברירת מחדל
const DEFAULT_KEYWORDS = [
  { keyword: "פרויקט סודי",       category: "PROJECT",  label: "מילות מפתח", policyId: "keywords" },
  { keyword: "דוח כספי",          category: "FINANCE",  label: "מילות מפתח", policyId: "keywords" },
  { keyword: "תוכנית אסטרטגית",   category: "STRATEGY", label: "מילות מפתח", policyId: "keywords" },
  { keyword: "מידע סודי",         category: "SECRET",   label: "מילות מפתח", policyId: "keywords" },
  { keyword: "נתוני לקוחות",      category: "CLIENTS",  label: "מילות מפתח", policyId: "keywords" },
  { keyword: "חוזה סודי",         category: "CONTRACT", label: "מילות מפתח", policyId: "keywords" },
];

// ── זיהוי קונטקסטואלי (NLP פשוט) ──
const CONTEXT_PATTERNS = [
  {
    triggers: [/הכתובת שלי היא\s+/i, /אני גר ב[- ]?/i, /כתובת:\s*/i, /מגורים:\s*/i],
    category: "ADDRESS",
    label: "כתובת",
    policyId: "address",
    capture: /(.{5,60})/,
  },
  {
    triggers: [/השם שלי הוא\s+/i, /שם מלא:\s*/i, /שמי\s+/i, /קוראים לי\s+/i],
    category: "FULL_NAME",
    label: "שם מלא",
    policyId: "full_name",
    capture: /([\u05D0-\u05EA\s"'-]{3,30})/,
  },
  {
    triggers: [/סיסמה:\s*/i, /password:\s*/i, /הסיסמה שלי\s*(היא)?\s*/i, /pwd:\s*/i, /pass:\s*/i],
    category: "PASSWORD",
    label: "סיסמה",
    policyId: "password",
    capture: /(\S{4,32})/,
  },
  {
    triggers: [/מספר חשבון[: ]+/i, /חשבון בנק[: ]+/i, /account number:\s*/i],
    category: "BANK_ACCOUNT",
    label: "חשבון בנק",
    policyId: "bank_account",
    capture: /([\d\-]{5,20})/,
  },
  {
    triggers: [/מפתח api[: ]+/i, /api key:\s*/i, /token:\s*/i, /bearer\s+/i, /secret:\s*/i],
    category: "API_SECRET",
    label: "מפתח API",
    policyId: "api_key",
    capture: /(\S{8,64})/,
  },
  {
    triggers: [/דרכון[: ]+/i, /passport[: ]+/i, /מספר דרכון[: ]*/i],
    category: "PASSPORT",
    label: "דרכון",
    policyId: "passport",
    capture: /(\d{8})/,
  },
];

// ── בדיקה האם מדיניות מסוימת מופעלת ──
function isPolicyEnabled(policies, policyId) {
  const p = policies.find((pol) => pol.id === policyId);
  return p ? p.enabled : true; // ברירת מחדל: מופעל
}

// ── חישוב ציון איום ──
function calcThreatScore(replacements, policies) {
  if (replacements.length === 0) return 0;
  let score = 0;
  const seen = new Set();
  for (const r of replacements) {
    const policy = policies.find((p) => p.id === r.policyId);
    const severity = policy?.severity || "medium";
    score += SEVERITY_SCORES[severity] || 10;
    seen.add(r.category);
  }
  // בונוס לגיוון קטגוריות
  score += (seen.size - 1) * 5;
  return Math.min(100, Math.round(score));
}

// ── POST: זיהוי והחלפת PII ──
export async function POST(request) {
  try {
    const auth = await authenticateRequest(request);
    const { organizationId } = auth;

    const body = await request.json();
    const { text, source = "api", mode = "paste", userEmail = "anonymous@unknown.com" } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    // טעינת מדיניות הארגון
    let orgPolicies = getPolicies(organizationId);
    if (!orgPolicies) {
      orgPolicies = getDefaultPolicies(organizationId);
    }

    // מילות מפתח מותאמות
    const customKws = getCustomKeywords(organizationId);

    // מטמון עקביות: אותו ערך מקורי → אותו סינתטי
    const consistencyCache = new Map();

    let redactedText = text;
    const replacements = [];
    const mappingEntries = [];

    // ── 1. זיהוי Regex ──
    for (const { id, regex, label, policyId } of ALL_PATTERNS) {
      if (!isPolicyEnabled(orgPolicies, policyId)) continue;

      // יצירת מופע regex חדש בכל פעם למניעת בעיות state עם lastIndex
      const freshRegex = new RegExp(regex.source, regex.flags);
      const matches = [...text.matchAll(freshRegex)];

      for (const match of matches) {
        const original = match[0];
        // מניעת כפילויות
        if (replacements.some((r) => r.original === original)) continue;

        const synthetic = generateSynthetic(id, original, consistencyCache);
        replacements.push({ original, synthetic, label, category: id, policyId });
        mappingEntries.push({ tag: synthetic, originalText: original, category: id, label, source });
      }
    }

    // ── 2. זיהוי קונטקסטואלי ──
    for (const { triggers, category, label, policyId, capture } of CONTEXT_PATTERNS) {
      if (!isPolicyEnabled(orgPolicies, policyId)) continue;

      for (const trigger of triggers) {
        const combined = new RegExp(trigger.source + capture.source, "gi");
        let m;
        while ((m = combined.exec(text)) !== null) {
          const original = m[1]?.trim();
          if (!original || original.length < 2) continue;
          if (replacements.some((r) => r.original === original)) continue;

          const synthetic = generateSynthetic(category, original, consistencyCache);
          replacements.push({ original, synthetic, label, category, policyId });
          mappingEntries.push({ tag: synthetic, originalText: original, category, label, source });
        }
      }
    }

    // ── 3. מילות מפתח ברירת מחדל ──
    if (isPolicyEnabled(orgPolicies, "keywords")) {
      for (const { keyword, category, label, policyId } of DEFAULT_KEYWORDS) {
        const kwRegex = new RegExp(keyword, "gi");
        const matches = [...text.matchAll(kwRegex)];
        for (const match of matches) {
          const original = match[0];
          if (replacements.some((r) => r.original === original)) continue;
          const synthetic = generateSynthetic(category, original, consistencyCache);
          replacements.push({ original, synthetic, label, category, policyId });
          mappingEntries.push({ tag: synthetic, originalText: original, category, label, source });
        }
      }
    }

    // ── 4. מילות מפתח מותאמות לארגון ──
    for (const kw of customKws) {
      const kwRegex = new RegExp(kw.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const matches = [...text.matchAll(kwRegex)];
      for (const match of matches) {
        const original = match[0];
        if (replacements.some((r) => r.original === original)) continue;
        const synthetic = kw.replacement
          ? kw.replacement
          : generateSynthetic("CUSTOM", original, consistencyCache);
        replacements.push({ original, synthetic, label: kw.category, category: kw.category, policyId: "keywords" });
        mappingEntries.push({ tag: synthetic, originalText: original, category: kw.category, label: kw.category, source });
      }
    }

    // ── 5. החלפה כירורגית ──
    // מיון לפי אורך (ארוך ראשון) למניעת החלפות חופפות
    const sortedReplacements = [...replacements].sort(
      (a, b) => b.original.length - a.original.length
    );
    for (const { original, synthetic } of sortedReplacements) {
      // החלפת כל המופעים של original
      const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      redactedText = redactedText.replace(new RegExp(escaped, "g"), synthetic);
    }

    // ── 6. חישוב ציון איום ──
    const threatScore = calcThreatScore(replacements, orgPolicies);

    // ── 7. שמירת מיפויים ולוג ──
    if (mappingEntries.length > 0) {
      saveMappings(organizationId, mappingEntries);
    }

    // ── 7b. רישום פעילות משתמש ──
    for (const rep of replacements) {
      recordUserActivity(userEmail, rep.category, { source });
    }

    // סוג מידע עיקרי
    const primaryType =
      replacements.length > 0
        ? replacements[0].label
        : "ניקי";

    saveLog(organizationId, {
      type: primaryType,
      synthetic: replacements[0]?.synthetic || "",
      originalText: replacements[0]?.original || "",
      source,
      userEmail,
      status: replacements.length > 0 ? "blocked" : "clean",
      threatScore,
      detectionCount: replacements.length,
      replacements,
    });

    // ── 8. זיהוי אנומליה ──
    const reqPerMinute = trackRequest(organizationId);
    if (reqPerMinute > 30) {
      saveAlert(organizationId, {
        type: "RATE_SPIKE",
        message: `זוהה קצב בקשות חריג: ${reqPerMinute} בקשות בדקה`,
        severity: "high",
      });
    }
    if (threatScore >= 80) {
      saveAlert(organizationId, {
        type: "HIGH_THREAT",
        message: `ציון איום קריטי: ${threatScore}/100 – ${replacements.length} פריטי PII זוהו`,
        severity: "critical",
      });
    }

    return NextResponse.json(
      {
        safe: replacements.length === 0,
        redactedText,
        replacements: replacements.map(({ original: _o, ...rest }) => rest),
        threatScore,
        detectionCount: replacements.length,
        timestamp: new Date().toISOString(),
        organizationId,
        userEmail,
      },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, x-api-key",
        },
      }
    );
  } catch (err) {
    if (err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[check-text] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// ── GET: שחזור ערך מקורי לפי ערך סינתטי (tag) ──
export async function GET(request) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
  };
  try {
    const { searchParams } = new URL(request.url);
    // Support both "tag" (primary) and legacy "synthetic" param
    const tag = searchParams.get("tag") || searchParams.get("synthetic");

    if (!tag) {
      return NextResponse.json(
        { error: "tag param is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    const mapping = getMappingByTag(tag);
    if (!mapping) {
      return NextResponse.json(
        { found: false, originalText: tag },
        { status: 200, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        found: true,
        originalText: mapping.originalText,
        synthetic: mapping.tag,
        category: mapping.category,
        label: mapping.label,
        createdAt: mapping.createdAt,
      },
      { headers: corsHeaders }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    },
  });
}
