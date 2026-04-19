"use client";

import { useState } from "react";
import { X, Copy, Check, Eye, EyeOff, Loader2, CheckCircle2, XCircle } from "lucide-react";

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handle} className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-cyan-400 transition-colors">
      {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
    </button>
  );
}

export default function AddTenantModal({ onClose, onCreated, superAdminKey }) {
  const [form, setForm] = useState({
    name: "",
    contactEmail: "",
    contactName: "",
    plan: "starter",
    domain: "",
    serverUrl: "",
    agentUrl: "",
    sshHost: "",
    sshPort: "22",
    sshUser: "",
    sshAuthMethod: "password",
    sshPassword: "",
    sshPrivateKey: "",
    installDir: "/opt/ghostlayer",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [credentials, setCredentials] = useState(null);
  const [createdTenant, setCreatedTenant] = useState(null);
  const [showSecret, setShowSecret] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installLogs, setInstallLogs] = useState([]);
  const [installResult, setInstallResult] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setError("");
    if (!form.name || !form.contactEmail) { setError("שם ואימייל חובה"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-super-admin-key": superAdminKey },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setCredentials(data.credentials);
      setCreatedTenant(data.tenant);
      onCreated?.(data.tenant);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const deployScript = credentials
    ? `curl -X POST ${typeof window !== "undefined" ? window.location.origin : ""}/api/provision \\
  -H "Content-Type: application/json" \\
  -H "x-super-admin-key: ${superAdminKey}" \\
  -d '{"tenantId":"<TENANT_ID>","name":"agent-01"}'`
    : "";

  const appendInstallLog = (entry) => {
    setInstallLogs((prev) => [...prev, entry]);
  };

  const installAgentAutomatically = async () => {
    if (!credentials?.apiKey) {
      setError("חסר API Key להתקנת סוכן");
      return;
    }
    if (!form.sshHost || !form.sshUser) {
      setError("יש למלא כתובת SSH ומשתמש");
      return;
    }
    if (form.sshAuthMethod === "password" && !form.sshPassword) {
      setError("יש להזין סיסמת SSH");
      return;
    }
    if (form.sshAuthMethod === "privateKey" && !form.sshPrivateKey) {
      setError("יש להזין מפתח פרטי");
      return;
    }

    setInstallResult(null);
    setInstallLogs([]);
    setInstalling(true);
    setError("");

    try {
      const res = await fetch("/api/provision-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-super-admin-key": superAdminKey },
        body: JSON.stringify({
          tenantId: createdTenant?._id,
          tenantApiKey: credentials.apiKey,
          sshHost: form.sshHost,
          sshPort: Number(form.sshPort || 22),
          sshUser: form.sshUser,
          sshPassword: form.sshAuthMethod === "password" ? form.sshPassword : undefined,
          sshPrivateKey: form.sshAuthMethod === "privateKey" ? form.sshPrivateKey : undefined,
          installDir: form.installDir || "/opt/ghostlayer",
        }),
      });
      if (!res.ok) {
        let msg = "שגיאת התקנה";
        try { msg = (await res.json()).error || msg; } catch {}
        throw new Error(msg);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("לא התקבל סטרים התקנה");

      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const raw of blocks) {
          const lines = raw.split("\n");
          const event = lines.find((l) => l.startsWith("event:"))?.replace("event:", "").trim();
          const dataLine = lines.find((l) => l.startsWith("data:"))?.replace("data:", "").trim();
          if (!dataLine) continue;
          let payload;
          try { payload = JSON.parse(dataLine); } catch { continue; }

          if (event === "log") {
            appendInstallLog({
              type: payload.level === "error" ? "error" : payload.level === "success" ? "success" : "info",
              line: payload.line || "",
            });
          } else if (event === "error") {
            appendInstallLog({ type: "error", line: `✗ ${payload.step || "error"}: ${payload.error || "Unknown error"}` });
          } else if (event === "done") {
            setInstallResult(payload);
            if (payload?.agentUrl) set("agentUrl", payload.agentUrl);
          }
        }
      }
    } catch (e) {
      appendInstallLog({ type: "error", line: `✗ ${e.message}` });
      setInstallResult({ success: false, error: e.message, step: "client" });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-lg mx-4 bg-[#0d0d14]/90 border border-cyan-900/40 rounded-2xl shadow-[0_0_60px_rgba(34,211,238,0.08)] backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/40">
          <h2 className="text-base font-semibold text-cyan-300">הוספת דייר חדש</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {!credentials ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">שם חברה *</label>
                  <input value={form.name} onChange={(e) => set("name", e.target.value)} className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-600/60" placeholder="Acme Corp" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">אימייל קשר *</label>
                  <input value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} type="email" className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-600/60" placeholder="admin@company.com" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">שם איש קשר</label>
                  <input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-600/60" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">תוכנית</label>
                  <select value={form.plan} onChange={(e) => set("plan", e.target.value)} className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-600/60">
                    <option value="starter">Starter</option>
                    <option value="professional">Professional</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">דומיין (אופציונלי)</label>
                  <input value={form.domain} onChange={(e) => set("domain", e.target.value)} className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-600/60" placeholder="company.com" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">כתובת שרת DLP (לסוכן ולתוסף)</label>
                  <input value={form.serverUrl} onChange={(e) => set("serverUrl", e.target.value)} className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono outline-none focus:border-cyan-600/60" placeholder="https://dlp.company.com" dir="ltr" />
                  <p className="text-[10px] text-slate-500 mt-1">הכתובת שהסוכן והתוסף ישתמשו בה לתקשורת עם השרת</p>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">כתובת Local Agent (IP/URL)</label>
                  <input value={form.agentUrl} onChange={(e) => set("agentUrl", e.target.value)} className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono outline-none focus:border-cyan-600/60" placeholder="http://10.0.0.50:4000" dir="ltr" />
                  <p className="text-[10px] text-slate-500 mt-1">הכתובת שתוסף העובד ישתמש בה לבדיקות טקסט/תמונות</p>
                </div>

                <div className="col-span-2 rounded-lg border border-slate-700/60 bg-slate-900/30 p-3 space-y-3">
                  <div className="text-xs text-cyan-300 font-medium">Remote Installation (אופציונלי)</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">SSH Host</label>
                      <input value={form.sshHost} onChange={(e) => set("sshHost", e.target.value)} className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-cyan-600/60" placeholder="10.0.0.50" dir="ltr" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">SSH Port</label>
                      <input value={form.sshPort} onChange={(e) => set("sshPort", e.target.value)} className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-cyan-600/60" placeholder="22" dir="ltr" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">SSH Username</label>
                      <input value={form.sshUser} onChange={(e) => set("sshUser", e.target.value)} className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-cyan-600/60" placeholder="ubuntu" dir="ltr" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Auth Method</label>
                      <select value={form.sshAuthMethod} onChange={(e) => set("sshAuthMethod", e.target.value)} className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-600/60">
                        <option value="password">Password</option>
                        <option value="privateKey">Private Key</option>
                      </select>
                    </div>
                    {form.sshAuthMethod === "password" ? (
                      <div className="col-span-2">
                        <label className="block text-xs text-slate-400 mb-1">SSH Password</label>
                        <input type="password" value={form.sshPassword} onChange={(e) => set("sshPassword", e.target.value)} className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-cyan-600/60" />
                      </div>
                    ) : (
                      <div className="col-span-2">
                        <label className="block text-xs text-slate-400 mb-1">SSH Private Key</label>
                        <textarea value={form.sshPrivateKey} onChange={(e) => set("sshPrivateKey", e.target.value)} rows={4} className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-cyan-600/60" dir="ltr" />
                      </div>
                    )}
                    <div className="col-span-2">
                      <label className="block text-xs text-slate-400 mb-1">Install Directory</label>
                      <input value={form.installDir} onChange={(e) => set("installDir", e.target.value)} className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-cyan-600/60" placeholder="/opt/ghostlayer" dir="ltr" />
                    </div>
                  </div>
                </div>
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">ביטול</button>
                <button onClick={submit} disabled={loading} className="flex items-center gap-2 px-5 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-600/40 rounded-lg text-sm text-cyan-300 font-medium transition-colors disabled:opacity-50">
                  {loading && <Loader2 size={14} className="animate-spin" />}
                  יצירת דייר
                </button>
              </div>
            </>
          ) : (
            /* Credentials display (shown ONCE) */
            <div className="space-y-4">
              <div className="rounded-lg bg-green-900/20 border border-green-700/40 px-4 py-3 text-sm text-green-300">
                ✓ הדייר נוצר בהצלחה! שמור את הפרטים הבאים — הם לא יוצגו שוב.
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">API Key</label>
                  <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2">
                    <code className="flex-1 text-xs text-cyan-300 font-mono truncate">{credentials.apiKey}</code>
                    <CopyButton text={credentials.apiKey} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">API Secret</label>
                  <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2">
                    <code className="flex-1 text-xs text-yellow-300 font-mono truncate">
                      {showSecret ? credentials.apiSecret : "••••••••••••••••••••••••••••••••"}
                    </code>
                    <button onClick={() => setShowSecret(!showSecret)} className="text-slate-500 hover:text-slate-300">
                      {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                    <CopyButton text={credentials.apiSecret} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">סקריפט פריסה</label>
                  <div className="relative bg-slate-900/80 border border-slate-700/60 rounded-lg p-3">
                    <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap">{deployScript}</pre>
                    <CopyButton text={deployScript} />
                  </div>
                </div>

                <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-cyan-300 font-medium">התקנה מרחוק</span>
                    <button
                      onClick={installAgentAutomatically}
                      disabled={installing}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-600/40 rounded text-xs text-cyan-300 transition-colors disabled:opacity-40"
                    >
                      {installing ? <Loader2 size={11} className="animate-spin" /> : null}
                      התקן סוכן אוטומטית
                    </button>
                  </div>

                  {(installLogs.length > 0 || installing) && (
                    <div className="max-h-44 overflow-y-auto rounded border border-slate-700/50 bg-[#09090f] p-2 font-mono text-[11px] space-y-1">
                      {installLogs.map((log, idx) => (
                        <div key={idx} className={log.type === "error" ? "text-red-400" : log.type === "success" ? "text-green-400" : "text-slate-300"}>
                          {log.type === "success" ? "✓ " : log.type === "error" ? "✗ " : "• "}
                          {log.line}
                        </div>
                      ))}
                    </div>
                  )}

                  {installResult && (
                    <div className={`text-xs rounded border px-3 py-2 flex items-start gap-2 ${installResult.success ? "text-green-300 border-green-700/40 bg-green-900/20" : "text-red-300 border-red-700/40 bg-red-900/20"}`}>
                      {installResult.success ? <CheckCircle2 size={14} className="mt-0.5" /> : <XCircle size={14} className="mt-0.5" />}
                      <div className="space-y-0.5">
                        <div>{installResult.success ? "הסוכן הותקן בהצלחה" : `התקנה נכשלה: ${installResult.step || "unknown"}`}</div>
                        {installResult.agentUrl && <div className="font-mono text-[11px]">Endpoint: {installResult.agentUrl}</div>}
                        <div>סטטוס: {installResult.success ? "online" : "offline"}</div>
                        {installResult.error && <div>{installResult.error}</div>}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button onClick={onClose} className="px-5 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-600/40 rounded-lg text-sm text-cyan-300 font-medium transition-colors">
                  סגירה
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
