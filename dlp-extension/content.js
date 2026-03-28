/* ══════════════════════════════════════════════════════════
   DLP Shield – Enterprise  |  content.js
   תוסף כרום להגנה מפני הדבקת מידע רגיש לצ'אטבוטים

   מבנה הקובץ:
   1. קבועים והגדרות
   2. פונקציות עזר
   3. ניהול overlay
   4. תקשורת עם השרת
   5. טיפול באירועי הדבקה (paste)
   6. טיפול באירועי קלט (input) עם debounce
   7. MutationObserver לפענוח תשובות AI
   8. אתחול
   ══════════════════════════════════════════════════════════ */

"use strict";

/* ══════════════════════════════════════════════════════════
   1. קבועים והגדרות
   ══════════════════════════════════════════════════════════ */

const DLP_SERVER_URL    = "http://localhost:3000/api/check-text";
const DLP_RESOLVE_URL   = "http://localhost:3000/api/resolve";
// ביטוי רגולרי לזיהוי placeholders בתשובות AI
const PLACEHOLDER_REGEX = /\[([A-Z_]+_\d+)\]/g;

// סשן פעיל נשמר בזיכרון התוסף
let activeSessionId = null;

/* ══════════════════════════════════════════════════════════
   2. פונקציות עזר
   ══════════════════════════════════════════════════════════ */

/**
 * עיכוב בהמתנה (Promise-based)
 * @param {number} ms - מילישניות
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * הצגת Toast הודעה קטנה
 * @param {string} message  - הטקסט להצגה
 * @param {"success"|"warning"|"info"} type - סוג ההודעה
 * @param {number} duration - זמן הצגה במילישניות (ברירת מחדל: 3000)
 */
