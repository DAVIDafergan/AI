// DLP Shield - Background Service Worker
// Manages stats, badge updates, configuration, and user identity

// ── Constants ─────────────────────────────────────────────────────────────────
const HEALTH_CHECK_TIMEOUT_MS = 8000;
// Development-only fallback; production should be supplied via dashboard/managed config.
const DEFAULT_SERVER_URL = "http://localhost:3000";
const FALLBACK_HEARTBEAT_IDENTITY_DOMAIN = "extension.local";

/**
 * Read a setting from chrome.storage.managed first (IT/MDM/GPO), then fall back
 * to chrome.storage.local.  Returns a merged object with managed values taking
 * priority over local ones.
 */
function readManagedThenLocal(keys) {
  return new Promise((resolve) => {
    const mergeAndResolve = (managed, local) => {
      const merged = Object.assign({}, local);
      if (managed) {
        for (const k of Object.keys(managed)) {
          if (managed[k] !== undefined && managed[k] !== null && managed[k] !== "") {
            merged[k] = managed[k];
          }
        }
      }
      resolve(merged);
    };

    chrome.storage.local.get(keys, (local) => {
      try {
        chrome.storage.managed.get(keys, (managed) => {
          mergeAndResolve(chrome.runtime.lastError ? null : managed, local || {});
        });
      } catch {
        // managed storage unavailable (e.g. unpacked extension without policy)
        mergeAndResolve(null, local || {});
      }
    });
  });
}

function resolveRuntimeScanConfig() {
  return readManagedThenLocal([
    "serverUrl",
    "localAgentUrl",
    "tenantApiKey",
    "dlp_lastKnownGoodAgentUrl",
    "dlp_lastKnownGoodApiKey",
  ]).then((data) => {
    const localAgentUrl = typeof data?.localAgentUrl === "string" ? data.localAgentUrl.trim() : "";
    const serverUrl = typeof data?.serverUrl === "string" ? data.serverUrl.trim() : "";
    const tenantApiKey = typeof data?.tenantApiKey === "string" ? data.tenantApiKey.trim() : "";
    const lastKnownGoodAgentUrl =
      typeof data?.dlp_lastKnownGoodAgentUrl === "string" ? data.dlp_lastKnownGoodAgentUrl.trim() : "";
    const lastKnownGoodApiKey =
      typeof data?.dlp_lastKnownGoodApiKey === "string" ? data.dlp_lastKnownGoodApiKey.trim() : "";
    return {
      agentUrl: localAgentUrl || lastKnownGoodAgentUrl || serverUrl || DEFAULT_SERVER_URL,
      apiKey: tenantApiKey || lastKnownGoodApiKey,
    };
  });
}



// ── Cached email ──────────────────────────────────────────────────────────────
let cachedEmail = null;
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
    const { text, userEmail, source, mode } = message;
    resolveRuntimeScanConfig()
      .then(({ agentUrl, apiKey }) => {
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
              // Surface specific HTTP error codes so the content script can react appropriately
              const errorMap = {
                401: { error: true, errorCode: 401, message: "Unauthorized: API key missing or invalid" },
                413: { error: true, errorCode: 413, message: "Payload Too Large: text exceeds the size limit" },
                429: { error: true, errorCode: 429, message: "Rate limit exceeded: please slow down" },
              };
              sendResponse(errorMap[res.status] || { error: true, errorCode: res.status, message: `HTTP ${res.status}` });
              return;
            }
            res.json().then(sendResponse).catch((err) => {
              sendResponse({ error: true, errorCode: 0, message: err.message || "JSON parse failed" });
            });
          })
          .catch((err) => {
            clearTimeout(timeout);
            sendResponse({ error: true, errorCode: 0, message: err.message || "fetch failed" });
          });
      })
      .catch((err) => {
        sendResponse({ error: true, errorCode: 0, message: err.message || "config resolve failed" });
      });
    return true; // async
  }
  // ── Proxy image OCR check ──────────────────────────────────────────────────
  if (message.type === "CHECK_IMAGE") {
    const { imageData, userEmail } = message;
    resolveRuntimeScanConfig()
      .then(({ agentUrl, apiKey }) => {
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
      })
      .catch((err) => {
        sendResponse({ error: true, message: err.message || "config resolve failed" });
      });
    return true; // async
  }
  // ── Proxy lookup for synthetic vault tokens ──
  if (message.type === "LOOKUP_SYNTHETIC") {
    const { syntheticValue, apiUrl } = message;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    resolveRuntimeScanConfig()
      .then(({ apiKey }) =>
        fetch(`${apiUrl}?tag=${encodeURIComponent(syntheticValue)}`, {
          headers: apiKey ? { "x-api-key": apiKey } : undefined,
          signal: controller.signal,
        })
      )
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
  const storageData = await readManagedThenLocal([
    "restoredCount",
    "interceptedCount",
    "sessionStart",
    "serverUrl",
    "localAgentUrl",
    "enabled",
    "userEmail",
    "employeeEmail",
    "dlp_user_stats",
    "tenantApiKey",
  ]);
  return {
    restoredCount: storageData.restoredCount || 0,
    interceptedCount: storageData.interceptedCount || 0,
    sessionStart: storageData.sessionStart || Date.now(),
    serverUrl: storageData.serverUrl || DEFAULT_SERVER_URL,
    localAgentUrl: storageData.localAgentUrl || null,
    enabled: storageData.enabled !== false,
    userEmail: storageData.userEmail || null,
    employeeEmail: storageData.employeeEmail || null,
    userStats: storageData.dlp_user_stats || {},
    tenantApiKey: storageData.tenantApiKey || null,
  };
}

