"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Play,
  ShieldCheck,
  ArrowRight,
  Quote,
  Users,
  Heart,
} from "lucide-react";

export default function HeroPremium() {
  return (
    <section className="relative isolate h-[900px] overflow-hidden bg-white">

      {/* Background Image */}
      <div className="absolute inset-0">
        <Image
          src="/images/hero-family-v2.jpg"
          alt="ETERPAX"
          fill
          priority
          className="object-cover object-[center_18%]"
        />

        {/* Left white fade */}
        <div className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-black/35 via-black/10 to-transparent" />
      </div>

      {/* Main Content */}
      <div className="relative z-10 mx-auto flex h-full max-w-7xl px-12">

        <div className="mt-40 max-w-[610px]">

          {/* Headline */}
          <h1 className="font-serif text-[66px] leading-[0.96] tracking-[-0.03em] text-[#0D2340]">
            Protect what
            <br />
            matters{" "}
            <span className="text-[#55BFC8]">
              most.
            </span>
          </h1>

          <div className="mt-8 h-px w-14 bg-[#C5A45C]" />

          {/* Description */}
          <p className="mt-7 max-w-[500px] text-[22px] leading-9 text-[#243A57]">
            Prepare today so the people you love
            <br />
            always have clarity tomorrow.
          </p>

          {/* CTA */}
          <div className="mt-10 flex items-center gap-10">

            <Link
              href="/create-account"
              className="inline-flex items-center gap-4 rounded-full bg-gradient-to-r from-[#078F9C] to-[#075B8E] px-9 py-5 text-[17px] font-medium text-white shadow-xl transition duration-300 hover:scale-[1.02]"
            >
              <ShieldCheck className="h-5 w-5" />

              Create My Continuity Plan

              <ArrowRight className="h-5 w-5" />
            </Link>

            <button
              type="button"
              className="inline-flex items-center gap-3 text-[17px] font-medium text-[#0D2340]"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-[#0D2340]/30">
                <Play className="ml-0.5 h-4 w-4" />
              </span>

              Watch video
            </button>

          </div>

          {/* Manifesto */}
          <div className="mt-16 flex items-start gap-5">

            <Quote className="mt-1 h-8 w-8 shrink-0 text-[#C5A45C]" />

            <div className="border-l border-[#C5A45C]/70 pl-5">

              <p className="text-[11px] font-medium uppercase tracking-[0.28em] leading-7 text-[#0D2340]">

                Confidence is designed.

                <br />

                Trust is earned.

                <br />

                Continuity is intentional.

              </p>

            </div>

          </div>

        </div>

      </div>
     {/* Trust Highlights */}
     <div className="absolute bottom-2 right-8 z-20 hidden lg:block">

<div className="flex items-end gap-10">

  {/* Card 1 */}
  <div className="w-[230px] h-[235px] rounded-[30px] border border-white/15 bg-white/[0.015] p-6 transition-all duration-300">

  <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-white/[0.03]">
      <ShieldCheck className="h-7 w-7 text-[#55BFC8]" />
    </div>

    <h3 className="font-serif text-[20px] leading-[1.15] text-white">
  Your information.
  <br />
  <span className="text-[#55BFC8]">
    Always secure.
  </span>
</h3>

    <p className="mt-5 text-[14px] leading-8 text-white/85">
      Bank-level encryption protects what matters most.
    </p>

    <div className="mt-6 h-[2px] w-10 rounded-full bg-[#55BFC8]" />

  </div>

  {/* Card 2 */}
  <div className="w-[230px] h-[235px] rounded-[30px] border border-white/15 bg-white/[0.015] p-6 transition-all duration-300">

  <div className="mb-5 ml-1 flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/[0.03]">
      <Users className="h-7 w-7 text-[#55BFC8]" />
    </div>

    <h3 className="font-serif text-[21px] leading-tight text-white">
      You decide
      <br />
      <span className="text-[#55BFC8]">
        who and when.
      </span>
    </h3>

    <p className="mt-6 text-[15px] leading-7 text-white/80">
      Choose your guardians and what they receive.
    </p>

    <div className="mt-7 h-[3px] w-10 rounded-full bg-[#55BFC8]" />

  </div>

  {/* Card 3 */}
  <div className="w-[230px] h-[235px] rounded-[30px] border border-white/15 bg-white/[0.015] p-6 transition-all duration-300">

  <div className="mb-5 ml-1 flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/[0.03]">
      <Heart className="h-7 w-7 text-[#55BFC8]" />
    </div>

    <h3 className="font-serif text-[21px] leading-tight text-white">
      Clarity for them.
      <br />
      <span className="text-[#55BFC8]">
        Peace for you.
      </span>
    </h3>

    <p className="mt-6 text-[15px] leading-7 text-white/80">
      Your loved ones always know what matters most.
    </p>

    <div className="mt-7 h-[3px] w-10 rounded-full bg-[#55BFC8]" />

  </div>

</div>

</div>
        

      

    
      </section>
  );
}