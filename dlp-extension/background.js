// DLP Shield - Background Service Worker
// Manages stats, badge updates, and configuration

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
    chrome.storage.local.set({ restoredCount: 0, sessionStart: Date.now() });
    sendResponse({ ok: true });
  }
  if (message.type === "SAVE_SETTINGS") {
    chrome.storage.local.set(message.settings, () => sendResponse({ ok: true }));
    return true;
  }
});

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
    chrome.storage.local.get(["restoredCount", "sessionStart", "serverUrl", "enabled"], (data) => {
      resolve({
        restoredCount: data.restoredCount || 0,
        sessionStart: data.sessionStart || Date.now(),
        serverUrl: data.serverUrl || "http://localhost:3000",
        enabled: data.enabled !== false,
      });
    });
  });
}

// ── Initialize on install / startup ──────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    restoredCount: 0,
    sessionStart: Date.now(),
    serverUrl: "http://localhost:3000",
    enabled: true,
  });
  chrome.action.setBadgeText({ text: "" });
});
