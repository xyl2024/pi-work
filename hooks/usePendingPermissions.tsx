"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { PermissionDialog } from "@/components/chat/PermissionDialog";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/hooks/useI18n";

export interface PendingPermissionRequest {
  toolCallId: string;
  ruleName: string;
  command: string;
  /** Session id used when sending the decision back to the server. */
  sessionId: string;
}

export type Decision = "allow_once" | "allow_similar" | "deny";

/**
 * The queue's *commands* — the only part `AppShell` and the SSE adapter need.
 *
 * Kept apart from the queue contents on purpose: `AppShell` is the whole
 * application shell, and a context whose value changes every time a
 * confirmation arrives would re-render it end to end. The actions below are
 * stable for the lifetime of the provider, so a request appearing never
 * touches that subtree; only the sidebar (the one consumer of the session-id
 * set, see `usePendingPermissionSessionIds`) re-renders.
 */
interface PermissionActions {
  addRequest: (req: PendingPermissionRequest) => void;
  resolveRequest: (toolCallId: string, decision: Decision) => Promise<void>;
  /**
   * Drop every queued request owned by one session. Called when the session's
   * turn ends (no gate can outlive it), when the session is deleted, and when
   * a decision POST fails — the three ways an entry would otherwise strand,
   * lighting the sidebar dot forever.
   */
  removeSessionRequests: (sessionId: string) => void;
  /** Only requests owned by this active session are surfaced as dialogs. */
  setActiveSessionId: (sessionId: string | null) => void;
}

const PermissionActionsContext = createContext<PermissionActions | null>(null);
const PendingPermissionSessionIdsContext = createContext<ReadonlySet<string> | null>(null);

const EMPTY_SESSION_IDS: ReadonlySet<string> = new Set();

export function PermissionProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const toast = useToast();
  const [queue, setQueue] = useState<PendingPermissionRequest[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // Mirror in a ref so async POSTs always see the latest queue when removing
  // by toolCallId, even if React state hasn't yet committed.
  const queueRef = useRef<PendingPermissionRequest[]>([]);
  queueRef.current = queue;

  const addRequest = useCallback((req: PendingPermissionRequest) => {
    setQueue((prev) => {
      if (prev.some((r) => r.toolCallId === req.toolCallId)) return prev;
      return [...prev, req];
    });
  }, []);

  const removeSessionRequests = useCallback((sessionId: string) => {
    setQueue((prev) => {
      const next = prev.filter((r) => r.sessionId !== sessionId);
      return next.length === prev.length ? prev : next;
    });
  }, []);

  const resolveRequest = useCallback(async (toolCallId: string, decision: Decision) => {
    const req = queueRef.current.find((r) => r.toolCallId === toolCallId);
    if (!req) return;
    setQueue((prev) => prev.filter((r) => r.toolCallId !== toolCallId));
    try {
      const response = await fetch(`/api/agent/${encodeURIComponent(req.sessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "permission_decision", toolCallId, decision }),
      });
      // A 4xx/5xx means the server no longer knows this gate (wrapper gone,
      // turn killed). The dialog is already gone, so the user would otherwise
      // believe the decision landed: tell them, and leave the entry dropped.
      if (!response.ok) toast.show({ kind: "error", message: t("Failed to send the permission decision") });
    } catch {
      // Server already disconnected or wrapper destroyed — nothing to do, but
      // say it: silence here reads as "approved".
      toast.show({ kind: "error", message: t("Failed to send the permission decision") });
    }
  }, [t, toast]);

  // Background controllers keep their pending requests queued, but never
  // interrupt the currently visible session. Switching back to the owning tab
  // reveals its oldest request without requiring an SSE reconnect.
  const head = activeSessionId
    ? queue.find((request) => request.sessionId === activeSessionId) ?? null
    : null;

  // The sidebar's view of the queue: which sessions have a confirmation
  // waiting. A fresh Set only when the membership actually changes, so the row
  // list does not re-render when a request is answered elsewhere.
  const pendingSessionIds = useMemo(() => {
    if (queue.length === 0) return EMPTY_SESSION_IDS;
    return new Set(queue.map((request) => request.sessionId));
  }, [queue]);

  const actions = useMemo<PermissionActions>(
    () => ({ addRequest, resolveRequest, removeSessionRequests, setActiveSessionId }),
    [addRequest, resolveRequest, removeSessionRequests],
  );

  return (
    <PermissionActionsContext.Provider value={actions}>
      <PendingPermissionSessionIdsContext.Provider value={pendingSessionIds}>
        {children}
        {head && (
          <PermissionDialog
            request={head}
            onDecide={(decision: Decision) => {
              void resolveRequest(head.toolCallId, decision);
            }}
          />
        )}
      </PendingPermissionSessionIdsContext.Provider>
    </PermissionActionsContext.Provider>
  );
}

export function usePendingPermissions(): PermissionActions {
  const ctx = useContext(PermissionActionsContext);
  if (!ctx) throw new Error("usePendingPermissions must be used within PermissionProvider");
  return ctx;
}

/**
 * Session ids with an unanswered confirmation. Separate context so only the
 * sidebar (and not `AppShell`) re-renders when the queue changes.
 */
export function usePendingPermissionSessionIds(): ReadonlySet<string> {
  const ctx = useContext(PendingPermissionSessionIdsContext);
  if (!ctx) throw new Error("usePendingPermissionSessionIds must be used within PermissionProvider");
  return ctx;
}

/**
 * Imperative ref for places (like the SSE event handler inside useAgentSession)
 * where calling hooks is awkward. Always reflects the latest actions.
 */
export function usePendingPermissionsRef(): RefObject<PermissionActions | null> {
  const ctx = useContext(PermissionActionsContext);
  const ref = useRef<PermissionActions | null>(ctx);
  useEffect(() => {
    ref.current = ctx;
  }, [ctx]);
  return ref;
}
