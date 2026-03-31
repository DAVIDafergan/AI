#!/usr/bin/env node
/**
 * GhostLayer On-Premise Agent – index.js  (v2.0.0 – AI Edition)
 *
 * One-command installation for tenants:
 *
 *   node index.js --api-key=YOUR_TENANT_KEY --dir=/path/to/company/docs
 *
 * What this does (ALL processing is LOCAL – no content ever leaves this machine):
 *   1. Scans all .txt / .md / .csv / .json files under --dir
 *   2. Learning/Indexing Phase: runs local NER to build an AI brain
 *   3. AI-Powered Sensitivity Analysis: scores every file 0–100
 *   4. Sends ONLY metadata counts to the SaaS dashboard heartbeat endpoint
 */

import { program }    from "commander";
import { resolve }    from "path";
import { scanDirectory } from "./scanner.js";
import {
  initNLP,
  indexDocuments,
  buildSensitiveMap,
  saveBrain,
} from "./nlp-engine.js";
import { sendHeartbeat } from "./cloud-sync.js";

// ── CLI definition ────────────────────────────────────────────────────────────

program
  .name("ghostlayer-agent")
  .description(
    "GhostLayer On-Premise Agent: context-aware AI scanner that learns your " +
    "company data and reports sensitivity metadata to the GhostLayer SaaS dashboard."
  )
  .version("2.0.0")
  .requiredOption("--api-key <key>",  "Tenant API key from the GhostLayer dashboard")
  .option("--dir <path>",             "Directory to scan (default: current directory)", ".")
  .option("--saas-url <url>",         "Override the SaaS base URL (default: Railway deployment)")
  .option("--verbose",                "Print detailed progress information", false)
  .option("--dry-run",                "Run scan and NLP but skip the cloud sync step", false)
  .parse(process.argv);

const opts = program.opts();

// ── Main flow ─────────────────────────────────────────────────────────────────

