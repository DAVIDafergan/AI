/* ═══════════════════════════════════════════════════════════════
   AI DLP Firewall v3 – Content Script
   • Paste interception + animated overlay (existing)
   • Input interception (real-time typing)
   • Output scanning & de-anonymization (AI responses)
   • User email auto-detection
   ═══════════════════════════════════════════════════════════════ */


const DEFAULT_LOCAL_AGENT_URL    = "https://ai-production-ffa9.up.railway.app";
const AGENT_CONFIG_PATH          = "/api/agent-config";
const CONFIG_SYNC_MIN_INTERVAL_MS = 30_000;
const DLP_PREFIX                 = "🛡️ DLP Shield:";

// ── User email (populated on init) ──
let userEmail = "anonymous@unknown.com";

// ── Settings loaded from chrome.storage.local ──
let localAgentUrl = DEFAULT_LOCAL_AGENT_URL;
let tenantApiKey  = "";
let configSyncInFlight = null;
let lastConfigSyncAt = 0;
const LAST_KNOWN_GOOD_AGENT_URL_KEY = "dlp_lastKnownGoodAgentUrl";
const LAST_KNOWN_GOOD_API_KEY_KEY   = "dlp_lastKnownGoodApiKey";

// ── Loop-prevention & caching ──
// WeakMap instead of WeakSet: maps each text node to the last string value that was
// fully scanned.  This lets us re-scan nodes whose content has grown since the last
// pass (the streaming case) while still skipping nodes whose content is unchanged.
const processedContent = new WeakMap(); // textNode → last-processed nodeValue
const restorationCache = new Map();     // synthetic → original

// ── Per-element safe-state buffer (for real-time typing DLP) ──
const safeStateMap = new WeakMap(); // element → last known safe value

// ── Rate limiting for input interception ──
let inputRequestPending = false;

// ── Web Worker for pre-flight regex screening (keeps UI at 60 fps) ──
// Lazily instantiated so we don't pay the cost on pages where DLP never fires.
let _dlpWorker = null;
let _workerMsgId = 0;
const _workerCallbacks = new Map(); // id → { resolve, reject }

function getDlpWorker() {
  if (_dlpWorker) return _dlpWorker;
  try {
    _dlpWorker = new Worker(chrome.runtime.getURL("dlp-worker.js"));
    _dlpWorker.onmessage = ({ data }) => {
      const cb = _workerCallbacks.get(data.id);
      if (cb) { _workerCallbacks.delete(data.id); cb.resolve(data.result); }
    };
    _dlpWorker.onerror = (err) => {
      console.warn(`${DLP_PREFIX} Worker error:`, err.message);
      // Resolve all pending with an error so callers fall back to API
      for (const [id, cb] of _workerCallbacks) {
        _workerCallbacks.delete(id);
        cb.resolve({ error: "worker error" });
      }
      _dlpWorker = null; // reset so next call recreates it
    };
  } catch {
    // Worker unavailable – callers should fall back to the API path
  }
  return _dlpWorker;
}

/**
 * Ask the Web Worker to do a fast pre-flight regex scan.
 * Resolves with { hasSensitive, types } or { error } on failure.
 * @param {string} text
 * @returns {Promise<{ hasSensitive: boolean, types: string[] } | { error: string }>}
 */
function workerPreflight(text) {
  return new Promise((resolve) => {
    const worker = getDlpWorker();
    if (!worker) { resolve({ error: "no worker" }); return; }
    const id = ++_workerMsgId;
    _workerCallbacks.set(id, { resolve, reject: resolve });
    worker.postMessage({ type: "PREFLIGHT", id, payload: { text } });
  });
}

// ── Smart Masking: vault & re-trigger guard ──
const _vault        = {};    // token → original value, e.g. { "[PERSON_1]": "David" }
let   _maskingActive = false; // true only while programmatically re-triggering a masked send

/* Persist the vault to chrome.storage.local so tokens survive page reloads and
   multi-turn conversations where the AI echoes back a token from an earlier turn. */
function persistVault() {
  try {
    chrome.storage.local.set({ dlp_vault: _vault });
  } catch {
    // extension context may be invalidated – ignore
  }
}

// ── Input masking guard: prevents the programmatic field update from re-triggering the scanner ──
let _inputMaskingActive = false;

// ── Output scanning guard: prevents DOM changes made by scanAndRestore from re-triggering the observer ──
let _dlpScanMutating = false;

// ── Unified internal-operation lock: set whenever DLP is modifying the DOM itself ──
// Guards against any recursive scan triggered by DLP's own text insertions.
// Consolidates _maskingActive, _inputMaskingActive, and _dlpScanMutating under one roof.
let isInternalOperation = false;

/** Set all re-trigger guards at once so no single guard is accidentally left unset. */
function setInternalOperation(val) {
  isInternalOperation  = val;
  _maskingActive       = val;
  _inputMaskingActive  = val;
  _dlpScanMutating     = val;
}

// ── DOM attribute used as a bypass marker on elements being programmatically updated ──
const DLP_BYPASS_ATTR = "data-dlp-bypass";

// ── Animation Timing (ms) ──
const TIMING = {
  cardStagger:     350,
  glowDuration:    1000,
  morphDuration:   600,
  previewDelay:    400,
  autoPasteDelay:  1200,
  closeDelay:      800,
};

/* ─────────────────────────────────────────────
   Utility: Sleep
   ───────────────────────────────────────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────────────────────────
   Utility: sendCheckText
   Wraps chrome.runtime.sendMessage for CHECK_TEXT.
   Resolves with the API response on success.
   For 401/413/429 error codes resolves with a
   { passThroughWithWarning, errorCode, message } sentinel so the caller
   can let the text through while still notifying the user – these errors
   must NOT cause the paste to be silently blocked.
   Rejects on network/runtime errors.
   ───────────────────────────────────────────── */
function sendCheckText({ text, userEmail: email, source, mode, apiKey, agentUrl }) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "CHECK_TEXT", text, userEmail: email, source, mode, apiKey, agentUrl },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          const code = response.errorCode;
          // 401 = invalid/missing API key, 413 = text too large, 429 = rate limited.
          // In all three cases let the original text through with a user-visible warning
          // rather than silently blocking the paste.
          if (code === 401 || code === 413 || code === 429) {
            resolve({ passThroughWithWarning: true, errorCode: code, message: response.message });
          } else {
            reject(new Error(response.message || "Background fetch failed"));
          }
          return;
        }
        resolve(response);
      }
    );
  });
}

/* ─────────────────────────────────────────────
   Utility: debounce (returns function with .cancel())
   ───────────────────────────────────────────── */
function debounce(fn, delay) {
  let timer;
  function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

/* ─────────────────────────────────────────────
   Utility: debounceWithMaxWait
   Like debounce(wait) but also fires after maxWait ms even if calls keep
   arriving.  Required for AI streaming where mutations arrive every ~50 ms
   and a plain trailing debounce would never fire until streaming stops.
   Returns a function that accepts a single element argument.
   ───────────────────────────────────────────── */
function debounceWithMaxWait(fn, wait, maxWait) {
  // Map<element, { trailing: timerId|null, maxTimer: timerId|null }>
  const pending = new Map();

  return function scheduleForEl(el) {
    let entry = pending.get(el);
    if (!entry) {
      entry = { trailing: null, maxTimer: null };
      pending.set(el, entry);
    }

    // Always reset the trailing timer
    if (entry.trailing !== null) clearTimeout(entry.trailing);
    entry.trailing = setTimeout(() => {
      if (entry.maxTimer !== null) clearTimeout(entry.maxTimer);
      pending.delete(el);
      try { fn(el); } catch { /* ignore */ }
    }, wait);

    // Start the hard-cap timer only once per quiescence window
    if (entry.maxTimer === null) {
      entry.maxTimer = setTimeout(() => {
        if (entry.trailing !== null) clearTimeout(entry.trailing);
        pending.delete(el);
        try { fn(el); } catch { /* ignore */ }
      }, maxWait);
    }
  };
}

/* ─────────────────────────────────────────────
   Load settings from chrome.storage.local
   ───────────────────────────────────────────── */
function loadSettings() {
  return new Promise((resolve) => {
    try {
      // Prefer managed storage (IT/MDM/GPO) and fall back to local storage
      const applyLocal = (managed) => {
        chrome.storage.local.get(["localAgentUrl", "tenantApiKey", "employeeEmail"], (local) => {
          if (!chrome.runtime.lastError) {
            // managed values take precedence when present
            const resolvedUrl = managed?.localAgentUrl || local.localAgentUrl;
            const resolvedKey = managed?.tenantApiKey  || local.tenantApiKey;
            if (resolvedUrl) localAgentUrl = resolvedUrl;
            if (resolvedKey) tenantApiKey  = resolvedKey;
            if (local.employeeEmail) userEmail = local.employeeEmail;
          }
          resolve();
        });
      };

      try {
        chrome.storage.managed.get(["tenantApiKey", "localAgentUrl"], (managed) => {
          const managedData = chrome.runtime.lastError ? null : managed;
          applyLocal(managedData);
        });
      } catch {
        // managed storage unavailable (e.g. unpacked extension without policy) – skip
        applyLocal(null);
      }
    } catch {
      // extension context may be invalidated – ignore
      resolve();
    }
  });
}

function normalizeUrlValue(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}

function buildAgentConfigEndpoint(serverUrl) {
  const base = normalizeUrlValue(serverUrl) || DEFAULT_LOCAL_AGENT_URL;
  return `${base}${AGENT_CONFIG_PATH}`;
}

function readLocalConfigSnapshot() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(
        ["serverUrl", "localAgentUrl", "tenantApiKey", LAST_KNOWN_GOOD_AGENT_URL_KEY, LAST_KNOWN_GOOD_API_KEY_KEY],
        (local) => {
          resolve({
            serverUrl: normalizeUrlValue(local?.serverUrl),
            localAgentUrl: normalizeUrlValue(local?.localAgentUrl),
            tenantApiKey: typeof local?.tenantApiKey === "string" ? local.tenantApiKey.trim() : "",
            lastKnownGoodAgentUrl: normalizeUrlValue(local?.[LAST_KNOWN_GOOD_AGENT_URL_KEY]),
            lastKnownGoodApiKey: typeof local?.[LAST_KNOWN_GOOD_API_KEY_KEY] === "string"
              ? local[LAST_KNOWN_GOOD_API_KEY_KEY].trim()
              : "",
          });
        }
      );
    } catch {
      resolve({
        serverUrl: "",
        localAgentUrl: "",
        tenantApiKey: "",
        lastKnownGoodAgentUrl: "",
        lastKnownGoodApiKey: "",
      });
    }
  });
}

