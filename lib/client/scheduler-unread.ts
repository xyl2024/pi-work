"use client";

import { useSyncExternalStore } from "react";
import {
  NO_SCHEDULER_UNREAD,
  type SchedulerUnreadCounts,
} from "@/lib/shared/scheduler-unread";

const SEEN_AT_KEY = "pi-work/scheduler-unread-seen-at";
const POLL_MS = 60_000;

let counts: SchedulerUnreadCounts = NO_SCHEDULER_UNREAD;
let seenAt: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function writeSeenAt(value: number): void {
  seenAt = value;
  try {
    window.localStorage.setItem(SEEN_AT_KEY, String(value));
  } catch {
  }
}

function readSeenAt(): number {
  if (seenAt !== null) return seenAt;
  let stored: number | null = null;
  try {
    const raw = window.localStorage.getItem(SEEN_AT_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) stored = parsed;
  } catch {
  }
  const resolved = stored ?? Date.now();
  writeSeenAt(resolved);
  return resolved;
}

async function refresh(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const response = await fetch(`/api/scheduled-tasks/unread?since=${readSeenAt()}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as Partial<SchedulerUnreadCounts>;
    const next = { success: data.success ?? 0, failed: data.failed ?? 0 };
    if (next.success === counts.success && next.failed === counts.failed) return;
    counts = next;
    emit();
  } catch {
  } finally {
    inFlight = false;
  }
}

function handleVisibility(): void {
  if (!document.hidden) void refresh();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    readSeenAt();
    void refresh();
    timer = setInterval(() => void refresh(), POLL_MS);
    document.addEventListener("visibilitychange", handleVisibility);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer !== null) clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", handleVisibility);
    }
  };
}

function getSnapshot(): SchedulerUnreadCounts {
  return counts;
}

export function markSchedulerSeen(): void {
  writeSeenAt(Date.now());
  if (counts.success === 0 && counts.failed === 0) return;
  counts = NO_SCHEDULER_UNREAD;
  emit();
}

export function useSchedulerUnread(): SchedulerUnreadCounts {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
