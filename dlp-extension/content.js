/* ═══════════════════════════════════════════════════════════════
   AI DLP Firewall v3 – Content Script
   • Paste interception + animated overlay (existing)
   • Input interception (real-time typing)
   • Output scanning & de-anonymization (AI responses)
   • User email auto-detection
   ═══════════════════════════════════════════════════════════════ */

const DLP_API_URL = "https://ai-production-ffa9.up.railway.app/api/check-text";
const DLP_PREFIX  = "🛡️ DLP Shield:";

// ── User email (populated on init) ──
let userEmail = "anonymous@unknown.com";

// ── Loop-prevention & caching ──
const processedNodes   = new WeakSet();
const restorationCache = new Map(); // synthetic → original

// ── Rate limiting for input interception ──
let inputRequestPending = false;

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
   1C. User Email Auto-Detection
   ───────────────────────────────────────────── */
function initUserEmail() {
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
   Insert text into the target field
   ───────────────────────────────────────────── */
function insertTextIntoField(element, text) {
  element.focus();

  if (element.isContentEditable) {
    document.execCommand("insertText", false, text);
    return;
  }

  const start = element.selectionStart ?? element.value.length;
  const end   = element.selectionEnd   ?? element.value.length;
  const before = element.value.slice(0, start);
  const after  = element.value.slice(end);
  element.value = before + text + after;

  const newPos = start + text.length;
  element.setSelectionRange(newPos, newPos);

  element.dispatchEvent(new Event("input",  { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/* ─────────────────────────────────────────────
   React-compatible text setter for input fields
   ───────────────────────────────────────────── */
function setReactInputValue(element, newText) {
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(DLP_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, userEmail }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      showFallbackToast("⚠️ חומת אש AI: לא ניתן להתחבר לשרת. ההדבקה נחסמה.", "warning");
      return;
    }

    const result = await response.json();

    if (result.safe === true) {
      insertTextIntoField(target, text);
      showFallbackToast("✅ המידע בטוח – הודבק בהצלחה.", "success");
      return;
    }

    const { redactedText, replacements } = result;
    const overlayParts = buildOverlayDOM(replacements, redactedText);
    document.body.appendChild(overlayParts.backdrop);

    await runMorphAnimation(overlayParts);

    insertTextIntoField(target, redactedText);
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

  const text = element.isContentEditable
    ? element.innerText || element.textContent
    : element.value;

  if (!text || text.trim().length < 3) return;

  inputRequestPending = true;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(DLP_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, userEmail, source: "typing", mode: "input" }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return;

    const result = await response.json();

    if (result.replacements && result.replacements.length > 0) {
      console.log(`${DLP_PREFIX} יירוט הקלדה: ${result.replacements.length} פריטים הוחלפו`);
      setReactInputValue(element, result.redactedText);
      flashGreen(element);

      // Notify background
      try {
        chrome.runtime.sendMessage({
          type: "INTERCEPTION_REPORT",
          count: result.replacements.length,
          userEmail,
        });
      } catch { /* ignore */ }
    }
  } catch {
    // fail silently – never break the host page
  } finally {
    inputRequestPending = false;
  }
}

const debouncedInterceptInput = debounce(interceptInput, 400);

/* ─────────────────────────────────────────────
   1A. Attach observers/listeners to input element
   ───────────────────────────────────────────── */
function attachInputListeners(element) {
  if (!element || element._dlpAttached) return;
  element._dlpAttached = true;

  // MutationObserver on the element itself (for React-controlled contentEditables)
  const mutObs = new MutationObserver(() => debouncedInterceptInput(element));
  mutObs.observe(element, { characterData: true, childList: true, subtree: true });

  // Fallback: input event
  element.addEventListener("input", () => debouncedInterceptInput(element), true);

  // Keydown: intercept Enter before send
  element.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // Cancel pending debounce and run immediately
      debouncedInterceptInput.cancel();
      await interceptInput(element);
    }
  }, true);

  console.log(`${DLP_PREFIX} מאזין הקלדה מחובר לשדה קלט`);
}

/* ─────────────────────────────────────────────
   1A. Watch for ChatGPT/Claude/Gemini input to appear
   ───────────────────────────────────────────── */
function watchForInputField() {
  const INPUT_SELECTORS = [
    "#prompt-textarea",
    "div[contenteditable='true']",
    "textarea[data-id]",
    ".ProseMirror",
  ];

  function tryAttach() {
    for (const sel of INPUT_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) attachInputListeners(el);
    }
  }

  // Try immediately
  tryAttach();

  // Also watch for dynamic appearance (SPA)
  const observer = new MutationObserver(tryAttach);
  observer.observe(document.body, { childList: true, subtree: true });
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
  if (restorationCache.has(syntheticValue)) {
    return restorationCache.get(syntheticValue);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const encoded = encodeURIComponent(syntheticValue);
    const res = await fetch(
      `${DLP_API_URL}?tag=${encoded}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
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
      textNode.parentNode?.replaceChild(fragment, textNode);

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
   Fallback Toast
   ───────────────────────────────────────────── */
function showFallbackToast(message, type = "info") {
  const existing = document.getElementById("dlp-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "dlp-toast";
  toast.textContent = message;

  const colors = { success: "#34C759", warning: "#F57C00", info: "#1976D2" };

  Object.assign(toast.style, {
    position: "fixed",
    top: "20px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    padding: "12px 24px",
    borderRadius: "10px",
    backgroundColor: colors[type] || colors.info,
    color: "#FFFFFF",
    fontSize: "15px",
    fontWeight: "600",
    fontFamily: "'Segoe UI', Arial, sans-serif",
    direction: "rtl",
    textAlign: "right",
    boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
    opacity: "0",
    transition: "opacity 0.3s ease",
  });

  document.body.appendChild(toast);
  requestAnimationFrame(() => (toast.style.opacity = "1"));

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* ─────────────────────────────────────────────
   Initialisation
   ───────────────────────────────────────────── */
function init() {
  // 1C. Get user email from background
  initUserEmail();

  // 1D. Register paste handler (capture phase)
  document.addEventListener("paste", handlePaste, true);

  // 1A. Watch for AI chat input fields
  watchForInputField();

  // 1B. Watch for AI output / responses
  watchForAIOutput();

  console.log(`${DLP_PREFIX} v3 נטען – יירוט הדבקות + הקלדה + סריקת תשובות AI פעילים.`);
}

init();
