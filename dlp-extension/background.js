// DLP Shield - Background Service Worker
// Manages stats, badge updates, configuration, and user identity

// ── Constants ─────────────────────────────────────────────────────────────────
const HEALTH_CHECK_TIMEOUT_MS = 8000;

// ── Cached email ──────────────────────────────────────────────────────────────
let cachedEmail = null;

// ── Listen for messages from content.js ──────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ITEMS_RESTORED") {
    incrementRestoredCount(message.count);
    sendResponse({ ok: true });
  }
  if (message.type === "GET_STATS") {
    getStats().then(sendResponse);
    return true; // async
  }
  if (message.type === "CLEAR_CACHE") {
    chrome.storage.local.set({ restoredCount: 0, interceptedCount: 0, sessionStart: Date.now() });
    sendResponse({ ok: true });
  }
  if (message.type === "SAVE_SETTINGS") {
    chrome.storage.local.set(message.settings, () => sendResponse({ ok: true }));
    return true;
  }
  // ── Get user email via Chrome identity API ──
  if (message.type === "GET_USER_EMAIL") {
    if (cachedEmail) {
      sendResponse({ email: cachedEmail });
      return;
    }
    try {
      chrome.identity.getProfileUserInfo({ accountStatus: "SYNC" }, (userInfo) => {
        const email = userInfo?.email || "anonymous@unknown.com";
        cachedEmail = email;
        chrome.storage.local.set({ userEmail: email });
        sendResponse({ email });
      });
    } catch {
      sendResponse({ email: "anonymous@unknown.com" });
    }
    return true; // async
  }
  // ── Track per-user interception stats ──
  if (message.type === "INTERCEPTION_REPORT") {
    handleInterceptionReport(message);
    sendResponse({ ok: true });
  }
  // ── Proxy fetch to /api/check (avoids CORS in content scripts) ──
  if (message.type === "CHECK_TEXT") {
    const { text, userEmail, source, mode, apiKey, agentUrl } = message;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    fetch(`${agentUrl}/api/check-text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({ text, userEmail, source, mode }),
      signal: controller.signal,
    })
      .then((res) => {
        clearTimeout(timeout);
        if (!res.ok) {
          sendResponse({ error: true, message: `HTTP ${res.status}` });
          return;
        }
        res.json().then(sendResponse).catch((err) => {
          sendResponse({ error: true, message: err.message || "JSON parse failed" });
        });
      })
      .catch((err) => {
        clearTimeout(timeout);
        sendResponse({ error: true, message: err.message || "fetch failed" });
      });
    return true; // async
  }
  // ── Proxy image OCR check ──────────────────────────────────────────────────
  if (message.type === "CHECK_IMAGE") {
    const { imageData, userEmail, apiKey, agentUrl } = message;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // OCR may take up to 30s
    fetch(`${agentUrl}/api/check-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({ imageData, userEmail }),
      signal: controller.signal,
    })
      .then((res) => {
        clearTimeout(timeout);
        if (!res.ok) {
          sendResponse({ error: true, message: `HTTP ${res.status}` });
          return;
        }
        res.json().then(sendResponse).catch((err) => {
          sendResponse({ error: true, message: err.message || "JSON parse failed" });
        });
      })
      .catch((err) => {
        clearTimeout(timeout);
        sendResponse({ error: true, message: err.message || "image check failed" });
      });
    return true; // async
  }
  // ── Proxy lookup for synthetic vault tokens ──
  if (message.type === "LOOKUP_SYNTHETIC") {
    const { syntheticValue, apiUrl } = message;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch(`${apiUrl}?tag=${encodeURIComponent(syntheticValue)}`, { signal: controller.signal })
      .then((res) => {
        clearTimeout(timeout);
        if (!res.ok) {
          sendResponse({ error: true });
          return;
        }
        res.json().then(sendResponse).catch(() => sendResponse({ error: true }));
      })
      .catch(() => {
        clearTimeout(timeout);
        sendResponse({ error: true });
      });
    return true; // async
  }
});

// ── Handle interception report from content script ────────────────────────────
function handleInterceptionReport(message) {
  chrome.storage.local.get(["dlp_user_stats", "interceptedCount"], (data) => {
    const userStats = data.dlp_user_stats || {};
    const email = message.userEmail || "anonymous@unknown.com";

    if (!userStats[email]) {
      userStats[email] = { email, blockCount: 0, lastActivity: null };
    }
    userStats[email].blockCount += (message.count || 1);
    userStats[email].lastActivity = new Date().toISOString();

    const newInterceptedCount = (data.interceptedCount || 0) + (message.count || 1);
    chrome.storage.local.set({ dlp_user_stats: userStats, interceptedCount: newInterceptedCount });
    updateBadge(newInterceptedCount);
  });
}

