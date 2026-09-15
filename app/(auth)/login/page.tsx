"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();

    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError("Email or password is incorrect.");
      setLoading(false);
      return;
    }

    window.location.href = "/dashboard";
  };

  return (
    <main className="min-h-screen w-full bg-white">
      <div className="grid min-h-screen w-full lg:grid-cols-2">

        {/* HERO */}
        
<div className="relative hidden min-h-screen overflow-hidden lg:block">
  <img
    src="/images/hero-family-v2.jpg"
    alt=""
    className="absolute inset-0 h-full w-full object-cover object-right"
  />

  {/* Soft overlay for readability */}
  <div className="absolute inset-0 bg-gradient-to-r from-[#071B2E]/60 via-[#071B2E]/25 to-transparent" />

  <div className="absolute inset-0 bg-black/5" />

  <div className="relative z-10 flex min-h-screen flex-col">
    {/* TOP BAR */}
    <header className="flex items-start justify-between px-8 py-7 lg:px-14 lg:py-9">
      <div>
        <Link
          href="/"
          className="text-2xl font-light tracking-[0.35em] text-white"
        >
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

    {/* HERO CONTENT */}
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

        {/* LOGIN */}
        <div className="flex min-h-screen items-center justify-center bg-white px-6 py-12 sm:px-10 lg:px-16 xl:px-24">
          <div className="w-full max-w-md">

            <div className="mb-10">
              <Link
                href="/"
                className="text-sm font-semibold tracking-[0.28em] text-[#0F5C88]"
              >
                ETERPAX
              </Link>

              <h1 className="mt-8 text-4xl font-light tracking-tight text-[#0D2340]">
                Welcome back.
              </h1>

              <p className="mt-3 text-base text-neutral-600">
                Sign in to continue your continuity journey.
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-6">

              <div>
                <label className="mb-2 block text-sm font-medium text-[#0D2340]">
                  Email
                </label>

                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-neutral-200 bg-[#F5F8FC] px-4 py-3.5 text-[#0D2340] outline-none transition focus:border-[#0F5C88] focus:ring-2 focus:ring-[#0F5C88]/10"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#0D2340]">
                  Password
                </label>

                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-neutral-200 bg-[#F5F8FC] px-4 py-3.5 text-[#0D2340] outline-none transition focus:border-[#0F5C88] focus:ring-2 focus:ring-[#0F5C88]/10"
                />
              </div>

              {error && (
                <p className="text-sm text-red-500">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-[#2F8DBB] py-3.5 font-medium text-white transition hover:bg-[#277EA7] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Signing in..." : "Log In"}
              </button>
            </form>

            <div className="mt-8 text-center text-sm text-neutral-500">
              Don't have an account?{" "}
              <Link
                href="/create-account"
                className="font-medium text-[#0F5C88] hover:underline"
              >
                Create your account
              </Link>
            </div>

          </div>
        </div>

      </div>
    </main>
  );
}