/* ─────────────────────────────────────────────
   Robust runtime configuration sync from dashboard
   ───────────────────────────────────────────── */
async function fetchConfig({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastConfigSyncAt < CONFIG_SYNC_MIN_INTERVAL_MS) {
    return null;
  }
  if (configSyncInFlight) return configSyncInFlight;

  configSyncInFlight = (async () => {
    try {
      const snapshot = await readLocalConfigSnapshot();
      const requestApiKey = snapshot.lastKnownGoodApiKey || snapshot.tenantApiKey || "";
      const endpoint = buildAgentConfigEndpoint(snapshot.serverUrl);

      const res = await fetch(endpoint, {
        cache: "no-store",
        headers: requestApiKey ? { "x-api-key": requestApiKey } : undefined,
      });
      if (!res.ok) throw new Error(`agent-config HTTP ${res.status}`);

      const data = await res.json();
      const agentUrlFromApi = normalizeUrlValue(data?.agentUrl);
      const apiKeyFromApi = typeof data?.apiKey === "string" ? data.apiKey.trim() : "";

      const nextAgentUrl =
        agentUrlFromApi ||
        snapshot.localAgentUrl ||
        snapshot.lastKnownGoodAgentUrl ||
        DEFAULT_LOCAL_AGENT_URL;
      const nextApiKey =
        apiKeyFromApi ||
        snapshot.lastKnownGoodApiKey ||
        snapshot.tenantApiKey ||
        "";

      await new Promise((resolve) => {
        try {
          chrome.storage.local.set(
            {
              localAgentUrl: nextAgentUrl,
              tenantApiKey: nextApiKey,
              [LAST_KNOWN_GOOD_AGENT_URL_KEY]: nextAgentUrl,
              [LAST_KNOWN_GOOD_API_KEY_KEY]: nextApiKey,
            },
            resolve
          );
        } catch {
          resolve();
        }
      });

      localAgentUrl = nextAgentUrl;
      tenantApiKey = nextApiKey;
      return { agentUrl: nextAgentUrl, apiKey: nextApiKey, source: "dashboard" };
    } catch (err) {
      const snapshot = await readLocalConfigSnapshot();
      const fallbackAgentUrl =
        snapshot.localAgentUrl ||
        snapshot.lastKnownGoodAgentUrl ||
        DEFAULT_LOCAL_AGENT_URL;
      const fallbackApiKey =
        snapshot.lastKnownGoodApiKey ||
        snapshot.tenantApiKey ||
        "";

      await new Promise((resolve) => {
        try {
          chrome.storage.local.set(
            {
              localAgentUrl: fallbackAgentUrl,
              tenantApiKey: fallbackApiKey,
            },
            resolve
          );
        } catch {
          resolve();
        }
      });

      localAgentUrl = fallbackAgentUrl;
      tenantApiKey = fallbackApiKey;
      console.debug(`${DLP_PREFIX} fetchConfig fallback to Last Known Good:`, err?.message || err);
      return { agentUrl: fallbackAgentUrl, apiKey: fallbackApiKey, source: "last-known-good" };
    } finally {
      lastConfigSyncAt = Date.now();
      configSyncInFlight = null;
    }
  })();

  return configSyncInFlight;
}

/* ─────────────────────────────────────────────
   Read fresh settings right before a fetch.
   Checks chrome.storage.managed first (IT/MDM/GPO policy) and falls back to
   chrome.storage.local.  localAgentUrl (saved by options.js) takes priority over
   serverUrl (saved by popup.js). Falls back to DEFAULT_LOCAL_AGENT_URL.
   ───────────────────────────────────────────── */
async function readSettings() {
  return new Promise((resolve) => {
    const buildResult = (managed, local) => {
      // Managed values (IT policy) override user-set local values
      const apiKey   = managed?.tenantApiKey  || local.tenantApiKey  || "";
      // localAgentUrl is the explicit per-device runtime endpoint and should override popup serverUrl.
      const finalUrl = managed?.localAgentUrl || local.localAgentUrl || local.serverUrl || DEFAULT_LOCAL_AGENT_URL;
      resolve({
        localAgentUrl: finalUrl,
        tenantApiKey:  apiKey,
        userEmail:     local.employeeEmail || local.userEmail || userEmail || "anonymous@unknown.com",
      });
    };

    try {
      chrome.storage.local.get(["serverUrl", "localAgentUrl", "tenantApiKey", "userEmail", "employeeEmail"], (local) => {
        if (chrome.runtime.lastError) {
          resolve({
            localAgentUrl: DEFAULT_LOCAL_AGENT_URL,
            tenantApiKey:  "",
            userEmail:     userEmail || "anonymous@unknown.com",
          });
          return;
        }
        try {
          chrome.storage.managed.get(["tenantApiKey", "localAgentUrl"], (managed) => {
            buildResult(chrome.runtime.lastError ? null : managed, local);
          });
        } catch {
          // managed storage unavailable (e.g. unpacked extension without policy)
          buildResult(null, local);
        }
      });
    } catch {
      // extension context may be invalidated – fall back to safe defaults
      resolve({
        localAgentUrl: DEFAULT_LOCAL_AGENT_URL,
        tenantApiKey:  "",
        userEmail:     userEmail || "anonymous@unknown.com",
      });
    }
  });
}

/* ─────────────────────────────────────────────
   1C. User Email Auto-Detection
   ───────────────────────────────────────────── */
function initUserEmail() {
  // If the employee already set their email in Options, don't override it.
  if (userEmail && userEmail !== "anonymous@unknown.com") return;
  try {
    chrome.runtime.sendMessage({ type: "GET_USER_EMAIL" }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.email) {
        userEmail = response.email;
        console.log(`${DLP_PREFIX} אימייל משתמש זוהה: ${userEmail}`);
      }
    });
  } catch {
    // extension context may be invalidated – ignore
  }
}

/* ─────────────────────────────────────────────
   Build the overlay DOM (pure vanilla JS)
   ───────────────────────────────────────────── */
