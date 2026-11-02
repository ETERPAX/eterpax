"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { supabase } from "@/lib/supabase";

export function usePromotionPermissions() {
  const [state, setState] = useState<"loading" | "allowed" | "expired" | "error">("loading");
  useEffect(() => {
    let active = true;
    let inFlight = false;
    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      try {
        const { data, error } = await supabase.rpc("get_promotion_permissions");
        if (!active) return;
        if (error || typeof data?.writes_allowed !== "boolean") setState("error");
        else setState(data.writes_allowed ? "allowed" : "expired");
      } catch { if (active) setState("error"); }
      finally { inFlight = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  return state;
}

export function PromotionPermissionNotice({ state }: { state: ReturnType<typeof usePromotionPermissions> }) {
  const { locale } = useLanguage();
  if (state === "allowed") return null;
  const es = locale === "es";
  return <section role="status" className="my-4 rounded-xl border border-slate-300 bg-white p-5 text-[#102A43]">
    <p>{state === "expired"
      ? (es ? "Tu acceso promocional venció. Puedes consultar, descargar y solicitar la eliminación de tus mensajes. Para crear o editar mensajes y comenzar nuevos Check-ins, elige un plan. Los procesos ya iniciados continúan y puedes confirmar que estás bien."
        : "Your promotional access expired. You can view, download and request deletion of your messages. Choose a plan to create or edit messages and start new Check-ins. Processes already started continue, and you can still confirm you are well.")
      : state === "loading" ? (es ? "Comprobando permisos…" : "Checking access…")
        : (es ? "No pudimos comprobar tus permisos. Actualiza antes de editar." : "We could not check your access. Refresh before editing.")}</p>
    <div className="mt-3 flex gap-4">
      <Link className="underline" href="/your-messages">{es ? "Mis mensajes" : "My messages"}</Link>
      <Link className="underline" href="/dashboard">{es ? "Mi cuenta y Check-in" : "My account and Check-in"}</Link>
      {state === "expired" && <Link className="underline" href="/payment">{es ? "Elegir plan" : "Choose a plan"}</Link>}
    </div>
  </section>;
}