function showToast(message, type = "info", duration = 3000) {
  const toast = document.createElement("div");
  toast.className = `dlp-toast dlp-toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(async () => {
    toast.classList.add("dlp-toast-hiding");
    await sleep(300);
    toast.remove();
  }, duration);
}

/**
 * הכנסת טקסט לשדה קלט (input/textarea/contentEditable)
 * @param {Element} element - אלמנט היעד
 * @param {string}  text    - הטקסט להכנסה
 */
function insertTextIntoField(element, text) {
  if (!element) return;

  if (element.isContentEditable) {
    // contentEditable – שימוש ב-execCommand
    element.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, text);
  } else if (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA"
  ) {
    // שדות input/textarea רגילים
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      element.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value"
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, text);
    } else {
      element.value = text;
    }

    // הפעלת אירועי React/Vue/Angular
    element.dispatchEvent(new Event("input",  { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

/* ══════════════════════════════════════════════════════════
   3. ניהול Overlay
   ══════════════════════════════════════════════════════════ */

/**
 * בניית כרטיס החלפה אחד
 * @param {{ original, placeholder, label, category }} replacement
 * @param {number} index - אינדקס הכרטיס (לעיכוב אנימציה)
 * @returns {HTMLElement}
 */
function buildReplacementCard(replacement, index) {
  const card = document.createElement("div");
  card.className = "dlp-card";
  card.style.animationDelay = `${index * 180}ms`;

  const labelEl = document.createElement("div");
  labelEl.className = "dlp-card-label";
  labelEl.textContent = replacement.label || replacement.category;

  const row = document.createElement("div");
  row.className = "dlp-card-row";

  // ערך מקורי
  const originalEl = document.createElement("span");
  originalEl.className = "dlp-original";
  originalEl.textContent = replacement.original;

  // חץ
  const arrowEl = document.createElement("span");
  arrowEl.className = "dlp-arrow";
  arrowEl.textContent = "←";

  // placeholder
  const placeholderEl = document.createElement("span");
  placeholderEl.className = "dlp-placeholder";
  placeholderEl.textContent = replacement.placeholder;

  row.append(originalEl, arrowEl, placeholderEl);
  card.append(labelEl, row);

  // אנימציית מורפינג לאחר השהיה
  const morphDelay = index * 180 + 900;
  setTimeout(() => {
    originalEl.classList.add("dlp-morphed");
    arrowEl.classList.add("dlp-arrow-active");
  }, morphDelay);

  return card;
}

/**
 * הצגת Overlay מלא עם אנימציות
 * @param {Object}   dlpResult  - תשובת השרת
 * @param {Element}  targetEl   - אלמנט היעד להדבקה
 * @returns {Promise<void>}
 */
async function showOverlay(dlpResult, targetEl) {
  const { replacements, redactedText, sessionId, stats } = dlpResult;

  // שמירת הסשן הפעיל לפענוח תשובות AI
  if (sessionId) activeSessionId = sessionId;

  // ── בניית ה-DOM ──

  const backdrop = document.createElement("div");
  backdrop.className = "dlp-backdrop";

  const panel = document.createElement("div");
  panel.className = "dlp-panel";

  // כותרת
  const header = document.createElement("div");
  header.className = "dlp-header";

  const shieldIcon = document.createElement("div");
  shieldIcon.className = "dlp-shield-icon";
  shieldIcon.textContent = "🛡️";

  const headerText = document.createElement("div");
  headerText.className = "dlp-header-text";

  const title = document.createElement("div");
  title.className = "dlp-title";
  title.textContent = "חומת אש AI – זוהה מידע רגיש";

  const subtitle = document.createElement("div");
  subtitle.className = "dlp-subtitle";
  subtitle.textContent = `זוהו ${replacements.length} פריטים רגישים (${stats?.patterns || 0} תבניות, ${stats?.keywords || 0} מילות מפתח)`;

  // checkmark SVG (מוסתר בהתחלה)
  const checkmark = document.createElement("div");
  checkmark.innerHTML = `<svg class="dlp-checkmark" viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="16"/>
    <path stroke-linecap="round" stroke-linejoin="round" d="M10 18l6 6 10-10"/>
  </svg>`;

  headerText.append(title, subtitle);
  header.append(shieldIcon, headerText, checkmark);

  // גוף
  const body = document.createElement("div");
  body.className = "dlp-body";

  // בניית כרטיסי החלפות
  replacements.forEach((rep, i) => {
    body.appendChild(buildReplacementCard(rep, i));
  });

  // תיבת תצוגה מקדימה
  const previewSection = document.createElement("div");

  const previewLabel = document.createElement("div");
  previewLabel.className = "dlp-preview-label";
  previewLabel.textContent = "טקסט מצונזר:";

  const previewBox = document.createElement("div");
  previewBox.className = "dlp-preview-box";

  // הדגשת placeholders בתצוגה המקדימה
  previewBox.innerHTML = redactedText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[([A-Z_]+_\d+)\]/g,
      '<span class="dlp-highlight">[$1]</span>'
    );

  previewSection.append(previewLabel, previewBox);
  body.appendChild(previewSection);

  // פוטר
  const footer = document.createElement("div");
  footer.className = "dlp-footer";

  const statusText = document.createElement("div");
  statusText.className = "dlp-status-text";
  statusText.textContent = "מעבד...";

  const progressTrack = document.createElement("div");
  progressTrack.className = "dlp-progress-track";

  const progressBar = document.createElement("div");
  progressBar.className = "dlp-progress-bar";

  progressTrack.appendChild(progressBar);
  footer.append(statusText, progressTrack);

  // הרכבת הפאנל
  panel.append(header, body, footer);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  // ── סדר האנימציות ──

  const totalCards = replacements.length;
  const cardAnimationTime = totalCards * 180 + 900 + 400;

  // הפעלת פס ההתקדמות
  await sleep(100);
  progressBar.style.width = "60%";

  // הצגת תצוגה מקדימה לאחר שכל הכרטיסים נכנסו
  await sleep(cardAnimationTime);
  previewBox.classList.add("dlp-visible");
  progressBar.style.width = "90%";

  await sleep(500);
  progressBar.style.width = "100%";
  statusText.textContent = "מדביק טקסט מוגן...";
  statusText.classList.add("dlp-status-done");

  // אנימציית הצ'קמארק + Shield ירוק
  shieldIcon.classList.add("dlp-shield-safe");
  shieldIcon.textContent = "✅";
  const svgEl = checkmark.querySelector(".dlp-checkmark");
  if (svgEl) svgEl.classList.add("dlp-visible");

  await sleep(800);

  // סגירת ה-overlay
  backdrop.classList.add("dlp-closing");
  panel.classList.add("dlp-closing");

  await sleep(400);
  backdrop.remove();

  // הדבקת הטקסט המצונזר
  insertTextIntoField(targetEl, redactedText);
}

/* ══════════════════════════════════════════════════════════
   4. תקשורת עם השרת
   ══════════════════════════════════════════════════════════ */

/**
 * שליחת טקסט לשרת לבדיקה
 * @param {string} text
 * @returns {Promise<Object|null>} - תשובת השרת או null בשגיאה
 */
async function checkText(text) {
  try {
    const response = await fetch(DLP_SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    // השרת לא זמין – מאפשרים המשך ללא בדיקה
    console.warn("[DLP Shield] שרת DLP לא זמין – הטקסט עבר ללא בדיקה");
    return null;
  }
}

/**
 * פענוח placeholder לערך מקורי דרך השרת
 * @param {string} sessionId
 * @param {string} token - לדוגמה "[ID_1]"
 * @returns {Promise<string|null>}
 */
async function resolveToken(sessionId, token) {
  try {
    const params = new URLSearchParams({ session: sessionId, token });
    const response = await fetch(`${DLP_RESOLVE_URL}?${params}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.original ?? null;
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════
   5. טיפול באירועי הדבקה (paste)
   ══════════════════════════════════════════════════════════ */

/**
 * מטפל הדבקה מרכזי – מיירט את ה-paste, בודק עם השרת
 * ומציג overlay אם נמצא מידע רגיש
 * @param {ClipboardEvent} e
 */
async function handlePaste(e) {
  const target = e.target;

  // בדיקה שהאלמנט הוא שדה קלט
  const isEditable =
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA";

  if (!isEditable) return;

  // קריאת הטקסט מהלוח
  const text = e.clipboardData?.getData("text/plain");
  if (!text || text.trim().length === 0) return;

  // מניעת ה-paste המקורי
  e.preventDefault();
  e.stopImmediatePropagation();

  const result = await checkText(text);

  if (!result) {
    // שרת לא זמין – הדבקה רגילה
    insertTextIntoField(target, text);
    return;
  }

  if (result.safe) {
    // הטקסט בטוח
    insertTextIntoField(target, text);
    showToast("✅ המידע בטוח", "success", 2500);
  } else {
    // נמצא מידע רגיש – הצגת overlay
    await showOverlay(result, target);
  }
}

/* ══════════════════════════════════════════════════════════
   6. טיפול באירועי קלט (input) עם debounce
   ══════════════════════════════════════════════════════════ */

// מינימום אורך טקסט לשליחה לבדיקה (תווים)
const MIN_TEXT_LENGTH = 10;
const debounceTimers = new WeakMap();
const DEBOUNCE_MS = 1000;

/**
 * בדיקת שדה קלט לאיתור מידע רגיש (מופעלת אחרי debounce)
 * @param {Element} element
 */
async function checkInputField(element) {
  const text = element.isContentEditable
    ? element.innerText
    : element.value;

  if (!text || text.trim().length < MIN_TEXT_LENGTH) return;

  const result = await checkText(text);
  if (!result || result.safe) return;

  // שמירת הסשן
  if (result.sessionId) activeSessionId = result.sessionId;

  // החלפת תוכן השדה בטקסט המצונזר
  insertTextIntoField(element, result.redactedText);

  showToast(
    `⚠️ זוהה מידע רגיש (${result.stats?.totalDetected || result.replacements.length} פריטים) – הטקסט צונזר`,
    "warning",
    4000
  );
}

/**
 * מטפל אירוע input עם debounce
 * @param {InputEvent} e
 */
function handleInput(e) {
  const target = e.target;

  const isEditable =
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA";

  if (!isEditable) return;

  // ביטול הטיימר הקיים
  if (debounceTimers.has(target)) {
    clearTimeout(debounceTimers.get(target));
  }

  const timer = setTimeout(() => checkInputField(target), DEBOUNCE_MS);
  debounceTimers.set(target, timer);
}

/**
 * מטפל אירוע keydown – בדיקה מיידית בלחיצת Enter
 * @param {KeyboardEvent} e
 */
function handleKeydown(e) {
  if (e.key !== "Enter") return;

  const target = e.target;
  const isEditable =
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA";

  if (!isEditable) return;

  // ביטול הטיימר ובדיקה מיידית
  if (debounceTimers.has(target)) {
    clearTimeout(debounceTimers.get(target));
    debounceTimers.delete(target);
  }

  checkInputField(target);
}

/* ══════════════════════════════════════════════════════════
   7. MutationObserver לפענוח תשובות AI
   ══════════════════════════════════════════════════════════ */

/**
 * בדיקת צומת טקסט לאיתור placeholders ופענוחם
 * @param {Text} textNode
 */
async function processTextNode(textNode) {
  if (!activeSessionId) return;

  const text = textNode.textContent;
  if (!PLACEHOLDER_REGEX.test(text)) return;

  // איפוס lastIndex
  PLACEHOLDER_REGEX.lastIndex = 0;

  // בניית Fragment מחדש עם span לכל placeholder
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match;

  PLACEHOLDER_REGEX.lastIndex = 0;
  while ((match = PLACEHOLDER_REGEX.exec(text)) !== null) {
    const token = match[0];
    const start = match.index;

    // טקסט לפני ה-placeholder
    if (start > lastIndex) {
      fragment.appendChild(
        document.createTextNode(text.slice(lastIndex, start))
      );
    }

    // יצירת span מיידי עם ה-placeholder (יוחלף בערך האמיתי בהמשך)
    const span = document.createElement("span");
    span.className = "dlp-resolved-token";
    span.textContent = token;
    span.dataset.dlpToken = token;
    fragment.appendChild(span);

    lastIndex = start + token.length;
  }

  // טקסט לאחר הפלייסהולדר האחרון
  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  // החלפת הצומת המקורי ב-Fragment
  const parent = textNode.parentNode;
  if (!parent) return;
  parent.replaceChild(fragment, textNode);

  // פענוח כל ה-spans
  const spans = parent.querySelectorAll
    ? parent.querySelectorAll("[data-dlp-token]")
    : [];

  for (const span of spans) {
    const token = span.dataset.dlpToken;
    if (!token) continue;

    const original = await resolveToken(activeSessionId, token);
    if (original) {
      span.textContent = original;
    }
    // הגלאו נשאר גם אם לא פוענח – מסמן את המקומות
  }
}

/**
 * הגדרת MutationObserver לצפייה בשינויי DOM
 */
function setupMutationObserver() {
  const observer = new MutationObserver(mutations => {
    if (!activeSessionId) return;

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          // צומת טקסט ישיר
          if (PLACEHOLDER_REGEX.test(node.textContent)) {
            PLACEHOLDER_REGEX.lastIndex = 0;
            processTextNode(node);
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          // אלמנט – בדיקת כל צמתי הטקסט בתוכו
          const walker = document.createTreeWalker(
            node,
            NodeFilter.SHOW_TEXT,
            null
          );
          const textNodes = [];
          let current;
          while ((current = walker.nextNode())) {
            textNodes.push(current);
          }
          for (const textNode of textNodes) {
            if (PLACEHOLDER_REGEX.test(textNode.textContent)) {
              PLACEHOLDER_REGEX.lastIndex = 0;
              processTextNode(textNode);
            }
          }
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: false
  });
}

/* ══════════════════════════════════════════════════════════
   8. אתחול
   ══════════════════════════════════════════════════════════ */

/**
 * אתחול התוסף – הוספת מאזיני אירועים
 */
function init() {
  // יירוט הדבקה בשלב הלכידה (capture)
  document.addEventListener("paste", handlePaste, true);

  // בדיקת שדות קלט עם debounce
  document.addEventListener("input",   handleInput,   true);
  document.addEventListener("keydown", handleKeydown, true);

  // MutationObserver לפענוח תשובות AI
  if (document.body) {
    setupMutationObserver();
  } else {
    document.addEventListener("DOMContentLoaded", setupMutationObserver);
  }
}

init();
