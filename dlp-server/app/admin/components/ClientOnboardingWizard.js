"use client";

// אשף הוספת לקוח חדש – Client Onboarding Wizard
import { useState } from "react";
import { X, Copy, Check, ChevronRight, ChevronLeft, Building2, Shield, Key, Terminal, Container } from "lucide-react";

// כל סוגי ה-PII הנתמכים
const PII_TYPES = [
  { id: "CREDIT_CARD", label: "כרטיס אשראי" },
  { id: "ID_NUMBER",   label: "תעודת זהות" },
  { id: "EMAIL",       label: "אימייל" },
  { id: "PHONE",       label: "טלפון" },
  { id: "ADDRESS",     label: "כתובת" },
  { id: "PASSPORT",    label: "דרכון" },
  { id: "BANK",        label: "חשבון בנק" },
  { id: "PASSWORD",    label: "סיסמה" },
  { id: "AWS_KEY",     label: "מפתח AWS" },
  { id: "OPENAI_KEY",  label: "מפתח OpenAI" },
];

const PLANS = [
  { value: "basic",      label: "בסיסי" },
  { value: "pro",        label: "מקצועי" },
  { value: "enterprise", label: "Enterprise" },
];

const SEVERITY_LEVELS = [
  { value: "low",      label: "נמוכה",  color: "text-green-400" },
  { value: "medium",   label: "בינונית", color: "text-yellow-400" },
  { value: "high",     label: "גבוהה",   color: "text-orange-400" },
  { value: "critical", label: "קריטית",  color: "text-rose-400" },
];

// כפתור העתקה לקליפבורד
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors text-slate-400 hover:text-white"
      title="העתק"
    >
      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

// תצוגת קוד עם כפתור העתקה
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