function buildOverlayDOM(replacements, redactedText) {
  if (!Array.isArray(replacements)) replacements = [];
  const backdrop = document.createElement("div");
  backdrop.className = "dlp-overlay-backdrop";

  const panel = document.createElement("div");
  panel.className = "dlp-overlay-panel";
  backdrop.appendChild(panel);

  // ── Header ──
  const header = document.createElement("div");
  header.className = "dlp-overlay-header";

  const shield = document.createElement("div");
  shield.className = "dlp-overlay-shield";
  shield.textContent = "🛡️";

  const titleBlock = document.createElement("div");
  titleBlock.className = "dlp-overlay-title-block";

  const title = document.createElement("div");
  title.className = "dlp-overlay-title";
  title.textContent = "חומת אש AI – זוהה מידע רגיש";

  const subtitle = document.createElement("div");
  subtitle.className = "dlp-overlay-subtitle";
  subtitle.textContent = `${replacements.length} פריטים רגישים זוהו • ממיר לנתונים סינתטיים...`;

  titleBlock.appendChild(title);
  titleBlock.appendChild(subtitle);
  header.appendChild(shield);
  header.appendChild(titleBlock);
  panel.appendChild(header);

  // ── Body ──
  const body = document.createElement("div");
  body.className = "dlp-overlay-body";

  const sectionLabel = document.createElement("div");
  sectionLabel.className = "dlp-overlay-section-label";
  sectionLabel.textContent = "החלפות מידע רגיש";
  body.appendChild(sectionLabel);

  const cards = [];
  for (const rep of replacements) {
    const card = document.createElement("div");
    card.className = "dlp-replacement-card";

    const originalSpan = document.createElement("span");
    originalSpan.className = "dlp-original-text";
    originalSpan.textContent = rep.original || rep.synthetic;

    const arrow = document.createElement("span");
    arrow.className = "dlp-arrow";
    arrow.textContent = "←";

    const placeholderSpan = document.createElement("span");
    placeholderSpan.className = "dlp-placeholder-text";
    placeholderSpan.textContent = rep.synthetic || rep.placeholder;

    card.appendChild(originalSpan);
    card.appendChild(arrow);
    card.appendChild(placeholderSpan);
    body.appendChild(card);

    cards.push({ card, originalSpan, arrow, placeholderSpan });
  }

  // Preview Box
  const previewBox = document.createElement("div");
  previewBox.className = "dlp-preview-box";

  const previewLabel = document.createElement("div");
  previewLabel.className = "dlp-preview-label";
  previewLabel.textContent = "טקסט סינתטי שיודבק";

  const previewText = document.createElement("p");
  previewText.className = "dlp-preview-text";

  let previewHTML = escapeHTML(redactedText);
  for (const rep of replacements) {
    const synth = escapeHTML(rep.synthetic || rep.placeholder || "");
    previewHTML = previewHTML.replace(
      synth,
      `<span class="dlp-highlight">${synth}</span>`
    );
  }
  previewText.innerHTML = previewHTML;

  previewBox.appendChild(previewLabel);
  previewBox.appendChild(previewText);
  body.appendChild(previewBox);
  panel.appendChild(body);

  // ── Footer ──
  const footer = document.createElement("div");
  footer.className = "dlp-overlay-footer";

  const progressContainer = document.createElement("div");
  progressContainer.className = "dlp-progress-bar-container";

  const progressFill = document.createElement("div");
  progressFill.className = "dlp-progress-bar-fill";
  progressContainer.appendChild(progressFill);

  const statusText = document.createElement("div");
  statusText.className = "dlp-status-text";
  statusText.textContent = "מתחיל סריקה...";

  const successIcon = document.createElement("div");
  successIcon.className = "dlp-success-icon";
  successIcon.innerHTML = `
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="12"/>
      <polyline points="7 13 10 16 17 9"/>
    </svg>`;

  footer.appendChild(progressContainer);
  footer.appendChild(statusText);
  footer.appendChild(successIcon);
  panel.appendChild(footer);

  return { backdrop, panel, shield, subtitle, cards, previewBox, progressFill, statusText, successIcon };
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ─────────────────────────────────────────────
   Run the staggered morph animation sequence
   ───────────────────────────────────────────── */
async function runMorphAnimation(overlayParts) {
  const { cards, previewBox, progressFill, statusText, successIcon, shield, subtitle } = overlayParts;

  const totalSteps = cards.length + 2;
  let currentStep = 0;

  function updateProgress(label) {
    currentStep++;
    const pct = Math.round((currentStep / totalSteps) * 100);
    progressFill.style.width = `${pct}%`;
    statusText.textContent = label;
  }

  for (let i = 0; i < cards.length; i++) {
    const { card, originalSpan, arrow, placeholderSpan } = cards[i];
    card.classList.add("dlp-card-visible");
    updateProgress(`סורק פריט ${i + 1} מתוך ${cards.length}...`);

    await sleep(TIMING.glowDuration);

    originalSpan.classList.add("dlp-morphing");
    await sleep(TIMING.morphDuration / 2);

    placeholderSpan.classList.add("dlp-placeholder-active");
    arrow.classList.add("dlp-arrow-done");

    await sleep(TIMING.morphDuration / 2);

    if (i < cards.length - 1) {
      await sleep(TIMING.cardStagger);
    }
  }

  await sleep(TIMING.previewDelay);
  previewBox.classList.add("dlp-preview-visible");
  updateProgress("הטקסט הסינתטי מוכן");

  await sleep(400);
  updateProgress("מדביק טקסט מוגן...");
  progressFill.style.width = "100%";

  shield.classList.add("dlp-safe");
  shield.textContent = "✅";
  subtitle.textContent = "ההחלפה הושלמה • מדביק טקסט סינתטי בטוח";

  successIcon.classList.add("dlp-show");

  await sleep(TIMING.autoPasteDelay);
}

/* ─────────────────────────────────────────────
   Close the overlay with exit animation
   ───────────────────────────────────────────── */
async function closeOverlay(overlayParts) {
  const { backdrop, panel } = overlayParts;
  panel.classList.add("dlp-closing");
  backdrop.classList.add("dlp-closing");
  await sleep(350);
  backdrop.remove();
}

/* ─────────────────────────────────────────────
   setNativeValue – bypass React's synthetic value setter
   Works for both <textarea> and <input> elements
   ───────────────────────────────────────────── */
function setNativeValue(element, value) {
  const proto = element.tagName === "TEXTAREA"
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (nativeSetter) {
    nativeSetter.call(element, value);
  } else {
    element.value = value; // fallback (non-React pages)
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

/* ─────────────────────────────────────────────
   Insert text into the target field.
   Marks the element with DLP_BYPASS_ATTR so that
   input listeners know this change originated from
   DLP itself and must not trigger a new scan.
   ───────────────────────────────────────────── */
function insertTextIntoField(element, text) {
  element.setAttribute(DLP_BYPASS_ATTR, "1");
  setInternalOperation(true);
  try {
    element.focus();

    if (element.isContentEditable) {
      document.execCommand("insertText", false, text);
      return;
    }

    const start  = element.selectionStart ?? element.value.length;
    const end    = element.selectionEnd   ?? element.value.length;
    const before = element.value.slice(0, start);
    const after  = element.value.slice(end);

    // Use native setter to avoid breaking React's internal state (e.g. ChatGPT)
    setNativeValue(element, before + text + after);

    const newPos = start + text.length;
    element.setSelectionRange(newPos, newPos);

    element.dispatchEvent(new Event("change", { bubbles: true }));
  } finally {
    // Remove bypass marker after a microtask so queued event handlers see it
    Promise.resolve().then(() => {
      element.removeAttribute(DLP_BYPASS_ATTR);
      setInternalOperation(false);
    });
  }
}

/* ─────────────────────────────────────────────
   React-compatible text setter for input fields
   ───────────────────────────────────────────── */
function setReactInputValue(element, newText) {
  element.setAttribute(DLP_BYPASS_ATTR, "1");
  try {
    if (element.isContentEditable) {
      // For React-controlled contentEditable (e.g. ChatGPT's ProseMirror editor),
      // use execCommand so the browser triggers real DOM mutation events that
      // React's synthetic event system can detect – avoids ERR_QUIC_PROTOCOL_ERROR
      // caused by React holding a stale internal value after a direct textContent write.
      element.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, newText);
    } else if (element.tagName === "TEXTAREA") {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      ).set;
      nativeSetter.call(element, newText);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      ).set;
      nativeSetter.call(element, newText);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  } catch (err) {
    console.error(`${DLP_PREFIX} שגיאה בעדכון ערך שדה:`, err);
  } finally {
    Promise.resolve().then(() => element.removeAttribute(DLP_BYPASS_ATTR));
  }
}

/* ─────────────────────────────────────────────
   Show green flash on input element
   ───────────────────────────────────────────── */
function flashGreen(element) {
  const prev = element.style.transition;
  element.style.transition = "box-shadow 0.2s ease";
  element.style.boxShadow = "0 0 0 2px #22c55e";
  setTimeout(() => {
    element.style.boxShadow = "";
    element.style.transition = prev;
  }, 1200);
}

/* ─────────────────────────────────────────────
   1D. Main Paste Handler
   ───────────────────────────────────────────── */
/**
 * Apply Tier 1 client-side masking when the worker returned checksum-validated
 * exact matches.  Generates local vault tokens, updates the vault, and returns
 * the masked text along with the replacement list – all without a server round-trip.
 *
 * @param {string} originalText
 * @param {Array<{ type: string, value: string }>} tier1Matches
 * @returns {{ maskedText: string, replacements: Array<{ original: string, synthetic: string }> }}
 */
function applyTier1Masking(originalText, tier1Matches) {
  let maskedText = originalText;
  const replacements = [];
  const counters = {};

  for (const { type, value } of tier1Matches) {
    // Skip if this exact value was already replaced in a previous iteration
    if (!maskedText.includes(value)) continue;
    const count = (counters[type] = (counters[type] || 0) + 1);
    const token = `[${type}_${count}]`;
    // Replace all occurrences of this value
    maskedText = maskedText.split(value).join(token);
    _vault[token] = value;
    replacements.push({ original: value, synthetic: token });
  }

  return { maskedText, replacements };
}

async function handlePaste(event) {
  const text = (event.clipboardData || window.clipboardData)?.getData("text");
  if (!text || text.trim().length === 0) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const target = event.target;

  try {
    // ── Fast pre-flight in the Web Worker (no network round-trip) ──────────
    // If no regex patterns match we skip the full API call entirely, keeping
    // the UI at 60 fps for the vast majority of "clean" paste events.
    const t0Paste = performance.now();
    const preflight = await workerPreflight(text);
    if (!preflight?.error && !preflight?.hasSensitive) {
      // Nothing suspicious – paste immediately without going to the API
      insertTextIntoField(target, text);
      return;
    }

    // ── Tier 1 exact bypass: checksum-validated match – mask locally, skip AI ──
    // When Tier 1 finds a credit card (Luhn) or Israeli ID (checksum) exact match,
    // we can mask it immediately on the client without an API round-trip.
    if (!preflight?.error && preflight?.tier1Exact && preflight?.tier1Matches?.length > 0) {
      const { maskedText, replacements } = applyTier1Masking(text, preflight.tier1Matches);
      if (replacements.length > 0) {
        persistVault();
        const elapsed = (performance.now() - t0Paste).toFixed(2);
        console.log(`[GhostLayer] Tier 1 exact bypass: masked ${replacements.length} item(s) in ${elapsed}ms – API skipped`);

        const overlayParts = buildOverlayDOM(replacements, maskedText);
        document.body.appendChild(overlayParts.backdrop);
        await runMorphAnimation(overlayParts);
        insertTextIntoField(target, maskedText);
        console.log(`${DLP_PREFIX} ✅ Tier 1 הודבק טקסט סינתטי (${replacements.length} החלפות)`);
        await sleep(TIMING.closeDelay);
        await closeOverlay(overlayParts);
        return;
      }
    }

    const { localAgentUrl: agentUrl, tenantApiKey: apiKey, userEmail: email } = await readSettings();

    const result = await sendCheckText({ text, userEmail: email, source: "paste", apiKey, agentUrl });

    // Handle server-side soft errors (API key invalid, payload too large, rate limited)
    if (result.passThroughWithWarning) {
      const msg =
        result.errorCode === 401 ? "⚠️ DLP: מפתח API אינו תקין – ההדבקה הועברת ללא סינון." :
        result.errorCode === 413 ? "⚠️ DLP: הטקסט ארוך מדי לסינון – הועבר ללא שינוי." :
        "⚠️ DLP: מגבלת קצב בקשות הגיעה – הועבר ללא סינון.";
      insertTextIntoField(target, text);
      showFallbackToast(msg, "warning");
      return;
    }

    const maskedText = result.maskedText || result.redactedText;
    const hasReplacements = Array.isArray(result.replacements) && result.replacements.length > 0;
    const hasMaskedDiff = typeof maskedText === "string" && maskedText !== text;
    const shouldApplyMask = hasReplacements || hasMaskedDiff;
    const isHardBlocked = result.blocked === true;

    if (!isHardBlocked && !shouldApplyMask) {
      insertTextIntoField(target, text);
      showFallbackToast("✅ המידע בטוח – הודבק בהצלחה.", "success");
      return;
    }

    // Hard block (no masked replacement available) – reject the paste
    if (isHardBlocked && maskedText == null) {
      showFallbackToast("⚠️ חומת אש AI: תוכן רגיש זוהה. ההדבקה נחסמה.", "warning");
      return;
    }

    // Support both { vault: {token: original} } and { replacements: [{original, placeholder}] }
    let replacements;
    if (Array.isArray(result.replacements) && result.replacements.length > 0) {
      replacements = result.replacements.map((r) => ({ original: r.original, synthetic: r.placeholder || r.synthetic }));
      for (const r of replacements) {
        if (r.synthetic && r.original) _vault[r.synthetic] = r.original;
      }
    } else {
      const vault = result.vault && typeof result.vault === "object" ? result.vault : {};
      Object.assign(_vault, vault);
      replacements = Object.entries(vault).map(([synthetic, original]) => ({ original, synthetic }));
    }
    persistVault();

    if (replacements.length === 0) {
      insertTextIntoField(target, maskedText);
      showFallbackToast("🛡️ חומת אש AI: תוכן רגיש חוסם ונשלח מוסווה.", "warning");
      return;
    }

    const overlayParts = buildOverlayDOM(replacements, maskedText);
    document.body.appendChild(overlayParts.backdrop);

    await runMorphAnimation(overlayParts);

    insertTextIntoField(target, maskedText);
    console.log(`${DLP_PREFIX} ✅ הודבק טקסט סינתטי (${replacements.length} החלפות)`);

    await sleep(TIMING.closeDelay);
    await closeOverlay(overlayParts);
  } catch (err) {
    if (err.name === "AbortError") {
      showFallbackToast("⚠️ חומת אש AI: פסק זמן שרת. ההדבקה נחסמה.", "warning");
    } else {
      console.error(`${DLP_PREFIX} שגיאה:`, err);
      showFallbackToast("⚠️ חומת אש AI: שגיאת תקשורת. ההדבקה נחסמה לבטיחות.", "warning");
    }
  }
}

/* ─────────────────────────────────────────────
   Build the typing-interception toast message
   ───────────────────────────────────────────── */
function typingInterceptedToast(count) {
  const pl = count !== 1;
  return `🛡️ ${count} פריט${pl ? "ים" : ""} רגיש${pl ? "ים" : ""} הוחלפ${pl ? "ו" : ""} בזמן הקלדה`;
}

/* ─────────────────────────────────────────────
   1A. Input Interception – process typed text
   ───────────────────────────────────────────── */
async function interceptInput(element) {
  if (inputRequestPending) return; // rate limit: skip if previous still pending

  // Skip if DLP itself triggered this event
  if (isInternalOperation || element.hasAttribute(DLP_BYPASS_ATTR)) return;

  const text = element.isContentEditable
    ? element.innerText || element.textContent
    : element.value;

  if (!text || text.trim().length < 3) {
    // Update safe state for short/empty content (it's safe by definition)
    safeStateMap.set(element, text ?? "");
    return;
  }

  // Smooth Undo: if text is shorter than the last safe state the user is deleting –
  // update safe state and skip the API scan (deletion always makes content safer).
  const prevSafeState = safeStateMap.get(element) ?? "";
  if (text.length < prevSafeState.length) {
    safeStateMap.set(element, text);
    return;
  }

  // ── Fast pre-flight in the Web Worker (no network round-trip) ──────────────
  // If no regex patterns match we skip the full API call entirely, keeping
  // the UI responsive for the vast majority of "clean" typing events.
  const t0Input = performance.now();
  const preflight = await workerPreflight(text);
  if (!preflight?.error && !preflight?.hasSensitive) {
    safeStateMap.set(element, text);
    return;
  }

  // ── Soft-only typing: phone/account numbers alone don't block typing ──────
  // When the preflight detects only "soft" patterns (PHONE, ACCOUNT) with no
  // evasion and no checksum-validated matches, let the user keep typing freely.
  // These will still be checked by the server on paste/send (interceptSend),
  // but we don't interrupt the typing flow for regular numbers.
  if (!preflight?.error && preflight?.softOnly && !preflight?.tier1Exact) {
    safeStateMap.set(element, text);
    return;
  }

  // ── Tier 1 exact bypass: checksum-validated match – mask locally, skip AI ──
  // Note: only CREDIT_CARD and ID_NUMBER have checksum validation.
  // PHONE/ACCOUNT never reach here because they have no checksum validator.
  if (!preflight?.error && preflight?.tier1Exact && preflight?.tier1Matches?.length > 0) {
    const { maskedText, replacements } = applyTier1Masking(text, preflight.tier1Matches);
    if (replacements.length > 0) {
      persistVault();
      const elapsed = (performance.now() - t0Input).toFixed(2);
      console.log(`[GhostLayer] Tier 1 exact bypass (typing): masked ${replacements.length} item(s) in ${elapsed}ms`);

      const cursorPos = element.isContentEditable ? null : element.selectionStart;
      _inputMaskingActive = true;
      try {
        setReactInputValue(element, maskedText);
        flashGreen(element);
        safeStateMap.set(element, maskedText);
        debouncedInterceptInput.cancel();
      } finally {
        _inputMaskingActive = false;
      }
      if (!element.isContentEditable && element.setSelectionRange) {
        const newPos = Math.min(cursorPos ?? maskedText.length, maskedText.length);
        try { element.setSelectionRange(newPos, newPos); } catch { /* ignore */ }
      }
      showFallbackToast(typingInterceptedToast(replacements.length), "warning");
      return;
    }
  }

  inputRequestPending = true;
  try {
    const { localAgentUrl: agentUrl, tenantApiKey: apiKey, userEmail: email } = await readSettings();

    const result = await sendCheckText({ text, userEmail: email, source: "typing", mode: "input", apiKey, agentUrl });

    // Handle server-side soft errors – update safe state and let typing continue
    if (result.passThroughWithWarning) {
      safeStateMap.set(element, text);
      return;
    }

    // ── Hard block: revert to safe state ──
    if (result.blocked === true) {
      const safeValue = safeStateMap.get(element) ?? "";
      setReactInputValue(element, safeValue);
      element.blur();
      showBlockWarning();
      console.warn(`${DLP_PREFIX} הקלדה נחסמה – שדה שוחזר למצב בטוח.`);
      return;
    }

    // ── Smart Masking (action: "mask") ──
    if (result.action === "mask" && result.maskedText) {
      const vault = result.vault || {};
      Object.assign(_vault, vault);
      persistVault();

      // Preserve cursor position
      const cursorPos = element.isContentEditable ? null : element.selectionStart;

      // Guard: prevent the programmatic field update from re-triggering the scanner.
      // setReactInputValue dispatches a synthetic "input" event; without this guard,
      // that event would restart debouncedInterceptInput and cause an endless loop.
      _inputMaskingActive = true;
      try {
        setReactInputValue(element, result.maskedText);
        flashGreen(element);
        safeStateMap.set(element, result.maskedText);
        // Cancel any pending debounced scan that may have been queued before the API returned
        debouncedInterceptInput.cancel();
      } finally {
        _inputMaskingActive = false;
      }

      // Restore cursor position (approximate — place at end of masked text or adjusted position)
      if (!element.isContentEditable && element.setSelectionRange) {
        const newPos = Math.min(cursorPos ?? result.maskedText.length, result.maskedText.length);
        try { element.setSelectionRange(newPos, newPos); } catch { /* ignore */ }
      }

      const maskCount = Object.keys(vault).length;
      showFallbackToast(typingInterceptedToast(maskCount), "warning");

      // Notify background
      try {
        chrome.runtime.sendMessage({
          type: "INTERCEPTION_REPORT",
          count: maskCount,
          userEmail: email,
        });
      } catch { /* ignore */ }
      return;
    }

    // ── Soft redaction: replacements returned (cloud-server format) ──
    if (result.replacements && result.replacements.length > 0) {
      const repCount = result.replacements.length;
      console.log(`${DLP_PREFIX} יירוט הקלדה: ${repCount} פריטים הוחלפו`);

      // Update vault so AI responses can de-anonymise these tokens later
      for (const r of result.replacements) {
        const synthetic = r.synthetic || r.placeholder;
        if (synthetic && r.original) _vault[synthetic] = r.original;
      }
      persistVault();

      const redacted = result.redactedText || result.maskedText;
      if (!redacted) {
        // No replacement text available – treat as clean to avoid clearing the field
        safeStateMap.set(element, text);
        return;
      }

      // Guard: prevent the programmatic field update from re-triggering the scanner.
      // setReactInputValue dispatches a synthetic "input" event; without this guard,
      // that event would restart debouncedInterceptInput and cause an endless loop.
      _inputMaskingActive = true;
      try {
        setReactInputValue(element, redacted);
        flashGreen(element);
        safeStateMap.set(element, redacted);
        // Cancel any pending debounced scan that may have been queued before the API returned
        debouncedInterceptInput.cancel();
      } finally {
        _inputMaskingActive = false;
      }

      showFallbackToast(typingInterceptedToast(repCount), "warning");

      // Notify background
      try {
        chrome.runtime.sendMessage({
          type: "INTERCEPTION_REPORT",
          count: repCount,
          userEmail: email,
        });
      } catch { /* ignore */ }
      return;
    }

    // ── Content is clean: update safe state ──
    safeStateMap.set(element, text);
  } catch {
    // fail silently – never break the host page
  } finally {
    inputRequestPending = false;
  }
}

const debouncedInterceptInput = debounce(interceptInput, 500);

/* ─────────────────────────────────────────────
   Pre-Send Interception (Failsafe)
   Called synchronously from keydown/click/submit interceptors AFTER
   preventDefault().  Checks the current input text with the Local Agent,
   applies smart masking if needed, then calls retriggerFn() to re-fire
   the original send action with the (now-safe) content.
   ─────────────────────────────────────────────
   @param {Element}        element      The input / contentEditable element.
   @param {() => void}     retriggerFn  Fires the original send action again.
   ─────────────────────────────────────────────── */
async function interceptSend(element, retriggerFn) {
  const text = (
    element.isContentEditable
      ? (element.innerText || element.textContent || "")
      : (element.value || "")
  ).trim();

  if (!text || text.length < 3) {
    retriggerFn?.();
    return;
  }

  try {
    const { localAgentUrl: agentUrl, tenantApiKey: apiKey, userEmail: email } = await readSettings();

    const result = await sendCheckText({ text, userEmail: email, source: "send", apiKey, agentUrl });

    // Handle server-side soft errors – fail open (let the send through)
    if (result.passThroughWithWarning) {
      retriggerFn?.();
      return;
    }

    // ── Smart Masking ────────────────────────────────────────────────────
    if (result.action === "mask" && result.maskedText && result.vault) {
      // Persist vault entries for de-anonymisation of the AI response
      Object.assign(_vault, result.vault);
      persistVault();

      // Replace the input field content with the masked text
      setReactInputValue(element, result.maskedText);
      flashGreen(element);

      console.log(
        `${DLP_PREFIX} ✅ מסיכת ישויות: ${Object.keys(result.vault).length} ישויות הוחלפו`,
      );

      // Notify background script
      try {
        chrome.runtime.sendMessage({
          type:      "INTERCEPTION_REPORT",
          count:     Object.keys(result.vault).length,
          userEmail: email,
        });
      } catch { /* ignore */ }

      // Re-fire the send with the masked text
      retriggerFn?.();
      return;
    }

    // ── Hard block ───────────────────────────────────────────────────────
    if (result.blocked === true) {
      showBlockWarning();
      console.warn(`${DLP_PREFIX} שליחה נחסמה – תוכן רגיש זוהה.`);
      return; // do NOT retrigger
    }

    // ── Clean – let through ──────────────────────────────────────────────
    retriggerFn?.();
  } catch {
    // Network / timeout error → fail open
    retriggerFn?.();
  }
}

/* ─────────────────────────────────────────────
   Show red blocking warning overlay (Hebrew)
   ───────────────────────────────────────────── */
function showBlockWarning() {
  const existing = document.getElementById("dlp-block-warning");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "dlp-block-warning";
  overlay.setAttribute("role", "alert");
  overlay.setAttribute("aria-live", "assertive");

  Object.assign(overlay.style, {
    position:        "fixed",
    top:             "0",
    left:            "0",
    width:           "100%",
    padding:         "18px 24px",
    zIndex:          "2147483647",
    backgroundColor: "#c0392b",
    color:           "#fff",
    fontSize:        "16px",
    fontWeight:      "700",
    fontFamily:      "'Segoe UI', Arial, sans-serif",
    direction:       "rtl",
    textAlign:       "right",
    boxShadow:       "0 4px 24px rgba(192,57,43,0.7)",
    borderBottom:    "3px solid #922b21",
    cursor:          "pointer",
    userSelect:      "none",
    transition:      "opacity 0.4s ease",
    opacity:         "1",
  });

  overlay.textContent =
    "GhostLayer: הפעולה נחסמה. זוהה ניסיון להקליד מידע ארגוני רגיש.";

  overlay.addEventListener("click", () => {
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 400);
  });

  (document.body || document.documentElement).appendChild(overlay);

  setTimeout(() => {
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 400);
  }, 5000);
}

