/**
 * evasion-detector.js – GhostLayer Advanced Evasion Normalization Engine
 *
 * Normalises text that has been deliberately obfuscated in an attempt to
 * bypass DLP pattern matching, then returns both the canonical form and a
 * list of every evasion technique that was detected.
 *
 * Handles all major evasion categories:
 *
 *  1. Character-Level
 *     • Homoglyphs (Cyrillic / Greek / full-width look-alikes → ASCII)
 *     • Zero-Width characters (invisible Unicode spacers)
 *     • Combining marks / Zalgo diacritics
 *     • Punctuation injection (P.a.s.s.w.o.r.d → Password)
 *     • Whitespace variations (tabs, exotic spaces)
 *
 *  2. Encoding / Formatting
 *     • Base64 encoded payloads
 *     • Hex encoded strings (0x?? or \x?? sequences)
 *     • Leetspeak substitutions (4→a, 3→e, 0→o …)
 *     • RTL Override (U+202E reversal attack)
 *     • HTML / Markdown tag stripping
 *     • JSON / XML value extraction
 *
 *  3. Contextual
 *     • Roleplay prompt markers
 *     • Delimiter-separated data (||| ~~~ ;;; etc.)
 *     • Code-comment hidden data
 *     • Noise flooding (thousands of random words around sensitive content)
 *
 * All processing is synchronous and CPU-light – no network calls.
 *
 * @module evasion-detector
 */

// ── 1. Homoglyph table ──────────────────────────────────────────────────────
// Maps lookalike characters from Cyrillic, Greek, and other scripts to their
// ASCII equivalents.  The table is intentionally compact – covering only the
// characters that are commonly abused for DLP evasion.

const HOMOGLYPH_MAP = {
  // Cyrillic lower-case
  "\u0430": "a", // а
  "\u0435": "e", // е
  "\u043E": "o", // о
  "\u0440": "p", // р
  "\u0441": "c", // с
  "\u0443": "y", // у
  "\u0445": "x", // х
  "\u0456": "i", // і (Ukrainian/Belarusian і)
  "\u0455": "s", // ѕ
  // Cyrillic upper-case
  "\u0410": "A", // А
  "\u0412": "B", // В
  "\u0415": "E", // Е
  "\u041A": "K", // К
  "\u041C": "M", // М
  "\u041D": "H", // Н
  "\u041E": "O", // О
  "\u0420": "P", // Р
  "\u0421": "C", // С
  "\u0422": "T", // Т
  "\u0423": "Y", // У
  "\u0425": "X", // Х
  // Greek lower-case
  "\u03B1": "a", // α
  "\u03B2": "b", // β
  "\u03B5": "e", // ε
  "\u03B9": "i", // ι
  "\u03BF": "o", // ο
  "\u03C1": "p", // ρ
  "\u03C3": "s", // σ
  "\u03C4": "t", // τ
  "\u03C5": "u", // υ
  "\u03C7": "x", // χ
  // Greek upper-case
  "\u0391": "A", // Α
  "\u0392": "B", // Β
  "\u0395": "E", // Ε
  "\u0397": "H", // Η
  "\u0399": "I", // Ι
  "\u039A": "K", // Κ
  "\u039C": "M", // Μ
  "\u039D": "N", // Ν
  "\u039F": "O", // Ο
  "\u03A1": "P", // Ρ
  "\u03A4": "T", // Τ
  "\u03A5": "Y", // Υ
  "\u03A7": "X", // Χ
  // Full-width Latin (U+FF21–FF5A)
  ...Object.fromEntries(
    Array.from({ length: 26 }, (_, i) => [
      [String.fromCodePoint(0xFF21 + i), String.fromCodePoint(65 + i)],  // A–Z
      [String.fromCodePoint(0xFF41 + i), String.fromCodePoint(97 + i)],  // a–z
    ]).flat(),
  ),
  // Mathematical/script letter look-alikes (common in social-media evasion)
  "\u2174": "l", // ⅴ → misused as l
  "\u2113": "l", // ℓ
  "\u0131": "i", // ı (dotless i)
  "\u0399": "I", // already covered above but repeated for clarity
  "\u00F8": "o", // ø
  "\u00D8": "O", // Ø
  "\u00E6": "ae",// æ
};

