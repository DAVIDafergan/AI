// DLP Shield - Background Service Worker
// Manages stats, badge updates, configuration, and user identity

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
      ["restoredCount", "interceptedCount", "sessionStart", "serverUrl", "enabled", "userEmail", "dlp_user_stats"],
      (data) => {
        resolve({
          restoredCount: data.restoredCount || 0,
          interceptedCount: data.interceptedCount || 0,
          sessionStart: data.sessionStart || Date.now(),
          serverUrl: data.serverUrl || "https://ai-production-ffa9.up.railway.app",
          enabled: data.enabled !== false,
          userEmail: data.userEmail || null,
          userStats: data.dlp_user_stats || {},
        });
      }
    );
  });
}

// ── Initialize on install / startup ──────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    restoredCount: 0,
    interceptedCount: 0,
    sessionStart: Date.now(),
    serverUrl: "https://ai-production-ffa9.up.railway.app",
    enabled: true,
  });
  chrome.action.setBadgeText({ text: "" });

  // Schedule periodic health check every 5 minutes
  chrome.alarms.create("healthCheck", { periodInMinutes: 5 });
});

// ── Restore alarms on startup (service worker may be restarted) ───────────────
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.get("healthCheck", (alarm) => {
    if (!alarm) {
      chrome.alarms.create("healthCheck", { periodInMinutes: 5 });
    }
  });
});

// ── Alarm handler: periodic health check ─────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "healthCheck") {
    performHealthCheck();
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
    const timeout = setTimeout(() => controller.abort(), 8000);
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
