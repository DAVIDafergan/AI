/**
 * nlp-engine.js – Context-Aware AI NLP Brain
 *
 * Uses @xenova/transformers for 100% local, offline Named Entity Recognition.
 * No data leaves this machine at any point.
 *
 * Pipeline:
 *   1. Learning/Indexing Phase: scan corpus → extract entities → build brain
 *   2. Scoring Phase: per-file NER + regex → sensitivity score (0–100)
 *
 * Brain is persisted to .ghostlayer_brain.json (never uploaded).
 */

import { pipeline } from "@xenova/transformers";
import { writeFile, readFile } from "fs/promises";
import { join } from "path";

// ── NER Pipeline (lazy-loaded) ────────────────────────────────────────────────

/** Cached NER pipeline instance. Null until `initNLP()` is called. */
let _nerPipeline = null;

/**
 * Initialise (or return cached) NER pipeline.
 * Uses Xenova/bert-base-NER – a 4-class NER model (PER, ORG, LOC, MISC).
 * The model is downloaded once from HuggingFace Hub and cached locally.
 * Set env var TRANSFORMERS_OFFLINE=1 after the first download for air-gapped use.
 *
 * @returns {Promise<Function>}
 */
export async function initNLP() {
  if (_nerPipeline) return _nerPipeline;
  _nerPipeline = await pipeline(
    "token-classification",
    "Xenova/bert-base-NER",
    { quantized: true },          // quantized ONNX model (~16 MB)
  );
  return _nerPipeline;
}

// ── Regex patterns (supplementary PII signals) ────────────────────────────────

const PATTERNS = {
  email:      /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
  phone:      /(?:\+?\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{4}\b/g,
  creditCard: /\b(?:\d[ \-]?){13,16}\b/g,
  israeliId:  /\b\d{9}\b/g,
};

// Non-global copies used for quick boolean tests (avoids lastIndex drift).
const PATTERNS_TEST = {
  email:      /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/,
  phone:      /(?:\+?\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{4}\b/,
  creditCard: /\b(?:\d[ \-]?){13,16}\b/,
  israeliId:  /\b\d{9}\b/,
};

// Maximum number of files processed in parallel during indexing/scoring.
const MAX_CONCURRENCY = 4;

/**
 * Run an async function over an array with bounded concurrency.
 * Returns results in the same order as the input array.
 *
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} fn
 * @param {number} [concurrency]
 * @returns {Promise<R[]>}
 */
async function runWithConcurrency(items, fn, concurrency = MAX_CONCURRENCY) {
  const results = new Array(items.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < items.length) {
      const i = nextIdx++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    worker,
  );
  await Promise.all(workers);
  return results;
}

// ── Financial / sensitive vocabulary ─────────────────────────────────────────

const FINANCIAL_TERMS = new Set([
  "revenue", "profit", "loss", "budget", "forecast", "invoice", "salary",
  "payroll", "bonus", "equity", "valuation", "acquisition", "merger",
  "confidential", "proprietary", "trade secret", "nda", "non-disclosure",
  "password", "secret", "token", "api key", "credentials", "ssn", "passport",
  "bank account", "routing number", "swift", "iban",
  "הכנסה", "רווח", "הפסד", "תקציב", "תחזית", "חשבונית", "שכר", "סודי", "קנייני",
]);

// ── Text chunking ─────────────────────────────────────────────────────────────

/**
 * Split text into overlapping word-level chunks for NER inference.
 * BERT-family models have a 512-subword-token limit.  Using ~250 words per
 * chunk provides a comfortable safety margin (average English word ≈ 1.3
 * subword tokens, so 250 words ≈ 325 tokens, well under the 512 limit).
 *
 * @param {string} text
 * @param {number} [chunkWords=250]   Words per chunk
 * @param {number} [overlapWords=25]  Overlap between consecutive chunks
 * @returns {string[]}
 */
function chunkText(text, chunkWords = 250, overlapWords = 25) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + chunkWords).join(" "));
    i += chunkWords - overlapWords;
  }
  return chunks;
}

// ── NER extraction ────────────────────────────────────────────────────────────

