"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PlanSelection } from "@/components/PlanSelection";

type SubscriptionState =
  | { kind: "loading" | "error" | "empty" | "multiple" }
  | { kind: "loaded"; label: string };

const statusLabels: Record<string, string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  canceled: "Canceled",
  unpaid: "Unpaid",
  incomplete: "Incomplete",
  incomplete_expired: "Incomplete — expired",
  paused: "Paused",
};

export function YourPlanModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [subscription, setSubscription] = useState<SubscriptionState>({ kind: "loading" });

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    let cancelled = false;
    const controller = new AbortController();

    async function loadSubscription() {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authError || !user) throw new Error("Authentication unavailable");

        const lifetime = await supabase.rpc("has_lifetime_access");
        if (cancelled) return;
        if (lifetime.error) throw new Error("Access unavailable");
        if (lifetime.data === true) {
          setSubscription({ kind: "loaded", label: "Founder’s Lifetime — permanent access, no renewal" });
          return;
        }
        // Two rows are enough to detect ambiguity; never infer a commercial plan.
        const { data, error } = await supabase
          .from("subscriptions")
          .select("status")
          .eq("user_id", user.id)
          .limit(2)
          .abortSignal(controller.signal);
        if (cancelled) return;
        if (error || !data) throw new Error("Subscription unavailable");

        if (data.length === 0) setSubscription({ kind: "empty" });
        else if (data.length > 1) setSubscription({ kind: "multiple" });
        else {
          const status = data[0].status;
          const label = typeof status === "string" && Object.hasOwn(statusLabels, status)
            ? statusLabels[status] : null;
          if (!label) throw new Error("Unknown subscription status");
          setSubscription({ kind: "loaded", label });
        }
      } catch {
        if (!cancelled) setSubscription({ kind: "error" });
      }
    }

    void loadSubscription();
    return () => {
      cancelled = true;
      controller.abort();
      dialog?.close();
    };
  }, []);

  const statusText = subscription.kind === "loaded" ? subscription.label
    : subscription.kind === "loading" ? "Loading your subscription status…"
    : subscription.kind === "empty" ? "No subscription found."
    : subscription.kind === "multiple" ? "We couldn't determine a single current subscription."
    : "We couldn't load your subscription status. Please close this window and try again.";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="your-plan-title"
      onCancel={onClose}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-[28px] border border-white/70 bg-[#F7F8FA] p-5 text-[#0D2340] shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm sm:p-8"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close Your Plan"
        className="absolute right-4 top-4 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-[#0A7BA8]/10 text-2xl text-[#17375E] transition hover:bg-[#0A7BA8]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A7BA8]"
      >
        <span aria-hidden="true">×</span>
      </button>

      <div className="pr-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0A7BA8]">ETERPAX</p>
        <h2 id="your-plan-title" className="mt-2 font-serif text-3xl">Your Plan</h2>
      </div>

      <div className="mt-6"><PlanSelection /></div>

      <section className="mt-5 rounded-2xl border border-neutral-200 bg-white p-5" aria-labelledby="subscription-status-title">
        <h3 id="subscription-status-title" className="font-medium">Your Subscription Status</h3>
        <p role="status" aria-live="polite" aria-atomic="true" className="mt-2 text-sm leading-6 text-neutral-600">{statusText}</p>
        <p className="mt-3 text-xs leading-5 text-neutral-500">This status does not identify your purchased plan, price, or billing interval.</p>
      </section>
    </dialog>
  );
}
