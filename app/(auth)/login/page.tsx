"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import Brand from "../../../components/Brand";

// login: Suspense wrapper so useSearchParams(?next=) works in a static route.
export default function Login() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function safeNext(v: string | null): string {
  // Allow only same-origin absolute paths (blocks open redirects).
  if (v && v.startsWith("/") && !v.startsWith("//")) return v;
  return "/notes";
}

// Login form state + submit: POST /auth/login, then go to ?next= or /notes.
function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [tries, setTries] = useState(0); // re-keys the error so it shakes on every failure
  const [busy, setBusy] = useState(false);
  const next = safeNext(useSearchParams().get("next"));
  // Submit credentials; 401 = wrong combo, anything else = API unreachable.
  const go = async () => {
    if (busy || !email || !password) return;
    setBusy(true); setErr("");
    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      location.href = next;
    } catch (e: unknown) {
      setTries(t => t + 1);
      const st = (e as { status?: number })?.status;
      setErr(st === 401 ? "That email and password don't match. Check them and try again."
        : st === 429 ? "Too many failed attempts. Wait 15 minutes, then try again."
        : "Can't reach the server. Make sure the API is running, then try again.");
    } finally { setBusy(false); }
  };
  const field = "field w-full text-[15px] bg-bg border border-line-strong rounded-[10px] px-3.5 h-11 placeholder:text-faint";
  return (
    <main className="relative min-h-screen bg-bg flex items-center justify-center px-4 overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(600px 380px at 50% 28%, rgb(var(--primary-rgb) / .12), transparent 70%)" }} />
      <div className="anim-pop relative w-full max-w-[380px]">
        <div className="flex flex-col items-center text-center mb-7">
          <Brand size={44} />
          <h1 className="font-display text-[28px] leading-tight mt-4">Second Brain</h1>
          <p className="text-[15px] text-muted mt-1.5">Say it once. It files itself, connects it, and reminds you when it matters.</p>
        </div>
        <form className="card p-6 shadow-[0_1px_2px_rgb(23_21_31/.04),0_12px_32px_-12px_rgb(var(--primary-rgb)/.18)]"
          onSubmit={e => { e.preventDefault(); go(); }}>
          <label htmlFor="email" className="block text-[13px] font-medium text-soft mb-1.5">Email</label>
          <input id="email" type="email" autoComplete="email" autoFocus className={`${field} mb-4`}
            placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          <label htmlFor="password" className="block text-[13px] font-medium text-soft mb-1.5">Password</label>
          <div className="relative mb-5">
            <input id="password" type={showPw ? "text" : "password"} autoComplete="current-password"
              className={`${field} pr-11`} value={password} onChange={e => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShowPw(v => !v)} onMouseDown={e => e.preventDefault()}
              aria-pressed={showPw} aria-label={showPw ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-soft transition-colors">
              {showPw ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
                  <line x1="2" y1="2" x2="22" y2="22" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          {err && (
            <p key={tries} role="alert" className="shake text-[13px] text-danger bg-danger-50 rounded-lg px-3 py-2 mb-4">{err}</p>
          )}
          <button type="submit" disabled={busy || !email || !password} className="btn btn-primary w-full h-11 text-[15px]">
            {busy && <span className="spinner" aria-hidden />}
            {busy ? "Signing in" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