/**
 * Run NER on text and return aggregated PERSON and ORG entity sets.
 * Falls back to empty sets if the pipeline is unavailable or the text errors.
 *
 * @param {string}   text     Raw document text.
 * @param {Function} ner      Initialised NER pipeline (or null for regex-only mode).
 * @param {boolean}  verbose  Log chunk-level warnings when true.
 * @returns {Promise<{ persons: Set<string>, orgs: Set<string> }>}
 */
async function extractEntities(text, ner, verbose = false) {
  const persons = new Set();
  const orgs    = new Set();

  if (!ner) return { persons, orgs };

  const t0 = Date.now();
  let chunkCount = 0;

  for (const chunk of chunkText(text)) {
    if (!chunk.trim()) continue;

    let results;
    try {
      results = await ner(chunk, { aggregation_strategy: "simple" });
      chunkCount++;
    } catch (err) {
      // Skip chunks that cause model errors (e.g. unsupported characters)
      if (verbose) console.warn(`[nlp] Warning: NER chunk skipped – ${err.message}`);
      continue;
    }

    for (const entity of results) {
      const label = (entity.entity_group || entity.entity || "").toUpperCase();
      const word  = (entity.word || "").trim();
      // Skip subword tokens that escaped aggregation, very short words, or low-confidence predictions
      if (!word || word.length < 3) continue;
      if (word.startsWith("##")) continue;
      if ((entity.score ?? 0) < 0.5) continue;

      if (label === "PER" || label.endsWith("-PER"))       persons.add(word);
      else if (label === "ORG" || label.endsWith("-ORG"))  orgs.add(word);
    }
  }

  const elapsed = Date.now() - t0;
  if (chunkCount > 0) {
    console.log(`[GhostLayer] Tier 2 AI took ${elapsed}ms – ${chunkCount} chunk(s), ${persons.size} person(s), ${orgs.size} org(s)`);
  }

  return { persons, orgs };
}

// ── Regex PII extraction ──────────────────────────────────────────────────────

/**
 * Extract PII matches from text using regex patterns.
 *
 * @param {string} text
 * @returns {{ email: string[], phone: string[], creditCard: string[], israeliId: string[] }}
 */
function extractPII(text) {
  function match(pattern) {
    const re = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g",
    );
    return [...new Set(text.match(re) || [])];
  }
  return {
    email:      match(PATTERNS.email),
    phone:      match(PATTERNS.phone),
    creditCard: match(PATTERNS.creditCard),
    israeliId:  match(PATTERNS.israeliId),
  };
}

// ── Financial term matching ───────────────────────────────────────────────────

/**
 * Find which financial/sensitive terms appear in the text.
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractFinancialTerms(text) {
  const lower = text.toLowerCase();
  return [...FINANCIAL_TERMS].filter((term) => lower.includes(term));
}

// ── Sensitive-signal pre-screen ───────────────────────────────────────────────

/**
 * Quick pre-screen: check the first 20 KB of a document for any sensitive
 * signal using cheap regex and keyword tests.  Returns true when at least one
 * signal is found, meaning the heavy NER pass is warranted.
 * Files that pass no signal are scored with regex+keywords only, skipping NER.
 *
 * @param {string} text
 * @returns {boolean}
 */
function hasAnySensitiveSignal(text) {
  const sample = text.length > 20480 ? text.slice(0, 20480) : text;
  return (
    PATTERNS_TEST.email.test(sample) ||
    PATTERNS_TEST.phone.test(sample) ||
    PATTERNS_TEST.creditCard.test(sample) ||
    PATTERNS_TEST.israeliId.test(sample) ||
    extractFinancialTerms(sample).length > 0
  );
}

// ── Sensitivity scoring ───────────────────────────────────────────────────────

// Scoring weights – each multiplier reflects the relative risk of the signal.
// PII is the strongest direct indicator; known-brain entities confirm the
// document belongs to the company's sensitive corpus.
const SCORE_WEIGHTS = {
  PII_PER_MATCH:     10,  // up to 40 pts total (direct regulatory risk)
  KNOWN_PERSON:       8,  // up to 35 pts (company-specific person data)
  KNOWN_ORG:          5,  //   combined with KNOWN_PERSON
  NER_PERSON:         3,  // up to 15 pts (any person/org detected by AI)
  NER_ORG:            2,  //   combined with NER_PERSON
  FINANCIAL_TERM:     2,  // up to 10 pts (sensitive vocabulary)
};