/* ─────────────────────────────────────────────
   1A. Attach observers/listeners to input element
   ───────────────────────────────────────────── */
function attachInputListeners(element) {
  if (!element || element._dlpAttached) return;
  element._dlpAttached = true;

  // Seed the safe state with whatever is currently in the field
  const currentValue = element.isContentEditable
    ? (element.innerText || element.textContent || "")
    : (element.value || "");
  safeStateMap.set(element, currentValue);

  // Helper: return true when this event was triggered by DLP's own DOM update
  function isDlpInternal() {
    return isInternalOperation || _inputMaskingActive || element.hasAttribute(DLP_BYPASS_ATTR);
  }

  // Track safe state on focus (user starts typing from this point)
  element.addEventListener("focus", () => {
    const val = element.isContentEditable
      ? (element.innerText || element.textContent || "")
      : (element.value || "");
    safeStateMap.set(element, val);
  }, true);

  // input event – fires on every character change
  // Guard: skip when the DLP itself is programmatically updating the field to avoid re-scan loops
  element.addEventListener("input", () => {
    if (!isDlpInternal()) debouncedInterceptInput(element);
  }, true);

  // keyup event – catches keys that don't trigger "input" (e.g. paste via keyboard)
  element.addEventListener("keyup", () => {
    if (!isDlpInternal()) debouncedInterceptInput(element);
  }, true);

  // MutationObserver on the element itself (for React-controlled contentEditables)
  if (element.isContentEditable) {
    const mutObs = new MutationObserver(() => {
      if (!isDlpInternal()) debouncedInterceptInput(element);
    });
    mutObs.observe(element, { characterData: true, childList: true, subtree: true });
  }

  // Keydown: immediate check on Space (cancel debounce and check now)
  element.addEventListener("keydown", (e) => {
    if (e.key === " " && !isDlpInternal()) {
      debouncedInterceptInput.cancel();
      interceptInput(element);
    }
  }, true);

  // Keydown: intercept Enter before send (failsafe – preventDefault immediately)
  element.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (_maskingActive) return; // re-triggered send – let it through

    e.preventDefault();
    e.stopPropagation();
    debouncedInterceptInput.cancel();

    await interceptSend(element, () => {
      _maskingActive = true;
      try {
        element.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter", code: "Enter", keyCode: 13,
            bubbles: true, cancelable: true,
          }),
        );
      } finally {
        _maskingActive = false;
      }
    });
  }, true);
}

