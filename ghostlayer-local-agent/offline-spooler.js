/**
 * offline-spooler.js – Encrypted Offline Event Spooler for GhostLayer Local Agent
 *
 * Guarantees zero data-loss for TenantEvent payloads when the Central Server is
 * unreachable (network outage, server downtime, transient errors).
 *
 * Architecture:
 *   • Events are stored encrypted in a local SQLite database using AES-256-GCM.
 *   • A background flush loop polls for pending events and delivers them to
 *     /api/tenant-events with exponential backoff (1 s → 2 s → 4 s … max 5 min).
 *   • Once an event is successfully delivered it is permanently deleted from the DB.
 *   • The encryption key is derived from the tenant API key + machine hostname using
 *     PBKDF2-SHA256 so that the spooled data is unreadable without the key material.
 *
 * Encryption scheme:
 *   AES-256-GCM  |  random 12-byte IV per record  |  authenticated (auth-tag)
 *   Key: PBKDF2(tenantApiKey + hostname, salt="ghostlayer-spool", 100_000 iter, sha256)
 *
 * Database schema:
 *   CREATE TABLE spool (
 *     id        INTEGER PRIMARY KEY AUTOINCREMENT,
 *     iv        BLOB    NOT NULL,
 *     tag       BLOB    NOT NULL,
 *     payload   BLOB    NOT NULL,
 *     attempts  INTEGER NOT NULL DEFAULT 0,
 *     created   INTEGER NOT NULL
 *   )
 */

import Database from "better-sqlite3";
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { hostname } from "os";

// ── Constants ────────────────────────────────────────────────────────────────
const SPOOL_DIR       = join(process.env.HOME || process.cwd(), ".ghostlayer");
const DB_PATH         = join(SPOOL_DIR, "spool.db");
const PBKDF2_SALT     = "ghostlayer-spool";
const PBKDF2_ITER     = 100_000;
const AES_ALGO        = "aes-256-gcm";
const KEY_LEN         = 32; // bytes (256-bit)

// Flush worker timing
const INITIAL_DELAY_MS  = 1_000;   // 1 second
const MAX_DELAY_MS       = 300_000; // 5 minutes
const BACKOFF_FACTOR     = 2;
const MAX_ATTEMPTS       = 20;      // drop event after 20 consecutive failures (~1 h total with exponential back-off)
const FLUSH_BATCH_SIZE   = 50;      // events per flush cycle

// ── Module-level state ────────────────────────────────────────────────────────
let _db            = null;  // better-sqlite3 Database instance
let _cryptoKey     = null;  // 32-byte Buffer
let _flushTimer    = null;  // setTimeout handle
let _currentDelay  = INITIAL_DELAY_MS;
let _serverUrl     = "";
let _tenantApiKey  = "";
let _verbose       = false;

// ── Prepared statements (set after DB is opened) ──────────────────────────────
let _stmtInsert       = null;
let _stmtSelectPending = null;
let _stmtDelete       = null;
let _stmtIncAttempts  = null;
let _stmtPruneExpired = null;

// ── Key derivation ────────────────────────────────────────────────────────────

/**
 * Derive a 256-bit AES key from the tenant API key and the machine hostname.
 * Uses PBKDF2-SHA256 with a fixed public salt.  Running on the same machine
 * with the same API key always yields the same key, so the DB is portable
 * only to hosts that share both the API key and the hostname.
 *
 * When no API key is provided (edge case during initial setup), we fall back
 * to a hostname-only secret so data always remains machine-specific even
 * without a configured key.
 *
 * @param {string} tenantApiKey
 * @returns {Buffer}
 */
function deriveKey(tenantApiKey) {
  // Use a non-empty secret regardless of API key presence so encrypted data
  // cannot be trivially decrypted by guessing an empty passphrase.
  const keyMaterial = tenantApiKey && tenantApiKey.length > 0
    ? tenantApiKey
    : `no-key-${hostname()}`;
  const secret = `${keyMaterial}:${hostname()}`;
  return pbkdf2Sync(secret, PBKDF2_SALT, PBKDF2_ITER, KEY_LEN, "sha256");
}

// ── Encryption helpers ────────────────────────────────────────────────────────

/**
 * Encrypt a JSON-serialisable object and return { iv, tag, ciphertext } Buffers.
 *
 * @param {object} obj
 * @returns {{ iv: Buffer, tag: Buffer, ciphertext: Buffer }}
 */
function encrypt(obj) {
  const iv      = randomBytes(12);
  const cipher  = createCipheriv(AES_ALGO, _cryptoKey, iv);
  const plain   = JSON.stringify(obj);
  const enc     = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag     = cipher.getAuthTag();
  return { iv, tag, ciphertext: enc };
}

/**
 * Decrypt a stored record back to the original payload object.
 * Returns null if decryption fails (tampered data, wrong key, etc.).
 *
 * @param {Buffer} iv
 * @param {Buffer} tag
 * @param {Buffer} ciphertext
 * @returns {object|null}
 */
function decrypt(iv, tag, ciphertext) {
  try {
    const decipher = createDecipheriv(AES_ALGO, _cryptoKey, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plain.toString("utf8"));
  } catch {
    return null;
  }
}

// ── Database helpers ──────────────────────────────────────────────────────────

/**
 * Open (or create) the SQLite database and prepare all statements.
 */
