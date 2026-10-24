"use client";
import { useLanguage } from "@/components/LanguageProvider";
import { useEffect, useState } from "react";
import { plans, type Plan } from "@/lib/billing/plans";
import { supabase } from "@/lib/supabase";

export function PlanSelection() {
  const { message: ui } = useLanguage();
  const [available, setAvailable] = useState<Record<Plan, boolean>>({ monthly: false, annual: false, lifetime: false });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void fetch("/api/plans", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (active) setAvailable({ monthly: data.monthly === true, annual: data.annual === true, lifetime: data.lifetime === true });
    }).catch(() => { if (active) setNotice("Plan availability could not be loaded. Please refresh."); });
    return () => { active = false; };
  }, []);
  async function checkout(plan: Plan) {
    setBusy(true); setNotice("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { window.location.assign("/login"); return; }
      const response = await fetch("/api/checkout", { method: "POST", headers: {
        Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json",
      }, body: JSON.stringify({ plan }) });
      const data = await response.json();
      if (!response.ok || typeof data.url !== "string") throw new Error();
      window.location.assign(data.url);
    } catch { setNotice("Checkout is unavailable or your reservation needs reconciliation. No additional checkout was confirmed. Please try again later."); }
    finally { setBusy(false); }
  }
  return <div>
    <div className="grid gap-4 md:grid-cols-3">
      {(Object.keys(plans) as Plan[]).map(plan => <section key={plan} className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-medium">{ui(plans[plan].name)}</h2>
        <p className="mt-3 text-3xl">{plans[plan].price}</p><p>{ui(plans[plan].period)}</p>
        <p className="mt-3 text-sm">{ui(plans[plan].description)}</p>
        <p className="mt-3 text-sm">{ui("Unlimited messages. Supported formats and file-size limits still apply.")}</p>
        <button type="button" disabled={busy || !available[plan]} onClick={() => void checkout(plan)}
          className="mt-5 rounded-lg bg-[#071B2E] px-5 py-3 text-white disabled:opacity-50">
          {available[plan] ? ui("Choose plan") : ui("Currently unavailable")}
        </button>
      </section>)}
    </div>
    <p className="mt-4 text-sm">{ui("Purchasing a plan does not automatically cancel any existing subscription.")}</p>
    {notice && <p role="status" className="mt-4">{ui(notice)}</p>}
  </div>;
}