/* ─────────────────────────────────────────────
   1A. Watch ALL input fields across the page
   ───────────────────────────────────────────── */

// Moved outside function to avoid repeated allocation in hot path
const ALL_INPUT_SELECTOR =
  "input:not([type='hidden']):not([type='submit']):not([type='button'])" +
  ":not([type='checkbox']):not([type='radio']):not([type='file'])" +
  ":not([type='image']), textarea, [contenteditable='true'], [contenteditable='']";

function watchAllInputs() {
  function attachToAll() {
    try {
      document.querySelectorAll(ALL_INPUT_SELECTOR).forEach(attachInputListeners);
    } catch { /* ignore */ }
  }

  // Attach to all existing inputs immediately
  attachToAll();

  // Watch for new inputs added dynamically (SPA navigations).
  // Use a simple flag to coalesce rapid bursts of mutations.
  let pending = false;
  const observer = new MutationObserver((mutations) => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          try {
            if (node.matches(ALL_INPUT_SELECTOR)) attachInputListeners(node);
          } catch { /* ignore */ }
          try {
            node.querySelectorAll(ALL_INPUT_SELECTOR).forEach(attachInputListeners);
          } catch { /* ignore */ }
        }
      }
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/* ─────────────────────────────────────────────
   Helper: find the currently active input element
   ─────────────────────────────────────────────── */