// Build a regex that matches any homoglyph character for fast scanning.
const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPH_MAP).join("")}]`, "g");

/**
 * Replace all homoglyph characters in `text` with their ASCII equivalents.
 * @param {string} text
 * @returns {string}
 */
function replaceHomoglyphs(text) {
  return text.replace(HOMOGLYPH_RE, (ch) => HOMOGLYPH_MAP[ch] || ch);
}

// ── 2. Zero-width / invisible characters ────────────────────────────────────

const ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/g;

// ── 3. Combining marks (Zalgo diacritics) ────────────────────────────────────

// Unicode "Mark, Nonspacing" ranges that are abused for visual noise.
const COMBINING_MARKS_RE = /[\u0300-\u036F\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g;

// ── 4. Punctuation injection ─────────────────────────────────────────────────

// Matches a run of single characters separated by the same punctuation
// e.g. P.a.s.s.w.o.r.d  or  S-e-c-r-e-t  or  P a s s
// The separator must be consistent across at least 4 repetitions.
const PUNCT_INJECTION_RE = /(?:\b|(?<=\s))(\w)([\s.\-_,/\\|]{1,2})\1{0}(?:\w\2){3,}\w\b/g;

/**
 * Collapse punctuation-injected words.
 * "P.a.s.s.w.o.r.d" → "Password"
 * @param {string} text
 * @returns {string}
 */
function collapsePunctuationInjection(text) {
  // Strategy: find runs of "single-char SEPARATOR single-char SEPARATOR …"
  // and strip the separators.
  return text.replace(/\b(\w)([\s.\-_,/\\|])(?=\w\2|\w\b)(\w(?:\2\w)+)\b/g, (match) => {
    // Remove the separator characters and join
    return match.replace(/[\s.\-_,/\\|]+/g, "");
  });
}

// ── 5. Whitespace normalisation ──────────────────────────────────────────────

// All exotic whitespace variants → single ASCII space.
const EXOTIC_WS_RE = /[\t\r\f\v\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g;

// ── 6. RTL Override ──────────────────────────────────────────────────────────

// U+202E RIGHT-TO-LEFT OVERRIDE reverses the visual rendering of subsequent
// text.  We detect it and reverse the affected substring back to logical order.
const RTL_OVERRIDE = "\u202E";
const RTL_OVERRIDE_RE = /\u202E(.+?)(?=\u202C|\u200F|$)/g;

function expandRtlOverride(text) {
  if (!text.includes(RTL_OVERRIDE)) return text;
  return text.replace(RTL_OVERRIDE_RE, (_, inner) =>
    inner.split("").reverse().join(""),
  ).replace(/\u202E/g, "");
}

// ── 7. HTML / Markdown tag stripping ─────────────────────────────────────────

const HTML_TAG_RE    = /<\/?[a-zA-Z][^>]*>/g;
const HTML_ENTITY_RE = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g;

const HTML_ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'",
  "&nbsp;": " ", "&zwj;": "", "&zwnj;": "",
};

function decodeHtmlEntities(text) {
  return text
    .replace(HTML_ENTITY_RE, (entity) => {
      if (HTML_ENTITIES[entity]) return HTML_ENTITIES[entity];
      const numMatch = entity.match(/^&#(\d+);$/);
      if (numMatch) return String.fromCodePoint(Number(numMatch[1]));
      const hexMatch = entity.match(/^&#x([0-9a-fA-F]+);$/i);
      if (hexMatch) return String.fromCodePoint(parseInt(hexMatch[1], 16));
      return entity;
    });
}

function stripHtmlMarkdown(text) {
  return text
    .replace(HTML_TAG_RE, " ")          // remove tags but preserve spacing
    .replace(/`[^`]*`/g, (m) => m.replace(/`/g, "")) // strip inline code fences
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, "")) // strip code blocks
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")  // bold / italic
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1");   // underline / italic
}

// ── 8. Base64 detection & decoding ──────────────────────────────────────────

// Minimum length for a base64 blob worth decoding (heuristic: 20 chars = 15 bytes)
const BASE64_MIN_LEN = 20;
const BASE64_RE = /(?<![A-Za-z0-9+/])([A-Za-z0-9+/]{20,}={0,2})(?![A-Za-z0-9+/=])/g;

function tryDecodeBase64(b64) {
  try {
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    // Only treat as real decoded text if it contains printable ASCII / Hebrew
    if (/[\x20-\x7E\u05D0-\u05EA]/.test(decoded) && decoded.length > 4) {
      return decoded;
    }
  } catch {
    // ignore
  }
  return null;
}

function decodeBase64Payloads(text) {
  return text.replace(BASE64_RE, (_, b64) => {
    const decoded = tryDecodeBase64(b64);
    return decoded ? ` ${decoded} ` : b64;
  });
}

// ── 9. Hex encoding ──────────────────────────────────────────────────────────

// Matches: \x41\x42 style or 0x41 0x42 style sequences of at least 4 bytes
const HEX_ESCAPE_RE = /(?:\\x[0-9a-fA-F]{2}){4,}/g;
const HEX_LITERAL_RE = /\b(?:0x[0-9a-fA-F]{2}\s*){4,}/g;

function decodeHexEscapes(text) {
  return text
    .replace(HEX_ESCAPE_RE, (m) => {
      try {
        const bytes = m.match(/[0-9a-fA-F]{2}/g).map((h) => parseInt(h, 16));
        return Buffer.from(bytes).toString("utf8");
      } catch { return m; }
    })
    .replace(HEX_LITERAL_RE, (m) => {
      try {
        const bytes = m.match(/[0-9a-fA-F]{2}/g).map((h) => parseInt(h, 16));
        return Buffer.from(bytes).toString("utf8");
      } catch { return m; }
    });
}

// ── 10. Leetspeak normalisation ───────────────────────────────────────────────

// Only apply leet normalisation AFTER all other transforms so we don't corrupt
// legitimate numeric content.  We use a conservative table that only maps
// characters that unambiguously represent letters when surrounded by other
// letters/leet chars.

const LEET_MAP = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s",
  "7": "t", "8": "b", "@": "a", "$": "s", "!": "i",
  "+": "t", "|": "i",
};

// A leet sequence: at least one letter surrounded by leet subs, total ≥ 4 chars
// e.g. P455w0rd, $3cr3t, p@ssw0rd
const LEET_WORD_RE = /\b(?=[a-zA-Z0-9@$!|+]*[0-9@$!|+][a-zA-Z0-9@$!|+]*[a-zA-Z][a-zA-Z0-9@$!|+]{2,})[a-zA-Z0-9@$!|+]{4,}\b/g;

function normalizeLeetspeak(text) {
  return text.replace(LEET_WORD_RE, (word) =>
    word.replace(/[0-9@$!|+]/g, (ch) => LEET_MAP[ch] ?? ch),
  );
}

// ── 11. JSON / XML value extraction ──────────────────────────────────────────

/**
 * Extract all string values from a JSON object (shallow), concatenated with spaces.
 * This helps detect fragmented PII spread across multiple JSON keys.
 * @param {string} text
 * @returns {string}
 */
function extractJsonValues(text) {
  // Only attempt on text that looks like JSON (starts with { or [)
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return "";
  try {
    const obj = JSON.parse(trimmed);
    const values = [];
    function collect(node) {
      if (typeof node === "string") { values.push(node); return; }
      if (typeof node === "number" || typeof node === "boolean") {
        values.push(String(node)); return;
      }
      if (Array.isArray(node)) { node.forEach(collect); return; }
      if (node && typeof node === "object") {
        Object.values(node).forEach(collect);
      }
    }
    collect(obj);
    return values.join(" ");
  } catch {
    return "";
  }
}

/**
 * Extract text content from XML/HTML-like structures.
 * @param {string} text
 * @returns {string}
 */
function extractXmlValues(text) {
  if (!text.includes("<")) return "";
  return text.replace(/<[^>]+>/g, " ");
}

// ── 12. Non-standard delimiter extraction ────────────────────────────────────

// Matches data separated by unusual delimiters: |||, ~~~, ;;;, ^^^, ***
const NON_STANDARD_DELIM_RE = /(?:\|{3,}|~{3,}|;{3,}|\^{3,}|\*{3,})/g;

function collapseNonStandardDelimiters(text) {
  return text.replace(NON_STANDARD_DELIM_RE, " ");
}

// ── 13. Roleplay / prompt-injection signal detection ─────────────────────────

const ROLEPLAY_SIGNALS = [
  /\b(?:act|pretend|imagine|roleplay|role.play|assume|behave)\s+as\s+(?:if|a|an|the)/i,
  /\b(?:you are now|you're now|from now on you)/i,
  /\b(?:grandm[ao]|grandmother|granny)\b.*(?:number|card|id|secret|password|code|pin)/i,
  /\b(?:for a (?:story|novel|book|movie|film|screenplay|game))\b/i,
  /\b(?:hypothetically|theoretically|in a fictional)\b/i,
  /\b(?:developer mode|jailbreak|ignore (?:previous|prior|all) instructions)\b/i,
  /\b(?:translate (?:this|the following) (?:to|into) .{0,30} and (?:then|back))\b/i,
];

/**
 * Detect whether the text contains a roleplay / prompt-injection attempt.
 * Returns true if any signal is found.
 * @param {string} text
 * @returns {boolean}
 */
export function detectRoleplayInjection(text) {
  return ROLEPLAY_SIGNALS.some((re) => re.test(text));
}

// ── 14. Code-comment extraction ───────────────────────────────────────────────

// Extract content from single-line and block comments so hidden PII is visible.
const SINGLE_LINE_COMMENT_RE = /\/\/[^\n]*/g;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const HASH_COMMENT_RE = /#[^\n]*/g;

function extractCodeComments(text) {
  const parts = [];
  for (const re of [SINGLE_LINE_COMMENT_RE, BLOCK_COMMENT_RE, HASH_COMMENT_RE]) {
    const matches = text.match(re) || [];
    for (const m of matches) {
      parts.push(m.replace(/^\/\/|^#|\/\*|\*\//g, "").trim());
    }
  }
  return parts.join(" ");
}

// ── Main normalisation pipeline ───────────────────────────────────────────────

/**
 * Normalise `text` using all evasion-detection transforms in sequence and
 * return both the canonical form and the list of evasion techniques detected.
 *
 * The `normalized` string is safe to run pattern matching on.
 * The `evasionTechniques` array is used for logging / alerting.
 *
 * @param {string} text  Raw text from the browser clipboard / input field.
 * @returns {{
 *   normalized: string,
 *   evasionTechniques: string[],
 *   hasRoleplayInjection: boolean,
 *   extractedFragments: string[],
 * }}
 */
export function normalizeForDetection(text) {
  if (!text || typeof text !== "string") {
    return { normalized: "", evasionTechniques: [], hasRoleplayInjection: false, extractedFragments: [] };
  }

  const techniques = [];
  const fragments  = [];   // additional text blocks to also scan
  let t = text;

  // ── Step 0: RTL override (must happen first – it changes logical order) ──
  const preRtl = t;
  t = expandRtlOverride(t);
  if (t !== preRtl) techniques.push("RTL_OVERRIDE");

  // ── Step 1: Strip zero-width characters ──
  const preZw = t;
  t = t.replace(ZERO_WIDTH_RE, "");
  if (t !== preZw) techniques.push("ZERO_WIDTH_CHARS");

  // ── Step 2: Strip combining marks (Zalgo) ──
  const preCm = t;
  t = t.replace(COMBINING_MARKS_RE, "");
  if (t !== preCm) techniques.push("COMBINING_MARKS");

  // ── Step 3: Decode HTML / Markdown ──
  const preHtml = t;
  t = decodeHtmlEntities(stripHtmlMarkdown(t));
  if (t !== preHtml) techniques.push("HTML_OBFUSCATION");

  // ── Step 4: Normalise homoglyphs ──
  const preHomoglyph = t;
  t = replaceHomoglyphs(t);
  if (t !== preHomoglyph) techniques.push("HOMOGLYPHS");

  // ── Step 5: Collapse punctuation injection ──
  const prePunct = t;
  t = collapsePunctuationInjection(t);
  if (t !== prePunct) techniques.push("PUNCTUATION_INJECTION");

  // ── Step 6: Normalise exotic whitespace ──
  const preWs = t;
  t = t.replace(EXOTIC_WS_RE, " ");
  if (t !== preWs) techniques.push("WHITESPACE_VARIATION");

  // ── Step 7: Decode hex escape sequences ──
  const preHex = t;
  t = decodeHexEscapes(t);
  if (t !== preHex) techniques.push("HEX_ENCODING");

  // ── Step 8: Decode Base64 payloads ──
  const preBq = t;
  t = decodeBase64Payloads(t);
  if (t !== preBq) techniques.push("BASE64_ENCODING");

  // ── Step 9: Normalise leetspeak ──
  const preLeet = t;
  t = normalizeLeetspeak(t);
  if (t !== preLeet) techniques.push("LEETSPEAK");

  // ── Step 10: Collapse non-standard delimiters ──
  const preDelim = t;
  t = collapseNonStandardDelimiters(t);
  if (t !== preDelim) techniques.push("NON_STANDARD_DELIMITERS");

  // ── Step 11: Extract JSON values (additional scan fragment) ──
  const jsonVals = extractJsonValues(text);
  if (jsonVals) {
    techniques.push("JSON_FRAGMENTATION");
    fragments.push(jsonVals);
  }

  // ── Step 12: Extract XML values (additional scan fragment) ──
  const xmlVals = extractXmlValues(text);
  if (xmlVals.trim() && xmlVals !== text) {
    if (!techniques.includes("HTML_OBFUSCATION")) techniques.push("XML_FRAGMENTATION");
    fragments.push(xmlVals);
  }

  // ── Step 13: Extract code comments (additional scan fragment) ──
  const comments = extractCodeComments(text);
  if (comments.trim()) {
    fragments.push(comments);
  }

  // ── Step 14: Roleplay / prompt injection detection ──
  const hasRoleplayInjection = detectRoleplayInjection(text);
  if (hasRoleplayInjection) techniques.push("ROLEPLAY_INJECTION");

  return {
    normalized: t,
    evasionTechniques: [...new Set(techniques)],
    hasRoleplayInjection,
    extractedFragments: [...new Set(fragments.filter(Boolean))],
  };
}

/**
 * Quick check: does the text show any evasion signals without full normalisation?
 * Used by the pre-flight worker to decide whether to escalate.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasEvasionSignals(text) {
  if (!text) return false;
  return (
    ZERO_WIDTH_RE.test(text) ||
    COMBINING_MARKS_RE.test(text) ||
    HOMOGLYPH_RE.test(text) ||
    text.includes(RTL_OVERRIDE) ||
    /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text) ||  // control characters
    BASE64_RE.test(text) ||
    HEX_ESCAPE_RE.test(text) ||
    detectRoleplayInjection(text) ||
    NON_STANDARD_DELIM_RE.test(text)
  );
}

// Reset stateful regex lastIndex flags after use
function resetRegexes() {
  ZERO_WIDTH_RE.lastIndex   = 0;
  COMBINING_MARKS_RE.lastIndex = 0;
  HOMOGLYPH_RE.lastIndex    = 0;
  BASE64_RE.lastIndex       = 0;
  HEX_ESCAPE_RE.lastIndex   = 0;
  NON_STANDARD_DELIM_RE.lastIndex = 0;
}

// Call reset after hasEvasionSignals to avoid lastIndex drift on global regexes
const _origHasEvasionSignals = hasEvasionSignals;
export { _origHasEvasionSignals };
