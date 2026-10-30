"use client";

import { useEffect, useRef, useState } from "react";
import type { MessageCallMetrics } from "@/lib/shared/token-audit-types";

export type MessageCallMetricsMap = ReadonlyMap<string, MessageCallMetrics>;

const EMPTY: MessageCallMetricsMap = new Map();

const cache = new Map<string, MessageCallMetricsMap>();

const REFRESH_DELAY_MS = 400;

interface Snapshot {
  sessionId: string;
  metrics: MessageCallMetricsMap;
}

function toMap(rows: MessageCallMetrics[]): MessageCallMetricsMap {
  const map = new Map<string, MessageCallMetrics>();
  for (const row of rows) {
    if (row && typeof row.messageId === "string") map.set(row.messageId, row);
  }
  return map;
}

export function useSessionCallMetrics(
  sessionId: string | null,
  refreshKey?: string | number,
): MessageCallMetricsMap {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    const delay = loadedForRef.current === sessionId ? REFRESH_DELAY_MS : 0;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/token-audit/message-metrics?sessionId=${encodeURIComponent(sessionId)}`,
            { signal: controller.signal },
          );
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = (await response.json()) as { metrics?: MessageCallMetrics[] };
          if (controller.signal.aborted) return;
          const metrics = toMap(Array.isArray(data.metrics) ? data.metrics : []);
          cache.set(sessionId, metrics);
          loadedForRef.current = sessionId;
          setSnapshot({ sessionId, metrics });
        } catch (error) {
          if (controller.signal.aborted || (error as { name?: string }).name === "AbortError") return;
        }
      })();
    }, delay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [sessionId, refreshKey]);

  if (!sessionId) return EMPTY;
  if (snapshot && snapshot.sessionId === sessionId) return snapshot.metrics;
  return cache.get(sessionId) ?? EMPTY;
}