function findActiveInputElement() {
  const active = document.activeElement;
  if (
    active &&
    active !== document.body &&
    (active.tagName === "TEXTAREA" ||
     active.tagName === "INPUT"    ||
     active.isContentEditable)
  ) {
    return active;
  }
  // Fall back to the first visible input on the page
  try {
    return document.querySelector(ALL_INPUT_SELECTOR) || null;
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────
   1A.2. Aggressive Send-button & Form interceptors
   Catches clicks on "Send" buttons and form submits that bypass the
   per-element keydown listener (e.g. mouse click on the ➤ button).
   ─────────────────────────────────────────────── */
function watchSendButtons() {
  // ── Click on Send buttons ────────────────────────────────────────────────
  document.addEventListener("click", async (e) => {
    if (_maskingActive) return;

    // Walk up the DOM to find a button ancestor
    const btn = e.target.closest("button, [role='button']");
    if (!btn) return;

    const ariaLabel = (btn.getAttribute("aria-label") || btn.title || "").toLowerCase();
    const hasSVG    = !!btn.querySelector("svg");

    // Match explicit send/submit labels OR icon-only buttons that contain an SVG
    // and have no accessible label (common pattern in ChatGPT, Claude, etc.)
    const isSendButton =
      /send|submit|שלח|go|run/i.test(ariaLabel) ||
      (hasSVG && !ariaLabel && !btn.textContent.trim());

    if (!isSendButton) return;

    const input = findActiveInputElement();
    if (!input) return;

    e.preventDefault();
    e.stopPropagation();

    await interceptSend(input, () => {
      _maskingActive = true;
      try { btn.click(); } finally { _maskingActive = false; }
    });
  }, true);

  // ── Form submit ──────────────────────────────────────────────────────────
  document.addEventListener("submit", async (e) => {
    if (_maskingActive) return;

    const form  = e.target;
    const input = form.querySelector(ALL_INPUT_SELECTOR);
    if (!input) return;

    e.preventDefault();
    e.stopPropagation();

    await interceptSend(input, () => {
      _maskingActive = true;
      try { form.submit(); } finally { _maskingActive = false; }
    });
  }, true);
}

/* ─────────────────────────────────────────────
   1B. Output Scanning & Restoration
   ───────────────────────────────────────────── */

// Synthetic data patterns to detect in AI output
const SYNTHETIC_PATTERNS = [
  /05\d[-\s]?\d{7}/g,                           // Israeli mobile (synthetic format) – optional dash or space
  /0[2-9][-\s]?\d{7}/g,                         // Landline (synthetic format) – optional dash or space
  /\b3\d{8}\b/g,                                // ID (starts with 3, 9 digits)
  /user_\d{3}@[a-z]+\.[a-z]{2,}/g,             // Synthetic email
  /4\d{3}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/g,    // Credit card (Visa synthetic)
  /\[[A-Z][A-Z0-9_]*_\d+\]/gi,                  // Smart masking vault tokens: [PERSON_1], [ACCOUNT_1], … (case-insensitive)
];

// Vault-token pattern hoisted to avoid recompilation on every call (g flag – reset lastIndex before use)
const VAULT_TOKEN_PATTERN = /\[[A-Z][A-Z0-9_]*_\d+\]/g;

// AI response selectors
const AI_RESPONSE_SELECTORS = [
  'div[data-message-author-role="assistant"]',
  ".markdown",
  ".prose",
  "div.font-claude-message",
  ".model-response-text",
  "[class*='message'][class*='assistant']",
  "[class*='response']",
];

/**
 * Normalise a synthetic value for fuzzy vault lookup.
 * Collapses separator characters (dash, space, dot) into a single dash so that
 * "1234-5678" and "1234 5678" resolve to the same canonical key.
 * @param {string} key
 * @returns {string}
 */
function normalizeSyntheticKey(key) {
  return key.replace(/[-\s.]+/g, "-").trim().toLowerCase();
}

async function lookupSynthetic(syntheticValue) {
  // ── 1. Check local vault first (tokens from Smart Masking) ──
  // Build candidate keys: the value as-is, uppercased, with/without brackets.
  const stripped = syntheticValue.replace(/^\[|\]$/g, "");
  const candidates = new Set([
    syntheticValue,
    syntheticValue.toUpperCase(),
    stripped,
    stripped.toUpperCase(),
    `[${stripped}]`,
    `[${stripped.toUpperCase()}]`,
  ]);
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(_vault, key)) {
      return _vault[key];
    }
  }

  // ── 1b. Fuzzy fallback: normalise separators (handles '1234-5678' vs '1234 5678') ──
  const normalizedQuery = normalizeSyntheticKey(syntheticValue);
  for (const vaultKey of Object.keys(_vault)) {
    if (normalizeSyntheticKey(vaultKey) === normalizedQuery) {
      return _vault[vaultKey];
    }
  }

  if (restorationCache.has(syntheticValue)) {
    return restorationCache.get(syntheticValue);
  }

  try {
    const { localAgentUrl: agentUrl } = await readSettings();
    const data = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: "LOOKUP_SYNTHETIC",
        syntheticValue,
        apiUrl: `${agentUrl}/api/check-text`,
      }, (response) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (response?.error) { reject(new Error("Lookup failed")); return; }
        resolve(response);
      });
    });
    if (data.found && data.originalText) {
      restorationCache.set(syntheticValue, data.originalText);
      return data.originalText;
    }
  } catch {
    // fail silently
  }
  return null;
}

function createRestoredSpan(originalText, syntheticValue) {
  const span = document.createElement("span");
  span.className = "dlp-restored";
  span.setAttribute("data-restored", "true");
  span.setAttribute("data-dlp-synthetic", syntheticValue);
  span.title = `🛡️ DLP Shield: מידע מוגן שוחזר (מקורי: ${originalText})`;
  span.textContent = originalText;
  // Preserve whitespace, newlines, and extra spaces that may be in the original value
  span.style.whiteSpace = "pre-wrap";
  return span;
}

// ── Concurrent-scan guard: prevents overlapping async scans of the same root ──
const _activeScanRoots = new WeakSet();

async function scanAndRestore(root) {
  if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
  if (root.closest("[data-restored='true']")) return; // already restored parent

  // Prevent a second concurrent scan of the same root while async lookups are in
  // flight.  The debounce will re-queue a scan if more mutations arrive later.
  if (_activeScanRoots.has(root)) return;
  _activeScanRoots.add(root);

  try {
  // Walk all text nodes
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || node.nodeValue.trim() === "") return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest("[data-restored='true']")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodesToProcess = [];
  let node;
  while ((node = walker.nextNode())) {
    // Re-scan the node whenever its text content has changed since the last pass.
    // This is the key fix for streaming: a node seen as "clean" earlier may now
    // contain a complete synthetic token after more text has been appended to it.
    if (processedContent.get(node) !== node.nodeValue) {
      nodesToProcess.push(node);
    }
  }

  // ── Phase 1: collect all async lookups before touching the DOM ──────────────
  // This avoids interleaving DOM writes with pending microtasks and gives us a
  // clean snapshot of the work before we apply changes in a single RAF frame.
  const pendingUpdates = []; // { textNode, parts, replaceCount }

  for (const textNode of nodesToProcess) {
    const text = textNode.nodeValue;
    // Record current content immediately so a concurrent scan skips this snapshot.
    processedContent.set(textNode, text);
    if (!text) continue;

    // Collect all matches from all patterns
    const allMatches = [];
    for (const pattern of SYNTHETIC_PATTERNS) {
      pattern.lastIndex = 0; // reset before reuse
      let m;
      while ((m = pattern.exec(text)) !== null) {
        allMatches.push({ match: m[0], index: m.index });
      }
    }

    if (allMatches.length === 0) continue;

    // Remove duplicates and sort by position
    const uniqueMatches = [];
    const seen = new Set();
    for (const m of allMatches) {
      if (!seen.has(m.match)) {
        seen.add(m.match);
        uniqueMatches.push(m);
      }
    }
    uniqueMatches.sort((a, b) => a.index - b.index);

    // Look up each synthetic value
    const lookups = await Promise.allSettled(
      uniqueMatches.map((m) => lookupSynthetic(m.match))
    );

    // Build replacement map
    const replaceMap = new Map();
    for (let i = 0; i < uniqueMatches.length; i++) {
      const result = lookups[i];
      if (result.status === "fulfilled" && result.value) {
        replaceMap.set(uniqueMatches[i].match, result.value);
      }
    }

    if (replaceMap.size === 0) continue;

    // Build the parts array (text / restored segments) for this node
    const sortedSynthetics = [...replaceMap.keys()].sort((a, b) => {
      return text.indexOf(a) - text.indexOf(b);
    });

    const parts = [];
    let remaining = text;

    while (remaining.length > 0) {
      let earliestIndex = Infinity;
      let earliestSynthetic = null;

      for (const syn of sortedSynthetics) {
        const idx = remaining.indexOf(syn);
        if (idx !== -1 && idx < earliestIndex) {
          earliestIndex = idx;
          earliestSynthetic = syn;
        }
      }

      if (earliestSynthetic === null) {
        parts.push({ type: "text", value: remaining });
        break;
      }

      if (earliestIndex > 0) {
        parts.push({ type: "text", value: remaining.slice(0, earliestIndex) });
      }
      parts.push({ type: "restored", synthetic: earliestSynthetic, original: replaceMap.get(earliestSynthetic) });
      remaining = remaining.slice(earliestIndex + earliestSynthetic.length);
    }

    pendingUpdates.push({ textNode, parts, replaceCount: replaceMap.size });
  }

  if (pendingUpdates.length === 0) return;

  // ── Phase 2: apply all DOM writes in a single requestAnimationFrame ─────────
  // Batching writes into one RAF frame prevents layout thrashing and CPU spikes
  // when multiple nodes need restoration simultaneously.
  // CURSOR SAFETY: Skip any node that is currently inside the user's focused
  // contentEditable element to avoid hijacking the active caret position.
  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      // Identify the currently focused editable element (if any) to guard the cursor
      const activeEl = document.activeElement;
      const activeCE = (activeEl && activeEl.isContentEditable) ? activeEl : null;

      _dlpScanMutating = true;
      let totalRestored = 0;
      try {
        for (const { textNode, parts, replaceCount } of pendingUpdates) {
          // Skip nodes inside the user's active contentEditable to protect the caret
          if (activeCE && activeCE.contains(textNode)) continue;
          // Node may have been removed by React re-render since the lookup phase
          if (!textNode.parentNode) continue;

          const fragment = document.createDocumentFragment();
          for (const part of parts) {
            if (part.type === "text") {
              fragment.appendChild(document.createTextNode(part.value));
            } else {
              fragment.appendChild(createRestoredSpan(part.original, part.synthetic));
            }
          }

          try {
            textNode.parentNode.replaceChild(fragment, textNode);
            totalRestored += replaceCount;
          } catch {
            // DOM operation failed (node removed concurrently) – ignore
          }
        }
      } finally {
        _dlpScanMutating = false;
        resolve();
      }

      if (totalRestored > 0) {
        try {
          chrome.runtime.sendMessage({ type: "ITEMS_RESTORED", count: totalRestored });
        } catch { /* ignore */ }
        console.log(`${DLP_PREFIX} שוחזרו ${totalRestored} ערכים בתשובת AI`);
      }
    });
  });

  } finally {
    _activeScanRoots.delete(root);
  }
}

