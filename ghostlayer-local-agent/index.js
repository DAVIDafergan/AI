#!/usr/bin/env node
/**
 * GhostLayer Centralized Enterprise AI Scanner – index.js  (v3.0.0)
 *
 * Run ONCE on the corporate file server:
 *
 *   npx ghostlayer-agent --server-url=https://... --api-key=YOUR_KEY \
 *                        --dir="C:\Company_Shared_Drive" --local-port=4000
 *
 * What this does (ALL sensitive processing is LOCAL):
 *   1. Scans all .txt / .md / .csv / .json files under --dir
 *   2. NER Learning Phase: builds an AI brain from named entities
 *   3. Vector Embedding: generates sentence embeddings for semantic search
 *   4. AI-Powered Sensitivity Analysis: scores every file 0–100
 *   5. Starts a local Express API (default port 4000) for browser extensions
 *   6. Sends ONLY aggregate metadata counts (no content) to the cloud dashboard
 */

import { program }           from "commander";
import { resolve }           from "path";
import { scanDirectory }     from "./scanner.js";
import {
  initNLP,
  indexDocuments,
  buildSensitiveMap,
  saveBrain,
} from "./nlp-engine.js";
import { ingestDocuments }          from "./vector-store.js";
import { startApiServer, warmCache } from "./api-server.js";
import { sendHeartbeat, startPeriodicTelemetry, sendScanReport } from "./cloud-sync.js";

// ── CLI definition ────────────────────────────────────────────────────────────

program
  .name("ghostlayer-agent")
  .description(
    "GhostLayer Centralized Enterprise AI Scanner: learns your corporate data " +
    "once, serves as the local AI brain for employee browser extensions, and " +
    "reports aggregate metadata to the GhostLayer SaaS dashboard."
  )
  .version("3.0.0")
  .requiredOption("--api-key <key>",    "Tenant API key from the GhostLayer dashboard")
  .option("--dir <path>",               "Corporate shared drive path to ingest (default: current directory)", ".")
  .option("--server-url <url>",         "GhostLayer SaaS base URL (default: Railway deployment)")
  .option("--local-port <port>",        "Port for the local extension API (default: 4000)", "4000")
  .option("--verbose",                  "Print detailed progress information", false)
  .option("--dry-run",                  "Ingest and analyse but skip cloud sync and API server", false)
  .parse(process.argv);

const opts = program.opts();

// ── Main flow ─────────────────────────────────────────────────────────────────

async function run() {
  const targetDir = resolve(opts.dir);
  const verbose   = opts.verbose;
  const dryRun    = opts.dryRun;
  const localPort = parseInt(opts.localPort, 10) || 4000;

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  👻  GhostLayer Centralized Enterprise AI Scanner  v3.0.0");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📂 Corporate drive     : ${targetDir}`);
  console.log(`🌐 Local API port      : ${localPort}`);
  console.log("🛡  Detection pipeline : Bloom Filter → Redis Cache → Regex → AST → Intent → Deny-list → Vector → Fragments → UEBA");
  if (dryRun) console.log("⚠️  Dry-run mode: cloud sync and API server will be skipped.");
  console.log();

  if (dryRun) {
    // In dry-run mode, run the full sequential pipeline before exiting
    await runIndexingPipeline({ targetDir, verbose, opts, dryRun });
    return;
  }

  // ── Non-blocking startup: bring the API server up immediately ────────────
  // The API server starts right away using whatever cached model/vectors are
  // already on disk so extensions are protected from the first request.
  // The heavy indexing pipeline (scan → NER → vectors → sensitivity analysis)
  // is then kicked off in the background and the server is refreshed when done.

  let totalScans  = 0;
  let totalBlocks = 0;

  console.log(`🌐 Starting local AI API for browser extensions on port ${localPort}…`);
  console.log("   (Using cached brain/vectors from the previous run while re-indexing in background)");
  await warmCache();
  const server = await startApiServer({
    port: localPort,
    verbose,
    apiKey:    opts.apiKey,
    serverUrl: opts.serverUrl,
    onCheck: (result) => {
      totalScans++;
      if (result.blocked) totalBlocks++;
    },
  });
  console.log(`   ✅ API server is live on port ${localPort} – extensions are protected.`);
  console.log();

  // Keep the process alive; the indexing pipeline runs in the background
  process.on("SIGINT",  () => { server.close(); process.exit(0); });
  process.on("SIGTERM", () => { server.close(); process.exit(0); });

  // Start periodic telemetry immediately with live counters so every tick
  // reflects actual scan/block activity from the already-running API server.
  startPeriodicTelemetry({
    apiKey:    opts.apiKey,
    serverUrl: opts.serverUrl,
    getMetrics: () => ({ totalScans, totalBlocks }),
    verbose,
  });

  // Run the indexing pipeline asynchronously so it doesn't block the server
  runIndexingPipeline({ targetDir, verbose, opts, dryRun })
    .catch((err) => {
      console.error("💥 Background indexing error:", err.message);
      if (verbose) console.error(err.stack);
    });
}

/**
 * Run the 5-step indexing pipeline (File Scan → NER → Vectors → Sensitivity Analysis → Telemetry).
 * In live mode this is called as a non-blocking background task after the API server is started.
 * In dry-run mode it is called synchronously before exiting.
 */
