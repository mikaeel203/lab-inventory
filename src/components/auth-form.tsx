"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowRight, FlaskConical, GraduationCap, ScanLine, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import type { Role } from "@/lib/types";

export function AuthForm() {
  const search = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState(search.get("mode") === "update" ? "update" : "login");
  const [role, setRole] = useState<Role>("lab");
  const [error, setError] = useState(search.get("error") ?? "");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const authLock = useRef(false);
  const changeMode = (next: string) => { setMode(next); setError(""); setNotice(""); };

  useEffect(() => {
    if (!resendAt) return;
    const update = () => setResendSeconds(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [resendAt]);

  function startCooldown() {
    setResendAt(Date.now() + 60_000);
    setResendSeconds(60);
  }

  async function resendConfirmation() {
    if (authLock.current || !confirmationEmail || Date.now() < resendAt) return;
    authLock.current = true; setBusy(true); setError(""); setNotice(""); startCooldown();
    try {
      const { error: failure } = await createClient().auth.resend({ type: "signup", email: confirmationEmail,
        options: { emailRedirectTo: `${location.origin}/auth/confirm` } });
      if (failure) throw failure;
      setNotice("Confirmation email requested again. Check your inbox and spam/junk folder. If this address is already verified, sign in instead.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not resend the email. Please try again after the countdown.");
    } finally { authLock.current = false; setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authLock.current) return;
    authLock.current = true;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setNotice("");
    const client = createClient();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    try {
      if (mode === "signup") {
        const { data, error: failure } = await client.auth.signUp({ email, password, options: {
          emailRedirectTo: `${location.origin}/auth/confirm`,
          data: { role, display_name: role === "lab" ? form.get("lab_name") : form.get("display_name"),
            lab_name: form.get("lab_name"), department: form.get("department"), institution: form.get("institution") },
        } });
        if (failure) throw failure;
        if (data.session) { router.replace("/"); router.refresh(); return; }
        setConfirmationEmail(email); startCooldown();
        setNotice("Check your email to verify your account before signing in. Remember to check your spam/junk folder. If this address already has a verified account, sign in instead.");
      } else if (mode === "reset") {
        const { error: failure } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/auth/confirm` });
        if (failure) throw failure;
        setNotice("If an account exists for this email, you’ll receive a password reset link. Remember to check your spam/junk folder.");
      } else if (mode === "update") {
        const { data: { user } } = await client.auth.getUser();
        if (!user) throw new Error("Open a fresh password reset link from your email first.");
        const { error: failure } = await client.auth.updateUser({ password });
        if (failure) throw failure;
        router.replace("/"); router.refresh();
      } else {
        const { error: failure } = await client.auth.signInWithPassword({ email, password });
        if (failure?.code === "email_not_confirmed") { setConfirmationEmail(email); }
        if (failure) throw failure;
        router.replace("/"); router.refresh();
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not complete this action. Please try again."); }
    finally { authLock.current = false; setBusy(false); }
  }

  return <main className="auth-layout">
    <section className="auth-story"><a className="brand" href="/"><span className="brand-icon"><FlaskConical /></span> BenchMark</a>
      <div><span className="eyebrow">A LITTLE ORDER. A LOT OF POSSIBILITY.</span><h1>Know what’s<br />in your lab.<br /><em>Get back to science.</em></h1>
        <p>One place for your lab’s products, quantities, and people. Made for the phone already in your pocket.</p></div>
      <div className="story-points"><span><ScanLine /> Scan. Record. Find.</span><span><ShieldCheck /> Private to your lab.</span></div>
    </section>
    <section className="auth-main"><div className="auth-box">
      <span className="eyebrow">YOUR LAB, CONNECTED</span>
      <h2>{mode === "signup" ? "Make room for better records." : mode === "reset" ? "Forgot your password?" : mode === "update" ? "Choose a new password." : "Welcome back."}</h2>
      <p className="muted">{mode === "signup" ? "Start a lab inventory or join your lab as a student." : mode === "login" ? "Sign in to pick up where you left off." : "Let’s get you back into your account."}</p>
      {mode === "signup" && <div className="role-switch" aria-label="Account type">
        <button type="button" aria-pressed={role === "lab"} className={role === "lab" ? "selected" : ""} onClick={() => setRole("lab")}><FlaskConical /> Lab account<small>Manage your inventory</small></button>
        <button type="button" aria-pressed={role === "student"} className={role === "student" ? "selected" : ""} onClick={() => setRole("student")}><GraduationCap /> Student account<small>Connect with your lab</small></button>
      </div>}
      <form onSubmit={submit} className="form-stack">
        {mode === "signup" && (role === "lab" ? <>
          <label>Lab name<input name="lab_name" required maxLength={120} autoComplete="organization" placeholder="e.g. Molecular Sciences Lab" /></label>
          <label>Department<input name="department" required maxLength={160} placeholder="e.g. Chemistry" /></label>
          <label>Institution<input name="institution" required maxLength={160} placeholder="University or research institution" /></label>
        </> : <label>Your name<input name="display_name" required maxLength={120} autoComplete="name" placeholder="Full name" /></label>)}
        {mode !== "update" && <label>Email address<input name="email" type="email" required autoComplete="email" placeholder="you@institution.edu" /></label>}
        {mode !== "reset" && <label>Password<input name="password" type="password" required minLength={mode === "login" ? 1 : 12} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "login" ? "Your password" : "At least 12 characters"} /></label>}
        {error && <p role="alert" className="message error">{error}</p>}{notice && <p role="status" className="message success">{notice}</p>}
        <button className="button primary full" disabled={busy}>{busy ? "Working…" : mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : mode === "update" ? "Update password" : "Sign in"}<ArrowRight size={18} /></button>
      </form>
      {confirmationEmail && (mode === "signup" || mode === "login") && <section className="resend-confirmation" aria-label="Email confirmation">
        <p className="field-hint">Confirmation address: <strong>{confirmationEmail}</strong>. Check your spam/junk folder before requesting another email.</p>
        <button type="button" className="button secondary full" disabled={busy || resendSeconds > 0} onClick={() => void resendConfirmation()}>
          {resendSeconds > 0 ? `Resend confirmation email in ${resendSeconds}s` : "Resend confirmation email"}
        </button>
      </section>}
      {mode === "login" && <button className="text-button" onClick={() => changeMode("reset")}>Forgot password?</button>}
      <p className="auth-switch">{mode === "login" ? "New to BenchMark?" : "Already have an account?"} <button className="text-button" onClick={() => changeMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "Create an account" : "Sign in"}</button></p>
      <p className="privacy-note"><ShieldCheck size={15} /> Student access always requires lab approval.</p>
    </div></section>
  </main>;
}
