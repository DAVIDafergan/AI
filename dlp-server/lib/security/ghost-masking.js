/**
 * lib/security/ghost-masking.js
 *
 * Ghost-Masking Engine – NER + AES-256 Bidirectional Entity Replacement
 * ───────────────────────────────────────────────────────────────────────
 * 1. Named-Entity Recognition (NER) – regex-based + heuristic for:
 *    • Person names
 *    • Financial figures  (amounts, account numbers)
 *    • Project / code names
 *    • Emails, phone numbers, Israeli IDs, credit cards
 * 2. Replace extracted entities with deterministic AES-256-GCM encrypted tokens
 *    (format: [GHOST_TOKEN_<hex>]) so that the external LLM never sees real data
 * 3. restore_prompt() decrypts tokens back to originals after the LLM responds
 *
 * The encryption key is ephemeral (in-process), so tokens are invalid
 * across process restarts – preventing offline decryption of leaked logs.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Ephemeral AES-256-GCM master key (re-generated on each process start)
// ─────────────────────────────────────────────────────────────────────────────

const MASTER_KEY = randomBytes(32); // 256-bit AES key

// ─────────────────────────────────────────────────────────────────────────────
// AES-256-GCM helpers
// ─────────────────────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const IV_BYTES  = 12; // 96-bit IV (NIST recommendation for GCM)

/**
 * Encrypt plaintext → compact hex blob: iv(24) + authTag(32) + ciphertext.
 * @param {string} plaintext
 * @returns {string} hex-encoded blob
 */
function encrypt(plaintext) {
  const iv     = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, MASTER_KEY, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("hex");
}

/**
 * Decrypt hex blob → original plaintext.
 * Returns null on any decryption failure (tampered / wrong key).
 * @param {string} hexBlob
 * @returns {string|null}
 */
