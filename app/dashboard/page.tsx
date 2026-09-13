"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  ArrowRight,
  Check,
  LogOut,
  MessageCircle,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";

async function handleLogout() {
  await supabase.auth.signOut();
  window.location.href = "/login";
}

export default function DashboardPage() {
  const [guardianCount, setGuardianCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const savedGuardians = localStorage.getItem("eterpax_guardians");

    if (savedGuardians) {
      try {
        const parsed = JSON.parse(savedGuardians);

        if (Array.isArray(parsed)) {
          const completedGuardians = parsed.filter(
            (guardian) =>
              guardian?.name?.trim() &&
              guardian?.email?.trim() &&
              guardian?.relationship?.trim()
          );

          setGuardianCount(completedGuardians.length);
        } else {
          setGuardianCount(0);
        }
      } catch {
        setGuardianCount(0);
      }
    } else {
      setGuardianCount(0);
    }

    const loadMessageCount = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setMessageCount(0);
        return;
      }

      const { count, error } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);

      if (error) {
        console.error("ERROR LOADING MESSAGE COUNT:", error);
        setMessageCount(0);
        return;
      }

      setMessageCount(count ?? 0);
    };

    loadMessageCount();
  }, []);

  const hasMessages = messageCount > 0;
  const hasGuardians = guardianCount > 0;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#F7F8FA]">
      {/* Background */}
      <div className="absolute inset-0">
        <img
          src="/images/hero-family-warm.jpg"
          alt=""
          className="h-full w-full object-cover object-right"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#3B1F00]/40 via-[#F97316]/35 to-[#F59E0B]/15" />
        <div className="absolute inset-0 bg-black/10" />
      </div>

      <div className="relative z-10 min-h-screen">
        <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col px-6 py-7 lg:px-10 lg:py-9">
          {/* Header */}
          <header className="flex items-start justify-between">
            <div>
              <div className="text-2xl font-light tracking-[0.35em] text-white">
                ETERPAX
              </div>

              <div className="mt-3 max-w-xs text-[10px] font-medium leading-4 tracking-[0.12em] text-white/70">
                Confidence is designed.
                <br />
                Trust is earned.
                <br />
                Continuity is intentional.
              </div>
            </div>

            {/* Settings */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label="Open settings menu"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-white/90 text-[#17375E] shadow-lg backdrop-blur-sm transition hover:bg-white"
              >
                <Settings className="h-5 w-5" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-14 z-50 w-48 rounded-2xl border border-neutral-200 bg-white p-2 shadow-xl">
                  <Link
                    href="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-[#17375E] transition hover:bg-neutral-50"
                  >
                    <Settings className="h-4 w-4" />
                    Settings
                  </Link>

                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-[#17375E] transition hover:bg-neutral-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </header>

          {/* Main */}
          <div className="flex flex-1 items-center py-10">
            <div className="w-full">
              <div className="mx-auto max-w-6xl">
                {/* Intro */}
                <div className="mb-8 max-w-2xl">
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-white/75">
                    Your ETERPAX
                  </p>

                  <h1 className="mt-3 font-serif text-5xl leading-[1.05] tracking-tight text-white md:text-6xl lg:text-7xl">
                    A place for what
                    <br />
                    you want to leave.
                  </h1>

                  <p className="mt-6 max-w-xl text-lg leading-8 text-white/80">
                    Your words, your memories, and the things only you can
                    give.
                  </p>
                </div>

                {/* Messages — Main Card */}
                <div className="rounded-[30px] border border-white/60 bg-white/95 p-7 shadow-2xl backdrop-blur-md md:p-9">
                  <div className="flex flex-col gap-7 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-start gap-5">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#0A7BA8]/10">
                        <MessageCircle className="h-7 w-7 text-[#0A7BA8]" />
                      </div>

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0A7BA8]">
                          Your Messages
                        </p>

                        {hasMessages ? (
                          <>
                            <h2 className="mt-2 text-2xl font-medium text-[#0D2340]">
                              {messageCount}{" "}
                              {messageCount === 1 ? "Message" : "Messages"}
                            </h2>

                            <p className="mt-2 max-w-lg text-sm leading-6 text-neutral-600">
                              What you choose to leave, in your own words and
                              your own way.
                            </p>
                          </>
                        ) : (
                          <>
                            <h2 className="mt-2 text-2xl font-medium text-[#0D2340]">
                              Nothing here yet.
                            </h2>

                            <p className="mt-2 max-w-lg text-sm leading-6 text-neutral-600">
                              When you&apos;re ready, create something that
                              stays.
                            </p>
                          </>
                        )}
                      </div>
                    </div>

                    <Link
                      href="/your-messages?new=true"
                      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#0A7BA8] px-7 py-3.5 text-sm font-medium text-white shadow-lg shadow-[#0A7BA8]/20 transition hover:-translate-y-0.5 hover:bg-[#08698F]"
                    >
                      {hasMessages
                        ? "Leave Something New"
                        : "Create Your First Message"}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </div>
                </div>

                {/* Supporting Areas */}
                <div className="mt-5 grid gap-5 md:grid-cols-3">
                  {/* Guardians */}
                  <Link
                    href="/your-guardians"
                    className="group rounded-[26px] border border-white/60 bg-white/90 p-6 shadow-xl backdrop-blur-md transition hover:-translate-y-1 hover:bg-white"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0A7BA8]/10">
                        <Users className="h-5 w-5 text-[#0A7BA8]" />
                      </div>

                      {hasGuardians && (
                        <Check className="h-5 w-5 text-[#0A7BA8]" />
                      )}
                    </div>

                    <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-[#0A7BA8]">
                      Your Guardians
                    </p>

                    <h3 className="mt-2 text-xl font-medium text-[#0D2340]">
                      {hasGuardians
                        ? `${guardianCount} ${
                            guardianCount === 1 ? "Guardian" : "Guardians"
                          }`
                        : "Not started"}
                    </h3>

                    <p className="mt-2 text-sm leading-6 text-neutral-500">
                      People you trust to help carry out your ETERPAX protocol.
                    </p>

                    <div className="mt-5 flex items-center text-sm font-medium text-[#17375E]">
                      {hasGuardians ? "View Guardians" : "Choose your Guardians"}
                      <ArrowRight className="ml-2 h-4 w-4 transition group-hover:translate-x-1" />
                    </div>
                  </Link>

                  {/* Check-in */}
                  <Link
                    href="/check-in"
                    className="group rounded-[26px] border border-white/60 bg-white/90 p-6 shadow-xl backdrop-blur-md transition hover:-translate-y-1 hover:bg-white"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0A7BA8]/10">
                        <ShieldCheck className="h-5 w-5 text-[#0A7BA8]" />
                      </div>
                    </div>

                    <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-[#0A7BA8]">
                      Your Check-in
                    </p>

                    <h3 className="mt-2 text-xl font-medium text-[#0D2340]">
                      Not configured
                    </h3>

                    <p className="mt-2 text-sm leading-6 text-neutral-500">
                      Stay connected with ETERPAX through your chosen
                      check-in schedule.
                    </p>

                    <div className="mt-5 flex items-center text-sm font-medium text-[#17375E]">
                      Set up Check-in
                      <ArrowRight className="ml-2 h-4 w-4 transition group-hover:translate-x-1" />
                    </div>
                  </Link>

                  {/* Protection */}
                  <div className="rounded-[26px] border border-white/60 bg-white/90 p-6 shadow-xl backdrop-blur-md">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0A7BA8]/10">
                      <ShieldCheck className="h-5 w-5 text-[#0A7BA8]" />
                    </div>

                    <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-[#0A7BA8]">
                      Your Protection
                    </p>

                    <h3 className="mt-2 text-xl font-medium text-[#0D2340]">
                      Not active
                    </h3>

                    <p className="mt-2 text-sm leading-6 text-neutral-500">
                      Protect your ETERPAX when you&apos;re ready.
                    </p>

                    <p className="mt-5 text-sm font-medium text-neutral-400">
                      Protection comes next
                    </p>
                  </div>
                </div>

                {/* Closing line */}
                <div className="mt-8 text-center">
                  <p className="text-sm tracking-wide text-white/70">
                    Private by design. Always in your control.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <footer className="flex justify-end">
            <p className="text-xs tracking-wide text-white/55">
              ETERPAX
            </p>
          </footer>
        </div>
      </div>
    </main>
  );
}