"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { supabase } from "@/lib/supabase";

type Benefit = { platform: "instagram" | "facebook"; expires_at: string; active: boolean };
const notices: Record<string, [string, string]> = {
  success: ["Your 12 months of promotional access are active. No charge or automatic renewal.", "Tus 12 meses de acceso promocional están activos. Sin cargo ni renovación automática."],
  invalid: ["Invalid code. Check it and try again.", "Código inválido. Revísalo e inténtalo de nuevo."],
  used: ["This code has already been used.", "Este código ya fue utilizado."],
  ineligible: ["This account is not eligible. One promotional benefit per account; existing paid plans cannot redeem this offer.", "Esta cuenta no es elegible. Un beneficio promocional por cuenta; los planes pagados existentes no pueden canjear esta oferta."],
  unverified: ["Verify your email before redeeming a code.", "Verifica tu correo antes de canjear un código."],
  unauthorized: ["Sign in to redeem your code.", "Inicia sesión para canjear tu código."],
  rate_limited: ["Too many attempts. Wait 15 minutes before trying again.", "Demasiados intentos. Espera 15 minutos antes de volver a intentar."],
  unavailable: ["Redemption is unavailable. Try again later.", "El canje no está disponible. Inténtalo más tarde."],
  uncertain: ["We could not confirm the result. Refresh your account before trying again.", "No pudimos confirmar el resultado. Actualiza tu cuenta antes de volver a intentar."],
};

export function PromotionCode() {
  const { locale } = useLanguage();
  const es = locale === "es";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState("");
  const [benefit, setBenefit] = useState<Benefit | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc("get_promotional_access");
      if (cancelled) return;
      if (error) { setLoadError(true); return; }
      if (data && (!["instagram", "facebook"].includes(data.platform) || typeof data.active !== "boolean"
        || typeof data.expires_at !== "string" || !Number.isFinite(Date.parse(data.expires_at)))) {
        setLoadError(true); return;
      }
      setLoadError(false); setBenefit(data);
    })().catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [version]);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setNotice("unauthorized"); return; }
      const response = await fetch("/api/promotions/redeem", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ code }),
      });
      const result = await response.json();
      const status = typeof result.status === "string" && Object.hasOwn(notices, result.status) ? result.status : "uncertain";
      setNotice(status);
      if (status === "success") { setCode(""); setVersion(v => v + 1); }
    } catch { setNotice("uncertain"); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
    {benefit && <div className="mb-4" role="status">
      <h3 className="font-medium">{es ? "Acceso promocional" : "Promotional access"} · {benefit.platform === "instagram" ? "Instagram" : "Facebook"}</h3>
      <p>{benefit.active ? (es ? "Activo hasta: " : "Active until: ") : (es ? "Venció: " : "Expired: ")}
        {new Intl.DateTimeFormat(es ? "es-MX" : "en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(benefit.expires_at))} UTC</p>
    </div>}
    {loadError && <p role="status" className="mb-3 text-sm">{es ? "No pudimos cargar tu acceso promocional." : "We couldn't load your promotional access."}</p>}
    <details>
      <summary className="cursor-pointer font-medium text-[#0A7BA8]">{es ? "Tengo un código" : "I have a code"}</summary>
      <p className="mt-3 text-sm">{es ? "12 meses completos y mensajes ilimitados. Sin tarjeta, cargo ni renovación automática. Se mantienen los formatos y límites de adjuntos por mensaje." : "12 full months and unlimited messages. No card, charge or automatic renewal. Existing formats and attachment limits per message still apply."}</p>
      <form onSubmit={redeem} className="mt-4 flex flex-wrap gap-3">
        <label className="w-full">{es ? "Código promocional" : "Promotional code"}
          <input type="text" value={code} onChange={event => setCode(event.target.value)} required maxLength={80}
            autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy}
            className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-mono" />
        </label>
        <button disabled={busy || !code.trim()} type="submit" className="rounded-lg bg-[#071B2E] px-5 py-3 text-white disabled:opacity-50">
          {busy ? (es ? "Canjeando…" : "Redeeming…") : (es ? "Canjear código" : "Redeem code")}
        </button>
      </form>
    </details>
    {notice && <p role="status" aria-live="polite" className="mt-3 text-sm">{notices[notice][es ? 1 : 0]}</p>}
    {notice === "success" && <a className="mt-3 inline-block underline" href="/dashboard">{es ? "Ver mi cuenta actualizada" : "View my updated account"}</a>}
  </section>;
}