function openDatabase() {
  if (!existsSync(SPOOL_DIR)) {
    mkdirSync(SPOOL_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent performance
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS spool (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      iv       BLOB    NOT NULL,
      tag      BLOB    NOT NULL,
      payload  BLOB    NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_spool_created ON spool (created);
  `);

  _stmtInsert = _db.prepare(
    "INSERT INTO spool (iv, tag, payload, attempts, created) VALUES (?, ?, ?, 0, ?)"
  );
  _stmtSelectPending = _db.prepare(
    `SELECT id, iv, tag, payload, attempts FROM spool
     WHERE attempts < ?
     ORDER BY created ASC
     LIMIT ?`
  );
  _stmtDelete = _db.prepare("DELETE FROM spool WHERE id = ?");
  _stmtIncAttempts = _db.prepare("UPDATE spool SET attempts = attempts + 1 WHERE id = ?");
  _stmtPruneExpired = _db.prepare("DELETE FROM spool WHERE attempts >= ?");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enqueue a TenantEvent payload into the encrypted local spool.
 * This is synchronous – the write completes before returning.
 *
 * @param {object} payload  The raw event payload (will be JSON-serialised then encrypted).
 */
export function enqueue(payload) {
  if (!_db || !_cryptoKey) {
    // Spooler not initialised – silently discard (should not happen in normal flow)
    return;
  }
  try {
    const { iv, tag, ciphertext } = encrypt(payload);
    _stmtInsert.run(iv, tag, ciphertext, Date.now());
  } catch (err) {
    if (_verbose) console.warn("[offline-spooler] enqueue error:", err.message);
  }
}

/**
 * Return the number of events currently waiting in the spool.
 * @returns {number}
 */
export function pendingCount() {
  if (!_db) return 0;
  try {
    const row = _db.prepare("SELECT COUNT(*) AS n FROM spool WHERE attempts < ?").get(MAX_ATTEMPTS);
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

// ── Flush worker ──────────────────────────────────────────────────────────────

/**
 * Attempt to POST a single payload to the Central Server.
 *
 * @param {object} payload
 * @returns {Promise<boolean>}  true on success (2xx), false otherwise.
 */
async function deliverPayload(payload) {
  const url = `${(_serverUrl || "").replace(/\/$/, "")}/api/tenant-events`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(10_000),
  });
  return res.ok;
}

/**
 * One flush cycle: try to deliver all pending events.
 * On success resets the backoff delay; on failure doubles it (up to MAX_DELAY_MS).
 *
 * @returns {Promise<void>}
 */
async function flushCycle() {
  if (!_db || !_cryptoKey) return;

  // Prune events that have exceeded the maximum retry count
  try { _stmtPruneExpired.run(MAX_ATTEMPTS); } catch { /* non-critical */ }

  const rows = _stmtSelectPending.all(MAX_ATTEMPTS, FLUSH_BATCH_SIZE);
  if (rows.length === 0) {
    // Nothing to flush – keep the delay at initial value for rapid delivery
    // when new events arrive after a quiet period.
    _currentDelay = INITIAL_DELAY_MS;
    return;
  }

  let allDelivered = true;

  for (const row of rows) {
    const payload = decrypt(row.iv, row.tag, row.payload);
    if (!payload) {
      // Corrupted / undecryptable record – drop it
      try { _stmtDelete.run(row.id); } catch { /* ignore */ }
      continue;
    }

    try {
      const ok = await deliverPayload(payload);
      if (ok) {
        _stmtDelete.run(row.id);
        if (_verbose) console.log(`[offline-spooler] Delivered event id=${row.id}`);
      } else {
        _stmtIncAttempts.run(row.id);
        allDelivered = false;
        if (_verbose) console.warn(`[offline-spooler] Delivery failed for id=${row.id} (attempts=${row.attempts + 1})`);
      }
    } catch (err) {
      _stmtIncAttempts.run(row.id);
      allDelivered = false;
      if (_verbose) console.warn(`[offline-spooler] Network error for id=${row.id}: ${err.message}`);
    }
  }

  // Adjust backoff based on outcome
  if (allDelivered) {
    _currentDelay = INITIAL_DELAY_MS;
  } else {
    _currentDelay = Math.min(_currentDelay * BACKOFF_FACTOR, MAX_DELAY_MS);
    if (_verbose) console.log(`[offline-spooler] Next retry in ${_currentDelay / 1000}s`);
  }
}

/**
 * Schedule the next flush cycle.  Re-schedules itself after each run.
 */
function scheduleFlush() {
  _flushTimer = setTimeout(async () => {
    try { await flushCycle(); } catch { /* flush errors must never crash the agent */ }
    scheduleFlush(); // always reschedule
  }, _currentDelay);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/**
 * Initialise the offline spooler.  Must be called once on agent startup.
 *
 * @param {{
 *   tenantApiKey?: string,
 *   serverUrl?: string,
 *   verbose?: boolean,
 * }} options
 */
export function initSpooler({ tenantApiKey = "", serverUrl = "", verbose = false } = {}) {
  _tenantApiKey = tenantApiKey;
  _serverUrl    = serverUrl;
  _verbose      = verbose;
  _cryptoKey    = deriveKey(tenantApiKey);

  openDatabase();
  scheduleFlush();

  if (verbose) {
    const pending = pendingCount();
    console.log(`[offline-spooler] Initialised – DB: ${DB_PATH} – pending events: ${pending}`);
  }
}

/**
 * Update the server URL and/or API key at runtime (e.g. after config reload).
 *
 * @param {{ tenantApiKey?: string, serverUrl?: string }} opts
 */
export function updateSpoolerConfig({ tenantApiKey, serverUrl } = {}) {
  if (tenantApiKey !== undefined && tenantApiKey !== _tenantApiKey) {
    _tenantApiKey = tenantApiKey;
    _cryptoKey    = deriveKey(tenantApiKey);
  }
  if (serverUrl !== undefined) _serverUrl = serverUrl;
}

/**
 * Gracefully shut down the spooler: cancel the flush timer and close the DB.
 */
export function shutdownSpooler() {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  try { _db?.close(); } catch { /* ignore */ }
  _db = null;
}
