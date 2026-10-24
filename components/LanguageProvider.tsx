"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { translate, translateMessage, formatTranslation, type Locale, type TranslationKey } from "@/lib/i18n/dictionaries";

const storageKey = "eterpax_language";
const LanguageContext = createContext({
  locale: "en" as Locale,
  setLocale: (_locale: Locale) => { void _locale; },
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>("en");
  useEffect(() => {
    const restore = () => {
      let next: Locale = "en";
      try { if (localStorage.getItem(storageKey) === "es") next = "es"; } catch { /* Storage may be unavailable. */ }
      updateLocale(next);
      document.documentElement.lang = next;
    };
    // Restore after hydration; the server and first client render both use English.
    const timer = window.setTimeout(restore, 0);
    const sync = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) restore(); };
    window.addEventListener("storage", sync);
    return () => { window.clearTimeout(timer); window.removeEventListener("storage", sync); };
  }, []);

  function setLocale(next: Locale) {
    updateLocale(next);
    document.documentElement.lang = next;
    try { localStorage.setItem(storageKey, next); } catch { /* Language still works for this session. */ }
  }
  return <LanguageContext.Provider value={{ locale, setLocale }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  return {
    ...context,
    t: (key: TranslationKey) => translate(context.locale, key),
    message: (text: string | null | undefined) => translateMessage(context.locale, text ?? ""),
    format: (key: TranslationKey, values: Record<string, string | number>) => formatTranslation(context.locale, key, values),
  };
}
