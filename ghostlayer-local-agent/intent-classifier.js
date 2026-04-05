/**
 * intent-classifier.js – Zero-Shot Intent Classification
 *
 * Uses @xenova/transformers zero-shot classification pipeline to detect the
 * INTENT behind a user's text, regardless of whether it contains explicit
 * sensitive keywords.  This catches leakage attempts phrased in natural
 * language that evade pure regex/keyword detection.
 *
 * Intent categories:
 *   CODE_WRITING        – user is asking for help writing code
 *   BUSINESS_DOCUMENT   – drafting a business letter / report / email
 *   BUG_HELP            – asking for debugging assistance
 *   DATA_EXFILTRATION   – attempting to share / summarise internal data
 *   CREDENTIAL_SHARING  – sharing passwords, tokens, or secrets
 *   FINANCIAL_SHARING   – sharing internal financial / salary data
 *   GENERAL             – other / benign intent
 *
 * All inference runs 100% locally – zero data leaves the machine.
 *
 * @module intent-classifier
 */

import { pipeline } from "@xenova/transformers";

// ── Model ──────────────────────────────────────────────────────────────────────

// Xenova/mobilebert-uncased-mnli is a quantised (~24 MB) NLI model that
// supports zero-shot classification with reasonable latency on CPU.
const MODEL_NAME = "Xenova/mobilebert-uncased-mnli";

/** Cached classifier pipeline. Null until initIntentClassifier() is called. */
let _classifier = null;

/**
 * Initialise (or return the cached) zero-shot classification pipeline.
 * The model is downloaded once from HuggingFace Hub and cached locally.
 *
 * @returns {Promise<Function>}
 */
export async function initIntentClassifier() {
  if (_classifier) return _classifier;
  _classifier = await pipeline(
    "zero-shot-classification",
    MODEL_NAME,
    { quantized: true },
  );
  return _classifier;
}

// ── Candidate labels ───────────────────────────────────────────────────────────

/**
 * Labels fed to the NLI model.  Each label is a short natural-language
 * description of the intent we want to detect.
 */
const CANDIDATE_LABELS = [
  "writing code or asking for code help",
  "composing a business letter or email",
  "asking for help with a bug or error",
  "sharing or summarising internal company data",
  "sharing passwords, API keys, or credentials",
  "sharing financial reports, salaries, or budgets",
  "general question or conversation",
];

/**
 * Map a raw candidate label back to a short intent token.
 * @type {Record<string, string>}
 */
const LABEL_TO_INTENT = {
  "writing code or asking for code help":       "CODE_WRITING",
  "composing a business letter or email":       "BUSINESS_DOCUMENT",
  "asking for help with a bug or error":        "BUG_HELP",
  "sharing or summarising internal company data": "DATA_EXFILTRATION",
  "sharing passwords, API keys, or credentials": "CREDENTIAL_SHARING",
  "sharing financial reports, salaries, or budgets": "FINANCIAL_SHARING",
  "general question or conversation":           "GENERAL",
};

// ── High-risk intents that should raise the block threshold ───────────────────

/** Intents that indicate a likely data-leakage attempt. */
export const HIGH_RISK_INTENTS = new Set([
  "DATA_EXFILTRATION",
  "CREDENTIAL_SHARING",
  "FINANCIAL_SHARING",
]);

// ── Confidence thresholds ─────────────────────────────────────────────────────

/**
 * Minimum score for a high-risk intent classification to be reported.
 * Below this value the result is treated as "GENERAL" (not enough confidence).
 */
const HIGH_RISK_MIN_SCORE = 0.55;

/**
 * Minimum text length before we run classification.
 * Very short texts (< 20 chars) carry too little signal for reliable inference.
 */
const MIN_TEXT_LENGTH = 20;

/**
 * Maximum text length we feed to the model.
 * Truncate to keep inference time bounded on CPU.
 */
const MAX_TEXT_LENGTH = 1024;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Classify the intent behind `text`.
 *
 * Returns:
 *   topIntent   – the highest-scoring label token (e.g. "DATA_EXFILTRATION")
 *   score       – confidence score for topIntent (0–1)
 *   isHighRisk  – true when the top intent is a known leakage category AND
 *                 its score exceeds HIGH_RISK_MIN_SCORE
 *   allScores   – mapping of every intent token to its score
 *
 * Falls back gracefully (returns GENERAL with score 0) if the model is not
 * available or the text is too short.
 *
 * @param {string} text
 * @returns {Promise<{
 *   topIntent: string,
 *   score: number,
 *   isHighRisk: boolean,
 *   allScores: Record<string, number>,
 * }>}
 */
export async function classifyIntent(text) {
  const SAFE_RESULT = { topIntent: "GENERAL", score: 0, isHighRisk: false, allScores: {} };

  if (!text || text.trim().length < MIN_TEXT_LENGTH) return SAFE_RESULT;

  const classifier = await initIntentClassifier().catch(() => null);
  if (!classifier) return SAFE_RESULT;

  const snippet = text.trim().slice(0, MAX_TEXT_LENGTH);

  let output;
  try {
    output = await classifier(snippet, CANDIDATE_LABELS, { multi_label: false });
  } catch {
    return SAFE_RESULT;
  }

  // Build allScores mapping
  const allScores = {};
  const labels  = Array.isArray(output.labels)  ? output.labels  : [];
  const scores  = Array.isArray(output.scores)  ? output.scores  : [];
  for (let i = 0; i < labels.length; i++) {
    const intent = LABEL_TO_INTENT[labels[i]] || "GENERAL";
    allScores[intent] = +(scores[i] ?? 0).toFixed(4);
  }

  // Top intent is the first in the sorted output
  const topLabel  = labels[0] || "general question or conversation";
  const topScore  = +(scores[0] ?? 0).toFixed(4);
  const topIntent = LABEL_TO_INTENT[topLabel] || "GENERAL";

  const isHighRisk = HIGH_RISK_INTENTS.has(topIntent) && topScore >= HIGH_RISK_MIN_SCORE;

  return { topIntent, score: topScore, isHighRisk, allScores };
}
