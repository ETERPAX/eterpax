"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabase";

type ResetStatus = "checking" | "ready" | "invalid" | "success";

type RecoveryAuthorization = { userId: string; sessionId: string };

// This extracts session identity only; getUser validates the token before authorization.
function sessionIdFromToken(token: string): string | null {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
    return typeof payload.session_id === "string" && payload.session_id ? payload.session_id : null;
  } catch {
    return null;
  }
}

async function matchesRecoverySession(proof: RecoveryAuthorization): Promise<boolean> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session || sessionIdFromToken(session.access_token) !== proof.sessionId) return false;
  const { data: { user }, error: userError } = await supabase.auth.getUser(session.access_token);
  return !userError && !!user && !user.is_anonymous &&
    user.id === proof.userId && user.id === session.user.id;
}

export default function ResetPasswordPage() {
  const [status, setStatus] = useState<ResetStatus>("checking");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const requestInFlight = useRef(false);
  const passwordUpdated = useRef(false);

  const recoveryAuthorization = useRef<RecoveryAuthorization | null>(null);
  const recoveryAttempt = useRef<Promise<RecoveryAuthorization | null> | null>(null);
  const recoveryInvalidated = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (!recoveryAttempt.current) {
      const url = new URL(window.location.href);
      const tokens = url.searchParams.getAll("token_hash");
      const types = url.searchParams.getAll("type");
      const tokenHash = tokens.length === 1 ? tokens[0] : null;
      const expectedType = types.length <= 1 && (!types.length || types[0] === "recovery");
      url.searchParams.delete("token_hash");
      url.searchParams.delete("type");
      const hash = new URLSearchParams(url.hash.slice(1));
      hash.delete("token_hash");
      hash.delete("type");
      url.hash = hash.toString();
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);

      // The ref retains the promise across Strict Mode effect replay, never the token in storage.
      recoveryAttempt.current = (async () => {
        try {
          if (!tokenHash || !expectedType) return null;
          const { error: initializationError } = await supabase.auth.initialize();
          if (initializationError || recoveryInvalidated.current) return null;
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: "recovery",
          });
          if (error || !data.session || !data.user) return null;
          const { data: { user }, error: userError } = await supabase.auth.getUser(data.session.access_token);
          if (userError || !user || user.is_anonymous ||
              user.id !== data.user.id || user.id !== data.session.user.id) return null;
          const sessionId = sessionIdFromToken(data.session.access_token);
          return sessionId ? { userId: user.id, sessionId } : null;
        } catch {
          return null;
        }
      })();
    }

    const verifySession = async () => {
      const current = ++generation.current;
      try {
        const proof = await recoveryAttempt.current;
        const valid = proof && !recoveryInvalidated.current && await matchesRecoverySession(proof);
        if (!active || current !== generation.current || passwordUpdated.current) return;
        recoveryAuthorization.current = valid ? proof : null;
        if (!valid) recoveryInvalidated.current = true;
        setStatus(valid ? "ready" : "invalid");
      } catch {
        if (active && current === generation.current && !passwordUpdated.current) {
          recoveryAuthorization.current = null;
          recoveryInvalidated.current = true;
          setStatus("invalid");
        }
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "SIGNED_OUT") {
        ++generation.current;
        clearTimeout(timer);
        recoveryAuthorization.current = null;
        recoveryInvalidated.current = true;
        if (!passwordUpdated.current) setStatus("invalid");
        return;
      }
      if (passwordUpdated.current) return;
      if (event === "PASSWORD_RECOVERY" || event === "INITIAL_SESSION" ||
          event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        const proof = recoveryAuthorization.current;
        if (proof && (!session || session.user.id !== proof.userId ||
            sessionIdFromToken(session.access_token) !== proof.sessionId)) {
          recoveryAuthorization.current = null;
          recoveryInvalidated.current = true;
        }
        ++generation.current;
        setStatus("checking");
        clearTimeout(timer);
        // Auth events only recheck the existing proof; they never redeem a token.
        timer = setTimeout(() => { void verifySession(); }, 0);
      }
    });
    void verifySession();

    return () => {
      active = false;
      ++generation.current;
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  const finishSignOut = async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setLoading(true);
    setError("");
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      setSignedOut(true);
    } catch {
      setError("Your password was updated, but we couldn't finish signing out. Please try again.");
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (requestInFlight.current || status !== "ready" || passwordUpdated.current) return;
    setError("");
    if (!newPassword || !confirmPassword || newPassword.length < 8) {
      setError("Please enter and confirm a password with at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    requestInFlight.current = true;
    setLoading(true);
    try {
      const proof = recoveryAuthorization.current;
      const current = generation.current;
      if (!proof || recoveryInvalidated.current || !await matchesRecoverySession(proof) ||
          current !== generation.current || recoveryAuthorization.current !== proof) {
        recoveryAuthorization.current = null;
        recoveryInvalidated.current = true;
        setStatus("invalid");
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      passwordUpdated.current = true;
      setNewPassword("");
      setConfirmPassword("");
      setStatus("success");
    } catch {
      setError("We couldn't update your password. Please try again or request a new reset link.");
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
    if (passwordUpdated.current) await finishSignOut();
  };

  return (
    <main className="min-h-screen w-full bg-white">
      <div className="grid min-h-screen w-full lg:grid-cols-2">
        <div className="relative hidden min-h-screen overflow-hidden lg:block">
          <img
            src="/images/hero-family-v2.jpg"
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-right"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#071B2E]/60 via-[#071B2E]/25 to-transparent" />
          <div className="absolute inset-0 bg-black/5" />

          <div className="relative z-10 flex min-h-screen flex-col">
            <header className="flex items-start justify-between px-8 py-7 lg:px-14 lg:py-9">
              <div>
                <Link href="/" className="text-2xl font-light tracking-[0.35em] text-white">
                  ETERPAX
                </Link>
                <div className="mt-3 max-w-xs text-xs font-medium leading-5 tracking-wide text-white/75">
                  Confidence is designed.
                  <br />
                  Trust is earned.
                  <br />
                  Continuity is intentional.
                </div>
              </div>
            </header>

            <div className="flex flex-1 items-center px-8 pb-20 lg:px-14">
              <div className="max-w-2xl">
                <p className="mb-6 text-sm font-medium uppercase tracking-[0.28em] text-white/75">
                  Welcome back.
                </p>
                <h2 className="max-w-lg font-serif text-5xl leading-[0.98] tracking-tight text-white md:text-6xl lg:text-7xl">
                  Your continuity
                  <br />
                  is waiting.
                </h2>
                <p className="mt-6 max-w-xl text-lg leading-8 text-white/85">
                  Your messages, your wishes, and the things that matter to you
                  are safely waiting for you.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex min-h-screen items-center justify-center bg-white px-6 py-12 sm:px-10 lg:px-16 xl:px-24">
          <div className="w-full max-w-md">
            <div className="mb-10">
              <Link href="/" className="text-sm font-semibold tracking-[0.28em] text-[#0F5C88]">
                ETERPAX
              </Link>
              <h1 className="mt-8 text-4xl font-light tracking-tight text-[#0D2340]">
                Set a new password
              </h1>
              <p className="mt-3 text-base text-neutral-600">
                Choose a new password with at least 8 characters.
              </p>
            </div>

            {status === "checking" && (
              <p role="status" className="text-sm text-neutral-600">Verifying your password reset session...</p>
            )}
            {status === "invalid" && (
              <div className="space-y-4">
                <p role="alert" className="text-sm text-neutral-600">
                  This reset link is invalid or expired, or your session is no longer available. Please request a new link.
                </p>
                <Link href="/forgot-password" className="text-sm font-medium text-[#0F5C88] hover:underline">
                  Request a new reset link
                </Link>
              </div>
            )}
            {status === "ready" && (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label htmlFor="new-password" className="mb-2 block text-sm font-medium text-[#0D2340]">New password</label>
                  <div className="relative">
                    <input
                      id="new-password"
                      type={showNewPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      disabled={loading}
                      className="w-full rounded-xl border border-neutral-200 bg-[#F5F8FC] pl-4 pr-12 py-3.5 text-[#0D2340] outline-none transition focus:border-[#0F5C88] focus:ring-2 focus:ring-[#0F5C88]/10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((visible) => !visible)}
                      aria-label={showNewPassword ? "Hide password" : "Show password"}
                      aria-controls="new-password"
                      disabled={loading}
                      className="absolute inset-y-0 right-0 flex items-center rounded-r-xl px-3 text-[#0F5C88] hover:text-[#0D2340] focus-visible:outline-2 focus-visible:outline-[#0F5C88] disabled:opacity-50"
                    >
                      {showNewPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="confirm-password" className="mb-2 block text-sm font-medium text-[#0D2340]">Confirm new password</label>
                  <div className="relative">
                    <input
                      id="confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      disabled={loading}
                      className="w-full rounded-xl border border-neutral-200 bg-[#F5F8FC] pl-4 pr-12 py-3.5 text-[#0D2340] outline-none transition focus:border-[#0F5C88] focus:ring-2 focus:ring-[#0F5C88]/10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((visible) => !visible)}
                      aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                      aria-controls="confirm-password"
                      disabled={loading}
                      className="absolute inset-y-0 right-0 flex items-center rounded-r-xl px-3 text-[#0F5C88] hover:text-[#0D2340] focus-visible:outline-2 focus-visible:outline-[#0F5C88] disabled:opacity-50"
                    >
                      {showConfirmPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={loading} className="w-full rounded-xl bg-[#2F8DBB] py-3.5 font-medium text-white transition hover:bg-[#277EA7] disabled:cursor-not-allowed disabled:opacity-50">
                  {loading ? "Updating..." : "Update password"}
                </button>
              </form>
            )}
            {status === "success" && (
              <div className="space-y-4">
                <p role="status" className="text-sm text-[#0F5C88]">Your password has been updated successfully.</p>
                {signedOut ? (
                  <Link href="/login" className="text-sm font-medium text-[#0F5C88] hover:underline">Back to Sign In</Link>
                ) : (
                  <button type="button" onClick={finishSignOut} disabled={loading} className="text-sm font-medium text-[#0F5C88] disabled:opacity-50">
                    {loading ? "Signing out..." : "Finish signing out"}
                  </button>
                )}
              </div>
            )}
            {error && <p role="alert" className="mt-4 text-sm text-red-500">{error}</p>}
          </div>
        </div>
      </div>
    </main>
  );
}
