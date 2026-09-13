"use client";

/**
 * Auto-naming wiring for one chat window.
 *
 * The rule — may this session be named now, and may the LLM's answer be written
 * back — lives in `lib/shared/auto-naming.ts`. This hook owns only the parts
 * that need a browser: the 1s silent timer for a brand-new session, the two
 * requests, the toasts, and the report back to the shell. Dependencies are
 * parameters; the hook reads nothing from the environment itself.
 *
 * The "this session was already auto-named" ledger is module-level and keyed by
 * session (`lib/client/auto-name-ledger.ts`), because one chat window is
 * mounted per session tab and an instance ledger forgets on tab reopen.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { decideAutoNameApply, decideAutoNameStart, shouldConfirmAutoName, type AutoNameMode } from "@/lib/shared/auto-naming";
import { claimAutoNamedSession } from "@/lib/client/auto-name-ledger";
import type { SessionInfo } from "@/lib/shared/types";
import type { ToastInput } from "@/components/ui/Toast";
import type { ConfirmOptions } from "@/components/ui/ConfirmDialog";

/** Silence after the first assistant reply before the silent auto-name runs. */
const AUTO_NAME_DELAY_MS = 1000;

export interface UseAutoNamingOptions {
  /** Selected session (null on the new-session page). */
  session: SessionInfo | null;
  /** The agent is streaming or running a turn. */
  agentRunning: boolean;
  /** Text of the session's first user message (null when there is none yet). */
  firstUserMessageText: string | null;
  showToast: (input: ToastInput) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  t: (key: string) => string;
  /** Keeps in-memory session state in sync as soon as the rename is confirmed. */
  onSessionNameChange?: (name: string) => void;
  /** Refresh the sidebar after the rename lands. */
  onRenameCompleted?: () => void;
  /** Forwarded to the shell when the first assistant reply of a session lands. */
  onFirstAssistantReady?: () => void;
}

export interface UseAutoNamingResult {
  /** True while an auto-name request is in flight (drives the button spinner). */
  isAutoNaming: boolean;
  /** False disables the header's Auto-name button. */
  canAutoName: boolean;
  /** Manual entry point (the header button). */
  handleAutoName: () => void;
  /** Wire into `useAgentSession`'s `onFirstAssistantReady`. */
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

  // Read fresh after the 5–30s LLM wait: the in-flight closure captured the
  // pre-LLM name, so race rule 2 checks this ref instead.
  const currentSessionNameRef = useRef<string | null>(currentSessionName);
  useEffect(() => {
    currentSessionNameRef.current = currentSessionName;
  }, [currentSessionName]);

  // The timer fires outside React, so it must call the freshest closure.
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

      // Manual naming overwrites a user-chosen name, so it asks first. Auto
      // naming is silent and never reaches this branch.
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
          // An empty answer is a user-visible failure; a name that appeared
          // meanwhile is a silent yield to the user's own rename.
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
          // sidebar refresh is best-effort
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

  // Drop a pending timer on unmount (session switch / window teardown) so it
  // can never PATCH against a stale session.
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
    // Forward to the shell first: the sidebar refresh is unchanged behaviour.
    onFirstAssistantReady?.();
    if (!sessionId) return;
    // A session is named once — a reopened tab finds the claim already taken
    // and only re-schedules nothing.
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