export default function ClientOnboardingWizard({ onClose, onClientCreated }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // שלב 1 – פרטי לקוח
  const [name, setName]               = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [plan, setPlan]               = useState("basic");
  const [notes, setNotes]             = useState("");

  // שלב 2 – מדיניות ראשונית
  const [selectedPII, setSelectedPII] = useState(
    PII_TYPES.map((p) => p.id) // כל הסוגים מסומנים כברירת מחדל
  );
  const [severity, setSeverity] = useState("medium");

  // שלב 3 – תוצאה
  const [result, setResult] = useState(null);

  function togglePII(id) {
    setSelectedPII((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleCreate() {
    setLoading(true);
    setError("");
    try {
      const initialPolicy = selectedPII.map((piiId) => ({
        id: piiId,
        label: PII_TYPES.find((p) => p.id === piiId)?.label || piiId,
        enabled: true,
        severity,
      }));

      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, contactEmail, plan, notes, initialPolicy }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה ביצירת הלקוח");
      setResult(data);
      setStep(3);
      if (onClientCreated) onClientCreated(data.organization);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const canProceedStep1 = name.trim().length > 0;
  const canProceedStep2 = selectedPII.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" dir="rtl">
      <div className="bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">

        {/* כותרת */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600/20 border border-blue-500/30 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">הוספת לקוח חדש</h2>
              <p className="text-xs text-slate-400">שלב {step} מתוך 3</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* מדד התקדמות */}
        <div className="flex gap-2 px-6 pt-4">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`flex-1 h-1.5 rounded-full transition-all ${
                s < step ? "bg-blue-500" : s === step ? "bg-blue-400" : "bg-slate-700"
              }`}
            />
          ))}
        </div>

        <div className="p-6 space-y-5">

          {/* ── שלב 1: פרטי לקוח ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Building2 className="w-4 h-4 text-blue-400" />
                <h3 className="font-semibold text-white">פרטי הלקוח</h3>
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-1.5">שם הארגון <span className="text-rose-400">*</span></label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="לדוגמה: חברת טכנולוגיות בע״מ"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500 transition-colors"
                  dir="rtl"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-1.5">אימייל איש קשר</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="contact@company.com"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500 transition-colors"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-1.5">סוג חבילה</label>
                <select
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-blue-500 transition-colors"
                >
                  {PLANS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-1.5">הערות</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="הערות נוספות על הלקוח..."
                  rows={3}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500 transition-colors resize-none"
                  dir="rtl"
                />
              </div>
            </div>
          )}

          {/* ── שלב 2: הגדרת מדיניות ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4 text-violet-400" />
                <h3 className="font-semibold text-white">הגדרת מדיניות ראשונית</h3>
              </div>

              <div>
                <p className="text-sm text-slate-300 mb-3">סוגי מידע רגיש לזיהוי:</p>
                <div className="grid grid-cols-2 gap-2">
                  {PII_TYPES.map((pii) => (
                    <label
                      key={pii.id}
                      className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                        selectedPII.includes(pii.id)
                          ? "bg-blue-600/15 border-blue-500/40 text-white"
                          : "bg-slate-800/60 border-slate-700/50 text-slate-400 hover:border-slate-600"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPII.includes(pii.id)}
                        onChange={() => togglePII(pii.id)}
                        className="w-3.5 h-3.5 accent-blue-500"
                      />
                      <span className="text-sm">{pii.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm text-slate-300 mb-3">רמת חומרה כללית:</p>
                <div className="flex gap-2 flex-wrap">
                  {SEVERITY_LEVELS.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => setSeverity(s.value)}
                      className={`px-4 py-2 rounded-xl border text-sm font-medium transition-all ${
                        severity === s.value
                          ? "bg-slate-700 border-slate-500 text-white"
                          : "bg-slate-800/60 border-slate-700/50 text-slate-400 hover:border-slate-600"
                      }`}
                    >
                      <span className={s.color}>{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── שלב 3: תוצאות + הוראות חיבור ── */}
          {step === 3 && result && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 mb-2">
                <Key className="w-4 h-4 text-green-400" />
                <h3 className="font-semibold text-white">הלקוח נוצר בהצלחה! 🎉</h3>
              </div>

              {/* Organization ID */}
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                <p className="text-xs text-slate-400 mb-1.5">Organization ID</p>
                <div className="flex items-center justify-between gap-2">
                  <code className="text-sm text-blue-300 font-mono">{result.organizationId}</code>
                  <CopyButton text={result.organizationId} />
                </div>
              </div>

              {/* API Key */}
              <div className="bg-rose-950/30 border border-rose-500/30 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-rose-300 uppercase tracking-wider">🔑 API Key</p>
                  <CopyButton text={result.apiKey} />
                </div>
                <code className="text-sm text-rose-200 font-mono break-all">{result.apiKey}</code>
                <p className="text-xs text-rose-400 mt-2">⚠️ שמור את המפתח – לא יוצג שוב לאחר סגירת חלון זה!</p>
              </div>

              {/* ── Zero-Touch Docker Install Command ── */}
              {(() => {
                const serverUrl =
                  typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
                const dockerCmd =
                  `docker run -d --restart=always \\\n` +
                  `  --name ghostlayer-agent \\\n` +
                  `  -e API_KEY="${result.apiKey}" \\\n` +
                  `  -e SERVER_URL="${serverUrl}" \\\n` +
                  `  -v /path/to/company/docs:/docs \\\n` +
                  `  ghostlayer/agent:latest`;
                return (
                  <div className="bg-cyan-950/30 border border-cyan-500/30 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-cyan-400" />
                      <p className="text-xs font-semibold text-cyan-300 uppercase tracking-wider">
                        🚀 Zero-Touch Agent Install (Docker)
                      </p>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      הרץ פקודה אחת על שרת הלקוח — הכל מוגדר אוטומטית, אין צורך בהגדרה ידנית.
                    </p>
                    <CodeBlock code={dockerCmd} language="bash" />
                    <div className="text-xs text-slate-500 space-y-0.5">
                      <p>• החלף <code className="text-cyan-400/80">/path/to/company/docs</code> בנתיב לכונן המשותף</p>
                      <p>• הסוכן יתחבר אוטומטית לדשבורד ויאפשר שליטה מרחוק</p>
                      <p>• אין צורך לפתוח פורטים — החיבור יוצא מהשרת החוצה בלבד</p>
                    </div>
                  </div>
                );
              })()}

              {/* הוראות חיבור */}
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-white border-b border-slate-700 pb-2">הוראות חיבור נוספות</h4>

                {/* א. Browser Extension */}
                <div>
                  <p className="text-xs font-semibold text-blue-400 mb-2">א. תוסף דפדפן (Browser Extension)</p>
                  <ol className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 space-y-1.5 text-sm text-slate-300 list-none">
                    {result.instructions.browserExtension.map((step, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-blue-400 font-mono text-xs mt-0.5">{i + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* ב. Desktop Shield */}
                <div>
                  <p className="text-xs font-semibold text-violet-400 mb-2">ב. Desktop Shield (Clipboard Agent)</p>
                  <CodeBlock code={result.instructions.desktopShield} language="bash" />
                </div>

                {/* ג. cURL */}
                <div>
                  <p className="text-xs font-semibold text-orange-400 mb-2">ג. חיבור ישיר דרך API (cURL)</p>
                  <CodeBlock code={result.instructions.curlExample} language="bash" />
                </div>

                {/* ד. JavaScript SDK */}
                <div>
                  <p className="text-xs font-semibold text-green-400 mb-2">ד. אינטגרציה פרוגרמטית (JavaScript)</p>
                  <CodeBlock code={result.instructions.sdkExample} language="javascript" />
                </div>
              </div>
            </div>
          )}

          {/* הודעת שגיאה */}
          {error && (
            <div className="bg-rose-950/30 border border-rose-500/30 rounded-xl p-3 text-sm text-rose-300">
              {error}
            </div>
          )}

          {/* כפתורי ניווט */}
          <div className="flex justify-between pt-2 border-t border-slate-700/50">
            {step > 1 && step < 3 ? (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
                חזור
              </button>
            ) : (
              <div />
            )}

            {step === 1 && (
              <button
                onClick={() => setStep(2)}
                disabled={!canProceedStep1}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-xl transition-colors"
              >
                המשך
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}

            {step === 2 && (
              <button
                onClick={handleCreate}
                disabled={!canProceedStep2 || loading}
                className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {loading ? "יוצר..." : "צור לקוח"}
                {!loading && <Key className="w-4 h-4" />}
              </button>
            )}

            {step === 3 && (
              <button
                onClick={onClose}
                className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-xl transition-colors"
              >
                סגור
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
