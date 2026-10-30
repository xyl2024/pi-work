"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decideAutoNameApply, decideAutoNameStart, shouldConfirmAutoName, type AutoNameMode } from "@/lib/shared/auto-naming";
import { claimAutoNamedSession } from "@/lib/client/auto-name-ledger";
import type { SessionInfo } from "@/lib/shared/types";
import type { ToastInput } from "@/components/ui/Toast";
import type { ConfirmOptions } from "@/components/ui/ConfirmDialog";

const AUTO_NAME_DELAY_MS = 1000;

export interface UseAutoNamingOptions {
  session: SessionInfo | null;
  agentRunning: boolean;
  firstUserMessageText: string | null;
  showToast: (input: ToastInput) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  t: (key: string) => string;
  onSessionNameChange?: (name: string) => void;
  onRenameCompleted?: () => void;
  onFirstAssistantReady?: () => void;
}

export interface UseAutoNamingResult {
  isAutoNaming: boolean;
  canAutoName: boolean;
  handleAutoName: () => void;
  handleFirstAssistantReady: () => void;
}

export function useAutoNaming({
  session,
  agentRunning,
  firstUserMessageText,
  showToast,
  confirm,
  t,
  onSessionNameChange,
  onRenameCompleted,
  onFirstAssistantReady,
}: UseAutoNamingOptions): UseAutoNamingResult {
  const [isAutoNaming, setIsAutoNaming] = useState(false);
  const sessionId = session?.id ?? null;
  const currentSessionName = session?.name ?? null;

  const currentSessionNameRef = useRef<string | null>(currentSessionName);
  useEffect(() => {
    currentSessionNameRef.current = currentSessionName;
  }, [currentSessionName]);

  const runAutoNameRef = useRef<((opts: { mode: AutoNameMode }) => Promise<void>) | null>(null);
  const autoNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runAutoName = useCallback(
    async ({ mode }: { mode: AutoNameMode }) => {
      const start = decideAutoNameStart({
        mode,
        sessionId,
        isAutoNaming,
        agentRunning,
        firstUserMessageText,
        currentSessionName: currentSessionNameRef.current,
      });
      if (start.kind === "abandon") return;

      if (shouldConfirmAutoName({ mode, currentSessionName })) {
        const ok = await confirm({
          title: t("Auto-name session?"),
          description: t("This will replace the current session name."),
          confirmLabel: t("Auto-name"),
          cancelLabel: t("Cancel"),
          destructive: false,
        });
        if (!ok) return;
      }

      setIsAutoNaming(true);
      try {
        const suggestRes = await fetch(
          `/api/sessions/${encodeURIComponent(start.sessionId)}/auto-name`,
          { method: "POST" },
        );
        const suggestBody = (await suggestRes.json().catch(() => ({}))) as {
          name?: unknown;
          error?: unknown;
        };
        if (!suggestRes.ok || typeof suggestBody.name !== "string") {
          const reason =
            typeof suggestBody.error === "string" ? suggestBody.error : `HTTP ${suggestRes.status}`;
          throw new Error(reason);
        }

        const applied = decideAutoNameApply({
          mode,
          suggestedName: suggestBody.name,
          currentSessionName: currentSessionNameRef.current,
        });
        if (applied.kind === "abandon") {
          if (applied.reason === "empty-name") {
            showToast({ kind: "error", message: t("Auto-naming returned an empty name") });
          }
          return;
        }

        const patchRes = await fetch(`/api/sessions/${encodeURIComponent(start.sessionId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: applied.name }),
        });
        if (!patchRes.ok) {
          const body = (await patchRes.json().catch(() => ({}))) as { error?: unknown };
          const reason = typeof body.error === "string" ? body.error : `HTTP ${patchRes.status}`;
          throw new Error(reason);
        }

        onSessionNameChange?.(applied.name);
        try {
          await onRenameCompleted?.();
        } catch {
        }
        if (mode === "manual") {
          showToast({ kind: "success", message: `${t("Renamed")} ${applied.name}` });
        }
      } catch (error) {
        showToast({
          kind: "error",
          message: `${t("Auto-naming failed")}: ${
            error instanceof Error && error.message ? error.message : t("Network error")
          }`,
        });
      } finally {
        setIsAutoNaming(false);
      }
    },
    [
      sessionId,
      isAutoNaming,
      agentRunning,
      firstUserMessageText,
      currentSessionName,
      confirm,
      showToast,
      onSessionNameChange,
      onRenameCompleted,
      t,
    ],
  );

  useEffect(() => {
    runAutoNameRef.current = runAutoName;
  }, [runAutoName]);

  useEffect(
    () => () => {
      if (autoNameTimerRef.current) {
        clearTimeout(autoNameTimerRef.current);
        autoNameTimerRef.current = null;
      }
    },
    [],
  );

  const handleFirstAssistantReady = useCallback(() => {
    onFirstAssistantReady?.();
    if (!sessionId) return;
    if (!claimAutoNamedSession(sessionId)) return;
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    autoNameTimerRef.current = setTimeout(() => {
      autoNameTimerRef.current = null;
      void runAutoNameRef.current?.({ mode: "auto" });
    }, AUTO_NAME_DELAY_MS);
  }, [onFirstAssistantReady, sessionId]);

  const handleAutoName = useCallback(() => {
    void runAutoName({ mode: "manual" });
  }, [runAutoName]);

  const canAutoName =
    decideAutoNameStart({
      mode: "manual",
      sessionId,
      isAutoNaming,
      agentRunning,
      firstUserMessageText,
      currentSessionName,
    }).kind === "proceed";

  return { isAutoNaming, canAutoName, handleAutoName, handleFirstAssistantReady };
}
