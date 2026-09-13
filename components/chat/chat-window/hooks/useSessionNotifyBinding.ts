"use client";

/**
 * Notification-channel binding wiring for one chat window.
 *
 * Two bindings live here, and they are different things:
 *   - the channel picked on the new-session welcome screen, persisted once the
 *     session id exists so reloads keep it;
 *   - the channel bound to the current (existing) session, read back from the
 *     server on session change and edited from the MoreMenu.
 *
 * The branches — when to persist, and when a disk read must be ignored because
 * this window already wrote the binding — live in
 * `lib/shared/session-notify-binding.ts`. This hook owns the fetches and the
 * toasts; dependencies come in as parameters.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decideSessionNotifySave,
  isSessionNotifyBindingLocallySaved,
  parseSessionNotifyChannelId,
} from "@/lib/shared/session-notify-binding";
import type { ToastInput } from "@/components/ui/Toast";

export interface UseSessionNotifyBindingOptions {
  /** Selected session id (null on the new-session page). */
  sessionId: string | null;
  /** Session id after creation — flips null → real id once the POST returns. */
  currentSessionId: string | null;
  /** True only for the tab currently projected into the visible chat view. */
  isActive: boolean;
  showToast: (input: ToastInput) => void;
  t: (key: string) => string;
}

export interface UseSessionNotifyBindingResult {
  /** Channel picked on the new-session welcome screen. */
  pickedChannelId: string | null;
  setPickedChannelId: (channelId: string | null) => void;
  /** Channel bound to the current session (from disk, or just written). */
  boundChannelId: string | null;
  /** Persist a MoreMenu change (null clears the binding). */
  setNotifyChannel: (channelId: string | null) => Promise<void>;
}

export function useSessionNotifyBinding({
  sessionId,
  currentSessionId,
  isActive,
  showToast,
  t,
}: UseSessionNotifyBindingOptions): UseSessionNotifyBindingResult {
  const [pickedChannelId, setPickedChannelId] = useState<string | null>(null);
  const [boundChannelId, setBoundChannelId] = useState<string | null>(null);
  // Session whose binding this window already wrote (null = none yet).
  const savedSessionIdRef = useRef<string | null>(null);
  // Read at response time, not request time — mirrors the previous in-window
  // ref so a tab that goes inactive mid-request stays silent.
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  // Persist the new-session pick once the session exists. Best-effort: a
  // failure only toasts, it never blocks chat.
  useEffect(() => {
    const save = decideSessionNotifySave({
      currentSessionId,
      pickedChannelId,
      savedSessionId: savedSessionIdRef.current,
    });
    if (save.kind !== "persist") return;
    savedSessionIdRef.current = save.sessionId;
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(save.sessionId)}/notify`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId: save.channelId }),
        });
        if (!res.ok && isActiveRef.current) {
          showToast({ kind: "error", message: t("Failed to set notification channel") });
        } else {
          setBoundChannelId(save.channelId);
        }
      } catch {
        if (isActiveRef.current) {
          showToast({ kind: "error", message: t("Failed to set notification channel") });
        }
      }
    })();
  }, [currentSessionId, pickedChannelId, showToast, t]);

  // Load the existing session's binding on session change.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setBoundChannelId(null);
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/notify`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { config?: unknown };
        if (cancelled) return;
        // A brand-new session that just saved its binding may still be racing
        // this read — the in-memory save wins over the stale disk answer.
        if (isSessionNotifyBindingLocallySaved({ sessionId, savedSessionId: savedSessionIdRef.current })) {
          return;
        }
        setBoundChannelId(parseSessionNotifyChannelId(data.config));
      } catch {
        // keep null — the MoreMenu entry then shows "No notification"
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const setNotifyChannel = useCallback(
    async (channelId: string | null) => {
      const sid = sessionId ?? currentSessionId;
      if (!sid) return;
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sid)}/notify`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId: channelId ?? "" }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setBoundChannelId(channelId);
        showToast({
          kind: "success",
          message: channelId ? t("Notification channel set") : t("Notification channel cleared"),
        });
      } catch {
        showToast({ kind: "error", message: t("Failed to set notification channel") });
      }
    },
    [sessionId, currentSessionId, showToast, t],
  );

  return { pickedChannelId, setPickedChannelId, boundChannelId, setNotifyChannel };
}
