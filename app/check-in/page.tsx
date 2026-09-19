"use client";

import { ArrowRight, ShieldCheck, Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { OnboardingFormLayout } from "@/components/auth/OnboardingFormLayout";
import { supabase } from "@/lib/supabase";
export default function CheckInPage() {
  const [selectedFrequency, setSelectedFrequency] = useState<number | null>(
    null
  );
  const [customDays, setCustomDays] = useState("");
  const [firstName, setFirstName] = useState("your name");
  const router = useRouter();

  

    useEffect(() => {
      const loadUser = async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
    
        if (user?.user_metadata?.firstName) {
          setFirstName(user.user_metadata.firstName);
        }
      };
    
      loadUser();
    }, []);

  const frequencies = [
    {
      days: 30,
      title: "Every 30 days",
      description: "A simple monthly rhythm",
    },
    {
      days: 45,
      title: "Every 45 days",
      description: "A little more space between check-ins",
    },
    {
      days: 60,
      title: "Every 60 days",
      description: "A quieter rhythm",
    },
  ];

  return (
    <OnboardingFormLayout step={5} totalSteps={5}>
      <section className="space-y-8">
        

        <section className="mx-auto max-w-5xl px-6 pb-16 pt-10 md:px-10 md:pt-16">
          {/* Intro */}
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-4 text-sm font-medium uppercase tracking-[0.22em] text-[#0A7BA8]">
              Your Check-in
            </p>

            <h1 className="font-serif text-4xl font-light tracking-tight text-[#0D2340] md:text-5xl">
              Stay connected to what you leave.
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-neutral-600">
              ETERPAX will reach out with a simple check-in. Your response
              keeps your plan active and in your control.
            </p>
          </div>

          {/* How Check-in Works */}
          <div className="mx-auto mt-12 max-w-4xl rounded-[28px] border border-white/60 bg-white/95 p-8 shadow-[0_25px_80px_rgba(16,42,67,0.14)] backdrop-blur-sm md:p-10">
            <h2 className="font-serif text-2xl font-light text-[#102A43] md:text-3xl">
              How your check-in works
            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-500">
              A simple confirmation keeps your plan active and under your
              control.
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl bg-[#F7FAFC] p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#E4F1F6] text-sm font-medium text-[#0A7BA8]">
                  1
                </div>

                <h3 className="mt-5 text-base font-medium text-[#102A43]">
                  ETERPAX checks in
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  ETERPAX sends you an email with a secure link asking you to
                  confirm that you are still here and able to respond.
                </p>
              </div>

              <div className="rounded-2xl bg-[#F7FAFC] p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#E4F1F6] text-sm font-medium text-[#0A7BA8]">
                  2
                </div>

                <h3 className="mt-5 text-base font-medium text-[#102A43]">
                  You confirm
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  One secure confirmation keeps your plan active and returns
                  everything to normal.
                </p>
              </div>

              <div className="rounded-2xl bg-[#F7FAFC] p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#E4F1F6] text-sm font-medium text-[#0A7BA8]">
                  3
                </div>

                <h3 className="mt-5 text-base font-medium text-[#102A43]">
                  If you don't respond
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Three consecutive missed check-ins activate the protocol
                  you chose for your ETERPAX plan.
                </p>
              </div>
            </div>
          </div>

          {/* Frequency */}
          <div className="mx-auto mt-8 max-w-4xl rounded-[28px] border border-white/60 bg-white/95 p-8 shadow-[0_25px_80px_rgba(16,42,67,0.14)] backdrop-blur-sm md:p-10">
            <h2 className="font-serif text-2xl font-light text-[#102A43] md:text-3xl">
              Choose your rhythm
            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-500">
              How often would you like ETERPAX to check in with you?
            </p>

            <div className="mt-8 space-y-3">
              {frequencies.map((frequency) => {
                const selected = selectedFrequency === frequency.days;

                return (
                  <button
                    key={frequency.days}
                    type="button"
                    onClick={() => setSelectedFrequency(frequency.days)}
                    className={`flex w-full items-center justify-between rounded-2xl border px-5 py-4 text-left transition ${
                      selected
                        ? "border-[#0A7BA8] bg-[#F0F7FA]"
                        : "border-slate-200 hover:border-[#0A7BA8] hover:bg-[#F8FCFD]"
                    }`}
                  >
                    <span>
                      <span className="block text-base font-medium text-[#102A43]">
                        {frequency.title}
                      </span>

                      <span className="mt-1 block text-sm text-slate-500">
                        {frequency.description}
                      </span>
                    </span>

                    {selected && (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0A7BA8] text-white">
                        <Check className="h-4 w-4" />
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Custom */}
              <button
                type="button"
                onClick={() => setSelectedFrequency(0)}
                className={`flex w-full items-center justify-between rounded-2xl border px-5 py-4 text-left transition ${
                  selectedFrequency === 0
                    ? "border-[#0A7BA8] bg-[#F0F7FA]"
                    : "border-slate-200 hover:border-[#0A7BA8] hover:bg-[#F8FCFD]"
                }`}
              >
                <span>
                  <span className="block text-base font-medium text-[#102A43]">
                    Custom check-in
                  </span>

                  <span className="mt-1 block text-sm text-slate-500">
                    Choose the rhythm that works best for you.
                  </span>
                </span>

                {selectedFrequency === 0 && (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0A7BA8] text-white">
                    <Check className="h-4 w-4" />
                  </span>
                )}
              </button>
            </div>

            {/* Custom frequency input */}
            {selectedFrequency === 0 && (
              <div className="mt-5 rounded-2xl bg-[#F0F7FA] p-5">
                <label
                  htmlFor="customDays"
                  className="block text-sm font-medium text-[#102A43]"
                >
                  Choose your check-in frequency
                </label>

                <div className="mt-3 flex items-center gap-3">
                  <span className="text-sm text-slate-600">Every</span>

                  <input
                    id="customDays"
                    type="number"
                    min="1"
                    value={customDays}
                    onChange={(e) => setCustomDays(e.target.value)}
                    placeholder="30"
                    className="w-28 rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-sm outline-none transition focus:border-[#0A7BA8] focus:ring-2 focus:ring-[#0A7BA8]/10"
                  />

                  <span className="text-sm text-slate-600">days</span>
                </div>

                <p className="mt-3 text-xs leading-5 text-slate-500">
                  You can change your check-in rhythm anytime from Settings.
                </p>
              </div>
            )}
          </div>

          {/* Protocol */}
          <div className="mx-auto mt-8 max-w-4xl rounded-[28px] border border-[#C9E5EF] bg-[#F0F7FA] p-8 md:p-10">
            <h2 className="font-serif text-2xl font-light text-[#102A43] md:text-3xl">
              If you don't respond
            </h2>

            <p className="mt-4 text-sm leading-7 text-[#35627A]">
              If you miss one check-in, nothing happens. ETERPAX waits for
              your next response.
            </p>

            <p className="mt-4 text-sm leading-7 text-[#35627A]">
              If you miss three consecutive check-ins, <strong>your ETERPAX
              protocol activates.</strong>
            </p>

            <div className="mt-5 rounded-2xl border border-[#B8DCE8] bg-white/70 px-5 py-4">
              <p className="text-sm font-medium leading-6 text-[#102A43]">
                24 hours after the third missed check-in, your Guardians will
                receive an email asking them to confirm your situation.
              </p>
            </div>

            <p className="mt-5 text-sm leading-7 text-[#35627A]">
              This is the protocol you are choosing now, while you are here
              and in control.
            </p>
          </div>

          

          {/* A meaningful step forward */}
<div className="mx-auto mt-8 max-w-4xl rounded-[28px] border border-white/60 bg-white/90 p-8 shadow-[0_20px_60px_rgba(16,42,67,0.10)] backdrop-blur-sm md:p-10">
  <div className="max-w-2xl">
    <p className="mb-3 text-sm font-medium uppercase tracking-[0.22em] text-[#0A7BA8]">
      An important step
    </p>

    

    <p className="mt-5 text-base leading-7 text-[#64748B]">
      Your Continuity Plan is now taking shape.
      You’ve chosen the people you trust and how ETERPAX should stay connected to you.
    </p>

    <p className="mt-4 text-base leading-7 text-[#64748B]">
      What you leave is becoming something that can stay —
      your words, your memories, your voice, and the things only you can give.
    </p>

    <h2 className="font-serif text-3xl leading-tight text-[#102A43] md:text-4xl">
  You’ve begun something that WILL stay.
</h2>
  </div>
</div>

          {/* Continue */}
          <div className="mx-auto mt-8 max-w-4xl">
            <button
              type="button"
              onClick={() => router.push("/payment")}
              className="inline-flex w-full items-center justify-center gap-3 rounded-full bg-[#0A7BA8] px-7 py-4 text-sm font-medium text-white shadow-xl shadow-black/10 transition hover:bg-[#08698F]"
            >
              Continue to Protect
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          </section>
</section>
</OnboardingFormLayout>
  );
}