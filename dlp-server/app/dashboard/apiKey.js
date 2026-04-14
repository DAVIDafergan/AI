const DASHBOARD_API_KEY_STORAGE_KEYS = ["ghostlayer_admin_key", "tenantApiKey", "ghostlayer_api_key"];

export function getStoredApiKey() {
  if (typeof window === "undefined") return "";
  for (const key of DASHBOARD_API_KEY_STORAGE_KEYS) {
    const value = window.localStorage.getItem(key);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function withApiKey(headers = {}) {
  const apiKey = getStoredApiKey();
  return apiKey ? { ...headers, "x-api-key": apiKey } : headers;
}
