/**
 * dlp-worker.js – GhostLayer DLP Web Worker
 *
 * Runs off the main UI thread. Handles:
 *   1. Pre-flight regex screening (fast path – avoids an API round-trip for clean text)
 *   2. Evasion signal detection (homoglyphs, zero-width chars, base64, roleplay, etc.)
 *   3. Heavy text chunking / analysis for large pastes (e.g. PDF tables)
 *
 * The worker receives a { type, id, payload } message and replies with
 * { id, result } so the caller can match replies to requests.
 *
 * Usage from content.js:
 *   const worker = new Worker(chrome.runtime.getURL("dlp-worker.js"));
 *   worker.postMessage({ type: "PREFLIGHT", id: 1, payload: { text } });
 *   worker.onmessage = ({ data }) => { if (data.id === 1) handleResult(data.result); };
 */

"use strict";

// ── Tier 1 checksum validators ───────────────────────────────────────────────

/**
 * Luhn algorithm – validates credit/debit card numbers.
 * Strips all non-digit characters before checking.
 * @param {string} value  Raw number string (may contain spaces or dashes).
 * @returns {boolean}
 */
function luhnCheck(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * Israeli national ID checksum (Luhn-variant with alternating ×1/×2 weights).
 * Left-pads to 9 digits before checking.
 * @param {string} value  Raw ID string (digits only or with leading zeros omitted).
 * @returns {boolean}
 */
function israeliIdCheck(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 5 || digits.length > 9) return false;
  const padded = digits.padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let v = parseInt(padded[i], 10) * ((i % 2) + 1);
    if (v > 9) v -= 9;
    sum += v;
  }
  return sum % 10 === 0;
}