/* ─────────────────────────────────────────────
   1B. Streaming-Aware De-anonymisation Engine
   ───────────────────────────────────────────── *
   Problem: AI chat interfaces (ChatGPT, Claude, Gemini) use React / ProseMirror
   which aggressively re-renders the DOM during streaming, overwriting any DOM
   changes we make.  A rAF-batched approach introduces a ~16 ms window during
   which React can replace the very text nodes we queued, causing the restored
   text to disappear seconds after it first appears.

   Solution:
     Fast path  – Vault tokens ([PERSON_1], [ACCOUNT_2], …) are replaced
                  synchronously inside the MutationObserver callback itself.
                  The observer is DISCONNECTED before any DOM write and
                  RECONNECTED immediately after, preventing infinite loops
                  without relying on a mutable lock flag.  This eliminates
                  the rAF delay so React has no window to overwrite us before
                  we apply the restoration.  A hasPartialVaultToken guard
                  prevents replacing an incomplete token still being streamed
                  (e.g. "[PERSON_" before "_1]" arrives).

     Slow path  – Non-vault synthetic patterns (phone, email, credit-card, ID)
                  still go through the async scanAndRestore() triggered with
                  debounceWithMaxWait(150 ms trailing, 800 ms max) so the scan
                  fires at most every 800 ms even during continuous streaming.
   ─────────────────────────────────────────────── */

// ── Per-container async scan scheduler ──────────────────────────────────────
const scheduleAsyncScan = debounceWithMaxWait((el) => {
  try { scanAndRestore(el); } catch { /* ignore */ }
}, 150, 800);

/**
 * Returns true when text ends with an incomplete vault-token opener such as
 * "[PERSON_" (opening bracket found with no matching closing bracket after it).
 * This guards against replacing a token that is still being streamed in.
 * @param {string} text
 */
function hasPartialVaultToken(text) {
  if (!text) return false;
  const lastOpen = text.lastIndexOf("[");
  if (lastOpen === -1) return false;
  return text.indexOf("]", lastOpen) === -1;
}

/**
 * Synchronously replace all vault tokens found in textNode with dlp-restored
 * spans.  The original text node is substituted with a DocumentFragment.
 * @param {Text} textNode
 * @returns {number} Number of tokens replaced (0 if none found or node detached).
 */
function applyVaultReplacements(textNode) {
  const text = textNode.nodeValue;
  if (!text) return 0;

   // Quick rejection: no vault keys at all (for-in avoids Object.keys array allocation)
  let _vaultEmpty = true;
  for (const k in _vault) { if (Object.prototype.hasOwnProperty.call(_vault, k)) { _vaultEmpty = false; break; } }
  if (_vaultEmpty) return 0;

  // Collect vault tokens present in this text, sorted by their first occurrence
  VAULT_TOKEN_PATTERN.lastIndex = 0;
  const matches = []; // { token: string, index: number }
  let m;
  while ((m = VAULT_TOKEN_PATTERN.exec(text)) !== null) {
    if (Object.prototype.hasOwnProperty.call(_vault, m[0])) {
      matches.push({ token: m[0], index: m.index });
    }
  }
  if (matches.length === 0) return 0;

  // Build replacement fragment in a single linear pass (matches are already
  // in document order from the exec loop above, so no sort needed)
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const { token, index } of matches) {
    if (index > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, index)));
    }
    fragment.appendChild(createRestoredSpan(_vault[token], token));
    cursor = index + token.length;
  }
  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }

  try {
    textNode.parentNode.replaceChild(fragment, textNode);
  } catch {
    return 0; // DOM operation failed (node may have been removed concurrently)
  }
  return matches.length;
}

