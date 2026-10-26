"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { plans } from "@/lib/billing/plans";

export function LandingPricing() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return <>
    <button type="button" onClick={() => setOpen(true)}
      className="text-sm font-medium text-white/70 transition hover:text-white">
      {t("Plans & pricing")}
    </button>
    {open && <PricingDialog onClose={() => setOpen(false)} />}
  </>;
}

function PricingDialog({ onClose }: { onClose: () => void }) {
  const { t, message: ui } = useLanguage();
  const dialogRef = useRef<HTMLDialogElement>(null);

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
    aria-labelledby="landing-pricing-title"
    onCancel={onClose}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2.5rem)] max-w-xl overflow-y-auto rounded-[30px] border border-white/30 bg-white/95 p-7 text-[#102A43] shadow-2xl backdrop-blur-xl backdrop:bg-black/45 backdrop:backdrop-blur-sm md:p-9"
  >
    <button type="button" onClick={onClose} aria-label={t("Close")}
      className="absolute right-5 top-5 text-2xl font-light text-slate-400 transition hover:text-slate-700">
      <span aria-hidden="true">×</span>
    </button>
    <h2 id="landing-pricing-title" className="pr-8 font-serif text-3xl">{t("Plans & pricing")}</h2>
    <dl className="mt-5 divide-y divide-slate-200">
      {Object.values(plans).map((plan) => <div key={plan.name} className="py-3">
        <dt className="font-medium">{ui(plan.name)}</dt>
        <dd className="mt-1 text-sm leading-6">
          <span className="font-semibold">{plan.price}</span>{" "}{ui(plan.period)}
          <p className="text-[#627D98]">{ui(plan.description)}</p>
        </dd>
      </div>)}
    </dl>
    <div className="mt-3 border-t border-slate-200 pt-5 text-sm leading-6 text-[#627D98]">
      <p>{t("Enjoy 15 days to create your collection, plus 15 more days to choose your plan. No payment details needed until you're ready to subscribe.")}</p>
      <p className="mt-3 font-medium text-[#486581]">{t("No credit card required until you choose your plan.")}</p>
    </div>
  </dialog>;
}
