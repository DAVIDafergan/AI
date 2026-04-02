/* ═══════════════════════════════════════════════════════════════
   AI DLP Firewall v3 – Content Script
   • Paste interception + animated overlay (existing)
   • Input interception (real-time typing)
   • Output scanning & de-anonymization (AI responses)
   • User email auto-detection
   ═══════════════════════════════════════════════════════════════ */

const DLP_API_URL                = "https://ai-production-ffa9.up.railway.app/api/check-text";
const DEFAULT_LOCAL_AGENT_URL    = "http://localhost:4000";
const DLP_PREFIX                 = "🛡️ DLP Shield:";

// ── User email (populated on init) ──
let userEmail = "anonymous@unknown.com";

// ── Settings loaded from chrome.storage.local ──
let localAgentUrl = DEFAULT_LOCAL_AGENT_URL;
let tenantApiKey  = "";

// ── Loop-prevention & caching ──
const processedNodes   = new WeakSet();
const restorationCache = new Map(); // synthetic → original

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
   Load settings from chrome.storage.local
   ───────────────────────────────────────────── */
function loadSettings() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(["localAgentUrl", "tenantApiKey", "employeeEmail"], (data) => {
        if (!chrome.runtime.lastError) {
          if (data.localAgentUrl) localAgentUrl = data.localAgentUrl;
          if (data.tenantApiKey)  tenantApiKey  = data.tenantApiKey;
          if (data.employeeEmail) userEmail     = data.employeeEmail;
        }
        resolve();
      });
    } catch {
      // extension context may be invalidated – ignore
      resolve();
    }
  });
}

/* ─────────────────────────────────────────────
   Read fresh settings right before a fetch.
   Reads ['serverUrl', 'localAgentUrl', 'tenantApiKey', 'userEmail', 'employeeEmail']
   from chrome.storage.local.  serverUrl (saved by popup.js) takes priority over
   localAgentUrl (saved by options.js).  Falls back to DEFAULT_LOCAL_AGENT_URL.
   ───────────────────────────────────────────── */
function readSettings() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(["serverUrl", "localAgentUrl", "tenantApiKey", "userEmail", "employeeEmail"], (data) => {
        if (chrome.runtime.lastError) {
          resolve({
            localAgentUrl: DEFAULT_LOCAL_AGENT_URL,
            tenantApiKey:  "",
            userEmail:     userEmail || "anonymous@unknown.com",
          });
          return;
        }
        const finalUrl = data.localAgentUrl || data.serverUrl || DEFAULT_LOCAL_AGENT_URL;
        resolve({
          localAgentUrl: finalUrl,
          tenantApiKey:  data.tenantApiKey  || "",
          userEmail:     data.employeeEmail || data.userEmail || userEmail || "anonymous@unknown.com",
        });
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
    const preflight = await workerPreflight(text);
    if (!preflight?.error && !preflight?.hasSensitive) {
      // Nothing suspicious – paste immediately without going to the API
      insertTextIntoField(target, text);
      return;
    }

    const { localAgentUrl: agentUrl, tenantApiKey: apiKey, userEmail: email } = await readSettings();

    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: "CHECK_TEXT",
        text,
        userEmail: email,
        source: "paste",
        apiKey,
        agentUrl,
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.message || "Background fetch failed"));
          return;
        }
        resolve(response);
      });
    });

    if (result.blocked !== true) {
      insertTextIntoField(target, text);
      showFallbackToast("✅ המידע בטוח – הודבק בהצלחה.", "success");
      return;
    }

    // Hard block (no masked replacement available) – reject the paste
    if (result.action !== "mask" || !result.maskedText) {
      showFallbackToast("⚠️ חומת אש AI: תוכן רגיש זוהה. ההדבקה נחסמה.", "warning");
      return;
    }

    const vault        = result.vault || {};
    Object.assign(_vault, vault);
    const replacements = Object.entries(vault).map(([synthetic, original]) => ({ original, synthetic }));
    const overlayParts = buildOverlayDOM(replacements, result.maskedText);
    document.body.appendChild(overlayParts.backdrop);

    await runMorphAnimation(overlayParts);

    insertTextIntoField(target, result.maskedText);
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

  inputRequestPending = true;
  try {
    const { localAgentUrl: agentUrl, tenantApiKey: apiKey, userEmail: email } = await readSettings();

    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: "CHECK_TEXT",
        text,
        userEmail: email,
        source: "typing",
        mode: "input",
        apiKey,
        agentUrl,
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.message || "Background fetch failed"));
          return;
        }
        resolve(response);
      });
    });

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

      // Notify background
      try {
        chrome.runtime.sendMessage({
          type: "INTERCEPTION_REPORT",
          count: Object.keys(vault).length,
          userEmail: email,
        });
      } catch { /* ignore */ }
      return;
    }

    // ── Soft redaction: replacements returned ──
    if (result.replacements && result.replacements.length > 0) {
      console.log(`${DLP_PREFIX} יירוט הקלדה: ${result.replacements.length} פריטים הוחלפו`);

      // Guard: prevent the programmatic field update from re-triggering the scanner.
      // setReactInputValue dispatches a synthetic "input" event; without this guard,
      // that event would restart debouncedInterceptInput and cause an endless loop.
      _inputMaskingActive = true;
      try {
        setReactInputValue(element, result.redactedText);
        flashGreen(element);
        safeStateMap.set(element, result.redactedText);
        // Cancel any pending debounced scan that may have been queued before the API returned
        debouncedInterceptInput.cancel();
      } finally {
        _inputMaskingActive = false;
      }

      // Notify background
      try {
        chrome.runtime.sendMessage({
          type: "INTERCEPTION_REPORT",
          count: result.replacements.length,
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

const debouncedInterceptInput = debounce(interceptInput, 600);

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

    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: "CHECK_TEXT",
        text,
        userEmail: email,
        source: "send",
        apiKey,
        agentUrl,
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.message || "Background fetch failed"));
          return;
        }
        resolve(response);
      });
    });

    // ── Smart Masking ────────────────────────────────────────────────────
    if (result.action === "mask" && result.maskedText && result.vault) {
      // Persist vault entries for de-anonymisation of the AI response
      Object.assign(_vault, result.vault);

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
  /05\d-\d{7}/g,                              // Israeli mobile (synthetic format)
  /0[2-9]-\d{7}/g,                            // Landline (synthetic format)
  /\b3\d{8}\b/g,                              // ID (starts with 3, 9 digits)
  /user_\d{3}@[a-z]+\.[a-z]{2,}/g,           // Synthetic email
  /4\d{3}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/g,  // Credit card (Visa synthetic)
  /\[[A-Z][A-Z0-9_]*_\d+\]/g,                   // Smart masking vault tokens: [PERSON_1], [ACCOUNT_1], …
];

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