// ── Regex patterns mirrored from api-server.js ──────────────────────────────
const PREFLIGHT_PATTERNS = [
  { type: "EMAIL",       re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/ },
  { type: "PHONE",       re: /(?:\+?\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{4}\b/ },
  { type: "CREDIT_CARD", re: /\b(?:\d[ \-]?){13,16}\b/ },
  { type: "ID_NUMBER",   re: /\b\d{9}\b/ },
  { type: "CREDENTIALS", re: /\b(password|secret|token|api[_\-]?key|credentials)\s*[:=]/i },
  { type: "ACCOUNT",     re: /\b\d{2,4}[-\s]\d{3,4}[-\s]\d{4,10}\b/ },
];

// ── Evasion detection helpers (mirrored from evasion-detector.js) ─────────────
// These are intentionally self-contained (no imports in a Web Worker context).

/** Zero-width and invisible Unicode characters. */
const ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/;

/** Combining diacritical marks (Zalgo). */
const COMBINING_MARKS_RE = /[\u0300-\u036F\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/;

/** Minimum set of Cyrillic / Greek homoglyphs used in DLP evasion. */
const HOMOGLYPH_RE = /[\u0430\u0435\u043E\u0440\u0441\u0443\u0445\u0410\u0412\u0415\u041A\u041C\u041D\u041E\u0420\u0421\u0422\u0425\u03B1\u03B5\u03B9\u03BF\u03C1\u03C3\u03C4\u03C5\u03C7\u0391\u0395\u0397\u039A\u039C\u039F\u03A1\u03A4\uFF21-\uFF5A]/;

/** RTL Override character. */
const RTL_OVERRIDE_RE = /\u202E/;

/** Base64 blobs (≥ 20 chars). */
const BASE64_RE = /[A-Za-z0-9+/]{20,}={0,2}/;

/** Hex escape sequences. */
const HEX_ESCAPE_RE = /(?:\\x[0-9a-fA-F]{2}){4,}/;

/** Non-standard delimiters. */
const NON_STD_DELIM_RE = /(?:\|{3,}|~{3,}|;{3,}|\^{3,}|\*{3,})/;

/** Roleplay / prompt-injection signals. */
const ROLEPLAY_SIGNALS = [
  /\b(?:act|pretend|imagine|roleplay|role.play|assume|behave)\s+as\s+(?:if|a|an|the)/i,
  /\b(?:you are now|you're now|from now on you)/i,
  /\b(?:grandm[ao]|grandmother|granny)\b.*(?:number|card|id|secret|password|code|pin)/i,
  /\b(?:for a (?:story|novel|book|movie|film|screenplay|game))\b/i,
  /\b(?:hypothetically|theoretically|in a fictional)\b/i,
  /\b(?:developer mode|jailbreak|ignore (?:previous|prior|all) instructions)\b/i,
];

/**
 * Homoglyph → ASCII map for the most common evasion characters.
 * Intentionally limited to avoid false positives on legitimate Unicode.
 */
const HOMOGLYPH_MAP = {
  "\u0430":"a","\u0435":"e","\u043E":"o","\u0440":"p","\u0441":"c",
  "\u0443":"y","\u0445":"x","\u0410":"A","\u0412":"B","\u0415":"E",
  "\u041A":"K","\u041C":"M","\u041D":"H","\u041E":"O","\u0420":"P",
  "\u0421":"C","\u0422":"T","\u0425":"X",
  "\u03B1":"a","\u03B5":"e","\u03B9":"i","\u03BF":"o","\u03C1":"p",
  "\u03C3":"s","\u03C4":"t","\u03C5":"u","\u03C7":"x",
  "\u0391":"A","\u0395":"E","\u0397":"H","\u039A":"K","\u039C":"M",
  "\u039F":"O","\u03A1":"P","\u03A4":"T",
};

/** Leetspeak substitutions. */
const LEET_MAP = { "0":"o","1":"i","3":"e","4":"a","5":"s","7":"t","8":"b","@":"a","$":"s" };
const LEET_WORD_RE = /\b(?=[a-zA-Z0-9@$!|+]*[0-9@$!|+][a-zA-Z0-9@$!|+]*[a-zA-Z][a-zA-Z0-9@$!|+]{2,})[a-zA-Z0-9@$!|+]{4,}\b/g;

/** Punctuation-injected single chars separated by consistent separator. */
const PUNCT_INJ_RE = /\b(\w)([\s.\-_,/\\|])(?=\w\2|\w\b)(\w(?:\2\w)+)\b/g;

/**
 * Light normalisation: strip invisible chars, replace homoglyphs, collapse leet.
 * Runs entirely synchronously and is CPU-cheap enough for the UI thread.
 * @param {string} text
 * @returns {string}
 */
function lightNormalise(text) {
  // Strip zero-width chars
  let t = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/g, "");
  // Strip combining marks (zalgo)
  t = t.replace(/[\u0300-\u036F\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g, "");
  // Replace homoglyphs
  t = t.replace(/[\u0430\u0435\u043E\u0440\u0441\u0443\u0445\u0410\u0412\u0415\u041A\u041C\u041D\u041E\u0420\u0421\u0422\u0425\u03B1\u03B5\u03B9\u03BF\u03C1\u03C3\u03C4\u03C5\u03C7\u0391\u0395\u0397\u039A\u039C\u039F\u03A1\u03A4]/g,
    (ch) => HOMOGLYPH_MAP[ch] || ch);
  // Collapse punctuation injection (S.e.c.r.e.t → Secret)
  t = t.replace(PUNCT_INJ_RE, (m) => m.replace(/[\s.\-_,/\\|]+/g, ""));
  // Normalise leetspeak
  t = t.replace(LEET_WORD_RE, (w) => w.replace(/[0-9@$!|+]/g, (c) => LEET_MAP[c] || c));
  return t;
}

/**
 * Check whether any evasion signals are present (without full normalisation).
 * @param {string} text
 * @returns {{ hasEvasion: boolean, evasionTypes: string[] }}
 */
function detectEvasionSignals(text) {
  const types = [];
  if (ZERO_WIDTH_RE.test(text))    types.push("ZERO_WIDTH");
  if (COMBINING_MARKS_RE.test(text)) types.push("ZALGO");
  if (HOMOGLYPH_RE.test(text))     types.push("HOMOGLYPHS");
  if (RTL_OVERRIDE_RE.test(text))  types.push("RTL_OVERRIDE");
  if (BASE64_RE.test(text))        types.push("BASE64");
  if (HEX_ESCAPE_RE.test(text))    types.push("HEX_ENCODING");
  if (NON_STD_DELIM_RE.test(text)) types.push("DELIMITERS");
  if (ROLEPLAY_SIGNALS.some((re) => re.test(text))) types.push("ROLEPLAY");
  // Leetspeak: digits mixed with letters in a word-like pattern
  if (/\b(?=[a-z]*[0-9])[a-z0-9@$]{4,}\b/i.test(text)) types.push("LEETSPEAK");
  return { hasEvasion: types.length > 0, evasionTypes: types };
}

/**
 * Quick pre-flight scan using only regex (no network, no AI).
 *
 * Returns:
 *   hasSensitive  – true when any pattern or evasion signal matches
 *   types         – list of matched pattern types
 *   evasionTypes  – list of detected evasion techniques
 *   tier1Exact    – true when at least one checksum-validated match was found
 *   tier1Matches  – array of { type, value } for checksum-validated hits
 *
 * @param {string} text
 * @returns {{
 *   hasSensitive: boolean,
 *   types: string[],
 *   evasionTypes: string[],
 *   tier1Exact: boolean,
 *   tier1Matches: Array<{ type: string, value: string }>,
 * }}
 */
function preflightScan(text) {
  const t0 = performance.now();

  // Detect and report evasion signals on the raw text
  const { hasEvasion, evasionTypes } = detectEvasionSignals(text);

  // Normalise the text before pattern matching so evasion attempts are caught
  const normalized = lightNormalise(text);

  const matchedTypes  = [];
  const tier1Matches  = [];   // checksum-validated exact hits

  for (const { type, re } of PREFLIGHT_PATTERNS) {
    // Use exec loop to capture actual matched values for checksum types
    const gRe = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    let typeMatched = false;
    while ((m = gRe.exec(normalized)) !== null) {
      typeMatched = true;
      const raw = m[0];

      if (type === "CREDIT_CARD" && luhnCheck(raw)) {
        tier1Matches.push({ type, value: raw });
      } else if (type === "ID_NUMBER" && israeliIdCheck(raw)) {
        tier1Matches.push({ type, value: raw });
      }
    }
    if (typeMatched) matchedTypes.push(type);
  }

  // Roleplay injection is always flagged as sensitive
  if (evasionTypes.includes("ROLEPLAY")) matchedTypes.push("ROLEPLAY_INJECTION");

  const elapsed = (performance.now() - t0).toFixed(2);
  console.log(`[GhostLayer] Tier 1 took ${elapsed}ms – types: [${matchedTypes.join(", ")}]${tier1Matches.length ? `, exact: ${tier1Matches.length}` : ""}`);

  return {
    hasSensitive: matchedTypes.length > 0 || hasEvasion,
    types: matchedTypes,
    evasionTypes,
    tier1Exact:   tier1Matches.length > 0,
    tier1Matches,
  };
}

/**
 * Split a large text into chunks at sentence / paragraph boundaries.
 * Used so the main thread can stream large pastes to the API in pieces.
 *
 * @param {string} text
 * @param {number} [maxChunkSize=4000]  Max characters per chunk
 * @returns {string[]}
 */
function chunkText(text, maxChunkSize = 4000) {
  if (text.length <= maxChunkSize) return [text];

  const chunks = [];
  // Split on paragraph breaks first, then on sentences
  const paragraphs = text.split(/\n{2,}/);
  let current = "";

  for (const para of paragraphs) {
    if ((current + para).length > maxChunkSize) {
      if (current) { chunks.push(current.trim()); current = ""; }

      // Para is itself too large – split by sentence
      if (para.length > maxChunkSize) {
        const sentences = para.split(/(?<=[.!?])\s+/);
        for (const sentence of sentences) {
          if ((current + sentence).length > maxChunkSize) {
            if (current) { chunks.push(current.trim()); current = ""; }
            // Still too large – hard-split by character count
            for (let i = 0; i < sentence.length; i += maxChunkSize) {
              chunks.push(sentence.slice(i, i + maxChunkSize));
            }
          } else {
            current += (current ? " " : "") + sentence;
          }
        }
      } else {
        current = para;
      }
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ── Message handler ──────────────────────────────────────────────────────────
self.onmessage = function handleMessage({ data }) {
  const { type, id, payload } = data || {};

  if (type === "PREFLIGHT") {
    const { text = "" } = payload || {};
    const result = preflightScan(text);
    self.postMessage({ id, result });
    return;
  }

  if (type === "CHUNK_TEXT") {
    const { text = "", maxChunkSize } = payload || {};
    const chunks = chunkText(text, maxChunkSize);
    self.postMessage({ id, result: { chunks } });
    return;
  }

  // Unknown message – acknowledge with an error so callers don't hang
  self.postMessage({ id, result: { error: `Unknown message type: ${type}` } });
};
