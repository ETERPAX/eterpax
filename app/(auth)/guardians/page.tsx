"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Pencil, Users, ShieldCheck } from "lucide-react";

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

export default function GuardiansPage() {
  const [guardians, setGuardians] = useState<Guardian[]>([
    emptyGuardian(),
    emptyGuardian(),
    emptyGuardian(),
  ]);

  const [openGuardian, setOpenGuardian] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadGuardians = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        window.location.href = "/login";
        return;
      }

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

      setLoading(false);
    };

    loadGuardians();
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
    if (guardians.length >= 6) return;

    const newIndex = guardians.length;

    setGuardians((current) => [...current, emptyGuardian()]);
    setOpenGuardian(newIndex);
  };

  const removeGuardian = (index: number) => {
    if (guardians.length <= 3) return;

    setGuardians((current) =>
      current.filter((_, i) => i !== index)
    );

    setOpenGuardian(null);
  };

  const handleSave = async () => {
    const requiredGuardians = guardians.slice(0, 3);

    const allRequiredComplete = requiredGuardians.every(
      (guardian) =>
        guardian.name.trim() &&
        guardian.email.trim() &&
        guardian.relationship.trim()
    );

    if (!allRequiredComplete) {
      alert("Please complete all three required Guardians before saving.");
      return;
    }

    const validGuardians = guardians.filter(
      (guardian) =>
        guardian.name.trim() &&
        guardian.email.trim() &&
        guardian.relationship.trim()
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      alert("Your session has expired. Please log in again.");
      window.location.href = "/login";
      return;
    }

    setSaving(true);

    const { error: deleteError } = await supabase
      .from("guardians")
      .delete()
      .eq("user_id", user.id);

    if (deleteError) {
      console.error("Error clearing guardians:", deleteError);
      alert("We could not save your Guardians. Please try again.");
      setSaving(false);
      return;
    }

    const { error: insertError } = await supabase
      .from("guardians")
      .insert(
        validGuardians.map((guardian) => ({
          user_id: user.id,
          name: guardian.name.trim(),
          email: guardian.email.trim(),
          relationship: guardian.relationship.trim(),
        }))
      );

    if (insertError) {
      console.error("Error saving guardians:", insertError);
      alert("We could not save your Guardians. Please try again.");
      setSaving(false);
      return;
    }

    setSaving(false);
    alert("Your Guardians have been saved.");
  };

  const activeGuardians = guardians.filter(
    (guardian) =>
      guardian.name.trim() &&
      guardian.email.trim() &&
      guardian.relationship.trim()
  );

  const majorityCount =
    Math.floor(activeGuardians.length / 2) + 1;

  if (loading) {
    return (
      <main className="min-h-screen bg-[#F7F9FB] px-6 py-12">
        <div className="mx-auto max-w-4xl text-center text-sm text-neutral-500">
          Loading your Guardians...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F7F9FB] px-6 py-10">
      <div className="mx-auto max-w-4xl space-y-8">

        {/* HEADER */}
        <div>
  <Link
    href="/dashboard"
    className="text-sm font-medium text-neutral-500 transition hover:text-[#0A7BA8]"
  >
    ← Back to Dashboard
  </Link>
</div>

        {/* TITLE */}
        <div className="space-y-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0F5C88]/10">
            <Users className="h-6 w-6 text-[#0F5C88]" />
          </div>

          <h1 className="text-4xl font-light tracking-tight text-[#0D2340]">
            Your Guardians
          </h1>

          <p className="max-w-2xl text-lg leading-8 text-neutral-600">
            Manage the people you trust to help ETERPAX follow the
            continuity protocol you authorized.
          </p>
        </div>

        {/* ACTIVE PLAN CONTEXT */}
        <div className="rounded-2xl border border-[#0A7BA8]/20 bg-[#0A7BA8]/5 p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
              <ShieldCheck className="h-5 w-5 text-[#0A7BA8]" />
            </div>

            <div>
              <h2 className="text-lg font-semibold text-[#0D2340]">
                Your Guardians help ETERPAX follow your plan
              </h2>

              <p className="mt-2 text-sm leading-7 text-[#496B8D]">
                Guardians do not receive your Messages and do not
                control your ETERPAX account. Their role is limited to
                helping ETERPAX follow the protocol you authorized.
              </p>
            </div>
          </div>
        </div>

        {/* GUARDIANS */}
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-medium text-[#0D2340]">
              Your Guardians
            </h2>

            <p className="mt-1 text-sm text-neutral-500">
              You need at least three Guardians. You may have up to six.
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
                        <div className="space-y-1">
                          <p className="text-sm text-neutral-600">
                            {guardian.name}
                          </p>

                          <p className="text-sm text-neutral-500">
                            {guardian.email}
                          </p>
                        </div>
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

                      <div className="flex items-center justify-between pt-1">
                        {guardians.length > 3 && (
                          <button
                            type="button"
                            onClick={() => removeGuardian(index)}
                            className="text-sm font-medium text-red-500 transition hover:text-red-600"
                          >
                            Remove
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setOpenGuardian(null)}
                          className="ml-auto text-sm font-medium text-[#0A7BA8] transition hover:text-[#08698F]"
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
        </section>

        {/* MAJORITY */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <p className="text-sm leading-6 text-neutral-600">
            With{" "}
            <strong className="text-[#0D2340]">
              {activeGuardians.length}
            </strong>{" "}
            active Guardians, a majority means{" "}
            <strong className="text-[#0D2340]">
              {majorityCount}
            </strong>
            .
          </p>
        </div>

        {/* SAVE */}
        <div className="flex flex-col items-center gap-4 border-t border-neutral-200 pt-6 sm:flex-row sm:justify-between">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-neutral-500 transition hover:text-[#0A7BA8]"
          >
            Cancel
          </Link>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center rounded-full bg-[#0A7BA8] px-10 py-4 font-medium text-white shadow-lg shadow-sky-500/10 transition hover:bg-[#08698F] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>

      </div>
    </main>
  );
}