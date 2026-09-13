import { ReactNode } from "react";
import { OnboardingHeader } from "./OnboardingHeader";

interface OnboardingFormLayoutProps {
  children: ReactNode;
  step: number;
  totalSteps: number;
  onBack?: () => void;
}

export function OnboardingFormLayout({
  children,
  step,
  totalSteps,
  onBack,
}: OnboardingFormLayoutProps) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#F7F8FA]">
      <div className="absolute inset-0">
        <img
          src="/images/hero-family-v2.jpg"
          alt=""
          className="h-full w-full object-cover object-right opacity-100"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#071B2E]/75 via-[#071B2E]/35 to-transparent" />
        <div className="absolute inset-0 bg-black/5" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1500px] flex-col px-6 pt-8 pb-10 lg:px-10 lg:pt-10">

        {/* ETERPAX BRAND */}
        <div className="flex items-start justify-between">
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

          <OnboardingHeader
            step={step}
            totalSteps={totalSteps}
            onBack={onBack}
          />
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-4xl rounded-[32px] bg-white/95 p-8 shadow-2xl backdrop-blur-sm md:p-10 lg:p-12">
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}