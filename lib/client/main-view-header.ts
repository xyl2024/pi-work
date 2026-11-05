"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

export interface MainViewHeader {
  titleKey: string | null;
  onBack: (() => void) | null;
}

const EMPTY: MainViewHeader = { titleKey: null, onBack: null };

let header: MainViewHeader = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setMainViewHeader(next: MainViewHeader | null): void {
  const resolved = next ?? EMPTY;
  if (resolved.titleKey === header.titleKey && resolved.onBack === header.onBack) return;
  header = resolved;
  emit();
}

export function getMainViewHeader(): MainViewHeader {
  return header;
}

export function subscribeMainViewHeader(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useMainViewHeader(): MainViewHeader {
  return useSyncExternalStore(subscribeMainViewHeader, getMainViewHeader, () => EMPTY);
}

export function useInjectMainViewHeader(titleKey: string | null, onBack: (() => void) | null): void {
  const latestOnBack = useRef(onBack);
  const hasBack = onBack !== null;
  const stableOnBack = useMemo(
    () => (hasBack ? () => latestOnBack.current?.() : null),
    [hasBack],
  );
  useEffect(() => {
    latestOnBack.current = onBack;
    setMainViewHeader({ titleKey, onBack: stableOnBack });
  }, [titleKey, onBack, stableOnBack]);
  useEffect(
    () => () => {
      setMainViewHeader(null);
    },
    [],
  );
}