/**
 * Compute a 0–100 sensitivity score for a document.
 *
 * Factor contributions (capped):
 *   PII matches        → up to 40 pts  (strongest signal)
 *   Known entities     → up to 35 pts  (company-specific data present in brain)
 *   Any NER entities   → up to 15 pts  (person/org names detected by AI)
 *   Financial terms    → up to 10 pts
 *
 * @param {{
 *   piiCount: number,
 *   personCount: number,
 *   orgCount: number,
 *   knownPersonCount: number,
 *   knownOrgCount: number,
 *   financialCount: number,
 * }} factors
 * @returns {number}  0–100
 */
function computeSensitivityScore({
  piiCount, personCount, orgCount,
  knownPersonCount, knownOrgCount, financialCount,
}) {
  const piiScore   = Math.min(piiCount        * SCORE_WEIGHTS.PII_PER_MATCH, 40);
  const knownScore = Math.min(
    knownPersonCount * SCORE_WEIGHTS.KNOWN_PERSON + knownOrgCount * SCORE_WEIGHTS.KNOWN_ORG,
    35,
  );
  const nerScore   = Math.min(
    personCount * SCORE_WEIGHTS.NER_PERSON + orgCount * SCORE_WEIGHTS.NER_ORG,
    15,
  );
  const finScore   = Math.min(financialCount * SCORE_WEIGHTS.FINANCIAL_TERM, 10);
  return Math.min(Math.round(piiScore + knownScore + nerScore + finScore), 100);
}

/**
 * Classify a 0–100 sensitivity score into a human-readable label.
 *
 * @param {number} score
 * @returns {"Highly Sensitive" | "Sensitive" | "Normal"}
 */
export function classifySensitivity(score) {
  if (score >= 70) return "Highly Sensitive";
  if (score >= 35) return "Sensitive";
  return "Normal";
}

// ── Learning / Indexing Phase ─────────────────────────────────────────────────

/**
 * Index a corpus of documents to build the local AI brain.
 *
 * Extracts all PERSON and ORG entities and sensitive-term frequencies so that
 * the scoring phase can recognise company-specific names and context.
 *
 * @param {Array<{ path: string, content: string }>} files
 * @param {{ verbose?: boolean }} [options]
 * @returns {Promise<{
 *   learnedPersons: string[],
 *   learnedOrgs: string[],
 *   financialTermFrequency: Record<string, number>,
 *   documentCount: number,
 * }>}
 */
export async function indexDocuments(files, options = {}) {
  const { verbose = false } = options;

  const ner = await initNLP().catch(() => null);

  // Process all files concurrently; each worker returns its extracted entities.
  const rawResults = await runWithConcurrency(files, async ({ content }, idx) => {
    // Skip expensive NER when the document shows no sensitive signals.
    const nerTarget = ner && hasAnySensitiveSignal(content) ? ner : null;
    const { persons, orgs } = await extractEntities(content, nerTarget, verbose);
    if (verbose) process.stdout.write(`\r[nlp] Indexing… ${idx + 1}/${files.length}`);
    return { persons, orgs, terms: extractFinancialTerms(content) };
  });

  if (verbose) console.log();

  // Merge results sequentially after all concurrent work is done.
  const allPersons = new Set();
  const allOrgs    = new Set();
  const termFreq   = {};
  for (const { persons, orgs, terms } of rawResults) {
    persons.forEach((p) => allPersons.add(p));
    orgs.forEach((o) => allOrgs.add(o));
    for (const term of terms) termFreq[term] = (termFreq[term] || 0) + 1;
  }

  return {
    learnedPersons:         [...allPersons],
    learnedOrgs:            [...allOrgs],
    financialTermFrequency: termFreq,
    documentCount:          files.length,
  };
}

// ── AI-Powered Scan ───────────────────────────────────────────────────────────

