#!/usr/bin/env node
/**
 * GhostLayer On-Premise Agent – index.js
 *
 * One-command installation for tenants:
 *
 *   node index.js --api-key=YOUR_TENANT_KEY --dir=/path/to/company/docs
 *
 * What this does (all processing is LOCAL):
 *   1. Scans all .txt / .md / .csv / .json files under --dir
 *   2. Runs NLP to build a local "sensitive-terms map"
 *   3. Saves the map to .ghostlayer_brain.json (never uploaded)
 *   4. Sends ONLY the metadata counts to the SaaS dashboard heartbeat endpoint
 */

import { program } from "commander";
import { resolve } from "path";
import { scanDirectory } from "./scanner.js";
import { buildSensitiveMap, saveBrain } from "./nlp-engine.js";
import { sendHeartbeat } from "./cloud-sync.js";

// ── CLI definition ────────────────────────────────────────────────────────────

program
  .name("ghostlayer-agent")
  .description(
    "GhostLayer On-Premise Agent: scans local files, builds a sensitive-terms map, " +
    "and sends only metadata to the GhostLayer SaaS dashboard."
  )
  .version("1.0.0")
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
  console.log("  👻  GhostLayer On-Premise Agent  v1.0.0");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📂 Scanning directory : ${targetDir}`);
  if (dryRun) console.log("⚠️  Dry-run mode: cloud sync will be skipped.");
  console.log();

  // ── Step 1: Scan ──────────────────────────────────────────────────────────
  console.log("🔍 Step 1/3 – Scanning local files…");
  const startScan = Date.now();
  const files = await scanDirectory(targetDir, { verbose });
  const scanMs = Date.now() - startScan;

  console.log(`   ✅ ${files.length} file(s) read in ${(scanMs / 1000).toFixed(1)}s`);
  console.log();

  if (files.length === 0) {
    console.warn("⚠️  No supported files found (.txt, .md, .csv, .json). Exiting.");
    process.exit(0);
  }

  // ── Step 2: NLP ──────────────────────────────────────────────────────────
  console.log("🧠 Step 2/3 – Building sensitive-terms map (NLP)…");
  const startNlp = Date.now();
  const sensitiveMap = buildSensitiveMap(files);
  const nlpMs = Date.now() - startNlp;

  console.log(`   ✅ ${sensitiveMap.sensitiveTermsFound} sensitive term(s) identified in ${(nlpMs / 1000).toFixed(1)}s`);

  if (verbose) {
    const { patternMatches, projectNames, financialTermsFound, topProperNouns } = sensitiveMap;
    console.log(`      Emails found     : ${patternMatches.email.length}`);
    console.log(`      Phones found     : ${patternMatches.phone.length}`);
    console.log(`      Credit cards     : ${patternMatches.creditCard.length}`);
    console.log(`      Israeli IDs      : ${patternMatches.israeliId.length}`);
    console.log(`      Project names    : ${projectNames.length}`);
    console.log(`      Financial terms  : ${financialTermsFound.length}`);
    console.log(`      Top proper nouns : ${topProperNouns.length}`);
  }

  console.log("   💾 Saving brain to .ghostlayer_brain.json (local only – never uploaded)…");
  await saveBrain(sensitiveMap);
  console.log("   ✅ Brain saved.");
  console.log();

  // ── Step 3: Cloud sync ────────────────────────────────────────────────────
  if (dryRun) {
    console.log("☁️  Step 3/3 – Cloud sync SKIPPED (dry-run mode).");
  } else {
    console.log("☁️  Step 3/3 – Sending heartbeat to GhostLayer dashboard…");
    console.log("   (Only metadata counts are transmitted – NO sensitive content leaves this machine)");
    try {
      const result = await sendHeartbeat({
        apiKey:             opts.apiKey,
        saasUrl:            opts.saasUrl,
        filesScanned:       files.length,
        sensitiveTermsFound: sensitiveMap.sensitiveTermsFound,
      });

      if (result.ok) {
        console.log(`   ✅ Heartbeat accepted by dashboard. (HTTP ${result.status})`);
        if (result.body?.message) console.log(`   ℹ️  Server: ${result.body.message}`);
      } else {
        console.error(`   ❌ Dashboard returned HTTP ${result.status}: ${JSON.stringify(result.body)}`);
        console.error("   The local scan completed successfully; only the cloud sync failed.");
      }
    } catch (err) {
      console.error(`   ❌ Network error while sending heartbeat: ${err.message}`);
      console.error("   The local scan completed successfully; only the cloud sync failed.");
    }
  }

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✅  GhostLayer Agent run complete.");
  console.log(`  📊  Files scanned          : ${files.length}`);
  console.log(`  🔐  Sensitive terms found  : ${sensitiveMap.sensitiveTermsFound}`);
  console.log(`  🧠  Brain file             : .ghostlayer_brain.json`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

run().catch((err) => {
  console.error("💥 Fatal error:", err.message);
  if (opts.verbose) console.error(err.stack);
  process.exit(1);
});
