"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { type Locale, ZH_TRANSLATIONS } from "@/lib/i18n-dict";
export type { Locale };

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  /**
   * Look up a translation by English key. Optional `params` substitutes
   * `{name}` placeholders in the resolved string (both the English
   * source and the Chinese translation). Missing keys return the key
   * itself verbatim in English; missing placeholders are left as the
   * literal `{name}` token so they surface during review.
   */
  t: (key: string, params?: Record<string, string | number>) => string;
}

const STORAGE_KEY = "pi-locale";

const I18nContext = createContext<I18nContextValue | null>(null);

function detectInitialLocale(): Locale {
  // Always return "en" during SSR to ensure hydration match.
  // The real locale will be set in useEffect after mount.
  if (typeof window === "undefined") return "en";
  return "en"; // placeholder until useEffect runs
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === "zh" ? "en" : "zh");
  }, [locale, setLocale]);

  useEffect(() => {
    // Read real locale after hydration to avoid mismatch
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "zh") {
        setLocaleState(saved);
        document.documentElement.lang = saved === "zh" ? "zh-CN" : "en";
      } else if (navigator.language.toLowerCase().startsWith("zh")) {
        setLocaleState("zh");
        document.documentElement.lang = "zh-CN";
      }
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const interpolate = (template: string, params?: Record<string, string | number>): string => {
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      );
    };
    return {
      locale,
      setLocale,
      toggleLocale,
      t: (key, params) => {
        const raw = locale === "zh"
          ? ZH_TRANSLATIONS[key as keyof typeof ZH_TRANSLATIONS] ?? key
          : key;
        return interpolate(raw, params);
      },
    };
  }, [locale, setLocale, toggleLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
