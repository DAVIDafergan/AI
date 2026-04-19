"use client";

import { useEffect, useState, useTransition } from "react";
import { Eye, EyeOff } from "lucide-react";
import { loginAction } from "./actions/auth";
import GhostLogo from "../components/GhostLogo";

function LoginCard() {
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await loginAction(formData);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-8 shadow-2xl shadow-black/50">
      <div className="flex flex-col items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
          <GhostLogo size={28} className="text-cyan-400" />
        </div>
        <div className="text-center">
          <h1 className="text-lg font-bold text-cyan-300 tracking-widest">GHOST</h1>
          <p className="text-slate-400 text-sm mt-1">פורטל ניהול מנהל-על</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-medium">שם משתמש</label>
          <input
            type="email"
            name="username"
            required
            autoComplete="username"
            className="w-full bg-slate-900/70 border border-slate-600/60 rounded-lg px-3.5 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 transition-all"
            placeholder="user@example.com"
            dir="ltr"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-medium">סיסמה</label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              required
              autoComplete="current-password"
              className="w-full bg-slate-900/70 border border-slate-600/60 rounded-lg px-3.5 py-2.5 pl-10 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 transition-all"
              placeholder="••••••••••"
              dir="ltr"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3.5 py-2.5">
            <p className="text-sm text-red-400 font-medium">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full py-2.5 mt-2 bg-cyan-500/20 hover:bg-cyan-500/30 active:bg-cyan-500/40 border border-cyan-600/50 rounded-lg text-sm text-cyan-300 font-semibold tracking-wide transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "מתחבר..." : "כניסה למערכת"}
        </button>
      </form>

      <p className="text-center text-slate-600 text-xs mt-6">GHOST &copy; {new Date().getFullYear()}</p>
    </div>
  );
}

function SetupWizard() {
  const [mongoUri, setMongoUri] = useState("");
  const [adminEmail, setAdminEmail] = useState("admin@example.com");
  const [adminPassword, setAdminPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function completeSetup(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mongoUri, adminEmail, adminPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Setup failed");
      setMessage("Setup complete. Applying configuration and restarting...");
      setTimeout(() => window.location.reload(), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-slate-800/60 backdrop-blur-sm border border-amber-500/30 rounded-2xl p-8 shadow-2xl shadow-black/50">
      <h1 className="text-xl font-bold text-amber-300 mb-2">First-run setup</h1>
      <p className="text-slate-300 text-sm mb-6">
        GhostLayer is running in local mode. Configure MongoDB and admin credentials to complete setup.
      </p>

      <form onSubmit={completeSetup} className="space-y-4">
        <div>
          <label className="block text-xs text-slate-300 mb-1">Step 1: MongoDB URI</label>
          <input
            value={mongoUri}
            onChange={(e) => setMongoUri(e.target.value)}
            required
            dir="ltr"
            placeholder="mongodb+srv://username:password@cluster.mongodb.net/ghostlayer?retryWrites=true&w=majority"
            className="w-full bg-slate-900/70 border border-slate-600/60 rounded-lg px-3.5 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/20"
          />
          <a
            href="https://www.mongodb.com/cloud/atlas/register"
            target="_blank"
            rel="noreferrer"
            className="inline-block mt-2 text-xs text-cyan-300 hover:text-cyan-200"
          >
            Get a free MongoDB Atlas URI
          </a>
        </div>

        <div>
          <label className="block text-xs text-slate-300 mb-1">Step 2: Admin email</label>
          <input
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            required
            dir="ltr"
            className="w-full bg-slate-900/70 border border-slate-600/60 rounded-lg px-3.5 py-2.5 text-sm text-slate-200 outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/20"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-300 mb-1">Step 2: Admin password</label>
          <input
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            required
            dir="ltr"
            className="w-full bg-slate-900/70 border border-slate-600/60 rounded-lg px-3.5 py-2.5 text-sm text-slate-200 outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/20"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 bg-amber-500/20 hover:bg-amber-500/30 active:bg-amber-500/40 border border-amber-500/50 rounded-lg text-sm text-amber-200 font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Completing setup..." : "Step 3: Complete Setup"}
        </button>
      </form>

      {message && <p className="text-emerald-300 text-sm mt-4">{message}</p>}
      {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
    </div>
  );
}

export default function LoginPage() {
  const [loading, setLoading] = useState(true);
  const [localMode, setLocalMode] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/setup", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        setLocalMode(Boolean(data?.localMode));
      })
      .catch(() => {
        if (!active) return;
        setLocalMode(false);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div dir="rtl" className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
      </div>
      <div className="relative w-full max-w-lg">{loading ? <LoginCard /> : localMode ? <SetupWizard /> : <LoginCard />}</div>
    </div>
  );
}
