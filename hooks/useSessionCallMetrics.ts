"use client";

/**
 * Per-session TTFT / TPS facts for the chat footer.
 *
 * The recorder writes one `model_calls` row per logical generation, keyed by
 * the assistant message id (`String(message.timestamp)`). The footer needs the
 * whole session at once, so this hook fetches `/api/token-audit/message-metrics`
 * once per session and hands the messages a `Map` through context.
 *
 * Two properties matter:
 * - A call's row only exists once its generation finished, so the caller
 *   passes `refreshKey` (idle-state + message count) and a refetch is debounced
 *   slightly to let the recorder commit.
 * - Metrics are decoration. Any failure (metrics DB disabled, aborted request)
 *   leaves the returned map empty instead of surfacing an error in the chat.
 */

import { useEffect, useRef, useState } from "react";
import type { MessageCallMetrics } from "@/lib/shared/token-audit-types";

export type MessageCallMetricsMap = ReadonlyMap<string, MessageCallMetrics>;

const EMPTY: MessageCallMetricsMap = new Map();

/** Survives session switches so a revisit paints metrics before the refetch. */
const cache = new Map<string, MessageCallMetricsMap>();

/** Delay before refetching after a turn boundary (recorder commit window). */
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

/**
 * @param sessionId session whose calls to load; `null` yields an empty map.
 * @param refreshKey any value that changes when a new call may have been
 *   recorded (e.g. `${agentRunning}:${messages.length}`).
 */
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
          // Aborts fire on every session switch / refresh churn; both are
          // expected, and a genuine failure just keeps the last-known map.
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
