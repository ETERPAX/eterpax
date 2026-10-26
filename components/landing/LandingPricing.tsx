"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { PricingCard } from "@/components/landing/PricingCard";
import { plans, type Plan } from "@/lib/billing/plans";

export function LandingPricing() {
  const { t, message: ui } = useLanguage();
  const [selected, setSelected] = useState<Plan | null>(null);

  return <>
    <div className="mt-9 grid gap-6 lg:grid-cols-3">
      {(Object.keys(plans) as Plan[]).map((key) => {
        const plan = plans[key];
        return <PricingCard
          key={key}
          plan={{
            name: ui(plan.name),
            price: plan.price,
            period: ui(plan.period),
            description: ui(plan.description),
            features: [t("Unlimited messages. Supported formats and file-size limits still apply.")],
            cta: t("View plan details"),
            highlighted: false,
          }}
          onDetails={() => setSelected(key)}
        />;
      })}
    </div>
    {selected && <PlanDetails plan={selected} onClose={() => setSelected(null)} />}
  </>;
}

function PlanDetails({ plan: key, onClose }: { plan: Plan; onClose: () => void }) {
  const { t, message: ui } = useLanguage();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const plan = plans[key];

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  return <dialog
    ref={dialogRef}
    aria-labelledby="landing-plan-title"
    onCancel={onClose}
    className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-[28px] border border-white/70 bg-[#F7F8FA] p-6 text-[#0D2340] shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm sm:p-8"
  >
    <button type="button" onClick={onClose} aria-label={t("Close")}
      className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-[#0A7BA8]/10 text-2xl focus-visible:outline-2 focus-visible:outline-[#0A7BA8]">
      <span aria-hidden="true">×</span>
    </button>
    <h2 id="landing-plan-title" className="pr-10 font-serif text-3xl">{ui(plan.name)}</h2>
    <p className="mt-5 flex flex-wrap items-baseline gap-2"><span className="text-4xl font-semibold">{plan.price}</span> {ui(plan.period)}</p>
    <p className="mt-4 leading-7">{ui(plan.description)}</p>
    <p className="mt-4 leading-7">{t("Unlimited messages. Supported formats and file-size limits still apply.")}</p>
    <p className="mt-5 border-t border-slate-200 pt-5 text-sm leading-6">{t("No credit card required until you choose your plan.")}</p>
    <Link href="/create-account" className="mt-6 inline-flex rounded-full bg-[#0A7BA8] px-6 py-3 text-center font-medium text-white hover:bg-[#08698F]">
      {t("Create Your First Message")}
    </Link>
  </dialog>;
}
