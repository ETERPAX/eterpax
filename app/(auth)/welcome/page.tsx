"use client";

import { useState } from "react";
import Link from "next/link";

export default function WelcomePage() {
  const [showJourney, setShowJourney] = useState(false);
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#102A43]">
      {/* HERO IMAGE */}
      <div className="absolute inset-0">
        <img
          src="/images/hero-family-v2.jpg"
          alt=""
          className="h-full w-full object-cover object-right"
        />

        {/* Soft overlay for readability */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#071B2E]/60 via-[#071B2E]/25 to-transparent" />
<div className="absolute inset-0 bg-black/5" />
      </div>

      {/* CONTENT */}
      <div className="relative z-10 flex min-h-screen flex-col">
        {/* TOP BAR */}
        <header className="flex items-start justify-between px-8 py-7 lg:px-14 lg:py-9">
  <div>
    <div className="text-2xl font-light tracking-[0.35em] text-white">
      ETERPAX
    </div>

    <div className="mt-3 max-w-xs text-xs font-medium leading-5 tracking-wide text-white/75">
      Confidence is designed.
      <br />
      Trust is earned.
      <br />
      Continuity is intentional.
    </div>
  </div>

  <Link
    href="/login"
    className="mt-1 text-sm font-medium text-white/75 transition hover:text-white"
  >
    Already have an account? <span className="ml-1">Log in →</span>
  </Link>
</header>

        {/* HERO CONTENT */}
        <div className="flex flex-1 items-center">
          <div className="w-full max-w-7xl px-8 pb-20 lg:px-14">
            <div className="max-w-2xl">
              <p className="mb-6 text-sm font-medium uppercase tracking-[0.28em] text-white/75">
                Your words. Your memories. Your way.
              </p>

              <h1 className="max-w-xl font-serif text-6xl leading-[0.98] tracking-tight text-white md:text-7xl lg:text-8xl">
                Leave something
                <br />
                that stays.
              </h1>

              <p className="mt-8 max-w-xl text-lg leading-8 text-white/85 md:text-xl">
                Create something personal for the people who matter to you —
                your words, your voice, your memories, and the things you want
                them to have.
              </p>

              <Link
                href="/create-account"
                className="mt-10 inline-flex items-center rounded-full bg-[#0A7BA8] px-9 py-4 text-lg font-medium text-white shadow-xl shadow-black/20 transition-all duration-300 hover:scale-[1.02] hover:bg-[#08698F] active:scale-[0.99]"
              >
                Create Your First Message
                <span className="ml-3">→</span>
              </Link>

              <p className="mt-4 text-sm tracking-wide text-white/60">
                A private place for what you want to leave.
              </p>
            </div>
          </div>
        </div>

        {/* BOTTOM */}
        <div className="flex items-center justify-between px-8 pb-7 lg:px-14 lg:pb-9">
          <div className="text-sm text-white/70">
            Private by design. Always in your control.
          </div>

          <button
  type="button"
  onClick={() => setShowJourney(true)}
  className="text-sm font-medium text-white/70 transition hover:text-white"
>
  How ETERPAX works →
</button>
        </div>
      </div>
      {showJourney && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-5 py-6 backdrop-blur-sm">
    <div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[30px] border border-white/30 bg-white/95 p-7 shadow-2xl backdrop-blur-xl md:p-9">
      <button
        type="button"
        onClick={() => setShowJourney(false)}
        aria-label="Close"
        className="absolute right-5 top-5 text-2xl font-light text-slate-400 transition hover:text-slate-700"
      >
        ×
      </button>

      <div className="pr-8">
        <p className="text-sm font-medium uppercase tracking-[0.22em] text-[#0A7BA8]">
          How ETERPAX works
        </p>

        <h2 className="mt-3 font-serif text-4xl leading-tight text-[#102A43] md:text-5xl">
          A private way to leave what matters.
        </h2>

        <p className="mt-4 max-w-2xl text-base leading-7 text-[#486581]">
          Create something personal for the people who matter to you.
          ETERPAX helps protect what you choose to leave and how it reaches
          them.
        </p>
      </div>

      <div className="mt-7 space-y-3">
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <div className="flex gap-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EAF3F7] text-xs font-semibold text-[#0A7BA8]">
              01
            </div>
            <div>
              <h3 className="text-base font-semibold text-[#102A43]">
                Create what you want to leave
              </h3>
              <p className="mt-1 text-sm leading-6 text-[#627D98]">
                Start with a Message for someone who matters to you. Write a
                letter, record your voice, add a video, photos or documents —
                whatever you want them to have.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <div className="flex gap-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EAF3F7] text-xs font-semibold text-[#0A7BA8]">
              02
            </div>
            <div>
              <h3 className="text-base font-semibold text-[#102A43]">
                Choose who it’s for
              </h3>
              <p className="mt-1 text-sm leading-6 text-[#627D98]">
                Every Message belongs to a person you choose. You decide what
                you want to leave and who should receive it.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <div className="flex gap-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EAF3F7] text-xs font-semibold text-[#0A7BA8]">
              03
            </div>
            <div>
              <h3 className="text-base font-semibold text-[#102A43]">
                Guardians + Check-in
              </h3>

              <p className="mt-1 text-sm leading-6 text-[#627D98]">
                <span className="font-medium text-[#486581]">Guardians</span>{" "}
                are trusted people you choose to help verify your ETERPAX
                protocol when needed. They do not receive your Messages simply
                because they are Guardians.
              </p>

              <p className="mt-2 text-sm leading-6 text-[#627D98]">
                <span className="font-medium text-[#486581]">Check-in</span>{" "}
                keeps ETERPAX connected with you. You choose how it works and
                how often ETERPAX asks you to confirm that you are still
                connected.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <div className="flex gap-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EAF3F7] text-xs font-semibold text-[#0A7BA8]">
              04
            </div>
            <div>
              <h3 className="text-base font-semibold text-[#102A43]">
                When the time comes
              </h3>
              <p className="mt-1 text-sm leading-6 text-[#627D98]">
                When the time comes, ETERPAX follows the protocol you chose.
                Your Guardians help verify the situation before anything is
                released to the people you selected.
              </p>

              <p className="mt-2 text-sm font-medium leading-6 text-[#486581]">
                Nothing is released simply because a check-in was missed.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-7 border-t border-slate-200 pt-6 text-center">
        <p className="text-sm leading-6 text-[#627D98]">
          You decide what to leave. You decide who it’s for. ETERPAX helps
          protect the process.
        </p>

        <Link
          href="/create-account"
          onClick={() => setShowJourney(false)}
          className="mt-5 inline-flex items-center rounded-full bg-[#0A7BA8] px-9 py-3.5 font-medium text-white shadow-lg transition hover:bg-[#08698F]"
        >
          Create Your First Message
          <span className="ml-3">→</span>
        </Link>
      </div>
    </div>
  </div>
)}
    </main>
  );
}