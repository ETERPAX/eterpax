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
            className="absolute inset-0 h-full w-full object-cover"
          />

          <div className="absolute inset-0 bg-black/20" />

          <div className="relative z-10 flex h-full flex-col justify-between p-12 text-white">
            <div>
              <Link
                href="/"
                className="text-xl font-semibold tracking-[0.28em]"
              >
                ETERPAX
              </Link>

              <p className="mt-3 text-sm leading-6 tracking-[0.08em] text-white/90">
                Confidence is designed.
                <br />
                Trust is earned.
                <br />
                Continuity is intentional.
              </p>
            </div>

            <div className="max-w-xl pb-4">
              <h2 className="text-5xl font-light tracking-tight">
                Welcome back.
              </h2>

              <p className="mt-4 text-lg text-white/90">
                Your continuity plan is waiting for you.
              </p>
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