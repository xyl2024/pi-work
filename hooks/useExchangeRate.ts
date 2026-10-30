"use client";

import { useEffect, useSyncExternalStore } from "react";

interface RateState {
  rate: number | null;
  fetchedAt: number | null;
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
      if (!res.ok) return;
      const data = (await res.json()) as {
        rate: number;
        fetchedAt: number;
        stale: boolean;
      };
      if (typeof data.rate !== "number" || !Number.isFinite(data.rate)) return;
      if (state.fetchedAt === null || data.fetchedAt > state.fetchedAt) {
        state = { rate: data.rate, fetchedAt: data.fetchedAt, stale: data.stale };
        emit();
      }
    } catch {
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
  return SERVER_INITIAL_RATE;
}

export interface ExchangeRate {
  rate: number | null;
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