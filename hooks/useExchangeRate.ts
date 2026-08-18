"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Module-scoped cache for the USD→CNY exchange rate. Server holds the
 * authoritative copy with a 24h TTL (`/api/exchange-rate`); this client store
 * mirrors it for the lifetime of the page so every `UsageIcons` render reads
 * from the same snapshot instead of refetching.
 *
 * `rate` is `null` until the first successful fetch lands. Components that
 * need currency conversion should treat `null` as "fall back to USD" — see
 * the caller in `components/MessageView.tsx`.
 */

interface RateState {
  /** CNY per 1 USD, or `null` when the upstream is unreachable. */
  rate: number | null;
  /** Epoch ms when the server fetched this rate, or `null`. */
  fetchedAt: number | null;
  /** True when the server returned a stale fallback (upstream was failing). */
  stale: boolean;
}

const SERVER_INITIAL_RATE: RateState = { rate: null, fetchedAt: null, stale: false };
let state: RateState = SERVER_INITIAL_RATE;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function emit() {
  for (const l of listeners) l();
}

async function refresh(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/exchange-rate");
      if (!res.ok) return; // server still has nothing usable — keep current client state
      const data = (await res.json()) as {
        rate: number;
        fetchedAt: number;
        stale: boolean;
      };
      if (typeof data.rate !== "number" || !Number.isFinite(data.rate)) return;
      // Only adopt the new value when it is genuinely newer than what we have.
      if (state.fetchedAt === null || data.fetchedAt > state.fetchedAt) {
        state = { rate: data.rate, fetchedAt: data.fetchedAt, stale: data.stale };
        emit();
      }
    } catch {
      // Network error: keep whatever we have (null on first failure).
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): RateState {
  return state;
}

function getServerSnapshot(): RateState {
  // SSR / first-client render must match the pre-fetch state to avoid a
  // hydration mismatch. The effect below kicks off the fetch after mount.
  return SERVER_INITIAL_RATE;
}

export interface ExchangeRate {
  /** CNY per 1 USD, or `null` when upstream is unreachable. */
  rate: number | null;
  /** True when the value being used is older than the server-side TTL. */
  stale: boolean;
}

export function useExchangeRate(): ExchangeRate {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (snap.rate === null) {
      void refresh();
    }
  }, [snap.rate]);

  return { rate: snap.rate, stale: snap.stale };
}