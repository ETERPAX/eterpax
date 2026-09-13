"use client";

import Image from "next/image";

export default function HeroV2() {
  return (
    <section className="relative min-h-screen overflow-hidden bg-red-600">   

      <Image
        src="/images/hero-family.jpg"
        alt="ETERPAX Hero"
        fill
        priority
        className="object-cover object-right"
      />

    </section>
  );
}