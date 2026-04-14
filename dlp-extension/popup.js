// DLP Shield - Popup Script v3
// Manages settings, personal stats display, and server connectivity check

const DEFAULT_SERVER = "https://localhost:3000";

const userEmailEl       = document.getElementById("user-email");
const serverDisplayEl   = document.getElementById("server-display");
const restoredCountEl   = document.getElementById("restored-count");
const interceptedCountEl = document.getElementById("intercepted-count");
const riskLevelEl       = document.getElementById("risk-level");
const totalBlocksEl     = document.getElementById("total-blocks");
const statusDot         = document.getElementById("status-dot");
const statusText        = document.getElementById("status-text");
const serverUrlInput    = document.getElementById("server-url");
const enabledToggle     = document.getElementById("enabled-toggle");
const saveBtn           = document.getElementById("save-btn");
const clearBtn          = document.getElementById("clear-btn");
const testBtn           = document.getElementById("test-btn");
const saveMsg           = document.getElementById("save-msg");
const lastActivityEl    = document.getElementById("last-activity");

const RISK_LABELS = {
  low:      "נמוך 🟢",
  medium:   "בינוני 🟡",
  high:     "גבוה 🟠",
  critical: "קריטי 🔴",
};

const RISK_CLASSES = {
  low:      "risk-low",
  medium:   "risk-medium",
  high:     "risk-high",
  critical: "risk-critical",
};

// ── Load settings and stats on open ──────────────────────────────────────────
chrome.runtime.sendMessage({ type: "GET_STATS" }, (data) => {
  if (chrome.runtime.lastError || !data) return;

  restoredCountEl.textContent   = data.restoredCount    || 0;
  interceptedCountEl.textContent = data.interceptedCount || 0;
  serverUrlInput.value          = data.serverUrl || DEFAULT_SERVER;
  enabledToggle.checked         = data.enabled !== false;

  // Read localAgentUrl directly from storage (not included in GET_STATS response)
  chrome.storage.local.get(["localAgentUrl"], (localData) => {
    const activeServer = localData.localAgentUrl || data.serverUrl || DEFAULT_SERVER;
    if (serverDisplayEl) serverDisplayEl.textContent = activeServer;
    checkConnection(activeServer, data.tenantApiKey || "");
  });

  // Resolve the best available email:
  // Priority: employeeEmail (manually configured in Options page by the user)
  //         > userEmail     (auto-fetched from Chrome identity API on first run)
  //         > anonymous fallback (triggers a fresh Chrome identity lookup below)
  const resolvedFromStorage = data.employeeEmail || data.userEmail || null;

  if (resolvedFromStorage) {
    userEmailEl.textContent = resolvedFromStorage;
    loadPersonalStats(resolvedFromStorage, data);
  } else {
    // Request email from identity API as last resort
    chrome.runtime.sendMessage({ type: "GET_USER_EMAIL" }, (res) => {
      if (chrome.runtime.lastError) return;
      const resolvedEmail = res?.email || "anonymous@unknown.com";
      userEmailEl.textContent = resolvedEmail;
      loadPersonalStats(resolvedEmail, data);
    });
  }
});

function loadPersonalStats(email, storageData) {
  const userStats = storageData.userStats || {};
  const myStats   = userStats[email];

  if (myStats) {
    totalBlocksEl.textContent = myStats.blockCount || 0;
    if (myStats.lastActivity) {
      lastActivityEl.textContent = `פעילות אחרונה: ${relativeTime(myStats.lastActivity)}`;
    }
  }

  // Fetch server-side risk level for this user
  const serverUrl = storageData.serverUrl || DEFAULT_SERVER;
  const apiKey    = storageData.tenantApiKey || null;
  const headers   = apiKey ? { "x-api-key": apiKey } : {};
  fetch(`${serverUrl}/api/stats?view=user&email=${encodeURIComponent(email)}`, { headers })
    .then((r) => r.ok ? r.json() : null)
    .then((data) => {
      if (!data) return;
      totalBlocksEl.textContent = data.totalBlocks || 0;
      const level = data.riskLevel || "low";
      riskLevelEl.textContent = RISK_LABELS[level] || level;
      // Reset all risk classes then set correct one
      riskLevelEl.className = `stat-value small ${RISK_CLASSES[level] || ""}`;
      if (data.lastActivity) {
        lastActivityEl.textContent = `פעילות אחרונה: ${relativeTime(data.lastActivity)}`;
      }
    })
    .catch(() => { /* server may not have data yet */ });
}

function relativeTime(isoString) {
  if (!isoString) return "—";
  const diff = Date.now() - new Date(isoString).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `לפני ${s} שניות`;
  const m = Math.floor(s / 60);
  if (m < 60) return `לפני ${m} דקות`;
  const h = Math.floor(m / 60);
  if (h < 24) return `לפני ${h} שעות`;
  return `לפני ${Math.floor(h / 24)} ימים`;
}

// ── Save settings ─────────────────────────────────────────────────────────────
saveBtn.addEventListener("click", () => {
  const url     = serverUrlInput.value.trim() || DEFAULT_SERVER;
  const enabled = enabledToggle.checked;
  chrome.storage.local.set({ serverUrl: url, enabled }, () => {
    saveMsg.textContent = "✅ הגדרות נשמרו";
    if (serverDisplayEl) serverDisplayEl.textContent = url;
    setTimeout(() => { saveMsg.textContent = ""; }, 2000);
    chrome.storage.local.get(["tenantApiKey"], ({ tenantApiKey }) => {
      checkConnection(url, tenantApiKey || "");
    });
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
    restoredCountEl.textContent   = "0";
    interceptedCountEl.textContent = "0";
    saveMsg.textContent = "✅ מטמון נוקה";
    setTimeout(() => { saveMsg.textContent = ""; }, 2000);
  });
});

// ── Test Connection button ─────────────────────────────────────────────────────
testBtn.addEventListener("click", () => {
  const url = serverUrlInput.value.trim() || DEFAULT_SERVER;
  chrome.storage.local.get(["tenantApiKey"], ({ tenantApiKey }) => {
    checkConnection(url, tenantApiKey || "");
  });
});

// ── Test server connection ────────────────────────────────────────────────────
async function checkConnection(serverUrl, tenantApiKey = "") {
  statusDot.className = "status-dot";
  statusText.textContent = "בודק חיבור...";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const headers = tenantApiKey ? { "x-api-key": tenantApiKey } : undefined;
    const res = await fetch(`${serverUrl}/api/health`, { headers, signal: controller.signal });
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
