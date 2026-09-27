"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const requestInFlight = useRef(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (requestInFlight.current) return;

    requestInFlight.current = true;
    setLoading(true);
    setSent(false);
    setError("");

    try {
      const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (recoveryError) {
        setError("We couldn't send reset instructions right now. Please try again later.");
        return;
      }

      setSent(true);
    } catch {
      setError("We couldn't send reset instructions right now. Please try again later.");
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
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
                Forgot your password?
              </h1>
              <p className="mt-3 text-base text-neutral-600">
                Enter your email and we'll send instructions to reset your password.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="recovery-email" className="mb-2 block text-sm font-medium text-[#0D2340]">
                  Email
                </label>
                <input
                  id="recovery-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                  disabled={loading}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-neutral-200 bg-[#F5F8FC] px-4 py-3.5 text-[#0D2340] outline-none transition focus:border-[#0F5C88] focus:ring-2 focus:ring-[#0F5C88]/10"
                />
              </div>

              {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
              {sent && (
                <p role="status" className="text-sm text-[#0F5C88]">
                  If an account exists for this email, we've sent password reset instructions.
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-[#2F8DBB] py-3.5 font-medium text-white transition hover:bg-[#277EA7] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Sending..." : "Send reset link"}
              </button>
            </form>

            <div className="mt-8 text-center text-sm text-neutral-500">
              <Link href="/login" className="font-medium text-[#0F5C88] hover:underline">
                Back to Sign In
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
