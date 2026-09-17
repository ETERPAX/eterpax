"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Pencil, Users, Mail, ShieldCheck } from "lucide-react";

import { OnboardingFormLayout } from "@/components/auth/OnboardingFormLayout";
import { Input } from "@/components/ui/Input";
import { supabase } from "@/lib/supabase";

type Guardian = {
  name: string;
  email: string;
  relationship: string;
};

const emptyGuardian = (): Guardian => ({
  name: "",
  email: "",
  relationship: "",
});

export default function YourGuardiansPage() {
  const [guardians, setGuardians] = useState<Guardian[]>([
    emptyGuardian(),
    emptyGuardian(),
    emptyGuardian(),
  ]);

  const [openGuardian, setOpenGuardian] = useState<number | null>(0);
  const [firstName, setFirstName] = useState("your name");

  useEffect(() => {
    const loadData = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
  
      if (user) {
        const { data, error } = await supabase
          .from("guardians")
          .select("name, email, relationship")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });
      
        if (error) {
          console.error("Error loading guardians:", error);
        } else if (data && data.length > 0) {
          setGuardians([
            ...data,
            ...Array.from(
              { length: Math.max(0, 3 - data.length) },
              emptyGuardian
            ),
          ]);
        }
      }
  
      const savedAboutYou = localStorage.getItem("eterpax_about_you");
  
      if (savedAboutYou) {
        try {
          const parsed = JSON.parse(savedAboutYou);
  
          if (parsed.firstName) {
            setFirstName(parsed.firstName);
          }
        } catch {
          // Ignore invalid saved data
        }
      }
    };
  
    loadData();
  }, []);

  const updateGuardian = (
    index: number,
    field: keyof Guardian,
    value: string
  ) => {
    setGuardians((current) =>
      current.map((guardian, i) =>
        i === index
          ? { ...guardian, [field]: value }
          : guardian
      )
    );
  };

  const addGuardian = () => {
    const newIndex = guardians.length;

    if (newIndex >= 6) return;

    setGuardians((current) => [...current, emptyGuardian()]);
    setOpenGuardian(newIndex);
  };

  const handleContinue = async () => {
    const requiredGuardians = guardians.slice(0, 3);
  
    const allComplete = requiredGuardians.every(
      (guardian) =>
        guardian.name.trim() &&
        guardian.email.trim() &&
        guardian.relationship.trim()
    );
  
    if (!allComplete) {
      alert("Please complete all three required Guardians before continuing.");
      return;
    }
  
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
  
    if (userError || !user) {
      alert("Your session has expired. Please log in again.");
      window.location.href = "/login";
      return;
    }
  
    const { error: deleteError } = await supabase
      .from("guardians")
      .delete()
      .eq("user_id", user.id);
  
    if (deleteError) {
      console.error("Error clearing guardians:", deleteError);
      alert("We could not save your Guardians. Please try again.");
      return;
    }
  
    const { error: insertError } = await supabase
      .from("guardians")
      .insert(
        guardians
          .filter(
            (guardian) =>
              guardian.name.trim() &&
              guardian.email.trim() &&
              guardian.relationship.trim()
          )
          .map((guardian) => ({
            user_id: user.id,
            name: guardian.name.trim(),
            email: guardian.email.trim(),
            relationship: guardian.relationship.trim(),
          }))
      );
  
    if (insertError) {
      console.error("Error saving guardians:", insertError);
      alert("We could not save your Guardians. Please try again.");
      return;
    }
  
    localStorage.setItem(
      "eterpax_guardians",
      JSON.stringify(guardians)
    );
  
    window.location.href = "/check-in";
  };

  const activeGuardians = guardians.filter(
    (guardian) =>
      guardian.name.trim() &&
      guardian.email.trim() &&
      guardian.relationship.trim()
  );

  const majorityCount = Math.floor(activeGuardians.length / 2) + 1;

  return (
    <OnboardingFormLayout step={4} totalSteps={5}>
      <div className="space-y-8">

        {/* BACK */}
        <Link
          href="/dashboard"
          className="inline-flex items-center text-sm font-medium text-neutral-500 transition hover:text-[#0A7BA8]"
        >
          ← Back to Dashboard
        </Link>

        {/* HEADER */}
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#0F5C88]/10">
            <Users className="h-6 w-6 text-[#0F5C88]" />
          </div>

          <h1 className="text-5xl font-light tracking-tight text-[#0D2340]">
            Your Guardians
          </h1>

          <p className="mx-auto max-w-xl text-lg leading-8 text-neutral-600">
            Choose people you trust deeply to help ETERPAX carry out the plan
            you created if we can no longer reach you.
          </p>
        </div>

        {/* WHAT IS A GUARDIAN */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100">
              <Users className="h-5 w-5 text-[#0F5C88]" />
            </div>

            <div>
              <h2 className="text-lg font-semibold text-[#0D2340]">
                What is a Guardian?
              </h2>

              <p className="mt-2 text-sm leading-7 text-neutral-600">
                A Guardian is someone you trust deeply — a person you choose
                to help ETERPAX carry out the plan you created.
              </p>

              <p className="mt-3 text-sm leading-7 text-neutral-600">
                Your Guardians do not receive your Messages and they do not
                control your ETERPAX account. Their role is limited to helping
                ETERPAX follow the protocol you authorized.
              </p>
            </div>
          </div>
        </div>

        {/* HOW IT WORKS */}
        <div className="rounded-2xl border border-[#0A7BA8]/20 bg-[#0A7BA8]/5 p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
              <ShieldCheck className="h-5 w-5 text-[#0A7BA8]" />
            </div>

            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-[#0D2340]">
                How your Guardians work
              </h2>

              <div className="grid gap-3 pt-1 md:grid-cols-4">
                <div className="rounded-xl bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A7BA8]">
                    01
                  </p>

                  <p className="mt-2 text-sm font-medium leading-5 text-[#17375E]">
                    You miss 3 consecutive Check-ins
                  </p>
                </div>

                <div className="rounded-xl bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A7BA8]">
                    02
                  </p>

                  <p className="mt-2 text-sm font-medium leading-5 text-[#17375E]">
                    Your ETERPAX protocol activates
                  </p>
                </div>

                <div className="rounded-xl bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A7BA8]">
                    03
                  </p>

                  <p className="mt-2 text-sm font-medium leading-5 text-[#17375E]">
                    24 hours later, your Guardians receive an email
                  </p>
                </div>

                <div className="rounded-xl bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A7BA8]">
                    04
                  </p>

                  <p className="mt-2 text-sm font-medium leading-5 text-[#17375E]">
                  A majority of your Guardians must confirm what they know.
                  </p>
                </div>
              </div>

              <p className="pt-1 text-xs leading-5 text-[#496B8D]">
                With {activeGuardians.length} active Guardians, a majority
                means <strong>{majorityCount}</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* WHAT GUARDIANS WILL BE ASKED */}
        <div className="rounded-2xl border border-[#C9E5EF] bg-[#F0F7FA] p-6">
          <h2 className="text-lg font-semibold text-[#0D2340]">
            What your Guardians will be asked
          </h2>

          <p className="mt-2 text-sm leading-6 text-[#496B8D]">
            If your protocol is activated, your Guardians will receive a
            secure email with one direct question.
          </p>

          <div className="mt-4 rounded-xl bg-white px-5 py-4">
            <p className="text-base font-medium leading-6 text-[#17375E]">
            Is Juan still alive?
            </p>
          </div>

          <p className="mt-3 text-xs leading-5 text-[#496B8D]">
            They are asked to answer based on what they know.
          </p>

          <p className="mt-2 text-xs font-medium leading-5 text-[#35627A]">
            You are not responsible for what happens next. You are simply
            helping ETERPAX understand what you know.
          </p>
        </div>

        {/* GUARDIAN EDUCATION */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100">
              <Mail className="h-5 w-5 text-[#0F5C88]" />
            </div>

            <div>
              <h2 className="text-lg font-semibold text-[#0D2340]">
                Make sure they understand
              </h2>

              <p className="mt-2 text-sm leading-6 text-neutral-600">
                Before you invite someone to be your Guardian, explain what
                their role means.
              </p>

              <div className="mt-4 rounded-xl border-l-2 border-[#0A7BA8] bg-[#F7F9FB] px-5 py-4">
                <p className="text-sm italic leading-6 text-[#17375E]">
                  “I’ve chosen you as one of my ETERPAX Guardians. If ETERPAX
                  cannot reach me after three consecutive check-ins, you will receive an email asking you to help confirm what you know about my situation. You won’t have access to my Messages,
                  and you won’t control my ETERPAX account. You are not
                  responsible for what happens next — you’re simply helping
                  ETERPAX understand what you know.”
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* GUARDIANS */}
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-medium text-[#0D2340]">
              Choose your Guardians
            </h2>

            <p className="mt-1 text-sm text-neutral-500">
              Three Guardians are required. You may add up to three more.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {guardians.map((guardian, index) => {
              const isOpen = openGuardian === index;

              const isComplete =
                guardian.name.trim() &&
                guardian.email.trim() &&
                guardian.relationship.trim();

              return (
                <div
                  key={index}
                  className="rounded-2xl border border-[#0A7BA8]/20 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0F5C88] text-sm font-medium text-white">
                        {index + 1}
                      </div>

                      <div>
                        <h3 className="font-medium text-[#0D2340]">
                          Guardian {index + 1}
                        </h3>

                        <p className="text-sm text-neutral-500">
                          {isComplete
                            ? guardian.relationship
                            : "Information required"}
                        </p>
                      </div>
                    </div>

                    {isComplete && !isOpen && (
                      <button
                        type="button"
                        onClick={() => setOpenGuardian(index)}
                        className="text-[#0A7BA8] transition hover:text-[#08698F]"
                        aria-label={`Edit Guardian ${index + 1}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {!isOpen && (
                    <div className="mt-5">
                      {isComplete ? (
                        <p className="text-sm text-neutral-500">
                          {guardian.email}
                        </p>
                      ) : (
                        <>
                          <p className="text-sm text-neutral-500">
                            Add this trusted person's information.
                          </p>

                          <button
                            type="button"
                            onClick={() => setOpenGuardian(index)}
                            className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[#0A7BA8] transition hover:text-[#08698F]"
                          >
                            <Pencil className="h-4 w-4" />
                            Add Guardian
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {isOpen && (
                    <div className="mt-5 space-y-4">
                      <Input
                        label="Guardian's Full Name"
                        placeholder="Enter full name"
                        value={guardian.name}
                        onChange={(e) =>
                          updateGuardian(
                            index,
                            "name",
                            e.target.value
                          )
                        }
                      />

                      <Input
                        label="Guardian's Email"
                        type="email"
                        placeholder="Enter email address"
                        value={guardian.email}
                        onChange={(e) =>
                          updateGuardian(
                            index,
                            "email",
                            e.target.value
                          )
                        }
                      />

                      <Input
                        label="Relationship"
                        placeholder="Example: spouse, sibling, friend"
                        value={guardian.relationship}
                        onChange={(e) =>
                          updateGuardian(
                            index,
                            "relationship",
                            e.target.value
                          )
                        }
                      />

                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => setOpenGuardian(null)}
                          className="text-sm font-medium text-[#0A7BA8] transition hover:text-[#08698F]"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* ADD GUARDIAN */}
            {guardians.length < 6 && (
              <button
                type="button"
                onClick={addGuardian}
                className="flex min-h-[170px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#0A7BA8]/40 bg-[#0A7BA8]/5 p-5 text-center transition hover:border-[#0A7BA8] hover:bg-[#0A7BA8]/10"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm">
                  <Plus className="h-5 w-5 text-[#0A7BA8]" />
                </div>

                <h3 className="mt-3 font-medium text-[#0D2340]">
                  Add another Guardian
                </h3>

                <p className="mt-1 text-sm text-neutral-500">
                  Optional
                </p>
              </button>
            )}
          </div>
        </div>

        {/* IMPORTANT NOTE */}
        <div className="border-t border-neutral-200 pt-5">
          <p className="text-center text-sm leading-6 text-neutral-500">
            Your Guardians help ETERPAX follow the protocol you authorize.
            They do not receive your Messages simply because they are
            Guardians.
          </p>
        </div>

        {/* CONTINUE */}
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={handleContinue}
            className="inline-flex items-center rounded-full bg-[#0A7BA8] px-10 py-4 font-medium text-white shadow-lg shadow-sky-500/10 transition hover:bg-[#08698F]"
          >
            Continue →
          </button>
        </div>

      </div>
    </OnboardingFormLayout>
  );
}