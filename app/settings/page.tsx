"use client";

import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function SettingsPage() {
  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

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
              href="/create-account"
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
                Your account email
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
              href="/check-in"
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
                Manage important continuity notifications.
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

            <button
              type="button"
              disabled
              className="mt-4 rounded-xl border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-400"
            >
              Change password
            </button>
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
            className="mt-5 rounded-xl border border-neutral-300 px-5 py-2.5 text-sm font-medium text-[#0D2340] transition hover:bg-neutral-50"
          >
            Sign out
          </button>
        </section>

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