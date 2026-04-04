/**
 * evasion.js – Server-side evasion normalisation for GhostLayer DLP
 *
 * Mirrors the key normalisation steps from the local-agent's evasion-detector.js
 * so that the cloud check-text endpoint is equally resistant to obfuscation attacks.
 *
 * All processing is synchronous and CPU-light.
 */

// ── Homoglyph table (Cyrillic / Greek / full-width → ASCII) ──────────────────
const HOMOGLYPH_MAP = {
  "\u0430":"a","\u0435":"e","\u043E":"o","\u0440":"p","\u0441":"c","\u0443":"y","\u0445":"x",
  "\u0410":"A","\u0412":"B","\u0415":"E","\u041A":"K","\u041C":"M","\u041D":"H","\u041E":"O",
  "\u0420":"P","\u0421":"C","\u0422":"T","\u0423":"Y","\u0425":"X",
  "\u03B1":"a","\u03B2":"b","\u03B5":"e","\u03B9":"i","\u03BF":"o","\u03C1":"p",
  "\u03C3":"s","\u03C4":"t","\u03C5":"u","\u03C7":"x",
  "\u0391":"A","\u0392":"B","\u0395":"E","\u0397":"H","\u0399":"I","\u039A":"K",
  "\u039C":"M","\u039D":"N","\u039F":"O","\u03A1":"P","\u03A4":"T","\u03A5":"Y","\u03A7":"X",
  ...Object.fromEntries(
    Array.from({ length: 26 }, (_, i) => [
      [String.fromCodePoint(0xFF21 + i), String.fromCodePoint(65 + i)],
      [String.fromCodePoint(0xFF41 + i), String.fromCodePoint(97 + i)],
    ]).flat(),
  ),
};

const HOMOGLYPH_CHARS = Object.keys(HOMOGLYPH_MAP).join("");
const HOMOGLYPH_RE    = new RegExp(`[${HOMOGLYPH_CHARS}]`, "g");

