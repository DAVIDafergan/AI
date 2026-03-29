// lib/syntheticGenerator.js – Realistic synthetic data generator
// Generates fake-but-realistic Israeli PII so AI thinks it's real data

// ── Utilities ─────────────────────────────────────────────────────────────────
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Generators ────────────────────────────────────────────────────────────────

/**
 * Israeli mobile: 05X-XXXXXXX (e.g., 052-9876543)
 */
export function generatePhone() {
  const prefixes = ["050", "052", "053", "054", "055", "056", "057", "058"];
  const prefix = prefixes[randInt(0, prefixes.length - 1)];
  const num = String(randInt(1000000, 9999999));
  return `${prefix}-${num}`;
}

/**
 * Israeli landline: 0X-XXXXXXX (e.g., 03-7654321)
 */
export function generateLandline() {
  const areaCodes = ["02", "03", "04", "08", "09"];
  const area = areaCodes[randInt(0, areaCodes.length - 1)];
  const num = String(randInt(1000000, 9999999));
  return `${area}-${num}`;
}

/**
 * Israeli ID: 9-digit number starting with 3 (e.g., 312345678)
 */
export function generateIsraeliId() {
  return String(randInt(300000000, 399999999));
}

/**
 * Email: user_XXX@gmail.com (e.g., user_342@gmail.com)
 * The `original` parameter is reserved for future domain-preservation logic
 * (e.g., preserve company domain: john@company.com → user_342@company.com).
 */
export function generateEmail(original) { // eslint-disable-line no-unused-vars
  return `user_${randInt(100, 999)}@gmail.com`;
}

/**
 * Credit card: 4XXX-XXXX-XXXX-XXXX with valid-looking digits
 */
export function generateCreditCard() {
  const g = () => String(randInt(1000, 9999));
  return `4${String(randInt(100, 999))}-${g()}-${g()}-${g()}`;
}

/**
 * Keyword replacement: returns a neutral project-sounding name
 */
const KEYWORD_REPLACEMENTS = {
  "פרויקט סודי": ["פרויקט אלפא", "פרויקט בטא", "פרויקט גמא"],
  "דוח כספי": ["דוח רבעוני", "דוח שנתי", "דוח תקציבי"],
  "תוכנית אסטרטגית": ["תוכנית עבודה", "תוכנית פיתוח", "תוכנית שנתית"],
};

export function generateKeywordReplacement(keyword) {
  const options = KEYWORD_REPLACEMENTS[keyword] || ["מידע פנימי"];
  return options[randInt(0, options.length - 1)];
}

// ── Consistency cache (per-request / per-session) ─────────────────────────────
// Maps original → synthetic so the same original value always maps to the same synthetic within one request
const sessionCache = new Map();

/**
 * Get or create a synthetic value for a given original+category.
 * Guarantees consistency within a session: same original → same synthetic.
 */
export function getOrCreateSynthetic(original, category) {
  const cacheKey = `${category}:${original}`;
  if (sessionCache.has(cacheKey)) {
    return sessionCache.get(cacheKey);
  }

  let synthetic;
  switch (category) {
    case "PHONE":
      synthetic = generatePhone();
      break;
    case "LANDLINE":
      synthetic = generateLandline();
      break;
    case "ID":
      synthetic = generateIsraeliId();
      break;
    case "EMAIL":
      synthetic = generateEmail(original);
      break;
    case "CREDIT_CARD":
      synthetic = generateCreditCard();
      break;
    default:
      synthetic = `[${category}_SYNTHETIC]`;
  }

  sessionCache.set(cacheKey, synthetic);
  return synthetic;
}

/**
 * Reset the per-request cache (call after each request completes).
 */
export function resetSessionCache() {
  sessionCache.clear();
}
