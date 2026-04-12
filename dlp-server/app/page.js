"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff } from "lucide-react";
import { loginAction } from "./actions/auth";
import GhostLogo from "../components/GhostLogo";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await loginAction(formData);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-slate-900 flex items-center justify-center px-4"
    >
      {/* Background glow effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Card */}
        <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-8 shadow-2xl shadow-black/50">
          {/* Logo & Title */}
          <div className="flex flex-col items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <GhostLogo size={28} className="text-cyan-400" />
            </div>
            <div className="text-center">
              <h1 className="text-lg font-bold text-cyan-300 tracking-widest">GHOST</h1>
              <p className="text-slate-400 text-sm mt-1">פורטל ניהול מנהל-על</p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-medium">
                שם משתמש
              </label>
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

            {/* Password */}
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-medium">
                סיסמה
              </label>
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

            {/* Error message */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3.5 py-2.5">
                <p className="text-sm text-red-400 font-medium">{error}</p>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={isPending}
              className="w-full py-2.5 mt-2 bg-cyan-500/20 hover:bg-cyan-500/30 active:bg-cyan-500/40 border border-cyan-600/50 rounded-lg text-sm text-cyan-300 font-semibold tracking-wide transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-cyan-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  מתחבר...
                </span>
              ) : (
                "כניסה למערכת"
              )}
            </button>
          </form>

          {/* Footer */}
          <p className="text-center text-slate-600 text-xs mt-6">
            GHOST &copy; {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  );
}
