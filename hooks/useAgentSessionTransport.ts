import { useCallback } from "react";
import type { AgentEvent, EventHandlerRef, TransportRefs } from "./useAgentSessionTypes";

type Translator = (key: string, params?: Record<string, string | number>) => string;

type UseAgentSessionTransportOptions = {
  refs: TransportRefs;
  handleAgentEventRef: EventHandlerRef;
  /** Called once on SSE open when compensate=true; gives the data layer a
   *  chance to refresh context/runtime state for the connected session. */
  onConnectCompensate: (sid: string) => Promise<void>;
  /** Called after SSE close/error: the data layer can close its idle
   *  EventSource if the agent is no longer running. */
  onConnectionClosed: () => void;
  t: Translator;
};

export function useAgentSessionTransport(options: UseAgentSessionTransportOptions) {
  const { refs, handleAgentEventRef, onConnectCompensate, onConnectionClosed, t } = options;
  const eventSourceRef = refs.eventSource;
  const eventSourceSessionRef = refs.eventSourceSession;
  const transportGenerationRef = refs.generation;
  const reconnectTimerRef = refs.reconnectTimer;
  const reconnectAttemptRef = refs.reconnectAttempt;
  const disposedRef = refs.disposed;
  const agentRunningRef = refs.agentRunning;

  const closeEvents = useCallback(() => {
    transportGenerationRef.current += 1;
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    eventSourceSessionRef.current = null;
    onConnectionClosed();
  }, [eventSourceRef, eventSourceSessionRef, reconnectAttemptRef, reconnectTimerRef, transportGenerationRef, onConnectionClosed]);

  const connectEvents = useCallback((sid: string, compensate = false) => {
    if (disposedRef.current) return;
    // A live connection belongs to this controller, not to the active view.
    // Repeated sends/compacts reuse it instead of tearing it down.
    if (eventSourceRef.current && eventSourceSessionRef.current === sid) return;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      eventSourceSessionRef.current = null;
    }
    const generation = ++transportGenerationRef.current;
    const es = new EventSource(`/api/agent/${encodeURIComponent(sid)}/events`);
    eventSourceRef.current = es;
    eventSourceSessionRef.current = sid;
    es.onopen = () => {
      if (eventSourceRef.current !== es || transportGenerationRef.current !== generation) return;
      reconnectAttemptRef.current = 0;
      if (!compensate) return;
      void (async () => {
        await onConnectCompensate(sid);
        if (!agentRunningRef.current && eventSourceRef.current === es) closeEvents();
      })();
    };
    es.onmessage = (e) => {
      if (eventSourceRef.current !== es || transportGenerationRef.current !== generation) return;
      try {
        const event = JSON.parse(e.data) as AgentEvent;
        handleAgentEventRef.current?.(event);
      } catch {
        // ignore malformed events
      }
    };
    es.onerror = () => {
      if (eventSourceRef.current !== es || transportGenerationRef.current !== generation) return;
      es.close();
      eventSourceRef.current = null;
      eventSourceSessionRef.current = null;
      if (!agentRunningRef.current) return;
      const attempt = reconnectAttemptRef.current++;
      const delay = Math.min(1000 * 2 ** Math.min(attempt, 4), 15000);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (agentRunningRef.current && transportGenerationRef.current === generation) {
          connectEvents(sid, true);
        }
      }, delay);
    };
  }, [agentRunningRef, closeEvents, disposedRef, eventSourceRef, eventSourceSessionRef, handleAgentEventRef, reconnectAttemptRef, reconnectTimerRef, transportGenerationRef, onConnectCompensate]);

  const ensureEventsConnected = useCallback(async (sid: string) => {
    connectEvents(sid);
    const startedAt = Date.now();
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (disposedRef.current) {
          reject(new Error(t("Failed to connect to session events")));
          return;
        }
        const current = eventSourceRef.current;
        if (current && eventSourceSessionRef.current === sid && current.readyState === EventSource.OPEN) {
          resolve();
          return;
        }
        if (Date.now() - startedAt >= 15_000) {
          reject(new Error(t("Failed to connect to session events")));
          return;
        }
        setTimeout(check, 25);
      };
      check();
    });
  }, [connectEvents, disposedRef, eventSourceRef, eventSourceSessionRef, t]);

  return { closeEvents, connectEvents, ensureEventsConnected };
}
