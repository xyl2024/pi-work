"use client";

import { useMemo } from "react";
import { useI18n } from "./useI18n";
import { useExchangeRate } from "./useExchangeRate";

export interface FormatCurrencyOptions {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

export interface FormatCurrency {
  formatCost: (usd: number) => string;
  rate: number | null;
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