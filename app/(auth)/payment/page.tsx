"use client";

import { ShieldCheck } from "lucide-react";
import { PlanSelection } from "@/components/PlanSelection";
export default function PaymentPage() {
  return (
    <main
      className="min-h-screen overflow-y-auto bg-cover bg-center bg-fixed text-[#102A43]"
      style={{ backgroundImage: "url('/images/hero-payment-v1.jpg')" }}
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


<section className="mx-auto max-w-5xl px-6 pb-16 md:px-10">
  <PlanSelection />
</section>
</main>

  );
}