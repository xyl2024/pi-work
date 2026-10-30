"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decideSessionNotifySave,
  isSessionNotifyBindingLocallySaved,
  parseSessionNotifyChannelId,
} from "@/lib/shared/session-notify-binding";
import type { ToastInput } from "@/components/ui/Toast";

export interface UseSessionNotifyBindingOptions {
  sessionId: string | null;
  currentSessionId: string | null;
  isActive: boolean;
  showToast: (input: ToastInput) => void;
  t: (key: string) => string;
}

export interface UseSessionNotifyBindingResult {
  pickedChannelId: string | null;
  setPickedChannelId: (channelId: string | null) => void;
  boundChannelId: string | null;
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
  const savedSessionIdRef = useRef<string | null>(null);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

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
        if (isSessionNotifyBindingLocallySaved({ sessionId, savedSessionId: savedSessionIdRef.current })) {
          return;
        }
        setBoundChannelId(parseSessionNotifyChannelId(data.config));
      } catch {
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
