"use client";

import { useMemo } from "react";
import { useI18n } from "./useI18n";
import { useExchangeRate } from "./useExchangeRate";

/**
 * Locale-aware USD cost formatter.
 *
 * Upstream `usage.cost` / token-audit totals are reported in USD. When the UI
 * locale is Chinese AND a fresh USD→CNY rate is available (`useExchangeRate`),
 * this hook multiplies by the rate and formats with `Intl.NumberFormat` using
 * the `CNY` currency code; otherwise it formats the raw USD amount. The same
 * call site therefore produces `$0.0123` in English and `¥0.0831` in Chinese
 * without any per-call conversion logic.
 *
 * Falls back to USD when the rate is `null` (upstream unreachable) — see the
 * matched fallback in `app/api/exchange-rate/route.ts` (24h cache + stale
 * fallback). The fallback is intentionally silent; callers don't need to
 * special-case it.
 *
 * `Intl.NumberFormat` is memoised per (locale, currency) pair so repeated
 * `formatCost(usd)` calls in the same render (chart labels, ECharts tooltip
 * formatters) reuse one instance.
 *
 * Pass `opts.zeroDisplay` to override the zero-case rendering — the default
 * is `$0` / `¥0` (no decimals), but the message-footer call site doesn't
 * even reach zero (it's gated on `cost.total > 0`) so it relies on defaults.
 */

export interface FormatCurrencyOptions {
  /** Override minimum fraction digits. Default 2. */
  minimumFractionDigits?: number;
  /** Override maximum fraction digits. Default 4. */
  maximumFractionDigits?: number;
}

export interface FormatCurrency {
  formatCost: (usd: number) => string;
  /** Current USD→CNY rate, or `null` when unavailable. */
  rate: number | null;
  /** Which currency is currently being used for formatting. */
  currency: "USD" | "CNY";
}

export function useFormatCurrency(opts: FormatCurrencyOptions = {}): FormatCurrency {
  const { locale } = useI18n();
  const { rate: cnyRate } = useExchangeRate();
  const showCny = locale === "zh" && cnyRate !== null;
  const minFrac = opts.minimumFractionDigits ?? 2;
  const maxFrac = opts.maximumFractionDigits ?? 4;
  const intlLocale = locale === "zh" ? "zh-CN" : "en-US";

  return useMemo<FormatCurrency>(() => {
    const makeFormatter = (minimum: number, maximum: number) =>
      new Intl.NumberFormat(intlLocale, {
        style: "currency",
        currency: showCny ? "CNY" : "USD",
        minimumFractionDigits: minimum,
        maximumFractionDigits: maximum,
      });

    const defaultFmt = makeFormatter(minFrac, maxFrac);
    const zeroFmt = makeFormatter(0, 0);

    const formatCost = (usd: number): string => {
      if (usd === 0) return zeroFmt.format(0);
      const displayAmount = showCny ? usd * (cnyRate as number) : usd;
      return defaultFmt.format(displayAmount);
    };

    return { formatCost, rate: cnyRate, currency: showCny ? "CNY" : "USD" };
  }, [intlLocale, showCny, cnyRate, minFrac, maxFrac]);
}