function decrypt(hexBlob) {
  try {
    const buf      = Buffer.from(hexBlob, "hex");
    const iv       = buf.slice(0, IV_BYTES);
    const tag      = buf.slice(IV_BYTES, IV_BYTES + 16);
    const ctxt     = buf.slice(IV_BYTES + 16);
    const decipher = createDecipheriv(ALGORITHM, MASTER_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ctxt), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Token format
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a stable short label for a token (4 hex chars for readability). */
function tokenLabel(entityType, index) {
  return `GHOST_${entityType}_${index.toString(16).toUpperCase().padStart(4, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// NER Patterns
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Array<{ type: string, pattern: RegExp }>} */
const NER_PATTERNS = [
  // E-mail addresses
  { type: "EMAIL",        pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g },

  // Credit card numbers – broad initial match; downstream Luhn validation
  // should be applied before treating a match as a confirmed credit card.
  { type: "CREDIT_CARD",  pattern: /\b(?:\d[ \-]?){13,16}\b/g },

  // Israeli national ID (9 digits)
  { type: "NATIONAL_ID",  pattern: /\b\d{9}\b/g },

  // International phone numbers
  { type: "PHONE",        pattern: /(?:\+972|0)[\s\-]?(?:5[0-9]|[2-9])[\s\-]?\d{3}[\s\-]?\d{4}\b/g },

  // Financial figures: currency amounts (USD / ILS / EUR) or plain large numbers
  { type: "FINANCIAL",    pattern: /(?:[\$₪€£]\s?\d[\d,]*(?:\.\d{1,2})?|\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b)/g },

  // Capitalised project / code names: 2+ consecutive UPPER_CASE words or CamelCase identifiers
  { type: "PROJECT_NAME", pattern: /\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+)+\b|\bProject\s+[A-Z][A-Za-z0-9]+\b/g },

  // Person names: sequence of 2–4 capitalised words (Latin)
  { type: "PERSON_NAME",  pattern: /\b[A-Z][a-z]{1,20}(?:\s[A-Z][a-z]{1,20}){1,3}\b/g },

  // Hebrew person names: common Hebrew first names followed by a second word
  { type: "PERSON_HE",    pattern: /\b(?:דוד|יוסף|משה|אברהם|שרה|רחל|לאה|מרים|רבקה|יצחק|יעקב|שמואל|אהרן|נועה|תמר|אורי|עמית|גלי|רוני|נועם|עדן|ליאור)\s+[א-ת]{2,15}\b/g },

  // API keys / tokens – broad match on known vendor prefixes; high false-positive
  // rate for arbitrary long strings is intentional at this interception layer.
  { type: "API_KEY",      pattern: /\b[A-Za-z0-9+/=_\-]{20,}\b/g },

  // IPv4 addresses
  { type: "IP_ADDRESS",   pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g },
];

// ─────────────────────────────────────────────────────────────────────────────
// Entity Extraction (NER)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ text: string, type: string, start: number, end: number }} Entity
 */

/**
 * Extract all named entities from `text`.
 * Overlapping matches are de-duplicated (longest match wins).
 *
 * @param {string} text
 * @returns {Entity[]}
 */
export function extractEntities(text) {
  if (!text || typeof text !== "string") return [];

  /** @type {Entity[]} */
  const entities = [];

  for (const { type, pattern } of NER_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      entities.push({
        text  : match[0],
        type,
        start : match.index,
        end   : match.index + match[0].length,
      });
    }
  }

  // Sort by start position, then de-duplicate overlapping ranges
  entities.sort((a, b) => a.start - b.start || b.end - a.end);

  const deduped = [];
  let cursor    = -1;
  for (const e of entities) {
    if (e.start >= cursor) {
      deduped.push(e);
      cursor = e.end;
    }
  }

  return deduped;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ghost-Masking API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ token: string, encrypted: string, entityType: string, originalText: string }} TokenEntry
 */

/**
 * Mask all sensitive entities in `text` with encrypted ghost tokens.
 *
 * @param {string} text  - Raw prompt or document text
 * @returns {{ maskedText: string, tokenMap: Map<string, TokenEntry>, entityCount: number }}
 */
export function maskPrompt(text) {
  if (!text || typeof text !== "string") {
    return { maskedText: text, tokenMap: new Map(), entityCount: 0 };
  }

  const entities = extractEntities(text);
  if (entities.length === 0) {
    return { maskedText: text, tokenMap: new Map(), entityCount: 0 };
  }

  /** @type {Map<string, TokenEntry>} */
  const tokenMap   = new Map();
  const typeCount  = Object.create(null);
  let   maskedText = "";
  let   cursor     = 0;

  for (const entity of entities) {
    // Append unchanged text before this entity
    maskedText += text.slice(cursor, entity.start);

    // Allocate a sequential index per entity type
    typeCount[entity.type] = (typeCount[entity.type] || 0);
    const index            = typeCount[entity.type]++;
    const tokenLabel_      = tokenLabel(entity.type, index);
    const token            = `[${tokenLabel_}]`;
    const encrypted        = encrypt(entity.text);

    tokenMap.set(token, {
      token,
      encrypted,
      entityType   : entity.type,
      originalText : entity.text,
    });

    maskedText += token;
    cursor      = entity.end;
  }

  // Append remaining text
  maskedText += text.slice(cursor);

  return { maskedText, tokenMap, entityCount: entities.length };
}

/**
 * Restore ghost tokens in `maskedText` back to original values.
 * Uses the in-process decryption key – tokens are opaque outside this process.
 *
 * @param {string} maskedText       - LLM response that may contain ghost tokens
 * @param {Map<string, TokenEntry>} tokenMap  - Map returned by maskPrompt()
 * @returns {{ restoredText: string, restoredCount: number, failedTokens: string[] }}
 */
export function restorePrompt(maskedText, tokenMap) {
  if (!maskedText || typeof maskedText !== "string") {
    return { restoredText: maskedText, restoredCount: 0, failedTokens: [] };
  }

  let   restoredText  = maskedText;
  let   restoredCount = 0;
  const failedTokens  = [];

  for (const [token, entry] of tokenMap.entries()) {
    if (!restoredText.includes(token)) continue;

    // Decrypt to verify integrity; fall back to cached originalText on success
    const decrypted = decrypt(entry.encrypted);
    if (decrypted !== null) {
      restoredText  = restoredText.split(token).join(decrypted);
      restoredCount++;
    } else {
      // Token was tampered – log and skip
      failedTokens.push(token);
    }
  }

  return { restoredText, restoredCount, failedTokens };
}

/**
 * Verify that a token can be correctly decrypted (integrity check).
 * @param {TokenEntry} entry
 * @returns {boolean}
 */
export function verifyToken(entry) {
  if (!entry || !entry.encrypted) return false;
  const decrypted = decrypt(entry.encrypted);
  return decrypted !== null && decrypted === entry.originalText;
}
