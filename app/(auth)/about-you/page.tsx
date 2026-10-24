"use client";
import { useLanguage } from "@/components/LanguageProvider";

import Link from "next/link";
import { User } from "lucide-react";
import { OnboardingFormLayout } from "@/components/auth/OnboardingFormLayout";
import { Input } from "@/components/ui/Input";

export default function AboutYouPage() {
  const { message: ui } = useLanguage();
  return (
    <OnboardingFormLayout step={2} totalSteps={5}>
      <div className="space-y-7">
      <Link
  href="/dashboard"
  className="relative z-50 inline-flex items-center text-sm font-medium text-neutral-500 transition hover:text-[#0A7BA8]"
>{ui("← Back to Dashboard")}</Link>
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#0F5C88]/10">
            <User className="h-6 w-6 text-[#0F5C88]" />
          </div>

          <h1 className="text-5xl font-light tracking-tight text-[#0D2340]">{ui("About You")}</h1>

          <p className="mx-auto max-w-lg text-lg leading-8 text-neutral-600">{ui("Tell us a little about yourself so we can personalize your Continuity Plan.")}</p>
        </div>

        <div className="space-y-5">
          <Input
            label={ui("First Name")}
            placeholder={ui("Enter your first name")}
          />

          <Input
            label={ui("Last Name")}
            placeholder={ui("Enter your last name")}
          />

          <Input
            label={ui("Date of Birth")}
            type="date"
          />

          <Input
            label={ui("Country of Residence")}
            placeholder={ui("Enter your country")}
          />
        </div>

        <div className="flex justify-center pt-4">
          <Link
            href="/your-messages"
            className="inline-flex items-center rounded-full bg-[#0A7BA8] px-10 py-4 font-medium text-white transition hover:bg-[#08698F]"
          >{ui("Continue →")}</Link>
        </div>

      </div>
    </OnboardingFormLayout>
  );
}