async function run() {
  const targetDir = resolve(opts.dir);
  const verbose   = opts.verbose;
  const dryRun    = opts.dryRun;

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  👻  GhostLayer On-Premise Agent  v2.0.0  (AI Edition)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📂 Scanning directory : ${targetDir}`);
  if (dryRun) console.log("⚠️  Dry-run mode: cloud sync will be skipped.");
  console.log();

  // ── Pre-step: Initialise local AI model ───────────────────────────────────
  console.log("🤖 Initialising local AI model (Transformers.js / Xenova/bert-base-NER)…");
  console.log("   Model runs 100% locally – no data ever leaves this machine.");
  console.log("   First run: model (~16 MB) is downloaded and cached locally.");
  const startInit = Date.now();
  try {
    await initNLP();
    console.log(`   ✅ Local NLP model ready in ${((Date.now() - startInit) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.warn(`   ⚠️  AI model unavailable (${err.message})`);
    console.warn("   Falling back to regex-only mode. Results will be less contextual.");
  }
  console.log();

  // ── Step 1/4: Scan ────────────────────────────────────────────────────────
  console.log("🔍 Step 1/4 – Scanning local files…");
  const startScan = Date.now();
  const files = await scanDirectory(targetDir, { verbose });
  const scanMs = Date.now() - startScan;

  console.log(`   ✅ ${files.length} file(s) read in ${(scanMs / 1000).toFixed(1)}s`);
  console.log();

  if (files.length === 0) {
    console.warn("⚠️  No supported files found (.txt, .md, .csv, .json). Exiting.");
    process.exit(0);
  }

  // ── Step 2/4: Learning / Indexing Phase ───────────────────────────────────
  console.log("📚 Step 2/4 – Learning/Indexing Phase: building AI brain from your corpus…");
  console.log("   Extracting named entities (PERSON, ORG) to learn company context.");
  const startIndex = Date.now();
  const learnedIndex = await indexDocuments(files, { verbose });
  const indexMs = Date.now() - startIndex;

  console.log(`   ✅ Indexed ${files.length} document(s) in ${(indexMs / 1000).toFixed(1)}s`);
  console.log(`      Known persons learned : ${learnedIndex.learnedPersons.length}`);
  console.log(`      Known orgs learned    : ${learnedIndex.learnedOrgs.length}`);
  if (verbose) {
    const topTerms = Object.entries(learnedIndex.financialTermFrequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([t, c]) => `${t}(${c})`)
      .join(", ");
    if (topTerms) console.log(`      Top sensitive terms   : ${topTerms}`);
  }
  console.log();

  // ── Step 3/4: AI-Powered Sensitivity Analysis ──────────────────────────────
  console.log("🧠 Step 3/4 – AI-Powered Sensitivity Analysis…");
  console.log("   Scoring each file 0–100 based on PII, named entities, and learned context.");
  const startScore = Date.now();
  const scanResults = await buildSensitiveMap(files, learnedIndex, { verbose });
  const scoreMs = Date.now() - startScore;

  console.log(`   ✅ Scored ${files.length} file(s) in ${(scoreMs / 1000).toFixed(1)}s`);
  console.log(`      🔴 Highly Sensitive  : ${scanResults.highlySensitiveFiles} file(s)`);
  console.log(`      🟡 Sensitive         : ${scanResults.sensitiveFiles} file(s)`);
  console.log(`      📈 Avg score         : ${scanResults.averageSensitivityScore}/100`);

  if (verbose) {
    const top = scanResults.fileProfiles
      .filter((f) => f.sensitivityScore > 0)
      .sort((a, b) => b.sensitivityScore - a.sensitivityScore)
      .slice(0, 5);
    if (top.length > 0) {
      console.log("      Top sensitive files:");
      for (const f of top) {
        console.log(`        [${f.sensitivityScore}/100] ${f.classification} – ${f.path}`);
      }
    }
  }

  console.log("   💾 Saving brain to .ghostlayer_brain.json (local only – never uploaded)…");
  await saveBrain(learnedIndex, scanResults);
  console.log("   ✅ Brain saved.");
  console.log();

  // ── Step 4/4: Cloud sync ──────────────────────────────────────────────────
  if (dryRun) {
    console.log("☁️  Step 4/4 – Cloud sync SKIPPED (dry-run mode).");
  } else {
    console.log("☁️  Step 4/4 – Sending AI-powered report to GhostLayer dashboard…");
    console.log("   (Only metadata counts are transmitted – NO sensitive content leaves this machine)");
    try {
      const result = await sendHeartbeat({
        apiKey:                  opts.apiKey,
        saasUrl:                 opts.saasUrl,
        filesScanned:            files.length,
        sensitiveTermsFound:     scanResults.sensitiveTermsFound,
        highlySensitiveFiles:    scanResults.highlySensitiveFiles,
        sensitiveFiles:          scanResults.sensitiveFiles,
        averageSensitivityScore: scanResults.averageSensitivityScore,
        entitiesFound: {
          persons: scanResults.totalPersonsFound,
          orgs:    scanResults.totalOrgsFound,
        },
      });

      if (result.ok) {
        console.log(`   ✅ Report accepted by dashboard. (HTTP ${result.status})`);
        if (result.body?.message) console.log(`   ℹ️  Server: ${result.body.message}`);
      } else {
        console.error(`   ❌ Dashboard returned HTTP ${result.status}: ${JSON.stringify(result.body)}`);
        console.error("   The local scan completed successfully; only the cloud sync failed.");
      }
    } catch (err) {
      console.error(`   ❌ Network error while sending report: ${err.message}`);
      console.error("   The local scan completed successfully; only the cloud sync failed.");
    }
  }

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✅  GhostLayer Agent run complete.");
  console.log(`  📊  Files scanned           : ${files.length}`);
  console.log(`  🔴  Highly sensitive files  : ${scanResults.highlySensitiveFiles}`);
  console.log(`  🟡  Sensitive files         : ${scanResults.sensitiveFiles}`);
  console.log(`  📈  Avg sensitivity score   : ${scanResults.averageSensitivityScore}/100`);
  console.log(`  🧠  Brain file              : .ghostlayer_brain.json`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

run().catch((err) => {
  console.error("💥 Fatal error:", err.message);
  if (opts.verbose) console.error(err.stack);
  process.exit(1);
});