async function runIndexingPipeline({ targetDir, verbose, opts, dryRun }) {
  const localPort = parseInt(opts.localPort, 10) || 4000;

  // ── Pre-step: Initialise local AI models ──────────────────────────────────
  console.log("🤖 Initialising local AI models (Transformers.js)…");
  console.log("   Models run 100% locally – no data ever leaves this machine.");
  console.log("   First run: models are downloaded and cached locally.");
  const startInit = Date.now();
  try {
    await initNLP();
    console.log(`   ✅ NER model ready in ${((Date.now() - startInit) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.warn(`   ⚠️  NER model unavailable (${err.message})`);
    console.warn("   Falling back to regex-only mode for entity detection.");
  }
  console.log();

  // ── Step 1/5: Scan ────────────────────────────────────────────────────────
  console.log("🔍 Step 1/5 – Scanning corporate file share…");
  const startScan = Date.now();
  const files = await scanDirectory(targetDir, { verbose });
  const scanMs = Date.now() - startScan;

  console.log(`   ✅ ${files.length} file(s) read in ${(scanMs / 1000).toFixed(1)}s`);
  console.log();

  // Report scan statistics to the cloud dashboard (aggregate counts only)
  if (!dryRun) {
    try {
      const reportResult = await sendScanReport({
        apiKey:            opts.apiKey,
        serverUrl:         opts.serverUrl,
        totalFilesScanned: files.length,
        durationSeconds:   scanMs / 1000,
      });
      if (reportResult.ok) {
        console.log(`   ☁️  Scan report saved to dashboard. (HTTP ${reportResult.status})`);
      } else {
        console.warn(`   ⚠️  Scan report not saved (HTTP ${reportResult.status}).`);
      }
    } catch (err) {
      console.warn(`   ⚠️  Could not send scan report: ${err.message}`);
    }
    console.log();
  }

  if (files.length === 0) {
    console.warn("⚠️  No supported files found (.txt, .md, .csv, .json). Exiting.");
    process.exit(0);
  }

  // ── Step 2/5: NER Learning / Indexing Phase ───────────────────────────────
  console.log("📚 Step 2/5 – NER Learning Phase: building entity brain from corporate corpus…");
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

  // ── Step 3/5: Vector Embedding ────────────────────────────────────────────
  console.log("🔢 Step 3/5 – Generating vector embeddings for semantic search…");
  console.log("   Embeddings are stored locally and power the browser extension checks.");
  const startEmbed = Date.now();
  await ingestDocuments(files, { verbose });
  const embedMs = Date.now() - startEmbed;

  console.log(`   ✅ ${files.length} document(s) embedded in ${(embedMs / 1000).toFixed(1)}s`);
  console.log(`      Vector index stored in Qdrant (local instance – never uploaded)`);
  console.log();

  // ── Step 4/5: AI-Powered Sensitivity Analysis ─────────────────────────────
  console.log("🧠 Step 4/5 – AI-Powered Sensitivity Analysis…");
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

  // ── Step 5/5: Cloud telemetry (dry-run skips this) ────────────────────────
  if (dryRun) {
    console.log("☁️  Step 5/5 – API server & cloud sync SKIPPED (dry-run mode).");
    printDryRunSummary(files, scanResults);
    return;
  }

  console.log("☁️  Step 5/5 – Sending updated telemetry to GhostLayer dashboard…");
  console.log("   (Only aggregate counts – NO sensitive content leaves this machine)");
  try {
    const result = await sendHeartbeat({
      apiKey:                  opts.apiKey,
      serverUrl:               opts.serverUrl,
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
      console.log(`   ✅ Telemetry accepted by dashboard. (HTTP ${result.status})`);
      if (result.body?.message) console.log(`   ℹ️  Server: ${result.body.message}`);
    } else {
      console.error(`   ❌ Dashboard returned HTTP ${result.status}: ${JSON.stringify(result.body)}`);
    }
  } catch (err) {
    console.error(`   ❌ Network error while sending telemetry: ${err.message}`);
  }

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✅  Background indexing complete – brain & vectors refreshed.");
  console.log(`  📊  Documents indexed       : ${files.length}`);
  console.log(`  🔴  Highly sensitive files  : ${scanResults.highlySensitiveFiles}`);
  console.log(`  🟡  Sensitive files         : ${scanResults.sensitiveFiles}`);
  console.log(`  🌐  Extension API           : http://0.0.0.0:${localPort}/api/check`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

/** Print a dry-run completion summary. */
function printDryRunSummary(files, scanResults) {
  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✅  GhostLayer Agent dry-run complete.");
  console.log(`  📊  Files scanned           : ${files.length}`);
  console.log(`  🔴  Highly sensitive files  : ${scanResults.highlySensitiveFiles}`);
  console.log(`  🟡  Sensitive files         : ${scanResults.sensitiveFiles}`);
  console.log(`  📈  Avg sensitivity score   : ${scanResults.averageSensitivityScore}/100`);
  console.log(`  🧠  Brain file              : .ghostlayer_brain.json`);
  console.log(`  🔢  Vector index            : Qdrant (ghostlayer_documents collection)`);
  console.log(`  🔢  Vector index            : .ghostlayer_vectors.json`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

run().catch((err) => {
  console.error("💥 Fatal error:", err.message);
  if (opts.verbose) console.error(err.stack);
  process.exit(1);
});

