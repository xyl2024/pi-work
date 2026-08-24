"use client";

import { useSyncExternalStore } from "react";

interface RunningSession {
  id: string;
  running: boolean;
}

interface Snapshot {
  byId: Map<string, boolean>;
  count: number;
}

const listeners = new Set<() => void>();
let snapshot: Snapshot = { byId: new Map(), count: 0 };
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let started = false;

function publish(sessions: RunningSession[]) {
  const byId = new Map(sessions.map((session) => [session.id, session.running] as const));
  snapshot = {
    byId,
    count: sessions.filter((session) => session.running).length,
  };
  listeners.forEach((listener) => listener());
}

async function poll() {
  if (inFlight || document.hidden) return;
  inFlight = true;
  try {
    const response = await fetch("/api/sessions/running", { cache: "no-store" });
    if (response.ok) {
      const data = await response.json() as { sessions?: RunningSession[] };
      publish(data.sessions ?? []);
    }
  } catch {
    // Best effort; retain the last known snapshot.
  } finally {
    inFlight = false;
    if (started) timer = setTimeout(poll, 3000);
  }
}

function onVisibilityChange() {
  if (!document.hidden) {
    void poll();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!started) {
    started = true;
    document.addEventListener("visibilitychange", onVisibilityChange);
    void poll();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      started = false;
      if (timer) clearTimeout(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}

function getSnapshot() {
  return snapshot;
}

export function useRunningSessions(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
