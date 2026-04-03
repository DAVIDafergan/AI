// DLP Shield – Options Script
// Loads and saves localAgentUrl, tenantApiKey, and employeeEmail to chrome.storage.local

const DEFAULT_LOCAL_AGENT_URL = "https://ai-production-ffa9.up.railway.app";

const employeeEmailInput = document.getElementById("employee-email");
const localAgentUrlInput = document.getElementById("local-agent-url");
const tenantApiKeyInput  = document.getElementById("tenant-api-key");
const saveBtn            = document.getElementById("save-btn");
const saveMsg            = document.getElementById("save-msg");

// ── Load saved settings ───────────────────────────────────────────────────────
chrome.storage.local.get(["localAgentUrl", "tenantApiKey", "employeeEmail"], (data) => {
  if (chrome.runtime.lastError) {
    saveMsg.textContent = "❌ שגיאה בטעינת ההגדרות";
    saveMsg.className   = "error";
    return;
  }
  localAgentUrlInput.value = data.localAgentUrl  || DEFAULT_LOCAL_AGENT_URL;
  tenantApiKeyInput.value  = data.tenantApiKey   || "";
  employeeEmailInput.value = data.employeeEmail  || "";
});

// ── Save settings ─────────────────────────────────────────────────────────────
saveBtn.addEventListener("click", () => {
  const rawUrl        = localAgentUrlInput.value.trim() || DEFAULT_LOCAL_AGENT_URL;
  const tenantApiKey  = tenantApiKeyInput.value.trim();
  const employeeEmail = employeeEmailInput.value.trim();

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

  // Validate email if provided
  if (employeeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employeeEmail)) {
    saveMsg.textContent = "❌ כתובת אימייל אינה תקינה";
    saveMsg.className   = "error";
    return;
  }

  chrome.storage.local.set({ localAgentUrl, tenantApiKey, employeeEmail }, () => {
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
