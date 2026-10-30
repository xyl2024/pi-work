"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import { isContentEqual } from "@/lib/client/shallowEqual";

let state: PiWorkConfig | null = null;
let initialFetchStarted = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setSettings(next: PiWorkConfig) {
  if (state && isContentEqual(state, next)) return;
  state = next;
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): PiWorkConfig | null {
  return state;
}

function getServerSnapshot(): PiWorkConfig | null {
  return null;
}

export function useSettings(): PiWorkConfig | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useEnsureSettings(): PiWorkConfig | null {
  const settings = useSettings();
  useEffect(() => {
    if (state !== null) return;
    if (initialFetchStarted) return;
    initialFetchStarted = true;
    void fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PiWorkConfig | null) => {
        if (d) setSettings(d);
      })
      .catch(() => {
      });
  }, []);
  return settings;
}