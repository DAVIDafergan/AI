// ── מנוע זיהוי PII מתקדם עם נתונים סינתטיים וזיהוי קונטקסטואלי ──
export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";
import { authenticateRequest, getCorsHeaders } from "../../../lib/middleware.js";
import { checkRateLimit, RATE_LIMIT_MAX } from "../../../lib/rate-limiter.js";
import { generateSynthetic } from "../../../lib/synthetic.js";
import { normalizeText } from "../../../lib/evasion.js";
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
  connectMongo,
  Tenant,
} from "../../../lib/db.js";
import { getDefaultPolicies, SEVERITY_SCORES } from "../../../lib/policies.js";
import { runTriageWithStats } from "../../../lib/triage.js";

/**
 * Build CORS headers for the check-text endpoint.
 * Uses getCorsHeaders() based on the ALLOWED_ORIGINS environment variable.
 * If the origin is not in the allowed list, returns an empty object so the
 * browser enforces the CORS restriction (fail-secure).
 * @param {Request} request
 * @returns {Record<string,string>}
 */
function buildCorsHeaders(request) {
  return getCorsHeaders(request) ?? {};
}

// ── תבניות Regex לזיהוי PII ──
const ALL_PATTERNS = [
  { id: "PHONE",          regex: /\b05\d[- ]?\d{3}[- ]?\d{4}\b/g,                                              label: "טלפון נייד",                   policyId: "phone"       },
  { id: "LANDLINE",       regex: /\b0(?:2|3|4|8|9)[- ]?\d{3}[- ]?\d{4}\b/g,                                     label: "טלפון נייח",                   policyId: "landline"    },
  { id: "CREDIT_CARD",    regex: /\b(?:4\d{3}|5[1-5]\d{2}|2[2-7]\d{2}|3[47]\d{2})[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b|\b3[47]\d{2}[ -]?\d{6}[ -]?\d{5}\b/g, label: "כרטיס אשראי", policyId: "credit_card" },
  { id: "EMAIL",          regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,                           label: "אימייל",                        policyId: "email"       },
  { id: "ID",             regex: /\b\d{9}\b/g,                                                                   label: "תעודת זהות",                   policyId: "israeli_id"  },
  { id: "IBAN",           regex: /\bIL\d{2}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{2,4}\b/gi,        label: "IBAN",                          policyId: "iban"        },
  { id: "IP_ADDRESS",     regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g, label: "כתובת IP",                 policyId: "ip_address"  },
  { id: "VEHICLE",        regex: /\b\d{2,3}[- ]\d{2,3}[- ]\d{2,3}\b/g,                                         label: "מלוחית",                       policyId: "vehicle"     },
  { id: "BIRTHDATE",      regex: /\b(?:0[1-9]|[12]\d|3[01])[\/.\-](?:0[1-9]|1[0-2])[\/.\-](?:19|20)\d{2}\b/g, label: "תאריך לידה",                  policyId: "birthdate"   },
  // ── מפתחות API וסודות קוד ──
  { id: "AWS_KEY",        regex: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,                                    label: "מפתח AWS",                     policyId: "api_key",   severity: "critical" },
  { id: "OPENAI_KEY",     regex: /\bsk-[a-zA-Z0-9]{20,}\b/g,                                                    label: "מפתח OpenAI",                  policyId: "api_key",   severity: "critical" },
  { id: "GITHUB_TOKEN",   regex: /\b(?:ghp|gho|ghs|ghr|ghu)_[A-Za-z0-9]{36,}\b/g,                                  label: "GitHub Token",                 policyId: "api_key",   severity: "critical" },
  { id: "GOOGLE_API_KEY", regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g,                                                label: "Google API Key",               policyId: "api_key",   severity: "critical" },
  { id: "JWT_TOKEN",      regex: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,                         label: "JWT Token",                    policyId: "api_key",   severity: "critical" },
  { id: "PEM_KEY",        regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,                                   label: "Private Key (PEM)",            policyId: "api_key",   severity: "critical" },
  { id: "MONGODB_URI",    regex: /mongodb(?:\+srv)?:\/\/[^\s]+/g,                                               label: "MongoDB Connection String",    policyId: "api_key",   severity: "critical" },
  { id: "POSTGRES_URI",   regex: /postgres(?:ql)?:\/\/[^\s]+/g,                                                 label: "PostgreSQL Connection String", policyId: "api_key",   severity: "critical" },
  { id: "INTERNAL_IP",    regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g, label: "כתובת IP פנימית", policyId: "ip_address", severity: "high" },
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

// ── סף חומרת איום (Threat severity thresholds) ──
const THREAT_CRITICAL_THRESHOLD = 80;
const THREAT_HIGH_THRESHOLD     = 50;
const THREAT_MEDIUM_THRESHOLD   = 20;

// ── Payload size limit ──
const MAX_TEXT_LENGTH = 10_000;

// ── POST: זיהוי והחלפת PII ──
export async function POST(request) {
  try {
    const auth = await authenticateRequest(request);
    const { organizationId } = auth;

    // ── Rate limiting ──
    const rawApiKey = request.headers.get("x-api-key");
    // Prefer the API key as the rate-limit key because it is already authenticated.
    // Fall back to the leftmost IP in x-forwarded-for (set by a trusted reverse
    // proxy).  Note: if the application is exposed directly without a proxy this
    // header can be spoofed; deploy behind a proxy (nginx, Cloudflare, etc.) that
    // strips/overwrites x-forwarded-for to mitigate spoofing.
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
    const rateLimitKey = rawApiKey || ip;

    const { allowed, remaining, retryAfter } = await checkRateLimit(rateLimitKey);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too Many Requests" },
        {
          status: 429,
          headers: {
            ...buildCorsHeaders(request),
            "Retry-After": String(retryAfter),
            "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const body = await request.json();
    const { text, source = "api", mode = "paste", userEmail = "anonymous@unknown.com" } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400, headers: buildCorsHeaders(request) });
    }

    // ── Payload size limit (prevents ReDoS and memory exhaustion) ──
    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `Payload Too Large: text must not exceed ${MAX_TEXT_LENGTH} characters` },
        { status: 413, headers: buildCorsHeaders(request) }
      );
    }

    // ── Tier 0: Evasion normalisation ─────────────────────────────────────
    const {
      normalized: normalizedText,
      evasionTechniques,
      hasRoleplayInjection,
      extraFragments,
    } = normalizeText(text);

    // If roleplay injection detected, block immediately
    if (hasRoleplayInjection) {
      await saveAlert(organizationId, {
        type:       "ROLEPLAY_INJECTION",
        userEmail,
        techniques: evasionTechniques,
        timestamp:  new Date().toISOString(),
      }).catch(() => {});
      return NextResponse.json({
        safe:           false,
        blocked:        true,
        reason:         "Prompt injection / roleplay evasion attempt detected.",
        evasionTechniques,
        replacements:   [],
        redactedText:   text,
        threatScore:    100,
      });
    }

    // Scan both the normalised text and any extracted fragments
    const scanTargets = [normalizedText, ...extraFragments];

    // טעינת מדיניות הארגון
    let orgPolicies = await getPolicies(organizationId);
    if (!orgPolicies) {
      orgPolicies = getDefaultPolicies(organizationId);
    }

    // מילות מפתח מותאמות
    const customKws = await getCustomKeywords(organizationId);

    // ── Triage מהיר לפני סריקה מלאה ──
    // Run triage on the normalised text so obfuscation doesn't bypass early exit
    const triageResult = runTriageWithStats(normalizedText);

    // מטמון עקביות: אותו ערך מקורי → אותו סינתטי
    const consistencyCache = new Map();

    let redactedText = text;
    const replacements = [];
    const mappingEntries = [];

    // ── 1. זיהוי Regex (run on all scan targets) ──
    for (const scanText of scanTargets) {
      for (const { id, regex, label, policyId } of ALL_PATTERNS) {
        if (!isPolicyEnabled(orgPolicies, policyId)) continue;

        // יצירת מופע regex חדש בכל פעם למניעת בעיות state עם lastIndex
        const freshRegex = new RegExp(regex.source, regex.flags);
        const matches = [...scanText.matchAll(freshRegex)];

        for (const match of matches) {
          const original = match[0];
          // מניעת כפילויות
          if (replacements.some((r) => r.original === original)) continue;

          const synthetic = generateSynthetic(id, original, consistencyCache);
          replacements.push({ original, synthetic, label, category: id, policyId });
          mappingEntries.push({ tag: synthetic, originalText: original, category: id, label, source });
        }
      }
    }

    // ── 2. זיהוי קונטקסטואלי ──
    for (const scanText of scanTargets) {
      for (const { triggers, category, label, policyId, capture } of CONTEXT_PATTERNS) {
        if (!isPolicyEnabled(orgPolicies, policyId)) continue;

        for (const trigger of triggers) {
          const combined = new RegExp(trigger.source + capture.source, "gi");
          let m;
          while ((m = combined.exec(scanText)) !== null) {
            const original = m[1]?.trim();
            if (!original || original.length < 2) continue;
            if (replacements.some((r) => r.original === original)) continue;

            const synthetic = generateSynthetic(category, original, consistencyCache);
            replacements.push({ original, synthetic, label, category, policyId });
            mappingEntries.push({ tag: synthetic, originalText: original, category, label, source });
          }
        }
      }
    }

    // ── 3. מילות מפתח ברירת מחדל ──
    if (isPolicyEnabled(orgPolicies, "keywords")) {
      for (const scanText of scanTargets) {
        for (const { keyword, category, label, policyId } of DEFAULT_KEYWORDS) {
          const kwRegex = new RegExp(keyword, "gi");
          const matches = [...scanText.matchAll(kwRegex)];
          for (const match of matches) {
            const original = match[0];
            if (replacements.some((r) => r.original === original)) continue;
            const synthetic = generateSynthetic(category, original, consistencyCache);
            replacements.push({ original, synthetic, label, category, policyId });
            mappingEntries.push({ tag: synthetic, originalText: original, category, label, source });
          }
        }
      }
    }

    // ── 4. מילות מפתח מותאמות לארגון ──
    for (const scanText of scanTargets) {
      for (const kw of customKws) {
        const kwRegex = new RegExp(kw.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        const matches = [...scanText.matchAll(kwRegex)];
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
    }

    // ── 5. החלפה כירורגית ──
    // מיון לפי אורך (ארוך ראשון) למניעת החלפות חופפות
    const sortedReplacements = [...replacements].sort(
      (a, b) => b.original.length - a.original.length
    );
    for (const { original, synthetic } of sortedReplacements) {
      // בניית regex שמכבד גבולות מילה (\b) כאשר הישות מתחילה/מסתיימת בתו מילה,
      // כדי למנוע החלפה חלקית שעלולה לפגוע בטקסט, רווחים, ניקוד או עיצוב Markdown/HTML.
      const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const prefix = /^\w/.test(original) ? "\\b" : "";
      const suffix = /\w$/.test(original) ? "\\b" : "";
      redactedText = redactedText.replace(new RegExp(`${prefix}${escaped}${suffix}`, "g"), synthetic);
    }

    // ── 6. חישוב ציון איום ──
    const threatScore = calcThreatScore(replacements, orgPolicies);

    // ── 7. שמירת מיפויים ולוג ──
    if (mappingEntries.length > 0) {
      try {
        await saveMappings(organizationId, mappingEntries);
      } catch (dbErr) {
        console.warn("[check-text] saveMappings failed:", dbErr.message);
      }
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

    try {
      await saveLog(organizationId, {
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
    } catch (dbErr) {
      console.warn("[check-text] saveLog failed:", dbErr.message);
    }

    // ── 8. זיהוי אנומליה ──
    const reqPerMinute = trackRequest(organizationId);
    if (reqPerMinute > 30) {
      saveAlert(organizationId, {
        type: "RATE_SPIKE",
        message: `זוהה קצב בקשות חריג: ${reqPerMinute} בקשות בדקה`,
        severity: "high",
      });
    }
    if (threatScore >= THREAT_CRITICAL_THRESHOLD) {
      saveAlert(organizationId, {
        type: "HIGH_THREAT",
        message: `ציון איום קריטי: ${threatScore}/100 – ${replacements.length} פריטי PII זוהו`,
        severity: "critical",
      });
    }

    // ── 9. עדכון שימוש ב-Tenant ──
    if (rawApiKey) {
      try {
        await connectMongo();
        const tenant = await Tenant.findOne({ apiKey: rawApiKey }).lean();
        if (tenant) {
          const blocksInc = replacements.length > 0 ? { "usage.totalBlocks": 1 } : {};
          await Tenant.updateOne(
            { _id: tenant._id },
            {
              $inc: { ...blocksInc, "usage.totalScans": 1, "usage.monthlyScans": 1 },
              $set: { "usage.lastActivity": new Date() },
            }
          );
        }
      } catch (mongoErr) {
        console.warn("[check-text] Tenant usage update failed:", mongoErr.message);
      }
    }

    return NextResponse.json(
      {
        safe: replacements.length === 0,
        redactedText,
        replacements,
        threatScore,
        detectionCount: replacements.length,
        triageLevel: triageResult.level,
        triageTiming: triageResult.timing,
        evasionTechniques,
        timestamp: new Date().toISOString(),
        organizationId,
        userEmail,
      },
      {
        headers: buildCorsHeaders(request),
      }
    );
  } catch (err) {
    if (err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: buildCorsHeaders(request) });
    }
    console.error("[check-text] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: buildCorsHeaders(request) });
  }
}

// ── GET: שחזור ערך מקורי לפי ערך סינתטי (tag) ──
export async function GET(request) {
  const corsHeaders = buildCorsHeaders(request);
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

    const mapping = await getMappingByTag(tag);
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

export async function OPTIONS(request) {
  return new NextResponse(null, {
    status: 204,
    headers: buildCorsHeaders(request),
  });
}
