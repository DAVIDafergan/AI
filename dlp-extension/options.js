// DLP Shield – Options Script
// Loads and saves localAgentUrl and tenantApiKey to chrome.storage.local

const DEFAULT_LOCAL_AGENT_URL = "http://localhost:4000";

const localAgentUrlInput = document.getElementById("local-agent-url");
const tenantApiKeyInput  = document.getElementById("tenant-api-key");
const saveBtn            = document.getElementById("save-btn");
const saveMsg            = document.getElementById("save-msg");

// ── Load saved settings ───────────────────────────────────────────────────────
chrome.storage.local.get(["localAgentUrl", "tenantApiKey"], (data) => {
  if (chrome.runtime.lastError) {
    saveMsg.textContent = "❌ שגיאה בטעינת ההגדרות";
    saveMsg.className   = "error";
    return;
  }
  localAgentUrlInput.value = data.localAgentUrl || DEFAULT_LOCAL_AGENT_URL;
  tenantApiKeyInput.value  = data.tenantApiKey  || "";
});

// ── Save settings ─────────────────────────────────────────────────────────────
saveBtn.addEventListener("click", () => {
  const rawUrl        = localAgentUrlInput.value.trim() || DEFAULT_LOCAL_AGENT_URL;
  const tenantApiKey  = tenantApiKeyInput.value.trim();

  // Validate URL
  let localAgentUrl;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
    localAgentUrl = parsed.origin; // normalise – strip trailing path
  } catch {
    saveMsg.textContent = "❌ כתובת URL אינה תקינה. יש להשתמש ב-http:// או https://";
    saveMsg.className   = "error";
    return;
  }

  chrome.storage.local.set({ localAgentUrl, tenantApiKey }, () => {
    if (chrome.runtime.lastError) {
      saveMsg.textContent = "❌ שגיאה בשמירת ההגדרות";
      saveMsg.className   = "error";
      return;
    }
    localAgentUrlInput.value = localAgentUrl;
    saveMsg.textContent = "✅ ההגדרות נשמרו בהצלחה";
    saveMsg.className   = "";
    setTimeout(() => { saveMsg.textContent = ""; }, 3000);
  });
});
