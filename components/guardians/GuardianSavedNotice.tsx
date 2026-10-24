"use client";
import { useLanguage } from "@/components/LanguageProvider";

export function GuardianSavedNotice({ onContinue }: { onContinue: () => void }) {
  const { message: ui } = useLanguage();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6" role="dialog" aria-modal="true" aria-labelledby="guardian-saved-title" onKeyDown={event => {
      if (event.key === "Tab") event.preventDefault();
    }}>
      <div className="max-w-lg rounded-2xl bg-white p-8 text-[#102A43] shadow-xl">
        <h2 id="guardian-saved-title" className="text-2xl font-medium">{ui("Your Guardians are set.")}</h2>
        <p className="mt-4 leading-7">{ui("Once you activate your ETERPAX plan, your Guardians will receive a confirmation email letting them know you have chosen them to be part of your Continuity Plan.")}</p>
        <button type="button" autoFocus onClick={onContinue} className="mt-6 rounded-full bg-[#0A7BA8] px-8 py-3 font-medium text-white">{ui("Continue")}</button>
      </div>
    </div>
  );
}
