/* ═══════════════════════════════════════════════════════════════
   AI DLP Firewall v2 – Synthetic Data Content Script
   ═══════════════════════════════════════════════════════════════ */

const DLP_API_URL = "https://ai-production-ffa9.up.railway.app/api/check-text";

// ── Animation Timing (ms) ──
const TIMING = {
  cardStagger: 350,      // זמן בין הופעת כרטיסים
  glowDuration: 1000,    // זמן זוהר אדום לפני מורפינג
  morphDuration: 600,     // זמן אנימציית המורפינג
  previewDelay: 400,      // השהייה לפני הצגת התצוגה המקדימה
  autoPasteDelay: 1200,   // השהייה לפני הדבקה אוטומטית
  closeDelay: 800,        // השהייה לפני סגירת ה-overlay
};

/* ─────────────────────────────────────────────
   Utility: Sleep
   ───────────────────────────────────────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────────────────────────
   Build the overlay DOM (pure vanilla JS)
   ───────────────────────────────────────────── */
function buildOverlayDOM(replacements, redactedText) {
  // Backdrop
  const backdrop = document.createElement("div");
  backdrop.className = "dlp-overlay-backdrop";

  // Panel
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

  // Replacement Cards
  const cards = [];
  for (const rep of replacements) {
    const card = document.createElement("div");
    card.className = "dlp-replacement-card";

    const originalSpan = document.createElement("span");
    originalSpan.className = "dlp-original-text";
    originalSpan.textContent = rep.original;

    const arrow = document.createElement("span");
    arrow.className = "dlp-arrow";
    arrow.textContent = "←";

    const placeholderSpan = document.createElement("span");
    placeholderSpan.className = "dlp-placeholder-text";
    placeholderSpan.textContent = rep.placeholder;

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

  // Build preview HTML with highlighted placeholders
  let previewHTML = escapeHTML(redactedText);
  for (const rep of replacements) {
    previewHTML = previewHTML.replace(
      escapeHTML(rep.placeholder),
      `<span class="dlp-highlight">${escapeHTML(rep.placeholder)}</span>`
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

  return {
    backdrop,
    panel,
    shield,
    subtitle,
    cards,
    previewBox,
    progressFill,
    statusText,
    successIcon,
  };
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
  const {
    cards,
    previewBox,
    progressFill,
    statusText,
    successIcon,
    shield,
    subtitle,
  } = overlayParts;

  const totalSteps = cards.length + 2; // cards + preview + done
  let currentStep = 0;

  function updateProgress(label) {
    currentStep++;
    const pct = Math.round((currentStep / totalSteps) * 100);
    progressFill.style.width = `${pct}%`;
    statusText.textContent = label;
  }

  // Phase 1: Animate each card one by one
  for (let i = 0; i < cards.length; i++) {
    const { card, originalSpan, arrow, placeholderSpan } = cards[i];

    // Slide card in
    card.classList.add("dlp-card-visible");
    updateProgress(`סורק פריט ${i + 1} מתוך ${cards.length}...`);

    // Glow red phase
    await sleep(TIMING.glowDuration);

    // Morph: original → green, placeholder lights up
    originalSpan.classList.add("dlp-morphing");
    await sleep(TIMING.morphDuration / 2);

    placeholderSpan.classList.add("dlp-placeholder-active");
    arrow.classList.add("dlp-arrow-done");

    await sleep(TIMING.morphDuration / 2);

    // Stagger before next card
    if (i < cards.length - 1) {
      await sleep(TIMING.cardStagger);
    }
  }

  // Phase 2: Show the redacted preview
  await sleep(TIMING.previewDelay);
  previewBox.classList.add("dlp-preview-visible");
  updateProgress("הטקסט הסינתטי מוכן");

  // Phase 3: Mark done
  await sleep(400);
  updateProgress("מדביק טקסט מוגן...");
  progressFill.style.width = "100%";

  // Flip shield to green
  shield.classList.add("dlp-safe");
  shield.textContent = "✅";
  subtitle.textContent = "ההחלפה הושלמה • מדביק טקסט סינתטי בטוח";

  // Show check icon
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
  // Focus the element first
  element.focus();

  if (element.isContentEditable) {
    // For contentEditable (ChatGPT, Gemini, etc.)
    // Select all existing content and replace, or just insert
    document.execCommand("insertText", false, text);
    return;
  }

  // Regular <input> / <textarea>
  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? element.value.length;
  const before = element.value.slice(0, start);
  const after = element.value.slice(end);
  element.value = before + text + after;

  const newPos = start + text.length;
  element.setSelectionRange(newPos, newPos);

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/* ─────────────────────────────────────────────
   Main Paste Handler
   ───────────────────────────────────────────── */
async function handlePaste(event) {
  const text = (event.clipboardData || window.clipboardData)?.getData("text");
  if (!text || text.trim().length === 0) return;

  // Block the paste immediately
  event.preventDefault();
  event.stopImmediatePropagation();

  const target = event.target;

  try {
    // ── Step 1: Call the DLP server ──
    const response = await fetch(DLP_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      showFallbackToast(
        "⚠️ חומת אש AI: לא ניתן להתחבר לשרת. ההדבקה נחסמה.",
        "warning"
      );
      return;
    }

    const result = await response.json();

    // ── Step 2: If safe, just paste normally ──
    if (result.safe === true) {
      insertTextIntoField(target, text);
      showFallbackToast("✅ המידע בטוח – הודבק בהצלחה.", "success");
      return;
    }

    // ── Step 3: Sensitive data found → show animated overlay ──
    const { redactedText, replacements } = result;

    // Build & inject overlay
    const overlayParts = buildOverlayDOM(replacements, redactedText);
    document.body.appendChild(overlayParts.backdrop);

    // Run the morph animation sequence
    await runMorphAnimation(overlayParts);

    // ── Step 4: Auto-paste the redacted text ──
    insertTextIntoField(target, redactedText);

    console.log(
      `[AI DLP] ✅ הודבק טקסט סינתטי (${replacements.length} החלפות)`
    );

    // ── Step 5: Close overlay ──
    await sleep(TIMING.closeDelay);
    await closeOverlay(overlayParts);
  } catch (err) {
    console.error("[AI DLP] שגיאה:", err);
    showFallbackToast(
      "⚠️ חומת אש AI: שגיאת תקשורת. ההדבקה נחסמה לבטיחות.",
      "warning"
    );
  }
}

/* ─────────────────────────────────────────────
   Fallback Toast (for safe / error states)
   ───────────────────────────────────────────── */
function showFallbackToast(message, type = "info") {
  const existing = document.getElementById("dlp-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "dlp-toast";
  toast.textContent = message;

  const colors = {
    success: "#34C759",
    warning: "#F57C00",
    info: "#1976D2",
  };

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
   Register – capture phase to intercept before
   any page scripts
   ───────────────────────────────────────────── */
document.addEventListener("paste", handlePaste, true);

console.log("[AI DLP v2] 🛡️ סקריפט נתונים סינתטיים נטען – יירוט הדבקות פעיל.");