function watchForAIOutput() {
  /**
   * Resolve the nearest AI response container for a given element, or null.
   * @param {Element|null} el
   * @returns {Element|null}
   */
  function findAIContainer(el) {
    if (!el) return null;
    for (const sel of AI_RESPONSE_SELECTORS) {
      try {
        const found = el.closest(sel);
        if (found) return found;
      } catch { /* ignore invalid selector */ }
    }
    return null;
  }

  /**
   * Find the most specific stable root element to observe.
   * A narrower root means fewer irrelevant mutations and better performance
   * during streaming.  Falls back to document.body if nothing more specific
   * is available.
   * @returns {Element}
   */
  function findObserveTarget() {
    for (const sel of ["main", "[role='main']", "#__next", "#root"]) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch { /* ignore */ }
    }
    return document.body;
  }

  const observeConfig = { childList: true, subtree: true, characterData: true };
  let observeTarget = findObserveTarget();

  /**
   * Inspect a single text node and categorise it for the fast or slow path.
   * Nodes that are already inside a restored span, or that live outside any
   * recognised AI response container, are silently ignored.
   *
   * @param {Text}         textNode
   * @param {Text[]}       vaultCandidates  Accumulator – nodes to vault-restore.
   * @param {Set<Element>} containerSet     Accumulator – containers to async-scan.
   */
  function classifyTextNode(textNode, vaultCandidates, containerSet) {
    if (!textNode.parentNode) return;
    const text = textNode.nodeValue;
    if (!text || !/\S/.test(text)) return;
    // Fast O(1) check on immediate parent before the costlier closest() DOM walk
    const parentEl = textNode.parentElement;
    if (parentEl?.getAttribute("data-restored") === "true") return;
    if (parentEl?.closest("[data-restored='true']")) return;

    const container = findAIContainer(parentEl);
    if (!container) return;

    // Fast path: candidate for vault-token replacement (O(1) vault check)
    let hasVaultEntries = false;
    for (const k in _vault) {
      if (Object.prototype.hasOwnProperty.call(_vault, k)) { hasVaultEntries = true; break; }
    }
    if (hasVaultEntries) {
      vaultCandidates.push(textNode);
    }

    // Slow path: schedule async scan for the enclosing container
    containerSet.add(container);
  }

  const outputObserver = new MutationObserver((mutations) => {
    // Skip mutations triggered by scanAndRestore (async slow path) to avoid
    // redundant re-processing of data-restored spans.
    if (_dlpScanMutating) return;

    const vaultCandidates  = [];
    const containersToScan = new Set();

    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            // Raw text node streamed directly into the DOM
            classifyTextNode(/** @type {Text} */ (node), vaultCandidates, containersToScan);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            // Walk every text node inside the newly added element subtree
            const walker = document.createTreeWalker(
              node,
              NodeFilter.SHOW_TEXT,
              {
                acceptNode(n) {
                  return n.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                },
              },
            );
            let tn;
            while ((tn = walker.nextNode())) {
              classifyTextNode(/** @type {Text} */ (tn), vaultCandidates, containersToScan);
            }
          }
        }
      } else if (mutation.type === "characterData") {
        // Streaming appended text to an existing text node — the primary pattern
        // used by ChatGPT, Claude, Gemini, and most React-based AI chat UIs.
        const target = mutation.target;
        if (target.nodeType === Node.TEXT_NODE) {
          classifyTextNode(/** @type {Text} */ (target), vaultCandidates, containersToScan);
        }
      }
    }

    // ── Fast path: apply vault-token restorations synchronously ──────────────
    // CRITICAL: Disconnect the observer BEFORE any DOM write so our own
    // replaceChild calls do not re-trigger this callback (infinite-loop guard).
    // Reconnect immediately in the finally block so subsequent React mutations
    // (e.g. the next streaming chunk) are still observed.  This is more robust
    // than a mutable lock flag because it holds even when React's reconciler
    // fires synchronously within the same microtask batch.
    if (vaultCandidates.length > 0) {
      outputObserver.disconnect();
      let totalRestored = 0;
      try {
        for (const tn of vaultCandidates) {
          if (!tn.parentNode) continue;                                       // detached by React before we got here
          if (hasPartialVaultToken(tn.nodeValue)) continue;                   // token still streaming in
          if (tn.parentElement?.closest("[data-restored='true']")) continue;  // already inside a restored span
          totalRestored += applyVaultReplacements(tn);
        }
      } finally {
        // Always reconnect – even if an error occurs mid-loop
        outputObserver.observe(observeTarget, observeConfig);
      }
      if (totalRestored > 0) {
        try { chrome.runtime.sendMessage({ type: "ITEMS_RESTORED", count: totalRestored }); } catch { /* ignore */ }
        console.log(`${DLP_PREFIX} שוחזרו ${totalRestored} טוקנים מ-vault בזרם AI`);
      }
    }

    // ── Slow path: async scan for synthetic patterns (phone, email, CC, ID) ──
    for (const container of containersToScan) {
      scheduleAsyncScan(container);
    }
  });

  outputObserver.observe(observeTarget, observeConfig);

  // Watchdog: if the initial observe target is later removed from the DOM
  // (e.g. a framework re-mount), fall back to document.body so we never go dark.
  if (observeTarget !== document.body) {
    new MutationObserver(() => {
      if (!document.contains(observeTarget)) {
        observeTarget = document.body;
        try {
          outputObserver.disconnect();
          outputObserver.observe(observeTarget, observeConfig);
        } catch { /* ignore */ }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
}

/* ─────────────────────────────────────────────
   Shadow DOM Toast – non-intrusive, style-isolated notification.
   Injects into a shadow root so page CSS cannot clash with the toast.
   Falls back gracefully if Shadow DOM is unavailable.
   ───────────────────────────────────────────── */
function showFallbackToast(message, type = "info") {
  // Remove any existing toast host
  const existingHost = document.getElementById("dlp-toast-host");
  if (existingHost) existingHost.remove();

  const colors = { success: "#34C759", warning: "#F57C00", info: "#1976D2" };
  const bg = colors[type] || colors.info;

  const host = document.createElement("div");
  host.id = "dlp-toast-host";
  Object.assign(host.style, {
    position:       "fixed",
    top:            "20px",
    left:           "50%",
    transform:      "translateX(-50%)",
    zIndex:         "2147483647",
    pointerEvents:  "none",
  });

  // Use Shadow DOM to isolate styles from the host page
  let container;
  if (host.attachShadow) {
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        .dlp-toast {
          display: inline-block;
          padding: 12px 24px;
          border-radius: 10px;
          background: ${bg};
          color: #fff;
          font-size: 15px;
          font-weight: 600;
          font-family: 'Segoe UI', Arial, sans-serif;
          direction: rtl;
          text-align: right;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          opacity: 0;
          transition: opacity 0.3s ease;
          white-space: nowrap;
        }
        .dlp-toast.visible { opacity: 1; }
      </style>
      <div class="dlp-toast">${message}</div>`;
    container = shadow.querySelector(".dlp-toast");
  } else {
    // Fallback: no Shadow DOM support
    container = document.createElement("div");
    Object.assign(container.style, {
      padding: "12px 24px", borderRadius: "10px", background: bg,
      color: "#fff", fontSize: "15px", fontWeight: "600",
      fontFamily: "'Segoe UI', Arial, sans-serif", direction: "rtl",
      boxShadow: "0 4px 20px rgba(0,0,0,0.3)", opacity: "0",
      transition: "opacity 0.3s ease",
    });
    container.textContent = message;
    host.appendChild(container);
  }

  (document.body || document.documentElement).appendChild(host);

  requestAnimationFrame(() => {
    if (container.classList) {
      container.classList.add("visible");
    } else {
      container.style.opacity = "1";
    }
  });

  setTimeout(() => {
    if (container.classList) {
      container.classList.remove("visible");
    } else {
      container.style.opacity = "0";
    }
    setTimeout(() => host.remove(), 350);
  }, 3000);
}

/* ─────────────────────────────────────────────
   OCR Image Protection
   Intercepts image files pasted or uploaded via <input type="file">
   before they reach the AI.  Sends the image to the local agent's
   /api/check-image endpoint and blocks if sensitive text is found.
   ─────────────────────────────────────────────── */

/**
 * Convert a File / Blob to a base64 data-URI string.
 * @param {File|Blob} blob
 * @returns {Promise<string>}
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Send an image (as base64 data-URI) to the local agent for OCR+DLP check.
 * Returns the API response or null on network error.
 * @param {string} imageData  base64 data-URI
 * @param {string} email      user email for telemetry
 * @returns {Promise<object|null>}
 */
async function checkImageWithOcr(imageData, email) {
  try {
    const { localAgentUrl: agentUrl, tenantApiKey: apiKey } = await readSettings();
    return await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type:      "CHECK_IMAGE",
        imageData,
        userEmail: email || userEmail,
        apiKey,
        agentUrl,
      }, (response) => {
        if (chrome.runtime.lastError || !response || response.error) {
          resolve(null);
          return;
        }
        resolve(response);
      });
    });
  } catch {
    return null;
  }
}

/**
 * Handle paste events that contain image items in the clipboard.
 * @param {ClipboardEvent} event
 */
async function handleImagePaste(event) {
  const items = Array.from(event.clipboardData?.items || []);
  const imageItem = items.find((item) => item.type.startsWith("image/"));
  if (!imageItem) return;

  // We have an image in the clipboard – intercept and check it
  event.preventDefault();
  event.stopImmediatePropagation();

  const blob = imageItem.getAsFile();
  if (!blob) return;

  try {
    const imageData = await blobToBase64(blob);
    const result    = await checkImageWithOcr(imageData, userEmail);

    if (result?.blocked) {
      showFallbackToast(
        `🛡️ GhostLayer: צילום מסך נחסם – ${result.reason || "נמצא מידע רגיש בתמונה"}`,
        "warning",
      );
      console.warn(`${DLP_PREFIX} תמונה נחסמה מ-OCR:`, result.reason);
      return;
    }

    // Image is clean – re-paste it programmatically via execCommand (best-effort)
    // Note: Pasting binary blobs back requires the Clipboard API which needs user gesture.
    // We inform the user that the image was scanned and cleared.
    showFallbackToast("✅ GhostLayer: התמונה נסרקה ונמצאה בטוחה.", "success");

  } catch (err) {
    console.warn(`${DLP_PREFIX} שגיאת בדיקת תמונה:`, err.message);
    // Fail open – allow the paste to proceed if OCR check fails
  }
}

/**
 * Send an image file (as raw binary) to the local agent's /api/check-file
 * endpoint using multipart/form-data.
 * Returns the API response or null on network error.
 * @param {File|Blob} file
 * @param {string}    email
 * @returns {Promise<object|null>}
 */
async function checkFileWithOcr(file, email) {
  try {
    const { localAgentUrl: agentUrl } = await readSettings();
    const formData = new FormData();
    formData.append("file", file, file.name || "image.png");
    formData.append("userEmail", email || userEmail);

    // Direct fetch from the content script (no background proxy needed since
    // the local agent runs on the same machine, so no CORS headers are required).
    const res = await fetch(`${agentUrl}/api/check-file`, {
      method: "POST",
      body:   formData,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Intercept drag-and-drop of image files onto the page.
 * Checks every dropped image through OCR before allowing it to be processed.
 */
function watchDragAndDrop() {
  // dragover must be captured to allow drop event to fire
  document.addEventListener("dragover", (e) => {
    // Only intercept if dragged items contain files
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
    }
  }, true);

  document.addEventListener("drop", async (e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    // Cancel the drop – we will re-allow it only after a clean OCR scan
    e.preventDefault();
    e.stopImmediatePropagation();

    for (const file of imageFiles) {
      try {
        const result = await checkFileWithOcr(file, userEmail);
        if (result?.blocked) {
          showFallbackToast(
            `🛡️ GhostLayer: קובץ גרור-ושחרר נחסם – ${result.reason || "נמצא מידע רגיש בתמונה"}`,
            "warning",
          );
          console.warn(`${DLP_PREFIX} גרור-ושחרר נחסם:`, result.reason);
          return; // block the drop entirely if any image is sensitive
        }
      } catch {
        // Fail open – do not block on OCR errors during drag-and-drop
      }
    }

    // All images cleared – inform the user that they must drop the files again.
    // Re-firing a prevented drop event is not possible in browsers; the user
    // performs the drop a second time, which then proceeds unimpeded.
    showFallbackToast("✅ GhostLayer: הקבצים נסרקו ונמצאו בטוחים. אנא גרור ושחרר שנית להמשך.", "success");
  }, true);
}

/**
 * Intercept <input type="file"> change events.
 * When the user selects image files, check each one before allowing upload.
 */
function watchFileInputs() {
  function attachFileListener(input) {
    if (!input || input._dlpFileAttached) return;
    input._dlpFileAttached = true;

    input.addEventListener("change", async (e) => {
      const files = Array.from(input.files || []);
      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length === 0) return;

      for (const file of imageFiles) {
        try {
          const imageData = await blobToBase64(file);
          const result    = await checkImageWithOcr(imageData, userEmail);

          if (result?.blocked) {
            // Clear the file input to prevent upload
            input.value = "";
            showFallbackToast(
              `🛡️ GhostLayer: קובץ תמונה נחסם – ${result.reason || "נמצא מידע רגיש"}`,
              "warning",
            );
            console.warn(`${DLP_PREFIX} קובץ תמונה נחסם:`, result.reason);
            return;
          }
        } catch {
          // Fail open – do not block on OCR errors
        }
      }
    }, true);
  }

  // Attach to existing file inputs
  try {
    document.querySelectorAll("input[type='file']").forEach(attachFileListener);
  } catch { /* ignore */ }

  // Watch for dynamically added file inputs
  const obs = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        try {
          if (node.tagName === "INPUT" && node.type === "file") {
            attachFileListener(node);
          }
          node.querySelectorAll?.("input[type='file']").forEach(attachFileListener);
        } catch { /* ignore */ }
      }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

/* ─────────────────────────────────────────────
   Initialisation
   ───────────────────────────────────────────── */
async function init() {
  await fetchConfig({ force: true });

  // Load settings (localAgentUrl, tenantApiKey) from storage
  await loadSettings();

  // Restore persisted vault so tokens from previous turns/sessions are recognised
  await new Promise((resolve) => {
    try {
      chrome.storage.local.get(["dlp_vault"], (data) => {
        if (!chrome.runtime.lastError && data.dlp_vault && typeof data.dlp_vault === "object") {
          Object.assign(_vault, data.dlp_vault);
        }
        resolve();
      });
    } catch {
      // extension context may be invalidated – ignore
      resolve();
    }
  });

  // Live-sync settings: if the user updates Email or Agent URL in the Popup/Options,
  // pick up the change immediately without requiring a page reload.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.localAgentUrl?.newValue) localAgentUrl = changes.localAgentUrl.newValue;
      if (changes.serverUrl?.newValue)     localAgentUrl = changes.serverUrl.newValue;
      if (changes.tenantApiKey?.newValue)  tenantApiKey  = changes.tenantApiKey.newValue;
      if (changes.employeeEmail?.newValue) userEmail     = changes.employeeEmail.newValue;
    });
  } catch {
    // extension context may be invalidated – ignore
  }

  setInterval(() => {
    fetchConfig();
  }, CONFIG_SYNC_MIN_INTERVAL_MS);

  // 1C. Get user email from background
  initUserEmail();

  // 1D. Register a unified paste handler (capture phase).
  // A single handler processes both text pastes (DLP scan) and image pastes (OCR scan)
  // to avoid race conditions when both listeners would fire for the same event.
  document.addEventListener("paste", async (event) => {
    // Check for image data first – if present, delegate to image handler and return
    const items = Array.from(event.clipboardData?.items || []);
    if (items.some((item) => item.type.startsWith("image/"))) {
      await handleImagePaste(event);
      return;
    }
    // Otherwise handle as a text paste
    await handlePaste(event);
  }, true);

  // 1A. Watch ALL input fields on the page (real-time typing DLP)
  watchAllInputs();

  // 1A.2. Aggressive Send-button & form submit interceptors
  watchSendButtons();

  // Image OCR protection: watch file inputs and drag-and-drop
  watchFileInputs();
  watchDragAndDrop();

  // 1B. Watch for AI output / responses (+ vault token de-anonymisation)
  watchForAIOutput();

  console.log(`${DLP_PREFIX} v3 נטען – יירוט הדבקות + הקלדה + שליחה + סריקת תשובות AI + הגנת OCR + גרור-ושחרר פעילים.`);
}

init();
