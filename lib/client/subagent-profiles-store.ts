"use client";

import { useSyncExternalStore } from "react";
import type { SubagentProfile } from "@/lib/shared/subagent";

const EMPTY: readonly SubagentProfile[] = [];

let profiles: readonly SubagentProfile[] = EMPTY;
let loaded = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export async function refreshSubagentProfiles(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const response = await fetch("/api/subagents", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { profiles?: SubagentProfile[] };
      profiles = Array.isArray(data.profiles) ? data.profiles : EMPTY;
      loaded = true;
      emit();
    } catch {
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!loaded && !inflight) void refreshSubagentProfiles();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly SubagentProfile[] {
  return profiles;
}

function getServerSnapshot(): readonly SubagentProfile[] {
  return EMPTY;
}

export function useSubagentProfiles(): readonly SubagentProfile[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function findSubagentProfile(
  list: readonly SubagentProfile[],
  name: string | null | undefined,
): SubagentProfile | null {
  if (!name) return null;
  return list.find((profile) => profile.name === name) ?? null;
}