const ZERO_WIDTH_RE      = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/g;
const COMBINING_MARKS_RE = /[\u0300-\u036F\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g;
const EXOTIC_WS_RE       = /[\t\r\f\v\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g;
const RTL_OVERRIDE_RE    = /\u202E(.+?)(?=\u202C|\u200F|$)/g;
const HTML_TAG_RE        = /<\/?[a-zA-Z][^>]*>/g;
const HTML_ENTITY_RE     = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g;
const HEX_ESCAPE_RE      = /(?:\\x[0-9a-fA-F]{2}){4,}/g;
const BASE64_RE          = /(?<![A-Za-z0-9+/])([A-Za-z0-9+/]{20,}={0,2})(?![A-Za-z0-9+/=])/g;
const NON_STD_DELIM_RE   = /(?:\|{3,}|~{3,}|;{3,}|\^{3,}|\*{3,})/g;

const LEET_MAP  = {"0":"o","1":"i","3":"e","4":"a","5":"s","7":"t","8":"b","@":"a","$":"s"};
const LEET_RE   = /\b(?=[a-zA-Z0-9@$!|+]*[0-9@$!|+][a-zA-Z0-9@$!|+]*[a-zA-Z][a-zA-Z0-9@$!|+]{2,})[a-zA-Z0-9@$!|+]{4,}\b/g;

const HTML_ENTITIES = {
  "&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&apos;":"'","&nbsp;":" ",
};

const ROLEPLAY_SIGNALS = [
  /\b(?:act|pretend|imagine|roleplay|role.play|assume|behave)\s+as\s+(?:if|a|an|the)/i,
  /\b(?:you are now|you're now|from now on you)/i,
  /\b(?:grandm[ao]|grandmother|granny)\b.*(?:number|card|id|secret|password|code|pin)/i,
  /\b(?:for a (?:story|novel|book|movie|film|screenplay|game))\b/i,
  /\b(?:hypothetically|theoretically|in a fictional)\b/i,
  /\b(?:developer mode|jailbreak|ignore (?:previous|prior|all) instructions)\b/i,
];

function decodeHtmlEntities(text) {
  return text.replace(HTML_ENTITY_RE, (e) => {
    if (HTML_ENTITIES[e]) return HTML_ENTITIES[e];
    const n = e.match(/^&#(\d+);$/); if (n) return String.fromCodePoint(Number(n[1]));
    const h = e.match(/^&#x([0-9a-fA-F]+);$/i); if (h) return String.fromCodePoint(parseInt(h[1],16));
    return e;
  });
}

function tryDecodeBase64(b64) {
  try {
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    if (/[\x20-\x7E\u05D0-\u05EA]/.test(decoded) && decoded.length > 4) return decoded;
  } catch { /* ignore */ }
  return null;
}

function extractJsonValues(text) {
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return "";
  try {
    const obj = JSON.parse(t);
    const vals = [];
    function collect(node) {
      if (typeof node === "string" || typeof node === "number") { vals.push(String(node)); return; }
      if (Array.isArray(node)) { node.forEach(collect); return; }
      if (node && typeof node === "object") Object.values(node).forEach(collect);
    }
    collect(obj);
    return vals.join(" ");
  } catch { return ""; }
}

/**
 * Normalise obfuscated text and return both the canonical form and detected techniques.
 *
 * @param {string} text
 * @returns {{ normalized: string, evasionTechniques: string[], hasRoleplayInjection: boolean, extraFragments: string[] }}
 */
export function normalizeText(text) {
  if (!text || typeof text !== "string") {
    return { normalized: "", evasionTechniques: [], hasRoleplayInjection: false, extraFragments: [] };
  }

  const techniques = [];
  const extras = [];
  let t = text;

  // RTL override
  const preRtl = t;
  t = t.replace(RTL_OVERRIDE_RE, (_, inner) => inner.split("").reverse().join("")).replace(/\u202E/g, "");
  if (t !== preRtl) techniques.push("RTL_OVERRIDE");

  // Zero-width chars
  const preZw = t;
  t = t.replace(ZERO_WIDTH_RE, "");
  if (t !== preZw) techniques.push("ZERO_WIDTH_CHARS");

  // Combining marks
  const preCm = t;
  t = t.replace(COMBINING_MARKS_RE, "");
  if (t !== preCm) techniques.push("COMBINING_MARKS");

  // HTML
  const preHtml = t;
  t = decodeHtmlEntities(t.replace(HTML_TAG_RE, " "));
  if (t !== preHtml) techniques.push("HTML_OBFUSCATION");

  // Homoglyphs
  const preH = t;
  t = t.replace(HOMOGLYPH_RE, (ch) => HOMOGLYPH_MAP[ch] || ch);
  if (t !== preH) techniques.push("HOMOGLYPHS");

  // Punctuation injection (S.e.c.r.e.t → Secret)
  const prePi = t;
  t = t.replace(/\b(\w)([\s.\-_,/\\|])(?=\w\2|\w\b)(\w(?:\2\w)+)\b/g,
    (m) => m.replace(/[\s.\-_,/\\|]+/g, ""));
  if (t !== prePi) techniques.push("PUNCTUATION_INJECTION");

  // Exotic whitespace
  const preWs = t;
  t = t.replace(EXOTIC_WS_RE, " ");
  if (t !== preWs) techniques.push("WHITESPACE_VARIATION");

  // Hex
  const preHex = t;
  t = t.replace(HEX_ESCAPE_RE, (m) => {
    try { return Buffer.from(m.match(/[0-9a-fA-F]{2}/g).map(h => parseInt(h,16))).toString("utf8"); }
    catch { return m; }
  });
  if (t !== preHex) techniques.push("HEX_ENCODING");

  // Base64
  const preB64 = t;
  t = t.replace(BASE64_RE, (_, b64) => { const d = tryDecodeBase64(b64); return d ? ` ${d} ` : b64; });
  if (t !== preB64) techniques.push("BASE64_ENCODING");

  // Leetspeak
  const preLeet = t;
  t = t.replace(LEET_RE, (w) => w.replace(/[0-9@$!|+]/g, (c) => LEET_MAP[c] ?? c));
  if (t !== preLeet) techniques.push("LEETSPEAK");

  // Non-standard delimiters
  const preD = t;
  t = t.replace(NON_STD_DELIM_RE, " ");
  if (t !== preD) techniques.push("NON_STANDARD_DELIMITERS");

  // JSON/XML fragmentation
  const jsonVals = extractJsonValues(text);
  if (jsonVals) { techniques.push("JSON_FRAGMENTATION"); extras.push(jsonVals); }

  // Code comments
  const comments = (text.match(/\/\/[^\n]*/g) || []).concat(text.match(/\/\*[\s\S]*?\*\//g) || [])
    .map(c => c.replace(/^\/\/|\/\*|\*\//g,"").trim()).filter(Boolean).join(" ");
  if (comments) extras.push(comments);

  // Roleplay injection
  const hasRoleplayInjection = ROLEPLAY_SIGNALS.some(re => re.test(text));
  if (hasRoleplayInjection) techniques.push("ROLEPLAY_INJECTION");

  return {
    normalized: t,
    evasionTechniques: [...new Set(techniques)],
    hasRoleplayInjection,
    extraFragments: [...new Set(extras.filter(Boolean))],
  };
}
