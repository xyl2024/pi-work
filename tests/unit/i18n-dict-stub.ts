import { ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";

/**
 * `useI18n`'s `t`, rebuilt from the real zh dictionary, for pure-module tests
 * that assert on user-visible wording.
 *
 * Going through the actual dictionary is the point: a missing or re-worded key
 * fails the test instead of being papered over by a stub, which is exactly the
 * bug these tests are here to catch.
 */
export function dictT(key: string, params?: Record<string, string | number>): string {
  const template = ZH_TRANSLATIONS[key as keyof typeof ZH_TRANSLATIONS] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params && name in params ? String(params[name]) : match,
  );
}