async function lookupSynthetic(syntheticValue) {
  // ── 1. Check local vault first (tokens from Smart Masking) ──
  if (Object.prototype.hasOwnProperty.call(_vault, syntheticValue)) {
    return _vault[syntheticValue];
  }

  if (restorationCache.has(syntheticValue)) {
    return restorationCache.get(syntheticValue);
  }

  try {
    const data = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: "LOOKUP_SYNTHETIC",
        syntheticValue,
        apiUrl: DLP_API_URL,
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
  return span;
}

async function scanAndRestore(root) {
  if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
  if (root.closest("[data-restored='true']")) return; // already restored parent

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
    if (!processedNodes.has(node)) {
      nodesToProcess.push(node);
    }
  }

  for (const textNode of nodesToProcess) {
    processedNodes.add(textNode);
    const text = textNode.nodeValue;
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

    // Replace text node with fragment containing spans
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    const fullText = text;

    // Re-scan in order using replaceMap
    const sortedSynthetics = [...replaceMap.keys()].sort((a, b) => {
      return fullText.indexOf(a) - fullText.indexOf(b);
    });

    let cursor = 0;
    const parts = [];
    let remaining = fullText;

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

    for (const part of parts) {
      if (part.type === "text") {
        fragment.appendChild(document.createTextNode(part.value));
      } else {
        fragment.appendChild(createRestoredSpan(part.original, part.synthetic));
      }
    }

    try {
      // Guard: suppress the MutationObserver from re-triggering a scan when we replace DOM nodes
      _dlpScanMutating = true;
      try {
        textNode.parentNode?.replaceChild(fragment, textNode);
      } finally {
        _dlpScanMutating = false;
      }

      // Notify background
      try {
        chrome.runtime.sendMessage({ type: "ITEMS_RESTORED", count: replaceMap.size });
      } catch { /* ignore */ }

      console.log(`${DLP_PREFIX} שוחזרו ${replaceMap.size} ערכים בתשובת AI`);
    } catch {
      // DOM operation failed – ignore
    }
  }
}

/* ─────────────────────────────────────────────
   1B. MutationObserver for AI output
   ───────────────────────────────────────────── */
const debouncedScanElement = debounce((el) => {
  try { scanAndRestore(el); } catch { /* ignore */ }
}, 500);

function isAIResponseElement(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  return AI_RESPONSE_SELECTORS.some((sel) => {
    try { return el.matches(sel) || el.querySelector(sel); } catch { return false; }
  });
}

function watchForAIOutput() {
  const outputObserver = new MutationObserver((mutations) => {
    // Skip mutations triggered by our own DOM replacements to avoid re-scan loops
    if (_dlpScanMutating) return;

    for (const mutation of mutations) {
      // Check added nodes
      for (const addedNode of mutation.addedNodes) {
        if (addedNode.nodeType === Node.ELEMENT_NODE) {
          if (isAIResponseElement(addedNode)) {
            debouncedScanElement(addedNode);
          } else {
            // Check if a parent matches
            const closest = AI_RESPONSE_SELECTORS
              .map((sel) => { try { return addedNode.closest?.(sel); } catch { return null; } })
              .find(Boolean);
            if (closest) debouncedScanElement(closest);
          }
        }
      }
      // Check characterData changes within AI response containers
      if (mutation.type === "characterData" && mutation.target) {
        const parent = mutation.target.parentElement;
        if (parent) {
          const closest = AI_RESPONSE_SELECTORS
            .map((sel) => { try { return parent.closest?.(sel); } catch { return null; } })
            .find(Boolean);
          if (closest) debouncedScanElement(closest);
        }
      }
    }
  });

  outputObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
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
   Initialisation
   ───────────────────────────────────────────── */
async function init() {
  // Load settings (localAgentUrl, tenantApiKey) from storage
  await loadSettings();

  // 1C. Get user email from background
  initUserEmail();

  // 1D. Register paste handler (capture phase)
  document.addEventListener("paste", handlePaste, true);

  // 1A. Watch ALL input fields on the page (real-time typing DLP)
  watchAllInputs();

  // 1A.2. Aggressive Send-button & form submit interceptors
  watchSendButtons();

  // 1B. Watch for AI output / responses (+ vault token de-anonymisation)
  watchForAIOutput();

  console.log(`${DLP_PREFIX} v3 נטען – יירוט הדבקות + הקלדה + שליחה + סריקת תשובות AI פעילים.`);
}

init();
