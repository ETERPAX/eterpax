"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { OnboardingFormLayout } from "@/components/auth/OnboardingFormLayout";

export default function YourWishesPage() {
  return (
    <OnboardingFormLayout step={3} totalSteps={5}>
      <div className="space-y-7">
      <Link
  href="/dashboard"
  className="inline-flex items-center text-sm font-medium text-neutral-500 transition hover:text-[#0A7BA8]"
>
  ← Back to Dashboard
</Link>
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#0F5C88]/10">
            <Heart className="h-6 w-6 text-[#0F5C88]" />
          </div>

          <h1 className="text-5xl font-light tracking-tight text-[#0D2340]">
            Your Wishes
          </h1>

          <p className="mx-auto max-w-lg text-lg leading-8 text-neutral-600">
            Tell us what matters most to you and how you want your continuity
            plan to reflect your wishes.
          </p>
        </div>

        <div className="space-y-4">
          <button
            type="button"
            className="w-full rounded-2xl border border-neutral-200 bg-white p-5 text-left transition hover:border-[#0A7BA8]"
          >
            <p className="font-medium text-[#0D2340]">
              Personal Messages
            </p>
            <p className="mt-1 text-sm text-neutral-500">
              Prepare meaningful messages for the people you care about.
            </p>
          </button>

          <button
            type="button"
            className="w-full rounded-2xl border border-neutral-200 bg-white p-5 text-left transition hover:border-[#0A7BA8]"
          >
            <p className="font-medium text-[#0D2340]">
              Important Information
            </p>
            <p className="mt-1 text-sm text-neutral-500">
              Organize information you want available when it is needed.
            </p>
          </button>

          <button
            type="button"
            className="w-full rounded-2xl border border-neutral-200 bg-white p-5 text-left transition hover:border-[#0A7BA8]"
          >
            <p className="font-medium text-[#0D2340]">
              Personal Instructions
            </p>
            <p className="mt-1 text-sm text-neutral-500">
              Define the guidance and wishes that are important to you.
            </p>
          </button>
        </div>

        <div className="flex justify-center pt-4">
          <Link
            href="/your-guardians"
            className="inline-flex items-center rounded-full bg-[#0A7BA8] px-10 py-4 font-medium text-white transition hover:bg-[#08698F]"
          >
            Continue →
          </Link>
        </div>

      </div>
    </OnboardingFormLayout>
  );
}