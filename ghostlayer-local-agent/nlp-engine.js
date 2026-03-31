/**
 * nlp-engine.js – Local "Smart Word Map" NLP brain
 *
 * Processes scanned file content entirely on-device.
 * Extracts:
 *   1. PII / sensitive patterns via Regex (email, phone, credit card)
 *   2. Business-context terms: UPPER_CASE project names, financial keywords,
 *      and high-frequency proper nouns (basic tokenisation – no external libs).
 *
 * The resulting "brain" is persisted to .ghostlayer_brain.json in the working
 * directory so repeated runs can be compared incrementally.
 */

import { writeFile, readFile } from "fs/promises";
import { join } from "path";

// ── Regex patterns ────────────────────────────────────────────────────────────

const PATTERNS = {
  email: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
  phone: /(?:\+?\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{4}\b/g,
  creditCard: /\b(?:\d[ \-]?){13,16}\b/g,
  israeliId: /\b\d{9}\b/g,
};

// ── Financial / sensitive vocabulary ─────────────────────────────────────────

const FINANCIAL_TERMS = new Set([
  "revenue", "profit", "loss", "budget", "forecast", "invoice", "salary",
  "payroll", "bonus", "equity", "valuation", "acquisition", "merger",
  "confidential", "proprietary", "trade secret", "nda", "non-disclosure",
  "password", "secret", "token", "api key", "credentials", "ssn", "passport",
  "bank account", "routing number", "swift", "iban",
  "הכנסה", "רווח", "הפסד", "תקציב", "תחזית", "חשבונית", "שכר", "סודי", "קנייני",
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Simple word tokeniser: splits on non-alphanumeric boundaries.
 * @param {string} text
 * @returns {string[]}
 */
function tokenise(text) {
  return text.split(/[^A-Za-z0-9\u05D0-\u05EA]+/).filter((t) => t.length > 1);
}

/**
 * Count word frequencies in a token list.
 * @param {string[]} tokens
 * @returns {Map<string, number>}
 */
function wordFrequency(tokens) {
  const freq = new Map();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return freq;
}

/**
 * Extract all regex matches from text and return a de-duplicated array.
 * @param {RegExp} pattern
 * @param {string} text
 * @returns {string[]}
 */
function extractMatches(pattern, text) {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  return [...new Set(text.match(re) || [])];
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Analyse an array of `{ path, content }` file objects and build the
 * sensitive-terms map.
 *
 * @param {Array<{ path: string, content: string }>} files
 * @returns {{
 *   sensitiveTermsFound: number,
 *   patternMatches: { email: string[], phone: string[], creditCard: string[], israeliId: string[] },
 *   projectNames: string[],
 *   financialTermsFound: string[],
 *   topProperNouns: Array<{ term: string, count: number }>,
 *   fileCount: number,
 * }}
 */
export function buildSensitiveMap(files) {
  const allEmails = new Set();
  const allPhones = new Set();
  const allCards  = new Set();
  const allIds    = new Set();
  const projectNames = new Set();
  const financialHits = new Set();
  const properNounFreq = new Map();

  for (const { content } of files) {
    const lower = content.toLowerCase();

    // PII regex
    for (const e of extractMatches(PATTERNS.email, content))      allEmails.add(e);
    for (const p of extractMatches(PATTERNS.phone, content))       allPhones.add(p);
    for (const c of extractMatches(PATTERNS.creditCard, content))  allCards.add(c);
    for (const i of extractMatches(PATTERNS.israeliId, content))   allIds.add(i);

    // UPPER_CASE project names: one or more consecutive uppercase words (e.g. PROJECT, PROJECT ALPHA)
    const upperPhrases = content.match(/\b[A-Z]{2,}(?:\s+[A-Z]{2,})*\b/g) || [];
    for (const phrase of upperPhrases) projectNames.add(phrase);

    // Financial / sensitive vocabulary
    for (const term of FINANCIAL_TERMS) {
      if (lower.includes(term)) financialHits.add(term);
    }

    // Top proper nouns: capitalised words (Title Case) that are not sentence starters
    const tokens = tokenise(content);
    for (const token of tokens) {
      if (/^[A-Z][a-z]{2,}$/.test(token)) {
        // Rough heuristic: keep words that look like names/nouns
        properNounFreq.set(token, (properNounFreq.get(token) || 0) + 1);
      }
    }
  }

  // Top 20 proper nouns by frequency (min 2 occurrences)
  const topProperNouns = [...properNounFreq.entries()]
    .filter(([, count]) => count >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([term, count]) => ({ term, count }));

  const patternMatches = {
    email:      [...allEmails],
    phone:      [...allPhones],
    creditCard: [...allCards],
    israeliId:  [...allIds],
  };

  const sensitiveTermsFound =
    allEmails.size + allPhones.size + allCards.size + allIds.size +
    projectNames.size + financialHits.size;

  return {
    sensitiveTermsFound,
    patternMatches,
    projectNames:        [...projectNames],
    financialTermsFound: [...financialHits],
    topProperNouns,
    fileCount: files.length,
  };
}

// ── Brain persistence ─────────────────────────────────────────────────────────

const BRAIN_FILE = join(process.cwd(), ".ghostlayer_brain.json");

/**
 * Persist the sensitive map to `.ghostlayer_brain.json`.
 * The file is stored locally – it never leaves this machine.
 *
 * @param {object} sensitiveMap  Result of `buildSensitiveMap()`
 * @returns {Promise<void>}
 */
export async function saveBrain(sensitiveMap) {
  const brain = {
    generatedAt: new Date().toISOString(),
    ...sensitiveMap,
  };
  await writeFile(BRAIN_FILE, JSON.stringify(brain, null, 2), "utf8");
}

/**
 * Load the previously saved brain file, or null if it does not exist.
 *
 * @returns {Promise<object|null>}
 */
export async function loadBrain() {
  try {
    const raw = await readFile(BRAIN_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
