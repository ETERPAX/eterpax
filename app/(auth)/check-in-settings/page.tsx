"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { supabase } from "@/lib/supabase";

const frequencyOptions = [
  {
    days: 30,
    title: "Every 30 days",
    description: "A monthly check-in rhythm.",
  },
  {
    days: 45,
    title: "Every 45 days",
    description: "A little more space between check-ins.",
  },
  {
    days: 60,
    title: "Every 60 days",
    description: "A quieter, less frequent rhythm.",
  },
];

export default function CheckInSettingsPage() {
  const router = useRouter();

  const [selectedFrequency, setSelectedFrequency] = useState<number | null>(
    null
  );
  const [customDays, setCustomDays] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isCustom = selectedFrequency === 0;

  useEffect(() => {
    const loadCheckIn = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data, error } = await supabase
        .from("check_ins")
        .select("frequency_days, enabled")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("ERROR LOADING CHECK-IN:", error);
        setLoading(false);
        return;
      }

      if (data) {
        const frequency = data.frequency_days;

        if ([30, 45, 60].includes(frequency)) {
          setSelectedFrequency(frequency);
        } else {
          setSelectedFrequency(0);
          setCustomDays(String(frequency));
        }
      } else {
        setSelectedFrequency(30);
      }

      setLoading(false);
    };

    loadCheckIn();
  }, [router]);

  const handleSave = async () => {
    let frequencyDays = selectedFrequency;

    if (isCustom) {
      const parsedDays = Number(customDays);

      if (!Number.isInteger(parsedDays) || parsedDays < 1) {
        alert("Please enter a valid number of days.");
        return;
      }

      frequencyDays = parsedDays;
    }

    if (!frequencyDays) {
      alert("Please select a check-in frequency.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace("/login");
      return;
    }

    setSaving(true);

    const { data: existingCheckIn, error: loadError } = await supabase
      .from("check_ins")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (loadError) {
      console.error("ERROR CHECKING EXISTING CHECK-IN:", loadError);
      alert("We could not load your Check-in settings.");
      setSaving(false);
      return;
    }

    if (existingCheckIn) {
      const { error } = await supabase
        .from("check_ins")
        .update({
          frequency_days: frequencyDays,
          enabled: true,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);

      if (error) {
        console.error("ERROR UPDATING CHECK-IN:", error);
        alert("We could not save your Check-in settings.");
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase.from("check_ins").insert({
        user_id: user.id,
        frequency_days: frequencyDays,
        enabled: true,
        missed_count: 0,
      });

      if (error) {
        console.error("ERROR CREATING CHECK-IN:", error);
        alert("We could not save your Check-in settings.");
        setSaving(false);
        return;
      }
    }

    alert("Your Check-in settings have been saved.");
    setSaving(false);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-slate-500">Loading your Check-in...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto w-full max-w-4xl px-6 py-10 md:px-10">
        <div className="mb-10">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>

        <div className="max-w-3xl">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-500">
            <ShieldCheck className="h-4 w-4" />
            Your Continuity
          </div>

          <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
            Your Check-in
          </h1>

          <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
            Stay connected to what you leave. Choose how often ETERPAX should
            ask you to confirm that everything is still in place.
          </p>
        </div>

        <section className="mt-12">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-slate-900">
              Choose your rhythm
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              You can change this preference whenever you want.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {frequencyOptions.map((option) => {
              const selected = selectedFrequency === option.days;

              return (
                <button
                  key={option.days}
                  type="button"
                  onClick={() => setSelectedFrequency(option.days)}
                  className={`relative rounded-2xl border p-5 text-left transition ${
                    selected
                      ? "border-slate-900 bg-slate-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-400"
                  }`}
                >
                  {selected && (
                    <span className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white">
                      <Check className="h-4 w-4" />
                    </span>
                  )}

                  <div className="pr-8">
                    <p className="text-lg font-semibold text-slate-900">
                      {option.title}
                    </p>

                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {option.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setSelectedFrequency(0)}
            className={`mt-4 w-full rounded-2xl border p-5 text-left transition ${
              isCustom
                ? "border-slate-900 bg-slate-50 shadow-sm"
                : "border-slate-200 bg-white hover:border-slate-400"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold text-slate-900">
                  Custom frequency
                </p>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Choose your own number of days between check-ins.
                </p>
              </div>

              {isCustom && (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
                  <Check className="h-4 w-4" />
                </span>
              )}
            </div>

            {isCustom && (
              <div
                className="mt-5 max-w-xs"
                onClick={(event) => event.stopPropagation()}
              >
                <Input
                label="Number of days"
                  type="number"
                  min="1"
                  value={customDays}
                  onChange={(event) => setCustomDays(event.target.value)}
                  placeholder="Number of days"
                />
              </div>
            )}
          </button>
        </section>

        <section className="mt-10 rounded-2xl bg-slate-50 p-6 md:p-8">
          <h2 className="text-lg font-semibold text-slate-900">
            How Check-in works
          </h2>

          <div className="mt-5 space-y-4 text-sm leading-6 text-slate-600">
            <p>
              ETERPAX will ask you to confirm your Check-in according to the
              rhythm you choose.
            </p>

            <p>
              If three consecutive check-ins are missed, your Guardians can
              help verify your situation.
            </p>

            <p>
              Your Guardians do not have access to your private Messages.
            </p>
          </div>
        </section>

        <div className="mt-10 flex flex-col-reverse gap-3 border-t border-slate-200 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </Link>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || selectedFrequency === null}
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </main>
  );
}