"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { PermissionDialog } from "@/components/chat/PermissionDialog";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/hooks/useI18n";

export interface PendingPermissionRequest {
  toolCallId: string;
  ruleName: string;
  command: string;
  sessionId: string;
}

export type Decision = "allow_once" | "allow_similar" | "deny";

interface PermissionActions {
  addRequest: (req: PendingPermissionRequest) => void;
  resolveRequest: (toolCallId: string, decision: Decision) => Promise<void>;
  removeSessionRequests: (sessionId: string) => void;
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
      if (!response.ok) toast.show({ kind: "error", message: t("Failed to send the permission decision") });
    } catch {
      toast.show({ kind: "error", message: t("Failed to send the permission decision") });
    }
  }, [t, toast]);

  const head = activeSessionId
    ? queue.find((request) => request.sessionId === activeSessionId) ?? null
    : null;

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

export function usePendingPermissionSessionIds(): ReadonlySet<string> {
  const ctx = useContext(PendingPermissionSessionIdsContext);
  if (!ctx) throw new Error("usePendingPermissionSessionIds must be used within PermissionProvider");
  return ctx;
}

export function usePendingPermissionsRef(): RefObject<PermissionActions | null> {
  const ctx = useContext(PermissionActionsContext);
  const ref = useRef<PermissionActions | null>(ctx);
  useEffect(() => {
    ref.current = ctx;
  }, [ctx]);
  return ref;
}
