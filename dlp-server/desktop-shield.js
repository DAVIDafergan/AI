#!/usr/bin/env node
// ── Clipboard Shield – סוכן שולחן עבודה ──
// מגן על לוח העריכה (clipboard) בזמן אמת מפני הדלפת PII

const config = require("./shield.config.js");

let clipboardy;
let notifier;

// טעינה דינמית של התלויות
async function loadDeps() {
  try {
    clipboardy = await import("clipboardy");
  } catch {
    console.error("❌ חסרה תלות: clipboardy. הרץ: npm install clipboardy");
    process.exit(1);
  }
  try {
    notifier = require("node-notifier");
  } catch {
    // node-notifier אופציונלי
    notifier = null;
  }
}

let lastClipboard = "";
let isProcessing = false;
let retryCount = 0;
const MAX_RETRIES = 3;

// ── שליחת טקסט לשרת DLP ──
async function checkText(text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeout || 5000);

  try {
    const headers = { "Content-Type": "application/json" };
    if (config.apiKey) headers["x-api-key"] = config.apiKey;

    const res = await fetch(`${config.serverUrl}/api/check-text`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, source: "clipboard", mode: "paste" }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ── הצגת התראה ──
function showNotification(count) {
  const title = "🛡️ DLP Shield";
  const message = `${count} פריטי מידע רגיש הוסרו מהלוח`;

  if (config.verbose) console.log(`[DLP] ${message}`);

  if (config.notifications.enabled && notifier) {
    try {
      notifier.notify({ title, message, sound: config.notifications.sound });
    } catch {
      // התראות לא זמינות – המשך ללא שגיאה
    }
  }
}

// ── לולאת בדיקת הלוח ──
async function pollClipboard() {
  if (isProcessing) return;

  try {
    const current = await clipboardy.default.read();

    if (current === lastClipboard || current.trim() === "") {
      retryCount = 0;
      return;
    }

    lastClipboard = current;
    isProcessing = true;

    if (config.verbose) console.log("[DLP] תוכן חדש בלוח, בודק...");

    let result;
    try {
      result = await checkText(current);
      retryCount = 0;
    } catch (err) {
      retryCount++;
      if (config.verbose) console.error(`[DLP] שגיאת רשת (${retryCount}/${MAX_RETRIES}):`, err.message);
      if (retryCount >= MAX_RETRIES) {
        console.error("[DLP] שרת לא זמין. ממשיך ללא הגנה.");
        retryCount = 0;
      }
      isProcessing = false;
      return;
    }

    if (!result.safe && result.redactedText) {
      await clipboardy.default.write(result.redactedText);
      lastClipboard = result.redactedText;
      showNotification(result.detectionCount || result.replacements?.length || 1);

      if (config.verbose) {
        console.log("[DLP] הלוח נוקה. נמצאו:", result.replacements?.length, "פריטים");
      }
    }
  } catch (err) {
    if (config.verbose) console.error("[DLP] שגיאה בבדיקת לוח:", err.message);
  } finally {
    isProcessing = false;
  }
}

// ── כיבוי חן ──
function gracefulShutdown() {
  console.log("\n[DLP] מכבה את Clipboard Shield...");
  process.exit(0);
}
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

// ── הפעלה ──
async function main() {
  await loadDeps();

  console.log("🛡️  DLP Clipboard Shield פעיל");
  console.log(`   שרת: ${config.serverUrl}`);
  console.log(`   בדיקה כל: ${config.pollingInterval}ms`);
  console.log("   Ctrl+C לעצירה\n");

  setInterval(pollClipboard, config.pollingInterval);
}

main().catch((err) => {
  console.error("[DLP] שגיאה קריטית:", err);
  process.exit(1);
});
