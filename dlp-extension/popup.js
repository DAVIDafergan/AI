// DLP Shield - Popup Script
// Manages settings, stats display, and server connectivity check

const DEFAULT_SERVER = "http://localhost:3000";

const restoredCountEl = document.getElementById("restored-count");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const serverUrlInput = document.getElementById("server-url");
const enabledToggle = document.getElementById("enabled-toggle");
const saveBtn = document.getElementById("save-btn");
const clearBtn = document.getElementById("clear-btn");
const saveMsg = document.getElementById("save-msg");

// ── Load settings and stats on open ──────────────────────────────────────────
chrome.storage.local.get(["restoredCount", "serverUrl", "enabled"], (data) => {
  restoredCountEl.textContent = data.restoredCount || 0;
  serverUrlInput.value = data.serverUrl || DEFAULT_SERVER;
  enabledToggle.checked = data.enabled !== false;
  checkConnection(data.serverUrl || DEFAULT_SERVER);
});

// ── Save settings ─────────────────────────────────────────────────────────────
saveBtn.addEventListener("click", () => {
  const url = serverUrlInput.value.trim() || DEFAULT_SERVER;
  const enabled = enabledToggle.checked;
  chrome.storage.local.set({ serverUrl: url, enabled }, () => {
    saveMsg.textContent = "✅ הגדרות נשמרו";
    setTimeout(() => { saveMsg.textContent = ""; }, 2000);
    checkConnection(url);
    // Notify content scripts
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "SETTINGS_UPDATED", serverUrl: url, enabled }).catch(() => {});
      }
    });
  });
});

// ── Toggle enabled state ──────────────────────────────────────────────────────
enabledToggle.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabledToggle.checked });
});

// ── Clear cache ────────────────────────────────────────────────────────────────
clearBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_CACHE" }, () => {
    restoredCountEl.textContent = "0";
    saveMsg.textContent = "✅ מטמון נוקה";
    setTimeout(() => { saveMsg.textContent = ""; }, 2000);
  });
});

// ── Test server connection ────────────────────────────────────────────────────
async function checkConnection(serverUrl) {
  statusDot.className = "status-dot";
  statusText.textContent = "בודק חיבור...";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${serverUrl}/api/stats`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      statusDot.className = "status-dot connected";
      statusText.textContent = "מחובר לשרת ✓";
    } else {
      throw new Error("non-ok");
    }
  } catch {
    statusDot.className = "status-dot";
    statusText.textContent = "שרת לא זמין";
  }
}
