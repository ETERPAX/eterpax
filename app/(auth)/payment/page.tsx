"use client";

import { Lock, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
export default function PaymentPage() {
  return (
    <main
      className="min-h-screen overflow-y-auto bg-cover bg-center bg-fixed text-[#102A43]"
      style={{ backgroundImage: "url('/images/hero-family-v2.jpg')" }}
    >
      <header className="flex items-center justify-between px-8 py-6 md:px-14">
        <div className="text-xl font-medium tracking-[0.28em]">
          ETERPAX
          <p className="mt-1 max-w-[230px] text-[9px] leading-[1.5] tracking-[0.08em] text-[#64748B]">
  Confidence is designed.
  <br />
  Trust is earned.
  <br />
  Continuity is intentional.
</p>
        </div>

        <div className="flex items-center gap-2 text-sm text-[#64748B]">
          <ShieldCheck className="h-4 w-4" />
          Secure Checkout
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 pb-16 pt-8 md:px-10">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 text-sm font-medium uppercase tracking-[0.22em] text-[#0A7BA8]">
            Protect Your Continuity Plan
          </p>

          <h1 className="font-serif text-4xl font-light tracking-tight md:text-5xl">
            Your plan is ready.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Secure your ETERPAX plan and keep what matters protected,
            privately and intentionally.
          </p>

        </div>
      </section>


<section className="mx-auto max-w-4xl px-6 pb-16 md:px-10">
  <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_25px_80px_rgba(16,42,67,0.10)]">
    <div className="border-b border-slate-100 px-6 py-5 md:px-8">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
        Your ETERPAX Plan
      </p>

      <p className="mt-1 text-sm text-slate-600">
        Everything you need to protect your continuity.
      </p>
    </div>

    <div className="px-6 py-8 md:px-10 md:py-10">
      <div className="text-center">
        <h2 className="font-serif text-3xl font-light text-[#102A43] md:text-4xl">
          Continuity Plan
        </h2>

        <p className="mt-3 text-slate-500">
          Your private space for the things that matter most.
        </p>
        <div className="mt-8">
  <span className="font-serif text-5xl font-light text-[#102A43]">
    $4.99
    <div className="mt-8">
  <p className="text-sm font-medium uppercase tracking-[0.2em] text-[#0A7BA8]">
    Unlimited
  </p>

  <p className="mt-2 text-sm text-slate-500">
    Letters · Messages · Voice Notes · Wishes · Memories
  </p>
</div>
  </span>

  <span className="ml-2 text-sm text-slate-500">
    / month
  </span>
</div>
<button
  type="button"
  onClick={async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const data = await response.json();

    if (!response.ok || !data.url) {
      console.error("Checkout error:", data.error);
      return;
    }

    window.location.href = data.url;
  }}
  className="mt-8 inline-flex items-center justify-center gap-3 rounded-full bg-[#0A7BA8] px-8 py-3.5 text-sm font-medium text-white transition hover:bg-[#08698F]"
>
  Protect My Plan
  <span>→</span>
</button>
      </div>
    </div>
  </div>
</section>
</main>

  );
}