// ── Increment restored count and update badge ─────────────────────────────────
function incrementRestoredCount(delta = 1) {
  chrome.storage.local.get(["restoredCount"], (data) => {
    const newCount = (data.restoredCount || 0) + delta;
    chrome.storage.local.set({ restoredCount: newCount });
    updateBadge(newCount);
  });
}

function updateBadge(count) {
  const label = count > 99 ? "99+" : String(count);
  chrome.action.setBadgeText({ text: label });
  chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
}

// ── Get current stats ─────────────────────────────────────────────────────────
async function getStats() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["restoredCount", "interceptedCount", "sessionStart", "serverUrl", "enabled", "userEmail", "employeeEmail", "dlp_user_stats", "tenantApiKey"],
      (data) => {
        resolve({
          restoredCount: data.restoredCount || 0,
          interceptedCount: data.interceptedCount || 0,
          sessionStart: data.sessionStart || Date.now(),
          serverUrl: data.serverUrl || "https://ai-production-ffa9.up.railway.app",
          enabled: data.enabled !== false,
          userEmail: data.userEmail || null,
          employeeEmail: data.employeeEmail || null,
          userStats: data.dlp_user_stats || {},
          tenantApiKey: data.tenantApiKey || null,
        });
      }
    );
  });
}

// ── Context menu: right-click on extension icon → open settings ───────────────
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "open-settings") {
    chrome.runtime.openOptionsPage();
  }
});

// ── Initialize on install / startup ──────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["serverUrl", "enabled"], (existing) => {
    chrome.storage.local.set({
      restoredCount: 0,
      interceptedCount: 0,
      sessionStart: Date.now(),
      serverUrl: existing.serverUrl || "https://ai-production-ffa9.up.railway.app",
      enabled: existing.enabled !== undefined ? existing.enabled : true,
    });
  });
  chrome.action.setBadgeText({ text: "" });

  chrome.contextMenus.create({
    id: "open-settings",
    title: "⚙️ פתח הגדרות (Open Settings)",
    contexts: ["action"],
  });

  // Schedule periodic health check every 5 minutes
  chrome.alarms.create("healthCheck", { periodInMinutes: 5 });
  // Schedule user heartbeat every 5 minutes so Admin can track active users in real time
  chrome.alarms.create("userHeartbeat", { periodInMinutes: 5 });
});

// ── Restore alarms on startup (service worker may be restarted) ───────────────
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.get("healthCheck", (alarm) => {
    if (!alarm) chrome.alarms.create("healthCheck", { periodInMinutes: 5 });
  });
  chrome.alarms.get("userHeartbeat", (alarm) => {
    if (!alarm) chrome.alarms.create("userHeartbeat", { periodInMinutes: 5 });
  });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "open-settings",
      title: "⚙️ פתח הגדרות (Open Settings)",
      contexts: ["action"],
    });
  });
});

// ── Alarm handler: periodic health check + user heartbeat ────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "healthCheck") {
    performHealthCheck();
  }
  if (alarm.name === "userHeartbeat") {
    sendUserHeartbeat();
  }
});

async function performHealthCheck() {
  try {
    const data = await new Promise((resolve) => {
      chrome.storage.local.get(["serverUrl", "enabled"], resolve);
    });
    if (!data.enabled) return;

    const serverUrl = data.serverUrl || "https://ai-production-ffa9.up.railway.app";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    const res = await fetch(`${serverUrl}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      await chrome.storage.local.set({ lastHealthCheck: Date.now(), serverHealthy: true });
    } else {
      await chrome.storage.local.set({ lastHealthCheck: Date.now(), serverHealthy: false });
    }
  } catch {
    await chrome.storage.local.set({ lastHealthCheck: Date.now(), serverHealthy: false });
  }
}

/**
 * Send a lightweight heartbeat to the server every 10 minutes so the Admin
 * dashboard can display "Active Users" in real time.
 * Only metadata is sent – no text content ever leaves the browser.
 */
async function sendUserHeartbeat() {
  try {
    const data = await new Promise((resolve) => {
      chrome.storage.local.get(
        ["serverUrl", "tenantApiKey", "employeeEmail", "userEmail", "enabled", "interceptedCount"],
        resolve
      );
    });
    if (!data.enabled) return;

    const serverUrl = data.serverUrl || "https://ai-production-ffa9.up.railway.app";
    const apiKey    = data.tenantApiKey || "";
    const email     = data.employeeEmail || data.userEmail || null;
    if (!email) return; // Skip heartbeat if no email configured – avoids invalid telemetry

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    await fetch(`${serverUrl}/api/user-heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({
        userEmail:         email,
        interceptedCount:  data.interceptedCount || 0,
        extensionVersion:  chrome.runtime.getManifest().version,
        timestamp:         new Date().toISOString(),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch {
    // Non-critical – heartbeat failures are silently ignored
  }
}
