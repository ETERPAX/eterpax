"use client";

import Image from "next/image";
import HeroContent from "./HeroContent";

export default function HeroV1() {
  return (
    <section className="relative overflow-hidden bg-[#F8FAFC]">
      <div className="mx-auto grid min-h-screen max-w-[1600px] grid-cols-1 lg:grid-cols-2">

        {/* LEFT */}

        <div className="relative z-20 flex items-center px-8 py-24 lg:px-24">
          <HeroContent />
        </div>

        {/* RIGHT */}

        <div className="relative min-h-[700px] lg:min-h-screen">
          <Image
            src="/images/hero-family-v2.jpg"
            alt="ETERPAX Hero"
            fill
            priority
            className="object-cover object-center"
          />

         
        
        
        </div>

      </div>
    </section>
  );
}