/**
 * Score every file using the AI model and the learned brain context.
 *
 * @param {Array<{ path: string, content: string }>} files
 * @param {{
 *   learnedPersons: string[],
 *   learnedOrgs: string[],
 *   financialTermFrequency: Record<string, number>,
 * }} brain
 * @param {{ verbose?: boolean }} [options]
 * @returns {Promise<{
 *   sensitiveTermsFound: number,
 *   highlySensitiveFiles: number,
 *   sensitiveFiles: number,
 *   averageSensitivityScore: number,
 *   totalPersonsFound: number,
 *   totalOrgsFound: number,
 *   fileProfiles: Array<{
 *     path: string,
 *     sensitivityScore: number,
 *     classification: string,
 *     personsFound: number,
 *     orgsFound: number,
 *     piiCount: number,
 *   }>,
 *   fileCount: number,
 * }>}
 */
export async function buildSensitiveMap(files, brain, options = {}) {
  const { verbose = false } = options;

  const ner = await initNLP().catch(() => null);

  const learnedPersonsSet = new Set(
    (brain.learnedPersons || []).map((p) => p.toLowerCase()),
  );
  const learnedOrgsSet = new Set(
    (brain.learnedOrgs || []).map((o) => o.toLowerCase()),
  );

  let processed = 0;

  // Process all files concurrently; each worker returns its per-file result.
  const rawResults = await runWithConcurrency(files, async ({ path: filePath, content }) => {
    const pii            = extractPII(content);
    const financialTerms = extractFinancialTerms(content);

    // Skip expensive NER when the document shows no sensitive signals.
    const nerTarget = ner && hasAnySensitiveSignal(content) ? ner : null;
    const { persons, orgs } = await extractEntities(content, nerTarget, verbose);

    const piiCount    = pii.email.length + pii.phone.length +
                        pii.creditCard.length + pii.israeliId.length;
    const personCount = persons.size;
    const orgCount    = orgs.size;
    const knownPersonCount = [...persons].filter(
      (p) => learnedPersonsSet.has(p.toLowerCase()),
    ).length;
    const knownOrgCount = [...orgs].filter(
      (o) => learnedOrgsSet.has(o.toLowerCase()),
    ).length;

    const score          = computeSensitivityScore({
      piiCount, personCount, orgCount,
      knownPersonCount, knownOrgCount,
      financialCount: financialTerms.length,
    });
    const classification = classifySensitivity(score);

    if (verbose) {
      processed++;
      process.stdout.write(`\r[nlp] Scoring… ${processed}/${files.length}  `);
    }

    return {
      profile: {
        path:             filePath,
        sensitivityScore: score,
        classification,
        personsFound:     personCount,
        orgsFound:        orgCount,
        piiCount,
      },
      personCount,
      orgCount,
      piiCount,
      score,
    };
  });

  if (verbose) console.log();

  // Merge results sequentially after all concurrent work is done.
  let totalPersonsFound = 0;
  let totalOrgsFound    = 0;
  let totalPII          = 0;
  let scoreSumForAvg    = 0;
  const fileProfiles    = rawResults.map(({ profile, personCount, orgCount, piiCount, score }) => {
    totalPersonsFound += personCount;
    totalOrgsFound    += orgCount;
    totalPII          += piiCount;
    scoreSumForAvg    += score;
    return profile;
  });

  const highlySensitiveFiles   = fileProfiles.filter(
    (f) => f.classification === "Highly Sensitive",
  ).length;
  const sensitiveFiles         = fileProfiles.filter(
    (f) => f.classification === "Sensitive",
  ).length;
  const averageSensitivityScore =
    files.length > 0 ? Math.round(scoreSumForAvg / files.length) : 0;

  return {
    sensitiveTermsFound: totalPII,
    highlySensitiveFiles,
    sensitiveFiles,
    averageSensitivityScore,
    totalPersonsFound,
    totalOrgsFound,
    fileProfiles,
    fileCount: files.length,
  };
}

// ── Brain persistence ─────────────────────────────────────────────────────────

const BRAIN_FILE = join(process.cwd(), ".ghostlayer_brain.json");

/**
 * Persist the learning index and scan results to `.ghostlayer_brain.json`.
 * This file is stored locally and is never uploaded.
 *
 * @param {object} learnedIndex  Result of `indexDocuments()`
 * @param {object} scanResults   Result of `buildSensitiveMap()`
 * @returns {Promise<void>}
 */
export async function saveBrain(learnedIndex, scanResults) {
  const brain = {
    generatedAt:  new Date().toISOString(),
    agentVersion: "2.0.0",
    learnedIndex,
    scanResults,
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
