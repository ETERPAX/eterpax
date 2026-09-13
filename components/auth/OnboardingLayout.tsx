import { ReactNode } from "react";
import Image from "next/image";

interface OnboardingLayoutProps {
  children: ReactNode;
}

export function OnboardingLayout({
  children,
}: OnboardingLayoutProps) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#F7F8FA]">

      {/* Background */}
      <Image
  src="/images/hero-family-v2.jpg"
  alt="ETERPAX"
  fill
  priority
  className="object-cover object-right"
/>

     

      {/* Top Header */}
      <header className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between px-10 py-8 lg:px-14">
        <div className="text-3xl font-light tracking-[0.22em] text-[#0E2237]">
          ETERPAX
        </div>

        <button className="text-sm text-[#0E2237] hover:text-[#0A7BA8] transition">
          Need help?
        </button>
      </header>

      {/* Content */}
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 pt-20 pb-12">

<div
 className="
 relative
 w-full
 max-w-3xl
 px-8
 py-4
 lg:-translate-x-32
"
> 

{/* Localized light behind content */}
<div
 className="
   absolute
   left-[42%]
   top-[45%]
   -z-10
   h-[520px]
   w-[520px]
   -translate-x-1/2
   -translate-y-1/2
   rounded-full
   bg-white/28
   blur-[110px]
   pointer-events-none
 "

/>
  {children}
</div>

</div>

    </main>
  );
}