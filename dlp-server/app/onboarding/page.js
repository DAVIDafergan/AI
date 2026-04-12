"use client";

// דף Onboarding ציבורי – ללא צורך באימות
import { useState } from "react";
import { Key, Copy, Check, ChevronRight, Building2, Globe, Terminal, Code2, Bot, Shield } from "lucide-react";
import GhostLogo from "../../components/GhostLogo";

// כפתור העתקה
function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded-lg transition-colors font-medium"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "הועתק!" : (label || "העתק")}
    </button>
  );
}

// תצוגת קוד
function CodeBlock({ code, language = "bash" }) {
  return (
    <div className="relative bg-slate-950 border border-slate-700/50 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800/60 border-b border-slate-700/50">
        <span className="text-xs text-slate-400 font-mono">{language}</span>
        <CopyButton text={code} />
      </div>
      <pre className="p-4 text-xs text-slate-200 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed" dir="ltr">
        {code}
      </pre>
    </div>
  );
}

export default function OnboardingPage() {
  const [step, setStep]             = useState("form"); // form | result
  const [name, setName]             = useState("");
  const [email, setEmail]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [result, setResult]         = useState(null);

  const serverUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError("שם הארגון הוא שדה חובה"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), contactEmail: email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה ביצירת החשבון");
      setResult(data);
      setStep("result");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white" dir="rtl">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600/20 border border-blue-500/30 rounded-xl flex items-center justify-center">
            <GhostLogo size={20} className="text-blue-400" />
          </div>
          <div>
            <span className="font-bold text-white text-lg">GHOST</span>
            <span className="text-slate-400 text-sm mr-2">Enterprise</span>
          </div>
          <span className="mr-auto text-xs bg-slate-800 border border-slate-700 text-slate-400 px-2 py-1 rounded-full">
            GHOST v1.0
          </span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">

        {step === "form" && (
          <>
            {/* Hero */}
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 bg-blue-600/10 border border-blue-500/20 text-blue-400 text-sm px-4 py-1.5 rounded-full mb-6">
                <Shield className="w-4 h-4" />
                הגנה על מידע בזמן אמת
              </div>
              <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4 leading-tight">
                חבר את הארגון שלך<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-l from-blue-400 to-violet-400">
                  ל-GHOST תוך דקות
                </span>
              </h1>
              <p className="text-slate-400 text-lg max-w-xl mx-auto leading-relaxed">
                הזן את שם הארגון וקבל מיידית מפתח API + הוראות חיבור מפורטות לכל הפלטפורמות
              </p>
            </div>

            {/* טופס */}
            <div className="max-w-md mx-auto">
              <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-700/50 rounded-2xl p-8 space-y-5 shadow-2xl">
                <div>
                  <label className="block text-sm text-slate-300 mb-2">שם החברה / ארגון <span className="text-rose-400">*</span></label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="לדוגמה: TechCorp בע״מ"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500 transition-colors"
                    dir="rtl"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm text-slate-300 mb-2">אימייל (אופציונלי)</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500 transition-colors"
                    dir="ltr"
                  />
                </div>

                {error && (
                  <div className="bg-rose-950/40 border border-rose-500/30 text-rose-300 text-sm rounded-xl px-4 py-3">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !name.trim()}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-xl transition-colors text-sm"
                >
                  {loading ? "יוצר חשבון..." : (
                    <>
                      <Key className="w-4 h-4" />
                      קבל API Key מיידי
                    </>
                  )}
                </button>

                <p className="text-center text-xs text-slate-500">
                  ✅ ללא תשלום · ✅ פרטיות מלאה · ✅ In-Memory בלבד
                </p>
              </form>

              {/* תכונות */}
              <div className="grid grid-cols-3 gap-3 mt-8">
                {[
                  { icon: Shield, label: "הגנה ב-RTL", color: "text-blue-400" },
                  { icon: Key,    label: "API Key מיידי", color: "text-violet-400" },
                  { icon: Globe,  label: "כל הפלטפורמות", color: "text-green-400" },
                ].map((f) => (
                  <div key={f.label} className="bg-slate-900/50 border border-slate-700/30 rounded-xl p-4 text-center">
                    <f.icon className={`w-5 h-5 ${f.color} mx-auto mb-1.5`} />
                    <p className="text-xs text-slate-400">{f.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {step === "result" && result && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="text-center mb-8">
              <div className="text-5xl mb-4">🎉</div>
              <h2 className="text-3xl font-bold text-white">ברוך הבא, {result.organization?.name}!</h2>
              <p className="text-slate-400 mt-2">החשבון שלך מוכן. שמור את הפרטים הבאים:</p>
            </div>

            {/* Organization ID */}
            <div className="bg-slate-900 border border-slate-700/50 rounded-2xl p-6">
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Organization ID</p>
              <div className="flex items-center justify-between gap-3">
                <code className="text-blue-300 font-mono text-sm break-all">{result.organizationId}</code>
                <CopyButton text={result.organizationId} label="העתק" />
              </div>
            </div>

            {/* API Key */}
            <div className="bg-rose-950/20 border border-rose-500/30 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-rose-400" />
                  <p className="text-sm font-semibold text-rose-300">מפתח API שלך</p>
                </div>
                <CopyButton text={result.apiKey} label="העתק מפתח" />
              </div>
              <code className="text-rose-200 font-mono text-sm break-all">{result.apiKey}</code>
              <p className="text-xs text-rose-400 mt-3">⚠️ שמור את המפתח עכשיו – לא יוצג שוב!</p>
            </div>

            {/* הוראות חיבור */}
            <div className="space-y-5">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <ChevronRight className="w-5 h-5 text-slate-400" />
                הוראות חיבור
              </h3>

              {/* Browser Extension */}
              <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Globe className="w-4 h-4 text-blue-400" />
                  <h4 className="text-sm font-semibold text-white">א. תוסף דפדפן</h4>
                </div>
                <ol className="space-y-2 text-sm text-slate-300">
                  {result.instructions?.browserExtension?.map((step, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-blue-400 font-mono text-xs mt-0.5 shrink-0">{i + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* GHOST Local Agent */}
              <div className="bg-slate-900 border border-blue-500/30 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Bot className="w-4 h-4 text-blue-400" />
                  <h4 className="text-sm font-semibold text-white">ב. GHOST Local Agent (סריקת תיקיות)</h4>
                </div>
                <p className="text-xs text-slate-400 mb-3">
                  הרץ את הסוכן המקומי על שרת הקבצים שלך. הוא סורק את הכוננים, בונה AI מקומי, ושולח סטטיסטיקות מצטברות בלבד לדשבורד.
                </p>
                <div className="space-y-2 text-xs text-slate-300 mb-3">
                  <p className="font-semibold text-slate-200">דרישות לפני ההרצה:</p>
                  <ul className="list-disc list-inside space-y-1 text-slate-400">
                    <li>Node.js גרסה 18 ומעלה</li>
                    <li>גישה לתיקיית הקבצים המשותפת (Shared Drive)</li>
                    <li>חיבור לאינטרנט לשליחת מטה-דאטה לדשבורד</li>
                  </ul>
                </div>
                <CodeBlock code={result.instructions?.localAgent || ""} language="bash" />
                <p className="text-xs text-slate-500 mt-2">
                  💡 החלף <code className="text-slate-300">/path/to/your/shared/drive</code> בנתיב האמיתי לכונן המשותף שלך.
                </p>
              </div>

              {/* Desktop Shield */}
              <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Terminal className="w-4 h-4 text-violet-400" />
                  <h4 className="text-sm font-semibold text-white">ג. Desktop Shield (Clipboard)</h4>
                </div>
                <CodeBlock code={result.instructions?.desktopShield || ""} language="bash" />
              </div>

              {/* cURL */}
              <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Terminal className="w-4 h-4 text-orange-400" />
                  <h4 className="text-sm font-semibold text-white">ד. cURL – חיבור ישיר</h4>
                </div>
                <CodeBlock code={result.instructions?.curlExample || ""} language="bash" />
              </div>

              {/* JavaScript SDK */}
              <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Code2 className="w-4 h-4 text-green-400" />
                  <h4 className="text-sm font-semibold text-white">ה. JavaScript SDK</h4>
                </div>
                <CodeBlock code={result.instructions?.sdkExample || ""} language="javascript" />
              </div>
            </div>

            <div className="text-center pt-4">
              <button
                onClick={() => { setStep("form"); setName(""); setEmail(""); setResult(null); }}
                className="text-slate-400 hover:text-white text-sm underline transition-colors"
              >
                הוסף ארגון נוסף
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
