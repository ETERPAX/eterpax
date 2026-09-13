"use client";

import Link from "next/link";

export default function ActivatePage() {
  return (
    <main
      className="min-h-screen overflow-y-auto bg-cover bg-center bg-fixed text-[#102A43]"
      style={{ backgroundImage: "url('/images/hero-family-v2.jpg')" }}
    >
      <header className="flex items-center justify-between px-8 py-6 md:px-14">
        <div className="text-xl font-medium tracking-[0.28em]">
          ETERPAX
          <div className="mt-1 text-[9px] leading-[1.45] tracking-[0.12em] text-[#64748B]">
  Confidence is designed.<br />
  Trust is earned.<br />
  Continuity is intentional.
</div>
        </div>

        <div className="text-sm text-[#64748B]">
          Your private continuity.
        </div>
      </header>

      <section className="min-h-[calc(100vh-90px)] flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-2xl rounded-[28px] border border-slate-200 bg-white/95 px-8 py-16 text-center shadow-[0_25px_80px_rgba(16,42,67,0.12)] md:px-16">
          
          <p className="mb-5 text-sm font-medium uppercase tracking-[0.22em] text-[#0A7BA8]">
            Your continuity is protected
          </p>

          <h1 className="font-serif text-5xl font-light tracking-tight text-[#102A43] md:text-6xl">
            Your plan is protected.
          </h1>

          <p className="mx-auto mt-7 max-w-xl text-lg leading-8 text-slate-600">
            Everything is ready. Your continuity is now in your hands.
          </p>

          <Link
            href="/dashboard"
            className="mt-10 inline-flex items-center justify-center rounded-full bg-[#2F86B5] px-9 py-4 text-sm font-medium text-white transition hover:bg-[#26769F]"
          >
            Enter ETERPAX →
          </Link>

        </div>
      </section>
    </main>
  );
}