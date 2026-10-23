"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error || !data.user) { router.replace("/login"); return; }
      setUser(data.user);
    }).catch(() => { if (active) setError("We couldn't load your account. Please refresh."); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && !session) { setUser(null); router.replace("/login"); }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [router]);

  async function handleLogout() {
    if (signingOut) return;
    setSigningOut(true);
    setError("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      router.replace("/login");
    } catch {
      setError("We couldn't sign you out. Please try again.");
    } finally { setSigningOut(false); }
  }

  if (!user) return <main className="min-h-screen bg-[#F7F8FA] px-6 py-12">
    <p role={error ? "alert" : "status"}>{error || "Loading your account…"}</p>
  </main>;

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-6 py-12">
      <div className="mx-auto max-w-3xl">

        {/* Header */}
        <div>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-[#0F5C88] hover:underline"
          >
            ← Back to dashboard
          </Link>

          <p className="mt-8 text-sm font-medium uppercase tracking-[0.22em] text-[#0F5C88]">
            ETERPAX
          </p>

          <h1 className="mt-3 text-4xl font-light text-[#0D2340]">
            Settings
          </h1>

          <p className="mt-2 text-lg text-neutral-600">
            Manage your account, security and continuity preferences.
          </p>
        </div>

        {/* Account */}
        <section className="mt-10 rounded-3xl border border-neutral-200 bg-white p-7">
          <h2 className="text-xl font-semibold text-[#0D2340]">
            Account
          </h2>

          <p className="mt-2 text-sm text-neutral-500">
            Manage your account information.
          </p>

          <div className="mt-6 divide-y divide-neutral-100">

            <Link
              href="/settings/personal-information"
              className="flex items-center justify-between py-5 transition hover:bg-neutral-50"
            >
              <div>
                <p className="text-base font-medium text-[#0D2340]">
                  Personal information
                </p>
                <p className="mt-1 text-sm text-neutral-500">
                  Manage your personal account details.
                </p>
              </div>

              <span className="text-xl text-neutral-400">
                →
              </span>
            </Link>

            <div className="py-5">
              <p className="text-base font-medium text-[#0D2340]">
                Email
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                {user.email ?? "No email available"}
              </p>
            </div>

          </div>
        </section>

        {/* Continuity */}
        <section className="mt-6 rounded-3xl border border-neutral-200 bg-white p-7">
          <h2 className="text-xl font-semibold text-[#0D2340]">
            Continuity
          </h2>

          <p className="mt-2 text-sm text-neutral-500">
            Manage the preferences that support your continuity plan.
          </p>

          <div className="mt-6 divide-y divide-neutral-100">

            <Link
              href="/check-in-settings"
              className="flex items-center justify-between py-5 transition hover:bg-neutral-50"
            >
              <div>
                <p className="text-base font-medium text-[#0D2340]">
                  Check-in preferences
                </p>
                <p className="mt-1 text-sm text-neutral-500">
                  Manage how ETERPAX confirms your continuity.
                </p>
              </div>

              <span className="text-xl text-neutral-400">
                →
              </span>
            </Link>

            <div className="py-5">
              <p className="text-base font-medium text-[#0D2340]">
                Notifications
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                ETERPAX automatically sends Check-in reminders and continuity updates by email. Your Guardians receive verification requests when needed.
              </p>
            </div>

          </div>
        </section>

        {/* Security */}
        <section className="mt-6 rounded-3xl border border-neutral-200 bg-white p-7">
          <h2 className="text-xl font-semibold text-[#0D2340]">
            Security
          </h2>

          <p className="mt-2 text-sm text-neutral-500">
            Manage the security of your ETERPAX account.
          </p>

          <div className="mt-6">
            <p className="text-base font-medium text-[#0D2340]">
              Password
            </p>

            <p className="mt-1 text-sm text-neutral-500">
              Keep your account secure with a strong password.
            </p>

            <Link
              href="/forgot-password"
              className="mt-4 inline-block rounded-xl border border-neutral-200 px-4 py-2 text-sm font-medium text-[#0D2340]"
            >
              Change password
            </Link>
          </div>
        </section>

        {/* Sign out */}
        <section className="mt-6 rounded-3xl border border-neutral-200 bg-white p-7">
          <h2 className="text-xl font-semibold text-[#0D2340]">
            Account access
          </h2>

          <p className="mt-2 text-sm text-neutral-500">
            Sign out of your ETERPAX account on this device.
          </p>

          <button
            onClick={handleLogout}
            disabled={signingOut}
            className="mt-5 rounded-xl border border-neutral-300 px-5 py-2.5 text-sm font-medium text-[#0D2340] transition hover:bg-neutral-50"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </section>

        {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}

        {/* Danger Zone */}
        <section className="mt-6 rounded-3xl border border-red-200 bg-white p-7">
          <h2 className="text-xl font-semibold text-red-700">
            Danger Zone
          </h2>

          <p className="mt-2 text-sm text-neutral-500">
            Permanently remove your ETERPAX account and its data.
          </p>

          <button
            type="button"
            disabled
            className="mt-5 rounded-xl border border-red-200 px-5 py-2.5 text-sm font-medium text-red-300"
          >
            Delete account
          </button>
        </section>

        <p className="mt-10 text-center text-xs tracking-wide text-neutral-400">
          ETERPAX · Confidence is designed. Trust is earned. Continuity is intentional.
        </p>

      </div>
    </main>
  );
}