/**
 * setup-env.js
 *
 * Automates the initial environment setup for the DLP server.
 *
 * What it does:
 *   1. Generates a cryptographically secure 32-byte hex string for JWT_SECRET.
 *   2. Opens (or creates) the .env file in this directory.
 *   3. If JWT_SECRET is not already present, appends it to the file.
 *   4. Prints a clear status message so you know exactly what happened.
 *
 * JWT_SECRET is used by authentication middleware that signs and verifies
 * session tokens.  Run this script once before starting the server for the
 * first time so a strong, unique secret is always present in .env.
 *
 * Usage:
 *   node setup-env.js
 */

"use strict";

const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");

const ENV_PATH = path.join(__dirname, ".env");
const KEY      = "JWT_SECRET";

// ── 1. Generate a fresh secret (used only when the key is missing) ────────────
const generated = crypto.randomBytes(32).toString("hex");

// ── 2. Read or create the .env file ──────────────────────────────────────────
let existing = "";
if (fs.existsSync(ENV_PATH)) {
  existing = fs.readFileSync(ENV_PATH, "utf8");
} else {
  // File does not exist – create an empty one so the append below works cleanly.
  fs.writeFileSync(ENV_PATH, "", "utf8");
  console.log(`[setup-env] Created new file: ${ENV_PATH}`);
}

// ── 3. Check whether JWT_SECRET is already defined ───────────────────────────
// Match lines of the form:  JWT_SECRET=<anything>
// Handles optional surrounding whitespace and commented-out lines are ignored
// (a line starting with # is not an active assignment).
const alreadySet = existing
  .split(/\r?\n/)
  .some((line) => /^\s*JWT_SECRET\s*=/.test(line));

if (alreadySet) {
  console.log(`[setup-env] ${KEY} is already defined in ${ENV_PATH} — nothing changed.`);
  process.exit(0);
}

// ── 4. Append JWT_SECRET to the file ─────────────────────────────────────────
// Add a blank separator line if the file is non-empty and does not already end
// with a newline, so the new entry sits on its own line.
const needsNewline = existing.length > 0 && !existing.endsWith("\n");
const entry        = `${needsNewline ? "\n" : ""}${KEY}=${generated}\n`;

fs.appendFileSync(ENV_PATH, entry, "utf8");

console.log(`[setup-env] ${KEY} has been added to ${ENV_PATH}`);
console.log(`[setup-env] Value: ${generated}`);
console.log("[setup-env] Keep this value secret and do not commit .env to version control.");