async function resolveHeartbeatIdentity(preferredEmail) {
  if (preferredEmail) return preferredEmail;
  return new Promise((resolve) => {
    chrome.storage.local.get(["dlp_heartbeatIdentity"], (stored) => {
      const existing = stored?.dlp_heartbeatIdentity?.trim() || "";
      if (existing) {
        resolve(existing);
        return;
      }
      const randomPart =
        globalThis.crypto?.randomUUID?.() ||
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const generated = `ext-${randomPart}@${FALLBACK_HEARTBEAT_IDENTITY_DOMAIN}`;
      chrome.storage.local.set({ dlp_heartbeatIdentity: generated }, () => resolve(generated));
    });
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
      serverUrl: existing.serverUrl || DEFAULT_SERVER_URL,
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

  // Fetch the live DLP policy immediately on install so the extension starts with the
  // correct server-side policy rather than relying on stale defaults.
  syncLivePolicy();
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

  // Re-sync the live DLP policy each time the service worker restarts so the
  // extension always enforces the current server-side configuration.
  syncLivePolicy();
});

// ── Alarm handler: periodic health check + user heartbeat ────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "healthCheck") {
    performHealthCheck();
    syncLivePolicy(); // refresh policy on every health-check cycle
  }
  if (alarm.name === "userHeartbeat") {
    sendUserHeartbeat();
  }
});

/**
 * Fetch the live DLP policy from the server and cache it in chrome.storage.local.
 * The cached policy is keyed as `dlp_live_policy` (array of policy objects).
 * Called at install, startup, and on every health-check alarm cycle.
 * Failures are silently ignored so the extension keeps working without connectivity.
 */
async function syncLivePolicy() {
  try {
    const data = await readManagedThenLocal(["serverUrl", "tenantApiKey", "enabled"]);
    if (!data.enabled) return;

    const serverUrl = data.serverUrl || DEFAULT_SERVER_URL;
    const apiKey    = data.tenantApiKey || "";
    if (!apiKey) return; // cannot fetch without an API key

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`${serverUrl}/api/organizations/policy`, {
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const body = await res.json();
      if (Array.isArray(body.policies)) {
        await chrome.storage.local.set({ dlp_live_policy: body.policies });
      }
    }
  } catch (err) {
    // Non-critical – policy sync failures do not block extension operation.
    // The extension continues to use the previously cached policy (or server-side enforcement).
    console.debug("[syncLivePolicy] Failed to sync policy:", err?.message || err);
  }
}

async function performHealthCheck() {
  try {
    const data = await readManagedThenLocal(["serverUrl", "tenantApiKey", "enabled"]);
    if (!data.enabled) return;

    const serverUrl = data.serverUrl || DEFAULT_SERVER_URL;
    const apiKey = typeof data.tenantApiKey === "string" ? data.tenantApiKey.trim() : "";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    const res = await fetch(`${serverUrl}/api/health`, {
      headers: apiKey ? { "x-api-key": apiKey } : undefined,
      signal: controller.signal,
    });
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
    const data = await readManagedThenLocal(
      ["serverUrl", "tenantApiKey", "employeeEmail", "userEmail", "enabled", "interceptedCount"]
    );
    if (!data.enabled) return;

    const serverUrl = data.serverUrl || DEFAULT_SERVER_URL;
    const apiKey    = data.tenantApiKey || "";
    const email = await resolveHeartbeatIdentity(data.employeeEmail || data.userEmail || null);

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
